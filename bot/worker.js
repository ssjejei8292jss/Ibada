/* Ибада — сервер бота (Cloudflare Workers + D1).
   Напоминания о намазах и азкарах для каждого пользователя, отметка намаза кнопками,
   обмен отметками с приложением. Токен бота и Telegram ID владельца — только в секретах Worker.

   Маршруты:
     POST /tg        — вебхук Telegram (проверяется секретный заголовок)
     POST /api/sync  — приложение: расписание, настройки, отметки (проверяется initData)
     POST /setup     — один раз после выкладки: вебхук, команды, описание, кнопка меню
     GET  /          — проверка, что сервер жив
   Каждую минуту — scheduled(): рассылка напоминаний. */

const MIN = 60000, HOUR = 3600000, DAY = 86400000, WINDOW = 20 * MIN;
const PR = [['fajr', 'Фаджр', 'Фаджра'], ['dhuhr', 'Зухр', 'Зухра'], ['asr', 'Аср', 'Асра'], ['maghrib', 'Магриб', 'Магриба'], ['isha', 'Иша', 'Иши']];
const ST = { mosque: 'В мечети', jamaat: 'Джамаатом', juma: 'Джума', done: 'Совершил', qada: 'Восполнил', missed: 'Пропустил' };
const SHORT = { m: 'mosque', j: 'jamaat', u: 'juma', d: 'done', q: 'qada', x: 'missed' };
const CODE = Object.fromEntries(Object.entries(SHORT).map(([a, b]) => [b, a]));
const OK_STATUS = (c) => !!c && c !== 'missed';

/* ---------------- служебное ---------------- */
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}
const webhookSecret = async (env) => (await sha256(env.BOT_TOKEN + ':webhook')).slice(0, 48);
const setupKey = async (env) => sha256(env.BOT_TOKEN + ':setup');

// Проверка initData мини-приложения (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
export async function verifyInitData(initData, token, now) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData), hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
  const secret = await hmac('WebAppData', token);
  if (hex(await hmac(new Uint8Array(secret), dcs)) !== hash) return null;
  const authDate = +params.get('auth_date') * 1000;
  if (!authDate || (now || Date.now()) - authDate > 30 * DAY) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
}

function allowed(env, uid) {
  if (String(env.OPEN || '0') === '1') return true;
  const ids = String(env.OWNER_ID || '') + ',' + String(env.ALLOW || '');
  return ids.split(',').map((x) => x.trim()).filter(Boolean).indexOf(String(uid)) >= 0;
}

async function tg(env, method, params) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}) });
  let o; try { o = await r.json(); } catch (e) { o = { ok: false, description: 'bad json' }; }
  return o;
}

/* ---------------- время в поясе пользователя ---------------- */
function parts(t, tz) {
  const f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {}; f.formatToParts(new Date(t)).forEach((p) => { o[p.type] = p.value; });
  return o;
}
const hm = (t, tz) => { const p = parts(t, tz); return p.hour + ':' + p.minute; };
const dayKey = (t, tz) => { const p = parts(t, tz); return p.year + p.month + p.day; };
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayTitle = (k) => { const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6))); const w = WD[d.getUTCDay()]; return w[0].toUpperCase() + w.slice(1) + ', ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };

