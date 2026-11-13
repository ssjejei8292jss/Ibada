/* Ибада — мини-приложение Telegram. Версия 1.
   Данные пользователя хранятся в облаке Telegram (CloudStorage), вне Telegram — в localStorage браузера. */
(function () {
  'use strict';

  /* ===== настройки проекта ===== */
  // Ссылка на мини-приложение для кнопки «Поделиться», например 'https://t.me/ibada_bot/app'. Пусто — кнопка скрыта.
  const SHARE_LINK = '';
  const QURAN_API = 'https://api.alquran.cloud/v1';
  const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';

  const D = window.IBADA_DATA;
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.initData);
  const ver = (v) => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));

  /* ===== утилиты ===== */
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; if (a === 1 && b !== 11) return one; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few; return many; };
  const times = (n) => n + ' ' + plural(n, 'раз', 'раза', 'раз');
  const pct = (v) => (v === null || v === undefined || isNaN(v) ? '—' : Math.round(v * 100) + '%');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* Вибрация. В Telegram — HapticFeedback (iPhone и Android). Вне Telegram: Android — navigator.vibrate,
     iPhone (iOS 18+) — щелчок скрытого системного переключателя, который iOS сопровождает тактильным откликом. */
  const tgHaptic = () => !!(tg && tg.HapticFeedback && ver('6.1'));
  const hapticAvailable = () => tgHaptic() || !!navigator.vibrate || /iP(hone|ad|od)/.test(navigator.userAgent);
  let hapticFired = false, iosSwitch = null;
  function iosTick() {
    try {
      if (!iosSwitch) { iosSwitch = document.createElement('label'); iosSwitch.setAttribute('aria-hidden', 'true'); iosSwitch.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none'; const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1; iosSwitch.appendChild(inp); document.body.appendChild(iosSwitch); }
      iosSwitch.click();
    } catch (e) {}
  }
  const VIB_MS = { light: 8, soft: 8, medium: 14, rigid: 14, heavy: 22, success: [12, 60, 18], warning: [18, 80, 18], error: [25, 60, 25, 60, 25] };
  const haptic = (type, style) => {
    hapticFired = true;
    if (S.set.vib === false) return;
    try {
      if (tgHaptic()) { if (type === 'impact') tg.HapticFeedback.impactOccurred(style || 'light'); else if (type === 'select') tg.HapticFeedback.selectionChanged(); else tg.HapticFeedback.notificationOccurred(style || 'success'); return; }
      if (navigator.vibrate) { navigator.vibrate(VIB_MS[type === 'select' ? 'light' : (style || 'light')] || 10); return; }
      if (/iP(hone|ad|od)/.test(navigator.userAgent)) { iosTick(); if (type === 'notify') setTimeout(iosTick, 90); }
    } catch (e) {}
  };
  // Тасбих: каждое касание — выбранная сила, каждые 33 — двойной сильный толчок, 100 — сигнал успеха.
  function tasbihHaptic(c) {
    const st = S.set.vibT || 'medium';
    if (c > 0 && c % 100 === 0) haptic('notify', 'success');
    else if (c > 0 && c % 33 === 0) { haptic('impact', 'heavy'); setTimeout(() => haptic('impact', 'heavy'), 110); }
    else haptic('impact', st);
  }
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  /* ===== состояние ===== */
  const DEFAULT_SET = { level: '', lat: null, lng: null, city: '', tz: '', method: 'MuslimWorldLeague', madhab: 'Shafi', hijriAdj: 0, theme: 'auto', qadaBase: 0, fastBase: 0, detailed: true, qlast: null, qmarks: [],
    syncUrl: '', lastSync: 0, pending: [],
    tadj: {}, iq: {}, vib: true, vibT: 'medium', sky: 'live',
    remind: { before: true, offset: 15, target: 'adhan', unmarked: true, azkar: true, fast: true, summary: true, summaryTime: '21:30' } };
  const S = {
    set: Object.assign({}, DEFAULT_SET),
    days: {},
    tab: 'home', viewKey: null,
    onbLevel: 'ihsan',
    zView: 'tasbih', zSel: 0, azTab: null, duaOpen: -1,
    quran: { view: 'surahs', reader: null, meta: null },
    prog: { period: 'week', bar: null, day: null },
    sheet: null, city: { q: '', results: [], loading: false, error: '' },
    heading: null, compassOn: false, qiblaAligned: false,
    toast: '', loaded: false,
    gam: { seen: {}, goal: null, goals: [], qadaMade: 0, qw: {}, init: 0, chron: '' },
    read: null,
    qg: { u: 0, g: [] }, hz: { u: 0, s: {}, rv: null }
  };

  /* ===== даты ===== */
  function tzNowParts(date) {
    const tz = S.set.tz || undefined;
    try {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date || new Date());
      const o = {}; p.forEach((x) => { o[x.type] = x.value; });
      return { y: +o.year, m: +o.month, d: +o.day };
    } catch (e) { const d = date || new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
  }
  const keyOf = (y, m, d) => '' + y + pad(m) + pad(d);
  const todayKey = () => { const p = tzNowParts(); return keyOf(p.y, p.m, p.d); };
  const parseKey = (k) => ({ y: +k.slice(0, 4), m: +k.slice(4, 6), d: +k.slice(6, 8) });
  const dateOfKey = (k) => { const p = parseKey(k); return new Date(p.y, p.m - 1, p.d, 12); };
  const addDays = (k, n) => { const d = dateOfKey(k); d.setDate(d.getDate() + n); return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const weekday = (k) => dateOfKey(k).getDay();
  const isFriday = (k) => weekday(k) === 5;
  const fmtDate = (k) => { const p = parseKey(k); return p.d + ' ' + MONTHS_GEN[p.m - 1]; };
  const fmtTime = (date) => { if (!date) return '—'; try { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: S.set.tz || undefined }).format(date); } catch (e) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); } };
  const viewKey = () => S.viewKey || todayKey();

  /* ===== хиджра ===== */
  function hijriTabular(date) {
    const jd = Math.floor(date.getTime() / 864e5 + 2440587.5);
    const l0 = jd - 1948440 + 10632, n = Math.floor((l0 - 1) / 10631), l1 = l0 - 10631 * n + 354;
    const j = Math.floor((10985 - l1) / 5316) * Math.floor((50 * l1) / 17719) + Math.floor(l1 / 5670) * Math.floor((43 * l1) / 15238);
    const l2 = l1 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    const m = Math.floor((24 * l2) / 709), d = l2 - Math.floor((709 * m) / 24), y = 30 * n + j - 30;
    return { d, m, y };
  }
  let umalquraOk = null;
  function hijri(k) {
    const date = dateOfKey(k);
    date.setDate(date.getDate() + (S.set.hijriAdj || 0));
    if (umalquraOk !== false) {
      try {
        const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
        const o = {}; parts.forEach((p) => { o[p.type] = p.value; });
        const r = { d: parseInt(o.day, 10), m: parseInt(o.month, 10), y: parseInt(o.year || o.relatedYear, 10) };
        if (r.d && r.m && r.y && r.y > 1300) { umalquraOk = true; return r; }
        umalquraOk = false;
      } catch (e) { umalquraOk = false; }
    }
    return hijriTabular(date);
  }
  const hijriText = (k) => { const h = hijri(k); return h.d + ' ' + D.HIJRI_MONTHS[h.m - 1] + ' ' + h.y; };
  const hijriShort = (k) => { const h = hijri(k); return h.d + ' ' + D.HIJRI_MONTHS[h.m - 1]; };
  function fastingInfo(k) {
    const h = hijri(k), wd = weekday(k);
    if ((h.m === 10 && h.d === 1) || (h.m === 12 && h.d >= 10 && h.d <= 13)) return { kind: 'forbidden', text: 'Ид: пост запрещён' };
    if (h.m === 9) return { kind: 'ramadan', text: 'Рамадан: обязательный пост' };
    if (h.m === 12 && h.d === 9) return { kind: 'rec', text: 'День Арафа' };
    if (h.m === 1 && (h.d === 9 || h.d === 10)) return { kind: 'rec', text: h.d === 10 ? 'Ашура' : 'Тасуа, накануне Ашуры' };
    if (h.d >= 13 && h.d <= 15) return { kind: 'rec', text: 'Белый день' };
    if (wd === 1 || wd === 4) return { kind: 'rec', text: wd === 1 ? 'Понедельник' : 'Четверг' };
    return null;
  }
  function nextFasting(fromKey) {
    for (let i = 1; i <= 40; i++) { const k = addDays(fromKey, i); const f = fastingInfo(k); if (f && f.kind !== 'forbidden') return { key: k, info: f }; }
    return null;
  }

  /* ===== время намазов ===== */
  const PRAYERS = [
    { id: 'fajr', name: 'Фаджр', rak: '2 ракаата' },
    { id: 'dhuhr', name: 'Зухр', rak: '4 ракаата' },
    { id: 'asr', name: 'Аср', rak: '4 ракаата' },
    { id: 'maghrib', name: 'Магриб', rak: '3 ракаата' },
    { id: 'isha', name: 'Иша', rak: '4 ракаата' }
  ];
  const METHODS = [
    ['MuslimWorldLeague', 'Всемирная исламская лига'], ['UmmAlQura', 'Умм аль-Кура, Мекка'], ['Dubai', 'Дубай'], ['Egyptian', 'Египет'],
    ['Karachi', 'Карачи'], ['Turkey', 'Турция (Диянет)'], ['Kuwait', 'Кувейт'], ['Qatar', 'Катар'], ['Singapore', 'Сингапур'],
    ['NorthAmerica', 'Северная Америка (ISNA)'], ['MoonsightingCommittee', 'Moonsighting Committee']
  ];
  const timesCache = {};
  function prayerTimes(k) {
    if (S.set.lat == null || typeof adhan === 'undefined') return null;
    const adj = S.set.tadj || {};
    const ck = k + '|' + S.set.lat + '|' + S.set.lng + '|' + S.set.method + '|' + S.set.madhab + '|' + JSON.stringify(adj);
    if (timesCache[ck]) return timesCache[ck];
    try {
      const coords = new adhan.Coordinates(S.set.lat, S.set.lng);
      const params = (adhan.CalculationMethod[S.set.method] || adhan.CalculationMethod.MuslimWorldLeague)();
      params.madhab = S.set.madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
      params.adjustments = { fajr: +adj.fajr || 0, sunrise: +adj.sunrise || 0, dhuhr: +adj.dhuhr || 0, asr: +adj.asr || 0, maghrib: +adj.maghrib || 0, isha: +adj.isha || 0 };
      if (Math.abs(S.set.lat) > 48 && adhan.HighLatitudeRule && adhan.HighLatitudeRule.recommended) params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coords);
      const t = new adhan.PrayerTimes(coords, dateOfKey(k), params);
      const r = { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha };
      timesCache[ck] = r;
      return r;
    } catch (e) { return null; }
  }
  // Икама: число — минут после азана, строка «ЧЧ:ММ» — фиксированное время. Для Зухра в пятницу берётся настройка «juma», если задана.
  function iqamaRule(k, id) { const Q = S.set.iq || {}; if (id === 'dhuhr' && isFriday(k) && Q.juma != null && Q.juma !== '') return Q.juma; return Q[id]; }
  function iqamaTime(k, id, T) {
    const r = iqamaRule(k, id); T = T || prayerTimes(k);
    if (r == null || r === '' || !T || !T[id]) return null;
    if (typeof r === 'number') return new Date(+T[id] + r * 60000);
    if (/^\d{1,2}:\d{2}$/.test(r)) { const d = new Date(localTimeMs(k, r)); return d < T[id] ? T[id] : d; }
    return null;
  }
  function timeLine(k, pr, T) {
    if (!T) return pr.rak;
    const iq = iqamaTime(k, pr.id, T);
    return fmtTime(T[pr.id]) + (iq ? ' · икама ' + fmtTime(iq) : ' · ' + pr.rak);
  }
  const hasIqama = () => Object.keys(S.set.iq || {}).some((x) => S.set.iq[x] != null && S.set.iq[x] !== '');
  function qiblaBearing() { try { return adhan.Qibla(new adhan.Coordinates(S.set.lat, S.set.lng)); } catch (e) { return null; } }
  function untilText(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'меньше минуты';
    const h = Math.floor(m / 60), mm = m % 60;
    if (!h) return mm + ' мин';
    return h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  }
  function skyState() {
    const k = todayKey(), T = prayerTimes(k);
    if (!T) return null;
    const now = new Date();
    let current = null, phase;
    if (now < T.fajr) { current = 'isha'; phase = 'night'; }
    else if (now < T.sunrise) { current = 'fajr'; phase = 'dawn'; }
    else if (now < T.dhuhr) { current = null; phase = 'morning'; }
    else if (now < T.asr) { current = 'dhuhr'; phase = 'day'; }
    else if (now < T.maghrib) { current = 'asr'; phase = 'asr'; }
    else if (now < T.isha) { current = 'maghrib'; phase = 'sunset'; }
    else { current = 'isha'; phase = 'night'; }
    let next = PRAYERS.find((p) => T[p.id] > now), nextTime;
    if (next) nextTime = T[next.id];
    else { next = PRAYERS[0]; const T2 = prayerTimes(addDays(k, 1)); nextTime = T2 ? T2.fajr : null; }
    const span = T.maghrib - T.fajr;
    const frac = (d) => clamp((d - T.fajr) / span, 0, 1);
    return { T, now, current, phase, next, nextTime, sun: frac(now), fr: { fajr: 0, dhuhr: frac(T.dhuhr), asr: frac(T.asr), maghrib: 1 } };
  }
  /* ===== день: модель и кодирование ===== */
  const SUNNA_KEYS = ['fajrSunna', 'fajrAzkar', 'duha', 'dhuhrBefore', 'dhuhrAfter', 'dhuhrAzkar', 'asrAzkar', 'maghribAfter', 'maghribAzkar', 'ishaAfter', 'ishaAzkar', 'witr', 'sadaqa', 'kahf', 'ghusl'];
  const PER_PRAYER = {
    fajr: [['fajrSunna', 'Сунна до · 2'], ['fajrAzkar', 'Азкары']],
    dhuhr: [['dhuhrBefore', 'Сунна до · 4'], ['dhuhrAfter', 'После · 2'], ['dhuhrAzkar', 'Азкары']],
    asr: [['asrAzkar', 'Азкары']],
    maghrib: [['maghribAfter', 'После · 2'], ['maghribAzkar', 'Азкары']],
    isha: [['ishaAfter', 'После · 2'], ['ishaAzkar', 'Азкары']]
  };
  const PER_PRAYER_KEYS = [].concat.apply([], Object.keys(PER_PRAYER).map((p) => PER_PRAYER[p].map((x) => x[0])));
  const F_CODE = { mosque: 'm', jamaat: 'j', juma: 'u', done: 'd', qada: 'q', missed: 'x' };
  const F_DECODE = { m: 'mosque', j: 'jamaat', u: 'juma', d: 'done', q: 'qada', x: 'missed' };
  const P_CODE = { fast: 'f', qada: 'q', missed: 'x' };
  const P_DECODE = { f: 'fast', q: 'qada', x: 'missed' };
  const W = { mosque: 1.5, jamaat: 1.2, juma: 1.5, done: 1, qada: 0.5, missed: 0 };
  const ON_TIME = { mosque: 1, jamaat: 1, juma: 1, done: 1 };
  const LBL = { mosque: 'В мечети', jamaat: 'Джамаатом', juma: 'Джума', done: 'Сделал', qada: 'Каза', missed: 'Пропущен' };

  const blankDay = () => ({ t: 'n', f: {}, s: {}, q: 0, w: 0, am: [], ae: [], z: [], p: '' });
  function encodeDay(d) {
    const f = PRAYERS.map((p) => F_CODE[d.f[p.id]] || '-').join('');
    const s = SUNNA_KEYS.map((k) => (d.s[k] ? '1' : '0')).join('');
    return [d.t + f + s, d.q || 0, d.w || 0, (d.am || []).join('.'), (d.ae || []).join('.'), (d.z || []).join('.'), P_CODE[d.p] || '', d.u ? Math.round(d.u / 1000).toString(36) : ''].join('|');
  }
  function decodeDay(str) {
    const d = blankDay();
    try {
      const parts = String(str).split('|');
      const head = parts[0] || '';
      d.t = head[0] || 'n';
      PRAYERS.forEach((p, i) => { const c = head[1 + i]; if (F_DECODE[c]) d.f[p.id] = F_DECODE[c]; });
      SUNNA_KEYS.forEach((k, i) => { if (head[6 + i] === '1') d.s[k] = 1; });
      d.q = +parts[1] || 0; d.w = +parts[2] || 0;
      const nums = (s) => (s ? s.split('.').map((x) => +x || 0) : []);
      d.am = nums(parts[3]); d.ae = nums(parts[4]); d.z = nums(parts[5]);
      d.p = P_DECODE[parts[6]] || '';
      d.u = parts[7] ? (parseInt(parts[7], 36) || 0) * 1000 : 0; // когда день последний раз меняли (для слияния между устройствами)
    } catch (e) {}
    return d;
  }
  const isEmptyDay = (d) => !d || (!Object.keys(d.f).length && !Object.keys(d.s).length && !d.q && !d.w && !(d.am || []).some(Boolean) && !(d.ae || []).some(Boolean) && !(d.z || []).some(Boolean) && !d.p && d.t === 'n');
  const halfKey = (k) => 'h_' + k.slice(0, 6) + '_' + (+k.slice(6, 8) <= 15 ? '1' : '2');
  const getDay = (k) => S.days[k] || blankDay();
  const ensureDay = (k) => { if (!S.days[k]) S.days[k] = blankDay(); return S.days[k]; };

  /* ===== план и баллы ===== */
  function planFor(k) {
    const d = getDay(k), lvl = S.set.level || 'ihsan';
    const p = { fajrSunna: 1, fajrAzkar: 1, duha: 1, dhuhrBefore: 1, dhuhrAfter: 1, dhuhrAzkar: 1, asrAzkar: 1, maghribAfter: 1, maghribAzkar: 1, ishaAfter: 1, ishaAzkar: 1, witr: 1, sadaqa: 1, kahf: 0, ghusl: 0, qiyam: 8, wudu: 5 };
    if (isFriday(k)) { p.dhuhrBefore = 0; p.dhuhrAfter = 0; p.kahf = 1; p.ghusl = 1; }
    if (d.t === 't') Object.assign(p, { duha: 0, dhuhrBefore: 0, dhuhrAfter: 0, maghribAfter: 0, ishaAfter: 0, qiyam: 0, kahf: 0, ghusl: 0 });
    if (d.t === 's') Object.keys(p).forEach((x) => { p[x] = 0; });
    if (lvl === 'start') Object.keys(p).forEach((x) => { p[x] = 0; });
    if (lvl === 'effort') Object.keys(p).forEach((x) => { if (PER_PRAYER_KEYS.indexOf(x) < 0) p[x] = 0; });
    return p;
  }
  const azDone = (d, which) => D.AZKAR[which].every((a, i) => ((which === 'morning' ? d.am : d.ae)[i] || 0) >= a.n);
  function scores(k) {
    const d = S.days[k];
    if (!d || isEmptyDay(d)) return null;
    const lvl = S.set.level || 'ihsan';
    const fard = PRAYERS.reduce((a, p) => a + (W[d.f[p.id]] || 0), 0) / 5;
    const plan = planFor(k);
    const keys = Object.keys(plan).filter((x) => plan[x] > 0);
    const val = (x) => (x === 'qiyam' ? d.q : x === 'wudu' ? d.w : (d.s[x] ? 1 : 0));
    const sunna = keys.length ? keys.reduce((a, x) => a + Math.min(val(x) / plan[x], 1), 0) / keys.length : null;
    const azkar = lvl === 'start' ? null : ((azDone(d, 'morning') ? 1 : 0) + (azDone(d, 'evening') ? 1 : 0)) / 2;
    const zikr = lvl === 'start' ? null : D.ZIKRS.reduce((a, z, i) => a + Math.min((d.z[i] || 0) / 100, 1), 0) / D.ZIKRS.length;
    const parts = [[fard, 0.5], [sunna, 0.2], [azkar, 0.15], [zikr, 0.15]].filter((x) => x[0] !== null);
    const ws = parts.reduce((a, x) => a + x[1], 0);
    const overall = parts.reduce((a, x) => a + x[0] * x[1], 0) / ws;
    return { fard, sunna, azkar, zikr, overall };
  }
  const fardDoneCount = (d) => PRAYERS.filter((p) => d.f[p.id] && d.f[p.id] !== 'missed').length;
  function streak(test) {
    let k = todayKey(), n = 0;
    if (!test(getDay(k), k)) k = addDays(k, -1);
    for (let i = 0; i < 2000; i++) { if (S.days[k] && test(S.days[k], k)) { n++; k = addDays(k, -1); } else break; }
    return n;
  }
  function qadaDebt() { let n = S.set.qadaBase || 0; Object.keys(S.days).forEach((k) => { const d = S.days[k]; PRAYERS.forEach((p) => { if (d.f[p.id] === 'missed') n++; }); }); return Math.max(0, n); }
  function fastDebt() { let n = S.set.fastBase || 0; Object.keys(S.days).forEach((k) => { const p = S.days[k].p; if (p === 'missed') n++; if (p === 'qada') n--; }); return Math.max(0, n); }

  /* ===== хранилище ===== */
  const store = {
    cloud: inTelegram && tg.CloudStorage && ver('6.9'),
    get(keys) {
      return new Promise((res) => {
        if (this.cloud) { try { tg.CloudStorage.getItems(keys, (err, vals) => res(err ? null : (vals || {}))); } catch (e) { res(null); } return; }
        const o = {}; keys.forEach((k) => { try { const v = localStorage.getItem('ibada:' + k); if (v != null) o[k] = v; } catch (e) {} }); res(o);
      });
    },
    keys() {
      return new Promise((res) => {
        if (this.cloud) { tg.CloudStorage.getKeys((err, ks) => res(err ? [] : (ks || []))); return; }
        const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('ibada:') === 0) out.push(k.slice(6)); } } catch (e) {} res(out);
      });
    },
    set(key, val) {
      return new Promise((res) => {
        if (this.cloud) { try { tg.CloudStorage.setItem(key, val, (err, ok) => res(!err && ok !== false)); } catch (e) { res(false); } return; }
        try { localStorage.setItem('ibada:' + key, val); res(true); } catch (e) { res(false); }
      });
    }
  };
  const dirty = {};
  let saveTimer = null, firstDirty = 0, flushing = null, saveFails = 0;
  function saveLocal(k, slow) { dirty[halfKey(k)] = true; dataVer++; schedule(slow ? 1500 : 350); gamCheckSoon(); }
  function saveGam() { dirty.gam = true; schedule(); }
  const nowSec = () => Math.round(Date.now() / 1000) * 1000;
  function saveDay(k, slow) { const d = S.days[k]; if (d) d.u = nowSec(); saveLocal(k, slow); markPending(k); }
  function saveSettings() { dirty.settings = true; schedule(); }
  function resched() { if (!S.set.syncUrl || !inTelegram) return; clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 1500); }
  function timesChanged() { saveSettings(); render(); resched(); }
  // Сохранение не чаще раза в ~1,5 с во время тасбиха, но не реже раза в 5 с, и сразу при сворачивании
  function schedule(ms) {
    if (!firstDirty) firstDirty = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, Math.max(0, Math.min(ms || 350, 5000 - (Date.now() - firstDirty))));
  }
  function halfObj(hk) {
    const prefix = hk.slice(2, 8), half = hk.slice(9), obj = {};
    Object.keys(S.days).forEach((k) => {
      if (k.slice(0, 6) !== prefix) return;
      const dd = +k.slice(6, 8);
      if ((half === '1') !== (dd <= 15)) return;
      if (!isEmptyDay(S.days[k])) obj[k.slice(6, 8)] = encodeDay(S.days[k]);
    });
    return obj;
  }
  /* Слияние с облаком (несколько устройств). У дня есть u — когда его меняли, и b — какую версию из облака мы видели последней.
     Облако не менялось с тех пор (u ≤ b) — оставляем своё. Менялось только в облаке — берём облачное.
     Менялось и там, и здесь — объединяем отметки: статусы и галочки складываются, счётчики (зикры, азкары) берутся большими. */
  function unionDay(a, c) {
    const d = { t: a.t !== 'n' ? a.t : c.t, f: Object.assign({}, c.f, a.f), s: Object.assign({}, c.s, a.s), q: Math.max(a.q || 0, c.q || 0), w: Math.max(a.w || 0, c.w || 0), p: a.p || c.p || '' };
    ['am', 'ae', 'z'].forEach((f) => { const x = a[f] || [], y = c[f] || []; d[f] = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => Math.max(x[i] || 0, y[i] || 0)); });
    d.u = Math.max(a.u || 0, c.u || 0); d.b = c.u || 0;
    return d;
  }
  function adoptNewer(hk, raw) {
    let obj = {}, changed = false;
    try { obj = raw ? JSON.parse(raw) || {} : {}; } catch (e) { return false; }
    const prefix = hk.slice(2, 8);
    Object.keys(obj).forEach((dd) => {
      const k = prefix + dd, cd = decodeDay(obj[dd]), ld = S.days[k];
      cd.b = cd.u || 0;
      if (!ld) { S.days[k] = cd; changed = true; return; }
      if ((cd.u || 0) <= (ld.b || 0)) return;                       // в облаке ничего нового
      if ((ld.u || 0) <= (ld.b || 0)) { S.days[k] = cd; changed = true; return; } // здесь ничего не меняли
      S.days[k] = unionDay(ld, cd); changed = true;                  // меняли в обоих местах
    });
    return changed;
  }
  async function flush(fast) {
    clearTimeout(saveTimer); firstDirty = 0;
    if (flushing) { try { await flushing; } catch (e) {} }
    const keys = Object.keys(dirty);
    if (!keys.length) return;
    keys.forEach((hk) => { delete dirty[hk]; });
    let adopted = false, failed = false;
    flushing = (async () => {
      for (const hk of keys) {
        let ok;
        if (hk === 'settings') ok = await store.set('settings', JSON.stringify(S.set));
        else if (hk === 'gam') ok = await store.set('gam', JSON.stringify(S.gam));
        else if (hk === 'read') ok = await store.set('read', S.read ? JSON.stringify(S.read) : '');
        else if (hk === 'qg' || hk === 'hz') ok = await store.set(hk, JSON.stringify(S[hk]));
        else {
          if (!fast) {
            const cur = await store.get([hk]);
            if (cur === null) { dirty[hk] = true; failed = true; continue; } // облако не ответило — не пишем вслепую
            if (adoptNewer(hk, cur[hk])) adopted = true;
          }
          const ho = halfObj(hk);
          ok = await store.set(hk, JSON.stringify(ho));
          if (ok) Object.keys(ho).forEach((dd) => { const d = S.days[hk.slice(2, 8) + dd]; if (d) d.b = d.u || 0; });
        }
        if (!ok) { dirty[hk] = true; failed = true; }
      }
    })();
    try { await flushing; } finally { flushing = null; }
    if (failed) {
      saveFails++;
      if (saveFails === 3) toast('Облако Telegram не отвечает — сохраню, когда появится связь');
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, Math.min(30000, 1500 * saveFails));
    } else saveFails = 0;
    if (adopted) { dataVer++; render(); }
  }
  // При возвращении в приложение подтягиваем изменения, сделанные на другом устройстве
  async function refreshFromCloud() {
    if (!S.loaded) return;
    const t = todayKey(), recent = [halfKey(t), halfKey(addDays(t, -16)), halfKey(addDays(t, -32))];
    const vals = await store.get(recent.concat(['read', 'settings', 'qg', 'hz']));
    if (!vals) return;
    let changed = false;
    recent.forEach((hk) => { if (vals[hk] && adoptNewer(hk, vals[hk])) changed = true; });
    if (vals.read) { try { const r = JSON.parse(vals.read); if (r && (!S.read || (r.u || 0) > (S.read.u || 0))) { S.read = r; changed = true; } } catch (e) {} }
    [['qg', 'g'], ['hz', 's']].forEach((x) => { if (!vals[x[0]] || dirty[x[0]]) return; try { const v = JSON.parse(vals[x[0]]); if (v && v[x[1]] && (v.u || 0) > (S[x[0]].u || 0)) { S[x[0]] = x[0] === 'hz' ? Object.assign({ rv: null }, v) : v; changed = true; } } catch (e) {} });
    if (vals.settings) { try { const cs = JSON.parse(vals.settings); (cs.pending || []).forEach((k) => { const p = S.set.pending || (S.set.pending = []); if (p.indexOf(k) < 0) p.push(k); }); } catch (e) {} }
    if (changed) { dataVer++; render(); }
  }
  async function loadAll() {
    try {
      let ks = await store.keys();
      if (!ks.length) { await new Promise((r) => setTimeout(r, 600)); ks = await store.keys(); }
      const want = ks.filter((k) => k === 'settings' || k === 'gam' || k === 'read' || k === 'qg' || k === 'hz' || k.indexOf('h_') === 0);
      const vals = {};
      for (let i = 0; i < want.length; i += 50) {
        let part = await store.get(want.slice(i, i + 50));
        for (let a = 0; part === null && a < 3; a++) { await new Promise((r) => setTimeout(r, 800 * (a + 1))); part = await store.get(want.slice(i, i + 50)); }
        if (part === null) { S.loadFailed = true; continue; }
        Object.assign(vals, part);
      }
      if (vals.settings) { try { S.set = Object.assign({}, DEFAULT_SET, JSON.parse(vals.settings)); } catch (e) {} }
      if (vals.read) { try { S.read = JSON.parse(vals.read) || null; } catch (e) {} }
      if (vals.qg) { try { const v = JSON.parse(vals.qg); if (v && Array.isArray(v.g)) S.qg = v; } catch (e) {} }
      if (vals.hz) { try { const v = JSON.parse(vals.hz); if (v && v.s) S.hz = Object.assign({ rv: null }, v); } catch (e) {} }
      if (vals.gam) { try { S.gam = Object.assign({}, S.gam, JSON.parse(vals.gam)); S.gam.seen = S.gam.seen || {}; } catch (e) {} }
      Object.keys(vals).forEach((hk) => {
        if (hk.indexOf('h_') !== 0) return;
        let obj = {}; try { obj = JSON.parse(vals[hk]) || {}; } catch (e) {}
        const prefix = hk.slice(2, 8);
        Object.keys(obj).forEach((dd) => { const d = decodeDay(obj[dd]); d.b = d.u || 0; S.days[prefix + dd] = d; });
      });
    } catch (e) {}
  }

  /* ===== синхронизация с Google-таблицей и ботом =====
     Адрес скрипта хранится только в облаке Telegram пользователя, не в коде.
     Скрипт проверяет подпись Telegram (initData) и пускает только владельца. */
  const SYNC_FIRST = '20261017', SYNC_LAST = '20271231';
  const sync = { busy: false, timer: null, status: '', ver: {} };
  const canSync = () => !!(S.set.syncUrl && inTelegram && tg.initData);
  function markPending(k) {
    if (!S.set.syncUrl || k < SYNC_FIRST || k > SYNC_LAST) return;
    const p = S.set.pending || (S.set.pending = []);
    if (p.indexOf(k) < 0) { p.push(k); saveSettings(); }
    sync.ver[k] = (sync.ver[k] || 0) + 1;
    clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 2500);
  }
  function tzOffsetMs(date) {
    const tz = S.set.tz; if (!tz) return -date.getTimezoneOffset() * 60000;
    try {
      const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).forEach((x) => { o[x.type] = x.value; });
      return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(date.getTime() / 1000) * 1000;
    } catch (e) { return -date.getTimezoneOffset() * 60000; }
  }
  function localTimeMs(k, hm) { const p = parseKey(k), x = String(hm || '21:30').split(':'); const guess = Date.UTC(p.y, p.m - 1, p.d, +x[0], +x[1]); return guess - tzOffsetMs(new Date(guess)); }
  function buildSchedule() {
    if (S.set.lat == null) return null;
    const t = todayKey(), days = [];
    for (let i = -1; i < 7; i++) {
      const k = addDays(t, i), T = prayerTimes(k); if (!T) continue;
      const nf = fastingInfo(addDays(k, 1));
      const iq = {}; PRAYERS.forEach((p) => { const x = iqamaTime(k, p.id, T); if (x) iq[p.id] = +x; });
      days.push({ k, fajr: +T.fajr, sunrise: +T.sunrise, dhuhr: +T.dhuhr, asr: +T.asr, maghrib: +T.maghrib, isha: +T.isha, iq, fri: isFriday(k), summary: localTimeMs(k, (S.set.remind || {}).summaryTime), fastTomorrow: nf && nf.kind === 'rec' ? nf.text : '' });
    }
    return { tz: S.set.tz || (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), days };
  }
  function dayPayload(k) { const d = getDay(k); return { t: d.t, f: d.f, s: d.s, q: d.q || 0, w: d.w || 0, am: azDone(d, 'morning'), ae: azDone(d, 'evening'), z: (d.z || []).slice(0, 8), p: d.p || '' }; }
  async function postSync(body) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(S.set.syncUrl, { method: 'POST', body: JSON.stringify(Object.assign({ initData: tg.initData }, body)), signal: ctrl.signal, redirect: 'follow' });
      return await r.json();
    } finally { clearTimeout(to); }
  }
  function mergeDay(k, sd, union) {
    const d = ensureDay(k), before = encodeDay(Object.assign({}, d, { u: 0 }));
    if (union) {
      if (d.t === 'n' && sd.t !== 'n') d.t = sd.t;
      PRAYERS.forEach((p) => { if (!d.f[p.id] && sd.f[p.id]) d.f[p.id] = sd.f[p.id]; });
      Object.keys(sd.s || {}).forEach((x) => { d.s[x] = 1; });
      d.q = Math.max(d.q || 0, sd.q || 0); d.w = Math.max(d.w || 0, sd.w || 0);
      (sd.z || []).forEach((n, i) => { d.z[i] = Math.max(d.z[i] || 0, n || 0); });
      if (!d.p && sd.p) d.p = sd.p;
    } else {
      d.t = sd.t || 'n';
      PRAYERS.forEach((p) => { if (sd.f[p.id]) d.f[p.id] = sd.f[p.id]; else delete d.f[p.id]; });
      SUNNA_KEYS.forEach((x) => { if ((sd.s || {})[x]) d.s[x] = 1; else delete d.s[x]; });
      d.q = sd.q || 0; d.w = sd.w || 0;
      d.z = (sd.z || []).slice(0, 8);
      d.p = sd.p || '';
    }
    if (sd.am && !azDone(d, 'morning')) d.am = D.AZKAR.morning.map((a) => a.n);
    if (sd.ae && !azDone(d, 'evening')) d.ae = D.AZKAR.evening.map((a) => a.n);
    if (encodeDay(Object.assign({}, d, { u: 0 })) !== before) { d.u = nowSec(); saveLocal(k); }
  }
  async function syncNow(withPull) {
    if (!canSync() || sync.busy) return;
    sync.busy = true;
    const first = !S.set.lastSync;
    const snap = {};
    (S.set.pending || []).forEach((k) => { snap[k] = sync.ver[k] || 0; });
    const days = {};
    Object.keys(snap).forEach((k) => { days[k] = dayPayload(k); });
    const body = { schedule: buildSchedule(), remind: S.set.remind };
    if (Object.keys(days).length && !first) body.days = days;
    if (withPull || first) { const from = addDays(todayKey(), -60); body.pull = { from: from < SYNC_FIRST ? SYNC_FIRST : from, to: todayKey() }; }
    try {
      const r = await postSync(body);
      if (!r || !r.ok) {
        sync.status = r && r.error === 'auth' ? 'Нет доступа. Проверьте BOT_TOKEN и OWNER_ID в свойствах скрипта.' : 'Ошибка таблицы: ' + ((r && r.error) || 'нет ответа');
      } else {
        const saved = {}; (r.saved || []).forEach((k) => { saved[k] = 1; });
        S.set.pending = (S.set.pending || []).filter((k) => !(saved[k] && (sync.ver[k] || 0) === snap[k]));
        if (r.days) {
          Object.keys(r.days).forEach((k) => {
            if (!first && (S.set.pending || []).indexOf(k) >= 0) return;
            mergeDay(k, r.days[k], first);
          });
        }
        if (first) {
          // первое подключение: объединили данные, теперь отправляем объединённое обратно
          const all = {};
          Object.keys(S.days).forEach((k) => { if (k >= SYNC_FIRST && k <= SYNC_LAST && k <= todayKey() && !isEmptyDay(S.days[k])) all[k] = dayPayload(k); });
          const r2 = Object.keys(all).length ? await postSync({ days: all }) : { ok: true };
          if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || 'push');
          S.set.pending = [];
        }
        S.set.lastSync = Date.now();
        sync.status = 'ok';
        if ((S.set.pending || []).length) { clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 3000); }
      }
    } catch (e) {
      sync.status = 'Нет связи с таблицей. Проверьте адрес и интернет.';
    }
    sync.busy = false;
    saveSettings();
    render();
  }

  /* ===== иконки ===== */
  const I = {
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    checkSm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:.75"><path d="m7 10 5 5 5-5"/></svg>',
    chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    minus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>',
    moon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/></svg>',
    pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bookmark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    bookmarkOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    // статусы: у каждого своя форма, не только цвет
    st: {
      none: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="2.2 3.2"/></svg>',
      mosque: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16M6.5 20v-5.5a5.5 5.5 0 0 1 11 0V20M12 9V5.5"/><circle cx="12" cy="4.2" r="1.2" fill="currentColor" stroke="none"/></svg>',
      juma: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16M6.5 20v-5.5a5.5 5.5 0 0 1 11 0V20M12 9V6.5"/><path d="M12 2.2l1.1 1.9-1.1 1.9-1.1-1.9z" fill="currentColor" stroke="none"/></svg>',
      jamaat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 19h16"/><circle cx="6.5" cy="13.5" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="13.5" r="1.9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13.5" r="1.9" fill="currentColor" stroke="none"/><path d="M5 8.5c4.5-3 9.5-3 14 0"/></svg>',
      done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
      qada: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.2h-4.2"/></svg>',
      missed: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/></svg>'
    },
    fin: '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="8" y="8" width="12" height="12" fill="var(--bg)"/><rect x="8" y="8" width="12" height="12" transform="rotate(45 14 14)" fill="var(--bg)"/><rect x="8" y="8" width="12" height="12"/><circle cx="14" cy="14" r="2.2" fill="currentColor" stroke="none"/></svg>',
    finMoon: '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M17.5 5.5a9 9 0 1 0 5 13.6A7.2 7.2 0 1 1 17.5 5.5z" fill="currentColor"/></svg>',
    spark: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0l1.4 4.6L12 6 7.4 7.4 6 12 4.6 7.4 0 6l4.6-1.4z" fill="currentColor"/></svg>',
    star8: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="var(--gold)" stroke-width="1.1" aria-hidden="true"><rect x="9" y="9" width="22" height="22"/><rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/></svg>',
    g: {
      fajr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 8V5M5.8 11.2 4.4 9.8M18.2 11.2l1.4-1.4"/></svg>',
      dhuhr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
      asr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M3 19h18M12 4v2M5.6 7.6 7 9M18.4 7.6 17 9"/></svg>',
      maghrib: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v5M9.5 7 12 9.5 14.5 7"/></svg>',
      isha: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/></svg>'
    },
    tab: {
      home: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21v-9a6 6 0 0 1 12 0v9M3.5 21h17M12 6V3M10 21v-4a2 2 0 0 1 4 0v4"/></svg>',
      quran: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/></svg>',
      zikr: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="10.5" r="6.5" stroke-width="3" stroke-dasharray="0.1 3.3"/><path d="M12 17v4" stroke-width="1.7"/></svg>',
      progress: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 20h16M7 16v-4M12 16V8M17 16v-6"/></svg>',
      more: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>'
    }
  };
  const ring = (v, size, r, sw, color) => {
    const C = 2 * Math.PI * r, dash = (clamp(v || 0, 0, 1) * C).toFixed(1);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="' + sw + '"/>' + (v > 0.005 ? '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (color || 'var(--gold)') + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' : '') + '</svg>';
  };

  /* ===== экраны ===== */
  function vOnboarding() {
    const lv = [
      ['start', 'Начало', 'просто', 'Только пять намазов: одно касание — и отмечено. Время, кибла, Коран.'],
      ['effort', 'Усердие', 'больше', 'Статусы намазов, сунна при каждом намазе, азкары и тасбих.'],
      ['ihsan', 'Ихсан', 'полный учёт', 'Джамаат и мечеть, каза-долг, посты, тип дня, зикры по плану, итог дня и серии.']
    ];
    return '<div class="onb-arch"><svg width="280" height="248" viewBox="0 0 280 248" aria-hidden="true">' +
      '<g fill="#fff"><circle cx="70" cy="70" r="1.2" opacity=".8"/><circle cx="104" cy="42" r=".9" opacity=".6"/><circle cx="206" cy="58" r="1.1" opacity=".7"/><circle cx="230" cy="110" r=".8" opacity=".5"/><circle cx="52" cy="128" r=".9" opacity=".5"/><circle cx="150" cy="30" r=".8" opacity=".6"/></g>' +
      '<g fill="none" stroke="#E6BE6E" stroke-width="1" opacity=".18" transform="translate(140 118)"><rect x="-70" y="-70" width="140" height="140"/><rect x="-70" y="-70" width="140" height="140" transform="rotate(45)"/><circle r="46"/></g>' +
      '<path d="M176 64a26 26 0 1 0 20 42 21 21 0 1 1-20-42z" fill="#F2D38E"/>' +
      '<g fill="#070B16"><path d="M0 248V214h44v34z"/><path d="M58 248v-58h6v-10l4-8 4 8v10h6v58z"/><path d="M86 248v-30c0-26 24-40 54-48 30 8 54 22 54 48v30z"/><path d="M136 170v-14l4-6 4 6v14z"/><path d="M202 248v-58h6v-10l4-8 4 8v10h6v58z"/><path d="M236 248V220h44v28z"/></g></svg></div>' +
      '<div style="text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center"><h1 class="h1" style="font-size:48px">Ибада</h1><p class="sub" style="margin:0;font-size:15px;line-height:1.5;max-width:320px">Время намазов, Коран, азкары и тасбих — и честный учёт вашего поклонения</p></div>' +
      '<div class="eyebrow" style="margin-top:4px">С чего начнём?</div>' +
      lv.map((l) => '<button class="level' + (S.onbLevel === l[0] ? ' on' : '') + '" data-a="onbLevel" data-v="' + l[0] + '" aria-pressed="' + (S.onbLevel === l[0]) + '"><span class="col grow" style="gap:4px"><span class="row" style="gap:8px;align-items:baseline"><span style="font-family:var(--serif);font-size:24px;font-weight:600;line-height:1.1">' + l[1] + '</span><span class="small sub" style="font-weight:700">' + l[2] + '</span></span><span style="font-size:13.5px;line-height:1.45" class="sub">' + l[3] + '</span></span><span class="radio">' + (S.onbLevel === l[0] ? I.checkSm : '') + '</span></button>').join('') +
      '<button class="btn gold block" data-a="onbStart" style="min-height:56px;font-size:16px;margin-top:4px">Начать</button>' +
      '<div class="small sub" style="text-align:center">Уровень можно сменить в любой момент. Без рекламы и регистрации.</div>';
  }

  function dayNote(k) {
    const h = hijri(k);
    if (h.m === 9) return 'Рамадан · ' + h.d + '-й день' + (h.d >= 20 ? ' · последние десять ночей' : '');
    if (h.m === 10 && h.d === 1) return 'Ид аль-Фитр мубарак';
    if (h.m === 12 && h.d === 10) return 'Ид аль-Адха мубарак';
    if (h.m === 12 && h.d >= 11 && h.d <= 13) return 'Дни ташрика';
    if (h.m === 12 && h.d <= 9) return 'Первые десять дней зуль-хиджжа';
    if (isFriday(k)) return 'Джума мубарак';
    const f = fastingInfo(k);
    if (f && f.kind === 'rec' && !/Понедельник|Четверг/.test(f.text)) return f.text + ' · желательный пост';
    return '';
  }
  /* ===== Ибада 2.0: экран «Сегодня» =====
     Три блока: карточка текущего намаза (единственное место, где есть небо), пять намазов с одной отметкой и «Сегодня ещё».
     Подробности намаза (статус и сунна) открываются по нажатию на строку. */
  const NM = (k, id) => (id === 'dhuhr' && isFriday(k) ? 'Джума' : PRAYERS.find((p) => p.id === id).name);
  const NM_ACC = (k, id) => (id === 'dhuhr' && isFriday(k) ? 'Джуму' : NM(k, id)); // «Отметить Джуму»
  const ST_SHORT = { mosque: 'в мечети', jamaat: 'джамаатом', juma: 'в мечети', done: 'совершён', qada: 'восполнен', missed: 'пропущен' };
  const SUNNA_FULL = {
    fajrSunna: ['Сунна до намаза', '2 ракаата'], fajrAzkar: ['Азкары после намаза', ''],
    dhuhrBefore: ['Сунна до намаза', '4 ракаата'], dhuhrAfter: ['Сунна после намаза', '2 ракаата'], dhuhrAzkar: ['Азкары после намаза', ''],
    asrAzkar: ['Азкары после намаза', ''], maghribAfter: ['Сунна после намаза', '2 ракаата'], maghribAzkar: ['Азкары после намаза', ''],
    ishaAfter: ['Сунна после намаза', '2 ракаата'], ishaAzkar: ['Азкары после намаза', '']
  };
  function skyOpts() {
    const h = hijri(todayKey());
    return { lat: S.set.lat != null ? S.set.lat : 40, lng: S.set.lng != null ? S.set.lng : -new Date().getTimezoneOffset() / 4, ten: h.m === 9 && h.d >= 20, fixed: S.set.sky === 'night' || S.set.sky === 'day' ? S.set.sky : '' };
  }
  function heroSky() {
    const st = window.IbadaSky && window.IbadaSky.card ? window.IbadaSky.card(skyOpts()) : null;
    if (!st) return '<span class="hs" aria-hidden="true" style="background:linear-gradient(180deg,#0D1838 0%,#1E2A55 100%)"><span class="hs-veil"></span></span>';
    return '<span class="hs" aria-hidden="true" style="background:linear-gradient(180deg,' + st.c[0] + ' 0%,' + st.c[1] + ' 58%,' + st.c[2] + ' 100%)">' +
      (st.starsSvg ? '<span class="hs-stars" style="opacity:' + st.stars + '">' + st.starsSvg + '</span>' : '') +
      (st.glow ? '<span class="hs-sun' + (st.glow.low ? ' low' : '') + '" style="left:' + (st.glow.x * 100).toFixed(1) + '%;top:' + (st.glow.y * 100).toFixed(1) + '%;opacity:' + st.glow.op.toFixed(2) + '"></span>' : '') +
      (st.moon ? '<span class="hs-moon">' + st.moon + '</span>' : '') + '<span class="hs-veil"></span></span>';
  }
  // Дуга дня: пять намазов на равных местах, точка — «сейчас» между ними
  function heroArc2(k, sk) {
    const ids = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'], T = sk.T, now = sk.now;
    const X0 = 14, X1 = 336, Y = (x) => 60 - 50 * Math.sin(Math.PI * (x - X0) / (X1 - X0)), mx = (i) => 35 + i * 70;
    let nx;
    if (now < T.fajr) nx = X0 + 8;
    else if (now >= T.isha) nx = Math.min(X1 - 4, mx(4) + 12);
    else { let i = 0; while (i < 3 && now >= T[ids[i + 1]]) i++; nx = mx(i) + 70 * clamp((now - T[ids[i]]) / (T[ids[i + 1]] - T[ids[i]]), 0, 1); }
    const path = (a, b) => { let s = 'M' + a.toFixed(1) + ' ' + Y(a).toFixed(1); for (let x = a + 6; x < b; x += 6) s += 'L' + x.toFixed(1) + ' ' + Y(x).toFixed(1); return s + 'L' + b.toFixed(1) + ' ' + Y(b).toFixed(1); };
    const marks = ids.map((id, i) => { const x = mx(i), past = now >= T[id]; return '<circle cx="' + x + '" cy="' + Y(x).toFixed(1) + '" r="4" ' + (past ? 'fill="#fff"' : 'fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"') + '/>'; }).join('');
    const night = now < T.fajr || now >= T.maghrib;
    return '<svg class="h-arc" viewBox="0 0 350 66" aria-hidden="true"><path d="' + path(X0, X1) + '" fill="none" stroke="#fff" stroke-opacity=".36" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/>' +
      (nx > X0 + 1 ? '<path d="' + path(X0, nx) + '" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' : '') + marks +
      '<circle cx="' + nx.toFixed(1) + '" cy="' + Y(nx).toFixed(1) + '" r="9" fill="' + (night ? 'rgba(233,236,247,.25)' : 'rgba(255,243,207,.35)') + '"/><circle cx="' + nx.toFixed(1) + '" cy="' + Y(nx).toFixed(1) + '" r="6" fill="' + (night ? '#E9ECF7' : '#FFF3CF') + '" stroke="#fff" stroke-width="2"/></svg>' +
      '<div class="h-lbl">' + ids.map((id) => '<span' + (sk.current === id ? ' class="on"' : '') + '>' + NM(k, id) + '<b class="num">' + fmtTime(T[id]) + '</b></span>').join('') + '</div>';
  }
  function vHero2(k, d) {
    const sk = skyState();
    if (!sk) {
      return '<section class="hero2" aria-label="Время намазов">' + heroSky() + '<span class="h-eb">Время намазов</span><span class="h-name">Где вы?</span><span class="h-line">Укажите город — приложение рассчитает время намазов и киблу</span>' +
        '<div class="h-act"><button class="btn white block" data-a="locate">' + I.pin + 'Определить автоматически</button><button class="btn glass block" data-a="sheet" data-v="city">Выбрать город</button></div></section>';
    }
    const lvl = S.set.level, detailed = S.set.detailed && lvl !== 'start';
    const cur = sk.current, curSt = cur ? d.f[cur] : null;
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const endOf = (id) => (id === 'fajr' ? sk.T.sunrise : id === 'isha' ? sk.nextTime : sk.T[order[order.indexOf(id) + 1]]);
    const iqLine = (id) => { const q = iqamaTime(k, id, sk.T); return q && q > sk.now ? ' · икама ' + fmtTime(q) : ''; };
    let ram = '';
    const h = hijri(k);
    if (h.m === 9) { const after = sk.now >= sk.T.maghrib, T2 = after ? prayerTimes(addDays(k, 1)) : sk.T; if (T2) ram = '<span class="h-ram num">Сухур до ' + fmtTime(T2.fajr) + ' · ифтар ' + fmtTime(T2.maghrib) + (after ? ' · завтра' : '') + '</span>'; }
    let top, act;
    if (cur && !curSt) {
      const end = endOf(cur);
      top = '<span class="h-eb">Сейчас</span><span class="h-name">' + NM(k, cur) + '</span><span class="h-line num">Осталось ' + untilText(end - sk.now) + ' · до ' + fmtTime(end) + iqLine(cur) + '</span>';
      act = '<button class="btn white block h-main" data-a="' + (detailed ? 'sheet' : 'quick') + '" data-v="' + (detailed ? 'status:' : '') + cur + '">' + I.check + 'Отметить ' + NM_ACC(k, cur) + '</button>';
    } else {
      const nx = sk.next;
      top = '<span class="h-eb">' + (!cur && lvl !== 'start' ? 'Время духа · далее' : 'Далее') + '</span><span class="h-name">' + NM(nx.id === 'fajr' && sk.now > sk.T.isha ? addDays(k, 1) : k, nx.id) + '</span><span class="h-line num">Через ' + untilText(sk.nextTime - sk.now) + ' · в ' + fmtTime(sk.nextTime) + iqLine(nx.id) + '</span>';
      if (cur && curSt) act = '<button class="h-chip" data-a="sheet" data-v="status:' + cur + '" aria-label="' + NM(k, cur) + ': ' + ST_SHORT[curSt] + '. Изменить"><span class="ck2 st-' + curSt + '">' + I.st[curSt] + '</span>' + NM(k, cur) + ' · ' + ST_SHORT[curSt] + '</button>';
      else if (!cur && planFor(k).duha > 0) act = '<button class="h-chip" data-a="sunna" data-v="duha" aria-pressed="' + !!d.s.duha + '"><span class="ck2' + (d.s.duha ? ' st-done' : '') + '">' + (d.s.duha ? I.st.done : '') + '</span>' + (d.s.duha ? 'Духа-намаз совершён' : 'Отметить духа-намаз') + '</button>';
      else act = '<span class="h-hint">' + (cur ? '' : 'Время между восходом и Зухром') + '</span>';
    }
    return '<section class="hero2" aria-label="Текущий намаз">' + heroSky() + top + ram + heroArc2(k, sk) + '<div class="h-act">' + act + '</div></section>';
  }

  function prRow(k, pr, d, T, sk, detailed, plan) {
    const st = d.f[pr.id], now = !!(sk && sk.current === pr.id);
    const name = pr.id === 'dhuhr' && isFriday(k) ? (st === 'juma' ? 'Джума' : st ? 'Зухр' : 'Зухр / Джума') : pr.name;
    const meta = [];
    if (T) meta.push(fmtTime(T[pr.id]));
    if (st) meta.push(ST_SHORT[st]);
    else if (now && T) { const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'], i = order.indexOf(pr.id); const end = pr.id === 'fajr' ? T.sunrise : pr.id === 'isha' ? sk.nextTime : T[order[i + 1]]; if (end) meta.push('до ' + fmtTime(end)); }
    else { const iq = T ? iqamaTime(k, pr.id, T) : null; meta.push(iq ? 'икама ' + fmtTime(iq) : pr.rak); }
    const subs = detailed ? PER_PRAYER[pr.id].filter((x) => plan[x[0]] > 0) : [];
    const subsOn = subs.filter((x) => d.s[x[0]]).length;
    if (subsOn) meta.push('сунна ' + subsOn + ' из ' + subs.length);
    const label = name + ': ' + (st ? ST_SHORT[st] : 'не отмечен') + (detailed ? '. Открыть' : st && st !== 'missed' ? '. Снять отметку' : '. Отметить');
    return '<button class="pr2' + (now ? ' now' : '') + '" data-id="' + pr.id + '" data-a="' + (detailed ? 'sheet' : 'quick') + '" data-v="' + (detailed ? 'status:' : '') + pr.id + '" aria-label="' + label + '">' +
      '<span class="pr2-i">' + I.g[pr.id] + '</span><span class="li-c"><span class="li-t">' + name + (now ? '<span class="badge">сейчас</span>' : '') + '</span><span class="li-m num">' + meta.join(' · ') + '</span></span>' +
      '<span class="ck2' + (st ? ' st-' + st : now ? ' now' : '') + '">' + (st ? I.st[st] : '') + '</span></button>';
  }

  function vTodayMore(k, d, plan, lvl, isToday) {
    const rows = []; let n = 0, done = 0;
    // порядок по времени суток: утром выше духа, ночью — витр и киям
    const sk = isToday ? skyState() : null, morning = !!(sk && !sk.current && sk.now >= sk.T.sunrise), night = !!(sk && (sk.now >= sk.T.isha || sk.now < sk.T.fajr));
    const add = (pr, html) => rows.push([pr, rows.length, html]);
    const ck = (on, cls) => '<span class="ck2' + (on ? ' st-done' : cls ? ' ' + cls : '') + '">' + (on ? I.st.done : '') + '</span>';
    const item = (act, val, t, m, right, extra) => '<button class="li" data-a="' + act + '"' + (val !== '' ? ' data-v="' + val + '"' : '') + (extra || '') + '><span class="li-c"><span class="li-t">' + t + '</span>' + (m ? '<span class="li-m">' + m + '</span>' : '') + '</span>' + right + '</button>';
    const meter = (v, frac) => '<span class="li-v"><b class="num">' + v + '</b><i><s style="width:' + Math.round(clamp(frac, 0, 1) * 100) + '%"></s></i></span>';
    const check = (pr, key, t, m) => { if (!(plan[key] > 0)) return; const on = !!d.s[key]; n++; if (on) done++; add(pr, item('sunna', key, t, m, ck(on), ' aria-pressed="' + on + '"')); };
    if (lvl !== 'start') {
      const which = defaultAzTab(), list = D.AZKAR[which], cnt = which === 'morning' ? d.am : d.ae;
      const got = list.filter((a, i) => (cnt[i] || 0) >= a.n).length, all = got === list.length;
      n++; if (all) done++;
      add(10, item('zikr', 'azkar', (which === 'morning' ? 'Утренние' : 'Вечерние') + ' азкары', (which === 'morning' ? 'После Фаджра' : 'После Асра, до Магриба') + (all ? ' · прочитаны' : ''), all ? ck(true) : meter(got + ' из ' + list.length, got / list.length)));
    }
    const st = isToday ? rState() : null;
    if (st && !st.done) {
      const R = st.R, day = tfToday(st), ok = !st.before && st.left === 0;
      let m;
      if (st.before) m = 'Начало ' + fmtDate(R.start) + ' · ' + st.base + ' стр. в день';
      else if (ok) m = 'Норма выполнена · можно читать дальше';
      else m = (day && day.to >= 0 ? ayRange(day.from, day.to) + ' · около ' + readMins(day.from, day.to) + ' мин' : rRange(R, st.pos + 1, st.posStart + st.norm));
      n++; if (ok) done++;
      add(20, item(isSaadi(R) && !st.before ? 'readOpen' : 'sheet', isSaadi(R) && !st.before ? '' : 'read', esc(R.title), m, ok ? ck(true) : st.before ? '<span class="li-v"><b class="num">' + st.base + ' стр.</b></span>' : meter(st.readToday + ' из ' + st.norm + ' стр.', st.readToday / Math.max(1, st.norm))));
    }
    if (isToday) { const qd = qgTodayItems(add, item, ck, meter); n += qd[0]; done += qd[1]; }
    check(30, 'kahf', 'Сура аль-Кахф', 'Сунна пятницы');
    check(31, 'ghusl', 'Гусль', 'Перед пятничным намазом');
    check(morning ? 25 : 40, 'duha', 'Духа-намаз', 'После восхода, до Зухра');
    check(night ? 22 : 50, 'witr', 'Витр-намаз', 'После Иша, до рассвета');
    [['qiyam', 'Киям аль-лейль', 'ракаатов', 2, 20], ['wudu', 'Дуа после омовения', 'раз', 1, 10]].forEach((x) => {
      const goal = plan[x[0]]; if (!(goal > 0)) return;
      const v = x[0] === 'qiyam' ? d.q : d.w, ok = v >= goal; n++; if (ok) done++;
      add(x[0] === 'qiyam' ? (night ? 23 : 55) : 65, '<div class="li"><span class="li-c"><span class="li-t">' + x[1] + '</span><span class="li-m num' + (ok ? ' ok' : '') + '">' + v + ' из ' + goal + ' ' + x[2] + '</span></span><span class="stp"><button class="stp-b" data-a="step" data-v="' + x[0] + ':-' + x[3] + ':' + x[4] + '" aria-label="' + x[1] + ': убавить">' + I.minus + '</button><b class="num">' + v + '</b><button class="stp-b plus" data-a="step" data-v="' + x[0] + ':' + x[3] + ':' + x[4] + '" aria-label="' + x[1] + ': добавить">' + I.plus + '</button></span></div>');
    });
    check(60, 'sadaqa', 'Садака', 'Любое доброе пожертвование');
    if (lvl === 'ihsan') {
      const fi = fastingInfo(k);
      if ((fi && fi.kind !== 'forbidden') || d.p) {
        const lab = { fast: 'Постился', qada: 'Каза поста', missed: 'Пост пропущен' }[d.p];
        const on = d.p === 'fast' || d.p === 'qada';
        add(15, item('sheet', 'fast', 'Пост', lab ? lab + (fi ? ' · ' + fi.text.toLowerCase() : '') : fi.text + (fi.kind === 'rec' ? ' · желательный пост' : ''), d.p === 'missed' ? '<span class="ck2 st-missed">' + I.st.missed + '</span>' : ck(on)));
      }
    }
    if (lvl !== 'start') {
      const z = d.z || [], total = z.reduce((a, b) => a + (b || 0), 0);
      const frac = D.ZIKRS.reduce((a, x, i) => a + Math.min(z[i] || 0, 100), 0) / (D.ZIKRS.length * 100);
      add(35, item('zikr', 'tasbih', 'Зикры', 'Тасбих · по 100 каждого', meter(total + ' ' + plural(total, 'зикр', 'зикра', 'зикров'), frac)));
    }
    if (lvl === 'ihsan') {
      const DT = { n: ['Обычный', 'var(--emerald)', 'Нажмите, если вы в пути или болеете'], t: ['В пути', 'var(--blue)', 'Сунна, кроме главной, не снижает итог'], s: ['Болезнь', 'var(--violet-text)', 'Учитываются фард, азкары и зикры'] }[d.t] || ['Обычный', 'var(--emerald)', ''];
      add(90, item('cycleDay', '', 'Тип дня', DT[2], '<span class="li-tag"><span class="dot" style="background:' + DT[1] + '"></span>' + DT[0] + '</span>', ' aria-label="Тип дня: ' + DT[0] + '. Нажмите, чтобы сменить"'));
    }
    if (!rows.length) return '';
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const html = rows.map((r) => r[2]);
    const LIM = 5, open = S.set.todayAll || rows.length <= LIM + 1;
    const shown = open ? html : html.slice(0, LIM);
    if (rows.length > LIM + 1) shown.push('<button class="li li-more" data-a="todayAll" aria-expanded="' + open + '"><span class="li-c"><span class="li-t">' + (open ? 'Свернуть' : 'Ещё ' + (rows.length - LIM) + ' ' + plural(rows.length - LIM, 'пункт', 'пункта', 'пунктов')) + '</span></span><span class="li-chev' + (open ? ' up' : '') + '">' + I.down + '</span></button>');
    return '<section class="sec" aria-label="Сегодня ещё"><div class="sec-h"><h2 class="h2">' + (isToday ? 'Сегодня ещё' : 'В этот день') + '</h2>' + (n ? '<span class="sec-m num">' + done + ' из ' + n + '</span>' : '') + '</div><div class="card list">' + shown.join('') + '</div></section>';
  }

  function vHome() {
    const k = viewKey(), today = todayKey(), isToday = k === today, d = getDay(k), lvl = S.set.level;
    const sc = scores(k), T = prayerTimes(k), sk = isToday ? skyState() : null, plan = planFor(k);
    const parts = [], p = parseKey(k), v = sc ? Math.min(sc.overall, 1) : 0;
    const note = dayNote(k);
    parts.push('<header class="td-top"><div class="col"><span class="td-date">' + WD_FULL[weekday(k)] + ', ' + fmtDate(k) + (isToday ? '' : ' ' + p.y) + (S.set.city ? ' · ' + esc(S.set.city) : '') + '</span><span class="td-hijri">' + hijriText(k) + '</span>' + (note ? '<span class="dnote">' + I.spark + esc(note) + '</span>' : '') + '</div>' +
      '<button class="td-ring" data-a="tab" data-v="progress" aria-label="Итог дня: ' + Math.round(v * 100) + '%. Открыть прогресс">' + ring(v, 48, 20, 4.5) + '<span class="num">' + Math.round(v * 100) + '%</span></button></header>');
    if (!isToday) parts.push('<button class="card back-day" data-a="backToday"><span class="li-c"><span class="li-t">Вы отмечаете ' + fmtDate(k) + '</span><span class="li-m">Нажмите, чтобы вернуться к сегодняшнему дню</span></span>' + I.chev + '</button>');
    if (isToday) parts.push(vHero2(k, d));
    const detailed = S.set.detailed && lvl !== 'start';
    parts.push('<section class="sec" aria-label="Намазы"><div class="sec-h"><h2 class="h2">Намазы</h2><span class="sec-m num">' + fardDoneCount(d) + ' из 5</span></div><div class="card list">' + PRAYERS.map((pr) => prRow(k, pr, d, T, sk, detailed, plan)).join('') + '</div></section>');
    parts.push(vTodayMore(k, d, plan, lvl, isToday));
    return parts.join('');
  }

  function defaultAzTab() {
    if (S.azTab) return S.azTab;
    const T = prayerTimes(todayKey());
    if (T && new Date() >= T.asr) return 'evening';
    if (T && new Date() < T.fajr) return 'evening';
    return T ? 'morning' : (new Date().getHours() >= 15 ? 'evening' : 'morning');
  }

  function vZikr() {
    const k = viewKey(), d = getDay(k);
    const total = (d.z || []).reduce((a, b) => a + b, 0);
    const out = ['<div class="between" style="padding:0 4px;align-items:flex-end"><h1 class="h1" style="padding:0">Зикр</h1><span class="small sub num" style="font-weight:600;font-size:13px">' + (k === todayKey() ? 'сегодня ' : fmtDate(k) + ' · ') + '<span id="zTotal">' + total + '</span></span></div>',
      '<div class="seg" role="group" aria-label="Раздел">' + [['tasbih', 'Тасбих'], ['azkar', 'Азкары'], ['dua', 'Дуа']].map((v) => '<button class="' + (S.zView === v[0] ? 'on' : '') + '" data-a="zView" data-v="' + v[0] + '" aria-pressed="' + (S.zView === v[0]) + '">' + v[1] + '</button>').join('') + '</div>'];
    if (S.zView === 'tasbih') {
      const z = D.ZIKRS[S.zSel], c = d.z[S.zSel] || 0;
      out.push('<div class="chips" role="group" aria-label="Выбор зикра">' + D.ZIKRS.map((x, i) => '<button class="chip' + (i === S.zSel ? ' on' : '') + '" data-a="zSel" data-v="' + i + '" aria-pressed="' + (i === S.zSel) + '">' + x.short + '</button>').join('') + '</div>');
      out.push('<div style="display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;min-height:112px;justify-content:center"><div class="ar" lang="ar" style="font-size:32px;line-height:1.6;color:var(--gold-hi)">' + z.ar + '</div><div style="font-size:15px;font-weight:800">' + z.ru + '</div><div class="small sub" style="font-size:13px">' + z.tr + '</div></div>');
      out.push('<div class="tasbih" id="tasbih">' + beadsHtml(c) + '<button class="tap" data-a="tap" aria-label="Добавить один зикр"><span class="tap-count num" id="tapCount">' + c + '</span><span class="small" id="tapGoal" style="font-weight:700;color:' + (c >= 100 ? 'var(--gold)' : 'var(--sub)') + '">' + (c >= 100 ? 'цель выполнена' : 'из 100') + '</span></button></div>');
      out.push('<div class="row" style="justify-content:center;gap:10px"><button class="btn ghost sm" data-a="tapUndo">Отменить 1</button><button class="btn ghost sm" data-a="tapReset">Сбросить</button></div>');
      out.push('<div class="z-grid">' + D.ZIKRS.map((x, i) => { const n = d.z[i] || 0; return '<button class="z-cell" data-a="zSel" data-v="' + i + '"><span style="font-size:12.5px;font-weight:700;line-height:1.3;min-height:32px">' + x.short + '</span><span class="num" style="font-size:13px"><b id="zc' + i + '" style="color:' + (n >= 100 ? 'var(--emerald-text)' : 'var(--text)') + '">' + n + '</b><span class="sub"> / 100</span></span><span class="bar"><span id="zb' + i + '" style="width:' + Math.min(n, 100) + '%;background:' + (n >= 100 ? 'var(--emerald)' : 'var(--gold)') + '"></span></span></button>'; }).join('') + '</div>');
    } else if (S.zView === 'azkar') {
      const which = defaultAzTab(), list = D.AZKAR[which], counts = which === 'morning' ? d.am : d.ae;
      const doneN = list.filter((a, i) => (counts[i] || 0) >= a.n).length;
      out.push('<div class="between"><div class="seg mini" role="group" aria-label="Утренние или вечерние"><button class="' + (which === 'morning' ? 'on' : '') + '" data-a="azTab" data-v="morning">Утренние</button><button class="' + (which === 'evening' ? 'on' : '') + '" data-a="azTab" data-v="evening">Вечерние</button></div><span class="small sub num" style="font-weight:700;font-size:13px">' + doneN + ' из ' + list.length + '</span></div>');
      out.push('<div class="between"><span class="small sub" style="font-size:13px;padding:0 4px">' + (which === 'morning' ? 'Читаются после Фаджра' : 'Читаются после Асра, до Магриба') + '</span><button class="btn ghost sm" data-a="azAll">Отметить все</button></div>');
      list.forEach((a, i) => {
        const n = counts[i] || 0, done = n >= a.n;
        out.push('<div class="card zk' + (done ? ' done' : '') + '"><div class="between" style="align-items:flex-start"><span class="col"><span style="font-size:15.5px;font-weight:800">' + a.title + '</span>' + (a.source ? '<span class="small sub">' + a.source + '</span>' : '') + '</span><span class="times">' + times(a.n) + '</span></div><p class="zk-ar" lang="ar">' + a.ar + '</p><p class="zk-ru">' + a.ru + '</p><button class="btn block ' + (done ? '' : 'gold') + '" data-a="az" data-v="' + i + '" style="' + (done ? 'background:var(--emerald-soft);color:var(--emerald-text)' : '') + '">' + (done ? I.check + 'Прочитано' : (a.n === 1 ? 'Прочитал' : 'Прочитал · <span class="num">' + n + ' из ' + a.n + '</span>')) + '</button></div>');
      });
    } else {
      D.DUAS.forEach((g, gi) => {
        out.push('<div class="eyebrow" style="margin-top:6px">' + g.cat + '</div>');
        g.items.forEach((it, ii) => {
          const id = gi + '.' + ii, open = S.duaOpen === id;
          out.push('<div class="card" style="overflow:hidden"><button class="list-row" data-a="dua" data-v="' + id + '" aria-expanded="' + open + '"><span class="star" style="width:32px;height:32px">' + I.star8.replace(/40/g, '32') + '</span><span class="grow" style="font-size:15px;font-weight:800">' + it.title + '</span>' + I.chev + '</button>' + (open ? '<div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px"><p class="zk-ar" lang="ar">' + it.ar + '</p><p class="zk-ru">' + it.ru + '</p></div>' : '') + '</div>');
        });
      });
    }
    return out.join('');
  }
  function beadsHtml(c) {
    const lit = Math.round((Math.min(c, 100) / 100) * 33);
    let h = '';
    for (let i = 0; i < 33; i++) { const a = (-90 + (i * 360) / 33) * Math.PI / 180; h += '<span class="bead' + (i < lit ? ' on' : '') + '" style="left:' + (144 + 126 * Math.cos(a) - 6.5).toFixed(1) + 'px;top:' + (144 + 126 * Math.sin(a) - 6.5).toFixed(1) + 'px"></span>'; }
    return h;
  }

  /* ===== Коран: вкладка и читалка =====
     Арабский текст и шрифт — Комплекс короля Фахда (KFGQPC HAFS Uthmanic Script, версия 18): лежат в самом приложении (quran/, fonts/).
     Текст сверен с двумя независимыми наборами (Kh. Hosny и «Академия Корана») — совпадение по буквам во всех 6 236 аятах.
     Перевод смыслов — Э. Кулиев (api.alquran.cloud, сохраняется на телефоне). Толкование — ас-Саади (блок «тафсир»). */
  const RD_DEF = { bg: 'night', fs: 3, as: 3, font: 'book', ar: true, ru: true, auto: true, full: true, lay: 'book', tap: 'act' };
  const tapTafsir = (R) => R && R.mode !== 'tf' && rd().tap === 'tf' && !!sai(); // нажатие на аят сразу открывает толкование
  const RD_FS = [15, 16.5, 18, 20, 22.5], RD_AS = [24, 27, 30, 34, 38];
  const RD_BG = { night: ['Ночь', '#0C1120'], sepia: ['Сепия', '#F3EBDC'], day: ['День', '#FBFAF7'], sky: ['Небо', ''] };
  const rd = () => Object.assign({}, RD_DEF, S.set.rd || {});
  const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
  const arNoNum = (t) => String(t || '').replace(/ [٠-٩]+$/, '');
  const QI = {
    toc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:.6"><path d="m6 9 6 6 6-6"/></svg>',
    left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    copy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>'
  };
  const STAR = (n) => '<span class="star">' + I.star8 + '<span style="position:relative">' + n + '</span></span>';
  function juzOf(s, a) { let j = 1; for (let i = 0; i < D.JUZ_START.length; i++) { const x = D.JUZ_START[i]; if (x[0] < s || (x[0] === s && x[1] <= a)) j = i + 1; else break; } return j; }
  const pagesLabel = (s) => { const p = D.SURAH_PAGE[s - 1]; return p[0] === p[1] ? 'стр. ' + p[0] : 'стр. ' + p[0] + '–' + p[1]; };
  const ayahsLabel = (n) => n + ' ' + plural(n, 'аят', 'аята', 'аятов');

  function tfPlan() { // состояние плана тафсира ас-Саади, если он есть
    const P = S.read;
    if (!isSaadi(P)) return null;
    const st = rState();
    return st ? { P, st, cur: readG(P), day: tfToday(st) } : null;
  }
  const readMins = (g1, g2) => { const X = sai(); return X && g2 >= g1 ? Math.max(1, Math.round((X.cum[g2 + 1] - X.cum[g1]) * 10 / 1100)) : 0; };
  function surahTf(s, cur) { // доля прочитанного толкования суры
    const X = sai(); if (!X || cur < 0) return 0;
    const g0 = X.st[s - 1], g1 = g0 + D.SURAH_AYAHS[s - 1] - 1;
    if (cur < g0) return 0;
    if (cur >= g1) return 1;
    return (X.cum[cur + 1] - X.cum[g0]) / Math.max(1, X.cum[g1 + 1] - X.cum[g0]);
  }
  function ringSvg(size, frac, done, inner) {
    const r = size / 2 - (size > 60 ? 6 : 4), C = 2 * Math.PI * r, w = size > 60 ? 6 : 4.5;
    return '<span class="qring" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + w + '" class="qring-t"/><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + w + '" class="qring-v' + (done ? ' done' : '') + '" stroke-dasharray="' + (C * clamp(frac, 0, 1)).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg><span class="qring-l">' + inner + '</span></span>';
  }

  /* ----- вкладка «Коран» ----- */
  function vQuran() {
    const Q = S.quran;
    if (Q.reader) return vReader();
    const out = ['<h1 class="h1">Коран</h1>'];
    const tp = tfPlan();
    if (tp && !tp.st.done) {
      const st = tp.st, ok = !st.before && st.left === 0;
      const next = Math.min(tp.cur + 1, sai().n - 1), nx = gAyah(next);
      const to = tp.day && tp.day.to >= 0 ? tp.day.to : -1, tx = to >= 0 ? gAyah(to) : null;
      const title = st.before ? 'План начнётся ' + fmtDate(tp.P.start) : ok ? 'Норма на сегодня выполнена' : tp.cur >= 0 ? 'Продолжить с ' + D.SURAH_RU[nx[0] - 1] + ', ' + nx[1] : 'Начать с суры «Аль-Фатиха»';
      const sub = st.before ? 'Первая норма — ' + st.base + ' стр.' : ok ? 'МашаАллах. Можно читать дальше — завтра будет меньше' : tx ? 'Сегодня до ' + (tx[0] === nx[0] ? 'аята ' + tx[1] : ayName(to)) + ' · около ' + readMins(next, to) + ' мин' : '';
      const ring = st.before ? ringSvg(76, 0, false, '<b>' + st.base + '</b><small>стр. в день</small>') : ok ? ringSvg(76, 1, true, I.check) : ringSvg(76, st.readToday / Math.max(1, st.norm), false, '<b>' + st.readToday + '</b><small>из ' + st.norm + ' стр.</small>');
      out.push('<div class="card pad qhero"><div class="row" style="gap:14px;align-items:center">' + ring + '<span class="col grow" style="gap:5px;min-width:0"><span class="eyebrow" style="padding:0">Тафсир · день ' + clamp(st.di, 1, tp.P.days) + ' из ' + tp.P.days + '</span><span class="qhero-t">' + title + '</span>' + (sub ? '<span class="small sub">' + sub + '</span>' : '') + '</span></div>' +
        (st.before ? '' : '<button class="btn gold block" data-a="readOpen">' + READ_ICON + (ok ? 'Читать дальше' : 'Читать тафсир') + '</button>') + '</div>');
    } else if (!S.read && S.set.readOffer !== 'no' && sai()) {
      out.push('<button class="card pad tf-cont" data-a="sheet" data-v="read"><span class="rd-ico">' + READ_ICON + '</span><span class="col grow" style="gap:3px"><span style="font-size:15px;font-weight:800">Тафсир ас-Саади по плану</span><span class="small sub">Поставьте цель — приложение поведёт по аятам и посчитает страницы</span></span>' + I.chev + '</button>');
    }
    const ql = S.set.qlast || { s: 1, a: 1 };
    out.push('<button class="card qcont" data-a="readQ">' + STAR(ql.s) + '<span class="col grow" style="gap:2px;min-width:0"><span class="eyebrow" style="padding:0">' + (S.set.qlast ? 'Чтение Корана' : 'Начать чтение Корана') + '</span><span style="font-size:15px;font-weight:800">' + D.SURAH_RU[ql.s - 1] + ' · аят ' + ql.a + ' из ' + D.SURAH_AYAHS[ql.s - 1] + '</span></span>' + I.chev + '</button>');
    out.push(vQGoals());
    out.push(vQSearch() + vQSeg('qView', Q.view) + vQList(Q.view, Q.filter, tp));
    return out.join('');
  }
  const vQSearch = () => '<label class="search">' + I.search + '<span class="sr">Поиск суры или аята</span><input type="search" data-in="surah" placeholder="Сура или аят, например 2:255" value="' + esc(S.quran.filter || '') + '"></label>';
  const vQSeg = (act, view) => '<div class="seg" role="group" aria-label="Список">' + [['surahs', 'Суры'], ['juz', 'Джузы'], ['marks', 'Закладки']].map((v) => '<button class="' + (view === v[0] ? 'on' : '') + '" data-a="' + act + '" data-v="' + v[0] + '" aria-pressed="' + (view === v[0]) + '">' + v[1] + '</button>').join('') + '</div>';
  function vQList(view, filter, tp) {
    const f = (filter || '').trim();
    if (f || view === 'surahs' || !view) return vSurahRows(f, tp);
    if (view === 'juz') return '<div class="card list" style="overflow:hidden">' + D.JUZ_START.map((j, i) => '<button class="list-row" data-a="read" data-v="' + j[0] + ':' + j[1] + '"><span class="juz-n">' + (i + 1) + '</span><span class="col grow"><span style="font-size:15px;font-weight:800">Джуз ' + (i + 1) + '</span><span class="small sub">с суры ' + D.SURAH_RU[j[0] - 1] + ', аят ' + j[1] + '</span></span>' + I.chev + '</button>').join('') + '</div>';
    const marks = S.set.qmarks || [];
    if (!marks.length) return '<div class="card empty"><span style="color:var(--gold)">' + I.bookmark + '</span><span style="font-size:15px;font-weight:800">Закладок пока нет</span><span class="small sub" style="font-size:13px;line-height:1.5">При чтении нажмите на аят и выберите «Закладка». Закладки сохраняются в облаке Telegram.</span></div>';
    return '<div class="card list" style="overflow:hidden">' + marks.map((m) => { const s = +m.split(':')[0], a = +m.split(':')[1]; return '<button class="list-row" data-a="read" data-v="' + s + ':' + a + '"><span style="color:var(--gold)">' + I.bookmarkOn + '</span><span class="col grow"><span style="font-size:15px;font-weight:800">' + D.SURAH_RU[s - 1] + '</span><span class="small sub">аят ' + a + ' · джуз ' + juzOf(s, a) + '</span></span>' + I.chev + '</button>'; }).join('') + '</div>';
  }
  function vSurahRows(f, tp) {
    f = (f || '').toLowerCase();
    const out = [], m = /^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/.exec(f);
    if (m && +m[1] >= 1 && +m[1] <= 114) {
      const s = +m[1], a = clamp(+m[2], 1, D.SURAH_AYAHS[s - 1]);
      out.push('<button class="list-row" data-a="read" data-v="' + s + ':' + a + '">' + STAR(s) + '<span class="col grow"><span style="font-size:15px;font-weight:800">Перейти: ' + D.SURAH_RU[s - 1] + ', аят ' + a + '</span><span class="small sub">джуз ' + juzOf(s, a) + '</span></span>' + I.chev + '</button>');
    }
    const cur = tp ? tp.cur : -1;
    D.SURAH_RU.forEach((ru, i) => {
      const n = i + 1;
      if (f && !m && String(n) !== f && ru.toLowerCase().indexOf(f) < 0 && (!sNorm(f) || sNorm(ru).indexOf(sNorm(f)) < 0)) return;
      const fr = tp ? surahTf(n, cur) : 0;
      const h = hzOf(n), hz = h[0] === 2 ? '<span class="qs-hz">' + I.checkSm + 'наизусть</span>' : h[0] === 1 ? '<span class="qs-hz learn">учу · ' + h[1] + ' из ' + D.SURAH_AYAHS[i] + '</span>' : '';
      const tf = fr > 0 ? '<span class="qs-tf' + (fr >= 1 ? ' done' : '') + '"><i><b style="width:' + Math.round(fr * 100) + '%"></b></i>' + (fr >= 1 ? 'тафсир прочитан' : 'тафсир: ' + Math.max(1, Math.floor(fr * 100)) + '%') + '</span>' : '';
      out.push('<button class="list-row" data-a="read" data-v="' + n + ':1">' + STAR(n) + '<span class="col grow" style="gap:2px;min-width:0"><span style="font-size:15px;font-weight:800">' + ru + '</span><span class="small sub">' + ayahsLabel(D.SURAH_AYAHS[i]) + ' · ' + pagesLabel(n) + '</span>' + tf + hz + '</span><span class="qs-ar" lang="ar" dir="rtl">' + D.SURAH_AR[i] + '</span></button>');
    });
    return out.length ? '<div class="card list" style="overflow:hidden">' + out.join('') + '</div>' : '<div class="card empty"><span class="small sub">Ничего не нашлось. Попробуйте номер суры или «2:255».</span></div>';
  }

  /* ----- читалка ----- */
  const rhSub = (R, a) => (R.mode === 'ar' && R.pg ? 'стр. ' + R.pg[a - 1] + ' · ' : 'аят ' + a + ' из ' + D.SURAH_AYAHS[R.s - 1] + ' · ') + 'джуз ' + juzOf(R.s, a);
  const qPillText = (R, a) => (R.mode === 'ar' && R.pg ? 'Стр. ' + R.pg[a - 1] + ' · аят ' : 'Аят ') + a + ' из ' + D.SURAH_AYAHS[R.s - 1];
  function vReader() {
    const R = S.quran.reader, s = R.s, a = R.cur || R.a || 1, n = D.SURAH_AYAHS[s - 1];
    const ownBack = !(tg && tg.BackButton && ver('6.1'));
    const out = ['<header class="rh' + (S.quran.hid ? ' hid' : '') + '"><div class="rh-row">' +
      (ownBack ? '<button class="rh-i" data-a="closeReader" aria-label="Назад">' + I.back + '</button>' : '<button class="rh-i" data-a="qNav" aria-label="Содержание: суры, джузы, закладки">' + QI.toc + '</button>') +
      '<button class="rh-t" data-a="qNav" aria-label="Выбрать суру"><span class="rh-n">' + s + '. ' + D.SURAH_RU[s - 1] + QI.down + '</span><span class="rh-s" id="rh-s">' + rhSub(R, a) + '</span></button>' +
      '<button class="rh-i rh-aa" data-a="sheet" data-v="rdset" aria-label="Настройки чтения">Аа</button></div>' +
      '<div class="seg mini rh-seg" role="group" aria-label="Что читать">' + [['ar', 'Арабский'], ['tr', 'Перевод'], ['tf', 'Тафсир']].filter((m) => m[0] !== 'tf' || sai()).map((m) => '<button class="' + (R.mode === m[0] ? 'on' : '') + '" data-a="qMode" data-v="' + m[0] + '" aria-pressed="' + (R.mode === m[0]) + '">' + m[1] + '</button>').join('') + '</div>' +
      '<div class="rh-p"><i id="rh-p" style="width:' + (a / n * 100).toFixed(1) + '%"></i></div></header>'];
    if (R.loading) out.push('<div class="qload">Загружаю суру…</div>');
    else if (R.error) out.push('<div class="qpad"><div class="card pad" style="display:flex;flex-direction:column;gap:10px;margin-top:16px"><span style="font-weight:800">Не удалось загрузить текст</span><span class="small sub">' + esc(R.error) + '</span><button class="btn gold sm" data-a="qGo" data-v="' + s + ':' + R.a + '">Попробовать снова</button></div></div>');
    else if (R.mode === 'ar') out.push(vSurahHead(s) + vMushaf(R));
    else if (R.mode === 'tf') out.push(vTafsir(R));
    else out.push(vSurahHead(s) + vTransl(R));
    out.push(vQPill(R));
    if (R.sel && !R.loading && !R.error) out.push(vQTool(R));
    return out.join('');
  }
  const vSurahHead = (s) => '<div class="qsh"><span class="qsh-ar" lang="ar" dir="rtl">سورة ' + D.SURAH_AR[s - 1] + '</span><span class="qsh-m">' + D.SURAH_RU[s - 1] + ' · ' + ayahsLabel(D.SURAH_AYAHS[s - 1]) + ' · ' + pagesLabel(s) + '</span></div>' + (s !== 1 && s !== 9 ? '<p class="qbas" lang="ar" dir="rtl">' + BASMALA + '</p>' : '');
  const qRuNote = (R) => rd().ru && !R.ru ? '<div class="qnote">Перевод загрузится, когда появится интернет. Пока — только арабский текст.</div>' : '';
  function qAyah(R, a, showAr, showRu, marks) {
    const s = R.s, on = marks.indexOf(s + ':' + a) >= 0;
    return '<div class="qa' + (R.sel === a ? ' sel' : '') + '" id="ay' + a + '" data-ay="' + a + '" data-a="qSel" data-v="' + a + '" data-nohap><div class="qa-top"><span class="qa-n' + (a > 99 ? ' n3' : '') + '">' + STAR(a) + (on ? '<span class="qa-bm" aria-label="В закладках">' + I.bookmarkOn + '</span>' : '') + (rd().lay === 'cards' || tapTafsir(R) ? '<button class="qa-more" data-a="qAct" data-v="' + a + '" aria-label="Действия с аятом ' + a + '">' + QI.more + '</button>' : '') + '</span>' +
      (showAr ? '<p class="qar" lang="ar" dir="rtl">' + esc(arNoNum(R.ar[a - 1])) + '</p>' : '') + '</div>' + (showRu ? '<p class="qru">' + esc(R.ru[a - 1] || '') + '</p>' : '') + '</div>';
  }
  function vTransl(R) {
    const r = rd(), marks = S.set.qmarks || [], showRu = r.ru && !!R.ru, showAr = r.ar || !showRu;
    const out = [qRuNote(R)];
    for (let a = 1; a <= R.ar.length; a++) out.push(qAyah(R, a, showAr, showRu, marks));
    out.push(vQNext(R));
    return out.join('');
  }
  function vMushaf(R) {
    const out = []; let page = 0, buf = [];
    const flush = () => { if (buf.length) { out.push('<p class="mp" lang="ar" dir="rtl">' + buf.join(' ') + '</p><div class="mpn">' + page + '</div>'); buf = []; } };
    R.ar.forEach((t, i) => {
      if (R.pg[i] !== page) { flush(); page = R.pg[i]; }
      buf.push('<span class="ma' + (R.sel === i + 1 ? ' sel' : '') + '" id="ay' + (i + 1) + '" data-ay="' + (i + 1) + '" data-a="qSel" data-v="' + (i + 1) + '" data-nohap>' + esc(t) + '</span>');
    });
    flush();
    out.push(vQNext(R));
    return out.join('');
  }
  function vQNext(R) {
    const s = R.s, nav = [];
    if (s > 1) nav.push('<button class="btn ghost sm grow" data-a="qGo" data-v="' + (s - 1) + ':1">← ' + D.SURAH_RU[s - 2] + '</button>');
    if (s < 114) nav.push('<button class="btn gold sm grow" data-a="qGo" data-v="' + (s + 1) + ':1">' + D.SURAH_RU[s] + ' →</button>');
    return vQgReader(R) + '<div class="row qnext">' + nav.join('') + '</div>';
  }
  function vQPill(R) {
    const tp = R.mode === 'tf' && !R.loading ? tfPlan() : null;
    if (tp && !tp.st.done && !tp.st.before) {
      const st = tp.st, ok = st.left === 0, next = Math.min(tp.cur + 1, sai().n - 1);
      const sub = ok ? 'Читайте дальше — завтра будет меньше' : tp.day && tp.day.to >= 0 ? 'до ' + ayName(tp.day.to) + ' · около ' + readMins(next, tp.day.to) + ' мин' : '';
      return '<div class="qpill" id="qpill"><button class="qp-plan" data-a="sheet" data-v="read">' + ringSvg(46, ok ? 1 : st.readToday / Math.max(1, st.norm), ok, ok ? I.check : '<b>' + st.readToday + '</b>') +
        '<span class="qp-m"><b>' + (ok ? 'Норма выполнена · ' + st.readToday + ' стр.' : 'Сегодня ' + st.readToday + ' из ' + st.norm + ' стр.') + '</b><span class="sub">' + sub + '</span></span></button>' +
        '<button class="qp-b qp-ok" data-a="tfHere" aria-label="Отметить прочитанным до этого места">' + I.check + '</button></div>';
    }
    const s = R.s, n = D.SURAH_AYAHS[s - 1], a = R.cur || R.a || 1;
    return '<div class="qpill" id="qpill"><button class="qp-b" data-a="qGo" data-v="' + (s - 1) + ':1"' + (s > 1 ? '' : ' disabled') + ' aria-label="Предыдущая сура">' + QI.left + '</button>' +
      '<span class="qp-m"><span class="qp-r"><span id="qp-a">' + qPillText(R, a) + '</span><span class="sub">джуз <span id="qp-j">' + juzOf(s, a) + '</span></span></span><span class="qp-bar"><i id="qp-bar" style="width:' + (a / n * 100).toFixed(1) + '%"></i></span></span>' +
      '<button class="qp-b" data-a="qGo" data-v="' + (s + 1) + ':1"' + (s < 114 ? '' : ' disabled') + ' aria-label="Следующая сура">' + QI.right + '</button></div>';
  }
  function qPillRefresh() { const R = S.quran.reader, el = document.getElementById('qpill'); if (R && el) el.outerHTML = vQPill(R); }
  function vQTool(R) {
    const s = R.s, a = R.sel, on = (S.set.qmarks || []).indexOf(s + ':' + a) >= 0, tp = R.mode === 'tf' ? tfPlan() : null;
    const b = (act, icon, label, cls) => '<button class="qt-b' + (cls || '') + '" data-a="' + act + '" data-v="' + a + '">' + icon + '<span>' + label + '</span></button>';
    return '<div class="qtool" role="toolbar" aria-label="' + D.SURAH_RU[s - 1] + ', аят ' + a + '">' +
      (R.mode !== 'tf' && sai() ? b('qTfa', READ_ICON, 'Толкование', ' gold') : '') +
      (tp && !tp.st.done && !tp.st.before ? b('qReadTo', I.check, 'Прочитал до сюда', ' gold') : '') +
      b('qMark', on ? I.bookmarkOn : I.bookmark, on ? 'В закладках' : 'Закладка') + b('qCopy', QI.copy, 'Копировать') + b('qShare', QI.share, 'Поделиться') +
      '<button class="qt-x" data-a="qSel" data-v="0" aria-label="Закрыть">' + I.close + '</button></div>';
  }
  function qAyahText(s, a) {
    const R = S.quran.reader, same = R && R.s === s && R.ar;
    const ar = same ? arNoNum(R.ar[a - 1]) : '', ru = same && R.ru ? R.ru[a - 1] : '';
    return (ar ? ar + '\n\n' : '') + (ru ? ru + '\n\n' : '') + '— Коран, ' + D.SURAH_RU[s - 1] + ', ' + s + ':' + a + (ru ? ' (перевод смыслов Э. Кулиева)' : '');
  }
  function copyText(t) {
    const done = () => { haptic('notify', 'success'); toast('Скопировано'); };
    const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { toast('Не удалось скопировать'); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback(); } catch (e) { fallback(); }
  }

  /* ----- настройки чтения «Аа» ----- */
  function vRdSet(head) {
    const r = rd();
    const steps = (key, label, glyph, font) => '<div class="rs-row"><span class="rs-l">' + label + '</span><div class="rs-steps" role="group" aria-label="' + label + '"><span class="rs-g" style="font-family:' + font + ';font-size:14px" aria-hidden="true">' + glyph + '</span>' +
      [1, 2, 3, 4, 5].map((i) => '<button class="rs-dot' + (r[key] === i ? ' on' : i < r[key] ? ' past' : '') + '" data-a="rdSet" data-v="' + key + ':' + i + '" aria-label="' + label + ': ' + i + ' из 5" aria-pressed="' + (r[key] === i) + '"><i></i></button>').join('') +
      '<span class="rs-g" style="font-family:' + font + ';font-size:25px" aria-hidden="true">' + glyph + '</span></div></div>';
    const seg = (key, opts) => '<div class="seg mini" role="group">' + opts.map((o) => '<button class="' + (String(r[key]) === String(o[0]) ? 'on' : '') + '" data-a="rdSet" data-v="' + key + ':' + o[0] + '" aria-pressed="' + (String(r[key]) === String(o[0])) + '">' + o[1] + '</button>').join('') + '</div>';
    const sw = (key, label) => '<div class="x-row rs-sw"><span style="font-size:15px;font-weight:700">' + label + '</span><button class="switch" role="switch" aria-checked="' + !!r[key] + '" aria-label="' + label + '" data-a="rdSet" data-v="' + key + ':' + (r[key] ? 0 : 1) + '"><i></i></button></div>';
    return head('Чтение', 'Как выглядит текст Корана, перевода и толкования') +
      steps('fs', 'Размер текста', 'А', 'var(--book)') + steps('as', 'Арабский текст', 'ع', 'var(--quran)') +
      '<div class="rs-row"><span class="rs-l">Фон для чтения</span><div class="rs-bgs" role="group" aria-label="Фон для чтения">' + Object.keys(RD_BG).map((k) => '<button class="rs-bg' + (r.bg === k ? ' on' : '') + '" data-a="rdSet" data-v="bg:' + k + '" aria-pressed="' + (r.bg === k) + '"><span class="rs-swatch sw-' + k + '">Аа</span>' + RD_BG[k][0] + '</button>').join('') + '</div></div>' +
      '<div class="rs-row"><span class="rs-l">Вид страницы</span>' + seg('lay', [['book', 'Книга'], ['cards', 'Карточки']]) + '<span class="small sub" style="line-height:1.45;padding:0 2px">' + (r.lay === 'cards' ? 'Каждый аят — в своей карточке, перевод в отдельной рамке, как в «Академии Корана».' : 'Сплошной текст, как страница книги.') + '</span></div>' +
      (sai() ? '<div class="rs-row"><span class="rs-l">Нажатие на аят</span>' + seg('tap', [['act', 'Действия'], ['tf', 'Сразу толкование']]) + '<span class="small sub" style="line-height:1.45;padding:0 2px">' + (r.tap === 'tf' ? 'Листаете перевод, нажимаете на аят — открывается его толкование. Закладка, копирование и «поделиться» — под кнопкой «⋯» у номера аята.' : 'Нажатие на аят открывает панель: толкование, закладка, копировать, поделиться.') + '</span></div>' : '') +
      '<div class="rs-row"><span class="rs-l">Шрифт перевода и толкования</span>' + seg('font', [['book', '<span style="font-family:var(--book)">Книжный</span>'], ['plain', 'Простой']]) + '</div>' +
      '<div class="rs-box">' + sw('ar', 'Арабский текст аята') + sw('ru', 'Перевод аята') + (fsSupported() ? sw('full', 'Полный экран при чтении') : '') + '</div>' +
      (sai() ? '<div class="rs-row"><span class="rs-l">Прочитанное по плану тафсира</span>' + seg('auto', [[1, 'Само, по ходу чтения'], [0, 'Кнопкой']]) + '<span class="small sub" style="line-height:1.45;padding:0 2px">' + (r.auto ? 'Страницы засчитываются, когда вы дочитали толкование до конца. Если быстро пролистать или открыть другую суру — не считается.' : 'Отмечайте «Прочитал до сюда» под толкованием или галочкой внизу экрана.') + '</span></div>' : '') +
      '<button class="btn gold block" data-a="closeSheet">Готово</button>';
  }

  /* ----- толкование одного аята (шторка) ----- */
  const tfTypo = (t) => t.replace(/ - /g, ' — ');
  function vTfaSheet(sh) {
    const s = sh.s, tf = tfMem[s], R = S.quran.reader, same = R && R.s === s && R.ar;
    if (!tf && !sh.err && !sh.wait) { sh.wait = 1; tfFetch(s).then(() => { sh.wait = 0; if (S.sheet === sh) render(); }, () => { sh.wait = 0; sh.err = 1; if (S.sheet === sh) render(); }); }
    const g = tf ? tf.groups[tf.gi[sh.a]] : null, k = tf ? tf.gi[sh.a] : 0;
    const title = D.SURAH_RU[s - 1] + ', ' + (g && g.t > g.f ? 'аяты ' + g.f + '–' + g.t : 'аят ' + sh.a);
    const head = '<div class="grab"></div><div class="tfa-h"><span class="col grow" style="gap:3px;min-width:0"><span class="eyebrow" style="padding:0;color:var(--gold)">Толкование ас-Саади</span><span class="tfa-t">' + title + '</span></span><button class="icon-btn" data-a="closeSheet" aria-label="Закрыть">' + I.close + '</button></div>';
    if (!tf) return head + (sh.err ? '<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span style="font-weight:800">Не удалось загрузить толкование</span><span class="small sub">Проверьте подключение к интернету.</span><button class="btn gold sm" data-a="tfaRetry">Попробовать снова</button></div>' : '<div class="loading">Загружаю толкование…</div>');
    const q = [];
    for (let a = g.f; a <= g.t; a++) {
      if (same) q.push('<p class="tfa-ar" lang="ar" dir="rtl">' + esc(R.ar[a - 1]) + '</p>');
      if (same && R.ru) q.push('<p class="tfa-tr">«' + esc(R.ru[a - 1]) + '»</p>');
    }
    const on = (S.set.qmarks || []).indexOf(s + ':' + sh.a) >= 0, G = tf.groups;
    return head + (q.length ? '<div class="tfa-q">' + q.join('') + '</div>' : '') +
      '<div class="tfa-b">' + (g.text ? tfParas(tfTypo(g.text)).map((p) => '<p>' + esc(p) + '</p>').join('') : '<p class="sub">К этому аяту отдельного толкования нет.</p>') + '</div>' +
      '<div class="tfa-f"><button class="qp-b" data-a="qMark" data-v="' + sh.a + '" aria-label="' + (on ? 'Убрать закладку' : 'В закладки') + '" aria-pressed="' + on + '">' + (on ? I.bookmarkOn : I.bookmark) + '</button>' +
      '<div class="tfa-nav"><button class="qp-b" data-a="tfaNav" data-v="' + (k > 0 ? G[k - 1].f : 0) + '"' + (k > 0 ? '' : ' disabled') + ' aria-label="Предыдущий аят">' + QI.left + '</button><span class="tfa-n">' + (g.t > g.f ? 'Аяты ' + g.f + '–' + g.t : 'Аят ' + g.f + ' из ' + D.SURAH_AYAHS[s - 1]) + '</span><button class="qp-b qp-ok" data-a="tfaNav" data-v="' + (k < G.length - 1 ? G[k + 1].f : 0) + '"' + (k < G.length - 1 ? '' : ' disabled') + ' aria-label="Следующий аят">' + QI.right + '</button></div>' +
      '<button class="qp-b" data-a="qCopy" data-v="' + sh.a + '" aria-label="Копировать">' + QI.copy + '</button><button class="qp-b" data-a="qShare" data-v="' + sh.a + '" aria-label="Поделиться">' + QI.share + '</button></div>';
  }

  /* ----- режим чтения: фон, полный экран, прокрутка ----- */
  let readingOn = false, fsMine = false;
  function fsSupported() { return !!(tg && tg.requestFullscreen && ver('8.0') && /^(ios|android)$/.test(tg.platform || '')); }
  function fullscreen(on) {
    if (!fsSupported()) return;
    try {
      if (on && !tg.isFullscreen) { fsMine = true; tg.requestFullscreen(); }
      else if (!on && fsMine && tg.isFullscreen) { fsMine = false; tg.exitFullscreen(); }
    } catch (e) {}
  }
  function syncReading() {
    const on = !!(S.loaded && S.set.level && S.tab === 'quran' && S.quran.reader), r = rd(), b = document.body;
    b.classList.toggle('reading', on);
    Object.keys(RD_BG).forEach((k) => b.classList.toggle('rbg-' + k, on && r.bg === k));
    b.classList.toggle('rplain', on && r.font === 'plain');
    b.classList.toggle('rcards', on && r.lay === 'cards');
    if (on) { b.style.setProperty('--rfs', RD_FS[r.fs - 1] + 'px'); b.style.setProperty('--ras', RD_AS[r.as - 1] + 'px'); }
    if (on !== readingOn) { readingOn = on; fullscreen(on && r.full); if (!on) S.quran.hid = false; }
  }
  const readerBgColor = () => readingOn ? RD_BG[rd().bg][1] : '';
  function hdrBottom() { const h = document.querySelector('.rh'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }
  function topAyah() {
    const top = hdrBottom() + 16;
    for (const el of document.querySelectorAll('#screen [data-ay]')) { if (el.getBoundingClientRect().bottom > top) return +el.dataset.ay; }
    return 0;
  }
  let rdScrollT = 0, rdLastY = 0, qlastT = 0, rdJump = 0;
  function onReaderScroll() {
    const R = S.quran.reader;
    if (!readingOn || !R || R.loading) return;
    const y = $('#scroll').scrollTop, dy = y - rdLastY; rdLastY = y;
    const h = document.querySelector('.rh');
    if (h && !S.sheet && Date.now() - rdJump > 450 && Math.abs(dy) < 400) {
      if (y > 160 && dy > 5 && !S.quran.hid) { S.quran.hid = true; h.classList.add('hid'); }
      else if ((dy < -5 || y < 80) && S.quran.hid) { S.quran.hid = false; h.classList.remove('hid'); }
    }
    if (!rdScrollT) rdScrollT = setTimeout(() => { rdScrollT = 0; readerTick(); }, 180);
  }
  function readerTick() {
    const R = S.quran.reader;
    if (!readingOn || !R || R.loading || R.error) return;
    const a = topAyah();
    if (a && a !== R.cur) {
      R.cur = a;
      const n = D.SURAH_AYAHS[R.s - 1], w = (a / n * 100).toFixed(1) + '%';
      const set = (id, f) => { const el = document.getElementById(id); if (el) f(el); };
      set('rh-s', (el) => { el.textContent = rhSub(R, a); });
      set('rh-p', (el) => { el.style.width = w; });
      set('qp-a', (el) => { el.textContent = qPillText(R, a); });
      set('qp-j', (el) => { el.textContent = juzOf(R.s, a); });
      set('qp-bar', (el) => { el.style.width = w; });
      if (R.mode !== 'tf') { clearTimeout(qlastT); qlastT = setTimeout(() => { if (S.quran.reader === R && R.cur) { S.set.qlast = { s: R.s, a: R.cur, m: R.mode }; saveSettings(); } }, 2500); }
    }
    // тафсир «само»: следующая порция подгружается заранее, без кнопки
    if (R.mode === 'tf' && rd().auto && R.win && R.tf && R.tf.groups && R.win[1] < R.tf.groups.length - 1) {
      const sc = $('#scroll');
      if (sc.scrollHeight - (sc.scrollTop + sc.clientHeight) < 1600) keepAnchor('tfg' + R.win[1], () => { tfExtend(R); render(); });
    }
  }
  /* Засчитать прочитанное само: толкование группы аятов дочитано до конца и было на экране не меньше,
     чем нужно очень быстрому читателю (≈75 знаков в секунду). Только подряд от места остановки. */
  const tfSeen = {};
  function tfTick() {
    const R = S.quran.reader;
    if (!readingOn || !R || R.mode !== 'tf' || !R.win || !R.tf || !R.tf.groups || document.hidden || S.sheet) return;
    const top = hdrBottom(), bottom = window.innerHeight - 92;
    document.querySelectorAll('#screen .qg').forEach((el) => { const r = el.getBoundingClientRect(); if (r.bottom > top && r.top < bottom) { const key = R.s + ':' + el.dataset.k; tfSeen[key] = (tfSeen[key] || 0) + 1; } });
    if (!rd().auto) return;
    const tp = tfPlan();
    if (!tp || tp.st.done || tp.st.before) return;
    const base = gOf(R.s, 1) - 1, G = R.tf.groups, na = tp.cur + 1 - base;
    if (na < 1 || na > D.SURAH_AYAHS[R.s - 1]) return;
    let k = R.tf.gi[na], upTo = -1;
    if (k < R.win[0] || k > R.win[1]) return;
    for (; k <= R.win[1]; k++) {
      const el = document.getElementById('tfg' + k);
      if (!el) break;
      const need = Math.min(40, Math.max(3, tfSize(G[k]) / 75));
      if (el.getBoundingClientRect().bottom <= bottom + 2 && (tfSeen[R.s + ':' + k] || 0) >= need) upTo = k; else break;
    }
    if (upTo >= 0) readTo(base + G[upTo].t, 'auto');
  }

  /* ----- загрузка текста ----- */
  async function cachedJson(urls, key, ms, cname) { // сначала из памяти телефона (Cache API), потом из сети
    let cache = null, data = null, err = null;
    try { if (window.caches) { cache = await caches.open(cname); const hit = await cache.match(key); if (hit) data = await hit.json(); } } catch (e) { data = null; }
    for (let i = 0; !data && i < urls.length; i++) {
      const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), ms);
      try {
        const r = await fetch(urls[i], { signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const txt = await r.text();
        data = JSON.parse(txt);
        if (cache) { try { await cache.put(key, new Response(txt, { headers: { 'Content-Type': 'application/json' } })); } catch (e) {} }
      } catch (e) { err = e; data = null; } finally { clearTimeout(to); }
    }
    if (!data) throw err || new Error('load');
    return data;
  }
  const qMem = {}, qOrder = [];
  async function qArabic(s) {
    if (qMem[s]) return qMem[s];
    const url = new URL('quran/' + s + '.json?v=18', location.href).href;
    const j = await cachedJson([url], url, 20000, 'ibada-quran-v1');
    if (!j || !j.t || j.t.length !== D.SURAH_AYAHS[s - 1]) throw new Error('bad');
    qMem[s] = j; qOrder.push(s);
    while (qOrder.length > 6) delete qMem[qOrder.shift()];
    return j;
  }
  async function qRussian(s) {
    const n = D.SURAH_AYAHS[s - 1];
    try {
      const c = JSON.parse(localStorage.getItem('ibada:q' + s) || 'null');
      const ru = c && (Array.isArray(c) ? c.map((x) => x.ru) : c.ru);
      if (ru && ru.length === n) { if (Array.isArray(c)) { try { localStorage.setItem('ibada:q' + s, JSON.stringify({ ru })); } catch (e) {} } return ru; }
    } catch (e) {}
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(QURAN_API + '/surah/' + s + '/ru.kuliev', { signal: ctrl.signal });
      const j = await r.json();
      const ru = j && j.data && j.data.ayahs && j.data.ayahs.map((x) => x.text);
      if (!ru || ru.length !== n) throw new Error('bad');
      try { localStorage.setItem('ibada:q' + s, JSON.stringify({ ru })); } catch (e) {}
      return ru;
    } finally { clearTimeout(to); }
  }
  async function openSurah(s, a, mode) {
    s = clamp(+s || 1, 1, 114); a = clamp(+a || 1, 1, D.SURAH_AYAHS[s - 1]);
    mode = ['ar', 'tr', 'tf'].indexOf(mode) >= 0 ? mode : 'tr';
    if (mode === 'tf' && !sai()) mode = 'tr';
    const RD = S.quran.reader = { s, a, cur: a, mode, loading: true, error: '', ar: null, pg: null, ru: null, tf: null, win: null, go: a > 1 ? a : 0, sel: 0 };
    S.quran.hid = false;
    if (mode !== 'tf') { S.set.qlast = { s, a, m: mode }; saveSettings(); }
    if (mode === 'tf') tfEnsure(RD);
    render(); $('#scroll').scrollTop = 0;
    let A;
    try { A = await qArabic(s); } catch (e) { if (S.quran.reader !== RD) return; RD.loading = false; RD.error = 'Проверьте подключение к интернету.'; render(); return; }
    if (S.quran.reader !== RD) return;
    RD.ar = A.t; RD.pg = A.p;
    let ru = null;
    try { ru = await qRussian(s); } catch (e) { ru = null; }
    if (S.quran.reader !== RD) return;
    RD.ru = ru; RD.loading = false;
    render(); readerScroll(RD);
  }

  function weekKeys() { const t = todayKey(); const wd = (weekday(t) + 6) % 7; const mon = addDays(t, -wd); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i)); }
  function monthKeys() { const p = parseKey(todayKey()); const n = new Date(p.y, p.m, 0).getDate(); const out = []; for (let d = 1; d <= n; d++) out.push(keyOf(p.y, p.m, d)); return out; }
  /* ===== Ибада 2.0: «Прогресс» =====
     Неделя: итог с кольцом, сетка «день × намаз», цель недели, постоянство, план чтения, каза и посты.
     Пустые недели показываются как спокойная заготовка, а не нули. */
  const ST_COLOR = { mosque: 'var(--gold)', juma: 'var(--gold)', jamaat: 'var(--blue)', done: 'var(--emerald)', qada: 'var(--amber)', missed: 'var(--rose)' };
  function dueCount(k) { // сколько фард-намазов этого дня уже наступило
    const t = todayKey();
    if (k < t) return 5;
    if (k > t) return 0;
    const T = prayerTimes(k), now = new Date();
    return T ? PRAYERS.filter((p) => T[p.id] <= now).length : fardDoneCount(getDay(k));
  }
  const avgOf = (keys, f) => { const v = keys.map((k) => scores(k)).filter(Boolean).map(f).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const firstMark = () => Object.keys(S.days).filter((k) => !isEmptyDay(S.days[k])).sort()[0] || '';
  function vPrGrid(keys, today) {
    const head = '<span></span>' + keys.map((k) => '<button class="pg-d' + (k === today ? ' on' : '') + '" data-a="' + (k <= today ? 'openDay' : '') + '" data-v="' + k + '"' + (k > today ? ' disabled' : '') + ' aria-label="' + WD_FULL[weekday(k)] + ', ' + fmtDate(k) + (k <= today ? ': открыть день' : '') + '">' + WD_SHORT[weekday(k)] + '</button>').join('');
    const T = prayerTimes(today), now = new Date();
    const rows = PRAYERS.map((pr) => '<span class="pg-n">' + pr.name + '</span>' + keys.map((k) => {
      const st = S.days[k] && S.days[k].f[pr.id], later = k > today || (k === today && T && T[pr.id] > now);
      return '<i class="' + (st ? 'st' : later ? 'fu' : 'em') + '"' + (st ? ' style="background:' + ST_COLOR[st] + '"' : '') + '></i>';
    }).join('')).join('');
    return '<div class="pg" role="img" aria-label="Сетка намазов по дням недели">' + head + rows + '</div>';
  }
  function vProgress() {
    const P = S.prog, today = todayKey(), lvl = S.set.level;
    if (P.period === 'path' && !gamOn()) P.period = 'week';
    const out = ['<h1 class="h1">Прогресс</h1>',
      '<div class="seg" role="group" aria-label="Период">' + [['week', 'Неделя'], ['month', 'Месяц']].concat(gamOn() ? [['path', 'Путь']] : []).map((x) => '<button class="' + (P.period === x[0] ? 'on' : '') + '" data-a="period" data-v="' + x[0] + '" aria-pressed="' + (P.period === x[0]) + '">' + x[1] + '</button>').join('') + '</div>'];
    if (P.period === 'path') return out.join('') + vPath();
    if (P.period === 'month') return out.join('') + vProgMonth();
    const keys = weekKeys(), past = keys.filter((k) => k <= today), first = firstMark();
    const marked = past.filter((k) => S.days[k] && !isEmptyDay(S.days[k]));
    const k0 = parseKey(keys[0]), k6 = parseKey(keys[6]);
    const range = k0.m === k6.m ? k0.d + '–' + k6.d + ' ' + MONTHS_GEN[k0.m - 1] : fmtDate(keys[0]) + ' — ' + fmtDate(keys[6]);
    // итог недели
    let due = 0, onTime = 0;
    past.forEach((k) => { due += dueCount(k); const d = S.days[k]; if (d) PRAYERS.forEach((p) => { if (ON_TIME[d.f[p.id]]) onTime++; }); });
    if (!first) {
      out.push('<div class="card pr-empty"><div class="pr-empty-g">' + vPrGrid(keys, today) + '</div><span class="li-t">Ваша первая неделя</span><span class="li-m">Отмечайте намазы на экране «Сегодня» — здесь появится картина недели: какие намазы в мечети, какие джамаатом, какие вовремя.</span><button class="btn gold sm" data-a="tab" data-v="home">К намазам</button></div>');
      return out.join('');
    }
    const avg = avgOf(past, (x) => x.overall), prevKeys = weekOf(addDays(keys[0], -7)), prev = avgOf(prevKeys, (x) => x.overall);
    let cmp = range;
    if (avg !== null && prev !== null) { const dd = Math.round((avg - prev) * 100); cmp += dd > 0 ? ' · лучше прошлой на ' + dd + '%' : dd === 0 ? ' · как на прошлой' : ' · прошлая неделя ' + Math.round(prev * 100) + '%'; }
    const kpi = [['Фард вовремя', onTime + ' из ' + due, 'var(--emerald)']];
    if (lvl !== 'start') {
      const span = past.filter((k) => k >= first), n = span.length;
      const az = span.reduce((a, k) => a + (S.days[k] && azDone(S.days[k], 'morning') ? 1 : 0) + (S.days[k] && azDone(S.days[k], 'evening') ? 1 : 0), 0);
      kpi.push(['Азкары', az + ' из ' + n * 2, 'var(--blue)']);
    }
    if (S.read && S.read.log) { const pg = keys.reduce((a, k) => a + (S.read.log[k] || 0), 0); kpi.push([S.read.book === 'saadi' ? 'Тафсир' : 'Чтение', pg + ' стр.', 'var(--gold)']); }
    else if (lvl !== 'start') { const sn = avgOf(past, (x) => x.sunna); kpi.push(['Сунна', pct(sn), 'var(--gold)']); }
    out.push('<section class="card pr-sum" aria-label="Итог недели"><span class="pr-ring">' + ring(avg || 0, 104, 45, 9) + '<span><b class="num">' + (avg === null ? '—' : Math.round(avg * 100) + '%') + '</b><small>неделя</small></span></span>' +
      '<span class="col grow" style="gap:9px"><span class="li-m">' + cmp + '</span>' + kpi.map((x) => '<span class="pr-kpi"><i style="background:' + x[2] + '"></i><span class="grow">' + x[0] + '</span><b class="num">' + x[1] + '</b></span>').join('') + '</span></section>');
    // сетка намазов
    const cnt = { mosque: 0, jamaat: 0, done: 0, qada: 0, missed: 0 };
    past.forEach((k) => { const d = S.days[k]; if (!d) return; PRAYERS.forEach((p) => { let st = d.f[p.id]; if (st === 'juma') st = 'mosque'; if (st && cnt[st] !== undefined) cnt[st]++; }); });
    const legend = [['mosque', 'В мечети'], ['jamaat', 'Джамаатом'], ['done', 'Вовремя'], ['qada', 'Каза'], ['missed', 'Пропущен']].filter((x) => lvl !== 'start' || x[0] === 'done' || x[0] === 'missed');
    out.push('<section class="card pad pr-week" aria-label="Намазы недели"><div class="sec-h in"><h2 class="h2">Намазы недели</h2><span class="sec-m num">' + onTime + ' из ' + due + ' вовремя</span></div>' + vPrGrid(keys, today) +
      '<div class="pg-leg">' + legend.map((x) => '<span><i style="background:' + ST_COLOR[x[0]] + '"></i>' + x[1] + (cnt[x[0]] ? ' <b class="num">' + cnt[x[0]] + '</b>' : '') + '</span>').join('') + '</div>' +
      (marked.length ? '' : '<span class="li-m">На этой неделе отметок пока нет. Нажмите на день, чтобы открыть его.</span>') + '</section>');
    if (gamOn() && S.loaded) out.push(vGoalCard(false));
    // постоянство
    const last7 = [6, 5, 4, 3, 2, 1, 0].map((i) => addDays(today, -i));
    const st = [[(d) => PRAYERS.every((p) => ON_TIME[d.f[p.id]]), 'Все фарды вовремя']];
    if (lvl !== 'start') st.push([(d) => azDone(d, 'morning'), 'Утренние азкары'], [(d) => azDone(d, 'evening'), 'Вечерние азкары']);
    st.push([(d) => PRAYERS.some((p) => d.f[p.id] === 'mosque' || d.f[p.id] === 'juma'), 'Хотя бы один намаз в мечети']);
    out.push('<section class="sec" aria-label="Постоянство"><div class="sec-h"><h2 class="h2">Постоянство</h2><span class="sec-m">последние 7 дней</span></div><div class="card list">' + st.map((x) => {
      const n = streak(x[0]);
      return '<div class="li"><span class="pr-st"><b class="num">' + n + '</b><small>' + plural(n, 'день', 'дня', 'дней') + '</small></span><span class="li-c" style="gap:7px"><span class="li-t">' + x[1] + '</span><span class="pr-dots">' + last7.map((k) => '<i class="' + (S.days[k] && x[0](S.days[k]) ? 'on' : '') + '"></i>').join('') + '</span></span></div>';
    }).join('') + '</div></section>');
    // план чтения
    const rs = rState();
    if (rs) {
      const R = rs.R, frac = rs.pos / rs.total, ahead = rs.ahead || 0;
      out.push('<button class="card pad pr-read" data-a="sheet" data-v="read"><span class="sec-h in"><span class="h2">' + esc(R.title) + '</span><span class="sec-m num" style="color:' + (rs.done ? 'var(--emerald-text)' : ahead >= 0 ? 'var(--emerald-text)' : 'var(--amber-text)') + '">' + (rs.done ? 'прочитан' : rs.before ? 'с ' + fmtDate(R.start) : ahead > 0 ? '+' + ahead + ' стр. к плану' : ahead === 0 ? 'по плану' : '−' + Math.abs(ahead) + ' стр. от плана') + '</span></span>' +
        '<span class="bar" style="height:8px"><span style="width:' + (frac * 100).toFixed(1) + '%"></span></span><span class="li-m num">' + rs.pos + ' из ' + rs.total + ' стр.' + (rs.before ? '' : ' · день ' + Math.min(rs.di, R.days) + ' из ' + R.days) + (isSaadi(R) && readG(R) >= 0 ? ' · сейчас ' + ayName(readG(R)) : '') + '</span></button>');
    }
    if (lvl === 'ihsan') out.push(vDebts(past));
    return out.join('');
  }
  function vDebts(keys) {
    const debt = qadaDebt(), fd = fastDebt(), nf = nextFasting(todayKey());
    let qadaMade = 0, fasts = 0;
    keys.forEach((k) => { const d = S.days[k]; if (!d) return; PRAYERS.forEach((p) => { if (d.f[p.id] === 'qada') qadaMade++; }); if (d.p === 'fast' || d.p === 'qada') fasts++; });
    return '<section class="sec" aria-label="Каза и посты"><div class="sec-h"><h2 class="h2">Каза и посты</h2></div>' +
      '<div class="card pad pr-debt"><div class="between"><span class="li-c"><span class="li-t">Каза-долг</span><span class="li-m">' + (debt ? 'Пропущенные фард-намазы · восполнено за период: ' + qadaMade : 'Долга нет, альхамдулиллях') + '</span></span><b class="pr-big num" style="color:' + (debt ? 'var(--amber-text)' : 'var(--emerald-text)') + '">' + debt + '</b></div>' +
      '<div class="row" style="gap:8px">' + (debt ? '<button class="btn gold sm grow" data-a="qadaDone">Восполнил намаз</button>' : '') + '<button class="btn ghost sm grow" data-a="sheet" data-v="qada">Прошлые годы</button></div></div>' +
      '<div class="card list"><button class="li" data-a="sheet" data-v="fast"><span class="li-c"><span class="li-t">Посты за период</span><span class="li-m">' + (fd ? 'Долг по постам: ' + fd + ' ' + plural(fd, 'день', 'дня', 'дней') : 'Долга по постам нет') + '</span></span><b class="li-big num">' + fasts + '</b></button>' +
      (nf ? '<div class="li"><span class="li-c"><span class="li-t">Ближайший желательный пост</span><span class="li-m">' + WD_FULL[weekday(nf.key)] + ', ' + fmtDate(nf.key) + (nf.info.text !== WD_FULL[weekday(nf.key)] ? ' · ' + nf.info.text : '') + '</span></span></div>' : '') + '</div></section>';
  }
  function vProgMonth() {
    const P = S.prog, today = todayKey(), lvl = S.set.level, out = [];
    const keys = monthKeys(), past = keys.filter((k) => k <= today), first = firstMark();
    const selKey = P.day || today, selSc = scores(selKey), avg = avgOf(past, (x) => x.overall);
    const lead = (weekday(keys[0]) + 6) % 7;
    let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => '<span class="cal-w">' + w + '</span>').join('');
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    keys.forEach((k) => { const s = scores(k), v = s ? s.overall : null; const cls = k > today ? 'fu' : v === null ? 'h0' : v >= 0.9 ? 'h4c' : v >= 0.75 ? 'h3c' : v >= 0.6 ? 'h2c' : 'h1c'; cells += '<button class="' + cls + (k === selKey ? ' on' : '') + ' num" data-a="calDay" data-v="' + k + '" aria-label="' + fmtDate(k) + ': ' + (k > today ? 'ещё впереди' : pct(v)) + '"' + (k === today ? ' style="font-weight:800"' : '') + '>' + parseKey(k).d + '</button>'; });
    out.push('<section class="card pad pr-month" aria-label="Месяц"><div class="between" style="align-items:flex-end"><span class="col" style="gap:4px"><span class="li-m">Средний итог · ' + MONTHS_NOM[parseKey(today).m - 1] + '</span><b class="pr-big num" style="font-size:44px">' + (avg === null ? '—' : Math.round(avg * 100) + '%') + '</b></span>' +
      '<span class="col" style="align-items:flex-end;gap:6px"><span class="li-t" style="font-size:13.5px">' + WD_SHORT[weekday(selKey)] + ', ' + fmtDate(selKey) + ' · ' + (selKey > today ? 'впереди' : pct(selSc ? selSc.overall : null)) + '</span>' + (selKey <= today && selKey !== today ? '<button class="btn ghost sm" data-a="openDay" data-v="' + selKey + '" style="min-height:34px">Открыть день</button>' : '') + '</span></div>' +
      '<div class="cal">' + cells + '</div><div class="pg-leg">' + [['h1c', 'ниже 60%'], ['h2c', '60–74%'], ['h3c', '75–89%'], ['h4c', '90%+']].map((l) => '<span><i class="' + l[0] + '"></i>' + l[1] + '</span>').join('') + '</div></section>');
    if (!first) { out.push('<div class="card pr-empty"><span class="li-t">Пока нет отметок</span><span class="li-m">Отмечайте намазы на экране «Сегодня» — здесь появятся итоги месяца.</span><button class="btn gold sm" data-a="tab" data-v="home">К намазам</button></div>'); return out.join(''); }
    const cats = [['Фард-намазы', avgOf(past, (x) => x.fard), 'var(--emerald)']];
    if (lvl !== 'start') cats.push(['Сунна и прочее', avgOf(past, (x) => x.sunna), 'var(--gold)'], ['Азкары', avgOf(past, (x) => x.azkar), 'var(--blue)'], ['Зикры', avgOf(past, (x) => x.zikr), 'var(--violet-text)']);
    out.push('<section class="sec" aria-label="По разделам"><div class="sec-h"><h2 class="h2">По разделам</h2></div><div class="card list">' + cats.map((c) => '<div class="li col-li"><span class="between"><span class="li-t">' + c[0] + '</span><b class="num">' + pct(c[1]) + '</b></span><span class="bar" style="height:6px"><span style="width:' + Math.round(Math.min(c[1] || 0, 1) * 100) + '%;background:' + c[2] + '"></span></span></div>').join('') + '</div></section>');
    const cnt = { mosque: 0, jamaat: 0, done: 0, qada: 0, missed: 0 };
    past.forEach((k) => { const d = S.days[k]; if (!d) return; PRAYERS.forEach((p) => { let st = d.f[p.id]; if (st === 'juma') st = 'mosque'; if (st && cnt[st] !== undefined) cnt[st]++; }); });
    const tot = Object.keys(cnt).reduce((a, x) => a + cnt[x], 0);
    out.push('<section class="sec" aria-label="Фард-намазы"><div class="sec-h"><h2 class="h2">Фард-намазы</h2>' + (tot && lvl !== 'start' ? '<span class="sec-m num">джамаатом ' + Math.round((cnt.mosque + cnt.jamaat) / tot * 100) + '%</span>' : '') + '</div><div class="card list">' +
      [['mosque', 'В мечети'], ['jamaat', 'Джамаатом'], ['done', 'Вовремя'], ['qada', 'Каза'], ['missed', 'Пропущено']].filter((x) => lvl !== 'start' || x[0] === 'done' || x[0] === 'missed').map((x) => '<div class="li"><span class="dot" style="width:10px;height:10px;background:' + ST_COLOR[x[0]] + '"></span><span class="li-c"><span class="li-t">' + x[1] + '</span></span><b class="num">' + cnt[x[0]] + '</b></div>').join('') + '</div></section>');
    if (lvl !== 'start') {
      const span = past.filter((k) => k >= first), n = span.length;
      const m = span.filter((k) => S.days[k] && azDone(S.days[k], 'morning')).length, e = span.filter((k) => S.days[k] && azDone(S.days[k], 'evening')).length;
      const pc = (a, b) => (b ? Math.round(a / b * 100) : 0);
      const row = (label, got, of, color) => '<div class="li col-li"><span class="between"><span class="li-t">' + label + '</span><b class="num"><span class="sub" style="font-weight:700">' + got + ' из ' + of + ' · </span>' + pc(got, of) + '%</b></span><span class="bar" style="height:6px"><span style="width:' + pc(got, of) + '%;background:' + color + '"></span></span></div>';
      if (n) out.push('<section class="sec" aria-label="Азкары"><div class="sec-h"><h2 class="h2">Азкары</h2>' + (first > past[0] ? '<span class="sec-m">с ' + fmtDate(first) + '</span>' : '') + '</div><div class="card list">' + row('Утренние', m, n, 'var(--gold)') + row('Вечерние', e, n, 'var(--blue)') + '</div></section>');
    }
    if (lvl === 'ihsan') out.push(vDebts(past));
    return out.join('');
  }

  /* ===== путь, знаки, цели недели, летопись =====
     Всё считается из ваших отметок и видно только вам. Хранится в облаке Telegram под ключом «gam»:
     дата получения знаков, цель недели и история целей. */
  const gamOn = () => S.set.gam !== false;
  const LVL_N = { start: 0, effort: 1, ihsan: 2 };
  const lvlOk = (need) => LVL_N[S.set.level || 'ihsan'] >= LVL_N[need || 'start'];
  const fullDay = (d) => PRAYERS.every((p) => ON_TIME[d.f[p.id]]);
  const jamaatSt = (st) => st === 'mosque' || st === 'jamaat' || st === 'juma';
  const STAGES = [1, 7, 14, 21, 30, 40, 60, 90, 120, 180, 270, 365];
  const CAT = {
    namaz: ['Намаз', 'var(--gold)', 'var(--gold-soft)'],
    sunna: ['Сунна', 'var(--emerald)', 'var(--emerald-soft)'],
    zikr: ['Азкары и зикр', 'var(--blue)', 'var(--blue-soft)'],
    fast: ['Пост и пятница', 'var(--amber)', 'var(--amber-soft)'],
    goal: ['Цели', 'var(--violet-text)', 'rgba(195,166,238,0.16)']
  };
  const BADGES = [
    { id: 'first', cat: 'namaz', t: 'Первый полный день', d: 'Все пять фард-намазов вовремя за один день', m: '1', v: (G) => G.fullDays, n: 1 },
    { id: 'week', cat: 'namaz', t: 'Неделя постоянства', d: '7 дней подряд все пять намазов вовремя', m: '7', v: (G) => G.fullRun, n: 7 },
    { id: 'run30', cat: 'namaz', t: 'Тридцать дней', d: '30 дней подряд все пять намазов вовремя', m: '30', v: (G) => G.fullRun, n: 30 },
    { id: 'cleanMonth', cat: 'namaz', t: 'Месяц без пропусков', d: 'Целый календарный месяц: каждый день все пять намазов вовремя', m: '☾', v: (G) => G.cleanMonths, n: 1 },
    { id: 'fajr40', cat: 'namaz', lvl: 'effort', t: 'Фаджр джамаатом', d: '40 раз Фаджр в мечети или джамаатом', m: '40', v: (G) => G.fajrJ, n: 40 },
    { id: 'mosque100', cat: 'namaz', lvl: 'effort', t: 'Сто намазов в мечети', d: '100 фард-намазов в мечети, включая джуму', m: '100', v: (G) => G.mosque, n: 100 },
    { id: 'juma4', cat: 'namaz', lvl: 'effort', t: 'Четыре джумы подряд', d: 'Пятничный намаз четыре пятницы подряд', m: '4', v: (G) => G.jumaRun, n: 4 },
    { id: 'qada50', cat: 'namaz', lvl: 'effort', t: 'Восполнение', d: '50 восполненных намазов (каза)', m: '50', v: (G) => G.qada, n: 50 },
    { id: 'sunnaWeek', cat: 'sunna', lvl: 'effort', t: 'Неделя сунны', d: '7 дней подряд вся сунна по вашему плану', m: '7', v: (G) => G.sunnaRun, n: 7 },
    { id: 'witr30', cat: 'sunna', lvl: 'ihsan', t: 'Витр', d: 'Витр-намаз 30 раз', m: '30', v: (G) => G.witr, n: 30 },
    { id: 'duha30', cat: 'sunna', lvl: 'ihsan', t: 'Духа', d: 'Духа-намаз 30 раз', m: '30', v: (G) => G.duha, n: 30 },
    { id: 'qiyam100', cat: 'sunna', lvl: 'ihsan', t: 'Ночной намаз', d: '100 ракаатов кияма в сумме', m: '100', v: (G) => G.qiyam, n: 100 },
    { id: 'azkar7', cat: 'zikr', lvl: 'effort', t: 'Неделя азкаров', d: 'Утренние и вечерние азкары 7 дней подряд', m: '7', v: (G) => G.azRun, n: 7 },
    { id: 'azkar40', cat: 'zikr', lvl: 'effort', t: 'Сорок дней азкаров', d: 'Утренние и вечерние азкары за 40 дней', m: '40', v: (G) => G.azBoth, n: 40 },
    { id: 'zikrDay', cat: 'zikr', lvl: 'effort', t: 'Полный тасбих', d: 'Все восемь зикров по 100 за один день', m: '8', v: (G) => G.zikrAllDays, n: 1 },
    { id: 'zikr1k', cat: 'zikr', lvl: 'effort', t: 'Тысяча зикров', d: '1 000 зикров в сумме', m: '1к', v: (G) => G.zikr, n: 1000 },
    { id: 'zikr10k', cat: 'zikr', lvl: 'effort', t: 'Десять тысяч', d: '10 000 зикров в сумме', m: '10к', v: (G) => G.zikr, n: 10000 },
    { id: 'zikr100k', cat: 'zikr', lvl: 'effort', t: 'Сто тысяч', d: '100 000 зикров в сумме', m: '100к', v: (G) => G.zikr, n: 100000 },
    { id: 'kahf4', cat: 'fast', lvl: 'ihsan', t: 'Сура аль-Кахф', d: 'Четыре пятницы подряд читали суру аль-Кахф', m: '4', v: (G) => G.kahfRun, n: 4 },
    { id: 'monThu', cat: 'fast', lvl: 'ihsan', t: 'Понедельник и четверг', d: 'Постились в понедельник и четверг одной недели', m: '2', v: (G) => G.monThu, n: 1 },
    { id: 'white', cat: 'fast', lvl: 'ihsan', t: 'Белые дни', d: 'Постились 13, 14 и 15 числа одного месяца по хиджре', m: '3', v: (G) => G.white, n: 1 },
    { id: 'arafa', cat: 'fast', lvl: 'ihsan', t: 'День Арафа', d: 'Постились 9 зуль-хиджжа', m: '9', v: (G) => G.arafa, n: 1 },
    { id: 'ashura', cat: 'fast', lvl: 'ihsan', t: 'Ашура', d: 'Постились 10 мухаррама', m: '10', v: (G) => G.ashura, n: 1 },
    { id: 'tafsir', cat: 'goal', t: 'Тафсир прочитан', d: 'Прочитали тафсир ас-Саади целиком по плану чтения', m: '114', v: () => (S.read && S.read.book === 'saadi' ? Math.min(S.read.pos || 0, 2304) : 0), n: 2304 },
    { id: 'goals5', cat: 'goal', t: 'Пять целей', d: 'Выполнили пять целей недели', m: '5', v: (G) => G.goalsDone, n: 5 }
  ];

  let dataVer = 0, gMemo = null;
  function gameStats() {
    const t = todayKey();
    if (gMemo && gMemo.v === dataVer && gMemo.t === t && gMemo.l === S.set.level && gMemo.g === (S.gam.goals || []).length + (S.gam.goal && S.gam.goal.done ? 1 : 0)) return gMemo.G;
    const G = { fullDays: 0, fullRun: 0, fajrJ: 0, mosque: 0, qada: S.gam.qadaMade || 0, witr: 0, duha: 0, qiyam: 0, azBoth: 0, azRun: 0, sunnaRun: 0, zikr: 0, zikrAllDays: 0, jumaRun: 0, kahfRun: 0, monThu: 0, white: 0, arafa: 0, ashura: 0, cleanMonths: 0, goalsDone: 0 };
    const ks = Object.keys(S.days).filter((k) => k <= t).sort();
    let runFull = 0, runAz = 0, runSun = 0, runJ = 0, runK = 0;
    const whiteMap = {}, weekMap = {}, monthFull = {};
    if (ks.length) {
      for (let k = ks[0], i = 0; k <= t && i < 3000; k = addDays(k, 1), i++) {
        const d = S.days[k], isT = k === t;
        const full = !!d && fullDay(d);
        if (full) { G.fullDays++; runFull++; } else if (!isT) runFull = 0;
        G.fullRun = Math.max(G.fullRun, runFull);
        const ym = k.slice(0, 6); monthFull[ym] = (monthFull[ym] || 0) + (full ? 1 : 0);
        const az = !!d && azDone(d, 'morning') && azDone(d, 'evening');
        if (az) { G.azBoth++; runAz++; } else if (!isT) runAz = 0;
        G.azRun = Math.max(G.azRun, runAz);
        const sc = d ? scores(k) : null, sun = !!sc && sc.sunna !== null && sc.sunna >= 0.999;
        if (sun) runSun++; else if (!isT) runSun = 0;
        G.sunnaRun = Math.max(G.sunnaRun, runSun);
        if (isFriday(k)) {
          const j = !!d && d.f.dhuhr === 'juma', kf = !!d && !!d.s.kahf;
          if (j) runJ++; else if (!isT) runJ = 0;
          if (kf) runK++; else if (!isT) runK = 0;
          G.jumaRun = Math.max(G.jumaRun, runJ); G.kahfRun = Math.max(G.kahfRun, runK);
        }
        if (!d) continue;
        if (jamaatSt(d.f.fajr)) G.fajrJ++;
        PRAYERS.forEach((p) => { const st = d.f[p.id]; if (st === 'mosque' || st === 'juma') G.mosque++; if (st === 'qada') G.qada++; });
        if (d.s.witr) G.witr++;
        if (d.s.duha) G.duha++;
        G.qiyam += d.q || 0;
        const zs = (d.z || []).reduce((a, b) => a + (b || 0), 0); G.zikr += zs;
        if (D.ZIKRS.every((z, i2) => (d.z[i2] || 0) >= 100)) G.zikrAllDays++;
        if (d.p === 'fast') {
          const h = hijri(k), wd = weekday(k);
          if (h.d >= 13 && h.d <= 15) { const hk = h.y + '-' + h.m; whiteMap[hk] = (whiteMap[hk] || 0) + 1; }
          if (h.m === 12 && h.d === 9) G.arafa = 1;
          if (h.m === 1 && h.d === 10) G.ashura = 1;
          if (wd === 1 || wd === 4) { const wk = addDays(k, -((wd + 6) % 7)); weekMap[wk] = (weekMap[wk] || 0) | (wd === 1 ? 1 : 2); }
        }
      }
      G.white = Object.keys(whiteMap).filter((x) => whiteMap[x] >= 3).length;
      G.monThu = Object.keys(weekMap).filter((x) => weekMap[x] === 3).length;
      const curYm = t.slice(0, 6);
      Object.keys(monthFull).forEach((ym) => { if (ym < curYm && monthFull[ym] === new Date(+ym.slice(0, 4), +ym.slice(4, 6), 0).getDate()) G.cleanMonths++; });
    }
    G.goalsDone = (S.gam.goals || []).filter((g) => g.done).length + (S.gam.goal && S.gam.goal.done ? 1 : 0);
    gMemo = { v: dataVer, t, l: S.set.level, g: (S.gam.goals || []).length + (S.gam.goal && S.gam.goal.done ? 1 : 0), G };
    return G;
  }
  const visibleBadges = () => BADGES.filter((b) => lvlOk(b.lvl));
  const badgeEarned = (b, G) => !!S.gam.seen[b.id] || b.v(G) >= b.n;
  function stageOf(n) {
    let i = 0; while (i < STAGES.length && n >= STAGES[i]) i++;
    return { stage: i, next: STAGES[i] || null, prev: i ? STAGES[i - 1] : 0 };
  }

  /* --- цель недели --- */
  const weekStart = (k) => addDays(k, -((weekday(k) + 6) % 7));
  const weekOf = (mon) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
  const countDays = (keys, f) => keys.reduce((a, k) => a + (S.days[k] && f(S.days[k], k) ? 1 : 0), 0);
  const GOALS = [
    { id: 'fajr', tier: 1, t: 'Фаджр вовремя', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => ON_TIME[d.f.fajr]) },
    { id: 'full', tier: 1, t: 'Все пять намазов вовремя', u: 'дн.', max: 7, c: (ks) => countDays(ks, fullDay) },
    { id: 'fajrJ', tier: 2, lvl: 'effort', t: 'Фаджр в мечети или джамаатом', u: 'раз', max: 7, c: (ks) => countDays(ks, (d) => jamaatSt(d.f.fajr)) },
    { id: 'jamaat', tier: 2, lvl: 'effort', t: 'Намазы в мечети или джамаатом', u: 'нам.', max: 35, step: 3, c: (ks) => ks.reduce((a, k) => a + (S.days[k] ? PRAYERS.filter((p) => jamaatSt(S.days[k].f[p.id])).length : 0), 0) },
    { id: 'azM', tier: 2, lvl: 'effort', t: 'Утренние азкары', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => azDone(d, 'morning')) },
    { id: 'azE', tier: 2, lvl: 'effort', t: 'Вечерние азкары', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => azDone(d, 'evening')) },
    { id: 'witr', tier: 3, lvl: 'ihsan', t: 'Витр-намаз', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => d.s.witr) },
    { id: 'duha', tier: 3, lvl: 'ihsan', t: 'Духа-намаз', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => d.s.duha) },
    { id: 'zikr', tier: 3, lvl: 'effort', t: 'Все зикры по 100', u: 'дн.', max: 7, c: (ks) => countDays(ks, (d) => D.ZIKRS.every((z, i) => (d.z[i] || 0) >= 100)) },
    { id: 'fastMT', tier: 3, lvl: 'ihsan', t: 'Пост в понедельник или четверг', u: 'дн.', max: 2, step: 1, c: (ks) => countDays(ks, (d, k) => d.p === 'fast' && (weekday(k) === 1 || weekday(k) === 4)) },
    { id: 'qada', tier: 3, lvl: 'effort', t: 'Восполнить намазы (каза)', u: 'нам.', max: 35, step: 5, need: () => qadaDebt() > 0, c: (ks) => ks.reduce((a, k) => a + (S.days[k] ? PRAYERS.filter((p) => S.days[k].f[p.id] === 'qada').length : 0), 0) + ((S.gam.qw || {})[ks[0]] || 0) }
  ];
  function goalCandidates(mon) {
    const last = weekOf(addDays(mon, -7));
    return GOALS.filter((g) => lvlOk(g.lvl) && (!g.need || g.need())).map((g) => {
      const l = g.c(last), step = g.step || 2;
      let target = l === 0 ? Math.min(3, g.max) : Math.min(g.max, l + step);
      if (g.id === 'qada') target = Math.max(1, Math.min(target, qadaDebt() + l));
      return { id: g.id, tier: g.tier, last: l, target, r: l / g.max };
    }).filter((x) => x.last < GOALS.find((g) => g.id === x.id).max).sort((a, b) => (a.tier - b.tier) || (a.r - b.r));
  }
  function ensureGoal() {
    if (!gamOn()) return null;
    const mon = weekStart(todayKey());
    let g = S.gam.goal;
    if (g && g.wk === mon) return g;
    if (g && g.st === 'on') {
      const def = GOALS.find((x) => x.id === g.id);
      const got = def ? def.c(weekOf(g.wk)) : 0;
      S.gam.goals = (S.gam.goals || []).concat([{ wk: g.wk, id: g.id, target: g.target, got, done: !!g.done || got >= g.target }]).slice(-20);
    }
    const c = goalCandidates(mon);
    S.gam.goal = c.length ? { wk: mon, id: c[0].id, target: c[0].target, st: 'new', alt: 0 } : { wk: mon, id: '', st: 'none' };
    saveGam();
    return S.gam.goal;
  }
  function goalProgress(g) {
    const def = GOALS.find((x) => x.id === g.id); if (!def) return null;
    const got = def.c(weekOf(g.wk));
    const left = 7 - weekOf(g.wk).filter((k) => k < todayKey()).length;
    return { def, got, left };
  }
  function vGoalCard(compact) {
    const g = ensureGoal();
    if (!g || g.st === 'none' || g.st === 'skip') return compact ? '' : '<div class="card pad gm-goal"><span class="eyebrow" style="padding:0">Цель недели</span><span class="small sub" style="line-height:1.5">' + (g && g.st === 'skip' ? 'На этой неделе без цели. Новая появится в понедельник.' : 'Пока нечего предложить — у вас всё ровно. Новая цель появится в понедельник.') + '</span>' + (g && g.st === 'skip' ? '<button class="btn ghost sm" data-a="goalBack">Вернуть цель</button>' : '') + '</div>';
    const P = goalProgress(g); if (!P) return '';
    const done = P.got >= g.target;
    const dots = g.target <= 7 ? '<span class="gm-dots">' + Array.from({ length: g.target }, (_, i) => '<i class="' + (i < P.got ? 'on' : '') + '"></i>').join('') + '</span>' : '<span class="bar" style="height:6px"><span style="width:' + Math.round(Math.min(P.got / g.target, 1) * 100) + '%;background:var(--violet-text)"></span></span>';
    if (g.st === 'new') {
      return '<div class="card pad gm-goal"><div class="between"><span class="eyebrow" style="padding:0">Цель недели</span><button class="icon-btn sm" data-a="goalSkip" aria-label="Без цели на этой неделе">' + I.close + '</button></div>' +
        '<span class="gm-goal-t">' + P.def.t + ' — <span class="num">' + g.target + ' ' + P.def.u + '</span></span>' +
        '<span class="small sub" style="line-height:1.5">' + (goalCandidates(g.wk).find((x) => x.id === g.id) || {}).last + ' на прошлой неделе. Небольшой шаг вперёд — и это станет привычкой.</span>' +
        '<div class="row" style="gap:8px"><button class="btn gold sm grow" data-a="goalAccept">Принимаю</button><button class="btn ghost sm" data-a="goalOther">Другую</button></div></div>';
    }
    return '<div class="card pad gm-goal' + (done ? ' done' : '') + '"' + (compact ? ' data-a="tab" data-v="progress:path" role="button"' : '') + '><div class="between"><span class="eyebrow" style="padding:0">Цель недели</span><span class="small num" style="font-weight:800;color:' + (done ? 'var(--emerald-text)' : 'var(--violet-text)') + '">' + (done ? 'выполнено' : P.got + ' из ' + g.target) + '</span></div>' +
      '<span class="gm-goal-t">' + P.def.t + '</span>' + dots +
      '<span class="small sub">' + (done ? 'Альхамдулиллях! Цель недели достигнута.' : 'Осталось ' + (g.target - P.got) + ' · до конца недели ' + P.left + ' ' + plural(P.left, 'день', 'дня', 'дней')) + '</span></div>';
  }

  /* --- проверка новых знаков и цели (после каждой отметки) --- */
  let gamTimer = null;
  function gamCheckSoon() { if (!gamOn() || !S.gam.init) return; clearTimeout(gamTimer); gamTimer = setTimeout(gamCheck, 500); }
  function gamCheck() {
    if (!gamOn() || !S.loaded || !S.set.level) return;
    const G = gameStats(), t = todayKey(), fresh = [];
    if (!S.gam.init) {
      visibleBadges().forEach((b) => { if (b.v(G) >= b.n) S.gam.seen[b.id] = t; });
      S.gam.init = 1; saveGam();
      S.sheet = { type: 'gamIntro' }; render(); return;
    }
    const g = S.gam.goal;
    if (g && g.st === 'on' && !g.done && g.wk === weekStart(t)) { const P = goalProgress(g); if (P && P.got >= g.target) { g.done = 1; fresh.push('goal'); gMemo = null; } }
    const G2 = fresh.length ? gameStats() : G;
    visibleBadges().forEach((b) => { if (!S.gam.seen[b.id] && b.v(G2) >= b.n) { S.gam.seen[b.id] = t; fresh.push(b.id); } });
    if (!fresh.length) return;
    saveGam();
    if (!S.sheet || S.sheet.type === 'read') { S.sheet = { type: 'award', ids: fresh }; haptic('notify', 'success'); render(); }
    else toast(fresh[0] === 'goal' ? 'Цель недели выполнена!' : 'Новый знак: ' + BADGES.find((b) => b.id === fresh[fresh.length - 1]).t);
  }

  /* --- эмблема знака --- */
  function emblem(b, size, on) {
    const c = CAT[b.cat], s = size, h = s / 2, r = s * 0.31;
    const sq = (rot) => '<rect x="' + (h - r) + '" y="' + (h - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" rx="' + (s * 0.03) + '" transform="rotate(' + rot + ' ' + h + ' ' + h + ')"/>';
    const fs = b.m.length > 2 ? s * 0.22 : s * 0.3;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true" class="emb' + (on ? ' on' : '') + '">' +
      '<g fill="' + (on ? c[2] : 'none') + '" stroke="' + (on ? c[1] : 'var(--line2)') + '" stroke-width="' + (s * 0.025) + '">' + sq(0) + sq(45) + '</g>' +
      (on ? '<circle cx="' + h + '" cy="' + h + '" r="' + (s * 0.24) + '" fill="none" stroke="' + c[1] + '" stroke-opacity=".45" stroke-width="' + (s * 0.012) + '"/>' : '') +
      '<text x="' + h + '" y="' + (h + fs * 0.36) + '" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="' + fs + '" fill="' + (on ? c[1] : 'var(--muted)') + '">' + esc(b.m) + '</text></svg>';
  }
  function starsRow(n) {
    return '<div class="gm-stars" aria-hidden="true">' + STAGES.map((x, i) => '<svg width="18" height="18" viewBox="0 0 18 18" class="' + (i < n ? 'on' : '') + '"><g><rect x="4" y="4" width="10" height="10"/><rect x="4" y="4" width="10" height="10" transform="rotate(45 9 9)"/></g></svg>').join('') + '</div>';
  }

  /* --- экран «Путь» --- */
  function vPath() {
    const G = gameStats(), st = stageOf(G.fullDays), out = [];
    const toNext = st.next ? st.next - G.fullDays : 0, frac = st.next ? (G.fullDays - st.prev) / (st.next - st.prev) : 1;
    out.push('<div class="card gm-stage"><div class="between" style="align-items:flex-end"><span class="col" style="gap:2px"><span class="eyebrow" style="padding:0">Путь</span><span class="big-serif" style="font-size:32px;line-height:1.05">' + (st.stage ? 'Ступень ' + st.stage : 'Начало пути') + '</span></span><span class="col" style="align-items:flex-end"><span class="num" style="font-family:var(--serif);font-size:30px;font-weight:700;line-height:1;color:var(--gold-hi)">' + G.fullDays + '</span><span class="small sub">' + plural(G.fullDays, 'день', 'дня', 'дней') + ' постоянства</span></span></div>' +
      starsRow(st.stage) +
      '<span class="bar" style="height:6px"><span style="width:' + Math.round(frac * 100) + '%"></span></span>' +
      '<span class="small sub" style="line-height:1.5">' + (st.next ? 'До ' + (st.stage + 1) + '-й ступени — ' + toNext + ' ' + plural(toNext, 'день', 'дня', 'дней') + '. ' : 'Все ступени пройдены, машаАллах. ') + 'День постоянства — все пять фард-намазов вовремя. Пропуск не отнимает пройденного.</span>' +
      '<span class="gm-hadith">«Самые любимые Аллаху дела — те, что совершаются постоянно, даже если их немного». <span class="sub">Аль-Бухари 6464, Муслим 783</span></span></div>');
    out.push(vGoalCard(false));
    const past = (S.gam.goals || []).slice(-4).reverse();
    if (past.length) out.push('<div class="card list">' + past.map((x) => { const def = GOALS.find((g) => g.id === x.id); return '<div class="x-row"><span style="width:28px;flex:none;color:' + (x.done ? 'var(--emerald-text)' : 'var(--muted)') + '">' + (x.done ? I.check : I.minus) + '</span><span class="col grow"><span style="font-size:14px;font-weight:700">' + (def ? def.t : x.id) + '</span><span class="small sub">неделя с ' + fmtDate(x.wk) + '</span></span><span class="small num" style="font-weight:800">' + x.got + ' / ' + x.target + '</span></div>'; }).join('') + '</div>');
    // летопись
    const t = todayKey(), ym = t.slice(0, 6), months = [ym];
    for (let i = 1; i <= 5; i++) { const p = parseKey(ym + '01'); const d = new Date(p.y, p.m - 1 - i, 1); const y2 = '' + d.getFullYear() + pad(d.getMonth() + 1); if (Object.keys(S.days).some((k) => k.slice(0, 6) === y2)) months.push(y2); }
    out.push('<h2 class="h2" style="padding:8px 4px 0">Летопись</h2><div class="card list">' + months.map((m) => '<button class="list-row" data-a="sheet" data-v="chron:' + m + '"><span class="star" style="width:32px;height:32px">' + I.star8.replace(/40/g, '32') + '</span><span class="col grow"><span style="font-size:15px;font-weight:800">' + MONTHS_NOM[+m.slice(4, 6) - 1] + ' ' + m.slice(0, 4) + '</span><span class="small sub">' + (m === ym ? 'текущий месяц, на сегодня' : 'итоги месяца') + '</span></span>' + I.chev + '</button>').join('') + '</div>');
    // знаки
    const vis = visibleBadges(), got = vis.filter((b) => badgeEarned(b, G)).length;
    out.push('<div class="between" style="padding:8px 4px 0"><h2 class="h2">Знаки</h2><span class="small sub num">' + got + ' из ' + vis.length + '</span></div>');
    Object.keys(CAT).forEach((c) => {
      const list = vis.filter((b) => b.cat === c); if (!list.length) return;
      out.push('<div class="eyebrow">' + CAT[c][0] + '</div><div class="gm-grid">' + list.map((b) => { const on = badgeEarned(b, G), v = Math.min(b.v(G), b.n); return '<button class="gm-cell' + (on ? ' on' : '') + '" data-a="sheet" data-v="badge:' + b.id + '">' + emblem(b, 64, on) + '<span class="gm-cell-t">' + b.t + '</span>' + (on ? '' : '<span class="bar" style="height:4px;width:70%"><span style="width:' + Math.round(v / b.n * 100) + '%;background:' + CAT[c][1] + '"></span></span>') + '</button>'; }).join('') + '</div>');
    });
    out.push('<div class="small sub" style="text-align:center;padding:6px 10px;line-height:1.5">Знаки видны только вам. Они отмечают постоянство, а не награду — её знает только Аллах.</div>');
    return out.join('');
  }

  /* --- летопись месяца --- */
  function monthStats(ym) {
    const t = todayKey(), y = +ym.slice(0, 4), m = +ym.slice(4, 6), n = new Date(y, m, 0).getDate();
    const keys = []; for (let d = 1; d <= n; d++) { const k = keyOf(y, m, d); if (k <= t) keys.push(k); }
    const R = { days: keys.length, marked: 0, cnt: { mosque: 0, jamaat: 0, done: 0, qada: 0, missed: 0 }, full: 0, best: 0, azM: 0, azE: 0, zikr: 0, fasts: 0, avg: null, first: keys[0], last: keys[keys.length - 1] };
    let run = 0; const sc = [];
    keys.forEach((k) => {
      const d = S.days[k];
      const full = !!d && fullDay(d);
      if (full) { R.full++; run++; R.best = Math.max(R.best, run); } else if (k !== t) run = 0;
      if (!d) return;
      PRAYERS.forEach((p) => { let st = d.f[p.id]; if (!st) return; R.marked++; if (st === 'juma') st = 'mosque'; R.cnt[st]++; });
      if (azDone(d, 'morning')) R.azM++;
      if (azDone(d, 'evening')) R.azE++;
      R.zikr += (d.z || []).reduce((a, b) => a + (b || 0), 0);
      if (d.p === 'fast' || d.p === 'qada') R.fasts++;
      const s = scores(k); if (s) sc.push(s.overall);
    });
    if (sc.length) R.avg = sc.reduce((a, b) => a + b, 0) / sc.length;
    R.badges = BADGES.filter((b) => (S.gam.seen[b.id] || '').slice(0, 6) === ym);
    return R;
  }
  function vChron(ym) {
    const R = monthStats(ym), y = +ym.slice(0, 4), m = +ym.slice(4, 6);
    const pd = new Date(y, m - 2, 1), pym = '' + pd.getFullYear() + pad(pd.getMonth() + 1);
    const P = Object.keys(S.days).some((k) => k.slice(0, 6) === pym) ? monthStats(pym) : null;
    const isCur = ym === todayKey().slice(0, 6);
    const hs = R.first ? hijri(R.first) : null, he = R.last ? hijri(R.last) : null;
    const hspan = hs ? (hs.m === he.m ? D.HIJRI_MONTHS_NOM[hs.m - 1] : D.HIJRI_MONTHS_NOM[hs.m - 1] + ' — ' + D.HIJRI_MONTHS_NOM[he.m - 1]) + ' ' + he.y : '';
    const tile = (v, l, c) => '<div class="stat"><b class="num"' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b><span class="small sub" style="font-weight:700">' + l + '</span></div>';
    const jam = R.cnt.mosque + R.cnt.jamaat;
    const better = [];
    if (P && P.days) {
      const per = (x, days) => x / Math.max(days, 1);
      if (R.avg !== null && P.avg !== null && R.avg - P.avg >= 0.03) better.push('средний итог выше на ' + Math.round((R.avg - P.avg) * 100) + '%');
      if (per(jam, R.days) - per(P.cnt.mosque + P.cnt.jamaat, P.days) > 0.15) better.push('больше намазов джамаатом');
      if (per(R.full, R.days) - per(P.full, P.days) > 0.08) better.push('больше дней постоянства');
      if (per(R.azM + R.azE, R.days) - per(P.azM + P.azE, P.days) > 0.15) better.push('чаще азкары');
      if (R.best > P.best && R.best >= 3) better.push('лучшая серия длиннее');
    }
    const lvl = S.set.level;
    let h = '<div class="grab"></div><div class="gm-chron-head"><span class="eyebrow" style="padding:0">Летопись' + (isCur ? ' · на сегодня' : '') + '</span><span class="big-serif" style="font-size:40px;line-height:1">' + MONTHS_NOM[m - 1] + ' ' + y + '</span><span class="small sub">' + hspan + '</span></div>';
    if (!R.marked && !R.zikr) return h + '<div class="card empty"><span style="font-size:15px;font-weight:800">В этом месяце пока нет отметок</span></div><button class="btn gold block" data-a="closeSheet">Закрыть</button>';
    h += '<div class="card gm-chron-hero"><span class="col" style="gap:4px"><span class="small sub" style="font-weight:700">Средний итог</span><span class="big-serif num" style="font-size:54px;line-height:1">' + pct(R.avg) + '</span></span><span class="col" style="align-items:flex-end;gap:2px"><span class="num" style="font-size:22px;font-weight:800">' + R.full + '</span><span class="small sub" style="text-align:right">' + plural(R.full, 'день', 'дня', 'дней') + ' постоянства<br>лучшая серия ' + R.best + '</span></span></div>';
    h += '<div class="tiles3">' + tile(R.marked + '<span class="sub" style="font-size:14px"> / ' + R.days * 5 + '</span>', 'намазов отмечено') + (lvl !== 'start' ? tile(R.cnt.mosque, 'в мечети', 'var(--gold-hi)') + tile(R.cnt.jamaat, 'джамаатом', 'var(--blue-text)') : tile(R.cnt.missed, 'пропущено')) + '</div>';
    if (lvl !== 'start') h += '<div class="tiles3">' + tile(R.azM + R.azE, 'азкаров (утро и вечер)') + tile(R.zikr >= 10000 ? (R.zikr / 1000).toFixed(1).replace('.0', '').replace('.', ',') + 'к' : R.zikr, 'зикров') + tile(lvl === 'ihsan' ? R.fasts : R.cnt.qada, lvl === 'ihsan' ? 'дней поста' : 'восполнено') + '</div>';
    if (R.badges.length) h += '<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span style="font-size:15px;font-weight:800">Новые знаки</span><div class="row" style="flex-wrap:wrap;gap:10px">' + R.badges.map((b) => '<span class="col" style="align-items:center;width:72px;gap:4px">' + emblem(b, 52, true) + '<span class="small" style="text-align:center;font-weight:700;line-height:1.2">' + b.t + '</span></span>').join('') + '</div></div>';
    h += '<div class="card pad" style="display:flex;flex-direction:column;gap:6px"><span style="font-size:15px;font-weight:800">' + (better.length ? 'Лучше, чем в прошлом месяце' : P ? 'Каждый месяц — новая возможность' : 'Первый месяц летописи') + '</span><span class="small sub" style="line-height:1.5">' + (better.length ? better.join(' · ') : P ? 'Не сравнивайте себя с другими — только с собой вчерашним.' : 'Со следующего месяца здесь появится сравнение.') + '</span></div>';
    h += '<div class="gm-dua"><p class="ar" lang="ar">اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ</p><p class="small">«О Аллах, помоги мне поминать Тебя, благодарить Тебя и наилучшим образом поклоняться Тебе»</p><p class="small sub">Абу Дауд 1522, ан-Насаи 1303</p></div>';
    return h + '<button class="btn gold block" data-a="closeSheet">Закрыть</button>';
  }

  function gamStart() {
    if (!gamOn() || !S.set.level) return;
    ensureGoal();
    if (!S.gam.init) { gamCheck(); return; }
    // летопись прошлого месяца — один раз при первом открытии в новом месяце
    const t = todayKey(), p = parseKey(t), pd = new Date(p.y, p.m - 2, 1), pym = '' + pd.getFullYear() + pad(pd.getMonth() + 1);
    if (S.gam.chron !== pym && !S.sheet && Object.keys(S.days).some((k) => k.slice(0, 6) === pym)) { S.gam.chron = pym; saveGam(); S.sheet = { type: 'chron', id: pym }; render(); return; }
    if (S.gam.chron !== pym) { S.gam.chron = pym; saveGam(); }
    gamCheck();
  }
  /* ===== план чтения: тафсир ас-Саади (и любая другая книга) =====
     Хранится в облаке Telegram под ключом «read»: книга, тома, начало, срок, позиция и сколько страниц прочитано по дням.
     Дневная норма пересчитывается сама: прочитали больше — завтра меньше, пропустили день — норма мягко растёт. */
  const BOOKS = { saadi: { title: 'Тафсир ас-Саади', ed: 'Эксмо, 3 тома', vols: [784, 784, 736] } };
  const dayNum = (k) => { const p = parseKey(k); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 864e5); };
  const rTotal = (R) => R.vols.reduce((a, b) => a + b, 0);
  function rWhere(R, p) {
    p = clamp(Math.round(p), 1, rTotal(R));
    let i = 0, acc = 0;
    while (i < R.vols.length - 1 && p > acc + R.vols[i]) { acc += R.vols[i]; i++; }
    return [i + 1, p - acc];
  }
  const rLabel = (R, p) => { const w = rWhere(R, p); return (R.vols.length > 1 ? 'т. ' + w[0] + ', ' : '') + 'с. ' + w[1]; };
  function rRange(R, a, b) {
    const A = rWhere(R, a), B = rWhere(R, b);
    if (A[0] === B[0]) return (R.vols.length > 1 ? 'т. ' + A[0] + ', ' : '') + 'с. ' + A[1] + (b > a ? '–' + B[1] : '');
    return rLabel(R, a) + ' — ' + rLabel(R, b);
  }
  function rState() {
    const R = S.read;
    if (!R || !R.vols || !R.start) return null;
    const t = todayKey(), total = rTotal(R), di = dayNum(t) - dayNum(R.start) + 1;
    const end = addDays(R.start, R.days - 1);
    const pos = clamp(R.pos || 0, 0, total);
    const readToday = Math.max(0, (R.log || {})[t] || 0);
    const base = Math.ceil(total / R.days);
    if (di < 1) return { R, total, pos, before: true, end, di, readToday: 0, norm: base, left: base, base };
    const posStart = Math.max(0, pos - readToday);
    const remDays = Math.max(1, R.days - di + 1);
    const norm = Math.max(0, Math.ceil((total - posStart) / remDays));
    const planned = Math.min(total, Math.round(total * Math.min(di, R.days) / R.days));
    return { R, total, pos, posStart, di, end, base, norm, left: Math.max(0, norm - readToday), readToday, planned, ahead: pos - planned, done: pos >= total, over: di > R.days };
  }
  function saveRead() { if (S.read) S.read.u = nowSec(); dirty.read = true; dataVer++; schedule(); gamCheckSoon(); }
  function readApply(delta, note, soft) {
    const R = S.read, st = rState();
    if (!R || !st || st.before) { toast('План начнётся ' + fmtDate(R.start)); return; }
    const t = todayKey(), total = st.total, was = st.readToday, wasNorm = st.norm;
    const np = clamp(st.pos + delta, 0, total);
    delta = np - st.pos;
    if (!delta) return;
    R.pos = np;
    R.log = R.log || {};
    R.log[t] = Math.max(0, (R.log[t] || 0) + delta);
    if (!R.log[t]) delete R.log[t];
    let keys = Object.keys(R.log).sort();
    while (JSON.stringify(R).length > 3800 && keys.length > 1) { delete R.log[keys.shift()]; }
    if (np >= total && !R.done) { R.done = t; haptic('notify', 'success'); toast('Тафсир прочитан целиком — машаАллах!'); }
    else if (was < wasNorm && R.log[t] >= wasNorm) { haptic('notify', 'success'); toast('Норма на сегодня выполнена — машаАллах'); }
    else if (note) { haptic('impact', 'light'); toast(note); }
    saveRead(); if (soft) qPillRefresh(); else render();
  }
  const READ_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>';
  function vReadSheet(sh, head) {
    const st = rState();
    if (!st) {
      const days = sh.days || 90, when = sh.when || (new Date().getHours() >= 18 ? 'tomorrow' : 'today');
      const bk = sh.book || 'saadi';
      const start = when === 'tomorrow' ? addDays(todayKey(), 1) : todayKey();
      const total = bk === 'saadi' ? rTotal(BOOKS.saadi) : (sh.pages || 300);
      return head('План чтения', 'Чтение по силам каждый день — постоянство важнее скорости') +
        '<div class="seg mini" role="group" aria-label="Книга"><button class="' + (bk === 'saadi' ? 'on' : '') + '" data-a="readBook" data-v="saadi">Тафсир ас-Саади</button><button class="' + (bk === 'custom' ? 'on' : '') + '" data-a="readBook" data-v="custom">Другая книга</button></div>' +
        (bk === 'saadi' ? '<div class="small sub" style="padding:0 6px;line-height:1.5">«Тайсир аль-Карим ар-Рахман», издание «Эксмо» в 3 томах: 784 + 784 + 736 = 2 304 страницы. Если у вас другое издание — выберите «Другая книга» и укажите число страниц.</div>'
          : '<label class="search" style="gap:8px"><span class="sr">Название</span><input data-in="rdTitle" placeholder="Название книги" value="' + esc(sh.title || '') + '"></label><label class="search" style="gap:8px"><span class="sr">Страниц</span><input data-in="rdPages" type="number" inputmode="numeric" min="10" max="20000" placeholder="Сколько страниц" value="' + (sh.pages || '') + '"></label>') +
        '<div class="col" style="gap:8px;padding:4px 6px"><span style="font-size:15px;font-weight:700">Срок</span><div class="seg mini" role="group" aria-label="Срок">' + [40, 60, 90].map((n) => '<button class="' + (days === n ? 'on' : '') + '" data-a="readDays" data-v="' + n + '">' + n + ' дней</button>').join('') + '</div></div>' +
        '<div class="col" style="gap:8px;padding:4px 6px"><span style="font-size:15px;font-weight:700">Начало</span><div class="seg mini" role="group" aria-label="Начало"><button class="' + (when === 'today' ? 'on' : '') + '" data-a="readWhen" data-v="today">Сегодня</button><button class="' + (when === 'tomorrow' ? 'on' : '') + '" data-a="readWhen" data-v="tomorrow">Завтра</button></div></div>' +
        '<div class="card pad" style="display:flex;flex-direction:column;gap:4px"><span class="num" style="font-family:var(--serif);font-size:34px;font-weight:700;color:var(--gold-hi);line-height:1">' + Math.ceil(total / days) + ' стр. в день</span><span class="small sub">с ' + fmtDate(start) + ' по ' + fmtDate(addDays(start, days - 1)) + (addDays(start, days - 1).slice(0, 4) !== start.slice(0, 4) ? ' ' + addDays(start, days - 1).slice(0, 4) : '') + ' · удобно разделить на 5 частей — после каждого намаза</span></div>' +
        '<button class="btn gold block" data-a="readStart">Начать с намерением</button><button class="btn ghost block" data-a="closeSheet">Не сейчас</button>';
    }
    const R = st.R, t = todayKey();
    const days14 = st.before ? [] : Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
    const mx = Math.max(st.base * 1.5, ...days14.map((k) => (R.log || {})[k] || 0), 1);
    const bars = days14.length ? '<div class="rd-bars" aria-label="Страниц по дням">' + days14.map((k) => { const v = (R.log || {})[k] || 0; return '<span class="rd-bar' + (k === t ? ' on' : '') + (k < R.start ? ' off' : '') + '" title=""' + fmtDate(k) + ': ' + v + '"><i style="height:' + Math.round(v / mx * 100) + '%"></i><b class="num">' + (v || '') + '</b></span>'; }).join('') + '</div><div class="between small sub"><span>' + fmtDate(days14[0]) + '</span><span>сегодня</span></div>' : '';
    const status = st.done ? 'Прочитан целиком ' + fmtDate(R.done) + '. Пусть Аллах сделает это знание полезным.'
      : st.before ? 'План начнётся ' + fmtDate(R.start) + '. Первая норма — ' + rRange(R, 1, st.base) + '.'
      : st.ahead >= 0 ? (st.ahead > 0 ? 'Вы опережаете план на ' + st.ahead + ' стр., поэтому норма стала меньше.' : 'Вы точно по плану.')
      : 'Чтобы закончить к ' + fmtDate(st.end) + ', нужно ' + st.norm + ' стр. в день. Это нормально — главное продолжать.';
    const w = rWhere(R, Math.max(1, st.pos)), day = tfToday(st), sa = isSaadi(R), rg = sa ? readG(R) : -1;
    return head(esc(R.title), (R.ed ? esc(R.ed) + ' · ' : '') + R.days + ' дней · ' + fmtDate(R.start) + ' — ' + fmtDate(st.end)) +
      (st.done || st.before ? '' :
        '<div class="card pad" style="display:flex;flex-direction:column;gap:6px"><span class="small sub" style="font-weight:700">Сегодня · день ' + Math.min(st.di, R.days) + ' из ' + R.days + '</span>' +
        '<span class="num" style="font-family:var(--serif);font-size:' + (st.left ? 40 : 30) + 'px;font-weight:700;line-height:1;color:' + (st.left ? 'var(--gold-hi)' : 'var(--emerald-text)') + '">' + (st.left ? st.left + ' стр.' : 'Норма выполнена') + '</span>' +
        '<span class="small" style="font-weight:700">' + (st.left ? rRange(R, st.pos + 1, st.posStart + st.norm) : 'Прочитано сегодня ' + st.readToday + ' стр.') + '</span>' +
        (st.left && day && day.to >= 0 ? '<span class="small" style="font-weight:700">' + ayRange(day.from, day.to) + '</span>' : '') +
        (st.left ? '<span class="small sub">прочитано сегодня ' + st.readToday + ' из ' + st.norm + '</span>' : '') + '</div>' +
        (sa ? '<button class="btn gold block" data-a="readOpen">' + READ_ICON + (st.left ? 'Читать в приложении' : 'Читать дальше') + '</button><span class="small sub" style="padding:0 6px;line-height:1.5">В приложении отмечайте «Прочитал до сюда» — страницы посчитаются сами. Читаете по бумажной книге — отмечайте ниже.</span>' : '') +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' + (st.left ? '<button class="btn ' + (sa ? 'ghost' : 'gold') + ' grow" data-a="readAdd" data-v="norm">Прочитал норму</button>' : '') +
        [1, 5, 10].map((n) => '<button class="btn ghost" data-a="readAdd" data-v="' + n + '">+' + n + '</button>').join('') + '<button class="btn ghost" data-a="readAdd" data-v="-1" aria-label="Минус одна страница">−1</button></div>' +
        '<div class="col" style="gap:8px;padding:4px 2px"><span style="font-size:15px;font-weight:700">Или укажите, где вы сейчас</span>' +
        (R.vols.length > 1 ? '<div class="seg mini" role="group" aria-label="Том">' + R.vols.map((_, i) => '<button class="' + ((sh.vol || w[0]) === i + 1 ? 'on' : '') + '" data-a="readVol" data-v="' + (i + 1) + '">Том ' + (i + 1) + '</button>').join('') + '</div>' : '') + '<div class="row" style="gap:8px">' +
        '<label class="search" style="flex:1;min-width:96px"><span class="sr">Страница</span><input data-in="rdPage" type="number" inputmode="numeric" min="0" placeholder="стр. ' + w[1] + '"></label><button class="btn ghost" data-a="readSetPage">Готово</button></div></div>') +
      '<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="between"><span style="font-size:15px;font-weight:800">Весь путь</span><span class="small num" style="font-weight:800">' + Math.floor(st.pos / st.total * 100) + '%</span></div><span class="bar" style="height:8px"><span style="width:' + (st.pos / st.total * 100).toFixed(1) + '%"></span></span><span class="small sub num">Прочитано ' + st.pos + ' из ' + st.total + (st.pos ? ' · сейчас ' + rLabel(R, st.pos) + (rg >= 0 ? ' · ' + ayName(rg) : '') : '') + '</span><span class="small" style="line-height:1.5">' + status + '</span>' + bars + '</div>' +
      '<div class="small sub" style="padding:2px 6px;line-height:1.5">Совет: разделите норму на 5 частей и читайте понемногу после каждого намаза.</div>' +
      (sh.stop ? '<button class="btn block" style="background:var(--rose-soft);color:var(--rose)" data-a="readStop" data-v="yes">Точно завершить план?</button>' : '<button class="btn ghost block" data-a="readStop">Завершить план</button>') +
      '<button class="btn gold block" data-a="closeSheet">Готово</button>';
  }

  /* ===== тафсир ас-Саади внутри приложения =====
     Толкование (перевод Э. Кулиева) загружается по сурам из открытого набора spa5k/tafsir_api (ресурс 36 библиотеки QUL / Tarteel),
     закреплённого на одной версии, и сохраняется на устройстве. В репозитории приложения сам текст тафсира не хранится.
     saadi-index.js — только объём чтения по аятам: по нему аяты пересчитываются в страницы книги «Эксмо» и обратно. */
  const TF_REV = 'eb82bb6294efe30ad5c135c03b1864afaa70e855';
  const TF_SRC = ['https://raw.githubusercontent.com/spa5k/tafsir_api/' + TF_REV + '/tafsir/ru-tafseer-al-saddi/', 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@' + TF_REV + '/tafsir/ru-tafseer-al-saddi/'];
  const TF_CHUNK = 14000; // одна порция чтения — около 6 страниц книги
  let SAI = null;
  function sai() {
    if (SAI) return SAI;
    const idx = window.SAADI_INDEX;
    if (!idx || idx.length !== 114) return null;
    const st = [], cum = [0];
    idx.forEach((arr) => { st.push(cum.length - 1); arr.forEach((w) => cum.push(cum[cum.length - 1] + w)); });
    SAI = { st, cum, n: cum.length - 1, W: cum[cum.length - 1] };
    return SAI;
  }
  const gOf = (s, a) => sai().st[s - 1] + a - 1; // сквозной номер аята 0…6235
  function gAyah(g) { const st = sai().st; let lo = 0, hi = 113; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m] <= g) lo = m; else hi = m - 1; } return [lo + 1, g - st[lo] + 1]; }
  const isSaadi = (R) => !!(R && R.book === 'saadi' && R.vols && sai());
  const gPage = (R, g) => sai().cum[g + 1] / sai().W * rTotal(R); // страниц книги «закрыто» после аята g
  function gUpTo(R, p) { // последний аят, целиком прочитанный к странице p (−1 — ещё ничего)
    const X = sai();
    if (p >= rTotal(R)) return X.n - 1;
    const lim = p / rTotal(R) * X.W + 1e-6; let lo = -1, hi = X.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (X.cum[m + 1] <= lim) lo = m; else hi = m - 1; }
    return lo;
  }
  function gReach(R, p) { // аят, дочитав до которого, вы «закроете» страницу p
    const X = sai(), lim = (p - 0.49) / rTotal(R) * X.W; let lo = 0, hi = X.n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (X.cum[m + 1] >= lim) hi = m; else lo = m + 1; }
    return lo;
  }
  function readG(R) { // последний прочитанный аят по плану
    if (!isSaadi(R) || !R.pos) return -1;
    if (R.at != null && R.at >= 0 && R.at < sai().n && Math.round(gPage(R, R.at)) === R.pos) return R.at;
    return gUpTo(R, R.pos);
  }
  const ayName = (g) => { const x = gAyah(g); return D.SURAH_RU[x[0] - 1] + ' ' + x[1]; };
  function ayRange(a, b) {
    if (b <= a) return ayName(a);
    const x = gAyah(a), y = gAyah(b);
    return x[0] === y[0] ? D.SURAH_RU[x[0] - 1] + ' ' + x[1] + '–' + y[1] : ayName(a) + ' — ' + ayName(b);
  }
  function tfToday(st) { // аяты сегодняшней нормы: { from, to }; to = −1, если норма выполнена
    if (!st || !isSaadi(st.R) || st.done) return null;
    const R = st.R, from = Math.min(readG(R) + 1, sai().n - 1);
    if (st.before) return { from: 0, to: gReach(R, st.base) };
    return { from, to: st.left > 0 ? Math.max(from, gReach(R, st.posStart + st.norm)) : -1 };
  }
  let tfConfirm = null;
  function readTo(g, quiet) { // отметить «прочитал до аята g»; false — ждём подтверждения; quiet = 'auto' — засчитано само по ходу чтения
    const R = S.read, st = rState();
    if (!isSaadi(R) || !st) return true;
    if (st.before) { if (quiet !== 'auto') toast('План начнётся ' + fmtDate(R.start)); return false; }
    const cur = readG(R);
    if (quiet === 'auto') {
      if (g <= cur) return true;
      const np = clamp(Math.round(gPage(R, g)), 0, st.total);
      R.at = g; tfConfirm = null;
      if (np <= st.pos) { saveRead(); qPillRefresh(); return true; }
      readApply(np - st.pos, '', true);
      return true;
    }
    if (g === cur) { if (!quiet) toast('Вы остановились здесь'); return true; }
    const np = clamp(Math.round(gPage(R, g)), 0, st.total), jump = np - st.pos;
    if (g < cur || jump > Math.max(60, st.norm * 2)) {
      if (!(tfConfirm && tfConfirm.g === g && Date.now() - tfConfirm.t < 6000)) {
        tfConfirm = { g, t: Date.now() };
        haptic('notify', 'warning');
        toast(g < cur ? 'Нажмите ещё раз, чтобы вернуть отметку на ' + ayName(g) : 'Это сразу +' + jump + ' стр. к плану. Нажмите ещё раз, чтобы подтвердить');
        return false;
      }
    }
    tfConfirm = null;
    R.at = g;
    if (!jump) { saveRead(); haptic('select'); if (!quiet) toast('Отмечено: ' + ayName(g)); else render(); return true; }
    readApply(jump, quiet ? '' : 'Отмечено до ' + ayName(g) + (jump > 0 ? ' · +' + jump + ' стр.' : ''));
    return true;
  }
  /* загрузка и разбор текста суры */
  const tfMem = {}, tfOrder = [];
  function tfParse(arr, s) {
    const n = D.SURAH_AYAHS[s - 1], by = {};
    (Array.isArray(arr) ? arr : (arr && arr.ayahs) || []).forEach((x) => { if (x && x.ayah) by[+x.ayah] = String(x.text || '').trim(); });
    const groups = [], gi = new Array(n + 1).fill(0);
    for (let a = 1; a <= n;) {
      const t = by[a] || ''; let b = a;
      while (b < n && t && by[b + 1] === t) b++;
      for (let k = a; k <= b; k++) gi[k] = groups.length;
      groups.push({ f: a, t: b, text: t });
      a = b + 1;
    }
    return { groups, gi };
  }
  async function tfFetch(s) {
    if (tfMem[s]) return tfMem[s];
    const data = await cachedJson(TF_SRC.map((u) => u + s + '.json'), TF_SRC[0] + s + '.json', 25000, 'ibada-tafsir-v1');
    const tf = tfParse(data, s);
    if (!tf.groups.some((x) => x.text)) throw new Error('empty');
    tfMem[s] = tf; tfOrder.push(s);
    while (tfOrder.length > 4) delete tfMem[tfOrder.shift()];
    return tf;
  }
  const tfSize = (g) => g.text.length + 150 * (g.t - g.f + 1);
  function tfSpanFwd(tf, k) { const G = tf.groups; let acc = 0; for (; k < G.length - 1; k++) { acc += tfSize(G[k]); if (acc >= TF_CHUNK) break; } return Math.min(k, G.length - 1); }
  function tfSpanBack(tf, k) { const G = tf.groups; let acc = 0; for (; k > 0; k--) { acc += tfSize(G[k]); if (acc >= TF_CHUNK) break; } return Math.max(k, 0); }
  function tfInitWin(R) { const tf = R.tf, k0 = tf.gi[clamp(R.a || 1, 1, tf.gi.length - 1)] || 0; R.win = [k0, tfSpanFwd(tf, k0)]; }
  function tfExtend(R) {
    const G = R.tf.groups;
    if (R.win[1] >= G.length - 1) return;
    const k1 = tfSpanFwd(R.tf, R.win[1] + 1);
    let k0 = R.win[0], tot = 0;
    for (let k = k0; k <= k1; k++) tot += tfSize(G[k]);
    while (tot > 3 * TF_CHUNK && k0 < R.win[1]) { tot -= tfSize(G[k0]); k0++; } // держим на экране не больше ~3 порций
    R.win = [k0, k1];
  }
  function tfEnsure(R) {
    if (!R || R.tf === 'loading' || (R.tf && R.tf.groups)) return;
    R.tf = 'loading';
    tfFetch(R.s).then((tf) => {
      if (S.quran.reader !== R) return;
      R.tf = tf; tfInitWin(R); render(); readerScroll(R);
    }, () => { if (S.quran.reader !== R) return; R.tf = 'error'; render(); });
  }
  function readerScroll(R) { // прокрутить к нужному аяту, когда всё загружено
    if (!R || !R.go || R.loading || (R.mode === 'tf' && !(R.tf && R.tf.groups))) return;
    const el = document.getElementById('ay' + R.go); R.go = 0; rdJump = Date.now();
    if (el) el.scrollIntoView({ block: 'start' });
  }
  function keepAnchor(id, fn) { // перерисовать, не сдвигая то, что человек сейчас видит
    rdJump = Date.now();
    const sc = $('#scroll'), el = id ? document.getElementById(id) : null, y = el ? el.getBoundingClientRect().top : null;
    fn();
    const el2 = id ? document.getElementById(id) : null;
    if (y !== null && el2) sc.scrollTop += el2.getBoundingClientRect().top - y;
  }
  function tfParas(t) { // длинное толкование — на абзацы по ~500 знаков, по границам предложений
    const out = [], re = /[.!?…][»")]*\s+(?=[«"(А-ЯЁA-Z0-9—–-])/g; let last = 0, m;
    while ((m = re.exec(t))) { const end = m.index + m[0].length; if (end - last >= 480) { out.push(t.slice(last, end).trim()); last = end; } }
    if (last < t.length) out.push(t.slice(last).trim());
    return out.filter(Boolean);
  }
  function vTafsir(R) {
    const s = R.s, r = rd();
    if (R.tf === 'error') return '<div class="qpad"><div class="card pad" style="display:flex;flex-direction:column;gap:10px;margin-top:16px"><span style="font-weight:800">Не удалось загрузить тафсир</span><span class="small sub">Проверьте подключение к интернету. Сура, которую вы уже открывали, потом читается и без сети.</span><button class="btn gold sm" data-a="tfRetry">Попробовать снова</button><button class="btn ghost sm" data-a="qMode" data-v="tr">Читать перевод</button></div></div>';
    if (!R.tf || !R.tf.groups || !R.win) return '<div class="qload">Загружаю тафсир…</div>';
    const G = R.tf.groups, k0 = R.win[0], k1 = R.win[1], base = gOf(s, 1) - 1, out = [];
    const tp = tfPlan(), plan = tp && !tp.st.done ? tp : null, manual = !r.auto, cur = plan ? tp.cur : -1;
    const ne = plan && !plan.st.before ? gReach(plan.P, plan.st.posStart + plan.st.norm) : -1, normOk = !!(plan && !plan.st.before && plan.st.left === 0);
    const showRu = r.ru && !!R.ru, showAr = r.ar || !showRu, marks = S.set.qmarks || [];
    if (k0 > 0) out.push('<div class="qpad" style="margin-top:12px"><button class="btn ghost sm block" data-a="tfPrev">↑ Аяты ' + G[tfSpanBack(R.tf, k0 - 1)].f + '–' + G[k0 - 1].t + '</button></div>');
    else out.push(vSurahHead(s));
    out.push(qRuNote(R));
    for (let k = k0; k <= k1; k++) {
      const g = G[k], gEnd = base + g.t;
      let h = '<section class="qg" id="tfg' + k + '" data-k="' + k + '">';
      for (let a = g.f; a <= g.t; a++) h += qAyah(R, a, showAr, showRu, marks);
      if (g.text) h += '<div class="qtf"><div class="qtf-l">' + (g.t > g.f ? 'Толкование аятов ' + g.f + '–' + g.t : 'Толкование') + '</div>' + tfParas(tfTypo(g.text)).map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>';
      if (plan && manual && !plan.st.before) {
        const done = gEnd <= cur;
        h += '<div class="qtf-foot"><button class="tf-mark' + (done ? ' on' : '') + '" data-a="tfMark" data-v="' + s + ':' + g.t + '" data-nohap aria-pressed="' + done + '">' + (done ? I.check + 'Прочитано' : 'Прочитал до сюда') + '</button></div>';
      }
      out.push(h + '</section>');
      if (plan && manual && cur >= base + g.f && cur <= gEnd && cur < sai().n - 1) out.push('<div class="tf-line qpad">здесь вы остановились</div>');
      if (ne >= base + g.f && ne <= gEnd) out.push('<div class="qnorm' + (normOk ? ' done' : '') + '">' + I.check + '<span><b>' + (normOk ? 'Норма на сегодня выполнена' : 'Норма на сегодня — до сюда') + '</b><small>' + (normOk ? 'МашаАллах. Можно читать дальше — завтра будет меньше' : 'Можно остановиться здесь или читать дальше') + '</small></span></div>');
    }
    const last = G[k1], atEnd = k1 >= G.length - 1, unread = !!(plan && !plan.st.before && base + last.t > cur), btns = [];
    if (!atEnd) btns.push(manual && unread ? '<button class="btn gold block" data-a="tfNext" data-nohap>Прочитал до аята ' + last.t + ' — дальше</button><button class="btn ghost block" data-a="tfMore">Дальше без отметки</button>' : '<button class="btn ghost block" data-a="tfMore">Читать дальше</button>');
    else if (manual && unread) btns.push('<button class="btn gold block" data-a="tfNext" data-nohap>' + (s < 114 ? 'Прочитал суру — к следующей' : 'Прочитал до конца') + '</button>');
    if (btns.length) out.push('<div class="qpad col" style="gap:8px;margin-top:14px">' + btns.join('') + '</div>');
    if (atEnd) out.push(vQNext(R));
    if (!S.read) out.push('<div class="qpad" style="margin-top:12px"><button class="card pad tf-cont" data-a="sheet" data-v="read"><span class="rd-ico">' + READ_ICON + '</span><span class="col grow" style="gap:3px"><span style="font-size:15px;font-weight:800">Читать по плану</span><span class="small sub">Поставьте цель — приложение поведёт по аятам и посчитает страницы</span></span>' + I.chev + '</button></div>');
    out.push('<div class="small sub tf-src qpad">Тафсир ас-Саади «Тайсир аль-Карим ар-Рахман», перевод Э. Кулиева. Текст загружается из открытой библиотеки QUL (Tarteel) и сохраняется на телефоне.</div>');
    return out.join('');
  }

  /* ===== цели по Корану и заучивание наизусть (v13) =====
     Цель считается сурами: «прочитать» (на арабском, в переводе или с тафсиром) или «выучить наизусть». Целей может быть несколько сразу.
     Отмечать суры можно в читалке (в конце суры) и вручную — например, когда читаете по бумажному мусхафу.
     Срок необязателен. Если он есть, план распределяется по объёму сур (числу букв), а не поровну по сурам: аль-Бакара больше ан-Нас.
     Выученные суры возвращаются на повторение через растущие промежутки (1, 3, 7, 14, 30, 60 дней); если были ошибки — снова завтра.
     Данные — ключи qg (цели) и hz (суры наизусть) в облаке Telegram. В таблицу и бота пока не передаются. */
  // объём каждой суры: число арабских букв / 10 (посчитано по тексту мусхафа в папке quran/)
  const QW = [14,2590,1475,1608,1203,1256,1424,535,1094,751,772,720,349,349,283,771,656,649,387,533,498,524,440,566,383,556,474,586,425,343,213,154,567,354,318,302,382,302,478,504,333,347,355,145,205,263,239,248,151,149,152,130,142,146,166,172,250,201,193,154,95,76,79,107,118,107,133,126,111,95,95,110,85,103,67,108,82,78,77,55,43,33,75,44,46,25,30,38,58,34,25,31,16,10,16,29,11,40,16,16,16,13,7,14,10,8,11,4,10,8,8,5,7,8];
  const QW_PAGE = 54; // столько единиц объёма в одной странице мусхафа (≈ 540 букв)
  const HZ_INT = [1, 3, 7, 14, 30, 60];
  const QG_MODE = { ar: 'на арабском', tr: 'в переводе', tf: 'с тафсиром' };
  const QG_MAX = 12;
  const diffDays = (a, b) => Math.round((dateOfKey(b) - dateOfKey(a)) / 864e5);
  const fmtDateY = (k) => fmtDate(k) + (k.slice(0, 4) !== todayKey().slice(0, 4) ? ' ' + k.slice(0, 4) : '');
  const surahsLabel = (n) => n + ' ' + plural(n, 'сура', 'суры', 'сур');
  const ofSurahs = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'суры' : 'сур'); // «3 из 37 сур», «1 из 1 суры»
  const qgList = () => (S.qg && S.qg.g) || [];
  // поиск суры без учёта дефисов, пробелов и «йа/я»: «ясин» находит «Йа Син», «мульк» — «Аль-Мульк»
  const sNorm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '').replace(/йа/g, 'я').replace(/йу/g, 'ю');
  const qgById = (id) => qgList().find((g) => g.id === id);
  const qgNewId = () => { let id; do { id = 'g' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4); } while (qgById(id)); return id; };
  const qgShown = () => qgList().filter((g) => !g.fin || g.fin === todayKey());
  const qgOld = () => qgList().filter((g) => g.fin && g.fin !== todayKey());
  const qgMode = (g) => (g.m === 'tf' && !sai() ? 'tr' : g.m || 'ar');
  const hzOf = (s) => (S.hz && S.hz.s[s]) || [0, 0, 0, ''];
  const qgDone = (g, s) => (g.k === 'hifz' ? hzOf(s)[0] === 2 : bitHas(g.d, s));
  function bitHas(h, s) { const i = s - 1, c = parseInt((h || '').charAt(i >> 2) || '0', 16); return !!(c & (1 << (i & 3))); }
  function bitPut(h, s, on) {
    h = (h || '').padEnd(29, '0');
    const i = s - 1, j = i >> 2, c = parseInt(h.charAt(j), 16) || 0, n = on ? c | (1 << (i & 3)) : c & ~(1 << (i & 3));
    return h.slice(0, j) + n.toString(16) + h.slice(j + 1);
  }
  function saveQg() {
    S.qg.u = nowSec();
    // в облаке Telegram на ключ — до 4 096 знаков: если не помещается, убираем самые старые выполненные цели
    while (JSON.stringify(S.qg).length > 3900) {
      const i = S.qg.g.findIndex((g) => g.fin);
      if (i < 0) break;
      S.qg.g.splice(i, 1);
    }
    dirty.qg = true; dataVer++; schedule();
  }
  function saveHz() { S.hz.u = nowSec(); dirty.hz = true; dataVer++; schedule(); }
  function qgSurahs(g) {
    const sc = g.sc || 'all'; let out = [];
    if (sc === 'all') for (let s = 1; s <= 114; s++) out.push(s);
    else if (sc.slice(0, 2) === 'r:') { const p = sc.slice(2).split('-'), a = clamp(+p[0] || 1, 1, 114), b = clamp(+p[1] || 114, a, 114); for (let s = a; s <= b; s++) out.push(s); }
    else out = Array.from(new Set(sc.slice(2).split(',').map(Number).filter((s) => s >= 1 && s <= 114))).sort((x, y) => x - y);
    if (g.rev) out.reverse();
    return out;
  }
  function qgScopeLabel(g) {
    const sc = g.sc || 'all';
    if (sc === 'all') return 'весь Коран';
    if (sc === 'r:78-114') return 'джуз Амма';
    const L = qgSurahs({ sc });
    if (L.length === 1) return D.SURAH_RU[L[0] - 1];
    if (sc.slice(0, 2) === 'r:') return 'суры ' + L[0] + '–' + L[L.length - 1];
    if (L.length <= 3) return L.map((s) => D.SURAH_RU[s - 1]).join(', ');
    return surahsLabel(L.length);
  }
  function qgTitle(g) {
    if (g.t) return g.t;
    if (g.k === 'hifz') return 'Наизусть: ' + qgScopeLabel(g);
    if ((g.sc || 'all') === 'all') return { ar: 'Хатм Корана', tr: 'Весь Коран в переводе', tf: 'Весь Коран с тафсиром' }[g.m] || 'Хатм Корана';
    return 'Прочитать: ' + qgScopeLabel(g);
  }
  function qgStat(g) {
    const list = qgSurahs(g), t = todayKey();
    let wAll = 0, wDone = 0, n = 0, next = 0, learn = 0;
    list.forEach((s) => {
      const w = QW[s - 1]; wAll += w;
      if (qgDone(g, s)) { wDone += w; n++; return; }
      if (g.k === 'hifz') { const h = hzOf(s); if (h[0] === 1) { wDone += w * clamp(h[1] / D.SURAH_AYAHS[s - 1], 0, 0.99); if (!learn) learn = s; } }
      if (!next) next = s;
    });
    const st = { list, total: list.length, n, wAll, wDone, frac: wAll ? wDone / wAll : 0, next, learn, done: list.length > 0 && n === list.length };
    if (g.dl && !st.done) {
      // план идёт от ps (начало плана или день смены срока) и делит только то, что оставалось на тот день (b)
      const ps = g.ps || g.st, b = Math.min(g.b || 0, wAll);
      const days = Math.max(1, diffDays(ps, g.dl) + 1), el = clamp(diffDays(ps, t) + 1, 0, days);
      st.days = days; st.di = el; st.over = t > g.dl; st.left = Math.max(1, diffDays(t, g.dl) + 1);
      st.target = b + (wAll - b) * el / days; st.prev = b + (wAll - b) * Math.max(0, el - 1) / days;
      let cum = 0; st.plan = list[list.length - 1];
      for (const s of list) { cum += QW[s - 1]; if (cum >= st.target - 0.5) { st.plan = s; break; } }
      st.ok = wDone >= st.target - 0.5;
      st.ahead = wDone - st.target;
      if (g.k === 'hifz') {
        let ay = 0; list.forEach((s) => { const h = hzOf(s); if (h[0] !== 2) ay += D.SURAH_AYAHS[s - 1] - (h[0] === 1 ? h[1] : 0); });
        st.ayDay = Math.max(1, Math.ceil(ay / st.left));
      } else st.pgDay = (wAll - wDone) / st.left / QW_PAGE;
    }
    return st;
  }
  const pagesApprox = (w) => { const p = w / QW_PAGE; return p < 0.75 ? 'меньше страницы' : '≈ ' + Math.max(1, Math.round(p)) + ' стр.'; };
  const pgDayLabel = (p) => '≈ ' + (p < 3 ? String(Math.max(0.1, Math.round(p * 10) / 10)).replace('.', ',') : Math.round(p)) + ' стр. в день';
  function qgPlanLine(g, st) {
    if (!st.days) return '';
    const name = '«' + D.SURAH_RU[st.plan - 1] + '»';
    if (st.over) return 'Срок прошёл ' + fmtDateY(g.dl) + '. Можно продлить его — главное продолжать.';
    if (st.ahead > (st.target - st.prev)) return 'Вы опережаете план. МашаАллах — можно идти в своём темпе.';
    if (st.ok) return 'Сегодня вы по плану.';
    if (st.wDone >= st.prev - 0.5) return 'Сегодня по плану — ' + (g.k === 'hifz' ? 'выучить до ' : 'дочитать до ') + name + ' включительно.';
    return 'Чтобы успеть к ' + fmtDateY(g.dl) + ', ' + (g.k === 'hifz' ? 'нужно ' + st.ayDay + ' ' + plural(st.ayDay, 'аят', 'аята', 'аятов') + ' в день' : 'нужно ' + pgDayLabel(st.pgDay)) + '. Это нормально — главное продолжать.';
  }
  function qgCheckFin(g) {
    const st = qgStat(g);
    if (st.done && !g.fin) { g.fin = todayKey(); return 1; }
    if (!st.done && g.fin) g.fin = '';
    return 0;
  }
  function qgFinished(n) { if (!n) return; haptic('notify', 'success'); toast(n > 1 ? 'Цели выполнены — МашаАллах!' : 'Цель выполнена — МашаАллах! Пусть Аллах примет'); }
  /* наизусть: [состояние 0 — не начата, 1 — учу, 2 — выучена; выучено аятов; ступень повторения; день последнего повторения] */
  const hzNext = (h) => (h[3] ? addDays(h[3], HZ_INT[clamp(h[2] || 0, 0, HZ_INT.length - 1)]) : todayKey());
  function hzDue() {
    const t = todayKey(), out = [];
    Object.keys((S.hz && S.hz.s) || {}).forEach((k) => { const h = S.hz.s[k]; if (h[0] === 2 && hzNext(h) <= t) out.push(+k); });
    return out.sort((a, b) => (hzNext(hzOf(a)) < hzNext(hzOf(b)) ? -1 : hzNext(hzOf(a)) > hzNext(hzOf(b)) ? 1 : a - b));
  }
  const hzRevToday = () => (S.hz && S.hz.rv && S.hz.rv.k === todayKey() ? S.hz.rv.n : 0);
  function hzPut(s, h) {
    const was = hzOf(s)[0];
    if (!h || !h[0]) delete S.hz.s[s]; else S.hz.s[s] = h;
    saveHz();
    let fin = 0, ch = false;
    qgList().forEach((g) => { if (g.k !== 'hifz') return; const f = g.fin; fin += qgCheckFin(g); if (f !== g.fin) ch = true; });
    if (ch) saveQg();
    if (h && h[0] === 2 && was !== 2 && !fin) { haptic('notify', 'success'); toast('Сура выучена — МашаАллах! Повторение — завтра'); }
    qgFinished(fin);
  }
  const hzOkIn = (h) => { const d = HZ_INT[Math.min(HZ_INT.length - 1, (h[2] || 0) + 1)]; return '«Помню» — снова через ' + d + ' ' + plural(d, 'день', 'дня', 'дней'); };
  function hzNames(list, max) { const n = list.slice(0, max || 2).map((s) => D.SURAH_RU[s - 1]).join(', '); return list.length > (max || 2) ? n + ' и ещё ' + (list.length - (max || 2)) : n; }

  /* ----- раздел «Мои цели» во вкладке «Коран» ----- */
  function vQGoals() {
    const shown = qgShown(), old = qgOld(), due = hzDue();
    if (!shown.length && !old.length && !due.length) {
      return '<button class="card pad tf-cont" data-a="sheet" data-v="qgNew"><span class="rd-ico">' + QG_ICON + '</span><span class="col grow" style="gap:3px"><span style="font-size:15px;font-weight:800">Цели по Корану</span><span class="small sub">Прочитать весь Коран или выбранные суры, выучить суры наизусть — отмечайте в приложении или по бумажному мусхафу</span></span>' + I.chev + '</button>';
    }
    const rows = [];
    if (due.length) rows.push('<button class="li" data-a="sheet" data-v="hzRev"><span class="qg-ic rev">' + HZ_ICON + '</span><span class="li-c"><span class="li-t">Повторить наизусть</span><span class="li-m">' + surahsLabel(due.length) + ': ' + hzNames(due) + '</span></span>' + I.chev + '</button>');
    shown.forEach((g) => {
      const st = qgStat(g), fin = !!g.fin;
      let m;
      if (fin) m = 'Выполнена сегодня · ' + surahsLabel(st.total);
      else if (g.k === 'hifz') { const h = st.learn ? hzOf(st.learn) : null; m = 'Выучено ' + st.n + ' из ' + st.total + (h ? ' · учу ' + D.SURAH_RU[st.learn - 1] + ', ' + h[1] + ' из ' + D.SURAH_AYAHS[st.learn - 1] : st.next ? ' · дальше ' + D.SURAH_RU[st.next - 1] : ''); }
      else m = st.n + ' из ' + ofSurahs(st.total) + (st.next ? ' · дальше ' + D.SURAH_RU[st.next - 1] : '');
      if (!fin && g.dl) m += ' · до ' + fmtDateY(g.dl);
      rows.push('<button class="li" data-a="sheet" data-v="qg:' + g.id + '">' + ringSvg(44, fin ? 1 : st.frac, fin, fin ? I.check : '') + '<span class="li-c"><span class="li-t">' + esc(qgTitle(g)) + '</span><span class="li-m">' + m + '</span></span>' + I.chev + '</button>');
    });
    if (old.length) rows.push('<button class="li" data-a="sheet" data-v="qgDone"><span class="qg-ic done">' + I.check + '</span><span class="li-c"><span class="li-t">Выполненные цели</span></span><span class="li-val num">' + old.length + '</span>' + I.chev + '</button>');
    return '<section class="sec" aria-label="Мои цели"><div class="sec-h ctr"><h2 class="h2">Мои цели</h2>' + (qgList().filter((g) => !g.fin).length < QG_MAX ? '<button class="sec-a" data-a="sheet" data-v="qgNew">' + I.plus + 'Новая</button>' : '') + '</div><div class="card list">' + rows.join('') + '</div></section>';
  }
  const QG_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>';
  const HZ_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.2h3.2"/><path d="M12 8.5V12l2.5 1.6"/></svg>';

  /* ----- новая цель ----- */
  function qgDraft(sh) {
    const k = sh.k || 'read', sc = sh.sc || 'all';
    let scope = 'all';
    if (sc === 'amma') scope = 'r:78-114';
    else if (sc === 'range') { let a = clamp(+sh.from || 1, 1, 114), b = clamp(+sh.to || 114, 1, 114); if (a > b) { const x = a; a = b; b = x; } scope = a === 1 && b === 114 ? 'all' : 'r:' + a + '-' + b; }
    else if (sc === 'pick') scope = 'l:' + (sh.pick || []).slice().sort((x, y) => x - y).join(',');
    const t = todayKey();
    let dl = '';
    if (sh.dl === 'days') dl = addDays(t, (+sh.days || 90) - 1);
    else if (sh.dl === 'date' && /^\d{8}$/.test(sh.date || '') && sh.date > t) dl = sh.date;
    const rev = k === 'hifz' ? (sh.rev == null ? sc === 'amma' : !!sh.rev) : false;
    return { k, m: k === 'read' ? (sh.m || 'ar') : '', sc: scope, rev: rev ? 1 : 0, st: t, dl, d: '', fin: '', t: (sh.t || '').trim().slice(0, 50) };
  }
  function vQgDl(sh) {
    const dl = sh.dl || 'none', days = +sh.days || 90, t = todayKey();
    return '<div class="sh-sec">Срок</div><div class="seg mini" role="group" aria-label="Срок">' + [['none', 'Без срока'], ['days', 'За N дней'], ['date', 'До даты']].map((x) => '<button class="' + (dl === x[0] ? 'on' : '') + '" data-a="qgSet" data-v="dl:' + x[0] + '" aria-pressed="' + (dl === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
      (dl === 'days' ? '<div class="qg-chips" role="group" aria-label="Сколько дней">' + [[30, '30 дней'], [60, '60 дней'], [90, '90 дней'], [180, 'полгода'], [365, 'год']].map((x) => '<button class="qg-chip' + (days === x[0] ? ' on' : '') + '" data-a="qgSet" data-v="days:' + x[0] + '" aria-pressed="' + (days === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' : '') +
      (dl === 'date' ? '<label class="search"><span class="sr">Дата окончания</span><input type="date" data-in="qgDate" min="' + addDays(t, 1).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3') + '" value="' + (sh.date ? sh.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3') : '') + '"></label>' : '');
  }
  function vQgNew(sh, head, opt) {
    const k = sh.k || 'read', sc = sh.sc || 'all', m = sh.m || 'ar', g = qgDraft(sh), st = qgStat(g), t = todayKey();
    const out = [head('Новая цель', 'Цель считается сурами. Можно поставить несколько целей сразу')];
    out.push('<div class="seg" role="group" aria-label="Что сделать"><button class="' + (k === 'read' ? 'on' : '') + '" data-a="qgSet" data-v="k:read" aria-pressed="' + (k === 'read') + '">Прочитать</button><button class="' + (k === 'hifz' ? 'on' : '') + '" data-a="qgSet" data-v="k:hifz" aria-pressed="' + (k === 'hifz') + '">Выучить наизусть</button></div>');
    if (k === 'read') out.push('<div class="sh-sec">Как читать</div><div class="seg mini" role="group" aria-label="Как читать">' + [['ar', 'Арабский'], ['tr', 'Перевод'], ['tf', 'Тафсир']].filter((x) => x[0] !== 'tf' || sai()).map((x) => '<button class="' + (m === x[0] ? 'on' : '') + '" data-a="qgSet" data-v="m:' + x[0] + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + '</button>').join('') + '</div>');
    out.push('<div class="sh-sec">Какие суры</div>');
    out.push(opt('qgSet', 'sc:all', sc === 'all', 'Весь Коран', '114 сур · 604 страницы'));
    out.push(opt('qgSet', 'sc:amma', sc === 'amma', 'Джуз Амма', 'Суры 78–114 · 37 сур, короткие — с них обычно начинают'));
    out.push(opt('qgSet', 'sc:range', sc === 'range', 'Подряд: с суры по суру', 'Например, первые пять сур или весь второй джуз'));
    if (sc === 'range') {
      const sel = (key, val) => '<select data-in="' + key + '" aria-label="' + (key === 'qgFrom' ? 'С суры' : 'По суру') + '">' + D.SURAH_RU.map((ru, i) => '<option value="' + (i + 1) + '"' + (val === i + 1 ? ' selected' : '') + '>' + (i + 1) + '. ' + ru + '</option>').join('') + '</select>';
      out.push('<div class="qg-range"><label><span>с</span>' + sel('qgFrom', clamp(+sh.from || 1, 1, 114)) + '</label><label><span>по</span>' + sel('qgTo', clamp(+sh.to || 114, 1, 114)) + '</label></div>');
    }
    out.push(opt('qgSet', 'sc:pick', sc === 'pick', 'Выбрать суры', (sh.pick || []).length ? 'Выбрано: ' + hzNames((sh.pick || []).slice().sort((a, b) => a - b), 3) : 'Например, Йа Син, Аль-Мульк и Аль-Кахф'));
    if (sc === 'pick') {
      const f = sNorm(sh.q), pick = sh.pick || [];
      const rows = D.SURAH_RU.map((ru, i) => {
        const s = i + 1;
        if (f && String(s) !== f && sNorm(ru).indexOf(f) < 0) return '';
        const on = pick.indexOf(s) >= 0;
        return '<button class="li qg-s" data-a="qgPick" data-v="' + s + '" aria-pressed="' + on + '"><span class="qg-n num">' + s + '</span><span class="li-c"><span class="li-t">' + ru + '</span><span class="li-m">' + ayahsLabel(D.SURAH_AYAHS[i]) + ' · ' + pagesLabel(s) + '</span></span><span class="ck2' + (on ? ' st-done' : '') + '">' + (on ? I.st.done : '') + '</span></button>';
      }).join('');
      out.push('<label class="search">' + I.search + '<span class="sr">Найти суру</span><input type="search" data-in="qgPickQ" placeholder="Найти суру" value="' + esc(sh.q || '') + '" autocomplete="off"></label>');
      out.push('<div class="card list qg-pick">' + (rows || '<div class="li"><span class="li-m">Ничего не нашлось</span></div>') + '</div>');
    }
    if (k === 'hifz') {
      const rev = !!g.rev;
      out.push('<div class="x-row qg-x"><span class="col grow"><span style="font-size:15px;font-weight:700">Учить с конца</span><span class="small sub">От ан-Нас к началу — сначала короткие суры</span></span><button class="switch" role="switch" aria-checked="' + rev + '" aria-label="Учить с конца" data-a="qgSet" data-v="rev:' + (rev ? 0 : 1) + '"><i></i></button></div>');
    }
    out.push(vQgDl(sh));
    const pre = k === 'hifz' ? st.list.filter((s) => hzOf(s)[0] === 2).length : 0;
    const big = st.total ? surahsLabel(st.total) : 'Выберите суры';
    const line = !st.total ? 'Отметьте хотя бы одну суру' : sh.dl === 'date' && !g.dl ? pagesApprox(st.wAll) + ' · выберите дату окончания' : pagesApprox(st.wAll) + (g.dl ? ' · до ' + fmtDateY(g.dl) + ' · ' + (k === 'hifz' ? '≈ ' + st.ayDay + ' ' + plural(st.ayDay, 'аят', 'аята', 'аятов') + ' в день' : pgDayLabel(st.pgDay)) : ' · без срока, в своём темпе');
    out.push('<div class="card pad qg-sum"><span class="qg-big num">' + big + '</span><span class="small sub">' + line + '</span>' + (pre ? '<span class="small" style="color:var(--emerald-text);font-weight:700">' + surahsLabel(pre) + ' вы уже знаете — они засчитаются сразу</span>' : '') + '</div>');
    out.push('<label class="search"><span class="sr">Название цели</span><input data-in="qgTitle" maxlength="50" placeholder="Название: ' + esc(qgTitle(Object.assign({}, g, { t: '' }))) + '" value="' + esc(sh.t || '') + '"></label>');
    out.push('<button class="btn gold block" data-a="qgCreate"' + (st.total ? '' : ' disabled') + '>Поставить цель с намерением</button><button class="btn ghost block" data-a="closeSheet">Не сейчас</button>');
    return out.join('');
  }

  /* ----- шторка цели ----- */
  function vQgSheet(sh, head, opt) {
    const g = qgById(sh.id);
    if (!g) return head('Цель удалена', '') + '<button class="btn gold block" data-a="closeSheet">Готово</button>';
    const st = qgStat(g), hz = g.k === 'hifz', out = [];
    out.push(head(esc(qgTitle(g)), (hz ? 'наизусть' : 'чтение ' + QG_MODE[qgMode(g)]) + ' · ' + qgScopeLabel(g) + (g.dl ? ' · до ' + fmtDateY(g.dl) : '') + ' · с ' + fmtDateY(g.st)));
    const plan = qgPlanLine(g, st);
    out.push('<div class="card pad qg-sum">' +
      '<div class="between" style="align-items:flex-end"><span class="qg-big num' + (st.done ? ' ok' : '') + '">' + (st.done ? 'Цель выполнена' : (hz ? 'Выучено ' : '') + st.n + ' из ' + ofSurahs(st.total)) + '</span><span class="small num" style="font-weight:800">' + Math.floor(st.frac * 100) + '%</span></div>' +
      '<span class="bar" style="height:8px"><span style="width:' + (st.frac * 100).toFixed(1) + '%' + (st.done ? ';background:var(--emerald)' : '') + '"></span></span>' +
      '<span class="small sub">' + (st.done ? (g.fin ? fmtDateY(g.fin) + ' · ' : '') + surahsLabel(st.total) + ' · ' + pagesApprox(st.wAll) + '. Пусть Аллах примет и сделает Коран свидетелем за вас.' : 'Процент — по объёму: длинные суры весят больше коротких · осталось ' + pagesApprox(st.wAll - st.wDone)) + '</span>' +
      (plan && !st.done ? '<span class="small" style="font-weight:700;line-height:1.45">' + plan + '</span>' : '') + '</div>');
    if (st.done) {
      out.push(hz ? '<button class="btn ghost block" data-a="sheet" data-v="hzRev">' + HZ_ICON + 'Повторение наизусть</button>' : '<button class="btn gold block" data-a="qgAgain" data-v="' + g.id + '">Начать заново</button>');
    } else if (hz) {
      const learning = st.list.filter((s) => hzOf(s)[0] === 1), due = hzDue().filter((s) => st.list.indexOf(s) >= 0);
      if (learning.length) out.push('<div class="sh-sec">Сейчас учу</div><div class="card list">' + learning.map((s) => hzRow(s, g.id)).join('') + '</div>');
      else if (st.next) out.push('<button class="btn gold block" data-a="hzStart" data-v="' + st.next + ':' + g.id + '">' + HZ_ICON + 'Начать учить «' + D.SURAH_RU[st.next - 1] + '»</button>');
      if (due.length) out.push('<button class="btn ghost block" data-a="sheet" data-v="hzRev">' + HZ_ICON + 'Повторить сегодня: ' + surahsLabel(due.length) + '</button>');
    } else if (st.next) {
      out.push('<button class="btn gold block" data-a="qgOpen" data-v="' + g.id + '">' + READ_ICON + 'Читать «' + D.SURAH_RU[st.next - 1] + '»</button>');
      out.push('<span class="small sub" style="padding:0 6px;line-height:1.5">В приложении в конце суры нажмите «Сура прочитана». Читаете по бумажному мусхафу — отмечайте суры ниже.</span>');
      if (st.total > 3) {
        out.push('<label class="qg-upto"><span>Прочитал по мусхафу до суры</span><select data-in="qgUpTo" data-g="' + g.id + '" aria-label="Отметить прочитанными все суры до выбранной"><option value="">выбрать…</option>' + st.list.map((s) => '<option value="' + s + '">' + s + '. ' + D.SURAH_RU[s - 1] + '</option>').join('') + '</select></label>');
      }
    }
    out.push('<div class="sh-sec">' + (hz ? 'Суры цели' : 'Суры') + ' · ' + st.n + ' из ' + ofSurahs(st.total) + '</div>');
    out.push('<div class="card list">' + st.list.map((s) => hz ? hzRow(s, g.id) : '<button class="li qg-s" data-a="qgTog" data-v="' + g.id + ':' + s + '" aria-pressed="' + bitHas(g.d, s) + '"><span class="qg-n num">' + s + '</span><span class="li-c"><span class="li-t">' + D.SURAH_RU[s - 1] + '</span><span class="li-m">' + ayahsLabel(D.SURAH_AYAHS[s - 1]) + ' · ' + pagesLabel(s) + '</span></span><span class="ck2' + (bitHas(g.d, s) ? ' st-done' : '') + '">' + (bitHas(g.d, s) ? I.st.done : '') + '</span></button>').join('') + '</div>');
    if (sh.edit) {
      out.push(vQgDl(sh) + '<button class="btn gold block" data-a="qgSaveDl" data-v="' + g.id + '">Сохранить срок</button>');
    } else if (!st.done) out.push('<button class="btn ghost block" data-a="qgEdit" data-v="' + g.id + '">' + (g.dl ? 'Изменить срок' : 'Поставить срок') + '</button>');
    out.push(sh.del ? '<button class="btn block" style="background:var(--rose-soft);color:var(--rose)" data-a="qgDel" data-v="' + g.id + '">Точно удалить цель?' + (hz ? ' Выученные суры останутся' : '') + '</button>' : '<button class="btn quiet block" data-a="qgDel" data-v="' + g.id + '">Удалить цель</button>');
    out.push('<button class="btn gold block" data-a="closeSheet">Готово</button>');
    return out.join('');
  }
  function hzRow(s, gid) {
    const h = hzOf(s), n = D.SURAH_AYAHS[s - 1];
    const right = h[0] === 2 ? '<span class="ck2 st-done">' + I.st.done + '</span>' : h[0] === 1 ? '<span class="li-v"><b class="num">' + h[1] + ' из ' + n + '</b><i><s style="width:' + Math.round(h[1] / n * 100) + '%"></s></i></span>' : '<span class="ck2"></span>';
    const m = h[0] === 2 ? 'выучена · повторение ' + (hzNext(h) <= todayKey() ? 'сегодня' : fmtDate(hzNext(h))) : h[0] === 1 ? 'учу сейчас · ' + ayahsLabel(n) : ayahsLabel(n) + ' · ' + pagesLabel(s);
    return '<button class="li qg-s" data-a="sheet" data-v="hzS:' + s + (gid ? '@' + gid : '') + '"><span class="qg-n num">' + s + '</span><span class="li-c"><span class="li-t">' + D.SURAH_RU[s - 1] + '</span><span class="li-m">' + m + '</span></span>' + right + '</button>';
  }

  /* ----- шторка суры наизусть ----- */
  function vHzSheet(sh, head, opt) {
    const p = String(sh.id || '').split('@'), s = clamp(+p[0] || 1, 1, 114), gid = p[1] || '', h = hzOf(s), n = D.SURAH_AYAHS[s - 1], t = todayKey();
    const out = [head(s + '. ' + D.SURAH_RU[s - 1], 'наизусть · ' + ayahsLabel(n) + ' · ' + pagesLabel(s))];
    out.push(opt('hzSet', s + ':0', h[0] === 0, 'Не начата', ''));
    out.push(opt('hzSet', s + ':1', h[0] === 1, 'Учу сейчас', 'Отмечайте, сколько аятов уже выучили'));
    out.push(opt('hzSet', s + ':2', h[0] === 2, 'Выучена', 'Сура вернётся на повторение через 1, 3, 7, 14, 30 и 60 дней'));
    if (h[0] === 1) {
      out.push('<div class="card pad qg-sum"><span class="small sub" style="font-weight:700">Выучено аятов</span><span class="qg-big num">' + h[1] + ' из ' + n + '</span><span class="bar" style="height:8px"><span style="width:' + (h[1] / n * 100).toFixed(1) + '%"></span></span>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' + [[1, '+1 аят'], [5, '+5']].filter((x) => x[0] === 1 || n >= 10).map((x) => '<button class="btn gold grow" data-a="hzStep" data-v="' + s + ':' + x[0] + '">' + x[1] + '</button>').join('') + '<button class="btn ghost" data-a="hzStep" data-v="' + s + ':-1" aria-label="Минус один аят">−1</button></div>' +
        '<span class="small sub" style="line-height:1.45">Когда выучите последний аят, сура перейдёт в «Выученные».</span></div>');
    }
    if (h[0] === 2) {
      const nx = hzNext(h), due = nx <= t;
      out.push('<div class="card pad qg-sum"><span class="small sub" style="font-weight:700">Повторение</span><span class="qg-big">' + (due ? 'Сегодня' : fmtDateY(nx)) + '</span><span class="small sub">' + (h[3] ? 'последний раз ' + (h[3] === t ? 'сегодня' : fmtDateY(h[3])) + ' · ' : '') + hzOkIn(h) + '</span>' +
        '<div class="row" style="gap:8px"><button class="btn gold grow" data-a="hzRev" data-v="' + s + ':ok">Повторил — помню</button><button class="btn ghost grow" data-a="hzRev" data-v="' + s + ':err">Есть ошибки</button></div></div>');
    }
    out.push('<button class="btn ghost block" data-a="qRd" data-v="' + s + ':' + (h[0] === 1 ? clamp(h[1] + 1, 1, n) : 1) + ':ar">' + READ_ICON + 'Открыть суру в мусхафе</button>');
    const inG = qgList().filter((g) => g.k === 'hifz' && !g.fin && qgSurahs(g).indexOf(s) >= 0);
    if (inG.length) out.push('<span class="small sub" style="padding:0 6px">В цели: ' + inG.map((g) => '«' + esc(qgTitle(g)) + '»').join(', ') + '</span>');
    out.push(gid && qgById(gid) ? '<button class="btn ghost block" data-a="sheet" data-v="qg:' + gid + '">К цели</button>' : '<button class="btn ghost block" data-a="closeSheet">Готово</button>');
    return out.join('');
  }
  function vHzRev(sh, head) {
    const due = hzDue(), rv = hzRevToday(), out = [head('Повторение наизусть', 'Выученное нужно повторять, чтобы оно не забылось')];
    if (!due.length) {
      const all = Object.keys(S.hz.s).map(Number).filter((s) => hzOf(s)[0] === 2).sort((a, b) => (hzNext(hzOf(a)) < hzNext(hzOf(b)) ? -1 : 1));
      out.push('<div class="card pad qg-sum"><span class="qg-big ok">' + (rv ? 'На сегодня всё' : 'Пока нечего повторять') + '</span><span class="small sub">' + (rv ? 'Повторено сегодня: ' + surahsLabel(rv) + '. ' : '') + (all.length ? 'Следующее: ' + D.SURAH_RU[all[0] - 1] + ' — ' + fmtDateY(hzNext(hzOf(all[0]))) : 'Когда отметите суру выученной, она появится здесь на следующий день') + '</span></div>');
    } else {
      if (rv) out.push('<span class="small sub" style="padding:0 6px">Повторено сегодня: ' + surahsLabel(rv) + '</span>');
      out.push('<div class="card list">' + due.map((s) => {
        const h = hzOf(s);
        return '<div class="li col-li hz-rv"><div class="row" style="gap:12px;align-items:center"><span class="qg-n num">' + s + '</span><span class="li-c"><span class="li-t">' + D.SURAH_RU[s - 1] + '</span><span class="li-m">' + ayahsLabel(D.SURAH_AYAHS[s - 1]) + ' · ' + hzOkIn(h) + (hzNext(h) < todayKey() ? ' · ждёт с ' + fmtDate(hzNext(h)) : '') + '</span></span><button class="qg-open" data-a="qRd" data-v="' + s + ':1:ar" aria-label="Открыть суру ' + D.SURAH_RU[s - 1] + '">' + READ_ICON + '</button></div>' +
          '<div class="row" style="gap:8px"><button class="btn gold sm grow" data-a="hzRev" data-v="' + s + ':ok">Помню</button><button class="btn ghost sm grow" data-a="hzRev" data-v="' + s + ':err">Есть ошибки</button></div></div>';
      }).join('') + '</div>');
    }
    out.push('<span class="small sub" style="padding:2px 6px;line-height:1.5">«Помню» — следующий раз позже: через 1, 3, 7, 14, 30, затем 60 дней. «Есть ошибки» — сура вернётся завтра.</span>');
    out.push('<button class="btn gold block" data-a="closeSheet">Готово</button>');
    return out.join('');
  }
  function vQgDoneSheet(sh, head) {
    const old = qgOld().slice().sort((a, b) => (a.fin < b.fin ? 1 : -1));
    return head('Выполненные цели', 'Пусть Аллах примет') + (old.length ? '<div class="card list">' + old.map((g) => '<button class="li" data-a="sheet" data-v="qg:' + g.id + '"><span class="qg-ic done">' + I.check + '</span><span class="li-c"><span class="li-t">' + esc(qgTitle(g)) + '</span><span class="li-m">' + fmtDateY(g.fin) + ' · ' + surahsLabel(qgSurahs(g).length) + (diffDays(g.st, g.fin) > 0 ? ' · за ' + (diffDays(g.st, g.fin) + 1) + ' ' + plural(diffDays(g.st, g.fin) + 1, 'день', 'дня', 'дней') : '') + '</span></span>' + I.chev + '</button>').join('') + '</div>' : '<div class="small sub">Пока нет</div>') +
      '<button class="btn gold block" data-a="closeSheet">Готово</button>';
  }
  const QG_SHEETS = { qgNew: vQgNew, qg: vQgSheet, hzS: vHzSheet, hzRev: vHzRev, qgDone: vQgDoneSheet };

  /* ----- в читалке: в конце суры ----- */
  // цели чтения, к которым относится открытая сура: тот же способ чтения (арабский текст в «Переводе» тоже считается арабским)
  function qgForReader(R) {
    const s = R.s, r = rd();
    return qgList().filter((g) => g.k === 'read' && (!g.fin || bitHas(g.d, s)) && qgSurahs(g).indexOf(s) >= 0 && (qgMode(g) === R.mode || (qgMode(g) === 'ar' && R.mode === 'tr' && r.ar)));
  }
  function vQgReader(R) {
    const s = R.s, out = [], gs = qgForReader(R);
    if (gs.length) {
      const all = gs.every((g) => bitHas(g.d, s)), names = gs.map((g) => '«' + esc(qgTitle(g)) + '»').join(', ');
      out.push(all ? '<button class="qg-mk on" data-a="qgRead" data-v="' + s + '" aria-pressed="true"><span class="ck2 st-done">' + I.st.done + '</span><span class="li-c"><span class="li-t">Сура отмечена прочитанной</span><span class="li-m">' + names + ' · нажмите, чтобы снять</span></span></button>'
        : '<button class="qg-mk" data-a="qgRead" data-v="' + s + '" aria-pressed="false"><span class="ck2"></span><span class="li-c"><span class="li-t">Сура прочитана</span><span class="li-m">отметить в ' + (gs.length > 1 ? 'целях ' : 'цели ') + names + '</span></span></button>');
    }
    const h = hzOf(s);
    if (h[0] === 1) out.push('<button class="qg-mk" data-a="sheet" data-v="hzS:' + s + '"><span class="qg-ic rev">' + HZ_ICON + '</span><span class="li-c"><span class="li-t">Наизусть: учу</span><span class="li-m">выучено ' + h[1] + ' из ' + ayahsLabel(D.SURAH_AYAHS[s - 1]) + '</span></span></button>');
    else if (h[0] === 2 && hzNext(h) <= todayKey()) out.push('<button class="qg-mk" data-a="sheet" data-v="hzS:' + s + '"><span class="qg-ic rev">' + HZ_ICON + '</span><span class="li-c"><span class="li-t">Повторение наизусть</span><span class="li-m">сегодня пора повторить эту суру</span></span></button>');
    return out.length ? '<div class="qg-rd">' + out.join('') + '</div>' : '';
  }

  /* ----- на главной, в «Сегодня ещё» ----- */
  function qgTodayItems(add, item, ck, meter) {
    let n = 0, done = 0;
    const due = hzDue(), rv = hzRevToday();
    if (due.length || rv) {
      n++; if (!due.length) done++;
      add(21, item('sheet', 'hzRev', 'Повторение наизусть', due.length ? hzNames(due) : 'Повторено ' + surahsLabel(rv) + ' · МашаАллах', due.length ? meter(rv + ' из ' + (rv + due.length), rv / (rv + due.length)) : ck(true)));
    }
    const withDl = qgList().filter((g) => !g.fin && g.dl).map((g) => ({ g, st: qgStat(g) })).filter((x) => !x.st.done).sort((a, b) => (a.g.dl < b.g.dl ? -1 : 1));
    const x = withDl[0];
    if (x) {
      const g = x.g, st = x.st, ok = st.ok && !st.over; n++; if (ok) done++;
      const m = st.over ? 'Срок прошёл ' + fmtDate(g.dl) + ' · ' + st.n + ' из ' + ofSurahs(st.total) : ok ? 'Сегодня по плану · ' + st.n + ' из ' + ofSurahs(st.total) : (g.k === 'hifz' ? 'По плану — выучить до ' : 'По плану — дочитать до ') + '«' + D.SURAH_RU[st.plan - 1] + '»';
      add(28, item('sheet', 'qg:' + g.id, esc(qgTitle(g)), m, ok ? ck(true) : meter(st.n + ' из ' + st.total, st.frac)));
    }
    return [n, done];
  }

  function vMore() {
    const out = ['<h1 class="h1">Ещё</h1>'];
    const qb = S.set.lat != null ? qiblaBearing() : null;
    if (qb != null) {
      out.push('<div class="qibla"><div class="qibla-t">Кибла · <span class="num">' + Math.round(qb) + '°</span> от севера</div>' +
        '<svg class="compass" viewBox="0 0 230 230" aria-hidden="true" style="font-family:var(--sans)"><g id="dial"><circle cx="115" cy="115" r="104" fill="none" stroke="rgba(255,255,255,.12)"/><circle cx="115" cy="115" r="86" fill="none" stroke="rgba(230,190,110,.25)" stroke-dasharray="1 7"/>' +
        '<g stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-linecap="round"><path d="M115 14v10M115 206v10M14 115h10M206 115h10M43.6 43.6l5.6 5.6M180.8 180.8l5.6 5.6M43.6 186.4l5.6-5.6M180.8 49.2l5.6-5.6"/></g>' +
        '<text x="115" y="44" fill="#F4EFE6" font-size="12" font-weight="800" text-anchor="middle">С</text><text x="188" y="119" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">В</text><text x="115" y="194" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">Ю</text><text x="42" y="119" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">З</text>' +
        '<g id="needle" transform="rotate(' + qb.toFixed(1) + ' 115 115)"><path id="needleMain" d="M115 40l9 75h-18z" fill="#E6BE6E"/><path d="M115 190l9-75h-18z" fill="rgba(255,255,255,.18)"/><rect x="106" y="2" width="18" height="18" rx="2" fill="#0A0F1C" stroke="#E6BE6E" stroke-width="1.5"/><path d="M106 8h18" stroke="#E6BE6E" stroke-width="1.5"/></g></g>' +
        '<circle cx="115" cy="115" r="7" fill="#0A0F1C" stroke="#E6BE6E" stroke-width="2"/></svg>' +
        '<div style="position:absolute;left:0;right:0;bottom:16px;text-align:center;padding:0 20px;display:flex;flex-direction:column;gap:8px;align-items:center"><span id="qiblaHint" style="font-size:14.5px;font-weight:800">' + (S.compassOn ? 'Поворачивайте телефон, держа его ровно' : 'Компас показывает направление от севера') + '</span>' + (S.compassOn ? '<span id="qiblaDeg" class="small num" style="color:#C9CEDA">Ждём данные компаса…</span>' : '<button class="btn gold sm" data-a="compass">Включить компас</button>') + '</div></div>');
    } else out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span style="font-size:16px;font-weight:800">Кибла</span><span class="small sub">Укажите город или разрешите геолокацию, чтобы найти направление на Каабу.</span><button class="btn gold sm" data-a="locate">Определить автоматически</button></div>');

    // календарь хиджры
    const t = todayKey(), events = [], seen = {};
    for (let i = 0; i < 400 && events.length < 4; i++) {
      const k = addDays(t, i), h = hijri(k);
      const ev = h.d === 1 && h.m === 9 ? ['Начало Рамадана', 'Обязательный пост весь месяц'] : h.d === 1 && h.m === 10 ? ['Ид аль-Фитр', 'Праздник разговения, пост запрещён'] : h.d === 9 && h.m === 12 ? ['День Арафа', 'Желательный пост'] : h.d === 10 && h.m === 12 ? ['Ид аль-Адха', 'Праздник жертвоприношения'] : h.d === 1 && h.m === 1 ? ['Новый год по хиджре', D.HIJRI_MONTHS_NOM[0] + ' ' + h.y] : h.d === 1 && h.m === 7 ? ['Начало Раджаба', 'Один из запретных месяцев'] : h.d === 10 && h.m === 1 ? ['Ашура', 'Желательный пост'] : null;
      if (ev && !seen[ev[0]]) { seen[ev[0]] = 1; events.push([k, ev]); }
    }
    out.push('<section class="sec" aria-label="Календарь хиджры"><div class="sec-h"><h2 class="h2">Календарь хиджры</h2><span class="sec-m">даты примерные</span></div><div class="card pad cal-ev"><div class="li-m">Сегодня ' + hijriText(t) + '</div>' +
      events.map((e) => { const p = parseKey(e[0]); return '<div class="row"><span class="date-t"><b class="num">' + p.d + '</b><small>' + MONTHS_GEN[p.m - 1].slice(0, 3) + '</small></span><span class="li-c"><span class="li-t">' + e[1][0] + '</span><span class="li-m">' + e[1][1] + (p.y !== parseKey(t).y ? ' · ' + p.y : '') + '</span></span></div>'; }).join('') + '</div></section>');

    // настройки
    const m = METHODS.find((x) => x[0] === S.set.method);
    const lvlName = { start: 'Начало', effort: 'Усердие', ihsan: 'Ихсан' }[S.set.level] || '—';
    const tadjTxt = (() => { const a = Object.keys(S.set.tadj || {}).some((x) => +S.set.tadj[x]); const q = hasIqama(); return a && q ? 'Поправки · икама' : a ? 'Свои поправки' : q ? 'Икама' : 'По расчёту'; })();
    const groups = [
      ['Время намазов', [
        ['city', 'Город', S.set.city || (S.set.lat != null ? 'Моё местоположение' : 'Не выбран')],
        ['method', 'Метод расчёта', m ? m[1] : ''],
        ['madhab', 'Время Асра', S.set.madhab === 'Hanafi' ? 'Ханафитское' : 'Стандартное'],
        ['times', 'Поправки и икама', tadjTxt]]],
      ['Учёт', [
        ['level', 'Мой уровень', lvlName],
        ['mode', 'Отметка намазов', S.set.level === 'start' ? 'Просто' : S.set.detailed !== false ? 'Подробно' : 'Просто'],
        ['read', 'План чтения', S.read ? S.read.title : 'Нет'],
        ['gam', 'Путь и знаки', gamOn() ? 'Включены' : 'Выключены'],
        ['qada', 'Долг за прошлые годы', (S.set.qadaBase || 0) + ' нам. · ' + (S.set.fastBase || 0) + ' пост.']]],
      ['Вид и отклик', [
        ['theme', 'Тема', { auto: 'Как в Telegram', dark: 'Тёмная', light: 'Светлая' }[S.set.theme]],
        ['sky', 'Небо в карточке намаза', { live: 'Живое', night: 'Всегда ночь', day: 'Всегда день' }[S.set.sky || 'live']],
        ['vib', 'Вибрация', S.set.vib === false ? 'Выключена' : { soft: 'Мягкая', medium: 'Средняя', heavy: 'Сильная' }[S.set.vibT || 'medium']],
        ['hijri', 'Дата хиджры', S.set.hijriAdj ? (S.set.hijriAdj > 0 ? '+' : '') + S.set.hijriAdj + ' дн.' : 'Без сдвига']]]
    ];
    groups.forEach((g) => out.push('<section class="sec" aria-label="' + g[0] + '"><div class="sec-h"><h2 class="h2">' + g[0] + '</h2></div><div class="card list">' + g[1].filter((r) => r[0] !== 'mode' || S.set.level !== 'start').map((r) => '<button class="li" data-a="sheet" data-v="' + r[0] + '"><span class="li-c"><span class="li-t">' + r[1] + '</span></span><span class="li-val">' + esc(r[2]) + '</span>' + I.chev + '</button>').join('') + '</div></section>'));
    const connected = !!S.set.syncUrl;
    const stLabel = !connected ? 'Не подключено' : sync.busy ? 'Синхронизация…' : sync.status && sync.status !== 'ok' ? 'Ошибка' : 'Подключено';
    const stColor = !connected ? 'var(--sub)' : sync.status && sync.status !== 'ok' && !sync.busy ? 'var(--red-text)' : 'var(--emerald-text)';
    let tb = '<section class="sec" aria-label="Таблица и бот"><div class="sec-h"><h2 class="h2">Таблица и бот</h2></div><div class="card list"><button class="li" data-a="sheet" data-v="sync"><span class="li-c"><span class="li-t">Google-таблица и напоминания</span>' + (connected && S.set.lastSync ? '<span class="li-m">синхронизировано ' + fmtTime(new Date(S.set.lastSync)) + ((S.set.pending || []).length ? ' · ждут отправки: ' + S.set.pending.length : '') + '</span>' : '') + '</span><span class="li-val" style="color:' + stColor + '">' + stLabel + '</span>' + I.chev + '</button>';
    if (connected) {
      const R = S.set.remind || {};
      const sw = (key, label, hint) => '<div class="x-row"><span class="col grow"><span style="font-size:14.5px;font-weight:700">' + label + '</span><span class="small sub">' + hint + '</span></span><button class="switch" role="switch" aria-checked="' + (R[key] !== false) + '" aria-label="' + label + '" data-a="remind" data-v="' + key + '"><i></i></button></div>';
      const toIq = R.target === 'iqama' && hasIqama();
      tb += sw('before', 'Перед намазом', 'За ' + (R.offset || 15) + ' минут до ' + (toIq ? 'икамы' : 'начала')) +
        (R.before !== false ? '<div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:8px"><div class="seg mini" role="group" aria-label="За сколько минут">' + [5, 10, 15, 30].map((m) => '<button class="' + ((R.offset || 15) === m ? 'on' : '') + '" data-a="remindOffset" data-v="' + m + '">' + m + ' мин</button>').join('') + '</div>' +
          (hasIqama() ? '<div class="seg mini" role="group" aria-label="До чего напоминать"><button class="' + (!toIq ? 'on' : '') + '" data-a="remindTarget" data-v="adhan">до азана</button><button class="' + (toIq ? 'on' : '') + '" data-a="remindTarget" data-v="iqama">до икамы</button></div>' : '') + '</div>' : '') +
        sw('unmarked', 'Если намаз не отмечен', 'Через 45 минут, с кнопками ответа в чате') +
        sw('azkar', 'Утренние и вечерние азкары', 'После Фаджра и после Асра') +
        sw('fast', 'Желательные посты', 'Накануне вечером') +
        sw('chron', 'Летопись месяца', '1-го числа — итоги прошлого месяца') +
        sw('summary', 'Итог дня', 'В ' + (R.summaryTime || '21:30') + ' — что сделано и что осталось') +
        (R.summary !== false || R.fast !== false ? '<div style="padding:0 16px 12px"><div class="seg mini" role="group" aria-label="Время итога">' + ['20:00', '21:00', '21:30', '22:00', '23:00'].map((t) => '<button class="' + ((R.summaryTime || '21:30') === t ? 'on' : '') + '" data-a="remindTime" data-v="' + t + '">' + t + '</button>').join('') + '</div></div>' : '');
    }
    out.push(tb + '</div></section>');
    out.push('<div class="card pad more-sj"><span class="more-sj-t">Садака джария</span><span class="li-m" style="color:var(--text)">Приложение бесплатное и без рекламы. Поделитесь им с близкими — награда за каждого, кто будет пользоваться.</span>' + (SHARE_LINK ? '<button class="btn gold block" data-a="share">Поделиться</button>' : '') + '</div>');
    out.push('<div class="foot-note">Ибада · версия 2.0 · данные хранятся в ' + (store.cloud ? 'облаке Telegram' : 'этом браузере') + '</div>');
    return out.join('');
  }

  /* ===== шторки ===== */
  const IQ_DEF = { fajr: 20, dhuhr: 15, asr: 15, maghrib: 5, isha: 15, juma: 15 };
  function vTimesBody() {
    const k = todayKey(), T = prayerTimes(k), adj = S.set.tadj || {}, Q = S.set.iq || {};
    if (!T) return '<div class="small sub" style="padding:6px">Сначала выберите город в настройках.</div>';
    const base = (() => { const sv = S.set.tadj; S.set.tadj = {}; const r = prayerTimes(k); S.set.tadj = sv; return r; })();
    const stepper = (act, id, txt, small) => '<span class="stepper"><button class="step" data-a="' + act + '" data-v="' + id + ':-' + (small ? 1 : 5) + '" aria-label="меньше">' + (small ? I.minus : '−5') + '</button>' + (small ? '' : '<button class="step" data-a="' + act + '" data-v="' + id + ':-1" aria-label="минус минута">' + I.minus + '</button>') + '<span class="num" style="min-width:64px;text-align:center;font-weight:800;font-size:14.5px">' + txt + '</span><button class="step plus" data-a="' + act + '" data-v="' + id + ':1" aria-label="плюс минута">' + I.plus + '</button>' + (small ? '' : '<button class="step plus" data-a="' + act + '" data-v="' + id + ':5" aria-label="больше">+5</button>') + '</span>';
    const iqBlock = (id, label) => {
      const r = Q[id], mode = r == null || r === '' ? 'off' : typeof r === 'number' ? 'after' : 'fixed';
      let h = '<div class="tm-line"><span class="tm-lbl">Икама</span><div class="seg mini" role="group" aria-label="Икама ' + label + '">' + [['off', id === 'juma' ? 'Как Зухр' : 'Нет'], ['after', 'Через'], ['fixed', 'Время']].map((x) => '<button class="' + (mode === x[0] ? 'on' : '') + '" data-a="iqMode" data-v="' + id + ':' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>';
      if (mode === 'after') h += '<div class="tm-line end">' + stepper('iqStep', id, 'через ' + r + ' мин') + '</div>';
      if (mode === 'fixed') h += '<div class="tm-line end"><label class="tm-time"><span class="sr">Время икамы ' + label + '</span><input type="time" data-in="iq:' + id + '" value="' + esc(r) + '"></label></div>';
      return h;
    };
    const rows = [['fajr', 'Фаджр'], ['sunrise', 'Восход'], ['dhuhr', 'Зухр'], ['asr', 'Аср'], ['maghrib', 'Магриб'], ['isha', 'Иша']].map((x) => {
      const id = x[0], a = +adj[id] || 0, iq = id !== 'sunrise' ? iqamaTime(k, id, T) : null;
      return '<div class="tm"><div class="between"><span class="col"><span style="font-size:16px;font-weight:800">' + x[1] + '</span>' + (a ? '<span class="small sub">по расчёту ' + fmtTime(base[id]) + '</span>' : '') + '</span><span class="col" style="align-items:flex-end"><span class="num tm-big">' + fmtTime(T[id]) + '</span>' + (iq ? '<span class="small num" style="color:var(--gold-hi);font-weight:700">икама ' + fmtTime(iq) + '</span>' : '') + '</span></div>' +
        '<div class="tm-line"><span class="tm-lbl">' + (id === 'sunrise' ? 'Время' : 'Азан') + '</span>' + stepper('tadj', id, a ? (a > 0 ? '+' : '−') + Math.abs(a) + ' мин' : 'по расчёту', true) + '</div>' +
        (id !== 'sunrise' ? iqBlock(id, x[1]) : '') + '</div>';
    });
    rows.push('<div class="tm"><div class="between"><span class="col"><span style="font-size:16px;font-weight:800">Джума</span><span class="small sub">пятничный намаз вместо Зухра</span></span></div>' + iqBlock('juma', 'Джумы') + '</div>');
    return '<div class="small sub" style="padding:0 6px;line-height:1.5">Сегодня, ' + fmtDate(k) + '. Поправка «Азан» сдвигает время начала. Икама показывается рядом с намазом, и бот может напоминать до неё.</div>' + rows.join('') +
      '<button class="btn ghost block" data-a="timesReset">Сбросить к расчёту</button><button class="btn gold block" data-a="closeSheet">Готово</button>';
  }
  function vSheet(enter) {
    const sh = S.sheet; if (!sh) return '';
    let body = '';
    const head = (title, sub) => '<div class="grab"></div><div class="col" style="padding:6px 6px 4px"><div style="font-family:var(--serif);font-size:28px;font-weight:600;line-height:1.1">' + title + '</div>' + (sub ? '<div class="small sub" style="font-size:13px">' + sub + '</div>' : '') + '</div>';
    const opt = (act, val, on, title, desc, badge, badgeCls) => '<button class="opt' + (on ? ' on' : '') + '" data-a="' + act + '" data-v="' + val + '">' + (badge ? '<span class="opt-pct ' + (badgeCls || '') + '">' + badge + '</span>' : '') + '<span class="col grow"><span style="font-size:15.5px;font-weight:800">' + title + '</span>' + (desc ? '<span class="small sub">' + desc + '</span>' : '') + '</span>' + (on ? '<span style="color:var(--gold)">' + I.check + '</span>' : '') + '</button>';
    if (QG_SHEETS[sh.type]) {
      body = QG_SHEETS[sh.type](sh, head, opt);
    } else if (sh.type === 'status') {
      const k = viewKey(), pr = PRAYERS.find((p) => p.id === sh.id), cur = getDay(k).f[sh.id], T = prayerTimes(k);
      const opts = [['mosque', 'В мечети', 'Джамаатом в мечети — высшая награда', '150%'], ['jamaat', 'Джамаатом', 'Коллективно, вне мечети', '120%']];
      if (sh.id === 'dhuhr' && isFriday(k)) opts.unshift(['juma', 'Джума', 'Пятничный намаз в мечети', '150%']);
      opts.push(['done', 'Сделал', 'Один, в своё время', '100%'], ['qada', 'Восполнил (каза)', 'После окончания времени', '50%'], ['missed', 'Пропустил', 'Попадёт в каза-долг', '0%']);
      // сунна при этом намазе — здесь же, а не чипами на главном экране
      const lvl = S.set.level, d = getDay(k), plan = planFor(k);
      const subs = S.set.detailed && lvl !== 'start' ? PER_PRAYER[sh.id].filter((x) => plan[x[0]] > 0) : [];
      const subsHtml = subs.length ? '<div class="sh-sec">Сунна при намазе</div><div class="card list">' + subs.map((x) => { const on = !!d.s[x[0]], L = SUNNA_FULL[x[0]] || [x[1], '']; return '<button class="li" data-a="sunna" data-v="' + x[0] + '" aria-pressed="' + on + '"><span class="li-c"><span class="li-t">' + L[0] + '</span>' + (L[1] ? '<span class="li-m">' + L[1] + '</span>' : '') + '</span><span class="ck2' + (on ? ' st-done' : '') + '">' + (on ? I.st.done : '') + '</span></button>'; }).join('') + '</div>' : '';
      body = head(sh.id === 'dhuhr' && isFriday(k) ? 'Зухр / Джума' : pr.name, timeLine(k, pr, T) + ' · как вы совершили?') + opts.map((o) => opt('setStatus', sh.id + ':' + o[0], cur === o[0], o[1], o[2], o[3], 'st-' + o[0])).join('') + subsHtml + (cur ? '<button class="btn block quiet" data-a="setStatus" data-v="' + sh.id + ':">Снять отметку</button>' : '');
    } else if (sh.type === 'mode') {
      const det = S.set.detailed !== false;
      body = head('Отметка намазов', 'Как отмечать намазы на экране «Сегодня»') + opt('mode', '1', det, 'Подробно', 'Нажатие на намаз открывает выбор: в мечети, джамаатом, сам, каза — и сунну при нём') + opt('mode', '0', !det, 'Просто', 'Одно нажатие — намаз совершён');
    } else if (sh.type === 'city') {
      const C = S.city;
      body = head('Город', 'Для расчёта времени намазов и киблы') +
        '<button class="btn gold block" data-a="locate">' + I.pin + 'Определить автоматически</button>' +
        '<label class="search">' + I.search + '<span class="sr">Поиск города</span><input type="search" data-in="city" placeholder="Например, Казань" value="' + esc(C.q) + '" autocomplete="off"></label>' +
        (C.loading ? '<div class="loading">Ищу…</div>' : '') + (C.error ? '<div class="small" style="color:var(--red-text);padding:4px 6px">' + esc(C.error) + '</div>' : '') +
        C.results.map((r, i) => '<button class="opt" data-a="pickCity" data-v="' + i + '"><span class="col grow"><span style="font-size:15px;font-weight:800">' + esc(r.name) + '</span><span class="small sub">' + esc([r.admin1, r.country].filter(Boolean).join(', ')) + '</span></span></button>').join('');
    } else if (sh.type === 'sky') {
      const cur = S.set.sky || 'live';
      body = head('Небо', 'Фон приложения') + '<div class="col" style="gap:8px">' + [['live', 'Живое', 'Настоящее небо над вашим городом: меняется с рассветом, днём, закатом и ночью; Солнце и Луна на своих местах'], ['night', 'Всегда ночь', 'Тёмное звёздное небо в любое время, Луна с настоящей фазой'], ['day', 'Всегда день', 'Спокойное дневное небо в любое время']].map((x) =>
        '<button class="opt' + (cur === x[0] ? ' on' : '') + '" data-a="setSky" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '"><span class="col grow" style="text-align:left;gap:3px"><span style="font-size:15px;font-weight:800">' + x[1] + '</span><span class="small sub" style="line-height:1.45">' + x[2] + '</span></span>' + (cur === x[0] ? I.check : '') + '</button>').join('') + '</div>' +
        '<div class="small sub" style="padding:4px 6px;line-height:1.5">Светлая или тёмная тема карточек выбирается отдельно, в пункте «Тема».</div><button class="btn ghost block" data-a="closeSheet">Готово</button>';
    } else if (sh.type === 'qnav') {
      const R = S.quran.reader;
      body = head('Содержание', R ? 'Сейчас: ' + D.SURAH_RU[R.s - 1] + ', аят ' + (R.cur || R.a || 1) : '') + vQSearch() + vQSeg('qNavView', sh.view || 'surahs') + vQList(sh.view || 'surahs', S.quran.filter, tfPlan());
    } else if (sh.type === 'rdset') {
      body = vRdSet(head);
    } else if (sh.type === 'tfa') {
      body = vTfaSheet(sh);
    } else if (sh.type === 'read') {
      body = vReadSheet(sh, head);
    } else if (sh.type === 'chron') {
      body = vChron(sh.id);
    } else if (sh.type === 'gam') {
      body = head('Путь и знаки', 'Ступени, знаки, цель недели и летопись месяца') +
        '<div class="x-row" style="padding:10px 6px"><span class="col grow"><span style="font-size:15px;font-weight:700">Показывать</span><span class="small sub">Всё видно только вам</span></span><button class="switch" role="switch" aria-checked="' + gamOn() + '" aria-label="Путь и знаки" data-a="gamToggle" data-nohap="1"><i></i></button></div>' +
        '<div class="small sub" style="padding:4px 6px;line-height:1.55">Если цифры и знаки мешают искренности или давят — выключите. Учёт намазов останется как был.</div><button class="btn ghost block" data-a="closeSheet">Готово</button>';
    } else if (sh.type === 'gamIntro') {
      const G = gameStats(), got = visibleBadges().filter((b) => badgeEarned(b, G));
      const show = (got.length ? got : visibleBadges()).slice(0, 3);
      body = '<div class="grab"></div><div class="gm-award">' + '<div class="row" style="justify-content:center;gap:6px">' + show.map((b, i) => emblem(b, i === 1 ? 92 : 70, got.length > 0 || i === 1)).join('') + '</div>' +
        '<span class="big-serif" style="font-size:34px;line-height:1.05">Путь и знаки</span>' +
        (got.length ? '<span class="small" style="color:var(--gold-hi);font-weight:800">По вашим отметкам уже ' + got.length + ' ' + plural(got.length, 'знак', 'знака', 'знаков') + '</span>' : '') + '</div>' +
        '<div class="gm-list">' + [['Ступени', 'растут от дней постоянства — когда все пять намазов вовремя. Пропуск не отнимает пройденного.'], ['Знаки', 'отмечают вехи: неделя постоянства, Фаджр джамаатом, белые дни, тысяча зикров…'], ['Цель недели', '— одна небольшая личная цель по вашим слабым местам. Можно принять, сменить или пропустить.'], ['Летопись', '— итоги месяца и что стало лучше, чем в прошлом.']].map((x) => '<p><b>' + x[0] + '</b> ' + x[1] + '</p>').join('') + '<p class="sub">Всё видно только вам. Выключить можно в «Ещё → Настройки».</p></div>' +
        '<button class="btn gold block" data-a="toPath">Посмотреть мой путь</button><button class="btn ghost block" data-a="closeSheet">Позже</button>';
    } else if (sh.type === 'award') {
      const ids = sh.ids || [], bs = ids.filter((x) => x !== 'goal').map((x) => BADGES.find((b) => b.id === x)).filter(Boolean), goal = ids.indexOf('goal') >= 0;
      const main = bs[bs.length - 1];
      body = '<div class="grab"></div><div class="gm-award">' + (main ? '<div class="gm-glow">' + emblem(main, 132, true) + '</div><span class="eyebrow" style="padding:0">Новый знак</span><span class="big-serif" style="font-size:34px;line-height:1.05">' + main.t + '</span><span class="small sub" style="line-height:1.5">' + main.d + '</span>' : '<div class="gm-glow">' + emblem({ cat: 'goal', m: '✓' }, 132, true) + '</div><span class="big-serif" style="font-size:34px;line-height:1.05">Цель недели выполнена</span>') +
        (goal && main ? '<span class="small" style="color:var(--violet-text);font-weight:800">И цель недели выполнена</span>' : '') +
        (bs.length > 1 ? '<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">' + bs.slice(0, -1).map((b) => emblem(b, 44, true)).join('') + '</div><span class="small sub">Ещё ' + (bs.length - 1) + ' ' + plural(bs.length - 1, 'знак', 'знака', 'знаков') + '</span>' : '') + '</div>' +
        '<button class="btn gold block" data-a="closeSheet">Альхамдулиллях</button><button class="btn ghost block" data-a="toPath">Мой путь</button>';
    } else if (sh.type === 'badge') {
      const b = BADGES.find((x) => x.id === sh.id), G = gameStats(), on = badgeEarned(b, G), v = Math.min(b.v(G), b.n), dt = S.gam.seen[b.id];
      body = '<div class="grab"></div><div class="gm-award">' + (on ? '<div class="gm-glow">' + emblem(b, 120, true) + '</div>' : emblem(b, 120, false)) + '<span class="eyebrow" style="padding:0;color:' + CAT[b.cat][1] + '">' + CAT[b.cat][0] + '</span><span class="big-serif" style="font-size:32px;line-height:1.05">' + b.t + '</span><span class="small sub" style="line-height:1.5">' + b.d + '</span>' +
        (on ? '<span class="small" style="font-weight:800;color:var(--emerald-text)">' + (dt ? 'Получен ' + fmtDate(dt) + (dt.slice(0, 4) !== todayKey().slice(0, 4) ? ' ' + dt.slice(0, 4) : '') : 'Получен') + '</span>' : '<span class="bar" style="height:6px;width:70%"><span style="width:' + Math.round(v / b.n * 100) + '%;background:' + CAT[b.cat][1] + '"></span></span><span class="small num" style="font-weight:800">' + v + ' из ' + b.n + '</span>') + '</div><button class="btn ghost block" data-a="closeSheet">Закрыть</button>';
    } else if (sh.type === 'times') {
      body = head('Время намазов', 'Подстройте под вашу мечеть. Изменения сразу уходят в напоминания бота.') + vTimesBody();
    } else if (sh.type === 'vib') {
      const on = S.set.vib !== false, ok = hapticAvailable();
      body = head('Вибрация', 'Отклик при нажатиях и в тасбихе') +
        '<div class="x-row" style="padding:10px 6px"><span class="col grow"><span style="font-size:15px;font-weight:700">Вибрация при нажатиях</span><span class="small sub">Кнопки, отметки, тасбих</span></span><button class="switch" role="switch" aria-checked="' + on + '" aria-label="Вибрация" data-a="vibToggle" data-nohap="1"><i></i></button></div>' +
        (on ? '<div class="col" style="gap:8px;padding:4px 6px 8px"><span style="font-size:15px;font-weight:700">Сила в тасбихе</span><div class="seg" role="group" aria-label="Сила вибрации">' + [['soft', 'Мягкая'], ['medium', 'Средняя'], ['heavy', 'Сильная']].map((x) => '<button class="' + ((S.set.vibT || 'medium') === x[0] ? 'on' : '') + '" data-a="vibT" data-v="' + x[0] + '" data-nohap="1">' + x[1] + '</button>').join('') + '</div><span class="small sub" style="line-height:1.5">Каждые 33 — двойной толчок, на 100 — особый сигнал.</span></div>' +
          '<button class="btn gold block" data-a="vibTest" data-nohap="1">Проверить</button>' : '') +
        '<div class="small sub" style="padding:6px;line-height:1.55;font-size:13px">' + (ok ? 'Если на iPhone не вибрирует: «Настройки» → «Звуки, тактильные сигналы» → включите «Системные тактильные сигналы». Также вибрация отключается в режиме энергосбережения.' : (!tg ? 'Вибрация работает внутри Telegram. Откройте приложение через бота.' : 'Обновите Telegram до последней версии — в старых версиях вибрация недоступна.')) + '</div>' +
        '<button class="btn ghost block" data-a="closeSheet">Готово</button>';
    } else if (sh.type === 'method') {
      body = head('Метод расчёта', 'Влияет на время Фаджра и Иша') + METHODS.map((m) => opt('setMethod', m[0], S.set.method === m[0], m[1])).join('');
    } else if (sh.type === 'madhab') {
      body = head('Время Асра') + opt('setMadhab', 'Shafi', S.set.madhab !== 'Hanafi', 'Стандартное', 'Шафиитский, маликитский и ханбалитский мазхабы') + opt('setMadhab', 'Hanafi', S.set.madhab === 'Hanafi', 'Ханафитское', 'Аср начинается позже');
    } else if (sh.type === 'level') {
      body = head('Мой уровень', 'Определяет, что вы отмечаете каждый день') + opt('setLevel', 'start', S.set.level === 'start', 'Начало', 'Только пять намазов, одно касание') + opt('setLevel', 'effort', S.set.level === 'effort', 'Усердие', 'Статусы, сунна, азкары и тасбих') + opt('setLevel', 'ihsan', S.set.level === 'ihsan', 'Ихсан', 'Полный учёт: джамаат, каза, посты, тип дня');
    } else if (sh.type === 'hijri') {
      body = head('Дата хиджры', 'Если начало месяца у вас отличается на день') + [[-1, 'На день раньше'], [0, 'Без сдвига (Умм аль-Кура)'], [1, 'На день позже']].map((x) => opt('setHijri', x[0], (S.set.hijriAdj || 0) === x[0], x[1])).join('');
    } else if (sh.type === 'theme') {
      body = head('Тема') + [['auto', 'Как в Telegram'], ['dark', 'Тёмная'], ['light', 'Светлая']].map((x) => opt('setTheme', x[0], S.set.theme === x[0], x[1])).join('');
    } else if (sh.type === 'qada') {
      const st = (key, label, v) => '<div class="x-row" style="padding:10px 6px"><span class="col grow"><span style="font-size:15px;font-weight:700">' + label + '</span></span><span class="stepper"><button class="step" data-a="base" data-v="' + key + ':-10" aria-label="минус 10">−10</button><button class="step" data-a="base" data-v="' + key + ':-1" aria-label="минус 1">' + I.minus + '</button><span class="num" style="min-width:40px;text-align:center;font-weight:800;font-size:17px">' + v + '</span><button class="step plus" data-a="base" data-v="' + key + ':1" aria-label="плюс 1">' + I.plus + '</button><button class="step plus" data-a="base" data-v="' + key + ':10" aria-label="плюс 10">+10</button></span></div>';
      body = head('Долг за прошлые годы', 'Пропуски до начала учёта в приложении') + st('qadaBase', 'Фард-намазы', S.set.qadaBase || 0) + st('fastBase', 'Дни поста Рамадана', S.set.fastBase || 0) + '<div class="small sub" style="padding:4px 6px;line-height:1.5">Новые пропуски считаются автоматически из ваших отметок.</div><button class="btn gold block" data-a="closeSheet">Готово</button>';
    } else if (sh.type === 'sync') {
      const ok = S.set.syncUrl && sync.status === 'ok';
      body = head('Таблица и бот', 'Отметки попадают в вашу Google-таблицу, бот присылает напоминания') +
        (!inTelegram ? '<div class="small" style="color:var(--amber-text);padding:4px 6px;line-height:1.5">Подключение работает только внутри Telegram.</div>' : '') +
        '<div class="small sub" style="padding:2px 6px;line-height:1.55;font-size:13px">Вставьте адрес веб-приложения из Google Apps Script (вида https://script.google.com/macros/s/…/exec). Он сохранится только в вашем облаке Telegram.</div>' +
        '<label class="search"><span class="sr">Адрес скрипта</span><input type="url" data-in="syncUrl" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.syncDraft != null ? S.syncDraft : S.set.syncUrl) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
        (S.set.syncUrl && sync.status ? '<div class="small" style="padding:2px 6px;line-height:1.5;color:' + (ok ? 'var(--emerald-text)' : 'var(--red-text)') + '">' + (ok ? 'Подключено, данные синхронизированы.' : esc(sync.status)) + '</div>' : '') +
        '<button class="btn gold block" data-a="syncSave">' + (S.set.syncUrl ? 'Сохранить и синхронизировать' : 'Подключить') + '</button>' +
        (S.set.syncUrl ? '<button class="btn ghost block" data-a="syncOff">Отключить</button>' : '');
    } else if (sh.type === 'fast') {
      const k = viewKey(), cur = getDay(k).p, fi = fastingInfo(k);
      body = head('Пост · ' + fmtDate(k), fi ? fi.text : 'Обычный день') + [['fast', 'Постился', 'Добровольный или обязательный пост'], ['qada', 'Каза поста', 'Восполнил пропущенный день Рамадана'], ['missed', 'Пропустил', 'Пропущенный день Рамадана — станет долгом']].map((o) => opt('setFast', o[0], cur === o[0], o[1], o[2])).join('') + (cur ? '<button class="btn block" data-a="setFast" data-v="" style="background:none;color:var(--sub);font-size:14px">Снять отметку</button>' : '');
    }
    return '<button class="scrim' + (enter ? ' enter' : '') + '" data-a="closeSheet" aria-label="Закрыть"></button><div class="sheet' + (sh.type === 'tfa' ? ' sh-tall sh-tfa' : sh.type === 'qnav' ? ' sh-tall' : '') + (enter ? ' enter' : '') + '" role="dialog" aria-modal="true">' + body + '</div>';
  }

  /* ===== отрисовка ===== */
  /* «Живое небо»: на слабых Android (Telegram сообщает класс LOW) и при «уменьшении движения» — без размытия и анимаций */
  const LOWFX = /Telegram-Android\/[^(]*\([^)]*;\s*LOW\)/i.test(navigator.userAgent || '');
  const REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let lastHdr = '';
  function skyDim() {
    if (!S.set.level) return 0.1;
    if (S.tab === 'quran' && S.quran.reader) return rd().bg === 'sky' ? 0.6 : 0.82;
    return { home: 0.08, zikr: 0.28, quran: 0.42, progress: 0.38, more: 0.38 }[S.tab] || 0.38;
  }
  /* v12: живое небо больше не стоит за всеми экранами — оно только в карточке текущего намаза (и в читалке, если выбран фон «Небо»).
     Остальные экраны — на спокойном фоне, и шапка Telegram окрашивается в тот же цвет. */
  const APP_BG = { dark: '#0A0E1A', light: '#F3F0E9' };
  function updateSkyBg() {
    const light = document.documentElement.classList.contains('light');
    const useSky = readingOn && rd().bg === 'sky', el = document.getElementById('sky');
    if (el) el.classList.toggle('off', !useSky);
    let hdr = readerBgColor();
    if (useSky && window.IbadaSky) {
      const o = skyOpts();
      hdr = window.IbadaSky.update({ lat: o.lat, lng: o.lng, light, dim: skyDim(), ten: o.ten, lowfx: LOWFX || REDUCE, fixed: o.fixed });
    }
    if (!hdr) hdr = light ? APP_BG.light : APP_BG.dark;
    if (hdr && hdr !== lastHdr && tg) {
      lastHdr = hdr;
      try { if (ver('6.1')) { tg.setHeaderColor(hdr); tg.setBackgroundColor(hdr); } if (ver('7.10')) tg.setBottomBarColor(hdr); } catch (e) {}
    }
  }
  function applyTheme() {
    const scheme = S.set.theme === 'auto' ? (tg && tg.colorScheme ? tg.colorScheme : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) : S.set.theme;
    document.documentElement.classList.toggle('light', scheme === 'light');
    document.documentElement.classList.toggle('lowfx', LOWFX);
    updateSkyBg();
  }
  // Единственный «громкий» момент: отметка намаза — михраб вспыхивает светом
  function celebrate(id) {
    if (REDUCE || LOWFX) return;
    const pick = () => [document.querySelector('.hero2'), document.querySelector('.pr2[data-id="' + id + '"]')];
    pick().forEach((el) => { if (!el) return; el.classList.remove('lit'); void el.offsetWidth; el.classList.add('lit'); });
    setTimeout(() => { pick().forEach((el) => el && el.classList.remove('lit')); }, 1700);
  }
  // Заготовка вместо «Загрузка…»: силуэт экрана «Сегодня», пока читаются данные
  const vSkeleton = () => '<div class="skel" aria-label="Загрузка" role="status"><div class="between"><span class="col" style="gap:8px"><i style="width:170px;height:12px"></i><i style="width:120px;height:16px"></i></span><i style="width:48px;height:48px;border-radius:24px"></i></div><i style="height:300px;border-radius:28px"></i><i style="width:96px;height:18px"></i><i style="height:310px;border-radius:24px"></i></div>';
  let lastView = '', lastSheet = '';
  function render() {
    syncReading();
    applyTheme();
    const onb = !S.set.level;
    const reader = S.tab === 'quran' && S.quran.reader;
    const screen = $('#screen');
    // плавное появление — только когда сменился экран, а не при каждой отметке
    const view = !S.loaded ? 'load' : onb ? 'onb' : S.tab + (reader ? ':r' : '') + (S.tab === 'progress' ? ':' + S.prog.period : '') + (S.tab === 'zikr' ? ':' + S.zView : '') + (S.viewKey || '');
    const enter = view !== lastView && lastView !== '' && !REDUCE;
    lastView = view;
    screen.className = 'screen' + (onb || reader ? ' no-tabs' : '') + (reader ? ' reader' : '') + (enter ? ' enter' : '');
    screen.innerHTML = !S.loaded ? vSkeleton() : onb ? vOnboarding() : S.tab === 'home' ? vHome() : S.tab === 'zikr' ? vZikr() : S.tab === 'quran' ? vQuran() : S.tab === 'progress' ? vProgress() : vMore();
    const tabs = [['home', 'Сегодня'], ['quran', 'Коран'], ['zikr', 'Зикр'], ['progress', 'Прогресс'], ['more', 'Ещё']];
    $('#tabbar').innerHTML = onb || reader || !S.loaded ? '' : '<nav aria-label="Разделы">' + tabs.map((t) => '<button data-a="tab" data-v="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + I.tab[t[0]] + '<span>' + t[1] + '</span></button>').join('') + '</nav>';
    // шторка выезжает один раз — при открытии; перерисовка внутри неё не повторяет анимацию
    const sheetId = S.sheet ? S.sheet.type + ':' + (S.sheet.id || '') : '';
    const sheetEnter = !!sheetId && sheetId !== lastSheet;
    const oldSheet = document.querySelector('#overlay .sheet'), keepTop = !sheetEnter && oldSheet ? oldSheet.scrollTop : 0;
    lastSheet = sheetId;
    $('#overlay').innerHTML = vSheet(sheetEnter) + (S.toast ? '<div class="toast" role="status">' + esc(S.toast) + '</div>' : '');
    if (keepTop) { const ns = document.querySelector('#overlay .sheet'); if (ns) ns.scrollTop = keepTop; }
    syncBackButton();
  }
  function syncBackButton() {
    if (!tg || !tg.BackButton || !ver('6.1')) return;
    const need = !!S.sheet || (S.tab === 'quran' && S.quran.reader) || (S.viewKey && S.viewKey !== todayKey()) || (S.set.level && S.tab !== 'home');
    if (need) tg.BackButton.show(); else tg.BackButton.hide();
  }
  function goBack() {
    if (S.sheet) { S.sheet = null; }
    else if (S.tab === 'quran' && S.quran.reader) { S.quran.reader = null; }
    else if (S.viewKey && S.viewKey !== todayKey()) { S.viewKey = null; }
    else if (S.tab !== 'home') { S.tab = 'home'; $('#scroll').scrollTop = 0; }
    render();
  }
  let toastTimer = null;
  function toast(msg) { S.toast = msg; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = ''; render(); }, 2200); }

  /* ===== геолокация ===== */
  function setLocation(lat, lng, city, tz) {
    S.set.lat = Math.round(lat * 10000) / 10000; S.set.lng = Math.round(lng * 10000) / 10000;
    S.set.city = city || ''; S.set.tz = tz || (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    if (!S.set.method || S.set.method === 'MuslimWorldLeague') S.set.method = guessMethod(S.set.tz);
    saveSettings(); S.sheet = null; render(); toast('Время намазов рассчитано');
  }
  function guessMethod(tz) {
    if (!tz) return 'MuslimWorldLeague';
    if (/Dubai|Muscat/.test(tz)) return 'Dubai';
    if (/Riyadh|Aden|Bahrain/.test(tz)) return 'UmmAlQura';
    if (/Kuwait/.test(tz)) return 'Kuwait';
    if (/Qatar/.test(tz)) return 'Qatar';
    if (/Istanbul/.test(tz)) return 'Turkey';
    if (/Cairo/.test(tz)) return 'Egyptian';
    if (/Karachi|Dhaka|Kolkata/.test(tz)) return 'Karachi';
    if (/Singapore|Kuala_Lumpur|Jakarta/.test(tz)) return 'Singapore';
    return 'MuslimWorldLeague';
  }
  function locate() {
    const viaBrowser = () => {
      if (!navigator.geolocation) { S.sheet = { type: 'city' }; render(); return; }
      navigator.geolocation.getCurrentPosition((pos) => setLocation(pos.coords.latitude, pos.coords.longitude, ''), () => { S.sheet = { type: 'city' }; render(); toast('Не удалось определить — выберите город'); }, { timeout: 10000, maximumAge: 3600000 });
    };
    if (tg && ver('8.0') && tg.LocationManager) {
      const lm = tg.LocationManager;
      const go = () => {
        if (!lm.isLocationAvailable) { viaBrowser(); return; }
        lm.getLocation((loc) => {
          if (loc && loc.latitude != null) setLocation(loc.latitude, loc.longitude, '');
          else if (lm.isAccessRequested && !lm.isAccessGranted) { toast('Разрешите доступ к геолокации в настройках'); try { lm.openSettings(); } catch (e) {} }
          else { S.sheet = { type: 'city' }; render(); }
        });
      };
      if (lm.isInited) go(); else lm.init(go);
    } else viaBrowser();
  }
  let cityTimer = null;
  function searchCity(q) {
    S.city.q = q; clearTimeout(cityTimer);
    if (q.trim().length < 2) { S.city.results = []; S.city.error = ''; renderSheetKeepFocus(); return; }
    cityTimer = setTimeout(async () => {
      S.city.loading = true; S.city.error = ''; renderSheetKeepFocus();
      try {
        const r = await fetch(GEO_API + '?count=8&language=ru&format=json&name=' + encodeURIComponent(q.trim()));
        const j = await r.json();
        S.city.results = (j.results || []).map((x) => ({ name: x.name, admin1: x.admin1, country: x.country, lat: x.latitude, lng: x.longitude, tz: x.timezone }));
        if (!S.city.results.length) S.city.error = 'Ничего не найдено. Попробуйте другое написание.';
      } catch (e) { S.city.results = []; S.city.error = 'Нет связи с сервисом поиска. Попробуйте позже или определите автоматически.'; }
      S.city.loading = false; renderSheetKeepFocus();
    }, 400);
  }
  function renderSheetKeepFocus() {
    const inp = document.querySelector('[data-in="city"]');
    const pos = inp ? inp.selectionStart : null;
    $('#overlay').innerHTML = vSheet();
    const n = document.querySelector('[data-in="city"]');
    if (n && inp) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
  }

  /* ===== компас ===== */
  /* Курс телефона (куда смотрит верх экрана) в градусах по часовой стрелке от севера.
     Порядок источников: 1) webkitCompassHeading (iPhone, самый точный); 2) deviceorientationabsolute (Android);
     3) Telegram DeviceOrientation. Значения сглаживаются, поворот рисуется SVG-атрибутом (надёжно в Safari). */
  let compassSource = '', compassSmooth = null, compassGotData = false;
  function startCompass() {
    const qb = qiblaBearing(); if (qb == null) return;
    S.compassOn = true; render();
    const update = (raw, src) => {
      if (raw == null || isNaN(raw)) return;
      compassGotData = true; compassSource = src;
      const h0 = ((raw % 360) + 360) % 360;
      if (compassSmooth == null) compassSmooth = h0;
      else { const d = ((h0 - compassSmooth + 540) % 360) - 180; compassSmooth = (compassSmooth + d * 0.3 + 360) % 360; }
      const heading = compassSmooth;
      S.heading = heading;
      const rot = ((qb - heading) % 360 + 360) % 360;
      const dial = document.getElementById('dial');
      if (dial) dial.setAttribute('transform', 'rotate(' + (-heading).toFixed(1) + ' 115 115)');
      const aligned = rot < 4 || rot > 356;
      const nd = document.getElementById('needleMain'); if (nd) nd.setAttribute('fill', aligned ? '#7FE0BD' : '#E6BE6E');
      const hint = document.getElementById('qiblaHint');
      if (hint) hint.textContent = aligned ? 'Вы смотрите на Каабу' : (rot < 180 ? 'Поворачивайтесь вправо' : 'Поворачивайтесь влево') + ', держа телефон ровно';
      const deg = document.getElementById('qiblaDeg');
      if (deg) deg.textContent = 'Телефон смотрит на ' + Math.round(heading) + '° · кибла ' + Math.round(qb) + '°';
      if (aligned && !S.qiblaAligned) haptic('notify', 'success');
      S.qiblaAligned = aligned;
    };
    const useTelegram = () => {
      if (!(tg && ver('8.0') && tg.DeviceOrientation)) { toast('Компас недоступен на этом устройстве'); return; }
      const ios = tg.platform === 'ios' || tg.platform === 'macos';
      tg.onEvent('deviceOrientationChanged', () => {
        const a = tg.DeviceOrientation.alpha; if (a == null) return;
        const deg = a * 180 / Math.PI;
        update(ios ? 270 - deg : 360 - deg, 'tg');
      });
      tg.DeviceOrientation.start({ refresh_rate: 50, need_absolute: true }, (ok) => { if (!ok) toast('Компас недоступен'); });
    };
    browserCompass(update, useTelegram);
  }
  function browserCompass(update, fallback) {
    let used = false;
    const handler = (e) => {
      if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) update(e.webkitCompassHeading, 'ios');
      else if (e.absolute && e.alpha != null) update(360 - e.alpha, 'abs');
    };
    const attach = () => {
      used = true;
      window.addEventListener('deviceorientationabsolute', handler);
      window.addEventListener('deviceorientation', handler);
      setTimeout(() => { if (!compassGotData) { window.removeEventListener('deviceorientationabsolute', handler); window.removeEventListener('deviceorientation', handler); fallback(); } }, 1500);
    };
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') attach(); else fallback(); }).catch(() => fallback());
    } else if (window.DeviceOrientationEvent) attach();
    else fallback();
    return used;
  }

  /* ===== Коран ===== */
  /* ===== действия ===== */
  const A = {
    onbLevel(v) { S.onbLevel = v; haptic('select'); render(); },
    onbStart() { S.set.level = S.onbLevel; saveSettings(); haptic('notify', 'success'); render(); $('#scroll').scrollTop = 0; },
    tab(v) { const sub = v.split(':'); v = sub[0]; if (sub[1]) S.prog.period = sub[1]; if (S.tab === v && v === 'quran') S.quran.reader = null; S.tab = v; S.sheet = null; render(); $('#scroll').scrollTop = 0; },
    zikr(v) { S.zView = v; S.tab = 'zikr'; render(); $('#scroll').scrollTop = 0; },
    cycleDay() { const k = viewKey(), d = ensureDay(k); d.t = { n: 't', t: 's', s: 'n' }[d.t]; saveDay(k); haptic('select'); render(); },
    todayAll() { S.set.todayAll = !S.set.todayAll; saveSettings(); render(); },
    mode(v) { S.set.detailed = v === '1'; saveSettings(); if (S.sheet && S.sheet.type === 'mode') S.sheet = null; haptic('select'); render(); },
    quick(id) { const k = viewKey(), d = ensureDay(k); if (d.f[id] && d.f[id] !== 'missed') delete d.f[id]; else d.f[id] = (id === 'dhuhr' && isFriday(k) && S.set.level !== 'start') ? 'juma' : 'done'; saveDay(k); const on = !!d.f[id]; haptic(on ? 'notify' : 'impact', on ? 'success' : 'light'); render(); if (on) celebrate(id); },
    sunna(key) { const k = viewKey(), d = ensureDay(k); if (d.s[key]) delete d.s[key]; else d.s[key] = 1; saveDay(k); haptic('select'); render(); },
    step(v) { const p = v.split(':'), key = p[0], delta = +p[1], cap = +p[2]; const k = viewKey(), d = ensureDay(k); const f = key === 'qiyam' ? 'q' : 'w'; d[f] = clamp((d[f] || 0) + delta, 0, cap); saveDay(k); haptic('select'); render(); },
    sheet(v) { const ci = v.indexOf(':'); if (ci > 0) S.sheet = { type: v.slice(0, ci), id: v.slice(ci + 1) }; else S.sheet = { type: v }; if (v === 'city') { S.city = { q: '', results: [], loading: false, error: '' }; } render(); if (v === 'city') { const n = document.querySelector('[data-in="city"]'); if (n && !('ontouchstart' in window)) n.focus(); } },
    closeSheet() { S.sheet = null; render(); },
    /* цели по Корану и наизусть */
    qgSet(v) {
      const sh = S.sheet; if (!sh) return;
      const i = v.indexOf(':'), key = v.slice(0, i), val = v.slice(i + 1);
      if (key === 'days') sh.days = +val;
      else if (key === 'rev') sh.rev = val === '1';
      else { sh[key] = val; if (key === 'k') sh.rev = null; }
      haptic('select'); render();
    },
    qgPick(v) { const sh = S.sheet; if (!sh) return; const s = +v, p = sh.pick || (sh.pick = []), i = p.indexOf(s); if (i >= 0) p.splice(i, 1); else p.push(s); haptic('select'); render(); },
    qgCreate() {
      const sh = S.sheet || {}, g = qgDraft(sh);
      if (!qgSurahs(g).length) { toast('Выберите хотя бы одну суру'); return; }
      if (sh.dl === 'date' && !g.dl) { toast('Выберите дату окончания — позже сегодняшней'); return; }
      if (qgList().filter((x) => !x.fin).length >= QG_MAX) { toast('Можно до ' + QG_MAX + ' целей одновременно'); return; }
      g.id = qgNewId();
      g.b = Math.round(qgStat(g).wDone);
      ['m', 'dl', 'd', 'fin', 't', 'rev', 'b'].forEach((k) => { if (!g[k]) delete g[k]; });
      S.qg.g.push(g);
      const fin = qgCheckFin(g);
      saveQg(); S.sheet = { type: 'qg', id: g.id }; haptic('notify', 'success'); render();
      toast(fin ? 'Все суры этой цели вы уже знаете — МашаАллах!' : 'Цель поставлена — пусть Аллах облегчит');
    },
    qgTog(v) {
      const p = v.split(':'), g = qgById(p[0]), s = +p[1]; if (!g) return;
      g.d = bitPut(g.d, s, !bitHas(g.d, s));
      const fin = qgCheckFin(g); saveQg(); haptic('select'); render(); qgFinished(fin);
    },
    qgRead(v) {
      const R = S.quran.reader; if (!R || R.s !== +v) return;
      const s = R.s, gs = qgForReader(R); if (!gs.length) return;
      const on = !gs.every((g) => bitHas(g.d, s)); let fin = 0;
      gs.forEach((g) => { g.d = bitPut(g.d, s, on); fin += qgCheckFin(g); });
      saveQg(); render();
      if (fin) qgFinished(fin); else if (on) { haptic('notify', 'success'); toast('Сура отмечена — МашаАллах'); } else haptic('select');
    },
    qgEdit(id) { const g = qgById(id), sh = S.sheet; if (!g || !sh) return; sh.edit = 1; sh.dl = g.dl ? 'date' : 'days'; sh.date = g.dl || ''; sh.days = 90; render(); },
    qgSaveDl(id) {
      const g = qgById(id), sh = S.sheet; if (!g || !sh) return;
      const t = todayKey(), d = qgDraft(sh);
      if (sh.dl === 'date' && !d.dl) { toast('Выберите дату — позже сегодняшней'); return; }
      if (d.dl) { g.dl = d.dl; g.ps = t; g.b = Math.round(qgStat(Object.assign({}, g, { dl: '' })).wDone); } else { delete g.dl; delete g.ps; delete g.b; }
      saveQg(); sh.edit = 0; haptic('select'); render(); toast(g.dl ? 'Срок — до ' + fmtDateY(g.dl) : 'Без срока, в своём темпе');
    },
    qgDel(id) {
      const sh = S.sheet; if (!sh) return;
      if (!sh.del) { sh.del = 1; render(); return; }
      S.qg.g = qgList().filter((g) => g.id !== id); saveQg(); S.sheet = null; render(); toast('Цель удалена');
    },
    qgAgain(id) {
      const g0 = qgById(id); if (!g0) return;
      const t = todayKey(), g = { id: qgNewId(), k: g0.k, sc: g0.sc, st: t };
      if (g0.m) g.m = g0.m; if (g0.t) g.t = g0.t; if (g0.rev) g.rev = 1;
      if (g0.dl) g.dl = addDays(t, Math.max(1, diffDays(g0.ps || g0.st, g0.dl) + 1) - 1);
      S.qg.g.push(g); saveQg(); S.sheet = { type: 'qg', id: g.id }; haptic('notify', 'success'); render(); toast('Новый круг — пусть Аллах облегчит');
    },
    qgOpen(id) { const g = qgById(id); if (!g) return; const st = qgStat(g); S.sheet = null; S.tab = 'quran'; S.quran.filter = ''; openSurah(st.next || st.list[0] || 1, 1, qgMode(g)); },
    qRd(v) { const p = v.split(':'); S.sheet = null; S.tab = 'quran'; S.quran.filter = ''; openSurah(+p[0], +p[1] || 1, p[2] || 'ar'); },
    hzStart(v) { const p = v.split(':'), s = +p[0]; if (hzOf(s)[0] === 0) hzPut(s, [1, 0, 0, '']); S.sheet = { type: 'hzS', id: s + (p[1] ? '@' + p[1] : '') }; haptic('select'); render(); },
    hzSet(v) {
      const p = v.split(':'), s = +p[0], to = +p[1], h = hzOf(s), n = D.SURAH_AYAHS[s - 1];
      if (to === h[0]) return;
      if (to === 0) hzPut(s, null);
      else if (to === 1) hzPut(s, [1, h[0] === 2 ? 0 : h[1], 0, '']);
      else hzPut(s, [2, n, 0, todayKey()]);
      haptic('select'); render();
    },
    hzStep(v) {
      const p = v.split(':'), s = +p[0], h = hzOf(s), n = D.SURAH_AYAHS[s - 1]; if (h[0] !== 1) return;
      const a = clamp(h[1] + (+p[1] || 0), 0, n);
      if (a >= n) hzPut(s, [2, n, 0, todayKey()]); else { hzPut(s, [1, a, 0, '']); haptic('select'); }
      render();
    },
    hzRev(v) {
      const p = v.split(':'), s = +p[0], h = hzOf(s), t = todayKey(); if (h[0] !== 2) return;
      const ok = p[1] === 'ok';
      if (ok && h[3] === t && hzNext(h) > t) { toast('Сегодня эта сура уже повторена'); return; }
      const lv = ok ? Math.min(HZ_INT.length - 1, (h[2] || 0) + 1) : 0;
      S.hz.rv = { k: t, n: hzRevToday() + 1 };
      hzPut(s, [2, D.SURAH_AYAHS[s - 1], lv, t]);
      haptic(ok ? 'notify' : 'select', 'success'); render();
      toast(ok ? 'Повторено · следующий раз ' + fmtDate(addDays(t, HZ_INT[lv])) : 'Хорошо, повторим завтра');
    },
    setSky(v) { S.set.sky = v; saveSettings(); haptic('select'); render(); },
    readOfferNo() { S.set.readOffer = 'no'; saveSettings(); render(); },
    readBook(v) { S.sheet.book = v; render(); },
    readDays(v) { S.sheet.days = +v; render(); },
    readWhen(v) { S.sheet.when = v; render(); },
    readStart() {
      const sh = S.sheet || {}, days = sh.days || 90, when = sh.when || (new Date().getHours() >= 18 ? 'tomorrow' : 'today');
      const bk = sh.book || 'saadi';
      let book;
      if (bk === 'saadi') book = { book: 'saadi', title: BOOKS.saadi.title, ed: BOOKS.saadi.ed, vols: BOOKS.saadi.vols.slice() };
      else {
        const pages = Math.round(+sh.pages || 0), title = (sh.title || '').trim().slice(0, 60);
        if (!title || pages < 10) { toast('Укажите название и число страниц'); return; }
        book = { book: 'custom', title, ed: '', vols: [pages] };
      }
      S.read = Object.assign(book, { start: when === 'tomorrow' ? addDays(todayKey(), 1) : todayKey(), days, pos: 0, log: {} });
      saveRead(); S.sheet = { type: 'read' }; haptic('notify', 'success'); render();
      toast('Цель поставлена — пусть Аллах облегчит');
    },
    readAdd(v) { const st = rState(); if (!st) return; readApply(v === 'norm' ? st.left : +v); },
    readVol(v) { S.sheet.vol = +v; render(); },
    readSetPage() {
      const st = rState(); if (!st) return;
      const inp = document.querySelector('[data-in="rdPage"]'), page = Math.round(+(inp && inp.value) || 0);
      const R = st.R, vol = (S.sheet && S.sheet.vol) || rWhere(R, Math.max(1, st.pos))[0];
      if (!page || page < 0 || page > R.vols[vol - 1]) { toast('В томе ' + vol + ' страницы 1–' + R.vols[vol - 1]); return; }
      const abs = R.vols.slice(0, vol - 1).reduce((a, b) => a + b, 0) + page;
      readApply(abs - st.pos);
    },
    readStop(v) { if (v !== 'yes') { S.sheet.stop = 1; render(); return; } S.read = null; saveRead(); S.sheet = null; toast('План чтения завершён'); render(); },
    goalAccept() { const g = ensureGoal(); if (g) { g.st = 'on'; saveGam(); haptic('notify', 'success'); render(); gamCheckSoon(); } },
    goalOther() { const g = ensureGoal(); const c = goalCandidates(g.wk); if (c.length < 2) { toast('Других целей пока нет'); return; } g.alt = ((g.alt || 0) + 1) % c.length; g.id = c[g.alt].id; g.target = c[g.alt].target; saveGam(); render(); },
    goalSkip() { const g = ensureGoal(); if (g) { g.st = 'skip'; saveGam(); render(); } },
    goalBack() { const g = ensureGoal(); if (g) { g.st = 'new'; saveGam(); render(); } },
    gamToggle() { S.set.gam = S.set.gam === false; saveSettings(); if (S.set.gam) { haptic('notify', 'success'); setTimeout(gamCheck, 300); } render(); },
    toPath() { S.sheet = null; S.tab = 'progress'; S.prog.period = 'path'; render(); $('#scroll').scrollTop = 0; },
    setStatus(v) { const i = v.indexOf(':'), id = v.slice(0, i), st = v.slice(i + 1); const k = viewKey(), d = ensureDay(k); if (st) d.f[id] = st; else delete d.f[id]; saveDay(k); S.sheet = null; const good = st && st !== 'missed'; haptic(good ? 'notify' : 'impact', good ? 'success' : 'light'); render(); if (good) celebrate(id); },
    setFast(v) { const k = viewKey(), d = ensureDay(k); d.p = v; saveDay(k); S.sheet = null; haptic('select'); render(); },
    qadaDone() { if (S.set.qadaBase > 0) { S.set.qadaBase--; saveSettings(); S.gam.qadaMade = (S.gam.qadaMade || 0) + 1; const wk = weekStart(todayKey()); S.gam.qw = S.gam.qw || {}; S.gam.qw[wk] = (S.gam.qw[wk] || 0) + 1; Object.keys(S.gam.qw).forEach((x) => { if (x < addDays(wk, -56)) delete S.gam.qw[x]; }); saveGam(); dataVer++; gamCheckSoon(); toast('Альхамдулиллях! Долг уменьшился'); } else toast('Откройте день с пропуском в «Прогрессе» и смените статус на «Каза»'); haptic('notify', 'success'); render(); },
    base(v) { const p = v.split(':'); S.set[p[0]] = Math.max(0, (S.set[p[0]] || 0) + +p[1]); saveSettings(); haptic('select'); render(); },
    locate() { locate(); },
    pickCity(i) { const r = S.city.results[+i]; if (r) setLocation(r.lat, r.lng, r.name, r.tz); },
    tadj(v) { const p = v.split(':'), A2 = S.set.tadj || (S.set.tadj = {}); const n = clamp((+A2[p[0]] || 0) + +p[1], -60, 60); if (n) A2[p[0]] = n; else delete A2[p[0]]; timesChanged(); },
    iqMode(v) {
      const p = v.split(':'), id = p[0], Q = S.set.iq || (S.set.iq = {});
      if (p[1] === 'off') delete Q[id];
      else if (p[1] === 'after') Q[id] = IQ_DEF[id] || 15;
      else {
        let k = todayKey(); if (id === 'juma') { while (!isFriday(k)) k = addDays(k, 1); }
        const T = prayerTimes(k), src = T ? T[id === 'juma' ? 'dhuhr' : id] : null;
        if (src) { const d = new Date(+src + 15 * 60000); const hm = fmtTime(d).split(':'); let mm = Math.ceil(+hm[1] / 5) * 5, hh = +hm[0]; if (mm === 60) { mm = 0; hh = (hh + 1) % 24; } Q[id] = pad(hh) + ':' + pad(mm); } else Q[id] = '13:00';
      }
      timesChanged();
    },
    iqStep(v) { const p = v.split(':'), Q = S.set.iq || (S.set.iq = {}); if (typeof Q[p[0]] !== 'number') return; Q[p[0]] = clamp(Q[p[0]] + +p[1], 0, 90); timesChanged(); },
    timesReset() { S.set.tadj = {}; S.set.iq = {}; timesChanged(); toast('Время по расчёту'); },
    vibToggle() { S.set.vib = S.set.vib === false; saveSettings(); if (S.set.vib) haptic('notify', 'success'); render(); },
    vibT(v) { S.set.vibT = v; saveSettings(); render(); tasbihHaptic(1); },
    vibTest() { tasbihHaptic(1); setTimeout(() => tasbihHaptic(33), 600); setTimeout(() => tasbihHaptic(100), 1400); },
    remindTarget(v) { S.set.remind.target = v; saveSettings(); render(); resched(); },
    setMethod(v) { S.set.method = v; saveSettings(); S.sheet = null; render(); },
    setMadhab(v) { S.set.madhab = v; saveSettings(); S.sheet = null; render(); },
    setLevel(v) { S.set.level = v; saveSettings(); S.sheet = null; render(); },
    setHijri(v) { S.set.hijriAdj = +v; saveSettings(); S.sheet = null; render(); },
    setTheme(v) { S.set.theme = v; saveSettings(); S.sheet = null; render(); },
    backToday() { S.viewKey = null; render(); $('#scroll').scrollTop = 0; },
    zView(v) { S.zView = v; render(); },
    zSel(v) { S.zSel = +v; haptic('select'); render(); },
    tap() {
      if (!S.loaded) return;
      const k = viewKey(), d = ensureDay(k);
      while (d.z.length < D.ZIKRS.length) d.z.push(0);
      d.z[S.zSel] = (d.z[S.zSel] || 0) + 1; saveDay(k, true);
      const c = d.z[S.zSel];
      tasbihHaptic(c);
      const tc = $('#tapCount'); if (tc) tc.textContent = c;
      const tgl = $('#tapGoal'); if (tgl) { tgl.textContent = c >= 100 ? 'цель выполнена' : 'из 100'; tgl.style.color = c >= 100 ? 'var(--gold)' : 'var(--sub)'; }
      const ts = $('#tasbih'); if (ts) { const lit = Math.round((Math.min(c, 100) / 100) * 33); ts.querySelectorAll('.bead').forEach((b, i) => b.classList.toggle('on', i < lit)); }
      const zc = $('#zc' + S.zSel); if (zc) { zc.textContent = c; zc.style.color = c >= 100 ? 'var(--emerald-text)' : 'var(--text)'; }
      const zb = $('#zb' + S.zSel); if (zb) zb.style.width = Math.min(c, 100) + '%';
      const zt = $('#zTotal'); if (zt) zt.textContent = d.z.reduce((a, b) => a + b, 0);
      if (c === 100) render();
    },
    tapUndo() { const k = viewKey(), d = ensureDay(k); d.z[S.zSel] = Math.max(0, (d.z[S.zSel] || 0) - 1); saveDay(k); render(); },
    tapReset() { const k = viewKey(), d = ensureDay(k); d.z[S.zSel] = 0; saveDay(k); render(); },
    azTab(v) { S.azTab = v; render(); },
    az(i) { const k = viewKey(), d = ensureDay(k), which = defaultAzTab(), arr = which === 'morning' ? d.am : d.ae, a = D.AZKAR[which][+i]; while (arr.length < D.AZKAR[which].length) arr.push(0); if (arr[+i] < a.n) arr[+i]++; saveDay(k); haptic(arr[+i] >= a.n ? 'notify' : 'impact', arr[+i] >= a.n ? 'success' : 'light'); render(); },
    azAll() { const k = viewKey(), d = ensureDay(k), which = defaultAzTab(); const arr = D.AZKAR[which].map((a) => a.n); if (which === 'morning') d.am = arr; else d.ae = arr; saveDay(k); haptic('notify', 'success'); render(); },
    dua(v) { S.duaOpen = S.duaOpen === v ? -1 : v; render(); },
    qView(v) { S.quran.view = v; render(); },
    read(v) { const p = v.split(':'), R = S.quran.reader, m = R ? R.mode : ((S.set.qlast && S.set.qlast.m) || 'tr'); S.sheet = null; S.quran.filter = ''; openSurah(+p[0], +p[1] || 1, m); },
    readQ() { const ql = S.set.qlast || { s: 1, a: 1 }; openSurah(ql.s, ql.a, ql.m || 'tr'); },
    qGo(v) { const p = String(v).split(':'), s = +p[0], R = S.quran.reader; if (s < 1 || s > 114) return; openSurah(s, +p[1] || 1, R ? R.mode : 'tr'); },
    qNav() { S.sheet = { type: 'qnav', view: 'surahs' }; S.quran.filter = ''; render(); },
    qNavView(v) { if (S.sheet) S.sheet.view = v; S.quran.filter = ''; render(); },
    qSel(v) {
      const R = S.quran.reader; if (!R) return;
      if (+v && tapTafsir(R)) { R.sel = 0; haptic('select'); S.sheet = { type: 'tfa', s: R.s, a: +v }; render(); return; }
      A.qAct(v);
    },
    qAct(v) {
      const R = S.quran.reader; if (!R) return;
      const a = +v; R.sel = a && R.sel !== a ? a : 0; haptic('select'); render();
      const el = R.sel && document.getElementById('ay' + R.sel), tool = document.querySelector('.qtool');
      if (el && tool) { const over = el.getBoundingClientRect().bottom - tool.getBoundingClientRect().top + 12; if (over > 0) { rdJump = Date.now(); $('#scroll').scrollBy({ top: Math.min(over, Math.max(0, el.getBoundingClientRect().top - hdrBottom() - 8)), behavior: REDUCE ? 'auto' : 'smooth' }); } }
    },
    qMark(v) { const R = S.quran.reader, s = S.sheet && S.sheet.type === 'tfa' ? S.sheet.s : R && R.s; if (!s || !+v) return; const key = s + ':' + (+v), m = S.set.qmarks || [], i = m.indexOf(key); if (i >= 0) m.splice(i, 1); else m.unshift(key); S.set.qmarks = m.slice(0, 100); saveSettings(); haptic('select'); toast(i >= 0 ? 'Закладка убрана' : 'Добавлено в закладки'); },
    qCopy(v) { const R = S.quran.reader, s = S.sheet && S.sheet.type === 'tfa' ? S.sheet.s : R && R.s; if (!s) return; if (R) R.sel = 0; copyText(qAyahText(s, +v)); },
    qShare(v) {
      const R = S.quran.reader, s = S.sheet && S.sheet.type === 'tfa' ? S.sheet.s : R && R.s; if (!s) return;
      const a = +v, text = qAyahText(s, a);
      if (R) R.sel = 0;
      try { if (tg && tg.openTelegramLink && ver('6.1')) { tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent('Коран ' + s + ':' + a) + '&text=' + encodeURIComponent(text)); render(); return; } } catch (e) {}
      if (navigator.share) { navigator.share({ text }).catch(() => {}); render(); return; }
      copyText(text);
    },
    qTfa(v) { const R = S.quran.reader; if (!R) return; R.sel = 0; S.sheet = { type: 'tfa', s: R.s, a: +v }; render(); },
    tfaNav(v) { if (!S.sheet || S.sheet.type !== 'tfa' || !+v) return; S.sheet.a = +v; render(); const el = document.querySelector('.sheet'); if (el) el.scrollTop = 0; },
    tfaRetry() { if (S.sheet) { S.sheet.err = 0; render(); } },
    qReadTo(v) { const R = S.quran.reader; if (!R) return; R.sel = 0; if (readTo(gOf(R.s, +v)) !== false) render(); },
    tfHere() {
      const R = S.quran.reader; if (!R || !R.tf || !R.tf.groups) return;
      const bottom = window.innerHeight - 92, base = gOf(R.s, 1) - 1; let best = -1;
      document.querySelectorAll('#screen .qg').forEach((el) => { if (el.getBoundingClientRect().bottom <= bottom + 2) best = Math.max(best, +el.dataset.k); });
      if (best < 0) { toast('Дочитайте толкование до конца — и нажмите снова'); return; }
      const g = base + R.tf.groups[best].t, cur = readG(S.read);
      if (g <= cur) { toast('Уже отмечено до ' + ayName(cur)); return; }
      readTo(g);
    },
    rdSet(v) {
      const i = v.indexOf(':'), k = v.slice(0, i), x = v.slice(i + 1), r = Object.assign({}, S.set.rd || {});
      if (k === 'fs' || k === 'as') r[k] = clamp(+x || 3, 1, 5);
      else if (k === 'ar' || k === 'ru' || k === 'auto' || k === 'full') r[k] = x === '1';
      else if (k === 'bg' && RD_BG[x]) r.bg = x;
      else if (k === 'font') r.font = x === 'plain' ? 'plain' : 'book';
      else if (k === 'lay') r.lay = x === 'cards' ? 'cards' : 'book';
      else if (k === 'tap') r.tap = x === 'tf' ? 'tf' : 'act';
      else return;
      const eff = Object.assign({}, RD_DEF, r);
      if (!eff.ar && !eff.ru) { if (k === 'ar') r.ru = true; else r.ar = true; }
      S.set.rd = r; saveSettings(); haptic('select');
      if (k === 'full') fullscreen(readingOn && r.full);
      const R = S.quran.reader, anc = R && (R.cur || R.a) ? 'ay' + (R.cur || R.a) : '';
      keepAnchor(anc, () => render());
    },
    closeReader() { S.quran.reader = null; render(); },
    qMode(v) {
      const R = S.quran.reader;
      if (!R || R.mode === v || ['ar', 'tr', 'tf'].indexOf(v) < 0 || (v === 'tf' && !sai())) return;
      const a = topAyah() || R.cur || R.a || 1;
      R.mode = v; R.a = a; R.cur = a; R.go = a > 1 ? a : 0; R.sel = 0; S.quran.hid = false;
      if (v !== 'tf') { S.set.qlast = { s: R.s, a, m: v }; saveSettings(); }
      if (v === 'tf') { if (R.tf && R.tf.groups) tfInitWin(R); else tfEnsure(R); }
      render(); if (!R.go) $('#scroll').scrollTop = 0; readerScroll(R);
    },
    tfMore() { const R = S.quran.reader; if (!R || !R.win) return; keepAnchor('tfg' + R.win[1], () => { tfExtend(R); render(); }); },
    tfPrev() { const R = S.quran.reader; if (!R || !R.win || !R.win[0]) return; const k0 = R.win[0]; keepAnchor('tfg' + k0, () => { R.win[0] = tfSpanBack(R.tf, k0 - 1); render(); }); },
    tfRetry() { const R = S.quran.reader; if (!R) return; R.tf = null; tfEnsure(R); render(); },
    tfMark(v, el) { const p = v.split(':'), card = el && el.closest('.tfg'); keepAnchor(card ? card.id : '', () => readTo(gOf(+p[0], +p[1]))); },
    tfNext() {
      const R = S.quran.reader; if (!R || !R.win || !R.tf || !R.tf.groups) return;
      const k1 = R.win[1], G = R.tf.groups, g = gOf(R.s, G[k1].t);
      if (g > readG(S.read) && readTo(g) === false) return;
      if (k1 >= G.length - 1) { if (R.s < 114) openSurah(R.s + 1, 1, 'tf'); return; }
      keepAnchor('tfg' + k1, () => { tfExtend(R); render(); });
    },
    readOpen() {
      const R = S.read; if (!isSaadi(R)) return;
      const x = gAyah(Math.min(readG(R) + 1, sai().n - 1));
      S.sheet = null; S.tab = 'quran';
      openSurah(x[0], x[1], 'tf');
    },
    mark(v) { const m = S.set.qmarks || []; const i = m.indexOf(v); if (i >= 0) m.splice(i, 1); else m.unshift(v); S.set.qmarks = m.slice(0, 100); const p = v.split(':'); S.set.qlast = { s: +p[0], a: +p[1] }; saveSettings(); haptic('select'); render(); },
    period(v) { S.prog.period = v; render(); },
    bar(v) { S.prog.bar = +v; render(); },
    calDay(v) { S.prog.day = v; render(); },
    openDay(v) { S.viewKey = v; S.tab = 'home'; render(); $('#scroll').scrollTop = 0; },
    compass() { startCompass(); },
    syncSave() {
      const url = String(S.syncDraft != null ? S.syncDraft : S.set.syncUrl || '').trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(url)) { toast('Адрес должен начинаться с https://script.google.com/macros/s/ и заканчиваться на /exec'); return; }
      if (!inTelegram) { toast('Откройте приложение в Telegram'); return; }
      if (url !== S.set.syncUrl) { S.set.lastSync = 0; S.set.pending = []; }
      S.set.syncUrl = url; S.syncDraft = null; sync.status = ''; saveSettings(); render();
      syncNow(true).then(() => { toast(sync.status === 'ok' ? 'Таблица подключена' : 'Не получилось: ' + sync.status); });
    },
    syncOff() { S.set.syncUrl = ''; S.set.lastSync = 0; S.set.pending = []; S.syncDraft = null; sync.status = ''; saveSettings(); S.sheet = null; render(); toast('Таблица отключена'); },
    remind(key) { const R = S.set.remind || (S.set.remind = {}); R[key] = R[key] === false; saveSettings(); haptic('select'); render(); clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 1500); },
    remindOffset(v) { S.set.remind.offset = +v; saveSettings(); render(); clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 1500); },
    remindTime(v) { S.set.remind.summaryTime = v; saveSettings(); render(); clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), 1500); },
    share() { if (!SHARE_LINK) return; const url = 'https://t.me/share/url?url=' + encodeURIComponent(SHARE_LINK) + '&text=' + encodeURIComponent('Ибада — время намазов, Коран, азкары и учёт поклонения'); if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank'); }
  };

  // Тасбих срабатывает в момент касания (pointerdown), а не после отпускания — так отклик мгновенный и не теряются быстрые касания.
  let lastPointerTap = 0;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-a="tap"]');
    if (!el || e.button > 0) return;
    lastPointerTap = Date.now();
    el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 110);
    A.tap();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = A[el.dataset.a];
    if (!fn) return;
    e.preventDefault();
    if (el.dataset.a === 'tap' && Date.now() - lastPointerTap < 1000) return;
    hapticFired = false;
    fn(el.dataset.v || '', el);
    // Лёгкий отклик для любой кнопки, у которой нет своего
    if (!hapticFired && !el.dataset.nohap) haptic(el.dataset.a === 'closeSheet' || el.dataset.a === 'tab' || el.dataset.a === 'sheet' ? 'select' : 'impact', 'light');
  });
  document.addEventListener('change', (e) => {
    const t = e.target, m = /^iq:(\w+)$/.exec(t.dataset.in || '');
    if (m && /^\d{1,2}:\d{2}/.test(t.value)) { (S.set.iq || (S.set.iq = {}))[m[1]] = t.value.slice(0, 5); haptic('select'); timesChanged(); }
    const di = t.dataset.in;
    if ((di === 'qgFrom' || di === 'qgTo') && S.sheet) { S.sheet[di === 'qgFrom' ? 'from' : 'to'] = +t.value || 1; render(); }
    if (di === 'qgDate' && S.sheet) { S.sheet.date = String(t.value || '').replace(/-/g, ''); render(); }
    if (di === 'qgUpTo' && t.value) {
      const g = qgById(t.dataset.g); if (!g) return;
      const L = qgSurahs(g), i = L.indexOf(+t.value); if (i < 0) return;
      L.slice(0, i + 1).forEach((s) => { g.d = bitPut(g.d, s, true); });
      const fin = qgCheckFin(g); saveQg(); render();
      if (fin) qgFinished(fin); else { haptic('notify', 'success'); toast('Отмечены суры до «' + D.SURAH_RU[+t.value - 1] + '» включительно'); }
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.in === 'city') searchCity(t.value);
    if (t.dataset.in === 'syncUrl') S.syncDraft = t.value;
    if (t.dataset.in === 'rdTitle' && S.sheet) S.sheet.title = t.value;
    if (t.dataset.in === 'rdPages' && S.sheet) S.sheet.pages = +t.value || 0;
    if (t.dataset.in === 'qgTitle' && S.sheet) S.sheet.t = t.value;
    if (t.dataset.in === 'qgPickQ' && S.sheet) { S.sheet.q = t.value; const pos = t.selectionStart; render(); const n = document.querySelector('[data-in="qgPickQ"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
    if (t.dataset.in === 'surah') { S.quran.filter = t.value; const pos = t.selectionStart; render(); const n = document.querySelector('[data-in="surah"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
  });

  /* ===== запуск ===== */
  async function init() {
    if (tg) {
      try { tg.ready(); tg.expand(); } catch (e) {}
      try { if (ver('7.7')) tg.disableVerticalSwipes(); } catch (e) {}
      try { if (ver('6.1')) tg.BackButton.onClick(goBack); } catch (e) {}
      try { tg.onEvent('themeChanged', () => render()); } catch (e) {}
    }
    render();
    await loadAll();
    S.loaded = true;
    render();
    $('#scroll').addEventListener('scroll', onReaderScroll, { passive: true });
    setInterval(tfTick, 1000);
    // толкование одного аята: свайп влево — следующий аят, вправо — предыдущий
    let swX = 0, swY = 0, swOn = false;
    document.addEventListener('touchstart', (e) => { swOn = !!(e.target.closest && e.target.closest('.sh-tfa')); if (swOn) { swX = e.touches[0].clientX; swY = e.touches[0].clientY; } }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!swOn) return; swOn = false;
      const t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
      const btn = document.querySelector('.tfa-nav [aria-label="' + (dx < 0 ? 'Следующий аят' : 'Предыдущий аят') + '"]');
      if (btn && !btn.disabled) btn.click();
    }, { passive: true });
    // шторку можно смахнуть вниз, когда она прокручена к началу
    let dg = null;
    const ov = $('#overlay');
    ov.addEventListener('touchstart', (e) => {
      const sh = e.target.closest && e.target.closest('.sheet');
      dg = sh && e.touches.length === 1 && !e.target.closest('input, textarea, select, .rs-steps, .qg-pick') ? { sh, y0: e.touches[0].clientY, x0: e.touches[0].clientX, top: sh.scrollTop, dy: 0, on: false, t0: Date.now() } : null;
    }, { passive: true });
    ov.addEventListener('touchmove', (e) => {
      if (!dg) return;
      const dy = e.touches[0].clientY - dg.y0, dx = e.touches[0].clientX - dg.x0;
      if (!dg.on) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || dg.top > 0 || dg.sh.scrollTop > 0 || Math.abs(dx) > Math.abs(dy)) { dg = null; return; }
        dg.on = true; dg.y0 = e.touches[0].clientY;
      }
      dg.dy = Math.max(0, e.touches[0].clientY - dg.y0);
      dg.sh.style.transform = 'translateY(' + dg.dy + 'px)';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    ov.addEventListener('touchend', () => {
      if (!dg || !dg.on) { dg = null; return; }
      const sh = dg.sh, fast = dg.dy > 40 && dg.dy / Math.max(1, Date.now() - dg.t0) > 0.5;
      sh.classList.add('snap');
      if (dg.dy > 110 || fast) { sh.style.transform = 'translateY(110%)'; haptic('impact', 'light'); setTimeout(() => { S.sheet = null; render(); }, 200); }
      else { sh.style.transform = ''; setTimeout(() => sh.classList.remove('snap'), 260); }
      dg = null;
    }, { passive: true });
    // «Настройки» в меню Telegram ведут в «Ещё»
    try { if (tg && tg.SettingsButton && ver('7.0')) { tg.SettingsButton.show(); tg.SettingsButton.onClick(() => { S.sheet = null; S.quran.reader = null; S.tab = 'more'; render(); $('#scroll').scrollTop = 0; }); } } catch (e) {}
    if (canSync()) syncNow(true);
    setTimeout(gamStart, 500);
    let lastVisibleSync = Date.now();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFromCloud(); });
    try { if (tg) { tg.onEvent('deactivated', () => flush(true)); tg.onEvent('activated', () => refreshFromCloud()); } } catch (e) {}
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && canSync() && Date.now() - lastVisibleSync > 120000) { lastVisibleSync = Date.now(); syncNow(true); } });
    setInterval(updateSkyBg, 60000);
    window.addEventListener('resize', () => updateSkyBg());
    setInterval(() => {
      const active = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (!S.sheet && !active && S.loaded && (S.tab === 'home')) render();
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); else render(); });
    window.addEventListener('pagehide', () => flush(true));
  }
  init();
})();
