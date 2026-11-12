/* Ибада — «Живое небо».
   Фон всего приложения: цвет неба по реальной высоте Солнца над горизонтом в вашем городе,
   звёзды в сумерках и ночью, Солнце и Луна (с настоящей фазой) на своих местах.
   Расчёт — по общеизвестным астрономическим приближениям (J. Meeus и др.), точность ~1°, этого достаточно для цвета неба.
   Небо меняется медленно: новые цвета плавно перетекают за минуту. */
(function () {
  'use strict';
  const RAD = Math.PI / 180, OBL = RAD * 23.4397;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const days = (date) => date.valueOf() / 864e5 - 10957.5; // сутки от эпохи J2000.0

  function toEquatorial(l, b) {
    return {
      ra: Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l)),
      dec: Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l))
    };
  }
  function sunCoords(d) {
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return toEquatorial(M + C + RAD * 102.9372 + Math.PI, 0);
  }
  function moonCoords(d) {
    const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
    const c = toEquatorial(L + RAD * 6.289 * Math.sin(M), RAD * 5.128 * Math.sin(F));
    c.dist = 385001 - 20905 * Math.cos(M);
    return c;
  }
  // высота над горизонтом и азимут (0 — юг, минус — восток, плюс — запад)
  function horizontal(c, d, lat, lng) {
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - c.ra, phi = RAD * lat;
    return {
      alt: Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H)),
      az: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi))
    };
  }
  // освещённая доля Луны и фаза (0 — новолуние, 0.5 — полнолуние)
  function moonPhase(d) {
    const s = sunCoords(d), m = moonCoords(d), SD = 149598000;
    const phi = Math.acos(clamp(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra), -1, 1));
    const inc = Math.atan2(SD * Math.sin(phi), m.dist - SD * Math.cos(phi));
    const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI };
  }

  /* Палитра неба по высоте Солнца: [высота°, утро [верх, середина, низ], вечер [...]]. Цвета подобраны вручную. */
  const STOPS = [
    [-90, ['#02040C', '#050916', '#0A1026']],
    [-18, ['#03060F', '#070D20', '#0E1631']],
    [-12, ['#060B1F', '#0D1838', '#1E2A55'], ['#060A1D', '#0E1534', '#221F4C']],
    [-6, ['#0D1840', '#2A3470', '#5A5A8E'], ['#0C143A', '#2C2860', '#6A4A78']],
    [-2, ['#18265A', '#4C5A94', '#C9879A'], ['#151F50', '#523C78', '#D06A6A']],
    [1, ['#24397A', '#6F7FB2', '#F1B394'], ['#1E2D68', '#7A5285', '#F28A5A']],
    [5, ['#2F56A0', '#7D9ACB', '#F3CFA6'], ['#2A4688', '#8E6E96', '#F4A766']],
    [12, ['#2E62AD', '#5D93CF', '#B4D2EC'], ['#2B5AA4', '#6C8FC4', '#E2C49E']],
    [25, ['#2358A6', '#4C88CB', '#9CC4EA']],
    [90, ['#1A4E9E', '#3F7EC6', '#86B6E6']]
  ];
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
  const hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const smooth = (t) => t * t * (3 - 2 * t);
  function palette(alt, morning) {
    let i = 0;
    while (i < STOPS.length - 2 && alt > STOPS[i + 1][0]) i++;
    const a = STOPS[i], b = STOPS[i + 1], t = smooth(clamp((alt - a[0]) / (b[0] - a[0]), 0, 1));
    const A = morning ? a[1] : (a[2] || a[1]), B = morning ? b[1] : (b[2] || b[1]);
    return [0, 1, 2].map((j) => mix(rgb(A[j]), rgb(B[j]), t));
  }
  // светлая тема «рассвет»: то же небо, но пастельное — смешиваем с тёплым кремовым и возвращаем насыщенность
  function pastel(c, t) {
    const m = mix(c, CREAM, t), avg = (m[0] + m[1] + m[2]) / 3;
    return m.map((v) => clamp(avg + (v - avg) * 2.1, 0, 255));
  }
  const CREAM = rgb('#FBF2E2'), DIM_DARK = rgb('#04060E'), DIM_LIGHT = rgb('#F3EDE2');

  function moonSvg(f, phase) {
    const S = 30, r = 13.5, cx = 15, cy = 15, waxing = phase < 0.5;
    const rx = (Math.abs(2 * f - 1) * r).toFixed(2);
    const term = waxing === (f >= 0.5) ? 1 : 0;
    const lit = f < 0.02 ? '' : f > 0.98 ? '<circle cx="15" cy="15" r="' + r + '" fill="#FFF3D2"/>' :
      '<path d="M' + cx + ' ' + (cy - r) + 'A' + r + ' ' + r + ' 0 0 ' + (waxing ? 1 : 0) + ' ' + cx + ' ' + (cy + r) + 'A' + rx + ' ' + r + ' 0 0 ' + term + ' ' + cx + ' ' + (cy - r) + 'Z" fill="#FFF3D2"/>';
    return '<svg width="' + S + '" height="' + S + '" viewBox="0 0 30 30"><circle cx="15" cy="15" r="' + r + '" fill="#fff" fill-opacity=".07"/>' + lit + '</svg>';
  }
  function starsSvg() {
    let seed = 7, h = '';
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 96; i++) {
      const x = rnd() * 400, y = Math.pow(rnd(), 1.35) * 620, r = 0.35 + rnd() * rnd() * 1.4, o = 0.3 + rnd() * 0.7;
      h += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) + '" opacity="' + o.toFixed(2) + '"' + (i % 8 === 0 ? ' class="tw" style="animation-delay:-' + (rnd() * 7).toFixed(1) + 's"' : '') + '/>';
    }
    return '<svg class="sky-stars" viewBox="0 0 400 800" preserveAspectRatio="xMidYMin slice"><g fill="#fff">' + h + '</g></svg>';
  }

  let root = null, E = {}, ready = false, lastMoon = '', lastMode = '';
  // Переставить светило без медленного «проплывания» (когда оно появляется или сменился вид неба)
  function place(el, x, y, jump) {
    const tr = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    if (jump) { el.style.transition = 'none'; el.style.transform = tr; void el.offsetWidth; el.style.transition = ''; }
    else el.style.transform = tr;
  }
  function mount() {
    root = document.getElementById('sky');
    if (!root) return false;
    root.innerHTML = '<div class="sky-g"></div>' + starsSvg() + '<div class="sky-sun"></div><div class="sky-moon"></div><div class="sky-dim"></div>';
    E = { stars: root.querySelector('.sky-stars'), sun: root.querySelector('.sky-sun'), moon: root.querySelector('.sky-moon'), dim: root.querySelector('.sky-dim') };
    return true;
  }

  /* o: { lat, lng, light, dim (0–1), ten (последние 10 ночей Рамадана), lowfx, now,
          fixed: 'night' | 'day' — постоянное небо вместо живого } → цвет верха неба для шапки Telegram */
  function update(o) {
    if (!root && !mount()) return null;
    const now = o.now || new Date(), d = days(now);
    const fixed = o.fixed === 'night' || o.fixed === 'day' ? o.fixed : '';
    const modeChanged = fixed !== lastMode; lastMode = fixed;
    const sun = horizontal(sunCoords(d), d, o.lat, o.lng), alt = fixed === 'night' ? -30 : fixed === 'day' ? 40 : sun.alt / RAD;
    let c = palette(alt, sun.az < 0);
    if (o.light) c = c.map((x, i) => pastel(x, i === 2 ? 0.6 : 0.74));
    root.style.setProperty('--s1', hex(c[0]));
    root.style.setProperty('--s2', hex(c[1]));
    root.style.setProperty('--s3', hex(c[2]));
    root.classList.toggle('light', !!o.light);
    root.classList.toggle('lowfx', !!o.lowfx);

    const night = clamp((-alt - 3) / 12, 0, 1);
    E.stars.style.opacity = o.light ? 0 : (night * (o.ten ? 1 : 0.85)).toFixed(3);

    // Солнце и Луна видны только на главном экране; на остальных небо приглушено и не отвлекает
    const bodies = (o.dim || 0) < 0.2;
    const W = root.clientWidth || window.innerWidth, H = root.clientHeight || window.innerHeight, hy = H * 0.6;
    const pos = (h) => [W * (0.5 + clamp(h.az / Math.PI, -0.5, 0.5) * 0.9), hy - (h.alt / (Math.PI / 2)) * hy * 0.9];
    if (bodies && !fixed && alt > -4) {
      const p = pos(sun);
      place(E.sun, p[0], p[1], modeChanged || E.sun.style.opacity === '0' || !E.sun.style.opacity);
      E.sun.style.opacity = clamp((alt + 4) / 6, 0, 1).toFixed(2);
      E.sun.classList.toggle('low', alt < 8);
    } else E.sun.style.opacity = 0;

    const mh = horizontal(moonCoords(d), d, o.lat, o.lng), ph = moonPhase(d);
    if (bodies && fixed === 'night' && ph.fraction > 0.02) {
      // постоянная ночь: Луна с настоящей фазой, но на постоянном месте
      const key = ph.fraction.toFixed(2) + (ph.phase < 0.5 ? 'w' : 'n');
      if (key !== lastMoon) { E.moon.innerHTML = moonSvg(ph.fraction, ph.phase); lastMoon = key; }
      place(E.moon, W * 0.82, H * 0.13, true);
      E.moon.style.opacity = o.light ? 0.8 : 1;
    } else if (bodies && !fixed && mh.alt > -0.02 && ph.fraction > 0.02) {
      const key = ph.fraction.toFixed(2) + (ph.phase < 0.5 ? 'w' : 'n');
      if (key !== lastMoon) { E.moon.innerHTML = moonSvg(ph.fraction, ph.phase); lastMoon = key; }
      const p = pos(mh);
      place(E.moon, p[0], p[1], modeChanged || E.moon.style.opacity === '0' || !E.moon.style.opacity);
      E.moon.style.opacity = (alt > 0 ? 0.6 : alt > -6 ? 0.9 : 1) * (o.light ? 0.8 : 1);
    } else E.moon.style.opacity = 0;

    E.dim.style.opacity = clamp(o.dim || 0, 0, 1);
    if (!ready) { ready = true; requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('ready'))); }
    return hex(mix(c[0], o.light ? DIM_LIGHT : DIM_DARK, clamp(o.dim || 0, 0, 1)));
  }

  /* Небо для карточки текущего намаза (v12): те же цвета и светила, но без анимаций и без «пастели».
     Возвращает цвета градиента, яркость звёзд, мягкое свечение Солнца (доли ширины и высоты карточки) и Луну с фазой. */
  let cardStars = '';
  function cardStarsSvg() {
    if (cardStars) return cardStars;
    let seed = 11, h = '';
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const x = rnd() * 400, y = Math.pow(rnd(), 1.2) * 300, r = 0.4 + rnd() * rnd() * 1.3, o = 0.35 + rnd() * 0.65;
      h += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) + '" opacity="' + o.toFixed(2) + '"/>';
    }
    return (cardStars = '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="#fff">' + h + '</g></svg>');
  }
  function card(o) {
    const now = o.now || new Date(), d = days(now);
    const fixed = o.fixed === 'night' || o.fixed === 'day' ? o.fixed : '';
    const sun = horizontal(sunCoords(d), d, o.lat, o.lng), alt = fixed === 'night' ? -30 : fixed === 'day' ? 40 : sun.alt / RAD;
    const c = palette(alt, sun.az < 0).map(hex);
    const stars = clamp((-alt - 3) / 12, 0, 1) * (o.ten ? 1 : 0.85);
    let glow = null;
    if (alt > -6) {
      const az = fixed ? 0.35 : clamp(sun.az / Math.PI, -0.5, 0.5);
      glow = { x: clamp(0.5 + az * 0.9, 0.08, 0.92), y: clamp(0.62 - (Math.max(alt, -4) / 70) * 0.55, 0.06, 0.66), op: clamp((alt + 6) / 10, 0, 1), low: alt < 8 };
    }
    const ph = moonPhase(d), mh = horizontal(moonCoords(d), d, o.lat, o.lng);
    const moon = alt < 2 && ph.fraction > 0.02 && (fixed === 'night' || mh.alt > -0.02) ? moonSvg(ph.fraction, ph.phase) : '';
    return { c, stars: +stars.toFixed(2), starsSvg: stars > 0.02 ? cardStarsSvg() : '', glow, moon, night: alt < -6 };
  }

  window.IbadaSky = { update, card, _sun: (date, lat, lng) => { const d = days(date); const h = horizontal(sunCoords(d), d, lat, lng); return { alt: h.alt / RAD, az: h.az / RAD }; }, _moon: (date) => moonPhase(days(date)) };
})();