/* ---------------- база ---------------- */
const db = (env) => env.DB;
async function getUser(env, uid) { return db(env).prepare('SELECT * FROM users WHERE id = ?').bind(uid).first(); }
async function upsertUser(env, uid, chat, name) {
  await db(env).prepare('INSERT INTO users (id, chat, name, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET chat = excluded.chat, name = excluded.name, blocked = 0').bind(uid, chat, name || '', Date.now()).run();
}
async function getDay(env, uid, k) {
  const r = await db(env).prepare('SELECT f, am, ae, sl, u FROM days WHERE uid = ? AND k = ?').bind(uid, k).first();
  if (!r) return { f: {}, am: false, ae: false, sl: false, u: 0, pc: null };
  const f = JSON.parse(r.f || '{}'), pc = f._pc || null; delete f._pc; // итог плана из приложения хранится рядом с отметками
  return { f, am: !!r.am, ae: !!r.ae, sl: !!r.sl, u: r.u || 0, pc };
}
async function putDay(env, uid, k, d) {
  await db(env).prepare('INSERT INTO days (uid, k, f, am, ae, sl, u) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid, k) DO UPDATE SET f = excluded.f, am = excluded.am, ae = excluded.ae, sl = excluded.sl, u = excluded.u')
    .bind(uid, k, JSON.stringify(d.pc ? Object.assign({}, d.f, { _pc: d.pc }) : d.f), d.am ? 1 : 0, d.ae ? 1 : 0, d.sl ? 1 : 0, d.u || 0).run();
}
// f[p] = [код, время, источник: 'a' приложение | 'b' бот]
const statusOf = (d, p) => (d.f[p] && d.f[p][0]) || '';
async function isSent(env, uid, key) { return !!(await db(env).prepare('SELECT 1 AS x FROM sent WHERE uid = ? AND key = ?').bind(uid, key).first()); }
async function markSent(env, uid, key) { await db(env).prepare('INSERT OR IGNORE INTO sent (uid, key, t) VALUES (?, ?, ?)').bind(uid, key, Date.now()).run(); }
async function getCard(env, uid, k, p) { return db(env).prepare('SELECT msg, state FROM cards WHERE uid = ? AND k = ? AND p = ?').bind(uid, k, p).first(); }
async function putCard(env, uid, k, p, msg, state) { await db(env).prepare('INSERT INTO cards (uid, k, p, msg, state) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid, k, p) DO UPDATE SET msg = excluded.msg, state = excluded.state').bind(uid, k, p, msg, state).run(); }

/* ---------------- синхронизация с приложением ----------------
   Приложение присылает дни с временем изменения u и время, когда оно в последний раз получало отметки бота (seen).
   Отметка бота сохраняется, если приложение о ней не знало (в приложении пусто, а бот отметил после seen)
   или если она новее изменения дня в приложении. Ответ — отметки, которых в приложении нет. */
