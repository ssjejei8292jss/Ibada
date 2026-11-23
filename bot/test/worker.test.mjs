// Проверка сервера бота: D1 — на node:sqlite, Telegram — подмена fetch
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import W, { verifyInitData, mergeDay, tick } from '../worker.js';

let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sq = new DatabaseSync(':memory:'); sq.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = { prepare: (sql) => { const st = sq.prepare(sql); let args = []; const o = { bind: (...a) => { args = a; return o; }, first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => st.run(...args) }; return o; } };
const TOKEN = '123456:TEST-token', OWNER = 777, OTHER = 888;
const env = { DB, BOT_TOKEN: TOKEN, OWNER_ID: String(OWNER), APP_URL: 'https://app.test/Ibada/', OPEN: '0' };
let calls = [], msgId = 100, NOW = Date.UTC(2026, 10, 16, 0, 0); const realNow = Date.now; Date.now = () => NOW;
globalThis.fetch = async (url, init) => { const m = url.split('/').pop(), p = JSON.parse(init.body); calls.push({ m, p }); const res = m === 'sendMessage' ? { ok: true, result: { message_id: ++msgId } } : { ok: true, result: true }; return new Response(JSON.stringify(res)); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const initData = (uid, t) => { const p = new URLSearchParams({ auth_date: String(Math.floor((t || Date.now()) / 1000)), user: JSON.stringify({ id: uid, first_name: 'Али' }) });
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest(); p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex')); return p.toString(); };
const req = (path, body, headers) => new Request('https://bot.test' + path, { method: 'POST', body: JSON.stringify(body), headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
const hook = (up) => W.fetch(req('/tg', up, { 'x-telegram-bot-api-secret-token': sha(TOKEN + ':webhook').slice(0, 48) }), env);

// 1. initData
ok((await verifyInitData(initData(OWNER), TOKEN)).id === OWNER, 'initData с верной подписью принимается');
ok(!(await verifyInitData(initData(OWNER).replace('auth_date=', 'auth_date=1'), TOKEN)), 'подделанные данные отклоняются');
ok(!(await verifyInitData(initData(OWNER, Date.now() - 40 * 864e5), TOKEN)), 'слишком старые данные отклоняются');

// 2. вебхук: секрет, закрытое тестирование, /start
ok((await W.fetch(req('/tg', { message: {} }), env)).status === 403, 'вебхук без секрета — 403');
calls = []; await hook({ message: { chat: { id: OTHER, type: 'private' }, from: { id: OTHER, first_name: 'Гость' }, text: '/start' } });
ok(calls[0] && /закрытом тестировании/.test(calls[0].p.text), 'чужой пользователь получает «закрытое тестирование»');
calls = []; await hook({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Али' }, text: '/start' } });
ok(calls[0] && /Ас-саляму алейкум, Али/.test(calls[0].p.text) && calls[0].p.reply_markup.inline_keyboard[0][0].web_app, '/start: приветствие с кнопкой приложения');

// 3. приложение присылает расписание (день 16.11.2026, пояс Москвы)
const T = (h, m) => Date.UTC(2026, 10, 16, h - 3, m);
NOW = T(5, 0);
const day = { k: '20261116', fajr: T(5, 50), sunrise: T(7, 40), dhuhr: T(11, 50), asr: T(13, 50), maghrib: T(15, 55), isha: T(17, 30), iq: {}, fri: false, summary: T(21, 30), fastTomorrow: 'понедельник' };
const sync = async (body) => (await W.fetch(req('/api/sync', Object.assign({ initData: initData(OWNER) }, body)), env)).json();
let r = await sync({ schedule: { tz: 'Europe/Moscow', days: [day] }, remind: { offset: 15 }, days: { 20261116: { u: T(5, 0), f: {} } }, seen: 0 });
ok(r.ok && r.chat, 'синхронизация принята, чат с ботом есть');
ok((await (await W.fetch(req('/api/sync', { initData: initData(OTHER), days: {} }), env)).json()).error === 'closed', 'чужой пользователь не может синхронизироваться');

// 4. напоминания
const u = () => sq.prepare('SELECT * FROM users WHERE id = ?').get(OWNER);
calls = []; await (NOW = T(5, 36), tick(env, NOW));
let soon = calls.find((c) => c.m === 'sendMessage');
ok(soon && /<b>Фаджр<\/b> через 14 мин · 05:50/.test(soon.p.text), 'за 15 минут: «Фаджр через 14 мин · 05:50»');
calls = []; await (NOW = T(5, 37), tick(env, NOW)); ok(!calls.length, 'повторно не присылает');
calls = []; await (NOW = T(5, 50), tick(env, NOW));
let ed = calls.find((c) => c.m === 'editMessageText');
ok(ed && ed.p.message_id === soon && true || (ed && /Время <b>Фаджра<\/b> · до 07:40/.test(ed.p.text)), 'в 05:50 та же карточка меняется на «Время Фаджра · до 07:40»');
ok(ed && ed.p.reply_markup.inline_keyboard.flat().map((b) => b.text).join(',') === 'В мечети,Джамаатом,Совершил,Восполнил,Пропустил', 'кнопки статусов с новыми названиями');
const fajrMsg = ed && ed.p.message_id;
// 5. нажатие «В мечети»: ответ сразу, карточка «отмечено»
NOW = T(5, 55); calls = []; await hook({ callback_query: { id: 'q1', from: { id: OWNER }, data: 'm|20261116|fajr|m', message: { message_id: fajrMsg, chat: { id: OWNER } } } });
ok(calls[0].m === 'answerCallbackQuery' && calls[0].p.text === '✓ Фаджр — В мечети', 'кнопка отвечает сразу: «✓ Фаджр — В мечети»');
ok(calls[1] && calls[1].m === 'editMessageText' && /✓ <b>Фаджр<\/b> — В мечети/.test(calls[1].p.text) && calls[1].p.reply_markup.inline_keyboard[0][0].text === 'Изменить', 'карточка: «✓ Фаджр — В мечети» и «Изменить»');
calls = []; await hook({ callback_query: { id: 'q2', from: { id: OWNER }, data: 'e|20261116|fajr', message: { message_id: fajrMsg, chat: { id: OWNER } } } });
ok(calls[1] && calls[1].p.reply_markup.inline_keyboard.length === 2, '«Изменить» снова показывает статусы');
calls = []; await (NOW = T(6, 36), tick(env, NOW)); ok(!calls.some((c) => /Фаджр/.test(c.p.text || '')), 'отмеченный Фаджр не напоминает «не отмечен»');
// утренние азкары
calls = []; await (NOW = T(6, 10), tick(env, NOW)); const az = calls.find((c) => /утренних азкаров/.test(c.p.text || ''));
ok(az && az.p.reply_markup.inline_keyboard[0][0].web_app.url === 'https://app.test/Ibada/?open=morning', 'утренние азкары с кнопкой «?open=morning»');

// 6. приложение синхронизируется: о Фаджре из бота не знало — отметка возвращается приложению
NOW = T(6, 21); r = await sync({ days: { 20261116: { u: T(6, 20), f: { dhuhr: 'done' } } }, seen: T(5, 0) });
ok(r.f['20261116'] && r.f['20261116'].fajr === 'mosque', 'приложение получает Фаджр «В мечети» из бота');
let row = JSON.parse(sq.prepare("SELECT f FROM days WHERE uid = ? AND k = '20261116'").get(OWNER).f);
ok(row.fajr[0] === 'mosque' && row.dhuhr[0] === 'done', 'на сервере: Фаджр из бота и Зухр из приложения');
// приложение увидело и сняло отметку — снятие сохраняется
NOW = T(6, 41); r = await sync({ days: { 20261116: { u: T(6, 40), f: { dhuhr: 'done' } } }, seen: T(6, 30) });
row = JSON.parse(sq.prepare("SELECT f FROM days WHERE uid = ? AND k = '20261116'").get(OWNER).f);
ok(!row.fajr && !(r.f['20261116'] || {}).fajr, 'снятие отметки в приложении после того, как оно её увидело, сохраняется');

// 7. Аср без отметки: «скоро», «время», через 45 минут — новая карточка внизу чата
calls = []; await (NOW = T(13, 35), tick(env, NOW)); const asrSoon = calls.find((c) => c.m === 'sendMessage'); ok(asrSoon && /Аср/.test(asrSoon.p.text), 'Аср: «скоро»');
calls = []; await (NOW = T(13, 50), tick(env, NOW));
calls = []; await (NOW = T(14, 35), tick(env, NOW));
ok(calls.some((c) => c.m === 'deleteMessage') && calls.some((c) => c.m === 'sendMessage' && /<b>Аср<\/b> ещё не отмечен/.test(c.p.text)), 'через 45 минут: старая карточка удалена, новая «Аср ещё не отмечен» с кнопками');
// 8. Зухр отмечен в приложении заранее: «скоро» не присылается
calls = []; await (NOW = T(11, 36), tick(env, NOW)); ok(!calls.some((c) => /Зухр/.test(c.p.text || '')), 'Зухр отмечен в приложении — напоминания нет');
// 9б. итог дня v3.0: состояние дня (сохранён / по плану), привычки и нафиль; фарды и джамаат сервер считает по своим отметкам
{
  const { planOf } = await import('../worker.js');
  const F5 = { fajr: ['mosque', 1, 'b'], dhuhr: ['done', 1, 'a'], asr: ['done', 1, 'a'], maghrib: ['jamaat', 1, 'a'], isha: ['done', 1, 'a'] };
  const pl = planOf({ f: F5, pc: { v: 3, hn: 3, hd: 2, ex: 1, jm: ['fajr'], mn: 0 } });
  ok(pl.saved && pl.complete && pl.hd === 3 && pl.ex === 2 && pl.state === 'plan', 'все фарды, привычка джамаата Фаджра засчитана ботом → по плану; Магриб джамаатом — нафиль (' + JSON.stringify(pl) + ')');
  const pl2 = planOf({ f: { fajr: ['missed', 1, 'a'], dhuhr: ['done', 1, 'a'] }, pc: { v: 3, hn: 2, hd: 2, ex: 1, jm: [], mn: 0 } });
  ok(!pl2.saved && !pl2.complete && pl2.state === 'started' && pl2.missed, 'пропущен фард: день начат, не сохранён, хотя привычки выполнены');
  const pl3 = planOf({ f: F5, pc: { v: 3, hn: 4, hd: 0, ex: 0, jm: [], mn: 1 } });
  ok(pl3.complete && pl3.hn === 0 && pl3.rest, '«Только основа»: привычки отдыхают, пять фардов — день по плану');
  const pl4 = planOf({ f: F5, pc: { n: 7, dn: 1, ex: 0, jm: [] } });
  ok(pl4.v === 2 && pl4.saved && !pl4.complete && pl4.hn === 2 && pl4.hd === 1, 'старый формат приложения переводится в состояния без процентов');
  ok(planOf({ f: F5, pc: null }) === null, 'без итога из приложения — обычная сводка');
  NOW = T(6, 50); r = await sync({ days: { 20261116: { u: T(6, 49), f: { dhuhr: 'done' }, pc: { v: 3, hn: 2, hd: 1, ex: 2, jm: [], mn: 0 } } }, seen: T(6, 45) });
  const raw = JSON.parse(sq.prepare("SELECT f FROM days WHERE uid = ? AND k = '20261116'").get(OWNER).f);
  ok(raw._pc && raw._pc.v === 3 && raw._pc.hn === 2 && raw._pc.ex === 2, 'итог дня из приложения сохранён на сервере');
  r = await sync({ days: { 20261116: { u: T(6, 51), f: { dhuhr: 'done' }, pc: { v: 3, hn: 999, hd: 1 } } }, seen: T(6, 45) });
  const raw2 = JSON.parse(sq.prepare("SELECT f FROM days WHERE uid = ? AND k = '20261116'").get(OWNER).f);
  ok(raw2._pc && raw2._pc.hn === 2, 'неправильный итог отброшен, остаётся прежний');
}
// 9. итог дня (тихий) и пост
calls = []; await (NOW = T(21, 30), tick(env, NOW));
const sum = calls.find((c) => /Итог дня/.test(c.p.text || '')), fast = calls.find((c) => /желательный пост/.test(c.p.text || ''));
ok(sum && /Намазы: \d из 5 · привычки 1 из 2 · нафиль ✦2/.test(sum.p.text) && !/%|сверх/.test(sum.p.text) && sum.p.disable_notification === true, 'итог дня без звука, без процентов: ' + (sum && sum.p.text.split('\n')[2]));
ok(!!fast, 'напоминание о посте завтра');
// 10. перед сном
calls = []; await (NOW = T(19, 0), tick(env, NOW)); ok(calls.some((c) => /Азкары перед сном/.test(c.p.text || '') && /open=sleep/.test(JSON.stringify(c.p.reply_markup))), 'азкары перед сном через 1,5 часа после Иши');
// 11. выключенные напоминания
await sync({ remind: { off: true } }); sq.prepare('DELETE FROM sent').run();
calls = []; await (NOW = T(15, 41), tick(env, NOW)); ok(!calls.length, 'напоминания выключены — ничего не приходит');
// 12. /today
calls = []; await hook({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Али' }, text: '/today' } });
ok(calls[0] && /Понедельник, 16 ноября/.test(calls[0].p.text) && /Зухр · 11:50 — Совершил/.test(calls[0].p.text), '/today: день и статусы');
// 13. /setup защищён
ok((await W.fetch(req('/setup', {}), env)).status === 403, '/setup без ключа — 403');
calls = []; const s = await (await W.fetch(req('/setup', {}, { 'x-setup-key': sha(TOKEN + ':setup') }), env)).json();
ok(s.ok && calls.find((c) => c.m === 'setWebhook').p.url === 'https://bot.test/tg' && calls.find((c) => c.m === 'setChatMenuButton'), '/setup ставит вебхук, команды, описание и кнопку меню');
console.log(fails ? fails + ' FAIL' : 'все проверки пройдены'); process.exit(fails ? 1 : 0);
