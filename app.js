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
  const haptic = (type, style) => { try { if (!tg || !tg.HapticFeedback) return; if (type === 'impact') tg.HapticFeedback.impactOccurred(style || 'light'); else if (type === 'select') tg.HapticFeedback.selectionChanged(); else tg.HapticFeedback.notificationOccurred(style || 'success'); } catch (e) {} };
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  /* ===== состояние ===== */
  const DEFAULT_SET = { level: '', lat: null, lng: null, city: '', tz: '', method: 'MuslimWorldLeague', madhab: 'Shafi', hijriAdj: 0, theme: 'auto', qadaBase: 0, fastBase: 0, detailed: true, qlast: null, qmarks: [] };
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
    toast: '', loaded: false
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
    const ck = k + '|' + S.set.lat + '|' + S.set.lng + '|' + S.set.method + '|' + S.set.madhab;
    if (timesCache[ck]) return timesCache[ck];
    try {
      const coords = new adhan.Coordinates(S.set.lat, S.set.lng);
      const params = (adhan.CalculationMethod[S.set.method] || adhan.CalculationMethod.MuslimWorldLeague)();
      params.madhab = S.set.madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
      if (Math.abs(S.set.lat) > 48 && adhan.HighLatitudeRule && adhan.HighLatitudeRule.recommended) params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coords);
      const t = new adhan.PrayerTimes(coords, dateOfKey(k), params);
      const r = { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha };
      timesCache[ck] = r;
      return r;
    } catch (e) { return null; }
  }
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
  const SKY = {
    night: 'linear-gradient(180deg,#05081A 0%,#0E1634 45%,#1B2550 100%)',
    dawn: 'linear-gradient(180deg,#141D45 0%,#3B3F72 45%,#9B6A7E 78%,#E39B72 100%)',
    morning: 'linear-gradient(180deg,#1C3F78 0%,#3570AE 50%,#79A8D6 100%)',
    day: 'linear-gradient(180deg,#173A70 0%,#2E64A3 50%,#6E9CCB 100%)',
    asr: 'linear-gradient(180deg,#131D3A 0%,#2E3B66 36%,#7D6479 66%,#D48C5C 88%,#EDB46F 100%)',
    sunset: 'linear-gradient(180deg,#0F1433 0%,#2B2552 40%,#7A3F62 75%,#C9624F 100%)'
  };

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
    return [d.t + f + s, d.q || 0, d.w || 0, (d.am || []).join('.'), (d.ae || []).join('.'), (d.z || []).join('.'), P_CODE[d.p] || ''].join('|');
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
        if (this.cloud) { tg.CloudStorage.getItems(keys, (err, vals) => res(err ? {} : (vals || {}))); return; }
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
        if (this.cloud) { tg.CloudStorage.setItem(key, val, () => res()); return; }
        try { localStorage.setItem('ibada:' + key, val); } catch (e) {} res();
      });
    }
  };
  const dirty = {};
  let saveTimer = null;
  function saveDay(k) { dirty[halfKey(k)] = true; schedule(); }
  function saveSettings() { dirty.settings = true; schedule(); }
  function schedule() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 350); }
  function flush() {
    Object.keys(dirty).forEach((hk) => {
      delete dirty[hk];
      if (hk === 'settings') { store.set('settings', JSON.stringify(S.set)); return; }
      const prefix = hk.slice(2, 8), half = hk.slice(9);
      const obj = {};
      Object.keys(S.days).forEach((k) => {
        if (k.slice(0, 6) !== prefix) return;
        const dd = +k.slice(6, 8);
        if ((half === '1') !== (dd <= 15)) return;
        if (!isEmptyDay(S.days[k])) obj[k.slice(6, 8)] = encodeDay(S.days[k]);
      });
      store.set(hk, JSON.stringify(obj));
    });
  }
  async function loadAll() {
    try {
      const ks = await store.keys();
      const want = ks.filter((k) => k === 'settings' || k.indexOf('h_') === 0);
      const vals = {};
      for (let i = 0; i < want.length; i += 50) Object.assign(vals, await store.get(want.slice(i, i + 50)));
      if (vals.settings) { try { S.set = Object.assign({}, DEFAULT_SET, JSON.parse(vals.settings)); } catch (e) {} }
      Object.keys(vals).forEach((hk) => {
        if (hk.indexOf('h_') !== 0) return;
        let obj = {}; try { obj = JSON.parse(vals[hk]) || {}; } catch (e) {}
        const prefix = hk.slice(2, 8);
        Object.keys(obj).forEach((dd) => { S.days[prefix + dd] = decodeDay(obj[dd]); });
      });
    } catch (e) {}
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
    bookmarkOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
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

  function vSky() {
    const sk = skyState();
    if (!sk) {
      return '<div class="sky" style="background:' + SKY.night + '"><div class="sky-text"><div class="sky-label">Время намазов</div><div class="sky-name" style="font-size:40px">Где вы?</div><div class="sky-time">Укажите город, чтобы рассчитать время</div></div>' +
        '<div class="sky-empty"><button class="btn gold block" data-a="locate">' + I.pin + 'Определить автоматически</button><button class="btn ghost block" data-a="sheet" data-v="city" style="color:#fff;border-color:rgba(255,255,255,.35)">Выбрать город</button></div></div>';
    }
    const P0 = [24, 104], P1 = [179, -56], P2 = [334, 104];
    const B = (t) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
    const night = sk.phase === 'night';
    const t = sk.sun, end = B(t), q1 = [P0[0] + t * (P1[0] - P0[0]), P0[1] + t * (P1[1] - P0[1])];
    const marks = ['fajr', 'dhuhr', 'asr', 'maghrib'].map((id) => { const p = B(sk.fr[id]); const passed = sk.now >= sk.T[id]; return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="' + (passed ? '#FFE3A8' : 'none') + '" stroke="' + (passed ? 'none' : '#fff') + '" stroke-width="1.5"/>'; }).join('');
    const dp = B(sk.fr.dhuhr), ap = B(sk.fr.asr);
    const label = sk.current ? 'Сейчас · ' + PRAYERS.find((p) => p.id === sk.current).name : 'Время духа';
    const sun = night || sk.phase === 'sunset' ? '' : '<circle cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="18" fill="#FFD27A" opacity=".25"/><circle cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="9" fill="#FFD27A"/>';
    const stars = night || sk.phase === 'sunset' || sk.phase === 'dawn' ? '<g fill="#fff"><circle cx="96" cy="46" r="1.1" opacity=".8"/><circle cx="140" cy="28" r=".8" opacity=".6"/><circle cx="226" cy="34" r="1.2" opacity=".7"/><circle cx="262" cy="62" r=".8" opacity=".5"/><circle cx="70" cy="92" r=".9" opacity=".5"/><circle cx="300" cy="104" r="1" opacity=".4"/><circle cx="178" cy="18" r=".9" opacity=".6"/></g>' : '';
    const moon = night ? '<path d="M286 52a20 20 0 1 0 15 32 16 16 0 1 1-15-32z" fill="#F2D38E" opacity=".95"/>' : '';
    return '<div class="sky" style="background:' + SKY[sk.phase] + '">' +
      '<svg width="100%" height="318" viewBox="0 0 358 318" preserveAspectRatio="xMidYMin slice" aria-hidden="true" style="inset:0">' + stars + moon +
      '<g fill="none" stroke="#fff" stroke-width="1" opacity=".12" transform="translate(179 104)"><rect x="-62" y="-62" width="124" height="124"/><rect x="-62" y="-62" width="124" height="124" transform="rotate(45)"/><circle r="40"/><rect x="-28" y="-28" width="56" height="56"/><rect x="-28" y="-28" width="56" height="56" transform="rotate(45)"/></g></svg>' +
      '<div class="sky-text"><div class="sky-label">' + esc(label) + '</div><div class="sky-name">' + sk.next.name + '</div><div class="sky-time num">через ' + untilText(sk.nextTime - sk.now) + ' · ' + fmtTime(sk.nextTime) + '</div></div>' +
      '<svg width="100%" height="128" viewBox="0 0 358 128" preserveAspectRatio="xMidYMax meet" aria-hidden="true" style="left:0;bottom:16px;overflow:visible;font-family:var(--sans)">' +
      '<path d="M0 104H358" stroke="#fff" stroke-opacity=".25"/>' +
      '<path d="M24 104Q179 -56 334 104" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>' +
      (night ? '' : '<path d="M24 104Q' + q1[0].toFixed(1) + ' ' + q1[1].toFixed(1) + ' ' + end[0].toFixed(1) + ' ' + end[1].toFixed(1) + '" fill="none" stroke="#FFE3A8" stroke-width="2.2" stroke-linecap="round"/>') +
      marks + sun +
      '<text x="24" y="124" fill="#fff" fill-opacity=".88" font-size="11" font-weight="700">Фаджр ' + fmtTime(sk.T.fajr) + '</text>' +
      '<text x="' + dp[0].toFixed(1) + '" y="' + (dp[1] - 12).toFixed(1) + '" fill="#fff" fill-opacity=".88" font-size="11" font-weight="700" text-anchor="middle">Зухр ' + fmtTime(sk.T.dhuhr) + '</text>' +
      '<text x="' + (ap[0] - 10).toFixed(1) + '" y="' + (ap[1] - 8).toFixed(1) + '" fill="#fff" fill-opacity=".88" font-size="11" font-weight="700" text-anchor="end">Аср ' + fmtTime(sk.T.asr) + '</text>' +
      '<text x="334" y="124" fill="#fff" fill-opacity=".88" font-size="11" font-weight="700" text-anchor="end">Магриб ' + fmtTime(sk.T.maghrib) + '</text>' +
      '</svg></div>';
  }

  function vHome() {
    const k = viewKey(), today = todayKey(), isToday = k === today, d = getDay(k), lvl = S.set.level;
    const sc = scores(k) || { fard: 0, sunna: null, azkar: lvl === 'start' ? null : 0, zikr: 0, overall: 0 };
    const T = prayerTimes(k), sk = isToday ? skyState() : null;
    const plan = planFor(k);
    const DT = { n: ['Обычный день', 'var(--emerald)'], t: ['В пути', 'var(--blue)'], s: ['Болезнь', 'var(--violet-text)'] };
    const parts = [];
    const p = parseKey(k);
    parts.push('<div class="top"><div class="col"><div class="small sub" style="font-weight:600;font-size:13px">' + WD_FULL[weekday(k)] + ', ' + fmtDate(k) + (isToday ? '' : ' ' + p.y) + ' · ' + hijri(k).y + ' г. х.</div><div class="date-hijri">' + hijriShort(k) + '</div></div>' +
      (lvl === 'ihsan' ? '<button class="daytype" data-a="cycleDay" aria-label="Тип дня: ' + DT[d.t][0] + '. Нажмите, чтобы сменить" style="color:' + DT[d.t][1] + '"><span class="dot" style="background:' + DT[d.t][1] + '"></span>' + DT[d.t][0] + '</button>' : '') + '</div>');
    if (lvl === 'ihsan' && d.t !== 'n') parts.push('<div class="small sub" style="padding:0 4px;line-height:1.45">' + (d.t === 't' ? 'В пути: сунна до Фаджра, витр, азкары, дуа после омовения и садака. Остальная сунна не снижает итог.' : 'Болезнь: учитываются только фард, азкары и зикры. Сунна не снижает итог.') + '</div>');
    if (!isToday) parts.push('<button class="card pad between" data-a="backToday" style="text-align:left;width:100%"><span class="col"><span style="font-weight:800">Вы отмечаете ' + fmtDate(k) + '</span><span class="small sub">Нажмите, чтобы вернуться к сегодняшнему дню</span></span>' + I.chev + '</button>');
    if (isToday) parts.push(vSky());

    const summaryBits = ['Фард ' + fardDoneCount(d) + ' из 5'];
    if (sc.sunna !== null && lvl !== 'start') summaryBits.push('сунна ' + pct(sc.sunna));
    if (lvl !== 'start') summaryBits.push('азкары ' + ((azDone(d, 'morning') ? 1 : 0) + (azDone(d, 'evening') ? 1 : 0)) + ' из 2');
    parts.push('<button class="card summary" data-a="tab" data-v="progress"><span class="ring" style="width:64px;height:64px">' + ring(sc.overall, 64, 26, 6) + '<span class="num" style="font-size:15px">' + pct(sc.overall) + '</span></span><span class="col grow" style="gap:3px"><span style="font-size:16px;font-weight:800">Итог дня</span><span class="small sub" style="font-size:13px;line-height:1.4">' + summaryBits.join(' · ') + '</span></span>' + I.chev + '</button>');

    // намазы
    const detailed = S.set.detailed && lvl !== 'start';
    parts.push('<div class="between" style="padding:8px 4px 0"><h2 class="h2">Намазы</h2>' + (lvl !== 'start' ? '<div class="seg mini" role="group" aria-label="Режим отметки"><button class="' + (detailed ? 'on' : '') + '" data-a="mode" data-v="1" aria-pressed="' + detailed + '">Подробно</button><button class="' + (!detailed ? 'on' : '') + '" data-a="mode" data-v="0" aria-pressed="' + !detailed + '">Просто</button></div>' : '') + '</div>');
    const rows = PRAYERS.map((pr) => {
      const st = d.f[pr.id];
      const now = sk && sk.current === pr.id;
      const label = st ? (pr.id === 'dhuhr' && st === 'juma' ? 'Джума' : LBL[st]) : 'Отметить';
      const name = pr.id === 'dhuhr' && isFriday(k) ? 'Зухр / Джума' : pr.name;
      let right;
      if (detailed) right = '<button class="pill st-' + (st || 'none') + '" data-a="sheet" data-v="status:' + pr.id + '" aria-label="' + name + ': ' + label + '. Изменить">' + label + I.down + '</button>';
      else { const on = !!st && st !== 'missed'; right = '<button class="check' + (on ? ' on' : '') + '" data-a="quick" data-v="' + pr.id + '" aria-pressed="' + on + '" aria-label="' + name + (on ? ': отмечен' : ': отметить') + '">' + I.check + '</button>'; }
      const subs = detailed ? PER_PRAYER[pr.id].filter((x) => plan[x[0]] > 0) : [];
      const subsHtml = subs.length ? '<div class="subs">' + subs.map((x) => { const on = !!d.s[x[0]]; return '<button class="sub-chip' + (on ? ' on' : '') + '" data-a="sunna" data-v="' + x[0] + '" aria-pressed="' + on + '">' + (on ? I.checkSm : '') + x[1] + '</button>'; }).join('') + '</div>' : '';
      return '<div class="pr' + (now ? ' now' : '') + '"><div class="row"><span class="glyph">' + I.g[pr.id] + '</span><span class="col grow"><span class="row" style="gap:8px"><span class="pr-name">' + name + '</span>' + (now ? '<span class="badge">СЕЙЧАС</span>' : '') + '</span><span class="small sub num" style="font-size:13px">' + (T ? fmtTime(T[pr.id]) + ' · ' : '') + pr.rak + '</span></span>' + right + '</div>' + subsHtml + '</div>';
    });
    parts.push('<div class="card list" style="overflow:hidden">' + rows.join('') + '</div>');

    // дополнительная сунна
    if (lvl === 'ihsan') {
      const tg2 = [['duha', 'Духа-намаз', 'После восхода, до Зухра'], ['witr', 'Витр-намаз', 'После Иша, до рассвета'], ['sadaqa', 'Садака', 'Любое доброе пожертвование'], ['kahf', 'Сура аль-Кахф', 'Пятница'], ['ghusl', 'Гусль', 'Пятница']].filter((x) => plan[x[0]] > 0);
      const stp = [['qiyam', 'Киям аль-лейль', 'ракаатов', 2, 20], ['wudu', 'Дуа после омовения', 'раз', 1, 10]].filter((x) => plan[x[0]] > 0);
      if (tg2.length || stp.length) {
        parts.push('<div class="between" style="padding:8px 4px 0"><h2 class="h2">Дополнительно</h2><span class="small sub">сунна ' + pct(sc.sunna) + '</span></div>');
        parts.push('<div class="card list">' +
          tg2.map((x) => { const on = !!d.s[x[0]]; return '<div class="x-row"><span class="col grow"><span style="font-size:15px;font-weight:700">' + x[1] + '</span><span class="small sub">' + x[2] + '</span></span><button class="check' + (on ? ' on' : '') + '" data-a="sunna" data-v="' + x[0] + '" aria-pressed="' + on + '" aria-label="' + x[1] + '">' + I.check + '</button></div>'; }).join('') +
          stp.map((x) => { const v = x[0] === 'qiyam' ? d.q : d.w, goal = plan[x[0]]; return '<div class="x-row"><span class="col grow"><span style="font-size:15px;font-weight:700">' + x[1] + '</span><span class="small num" style="color:' + (v >= goal ? 'var(--emerald-text)' : 'var(--sub)') + '">' + v + ' из ' + goal + ' ' + x[2] + '</span></span><span class="stepper"><button class="step" data-a="step" data-v="' + x[0] + ':-' + x[3] + ':' + x[4] + '" aria-label="' + x[1] + ': убавить">' + I.minus + '</button><span class="num" style="min-width:26px;text-align:center;font-weight:800;font-size:17px">' + v + '</span><button class="step plus" data-a="step" data-v="' + x[0] + ':' + x[3] + ':' + x[4] + '" aria-label="' + x[1] + ': добавить">' + I.plus + '</button></span></div>'; }).join('') +
          '</div>');
      }
    }

    // плитки
    const tile = (act, val, ico, title, sub, extra) => '<button class="tile" data-a="' + act + '" data-v="' + val + '"' + (extra || '') + '>' + ico + '<span class="col"><span class="tile-title">' + title + '</span><span class="small sub">' + sub + '</span></span></button>';
    const zTotal = (d.z || []).reduce((a, b) => a + b, 0);
    const which = defaultAzTab();
    const azList = D.AZKAR[which], azCounts = which === 'morning' ? d.am : d.ae;
    const azDoneN = azList.filter((a, i) => (azCounts[i] || 0) >= a.n).length;
    const nf = nextFasting(today), tf = fastingInfo(k);
    let bento = '<div class="bento" style="padding-top:4px">' +
      tile('tab', 'more', '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" stroke="var(--line2)" stroke-width="1.5"/><path d="M20 6l4 14-4 14-4-14z" fill="var(--gold)"/><path d="M20 20h4l-4 14-4-14z" fill="var(--sub)" opacity=".5"/><rect x="17" y="1" width="6" height="6" rx="1" fill="var(--text)"/></svg>', 'Кибла', S.set.lat != null ? Math.round(qiblaBearing()) + '° от севера' : 'Найти направление') +
      tile('zikr', 'tasbih', '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="18" r="13" stroke="var(--gold)" stroke-width="5" stroke-dasharray="0.1 6.7" stroke-linecap="round"/><path d="M20 31v7" stroke="var(--gold)" stroke-width="2" stroke-linecap="round"/></svg>', 'Тасбих', zTotal + ' ' + plural(zTotal, 'зикр', 'зикра', 'зикров') + ' за день');
    if (lvl !== 'start') bento += '<button class="tile wide" data-a="zikr" data-v="azkar"><span class="arch-ico">' + I.moon + '</span><span class="col grow" style="gap:6px"><span class="between" style="align-items:baseline"><span class="tile-title">' + (which === 'morning' ? 'Утренние' : 'Вечерние') + ' азкары</span><span class="small sub num">' + azDoneN + ' из ' + azList.length + '</span></span><span class="small sub">' + (which === 'morning' ? 'Читаются после Фаджра' : 'Читаются после Асра, до Магриба') + '</span><span class="bar"><span style="width:' + Math.round(azDoneN / azList.length * 100) + '%"></span></span></span></button>';
    const ql = S.set.qlast;
    bento += tile('tab', 'quran', '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 11c-3.3-2.5-8.3-3.3-13.3-2.5v21.7c5-.8 10 0 13.3 2.5 3.3-2.5 8.3-3.3 13.3-2.5V8.5c-5-.8-10 0-13.3 2.5z" stroke="var(--gold)" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 11v21.7" stroke="var(--gold)" stroke-width="1.8"/></svg>', 'Коран', ql ? 'Продолжить: ' + D.SURAH_RU[ql.s - 1] : (isFriday(today) ? 'Пятница — сура аль-Кахф' : 'Начать чтение'));
    if (lvl === 'ihsan') {
      const fastLabel = { fast: 'Постился', qada: 'Каза поста', missed: 'Пропущен' }[d.p];
      if (tf || d.p) bento += '<button class="tile" data-a="sheet" data-v="fast"><span class="tag' + (tf && tf.kind === 'forbidden' ? '' : ' gold') + '">ПОСТ</span><span class="col"><span class="tile-title">' + (fastLabel || (tf ? tf.text : 'Отметить пост')) + '</span><span class="small sub">' + (fastLabel ? 'Нажмите, чтобы изменить' : (tf && tf.kind !== 'forbidden' ? 'Отметьте, если постились' : '')) + '</span></span></button>';
      else bento += '<button class="tile" data-a="sheet" data-v="fast"><span class="tag">ПОСТ</span><span class="col"><span class="tile-title">' + (nf ? WD_SHORT[weekday(nf.key)] + ', ' + fmtDate(nf.key) : 'Пост') + '</span><span class="small sub">' + (nf ? nf.info.text + ' · желательный' : 'Отметить пост') + '</span></span></button>';
    } else {
      bento += tile('zikr', 'dua', '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="var(--gold)" stroke-width="1.3" aria-hidden="true"><rect x="10" y="10" width="20" height="20"/><rect x="10" y="10" width="20" height="20" transform="rotate(45 20 20)"/></svg>', 'Дуа', 'На каждый случай');
    }
    bento += '</div>';
    parts.push(bento);

    if (lvl === 'ihsan') {
      const debt = qadaDebt();
      parts.push('<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="between"><span class="col"><span style="font-size:16px;font-weight:800">Каза-долг</span><span class="small sub" style="font-size:13px">Пропущенные фард-намазы</span></span><span class="num" style="font-family:var(--serif);font-size:36px;font-weight:700;color:' + (debt ? 'var(--amber-text)' : 'var(--emerald-text)') + '">' + debt + '</span></div>' +
        '<div class="small sub" style="font-size:13.5px;line-height:1.5">' + (debt ? 'Совершили намаз-каза? Отметьте — долг уменьшится. Пропуски за прошлые годы можно указать в настройках.' : 'Долга нет, альхамдулиллях. Если есть пропуски за прошлые годы, укажите их — приложение будет вести учёт.') + '</div>' +
        '<div class="row" style="gap:8px">' + (debt ? '<button class="btn gold sm grow" data-a="qadaDone">Восполнил 1 намаз</button>' : '') + '<button class="btn ghost sm grow" data-a="sheet" data-v="qada">Долг за прошлые годы</button></div></div>');
    }
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
      out.push('<div class="z-grid">' + D.ZIKRS.map((x, i) => { const n = d.z[i] || 0; return '<button class="z-cell" data-a="zSel" data-v="' + i + '"><span style="font-size:12.5px;font-weight:700;line-height:1.3;min-height:32px">' + x.short + '</span><span class="num" style="font-size:13px"><b id="zc' + i + '" style="color:' + (n >= 100 ? 'var(--emerald-text)' : 'var(--red-text)') + '">' + n + '</b><span class="sub"> / 100</span></span><span class="bar"><span id="zb' + i + '" style="width:' + Math.min(n, 100) + '%;background:' + (n >= 100 ? 'var(--emerald)' : 'var(--gold)') + '"></span></span></button>'; }).join('') + '</div>');
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

  function vQuran() {
    const Q = S.quran;
    if (Q.reader) return vReader();
    const out = ['<h1 class="h1">Коран</h1>'];
    const ql = S.set.qlast || { s: 18, a: 1 };
    out.push('<button class="continue" data-a="read" data-v="' + ql.s + ':' + ql.a + '"><span class="continue-arch"><span style="font-family:var(--serif);font-size:30px;font-weight:700;color:var(--gold-hi);line-height:1">' + ql.s + '</span><span class="small" style="font-weight:800;color:var(--gold-hi);letter-spacing:.06em">СУРА</span></span><span class="col grow" style="gap:8px"><span class="eyebrow" style="padding:0">' + (S.set.qlast ? 'Продолжить' : 'Начать с') + '</span><span style="font-family:var(--serif);font-size:26px;font-weight:600;line-height:1.05">' + D.SURAH_RU[ql.s - 1] + '</span><span class="between"><span class="small sub num">аят ' + ql.a + ' из ' + D.SURAH_AYAHS[ql.s - 1] + '</span><span class="btn gold sm" style="min-height:36px">Читать</span></span></span></button>');
    out.push('<div class="eyebrow">Читают чаще всего</div><div class="chips">' + D.POPULAR.map((n) => '<button class="chip" data-a="read" data-v="' + n + ':1">' + D.SURAH_RU[n - 1] + '</button>').join('') + '</div>');
    out.push('<div class="seg" role="group" aria-label="Список">' + [['surahs', 'Суры'], ['juz', 'Джузы'], ['marks', 'Закладки']].map((v) => '<button class="' + (Q.view === v[0] ? 'on' : '') + '" data-a="qView" data-v="' + v[0] + '">' + v[1] + '</button>').join('') + '</div>');
    if (Q.view === 'surahs') {
      out.push('<label class="search">' + I.search + '<span class="sr">Поиск суры</span><input type="search" data-in="surah" placeholder="Название или номер суры" value="' + esc(Q.filter || '') + '"></label>');
      const f = (Q.filter || '').trim().toLowerCase();
      const items = D.SURAH_RU.map((n, i) => ({ n: i + 1, ru: n })).filter((x) => !f || String(x.n) === f || x.ru.toLowerCase().indexOf(f) >= 0);
      out.push('<div class="card list" style="overflow:hidden">' + items.map((x) => '<button class="list-row" data-a="read" data-v="' + x.n + ':1"><span class="star">' + I.star8 + '<span style="position:relative">' + x.n + '</span></span><span class="col grow"><span style="font-size:15px;font-weight:800">' + x.ru + '</span><span class="small sub">' + D.SURAH_AYAHS[x.n - 1] + ' ' + plural(D.SURAH_AYAHS[x.n - 1], 'аят', 'аята', 'аятов') + '</span></span>' + (Q.meta && Q.meta[x.n - 1] ? '<span class="ar" lang="ar" style="font-size:19px;color:var(--gold-hi)">' + esc(Q.meta[x.n - 1]) + '</span>' : '') + '</button>').join('') + (items.length ? '' : '<div class="loading">Ничего не найдено</div>') + '</div>');
    } else if (Q.view === 'juz') {
      out.push('<div class="card list" style="overflow:hidden">' + D.JUZ_START.map((j, i) => '<button class="list-row" data-a="read" data-v="' + j[0] + ':' + j[1] + '"><span style="width:40px;height:40px;flex:none;border-radius:20px 20px 8px 8px;background:var(--gold-soft);color:var(--gold-hi);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">' + (i + 1) + '</span><span class="col grow"><span style="font-size:15px;font-weight:800">Джуз ' + (i + 1) + '</span><span class="small sub">с суры ' + D.SURAH_RU[j[0] - 1] + ', аят ' + j[1] + '</span></span>' + I.chev + '</button>').join('') + '</div>');
    } else {
      const marks = S.set.qmarks || [];
      if (!marks.length) out.push('<div class="card empty"><span style="color:var(--gold)">' + I.bookmark + '</span><span style="font-size:15px;font-weight:800">Закладок пока нет</span><span class="small sub" style="font-size:13px;line-height:1.5">При чтении нажмите на значок закладки у аята. Закладки сохраняются в облаке Telegram.</span></div>');
      else out.push('<div class="card list" style="overflow:hidden">' + marks.map((m) => { const s = +m.split(':')[0], a = +m.split(':')[1]; return '<button class="list-row" data-a="read" data-v="' + s + ':' + a + '"><span style="color:var(--gold)">' + I.bookmarkOn + '</span><span class="col grow"><span style="font-size:15px;font-weight:800">' + D.SURAH_RU[s - 1] + '</span><span class="small sub">аят ' + a + '</span></span>' + I.chev + '</button>'; }).join('') + '</div>');
    }
    return out.join('');
  }
  function vReader() {
    const R = S.quran.reader, s = R.s;
    const out = ['<div class="row" style="gap:8px"><button class="icon-btn" data-a="closeReader" aria-label="Назад">' + I.back + '</button><span class="col grow"><span style="font-family:var(--serif);font-size:26px;font-weight:600;line-height:1.05">' + D.SURAH_RU[s - 1] + '</span><span class="small sub">Сура ' + s + ' · ' + D.SURAH_AYAHS[s - 1] + ' ' + plural(D.SURAH_AYAHS[s - 1], 'аят', 'аята', 'аятов') + ' · перевод Кулиева</span></span></div>'];
    if (R.loading) out.push('<div class="card loading">Загружаю суру…</div>');
    else if (R.error) out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span style="font-weight:800">Не удалось загрузить текст</span><span class="small sub">' + esc(R.error) + '</span><button class="btn gold sm" data-a="read" data-v="' + s + ':' + R.a + '">Попробовать снова</button></div>');
    else {
      if (s !== 1 && s !== 9) out.push('<div class="ar" lang="ar" style="text-align:center;font-size:26px;color:var(--gold-hi);padding:6px 0">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>');
      const marks = S.set.qmarks || [];
      R.ayahs.forEach((ay) => {
        const mk = s + ':' + ay.n, on = marks.indexOf(mk) >= 0;
        out.push('<div class="card ayah" id="ay' + ay.n + '"><div class="between"><span class="ayah-n num">' + ay.n + '</span><button class="icon-btn" style="border:0;background:none;color:' + (on ? 'var(--gold)' : 'var(--sub)') + '" data-a="mark" data-v="' + mk + '" aria-label="' + (on ? 'Убрать закладку' : 'Добавить закладку') + '" aria-pressed="' + on + '">' + (on ? I.bookmarkOn : I.bookmark) + '</button></div><p class="ayah-ar" lang="ar">' + esc(ay.ar) + '</p><p class="zk-ru">' + esc(ay.ru) + '</p></div>');
      });
      const nav = [];
      if (s > 1) nav.push('<button class="btn ghost sm grow" data-a="read" data-v="' + (s - 1) + ':1">← ' + D.SURAH_RU[s - 2] + '</button>');
      if (s < 114) nav.push('<button class="btn gold sm grow" data-a="read" data-v="' + (s + 1) + ':1">' + D.SURAH_RU[s] + ' →</button>');
      out.push('<div class="row" style="gap:8px">' + nav.join('') + '</div>');
    }
    return out.join('');
  }

  function weekKeys() { const t = todayKey(); const wd = (weekday(t) + 6) % 7; const mon = addDays(t, -wd); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i)); }
  function monthKeys() { const p = parseKey(todayKey()); const n = new Date(p.y, p.m, 0).getDate(); const out = []; for (let d = 1; d <= n; d++) out.push(keyOf(p.y, p.m, d)); return out; }
  function vProgress() {
    const P = S.prog, isWeek = P.period === 'week', today = todayKey();
    const keys = isWeek ? weekKeys() : monthKeys();
    const past = keys.filter((k) => k <= today);
    const sc = past.map((k) => scores(k)).filter(Boolean);
    const avg = (f) => { const v = sc.map(f).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const out = ['<h1 class="h1">Прогресс</h1>',
      '<div class="seg" role="group" aria-label="Период"><button class="' + (isWeek ? 'on' : '') + '" data-a="period" data-v="week">Неделя</button><button class="' + (!isWeek ? 'on' : '') + '" data-a="period" data-v="month">Месяц</button></div>'];
    const selKey = isWeek ? (P.bar != null ? keys[P.bar] : today) : (P.day || today);
    const selSc = scores(selKey);
    const k0 = parseKey(keys[0]), k6 = parseKey(keys[6]);
    const range = isWeek ? (k0.m === k6.m ? k0.d + '–' + k6.d + ' ' + MONTHS_GEN[k0.m - 1] : fmtDate(keys[0]) + ' — ' + fmtDate(keys[6])) : MONTHS_NOM[parseKey(today).m - 1];
    let chart = '';
    if (isWeek) {
      chart = '<div style="display:flex;flex-direction:column;gap:8px"><div class="bars">' + keys.map((k, i) => { const s = scores(k), v = s ? Math.min(s.overall, 1) : 0, on = k === selKey; return '<button class="' + (on ? 'on' : '') + '" data-a="bar" data-v="' + i + '" aria-label="' + WD_SHORT[weekday(k)] + ', ' + fmtDate(k) + ': ' + (k > today ? 'ещё впереди' : pct(s ? s.overall : null)) + '"><span class="trk"><span class="fill" style="height:' + Math.round(v * 100) + '%"></span></span></button>'; }).join('') + '</div><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px">' + keys.map((k) => '<span style="text-align:center;font-size:12px;font-weight:' + (k === selKey ? 800 : 600) + ';color:' + (k === selKey ? 'var(--text)' : 'var(--sub)') + '">' + WD_SHORT[weekday(k)] + '</span>').join('') + '</div></div>';
    } else {
      const lead = (weekday(keys[0]) + 6) % 7;
      let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => '<span style="text-align:center;font-size:11px;font-weight:700;color:var(--sub)">' + w + '</span>').join('');
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      keys.forEach((k) => { const s = scores(k), v = s ? s.overall : null; const cls = v === null ? 'h0' : v >= 0.9 ? 'h4c' : v >= 0.75 ? 'h3c' : v >= 0.6 ? 'h2c' : 'h1c'; cells += '<button class="' + cls + (k === selKey ? ' on' : '') + ' num" data-a="calDay" data-v="' + k + '" aria-label="' + fmtDate(k) + ': ' + (k > today ? 'ещё впереди' : pct(v)) + '" style="' + (k === today ? 'font-weight:800' : '') + '">' + parseKey(k).d + '</button>'; });
      chart = '<div style="display:flex;flex-direction:column;gap:10px"><div class="cal">' + cells + '</div><div class="row" style="flex-wrap:wrap;gap:6px 14px">' + [['h1c', 'ниже 60%'], ['h2c', '60–74%'], ['h3c', '75–89%'], ['h4c', '90%+']].map((l) => '<span class="row small sub" style="gap:6px"><span class="' + l[0] + '" style="width:12px;height:12px;border-radius:4px;display:block"></span>' + l[1] + '</span>').join('') + '</div></div>';
    }
    const canOpen = selKey <= today;
    out.push('<div class="card" style="padding:18px 16px 16px;display:flex;flex-direction:column;gap:18px"><div class="between" style="align-items:flex-end"><span class="col" style="gap:4px"><span class="small sub" style="font-weight:700">Средний итог · ' + range + '</span><span class="big-serif num" style="font-size:60px">' + pct(avg((x) => x.overall)) + '</span></span><span class="col" style="align-items:flex-end;gap:6px"><span style="font-size:13px;font-weight:800">' + WD_SHORT[weekday(selKey)] + ', ' + fmtDate(selKey) + ' · ' + (selKey > today ? 'впереди' : pct(selSc ? selSc.overall : null)) + '</span>' + (canOpen && selKey !== today ? '<button class="btn ghost sm" data-a="openDay" data-v="' + selKey + '" style="min-height:34px">Открыть день</button>' : '') + '</span></div>' + chart + '</div>');
    if (!sc.length) out.push('<div class="card empty"><span style="font-size:15px;font-weight:800">Пока нет отметок за этот период</span><span class="small sub" style="font-size:13px;line-height:1.5">Отмечайте намазы на главной — здесь появятся итоги, серии и статистика.</span></div>');
    const lvl = S.set.level;
    const cats = [['Фард-намазы', avg((x) => x.fard)]];
    if (lvl !== 'start') cats.push(['Сунна и прочее', avg((x) => x.sunna)], ['Азкары', avg((x) => x.azkar)], ['Зикры', avg((x) => x.zikr)]);
    out.push('<div class="card list">' + cats.map((c) => '<div style="display:flex;flex-direction:column;gap:8px;padding:13px 16px"><div class="between"><span style="font-size:14px;font-weight:700">' + c[0] + '</span><span class="num" style="font-size:14px;font-weight:800">' + pct(c[1]) + '</span></div><span class="bar" style="height:6px"><span style="width:' + Math.round(Math.min(c[1] || 0, 1) * 100) + '%"></span></span></div>').join('') + '</div>');
    const cnt = { mosque: 0, jamaat: 0, done: 0, qada: 0, missed: 0 };
    past.forEach((k) => { const d = S.days[k]; if (!d) return; PRAYERS.forEach((p) => { let st = d.f[p.id]; if (st === 'juma') st = 'mosque'; if (st && cnt[st] !== undefined) cnt[st]++; }); });
    const tot = Object.keys(cnt).reduce((a, x) => a + cnt[x], 0);
    out.push('<h2 class="h2" style="padding:0 4px">Фард-намазы</h2><div class="tiles3">' + [['mosque', 'В мечети', 'var(--gold)'], ['jamaat', 'Джамаатом', 'var(--blue)'], ['done', 'Сделал', 'var(--emerald)'], ['qada', 'Каза', 'var(--amber)'], ['missed', 'Пропущено', 'var(--red)']].map((x) => '<div class="stat"><b class="num">' + cnt[x[0]] + '</b><span class="row small sub" style="gap:6px;font-weight:700"><span class="dot" style="background:' + x[2] + '"></span>' + x[1] + '</span></div>').join('') +
      '<div class="stat" style="background:var(--gold-soft);border-color:var(--gold-line)"><b class="num" style="color:var(--gold-hi)">' + (tot ? Math.round((cnt.mosque + cnt.jamaat) / tot * 100) + '%' : '—') + '</b><span class="small" style="font-weight:700;color:var(--gold-hi)">джамаатом</span></div></div>');
    const st = [[streak((d) => PRAYERS.every((p) => ON_TIME[d.f[p.id]])), 'Все фарды в своё время']];
    if (lvl !== 'start') st.push([streak((d) => azDone(d, 'morning')), 'Утренние азкары'], [streak((d) => D.ZIKRS.every((z, i) => (d.z[i] || 0) >= 100)), 'Все зикры по 100']);
    st.push([streak((d) => PRAYERS.some((p) => d.f[p.id] === 'mosque' || d.f[p.id] === 'juma')), 'Хотя бы один намаз в мечети']);
    out.push('<h2 class="h2" style="padding:0 4px">Серии</h2><div class="card list">' + st.map((s) => '<div class="x-row"><span class="num" style="width:36px;height:36px;flex:none;border-radius:18px 18px 8px 8px;background:var(--gold-soft);color:var(--gold-hi);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">' + s[0] + '</span><span class="grow" style="font-size:14px;font-weight:600">' + s[1] + '</span><span class="small sub">' + plural(s[0], 'день', 'дня', 'дней') + ' подряд</span></div>').join('') + '</div>');
    if (lvl === 'ihsan') {
      let qadaMade = 0, fasts = 0;
      past.forEach((k) => { const d = S.days[k]; if (!d) return; PRAYERS.forEach((p) => { if (d.f[p.id] === 'qada') qadaMade++; }); if (d.p === 'fast' || d.p === 'qada') fasts++; });
      out.push('<div class="bento"><div class="card pad" style="display:flex;flex-direction:column;gap:6px"><span class="small sub" style="font-weight:700">Каза-долг</span><span class="num" style="font-family:var(--serif);font-size:32px;font-weight:700;line-height:1;color:' + (qadaDebt() ? 'var(--amber-text)' : 'var(--emerald-text)') + '">' + qadaDebt() + '</span><span class="small sub">Восполнено за период: ' + qadaMade + '</span></div><div class="card pad" style="display:flex;flex-direction:column;gap:6px"><span class="small sub" style="font-weight:700">Посты за период</span><span class="num" style="font-family:var(--serif);font-size:32px;font-weight:700;line-height:1">' + fasts + '</span><span class="small sub">Долг по постам: ' + fastDebt() + ' ' + plural(fastDebt(), 'день', 'дня', 'дней') + '</span></div></div>');
    }
    return out.join('');
  }

  function vMore() {
    const out = ['<h1 class="h1">Ещё</h1>'];
    const qb = S.set.lat != null ? qiblaBearing() : null;
    if (qb != null) {
      out.push('<div class="qibla"><div style="position:absolute;left:0;right:0;top:30px;text-align:center;color:#C9CEDA" class="eyebrow">Кибла · <span class="num">' + Math.round(qb) + '°</span> от севера</div>' +
        '<svg class="compass" viewBox="0 0 230 230" aria-hidden="true" style="font-family:var(--sans)"><g id="dial"><circle cx="115" cy="115" r="104" fill="none" stroke="rgba(255,255,255,.12)"/><circle cx="115" cy="115" r="86" fill="none" stroke="rgba(230,190,110,.25)" stroke-dasharray="1 7"/>' +
        '<g stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-linecap="round"><path d="M115 14v10M115 206v10M14 115h10M206 115h10M43.6 43.6l5.6 5.6M180.8 180.8l5.6 5.6M43.6 186.4l5.6-5.6M180.8 49.2l5.6-5.6"/></g>' +
        '<text x="115" y="44" fill="#F4EFE6" font-size="12" font-weight="800" text-anchor="middle">С</text><text x="188" y="119" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">В</text><text x="115" y="194" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">Ю</text><text x="42" y="119" fill="#A7AEC0" font-size="11" font-weight="700" text-anchor="middle">З</text>' +
        '<g class="needle" id="needle" style="transform:rotate(' + qb.toFixed(1) + 'deg)"><path d="M115 40l9 75h-18z" fill="#E6BE6E"/><path d="M115 190l9-75h-18z" fill="rgba(255,255,255,.18)"/><rect x="106" y="2" width="18" height="18" rx="2" fill="#0A0F1C" stroke="#E6BE6E" stroke-width="1.5"/><path d="M106 8h18" stroke="#E6BE6E" stroke-width="1.5"/></g></g>' +
        '<circle cx="115" cy="115" r="7" fill="#0A0F1C" stroke="#E6BE6E" stroke-width="2"/></svg>' +
        '<div style="position:absolute;left:0;right:0;bottom:16px;text-align:center;padding:0 20px;display:flex;flex-direction:column;gap:8px;align-items:center"><span id="qiblaHint" style="font-size:14.5px;font-weight:800">' + (S.compassOn ? 'Поворачивайте телефон, держа его ровно' : 'Компас показывает направление от севера') + '</span>' + (S.compassOn ? '' : '<button class="btn gold sm" data-a="compass">Включить компас</button>') + '</div></div>');
    } else out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span style="font-size:16px;font-weight:800">Кибла</span><span class="small sub">Укажите город или разрешите геолокацию, чтобы найти направление на Каабу.</span><button class="btn gold sm" data-a="locate">Определить автоматически</button></div>');

    // календарь хиджры
    const t = todayKey(), events = [], seen = {};
    for (let i = 0; i < 400 && events.length < 4; i++) {
      const k = addDays(t, i), h = hijri(k);
      const ev = h.d === 1 && h.m === 9 ? ['Начало Рамадана', 'Обязательный пост весь месяц'] : h.d === 1 && h.m === 10 ? ['Ид аль-Фитр', 'Праздник разговения, пост запрещён'] : h.d === 9 && h.m === 12 ? ['День Арафа', 'Желательный пост'] : h.d === 10 && h.m === 12 ? ['Ид аль-Адха', 'Праздник жертвоприношения'] : h.d === 1 && h.m === 1 ? ['Новый год по хиджре', D.HIJRI_MONTHS_NOM[0] + ' ' + h.y] : h.d === 1 && h.m === 7 ? ['Начало Раджаба', 'Один из запретных месяцев'] : h.d === 10 && h.m === 1 ? ['Ашура', 'Желательный пост'] : null;
      if (ev && !seen[ev[0]]) { seen[ev[0]] = 1; events.push([k, ev]); }
    }
    out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="between" style="align-items:baseline"><span style="font-size:16px;font-weight:800">Календарь хиджры</span><span class="small sub">даты примерные</span></div><div class="small sub" style="font-size:13px">Сегодня ' + hijriText(t) + '</div>' +
      events.map((e) => { const p = parseKey(e[0]); return '<div class="row"><span style="width:54px;flex:none;padding:8px 0;border-radius:27px 27px 10px 10px;background:var(--gold-soft);border:1px solid var(--gold-line);display:flex;flex-direction:column;align-items:center"><span class="num" style="font-family:var(--serif);font-size:22px;font-weight:700;line-height:1;color:var(--gold-hi)">' + p.d + '</span><span style="font-size:10.5px;font-weight:800;color:var(--gold-hi)">' + MONTHS_GEN[p.m - 1].slice(0, 3).toUpperCase() + '</span></span><span class="col grow"><span style="font-size:14.5px;font-weight:800">' + e[1][0] + '</span><span class="small sub">' + e[1][1] + (p.y !== parseKey(t).y ? ' · ' + p.y : '') + '</span></span></div>'; }).join('') + '</div>');

    // настройки
    const m = METHODS.find((x) => x[0] === S.set.method);
    const lvlName = { start: 'Начало', effort: 'Усердие', ihsan: 'Ихсан' }[S.set.level] || '—';
    const rows = [
      ['city', 'Город', S.set.city || (S.set.lat != null ? 'Моё местоположение' : 'Не выбран')],
      ['method', 'Метод расчёта', m ? m[1] : ''],
      ['madhab', 'Время Асра', S.set.madhab === 'Hanafi' ? 'Ханафитское' : 'Стандартное'],
      ['level', 'Мой уровень', lvlName],
      ['hijri', 'Дата хиджры', S.set.hijriAdj ? (S.set.hijriAdj > 0 ? '+' : '') + S.set.hijriAdj + ' дн.' : 'Без сдвига'],
      ['theme', 'Тема', { auto: 'Как в Telegram', dark: 'Тёмная', light: 'Светлая' }[S.set.theme]],
      ['qada', 'Долг за прошлые годы', (S.set.qadaBase || 0) + ' нам. · ' + (S.set.fastBase || 0) + ' пост.']
    ];
    out.push('<div class="eyebrow">Настройки</div><div class="card list" style="overflow:hidden">' + rows.map((r) => '<button class="list-row" data-a="sheet" data-v="' + r[0] + '" style="min-height:54px"><span class="grow" style="font-size:14.5px;font-weight:600">' + r[1] + '</span><span class="small sub" style="font-size:13.5px;text-align:right">' + esc(r[2]) + '</span>' + I.chev + '</button>').join('') + '</div>');
    out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><span style="font-size:15px;font-weight:800">Напоминания в чате бота</span><span class="small sub" style="font-size:13px;line-height:1.5">Скоро: сообщение перед намазом, напоминание, если намаз не отмечен, азкары, желательные посты и итог дня — с кнопками ответа прямо в чате.</span></div>');
    out.push('<div class="card pad" style="display:flex;flex-direction:column;gap:12px;background:linear-gradient(160deg,var(--gold-soft),transparent);border-color:var(--gold-line)"><span style="font-family:var(--serif);font-size:24px;font-weight:600;line-height:1.1">Садака джария</span><span class="small" style="font-size:13.5px;line-height:1.5">Приложение бесплатное и без рекламы. Поделитесь им с близкими — награда за каждого, кто будет пользоваться.</span>' + (SHARE_LINK ? '<button class="btn gold block" data-a="share">Поделиться</button>' : '') + '</div>');
    out.push('<div class="small sub" style="text-align:center;padding:4px">Ибада · версия 1 · данные хранятся в ' + (store.cloud ? 'облаке Telegram' : 'этом браузере') + '</div>');
    return out.join('');
  }

  /* ===== шторки ===== */
  function vSheet() {
    const sh = S.sheet; if (!sh) return '';
    let body = '';
    const head = (title, sub) => '<div class="grab"></div><div class="col" style="padding:6px 6px 4px"><div style="font-family:var(--serif);font-size:28px;font-weight:600;line-height:1.1">' + title + '</div>' + (sub ? '<div class="small sub" style="font-size:13px">' + sub + '</div>' : '') + '</div>';
    const opt = (act, val, on, title, desc, badge, badgeCls) => '<button class="opt' + (on ? ' on' : '') + '" data-a="' + act + '" data-v="' + val + '">' + (badge ? '<span class="opt-pct ' + (badgeCls || '') + '">' + badge + '</span>' : '') + '<span class="col grow"><span style="font-size:15.5px;font-weight:800">' + title + '</span>' + (desc ? '<span class="small sub">' + desc + '</span>' : '') + '</span>' + (on ? '<span style="color:var(--gold)">' + I.check + '</span>' : '') + '</button>';
    if (sh.type === 'status') {
      const k = viewKey(), pr = PRAYERS.find((p) => p.id === sh.id), cur = getDay(k).f[sh.id], T = prayerTimes(k);
      const opts = [['mosque', 'В мечети', 'Джамаатом в мечети — высшая награда', '150%'], ['jamaat', 'Джамаатом', 'Коллективно, вне мечети', '120%']];
      if (sh.id === 'dhuhr' && isFriday(k)) opts.unshift(['juma', 'Джума', 'Пятничный намаз в мечети', '150%']);
      opts.push(['done', 'Сделал', 'Один, в своё время', '100%'], ['qada', 'Восполнил (каза)', 'После окончания времени', '50%'], ['missed', 'Пропустил', 'Попадёт в каза-долг', '0%']);
      body = head(pr.name, (T ? fmtTime(T[sh.id]) + ' · ' : '') + pr.rak + ' · как вы совершили?') + opts.map((o) => opt('setStatus', sh.id + ':' + o[0], cur === o[0], o[1], o[2], o[3], 'st-' + o[0])).join('') + (cur ? '<button class="btn block" data-a="setStatus" data-v="' + sh.id + ':" style="background:none;color:var(--sub);font-size:14px">Снять отметку</button>' : '');
    } else if (sh.type === 'city') {
      const C = S.city;
      body = head('Город', 'Для расчёта времени намазов и киблы') +
        '<button class="btn gold block" data-a="locate">' + I.pin + 'Определить автоматически</button>' +
        '<label class="search">' + I.search + '<span class="sr">Поиск города</span><input type="search" data-in="city" placeholder="Например, Казань" value="' + esc(C.q) + '" autocomplete="off"></label>' +
        (C.loading ? '<div class="loading">Ищу…</div>' : '') + (C.error ? '<div class="small" style="color:var(--red-text);padding:4px 6px">' + esc(C.error) + '</div>' : '') +
        C.results.map((r, i) => '<button class="opt" data-a="pickCity" data-v="' + i + '"><span class="col grow"><span style="font-size:15px;font-weight:800">' + esc(r.name) + '</span><span class="small sub">' + esc([r.admin1, r.country].filter(Boolean).join(', ')) + '</span></span></button>').join('');
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
    } else if (sh.type === 'fast') {
      const k = viewKey(), cur = getDay(k).p, fi = fastingInfo(k);
      body = head('Пост · ' + fmtDate(k), fi ? fi.text : 'Обычный день') + [['fast', 'Постился', 'Добровольный или обязательный пост'], ['qada', 'Каза поста', 'Восполнил пропущенный день Рамадана'], ['missed', 'Пропустил', 'Пропущенный день Рамадана — станет долгом']].map((o) => opt('setFast', o[0], cur === o[0], o[1], o[2])).join('') + (cur ? '<button class="btn block" data-a="setFast" data-v="" style="background:none;color:var(--sub);font-size:14px">Снять отметку</button>' : '');
    }
    return '<button class="scrim" data-a="closeSheet" aria-label="Закрыть"></button><div class="sheet" role="dialog" aria-modal="true">' + body + '</div>';
  }

  /* ===== отрисовка ===== */
  function applyTheme() {
    const scheme = S.set.theme === 'auto' ? (tg && tg.colorScheme ? tg.colorScheme : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) : S.set.theme;
    document.documentElement.classList.toggle('light', scheme === 'light');
    const bg = scheme === 'light' ? '#F5F0E6' : '#0A0F1C';
    try { if (tg && ver('6.1')) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } if (tg && ver('7.10')) tg.setBottomBarColor(bg); } catch (e) {}
  }
  function render() {
    applyTheme();
    const onb = !S.set.level;
    const reader = S.tab === 'quran' && S.quran.reader;
    const screen = $('#screen');
    screen.className = 'screen' + (onb || reader ? ' no-tabs' : '');
    screen.innerHTML = !S.loaded ? '<div class="loading" style="margin-top:40vh">Загрузка…</div>' : onb ? vOnboarding() : S.tab === 'home' ? vHome() : S.tab === 'zikr' ? vZikr() : S.tab === 'quran' ? vQuran() : S.tab === 'progress' ? vProgress() : vMore();
    const tabs = [['home', 'Главная'], ['quran', 'Коран'], ['zikr', 'Зикр'], ['progress', 'Прогресс'], ['more', 'Ещё']];
    $('#tabbar').innerHTML = onb || reader || !S.loaded ? '' : '<nav aria-label="Разделы">' + tabs.map((t) => '<button data-a="tab" data-v="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + I.tab[t[0]] + '<span>' + t[1] + '</span></button>').join('') + '</nav>';
    $('#overlay').innerHTML = vSheet() + (S.toast ? '<div class="toast" role="status">' + esc(S.toast) + '</div>' : '');
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
  function startCompass() {
    const qb = qiblaBearing(); if (qb == null) return;
    S.compassOn = true; render();
    const update = (heading) => {
      if (heading == null || isNaN(heading)) return;
      S.heading = heading;
      const rot = ((qb - heading) % 360 + 360) % 360;
      const dial = document.getElementById('dial');
      if (dial) dial.style.transform = 'rotate(' + (-heading).toFixed(1) + 'deg)';
      if (dial) dial.style.transformOrigin = '115px 115px';
      const nd = document.getElementById('needle'); if (nd) nd.style.transform = 'rotate(' + qb.toFixed(1) + 'deg)';
      const aligned = rot < 5 || rot > 355;
      const hint = document.getElementById('qiblaHint');
      if (hint) hint.textContent = aligned ? 'Вы смотрите на Каабу' : 'Поворачивайте телефон, держа его ровно';
      if (aligned && !S.qiblaAligned) haptic('notify', 'success');
      S.qiblaAligned = aligned;
    };
    if (tg && ver('8.0') && tg.DeviceOrientation) {
      tg.onEvent('deviceOrientationChanged', () => { const a = tg.DeviceOrientation.alpha; if (a != null) update((360 - (a * 180 / Math.PI)) % 360); });
      tg.DeviceOrientation.start({ refresh_rate: 60, need_absolute: true }, (ok) => { if (!ok) browserCompass(update); });
    } else browserCompass(update);
  }
  function browserCompass(update) {
    const handler = (e) => { if (e.webkitCompassHeading != null) update(e.webkitCompassHeading); else if (e.absolute && e.alpha != null) update((360 - e.alpha) % 360); };
    const attach = () => { window.addEventListener('deviceorientationabsolute', handler); window.addEventListener('deviceorientation', handler); };
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') attach(); else toast('Нет доступа к компасу'); }).catch(() => toast('Компас недоступен'));
    else if (window.DeviceOrientationEvent) attach();
    else toast('Компас недоступен на этом устройстве');
  }

  /* ===== Коран ===== */
  const surahCache = {};
  async function openSurah(s, a) {
    S.quran.reader = { s, a: a || 1, loading: true, error: '', ayahs: [] };
    S.set.qlast = { s, a: a || 1 }; saveSettings();
    render(); $('#scroll').scrollTop = 0;
    try {
      let ayahs = surahCache[s];
      if (!ayahs) { try { const c = localStorage.getItem('ibada:q' + s); if (c) ayahs = JSON.parse(c); } catch (e) {} }
      if (!ayahs) {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(QURAN_API + '/surah/' + s + '/editions/quran-uthmani,ru.kuliev', { signal: ctrl.signal });
        clearTimeout(to);
        const j = await r.json();
        if (!j || !j.data || !j.data[0]) throw new Error('bad');
        const ar = j.data[0].ayahs, ru = j.data[1].ayahs;
        ayahs = ar.map((x, i) => {
          let t = x.text;
          if (s !== 1 && s !== 9 && i === 0) t = t.replace(/^﻿?\s*بِسْمِ\s+\S+\s+\S+\s+\S+\s*/, '');
          return { n: x.numberInSurah, ar: t, ru: ru[i] ? ru[i].text : '' };
        });
        try { localStorage.setItem('ibada:q' + s, JSON.stringify(ayahs)); } catch (e) {}
      }
      surahCache[s] = ayahs;
      if (!S.quran.reader || S.quran.reader.s !== s) return;
      S.quran.reader.ayahs = ayahs; S.quran.reader.loading = false;
      render();
      if (a && a > 1) { const el = document.getElementById('ay' + a); if (el) el.scrollIntoView({ block: 'start' }); }
    } catch (e) {
      if (!S.quran.reader) return;
      S.quran.reader.loading = false; S.quran.reader.error = 'Проверьте подключение к интернету.'; render();
    }
  }
  async function loadSurahMeta() {
    try { const c = localStorage.getItem('ibada:qmeta'); if (c) { S.quran.meta = JSON.parse(c); return; } } catch (e) {}
    try { const r = await fetch(QURAN_API + '/surah'); const j = await r.json(); if (j && j.data) { S.quran.meta = j.data.map((x) => x.name.replace(/^سُورَةُ\s*/, '')); try { localStorage.setItem('ibada:qmeta', JSON.stringify(S.quran.meta)); } catch (e) {} if (S.tab === 'quran') render(); } } catch (e) {}
  }

  /* ===== действия ===== */
  const A = {
    onbLevel(v) { S.onbLevel = v; haptic('select'); render(); },
    onbStart() { S.set.level = S.onbLevel; saveSettings(); haptic('notify', 'success'); render(); $('#scroll').scrollTop = 0; },
    tab(v) { if (S.tab === v && v === 'quran') S.quran.reader = null; S.tab = v; S.sheet = null; render(); $('#scroll').scrollTop = 0; },
    zikr(v) { S.zView = v; S.tab = 'zikr'; render(); $('#scroll').scrollTop = 0; },
    cycleDay() { const k = viewKey(), d = ensureDay(k); d.t = { n: 't', t: 's', s: 'n' }[d.t]; saveDay(k); haptic('select'); render(); },
    mode(v) { S.set.detailed = v === '1'; saveSettings(); render(); },
    quick(id) { const k = viewKey(), d = ensureDay(k); if (d.f[id] && d.f[id] !== 'missed') delete d.f[id]; else d.f[id] = (id === 'dhuhr' && isFriday(k) && S.set.level !== 'start') ? 'juma' : 'done'; saveDay(k); haptic('impact', 'medium'); render(); },
    sunna(key) { const k = viewKey(), d = ensureDay(k); if (d.s[key]) delete d.s[key]; else d.s[key] = 1; saveDay(k); haptic('select'); render(); },
    step(v) { const p = v.split(':'), key = p[0], delta = +p[1], cap = +p[2]; const k = viewKey(), d = ensureDay(k); const f = key === 'qiyam' ? 'q' : 'w'; d[f] = clamp((d[f] || 0) + delta, 0, cap); saveDay(k); haptic('select'); render(); },
    sheet(v) { if (v.indexOf('status:') === 0) S.sheet = { type: 'status', id: v.slice(7) }; else S.sheet = { type: v }; if (v === 'city') { S.city = { q: '', results: [], loading: false, error: '' }; } render(); if (v === 'city') { const n = document.querySelector('[data-in="city"]'); if (n && !('ontouchstart' in window)) n.focus(); } },
    closeSheet() { S.sheet = null; render(); },
    setStatus(v) { const i = v.indexOf(':'), id = v.slice(0, i), st = v.slice(i + 1); const k = viewKey(), d = ensureDay(k); if (st) d.f[id] = st; else delete d.f[id]; saveDay(k); S.sheet = null; haptic(st === 'mosque' || st === 'juma' ? 'notify' : 'impact', st === 'mosque' || st === 'juma' ? 'success' : 'medium'); render(); },
    setFast(v) { const k = viewKey(), d = ensureDay(k); d.p = v; saveDay(k); S.sheet = null; haptic('select'); render(); },
    qadaDone() { if (S.set.qadaBase > 0) { S.set.qadaBase--; saveSettings(); toast('Альхамдулиллях! Долг уменьшился'); } else toast('Откройте день с пропуском в «Прогрессе» и смените статус на «Каза»'); haptic('notify', 'success'); render(); },
    base(v) { const p = v.split(':'); S.set[p[0]] = Math.max(0, (S.set[p[0]] || 0) + +p[1]); saveSettings(); haptic('select'); render(); },
    locate() { locate(); },
    pickCity(i) { const r = S.city.results[+i]; if (r) setLocation(r.lat, r.lng, r.name, r.tz); },
    setMethod(v) { S.set.method = v; saveSettings(); S.sheet = null; render(); },
    setMadhab(v) { S.set.madhab = v; saveSettings(); S.sheet = null; render(); },
    setLevel(v) { S.set.level = v; saveSettings(); S.sheet = null; render(); },
    setHijri(v) { S.set.hijriAdj = +v; saveSettings(); S.sheet = null; render(); },
    setTheme(v) { S.set.theme = v; saveSettings(); S.sheet = null; render(); },
    backToday() { S.viewKey = null; render(); $('#scroll').scrollTop = 0; },
    zView(v) { S.zView = v; render(); },
    zSel(v) { S.zSel = +v; haptic('select'); render(); },
    tap() {
      const k = viewKey(), d = ensureDay(k);
      while (d.z.length < D.ZIKRS.length) d.z.push(0);
      d.z[S.zSel] = (d.z[S.zSel] || 0) + 1; saveDay(k);
      const c = d.z[S.zSel];
      if (c === 100) haptic('notify', 'success'); else if (c % 33 === 0) haptic('impact', 'heavy'); else haptic('impact', 'light');
      const tc = $('#tapCount'); if (tc) tc.textContent = c;
      const tgl = $('#tapGoal'); if (tgl) { tgl.textContent = c >= 100 ? 'цель выполнена' : 'из 100'; tgl.style.color = c >= 100 ? 'var(--gold)' : 'var(--sub)'; }
      const ts = $('#tasbih'); if (ts) { const lit = Math.round((Math.min(c, 100) / 100) * 33); ts.querySelectorAll('.bead').forEach((b, i) => b.classList.toggle('on', i < lit)); }
      const zc = $('#zc' + S.zSel); if (zc) { zc.textContent = c; zc.style.color = c >= 100 ? 'var(--emerald-text)' : 'var(--red-text)'; }
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
    read(v) { const p = v.split(':'); openSurah(+p[0], +p[1] || 1); },
    closeReader() { S.quran.reader = null; render(); },
    mark(v) { const m = S.set.qmarks || []; const i = m.indexOf(v); if (i >= 0) m.splice(i, 1); else m.unshift(v); S.set.qmarks = m.slice(0, 100); const p = v.split(':'); S.set.qlast = { s: +p[0], a: +p[1] }; saveSettings(); haptic('select'); render(); },
    period(v) { S.prog.period = v; render(); },
    bar(v) { S.prog.bar = +v; render(); },
    calDay(v) { S.prog.day = v; render(); },
    openDay(v) { S.viewKey = v; S.tab = 'home'; render(); $('#scroll').scrollTop = 0; },
    compass() { startCompass(); },
    share() { if (!SHARE_LINK) return; const url = 'https://t.me/share/url?url=' + encodeURIComponent(SHARE_LINK) + '&text=' + encodeURIComponent('Ибада — время намазов, Коран, азкары и учёт поклонения'); if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank'); }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = A[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el.dataset.v || '', el); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.in === 'city') searchCity(t.value);
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
    loadSurahMeta();
    setInterval(() => {
      const active = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (!S.sheet && !active && S.loaded && (S.tab === 'home')) render();
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else render(); });
    window.addEventListener('pagehide', flush);
  }
  init();
})();