// итог дня из приложения. v3: { v: 3, hn — привычек, hd — выполнено (без джамаата), ex — нафиль (без джамаата), jm — намазы привычки джамаата, mn — день «только основа» }
// старый формат (v2.4: n, dn, ex, jm) ещё принимаем от не обновлённых копий приложения
const jmList = (a) => (Array.isArray(a) ? a.filter((x) => PR.some((y) => y[0] === x)) : []);
const validPc = (p) => {
  if (!p || typeof p !== 'object') return null;
  if (+p.v === 3) { const hn = +p.hn; if (!(hn >= 0 && hn <= 30)) return null; return { v: 3, hn, hd: clampN(p.hd, 0, hn), ex: clampN(p.ex, 0, 60), jm: jmList(p.jm), mn: p.mn ? 1 : 0 }; }
  return +p.n >= 5 && +p.n <= 60 ? { n: +p.n, dn: Math.max(0, +p.dn || 0), ex: Math.max(0, +p.ex || 0), jm: jmList(p.jm) } : null;
};
const clampN = (v, a, b) => Math.min(b, Math.max(a, Math.round(+v || 0)));
// состояние дня, как в приложении: none → started → saved (все пять фардов) → plan (и все привычки)
export function planOf(d) {
  const pc = d.pc; if (!pc) return null;
  const JM = { mosque: 1, jamaat: 1, juma: 1 };
  const fd = PR.filter(([p]) => OK_STATUS(statusOf(d, p))).length;
  const missed = PR.some(([p]) => statusOf(d, p) === 'missed');
  const jmEx = PR.filter(([p]) => pc.jm.indexOf(p) < 0 && JM[statusOf(d, p)]).length;
  if (pc.v === 3) {
    const jmOk = pc.jm.length > 0 && pc.jm.every((p) => JM[statusOf(d, p)]);
    const hn = pc.mn ? 0 : pc.hn, hd = pc.mn ? 0 : Math.min(hn, pc.hd + (jmOk ? 1 : 0)), ex = pc.ex + jmEx;
    const saved = fd === 5, complete = saved && hd === hn;
    return { v: 3, fd, hn, hd, ex, saved, complete, rest: !!pc.mn, missed, state: complete ? 'plan' : saved ? 'saved' : fd || missed || hd || ex ? 'started' : 'none' };
  }
  // v2.4 → переводим в состояния (без процентов)
  const jmIn = PR.filter(([p]) => pc.jm.indexOf(p) >= 0 && JM[statusOf(d, p)]).length;
  const hn = Math.max(0, pc.n - 5), hd = Math.min(hn, pc.dn + jmIn), saved = fd === 5, complete = saved && hd >= hn;
  return { v: 2, fd, hn, hd, ex: pc.ex + jmEx, saved, complete, rest: false, missed, state: complete ? 'plan' : saved ? 'saved' : fd || missed ? 'started' : 'none' };
}
export function mergeDay(server, app, seen) {
  const out = { f: {}, am: !!app.am, ae: !!app.ae, sl: !!app.sl, u: Math.max(server.u || 0, app.u || 0), pc: validPc(app.pc) || server.pc || null }, diff = {};
  PR.forEach(([p]) => {
    const s = server.f[p], a = (app.f || {})[p] || '';
    const botWins = s && s[2] === 'b' && s[0] !== a && ((!a && s[1] > (seen || 0)) || s[1] > (app.u || 0));
    if (botWins) { out.f[p] = s; diff[p] = s[0]; } else if (a) out.f[p] = [a, (s && s[0] === a) ? s[1] : (app.u || Date.now()), (s && s[0] === a) ? s[2] : 'a'];
  });
  return { day: out, diff };
}
async function apiSync(req, env) {
  let body; try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const user = await verifyInitData(body.initData, env.BOT_TOKEN);
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  if (!allowed(env, user.id)) return json({ ok: false, error: 'closed' }, 403);
  const t0 = Date.now(), uid = user.id;
  await db(env).prepare('INSERT INTO users (id, chat, name, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(uid, uid, user.first_name || '', t0).run();
  const sets = [], vals = [];
  if (body.schedule && Array.isArray(body.schedule.days)) { sets.push('sched = ?', 'tz = ?'); vals.push(JSON.stringify(body.schedule), String(body.schedule.tz || '')); }
  if (body.remind) { sets.push('remind = ?'); vals.push(JSON.stringify(body.remind)); }
  if (sets.length) await db(env).prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, uid).run();
  const res = { ok: true, f: {}, now: t0 };
  for (const k of Object.keys(body.days || {}).slice(0, 7)) {
    if (!/^\d{8}$/.test(k)) continue;
    const { day, diff } = mergeDay(await getDay(env, uid, k), body.days[k] || {}, +body.seen || 0);
    await putDay(env, uid, k, day);
    if (Object.keys(diff).length) res.f[k] = diff;
    await refreshCards(env, uid, k, day);
  }
  const u = await getUser(env, uid);
  res.chat = !!(u && u.chat && !u.blocked);
  return json(res);
}

/* ---------------- карточка намаза: одно сообщение, три состояния ---------------- */
const appUrl = (env, open) => String(env.APP_URL || '') + (open ? (String(env.APP_URL || '').indexOf('?') >= 0 ? '&' : '?') + 'open=' + open : '');
const appBtn = (env, text, open) => (env.APP_URL ? [{ text, web_app: { url: appUrl(env, open) } }] : []);
function statusRows(k, p, fri) {
  const b = (c) => ({ text: ST[c], callback_data: 'm|' + k + '|' + p + '|' + CODE[c] });
  const first = p === 'dhuhr' && fri ? [b('juma'), b('jamaat')] : [b('mosque'), b('jamaat')];
  return [first, [b('done'), b('qada'), b('missed')]];
}
const pname = (p, fri) => (p === 'dhuhr' && fri ? 'Джума' : PR.find((x) => x[0] === p)[1]);
const pgen = (p, fri) => (p === 'dhuhr' && fri ? 'Джумы' : PR.find((x) => x[0] === p)[2]);
function cardView(env, kind, o) {
  const name = pname(o.p, o.fri);
  if (kind === 'soon') return { text: '<b>' + name + '</b> через ' + o.mins + ' мин · ' + o.time + (o.iq ? '\nИкама в ' + o.iq : ''), kb: [] };
  if (kind === 'time') return { text: 'Время <b>' + pgen(o.p, o.fri) + '</b>' + (o.until ? ' · до ' + o.until : '') + '\nКак вы его совершили?', kb: statusRows(o.k, o.p, o.fri) };
  if (kind === 'late') return { text: '<b>' + name + '</b> ещё не отмечен. Как вы его совершили?', kb: statusRows(o.k, o.p, o.fri) };
  const st = o.status;
  return { text: (OK_STATUS(st) ? '✓ ' : '') + '<b>' + name + '</b> — ' + ST[st] + (st === 'missed' ? '\nДобавлен в план восполнения.' : '\nДа примет Аллах.'), kb: [[{ text: 'Изменить', callback_data: 'e|' + o.k + '|' + o.p }]] };
}
const markup = (kb) => ({ inline_keyboard: kb });
async function sendCard(env, u, kind, o) {
  const v = cardView(env, kind, o);
  const r = await tg(env, 'sendMessage', { chat_id: u.chat, text: v.text, parse_mode: 'HTML', reply_markup: markup(v.kb), disable_notification: kind === 'marked' });
  if (!r.ok) { if (r.error_code === 403) await db(env).prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(u.id).run(); return null; }
  await putCard(env, u.id, o.k, o.p, r.result.message_id, kind);
  return r.result.message_id;
}
async function editCard(env, u, msg, kind, o) {
  const v = cardView(env, kind, o);
  const r = await tg(env, 'editMessageText', { chat_id: u.chat, message_id: msg, text: v.text, parse_mode: 'HTML', reply_markup: markup(v.kb) });
  if (r.ok || /not modified/.test(r.description || '')) { await putCard(env, u.id, o.k, o.p, msg, kind); return true; }
  return false;
}
// Отметка пришла из приложения — открытые карточки этого дня меняются на «отмечено»
async function refreshCards(env, uid, k, day) {
  const u = await getUser(env, uid); if (!u || !u.chat || u.blocked) return;
  const sched = u.sched ? JSON.parse(u.sched) : null, sd = sched && (sched.days || []).find((d) => d.k === k);
  for (const [p] of PR) {
    const c = await getCard(env, uid, k, p); if (!c) continue;
    const st = statusOf(day, p);
    if (st && c.state !== 'marked:' + st) await editCard(env, u, c.msg, 'marked', { k, p, fri: !!(sd && sd.fri), status: st }).then(() => putCard(env, uid, k, p, c.msg, 'marked:' + st));
  }
}

/* ---------------- вебхук ---------------- */
async function onUpdate(env, up) {
  if (up.message) {
    const m = up.message, from = m.from || {}, text = String(m.text || '');
    if (m.chat.type !== 'private') return;
    if (!allowed(env, from.id)) { await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Ибада пока в закрытом тестировании. Ин ша Аллах, скоро откроется для всех.' }); return; }
    await upsertUser(env, from.id, m.chat.id, from.first_name);
    const u = await getUser(env, from.id);
    if (text.indexOf('/start') === 0) {
      const ready = !!u.sched;
      await tg(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML',
        text: 'Ас-саляму алейкум' + (from.first_name ? ', ' + esc(from.first_name) : '') + '!\n\nЯ — бот Ибады. Напоминаю о намазах по времени вашего города и даю отметить намаз прямо в чате. Ещё напоминаю об утренних и вечерних азкарах и азкарах перед сном, а вечером присылаю итог дня.\n\n' +
          (ready ? 'Напоминания уже включены. Настроить их можно в приложении: «Ещё → Напоминания».' : 'Откройте приложение кнопкой ниже и выберите город — после этого напоминания начнут приходить.'),
        reply_markup: markup([appBtn(env, 'Открыть Ибаду')].filter((x) => x.length)) });
    } else if (text.indexOf('/today') === 0) {
      await sendToday(env, u);
    } else if (text.indexOf('/help') === 0 || text.indexOf('/') === 0 || text) {
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Команды:\n/today — намазы сегодня\n/help — помощь\n\nОтмечайте намазы кнопками в напоминаниях или в приложении.', reply_markup: markup([appBtn(env, 'Открыть Ибаду')].filter((x) => x.length)) });
    }
    return;
  }
  if (up.callback_query) {
    const q = up.callback_query, from = q.from || {}, data = String(q.data || '').split('|');
    if (!allowed(env, from.id)) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' }); return; }
    const u = await getUser(env, from.id) || (await upsertUser(env, from.id, q.message ? q.message.chat.id : from.id, from.first_name), await getUser(env, from.id));
    const k = data[1], p = data[2];
    if (!/^\d{8}$/.test(k || '') || !PR.find((x) => x[0] === p)) { await tg(env, 'answerCallbackQuery', { callback_query_id: q.id }); return; }
    const sched = u.sched ? JSON.parse(u.sched) : null, sd = sched && (sched.days || []).find((d) => d.k === k), fri = !!(sd && sd.fri);
    if (data[0] === 'm' && SHORT[data[3]]) {
      const code = SHORT[data[3]], d = await getDay(env, u.id, k), now = Date.now();
      d.f[p] = [code, now, 'b'];
      await putDay(env, u.id, k, d);
      // ответ на нажатие — сразу, чтобы кнопка не «висела»
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: (OK_STATUS(code) ? '✓ ' : '') + pname(p, fri) + ' — ' + ST[code] });
      if (q.message) { await editCard(env, u, q.message.message_id, 'marked', { k, p, fri, status: code }); await putCard(env, u.id, k, p, q.message.message_id, 'marked:' + code); }
    } else if (data[0] === 'e') {
      await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
      if (q.message) await editCard(env, u, q.message.message_id, 'time', { k, p, fri });
    } else await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendToday(env, u) {
  const sched = u.sched ? JSON.parse(u.sched) : null, tz = u.tz || 'UTC', k = dayKey(Date.now(), tz);
  const sd = sched && (sched.days || []).find((d) => d.k === k);
  if (!sd) { await tg(env, 'sendMessage', { chat_id: u.chat, text: 'Расписание ещё не получено. Откройте приложение, чтобы оно передало время намазов.', reply_markup: markup([appBtn(env, 'Открыть Ибаду')].filter((x) => x.length)) }); return; }
  const d = await getDay(env, u.id, k), now = Date.now();
  const lines = PR.map(([p]) => { const st = statusOf(d, p); return (st ? (OK_STATUS(st) ? '✓ ' : '· ') : (sd[p] > now ? '  ' : '○ ')) + pname(p, sd.fri) + ' · ' + hm(sd[p], tz) + (st ? ' — ' + ST[st] : ''); });
  await tg(env, 'sendMessage', { chat_id: u.chat, parse_mode: 'HTML', text: '<b>' + dayTitle(k) + '</b>\n\n' + lines.join('\n'), reply_markup: markup([appBtn(env, 'Открыть Ибаду')].filter((x) => x.length)) });
}

/* ---------------- напоминания: каждую минуту ---------------- */
export async function tickUser(env, u, now) {
  const R = u.remind ? JSON.parse(u.remind) : {}, sched = u.sched ? JSON.parse(u.sched) : null, tz = u.tz || 'UTC';
  if (!sched || !sched.days || R.off) return;
  const offset = (+R.offset || 15) * MIN;
  for (const sd of sched.days) {
    if (!sd || !sd.fajr || Math.abs(sd.dhuhr - now) > 1.5 * DAY) continue;
    const k = sd.k; let day = null; const D = async () => day || (day = await getDay(env, u.id, k)); // день читается из базы, только когда есть событие
    for (let n = 0; n < 5; n++) {
      const [p] = PR[n], t = sd[p]; if (!t) continue;
      const next = n < 4 ? sd[PR[n + 1][0]] : t + 3 * HOUR, endFajr = p === 'fajr' && sd.sunrise ? sd.sunrise : next;
      const iq = R.target === 'iqama' && sd.iq && sd.iq[p] ? sd.iq[p] : 0, tt = iq || t;
      const o = { k, p, fri: !!sd.fri, time: hm(t, tz), iq: iq ? hm(iq, tz) : '', until: hm(endFajr, tz) };
      // 1. «скоро»: за N минут до азана (или икамы)
      if (R.before !== false && now >= tt - offset && now < tt && now < tt - offset + WINDOW && !statusOf(await D(), p) && !(await isSent(env, u.id, 'b|' + k + '|' + p))) {
        await markSent(env, u.id, 'b|' + k + '|' + p);
        await sendCard(env, u, 'soon', Object.assign({ mins: Math.max(1, Math.round((tt - now) / MIN)) }, o));
      }
      // 2. время наступило: та же карточка меняется — появляются кнопки статусов
      if (now >= t && now < Math.min(endFajr, t + WINDOW) && !(await isSent(env, u.id, 't|' + k + '|' + p))) {
        await markSent(env, u.id, 't|' + k + '|' + p);
        const c = await getCard(env, u.id, k, p);
        const st = statusOf(await D(), p);
        if (c && c.state === 'soon') await editCard(env, u, c.msg, st ? 'marked' : 'time', Object.assign({ status: st }, o));
      }
      // 3. не отмечен через 45 минут: карточка «переезжает» вниз чата, чтобы пришло уведомление
      const late = t + (+R.unmarkedAfter || 45) * MIN;
      if (R.unmarked !== false && now >= late && now < Math.min(endFajr, late + WINDOW) && !(await isSent(env, u.id, 'u|' + k + '|' + p))) {
        await markSent(env, u.id, 'u|' + k + '|' + p);
        if (!statusOf(await getDay(env, u.id, k), p)) {
          const c = await getCard(env, u.id, k, p);
          if (c) await tg(env, 'deleteMessage', { chat_id: u.chat, message_id: c.msg });
          await sendCard(env, u, 'late', o);
        }
      }
    }
    // азкары: утренние — после Фаджра, вечерние — после Асра, перед сном — через 1,5 часа после Иши
    const az = [['am', 'morning', sd.fajr + 20 * MIN, 'Время <b>утренних азкаров</b>. Пусть этот день будет благословенным.', 'Открыть утренние азкары', R.azkar],
      ['ae', 'evening', sd.asr + 20 * MIN, 'Время <b>вечерних азкаров</b> — до Магриба.', 'Открыть вечерние азкары', R.azkar],
      ['sl', 'sleep', sd.isha + 90 * MIN, 'Пора готовиться ко сну. <b>Азкары перед сном</b> — по порядку, с тасбихом.', 'Открыть азкары перед сном', R.sleep]];
    for (const [key, open, at, text, btn, on] of az) {
      if (on === false || !at || now < at || now >= at + WINDOW || (await isSent(env, u.id, key + '|' + k))) continue;
      await markSent(env, u.id, key + '|' + k);
      if (!(await D())[key]) await send(env, u, text, [appBtn(env, btn, open)].filter((x) => x.length));
    }
    // вечером: желательный пост завтра и итог дня
    if (sd.summary && now >= sd.summary && now < sd.summary + WINDOW) {
      if (R.fast !== false && sd.fastTomorrow && !(await isSent(env, u.id, 'f|' + k))) { await markSent(env, u.id, 'f|' + k); await send(env, u, 'Завтра желательный пост: <b>' + esc(sd.fastTomorrow) + '</b>. Не забудьте сухур.'); }
      if (R.summary !== false && !(await isSent(env, u.id, 's|' + k))) { await markSent(env, u.id, 's|' + k); await sendSummary(env, u, k, sd, await getDay(env, u.id, k)); }
    }
  }
}
async function send(env, u, text, kb, quiet) {
  const r = await tg(env, 'sendMessage', { chat_id: u.chat, text, parse_mode: 'HTML', reply_markup: kb && kb.length ? markup(kb) : undefined, disable_notification: !!quiet });
  if (!r.ok && r.error_code === 403) await db(env).prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(u.id).run();
  return r;
}
async function sendSummary(env, u, k, sd, d) {
  const marked = PR.filter(([p]) => OK_STATUS(statusOf(d, p))).length;
  const lines = PR.map(([p]) => { const st = statusOf(d, p); return (OK_STATUS(st) ? '✓ ' : '○ ') + pname(p, sd.fri) + (st ? ' — ' + ST[st] : ' — не отмечен'); });
  const pl = planOf(d);
  let head = 'Намазы: ' + marked + ' из 5', tail = marked === 5 ? '\n\nАльхамдулиллях — все пять намазов.' : '';
  if (pl) {
    // v3.0: состояние дня вместо процента; нафиль — просто число со звёздочкой
    head = (pl.complete ? 'День по плану' : pl.saved ? 'День сохранён' : 'Намазы: ' + pl.fd + ' из 5') + (pl.hn ? ' · привычки ' + pl.hd + ' из ' + pl.hn : pl.rest ? ' · только основа' : '') + (pl.ex ? ' · нафиль ✦' + pl.ex : '');
    tail = pl.complete ? '\n\nАльхамдулиллях, день по плану. Пусть Аллах примет.' + (pl.rest ? ' Привычки сегодня отдыхали.' : '') : pl.saved ? '\n\nАльхамдулиллях — все пять намазов, день сохранён.' + (pl.rest ? ' Привычки сегодня отдыхают.' : '') : (pl.missed ? '\n\nПропущенный намаз можно восполнить. Завтра — новый день.' : '');
  }
  const az = 'Азкары: утро ' + (d.am ? '✓' : '—') + ' · вечер ' + (d.ae ? '✓' : '—');
  await send(env, u, '<b>Итог дня · ' + dayTitle(k) + '</b>\n\n' + head + '\n' + lines.join('\n') + '\n\n' + az + tail, [appBtn(env, 'Подробнее в приложении', 'progress')].filter((x) => x.length), true);
}
export async function tick(env, now) {
  const { results } = await db(env).prepare('SELECT * FROM users WHERE sched IS NOT NULL AND blocked = 0').all();
  for (const u of results || []) {
    if (!allowed(env, u.id)) continue;
    try { await tickUser(env, u, now); } catch (e) { console.log('tick', u.id, e && e.message); }
  }
  // уборка раз в сутки: отметки отправки и карточки старше 3 дней
  if (new Date(now).getUTCMinutes() === 7 && new Date(now).getUTCHours() === 3) {
    await db(env).prepare('DELETE FROM sent WHERE t < ?').bind(now - 3 * DAY).run();
    await db(env).prepare('DELETE FROM cards WHERE k < ?').bind(dayKey(now - 3 * DAY, 'UTC')).run();
  }
}

/* ---------------- настройка бота после выкладки ---------------- */
async function setup(req, env) {
  const url = new URL(req.url), origin = url.origin, out = {};
  out.webhook = (await tg(env, 'setWebhook', { url: origin + '/tg', secret_token: await webhookSecret(env), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })).ok;
  out.commands = (await tg(env, 'setMyCommands', { commands: [{ command: 'today', description: 'Намазы сегодня' }, { command: 'help', description: 'Помощь' }] })).ok;
  out.short = (await tg(env, 'setMyShortDescription', { short_description: 'Намазы, азкары и Коран — тихий спутник на каждый день. Напоминания и отметки в одно касание.' })).ok;
  out.description = (await tg(env, 'setMyDescription', { description: 'Ас-саляму алейкум! Ибада помогает держать постоянство в поклонении. Бот напоминает о намазах по времени вашего города и даёт отметить намаз прямо в чате. Напоминает об утренних и вечерних азкарах и азкарах перед сном, вечером подводит итог дня. Коран, азкары, план восполнения и цели — в приложении, кнопка «Ибада» внизу.' })).ok;
  if (env.APP_URL) out.menu = (await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Ибада', web_app: { url: env.APP_URL } } })).ok;
  const info = await tg(env, 'getWebhookInfo', {});
  out.pending = info.result && info.result.pending_update_count;
  return json({ ok: true, origin, result: out });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return json({});
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, app: 'ibada-bot' });
    if (req.method === 'POST' && url.pathname === '/tg') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(env))) return new Response('forbidden', { status: 403 });
      let up; try { up = await req.json(); } catch (e) { return new Response('ok'); }
      try { await onUpdate(env, up); } catch (e) { console.log('update', e && e.message); }
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/api/sync') return apiSync(req, env);
    if (req.method === 'POST' && url.pathname === '/setup') {
      if (req.headers.get('x-setup-key') !== (await setupKey(env))) return new Response('forbidden', { status: 403 });
      return setup(req, env);
    }
    return new Response('not found', { status: 404 });
  },
  async scheduled(event, env, ctx) { await tick(env, event.scheduledTime || Date.now()); }
};
