(function () {
  "use strict";
  const C = window.BazisCore, Wd = window.Widgets, R = window.Render, MU = window.Music;
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const esc = C.esc, MINUS = C.MINUS;
  // Игра по локальной сети: страницу отдаёт bazis_server.py с ноутбука, связь идёт через него же
  const LAN = !(window.claude && typeof window.claude.use === "function") && !!window.BAZIS_LAN && !!window.LanRoom;

  // ---------- хранилище браузера: только удобство одного зрителя ----------
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } },
  };

  // ---------- общее состояние ----------
  let MODE = "landing";  // landing | host | phone
  let H = null, P = null, ROOM = null, ONLINE = {}, CONN = "idle", roomNsP = null, waitTimer = 0;
  const UI = { toastTimer: 0, confirmReveal: false, confirmFinish: false, hint: false, exInput: null, musicOn: true, vol: 0.55 };
  const prefs = LS.get("bazis.audio");
  if (prefs) { UI.musicOn = prefs.on !== false; UI.vol = typeof prefs.vol === "number" ? prefs.vol : 0.55; }
  MU.setEnabled(UI.musicOn); MU.setVolume(UI.vol);

  function getRoomNs() {
    if (!roomNsP) {
      roomNsP = (async () => {
        try {
          if (window.claude && typeof window.claude.use === "function") return await window.claude.use("room");
          if (LAN) return window.LanRoom.create();
          return null;
        } catch (e) { return null; }
      })();
    }
    return roomNsP;
  }
  // Связь идёт через общую комнату артефакта (лобби): именованные комнаты есть не везде,
  // а лобби доступно всем, кому платформа вообще дала связь. Своих отличаем по коду комнаты.
  let roomUnsub = [], CONN_WHY = "";
  const PRES_KEYS = ["app", "host", "role", "code", "rd", "cs", "old", "ph", "lv", "nL", "n", "solo", "seats", "asg", "cv", "vv", "px", "al", "nz", "gw", "gc", "msg", "fin", "pid", "nick", "ctl", "acts", "ex"];
  async function leaveRoom() {
    const r = ROOM; ROOM = null;
    roomUnsub.splice(0).forEach(u => { try { u(); } catch (e) { /* уже отписаны */ } });
    if (r) { const clear = {}; PRES_KEYS.forEach(k => { clear[k] = null; }); try { await r.presence(clear); } catch (e) { /* связи уже нет */ } }
  }
  const whyNoRoom = () => (!window.claude || typeof window.claude.use !== "function" ? "noapi" : "null");
  const errWhy = e => "err:" + ((e && e.code) || "unknown");
  function whyText(why) {
    if (why === "noapi") return "Страница открыта не внутри Claude, поэтому связи между устройствами нет. Откройте ссылку в браузере на claude.ai.";
    if (why === "null") return "Claude не включил этой странице связь между устройствами. Так бывает, если игра открыта не на claude.ai (отдельной страницей или во встроенном просмотре приложения), по публичной ссылке или без входа в аккаунт. Откройте ту же ссылку в браузере на claude.ai, войдя в аккаунт, которому открыт доступ к игре.";
    if (why === "err:not_granted") return "Этому аккаунту связь не открыта. Главарь должен пригласить вас через «Поделиться», а открывать ссылку нужно, войдя в Claude.";
    if (why === "err:revoked") return "Доступ к игре закрыли. Попросите главаря снова открыть его через «Поделиться».";
    if (why && why.startsWith("err:")) return `Связь оборвалась (код ${why.slice(4)}). Попробуйте ещё раз.`;
    return "Связь между устройствами недоступна.";
  }

  const INVISIBLE = new RegExp("[" + [[0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => { const u = c => "\\u" + c.toString(16).padStart(4, "0"); return a === b ? u(a) : u(a) + "-" + u(b); }).join("") + "]", "g");
  function cleanNick(s) { if (typeof s !== "string") return "Игрок"; const t = s.replace(INVISIBLE, "").trim().slice(0, 16); return t || "Игрок"; }
  const randomPid = () => "p" + Array.from({ length: 11 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]).join("");
  const PID_RE = /^p[a-z0-9]{5,23}$/;
  const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const pct = x => Math.max(0, Math.min(100, Math.round(x)));
  const caseOf = cs => C.caseInfo(cs);
  const now = () => performance.now();
  const clone = o => JSON.parse(JSON.stringify(o));
  const PCOUNT = 8;
  const seatColor = s => `var(--p${((s % PCOUNT) + PCOUNT) % PCOUNT})`;
  function stageLabel(cs, withOld, pos, short) {
    const nOld = C.oldCount(cs, withOld), N = C.stageCount(cs, withOld);
    if (pos < nOld) return short ? `Старый замок` : `Старый замок из дела №1`;
    return short ? `Сейф ${pos - nOld + 1}/${N - nOld}` : `Сейф ${pos - nOld + 1} из ${N - nOld}`;
  }
  function showToast(text, kind) {
    toastEl.textContent = text; toastEl.dataset.k = kind || "gold"; toastEl.hidden = false;
    clearTimeout(UI.toastTimer); UI.toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3800);
  }
  // до первого касания браузер вибрацию всё равно не даст (например, после перезагрузки страницы) — и не просим
  const vib = p => { try { if (navigator.vibrate && !(navigator.userActivation && !navigator.userActivation.hasBeenActive)) navigator.vibrate(p); } catch (e) { /* нет вибрации */ } };
  let wakeLock = null;
  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
    // по http в локальной сети Wake Lock недоступен — телефону помогает беззвучное видео по кругу
    if (!wakeLock && MODE === "phone" && window.KeepAwake) window.KeepAwake.videoOn();
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && MODE !== "landing") keepAwake(); });

  // ---------- адрес ноутбука для телефонов (локальная сеть) ----------
  const LANI = { ips: [], port: "", at: 0, busy: false };
  async function lanInfo(force) {
    if (!LAN || LANI.busy || (!force && Date.now() - LANI.at < 3500)) return;
    LANI.busy = true;
    try {
      const r = await fetch("/info", { cache: "no-store" });
      const j = await r.json();
      const ips = Array.isArray(j.ips) ? j.ips.filter(x => typeof x === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(x)).slice(0, 8) : [];
      const port = Number.isInteger(j.port) && j.port > 0 ? String(j.port) : location.port;
      const changed = ips.join(",") !== LANI.ips.join(",") || port !== LANI.port;
      LANI.ips = ips; LANI.port = port; LANI.at = Date.now();
      if (changed && MODE === "host" && H && H.phase === "lobby") renderHost();
    } catch (e) { /* сервер не ответил — связь покажет индикатор */ } finally { LANI.busy = false; }
  }
  setInterval(() => { if (LAN && MODE === "host") lanInfo(); }, 4000);
  function lanAddr() {
    if (!LAN) return null;
    let ip = UI.lanIp && LANI.ips.includes(UI.lanIp) ? UI.lanIp : "";
    if (!ip && LANI.ips.includes(location.hostname)) ip = location.hostname; // большой экран открыт по сетевому адресу — его и показываем
    if (!ip) ip = LANI.ips[0] || "";
    if (!ip) return null;
    const port = LANI.port || location.port;
    return { ip, addr: ip + (port && port !== "80" ? ":" + port : "") };
  }

  // =====================================================================
  // Планы объектов (лобби и заставки уровней)
  // =====================================================================
  const BAZIS_DECOR = (() => {
    let s = `<g class="deco">`;
    s += `<path d="M118 410 A28 28 0 0 0 90 382 M90 410 V382"/><path d="M150 272 l-34 14 l34 14 z"/>`;
    s += `<circle cx="410" cy="132" r="22"/><circle cx="410" cy="132" r="4"/><path d="M410 110 v7 M432 132 h-7 M410 154 v-7 M388 132 h7"/>`;
    s += `<rect x="285" y="350" width="62" height="40"/><rect x="372" y="350" width="62" height="40"/><path d="M285 350 l62 40 M347 350 l-62 40 M372 350 l62 40 M434 350 l-62 40"/>`;
    s += `<circle cx="530" cy="300" r="36"/><circle cx="530" cy="300" r="8"/></g>`;
    for (let k = 0; k < 5; k++) s += `<line class="laser" x1="${130 + 42 * k}" y1="160" x2="${165 + 42 * k}" y2="58"/>`;
    for (let x = 262; x <= 442; x += 30) for (let y = 222; y <= 292; y += 24) s += `<circle class="dot" cx="${x}" cy="${y}" r="1.6"/>`;
    return s;
  })();
  const USADBA_DECOR = (() => {
    let s = `<g class="deco"><circle cx="150" cy="386" r="4"/><path d="M150 372 V382 M118 404 h40 M122 404 v10 M154 404 v10"/>`;
    for (let x = 316; x <= 352; x += 12) s += `<path d="M${x} 366 V414"/>`;
    s += `<path d="M310 366 H358 M310 414 H358"/>`;
    for (let y = 150; y <= 310; y += 40) s += `<path d="M34 ${y} l16 -16 M156 ${y} l-16 -16"/>`;
    s += `<circle cx="465" cy="300" r="11"/><circle cx="465" cy="300" r="5"/><circle cx="545" cy="262" r="14"/><circle cx="531" cy="277" r="11"/><circle cx="559" cy="278" r="11"/><path d="M545 289 V306"/>`;
    s += `<circle cx="480" cy="386" r="6"/><path d="M475 381 l10 10 M485 381 l-10 10"/><rect x="522" y="72" width="44" height="44"/><circle cx="544" cy="94" r="11"/></g>`;
    const dots = (cx, cy, r, n) => { let o = ""; for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; o += `<circle class="dot" cx="${(cx + r * Math.cos(a)).toFixed(1)}" cy="${(cy + r * Math.sin(a)).toFixed(1)}" r="2.4"/>`; } return o; };
    return s + dots(300, 262, 44, 12) + dots(262, 108, 32, 8) + dots(350, 108, 32, 8) + `<path class="laser" d="M40 300 L150 230 L40 160 L150 90"/>`;
  })();
  const PLANS = {
    bazis: {
      dim: "56000",
      rooms: [{ r: [20, 330, 140, 80], num: "1" }, { r: [20, 190, 140, 120], num: "2" }, { r: [20, 40, 320, 130], num: "3" }, { r: [360, 40, 100, 130], num: "4" }, { r: [180, 190, 280, 120], num: "5" }, { r: [180, 330, 280, 80], num: "6" }, { r: [480, 40, 100, 370], num: "7" }],
      segs: ["90,446 90,370", "90,370 90,250", "90,250 90,105 180,105", "180,105 410,105", "410,105 410,250 320,250", "320,250 320,370", "320,370 530,370 530,225"],
      doors: [[90, 410], [90, 320], [90, 180], [350, 105], [410, 180], [320, 320], [470, 370]],
      decor: BAZIS_DECOR,
    },
    usadba: {
      dim: "84000",
      rooms: [{ r: [40, 360, 140, 60], num: "", l: [50, 395] }, { r: [230, 360, 140, 60], num: "1" }, { c: [300, 262, 52], num: "2", n: [300, 252], l: [300, 274], anchor: "middle" }, { r: [20, 40, 150, 290], num: "3" }, { cc: [[262, 108, 40], [350, 108, 40]], num: "4", n: [306, 174], l: [306, 194], anchor: "middle" }, { r: [430, 190, 150, 230], num: "5" }, { r: [430, 40, 150, 120], num: "6" }],
      segs: ["300,446 300,436 110,436 110,420", "300,446 300,420", "300,360 300,314", "248,262 170,262", "170,108 222,108", "390,108 410,108 410,300 430,300", "505,190 505,160"],
      doors: [[110, 420], [300, 420], [300, 314], [170, 262], [222, 108], [430, 300], [505, 160]],
      decor: USADBA_DECOR,
    },
  };
  function planSVG(cs, withOld, cur, phase) {
    const PL = PLANS[cs] || PLANS.usadba, names = caseOf(cs).rooms, list = C.stageList(cs, withOld);
    const live = ["intro", "play", "win", "debrief"].includes(phase);
    const state = r => {
      const ps = list.map((it, i) => (it.room === r ? i : -1)).filter(i => i >= 0);
      if (!ps.length) return phase === "landing" ? "" : "skip";
      if (phase === "end" || phase === "exam") return "done";
      if (!live) return "";
      const done = phase === "win" || phase === "debrief";
      if (cur > ps[ps.length - 1] || (cur === ps[ps.length - 1] && done)) return "done";
      if (cur >= ps[0]) return "now";
      return "";
    };
    const st = PL.rooms.map((_, r) => state(r));
    const reached = r => st[r] === "done" || st[r] === "now";
    const shape = rm => rm.r ? `<rect class="wall" x="${rm.r[0]}" y="${rm.r[1]}" width="${rm.r[2]}" height="${rm.r[3]}"/>` : rm.c ? `<circle class="wall" cx="${rm.c[0]}" cy="${rm.c[1]}" r="${rm.c[2]}"/>` : rm.cc.map(c => `<circle class="wall" cx="${c[0]}" cy="${c[1]}" r="${c[2]}"/>`).join("");
    const txt = (rm, i) => { const n = rm.n || [rm.r[0] + 10, rm.r[1] + 28], l = rm.l || [rm.r[0] + 10, rm.r[1] + 48], an = rm.anchor ? ` text-anchor="${rm.anchor}"` : ""; return (rm.num ? `<text class="num" x="${n[0]}" y="${n[1]}"${an}>${rm.num}</text>` : "") + `<text class="lbl" x="${l[0]}" y="${l[1]}"${an}>${names[i]}</text>`; };
    return `<svg class="plan" viewBox="0 0 600 452" role="img" aria-label="${esc("План: " + caseOf(cs).title)}">
<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="9"/></pattern></defs>
<line class="dim" x1="20" y1="24" x2="580" y2="24"/><line class="dim" x1="20" y1="17" x2="20" y2="31"/><line class="dim" x1="580" y1="17" x2="580" y2="31"/><text class="dimtxt" x="300" y="15" text-anchor="middle">${PL.dim}</text>
${PL.decor}${PL.rooms.map((rm, i) => `<g class="room ${st[i]}">${shape(rm)}${txt(rm, i)}</g>`).join("")}
${PL.segs.map((s, i) => `<polyline class="route${reached(i) ? " done" : ""}" points="${s}"/>`).join("")}
${PL.doors.map(([x, y], i) => `<rect class="door${reached(i) ? " on" : ""}" x="${x - 5}" y="${y - 5}" width="10" height="10"/>`).join("")}</svg>`;
  }

  // =====================================================================
  // Большой экран
  // =====================================================================
  function newHost(prev, cs) {
    cs = C.caseOk(cs || (prev && prev.cs) || "usadba");
    return {
      code: prev ? prev.code : C.makeCode(), round: prev ? prev.round + 1 : 1, cs,
      old: prev && prev.cs === cs ? !!prev.old : false,
      phase: "lobby", lv: 0, vr: 0, n: prev ? prev.n : 0, nL: 1, solo: prev ? prev.solo : false,
      seats: prev ? prev.seats : {}, nicks: prev ? prev.nicks : {}, seqs: prev ? prev.seqs : {},
      alarm: 0, noise: 0, asg: {}, V: {}, aux: null, vv: prev && Number.isInteger(prev.vv) ? prev.vv + 1 : 1000 + Math.floor(Math.random() * 90000), hold: {}, resumeLv: null,
      lvStart: 0, pausedAt: 0, pausedMs: 0, overT: 0,
      guard: { state: "idle", next: 0, id: 0, until: 0, caught: false },
      lastNoiser: null, sirenUntil: 0, winAt: 0, openedAt: 0,
      stats: [], log: [], res: null, resQ: prev ? prev.resQ : 0, lost: {},
      exam: null, final: null,
    };
  }
  const NST = () => C.stageCount(H.cs, H.old);
  const curLevel = () => C.getLevel(H.cs, H.code, H.round, H.lv, H.old, H.vr);
  const elapsed = () => (H.pausedAt || now()) - H.lvStart - H.pausedMs;
  let rolesMemo = { key: "", roles: [] };
  function roleDefs() {
    if (!H || !H.aux) return [];
    const key = `${H.cs}|${H.old}|${H.code}|${H.round}|${H.lv}|${H.vr}|${H.nL}`;
    if (rolesMemo.key !== key) rolesMemo = { key, roles: curLevel().roles(H.nL) };
    return rolesMemo.roles;
  }
  const hasLookout = () => roleDefs().some(r => r.id === "look");
  function roleColor(rid) {
    const s = H && H.asg ? H.asg[rid] : undefined;
    const cols = R.colors();
    if (s === undefined) return cols.gold;
    if (H.solo) { const i = roleDefs().findIndex(r => r.id === rid); return cols["p" + ((i < 0 ? 0 : i) % PCOUNT)]; }
    return cols["p" + (s % PCOUNT)];
  }
  const nickOfSeat = s => { const pid = Object.keys(H.seats).find(p => H.seats[p] === s); return pid ? (ONLINE[pid] ? ONLINE[pid].nick : H.nicks[pid] || "Игрок") : "—"; };
  function saveHost() {
    if (!H) return;
    LS.set("bazis.host", { code: H.code, round: H.round, cs: H.cs, old: H.old, lv: H.lv, phase: ["play", "win", "intro", "debrief"].includes(H.phase) ? "intro" : H.phase, alarm: H.alarm, stats: H.stats, seats: H.seats, nicks: H.nicks, solo: H.solo, n: H.n, resQ: H.resQ });
  }
  function log(m, k) { H.log.unshift({ m, k: k || "info", t: Date.now() }); H.log = H.log.slice(0, 6); H.resQ++; H.res = { q: H.resQ, m: C.stripTags(m).slice(0, 220), k: k || "info" }; }

  function publicAux() {
    const L = curLevel(), a = H.aux || {};
    if (L.task) { const wr = {}; Object.keys(a.wrong || {}).forEach(k => { wr[k] = a.wrong[k].n; }); return { lk: Object.keys(a.solved || {}), wr }; }
    if (L.kind === "proof") return { pl: a.placed ? a.placed.map(s => L.canon[s]) : [], bu: a.burned || [], ch: !!(a.placed && a.placed.length === L.nSteps), op: !!a.opened };
    return {};
  }
  function hostPresence() {
    const live = ["intro", "play", "win", "debrief"].includes(H.phase);
    const g = H.guard;
    return {
      app: "bazis", host: true, code: H.code, rd: H.round, cs: H.cs, old: H.old ? 1 : 0, ph: H.phase, lv: H.lv, vr: H.vr || 0, nL: H.nL, n: H.n, solo: !!H.solo,
      seats: H.seats, asg: live ? H.asg : {}, cv: live ? H.V : {}, vv: H.vv, px: live ? publicAux() : {},
      al: pct(H.alarm), nz: pct(H.noise),
      gw: g.state === "warn" ? { id: g.id, ms: Math.max(0, Math.round(g.until - now())) } : null, gc: g.state === "check" ? g.id : 0,
      msg: H.res, fin: H.final ? { l: H.final.loot, m: H.final.max } : null,
    };
  }
  let lastPush = 0, pushQueued = false;
  function pushHost(force) {
    if (!ROOM || MODE !== "host") return;
    const t = now();
    if (!force && t - lastPush < 120) { if (!pushQueued) { pushQueued = true; setTimeout(() => { pushQueued = false; pushHost(true); }, 130); } return; }
    lastPush = t;
    ROOM.presence(hostPresence()).catch(() => { /* связь восстановится */ });
  }
  function commit() { saveHost(); pushHost(true); }

  function reseat() {
    const present = Object.keys(ONLINE);
    const prev = Object.entries(H.seats).sort((a, b) => a[1] - b[1]).map(([pid]) => pid);
    const order = prev.filter(pid => present.includes(pid)).concat(present.filter(pid => !prev.includes(pid)));
    const seats = {};
    order.forEach((pid, i) => { seats[pid] = i; });
    H.seats = seats; H.n = order.length;
  }

  // ---------- уровень ----------
  function startLevel(lv) {
    H.lv = lv; H.vr = 0;
    reseat();
    const L = curLevel();
    H.nL = H.solo ? 1 : Math.max(1, H.n);
    const roles = L.roles(H.nL);
    H.asg = C.assignRoles(roles, H.nL, lv);
    H.V = {}; roles.forEach(r => { H.V[r.id] = clone(r.init || {}); });
    H.aux = L.initAux(H.nL);
    H.vv++; H.hold = {}; H.lost = {};
    H.phase = "intro"; H.noise = 0; H.lastNoiser = null; H.sirenUntil = 0; H.openedAt = 0;
    H.stats[lv] = { time: 0, caught: 0, bad: 0, hints: 0, sirens: 0, revealed: false, loot: 0 };
    H.log = []; H.res = null; UI.hint = false; UI.confirmReveal = false;
    H.lastRes = L.evaluate(H.V, H.aux);
    R.clearTweens();
    MU.setMode("calm"); MU.sting("start");
    renderHost(); commit();
  }
  function go() {
    H.phase = "play"; H.lvStart = now(); H.pausedMs = 0; H.pausedAt = 0; H.overT = 0;
    H.guard = { state: "idle", next: now() + 14000 + Math.random() * 6000, id: H.guard.id || 0, until: 0, caught: false };
    MU.setMode("play");
    R.banner("Поехали!", curLevel().title, "gold", 1400);
    renderHost(); commit(); keepAwake();
  }
  function resetLevelValues(msg) {
    const L = curLevel(), roles = L.roles(H.nL);
    roles.forEach(r => { H.V[r.id] = clone(r.init || {}); });
    H.aux = L.initAux(H.nL); H.vv++; H.hold = {};
    if (msg) log(msg, "bad");
  }
  // любое движение, пока охрана смотрит, — поимка; первые 450 мс прощаем: телефоны узнают о проверке с задержкой
  function addNoise(x, pid) {
    H.noise = Math.min(100, H.noise + x);
    if (pid) H.lastNoiser = pid;
    const g = H.guard, t = now();
    // в скрытой вкладке таймер редкий и проверка может «задержаться» — после её конца уже не ловим
    if (g.state === "check" && !g.caught && t - g.start > 450 && t < g.until) caught(pid || H.lastNoiser);
  }
  function addAlarm(x) {
    if (H.phase !== "play") return;
    H.alarm = Math.min(100, H.alarm + x);
    if (H.alarm >= 100 && !H.sirenUntil) {
      H.sirenUntil = now() + 3200; H.stats[H.lv].sirens++;
      MU.setMode("siren"); R.banner("СИРЕНА!", "Механизмы сброшены — все на исходную", "bad", 3000); R.fx("caught");
      log("Сирена! Механизмы сброшены.", "bad");
    }
  }
  function caught(pid) {
    const g = H.guard;
    if (g.caught) return;
    g.caught = true;
    H.stats[H.lv].caught++;
    const who = pid === "host" ? "кто-то у большого экрана" : pid && (ONLINE[pid] || H.nicks[pid]) ? (ONLINE[pid] ? ONLINE[pid].nick : H.nicks[pid]) : "кто-то";
    R.fx("caught"); MU.sting("caught"); R.banner("ШУМ!", `Охрана услышала: ${who}`, "bad", 2000);
    log(`Охрана услышала шум. Шумел(а): ${who}. Тревога +20%.`, "bad");
    addAlarm(20);
  }
  // охрана смотрит: по обходу после предупреждения или сразу, без предупреждения, — на шум ошибки
  function startCheck(t) {
    const g = H.guard;
    if (g.state !== "warn") g.id++;
    g.state = "check"; g.start = t; g.until = t + 3200; g.caught = false;
    MU.setMode("check");
    if (H.noise > 30) caught(H.lastNoiser);
    pushHost(true);
  }
  function fxEffect(fx, goalId) {
    if (!fx) return;
    if (fx === "lock") { R.fx("lock", goalId); MU.sting("lock"); }
    else if (fx === "bad") { R.fx("bad"); MU.sting("bad"); }
    else if (fx === "bounce") MU.sting("bad");
    else if (fx === "place") { R.fx("place", "chain"); MU.sting("place"); }
    else if (fx === "burn") { R.fx("burn", "chain"); MU.sting("burn"); }
    else if (fx === "open") { H.openedAt = now(); R.fx("open", "keys"); MU.sting("open"); }
    else if (fx === "treasure") { R.fx("treasure", "dig"); MU.sting("treasure"); }
    else if (fx === "walk") MU.sting("walk");
    else if (fx === "tick") MU.sting("tick");
  }
  function doAction(rid, type, data, pid) {
    if (H.phase !== "play" || H.sirenUntil) return;
    const L = curLevel();
    if (!L.act) return;
    const role = roleDefs().find(r => r.id === rid);
    if (!role) return;
    const allowed = role.w.some(w => (w.t === "action" && w.act === type) || (w.t === "cards" && (type === "play" || type === "burn")) || (w.t === "key" && type === "key"));
    if (!allowed) return;
    // у ролей, привязанных к месту (карточки, своя задача), «место» — исходное, даже если роль передали другому
    const seat = role.seat !== undefined ? role.seat % Math.max(1, H.nL) : H.asg[rid];
    const r = L.act(H.aux, type, typeof data === "string" ? data.slice(0, 4) : null, { role: rid, seat, n: H.nL, V: H.V, now: now(), solo: H.solo }) || {};
    if (type === "spin") MU.sting("spin");
    if (r.noise) addNoise(r.noise, pid);
    if (r.alarm) {
      H.stats[H.lv].bad++; addAlarm(r.alarm);
      if (!H.sirenUntil && H.guard.state !== "check") { startCheck(now()); R.banner("ОХРАНА!", "Ошибка нашумела — замрите", "bad", 1600); }
    }
    fxEffect(r.fx, r.goal || (r.fx === "lock" ? "path" : undefined));
    if (r.msg) log(r.msg, r.alarm || r.fx === "bad" ? "bad" : r.fx === "lock" || r.fx === "open" || r.fx === "treasure" || r.fx === "place" || r.fx === "burn" ? "ok" : "info");
    H.lastRes = L.evaluate(H.V, H.aux);
    renderSide(); pushHost(true);
  }
  function setValue(rid, val, pid) {
    const role = roleDefs().find(r => r.id === rid);
    if (!role) return false;
    const v = C.sanitizeRoleVal(role, val);
    if (!v || JSON.stringify(v) === JSON.stringify(H.V[rid])) return false;
    H.V[rid] = v;
    touched(rid, pid);
    return true;
  }
  function touched(rid, pid) {
    const L = curLevel();
    if (L.onChange) L.onChange(H.aux, rid);
    if (H.phase === "play") addNoise(3.5, pid);
  }
  function win() {
    const L = curLevel(), st = H.stats[H.lv];
    H.phase = "win"; H.winAt = now();
    st.time = elapsed(); st.loot = C.levelLoot(st, L.par);
    R.fx("win"); R.banner(L.win, `+${st.loot} слитков`, "gold", 2400);
    MU.sting("win"); MU.setMode("calm");
    log(`${L.win} +${st.loot} слитков.`, "ok");
    renderHost(); commit();
  }
  function tickPlay(dt, t) {
    const L = curLevel(), g = H.guard;
    if (H.sirenUntil) {
      if (t >= H.sirenUntil) {
        // охрана меняет замки: тот же сейф, но с новыми числами — заученный ответ не поможет
        H.sirenUntil = 0; H.alarm = 55; H.vr = (H.vr || 0) + 1;
        R.clearTweens(); resetLevelValues("Сирена стихла. Охрана сменила замки — у сейфа новые числа.");
        H.lastRes = curLevel().evaluate(H.V, H.aux);
        MU.setMode("play"); renderHost(); pushHost(true);
      }
      return;
    }
    H.noise = Math.max(0, H.noise - 14 * dt);
    const over = elapsed() - L.par * 1000;
    if (over > 0) { const due = Math.floor(over / 5000) + 1; if (due > H.overT) { H.overT = due; addAlarm(1); } }
    if (g.state === "idle" && t >= g.next) {
      g.state = "warn"; g.id++; g.until = t + 3000; pushHost(true);
      if (!hasLookout()) MU.sting("walk");
    }
    else if (g.state === "warn" && t >= g.until) startCheck(t);
    else if (g.state === "check" && t >= g.until) {
      g.state = "idle"; g.next = t + 12000 + Math.random() * 8000;
      if (!g.caught) log("Охрана прошла мимо. Можно работать.", "ok");
      MU.setMode("play"); pushHost(true); renderSide();
    }
    const res = L.evaluate(H.V, H.aux);
    H.lastRes = res;
    let latched = false;
    res.goals.forEach(gl => {
      if (gl.latch && gl.ok && !H.aux.latched[gl.id]) {
        H.hold[gl.id] = (H.hold[gl.id] || 0) + dt;
        if (H.hold[gl.id] >= 0.6) {
          H.aux.latched[gl.id] = gl.by || true;
          if (L.onLatch) L.onLatch(H.aux, gl.id, H.V);
          fxEffect("lock", gl.id); latched = true;
          if (!gl.hidden) log(`Готово: ${gl.label}.`, "ok");
        }
      } else if (!gl.ok) H.hold[gl.id] = 0;
    });
    if (L.expire && L.expire(H.aux, t)) pushHost(true);
    const done = res.done !== undefined ? res.done : res.goals.filter(x => x.latch).every(x => H.aux.latched[x.id]);
    if (done) { win(); return; }
    if (latched) { renderSide(); pushHost(true); }
    MU.setIntensity(Math.min(1, H.alarm / 110 + (over > 0 ? 0.35 : 0) + (g.state === "warn" ? 0.15 : 0)));
  }
  function goalOk(res, id) { const g = res && res.goals.find(x => x.id === id); return !!(g && (g.ok || (H.aux && H.aux.latched[id]))); }

  // ---------- ход игры: по таймеру, а не по кадрам ----------
  // В скрытой вкладке и свёрнутом окне браузер кадры не рисует, а сейфы должны открываться и тогда
  // (например, если на ноутбуке открыта вкладка-«телефон»). Там таймер реже — раз в секунду, отсюда предел dt.
  let lastTick = now(), lastBeat = 0;
  function tick() {
    const t = now(), dt = Math.min(1, (t - lastTick) / 1000);
    lastTick = t;
    if (MODE !== "host" || !H) return;
    if (H.phase === "play" && !H.pausedAt) tickPlay(dt, t);
    if (H.phase === "win" && t - H.winAt > 2600) { H.phase = "debrief"; renderHost(); commit(); }
    if (H.phase === "play" && t - lastBeat > 350) { lastBeat = t; pushHost(); }
  }
  setInterval(tick, 100);

  // ---------- кадр большого экрана ----------
  let lastFrame = now(), lastHud = 0;
  function frame() {
    const t = now(), dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    if (MODE === "host" && H && ["intro", "play", "win", "debrief"].includes(H.phase)) {
      const L = curLevel(), res = H.lastRes || L.evaluate(H.V, H.aux), g = H.guard;
      R.frame(L.kind, res.scene, {
        dt, t: t / 1000, now: t, color: roleColor, nick: rid => (H.solo ? "" : nickOfSeat(H.asg[rid])), goal: id => goalOk(res, id), solved: H.phase === "win" || H.phase === "debrief",
        alarm: H.alarm, guard: H.phase === "play" && !H.pausedAt ? { state: g.state, p: g.state === "check" ? 1 - (g.until - t) / 3200 : 0, public: !hasLookout() } : null,
        siren: !!H.sirenUntil, openedAt: H.openedAt,
      });
      if (t - lastHud > 100) { lastHud = t; updateHud(); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener("resize", () => { if (MODE === "host") R.resize(); });
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => R.readColors()); } catch (e) { /* старый браузер */ }

  // ---------- связь большого экрана ----------
  function hostOnPeers(peers) {
    if (MODE !== "host" || !H) return;
    const next = {};
    let changed = false, examChanged = false;
    const live = H.phase === "play" || H.phase === "intro";
    for (const p of peers) {
      if (p.sameTab) continue;
      const pr = p.presence || {};
      if (pr.app !== "bazis" || pr.role !== "phone" || pr.code !== H.code || typeof pr.pid !== "string" || !PID_RE.test(pr.pid)) continue;
      const pid = pr.pid, nick = cleanNick(pr.nick);
      next[pid] = { nick };
      H.nicks[pid] = nick;
      // опоздавший садится на свободное место; пульт получит на следующем сейфе
      if (H.seats[pid] === undefined && H.phase !== "lobby" && H.phase !== "end") {
        H.seats[pid] = Object.values(H.seats).reduce((m, s) => Math.max(m, s), -1) + 1;
        H.n = Object.keys(H.seats).length;
        if (H.phase !== "exam") log(`К банде присоединился(ась) ${nick}. Пульт — со следующего сейфа.`, "info");
      }
      const seat = H.seats[pid];
      // значения пультов принимаем только для текущей «версии» уровня: после сброса старые значения не возвращаются
      const ctl = pr.ctl;
      if (live && seat !== undefined && ctl && typeof ctl === "object" && ctl.vv === H.vv && ctl.w && typeof ctl.w === "object") {
        for (const rid of Object.keys(ctl.w)) if (H.asg[rid] === seat && setValue(rid, ctl.w[rid], pid)) changed = true;
      }
      // действия идут очередью из последних нажатий, чтобы два быстрых нажатия не слились в одно
      const acts = Array.isArray(pr.acts) ? pr.acts.filter(a => a && typeof a === "object" && Number.isFinite(a.s)).slice(-8).sort((x, y) => x.s - y.s) : [];
      if (H.seqs[pid] === undefined) H.seqs[pid] = acts.length ? acts[acts.length - 1].s : 0;
      else for (const a of acts) {
        if (a.s <= H.seqs[pid]) continue;
        H.seqs[pid] = a.s;
        if (H.phase === "play" && typeof a.r === "string" && H.asg[a.r] === seat && typeof a.t === "string") doAction(a.r, a.t, typeof a.d === "string" ? a.d : null, pid);
      }
      const ex = pr.ex;
      if (H.phase === "exam" && H.exam && ex && typeof ex === "object" && ex.cs === H.cs && ex.rd === H.round) {
        const n = Number.isInteger(ex.n) && ex.n > 0 && ex.n <= 10 ? ex.n : 3;
        const i = Number.isInteger(ex.i) ? Math.max(0, Math.min(n, ex.i)) : 0;
        const sc = Number.isInteger(ex.s) ? Math.max(0, Math.min(i, ex.s)) : 0;
        const pv = H.exam.scores[pid];
        if (!pv || pv.i !== i || pv.s !== sc || pv.nick !== nick) { H.exam.scores[pid] = { i, s: sc, n, nick }; examChanged = true; }
      }
    }
    const sig = o => Object.keys(o).sort().map(k => k + ":" + o[k].nick).join("|");
    const crewChanged = sig(next) !== sig(ONLINE);
    ONLINE = next;
    if (crewChanged && H.phase === "lobby") { reseat(); renderHost(); commit(); return; }
    if (crewChanged) {
      const t = now();
      Object.keys(H.seats).forEach(pid => { if (!ONLINE[pid]) H.lost[pid] = H.lost[pid] || t; else delete H.lost[pid]; });
      if (H.phase === "exam" || H.phase === "end") examChanged = true; else renderSide();
      pushHost(true);
    }
    if (examChanged) { renderHost(); commit(); }
    if (changed) { H.lastRes = curLevel().evaluate(H.V, H.aux); }
  }
  // роли того, кто пропал больше чем на 6 секунд, переходят к остальным
  setInterval(() => {
    if (MODE !== "host" || !H || H.solo || !["play", "intro"].includes(H.phase)) return;
    const t = now(), gone = Object.keys(H.lost).filter(pid => t - H.lost[pid] > 6000);
    if (!gone.length) return;
    const goneSeats = gone.map(pid => H.seats[pid]).filter(s => s !== undefined);
    const alive = Object.keys(H.seats).filter(pid => ONLINE[pid]).map(pid => H.seats[pid]);
    gone.forEach(pid => { delete H.lost[pid]; });
    if (!alive.length) return;
    let k = 0, moved = 0;
    Object.keys(H.asg).forEach(rid => { if (goneSeats.includes(H.asg[rid])) { H.asg[rid] = alive[k++ % alive.length]; moved++; } });
    if (moved) { H.vv++; log(`Кто-то отвалился — его пульты (${moved}) переданы банде.`, "info"); renderSide(); pushHost(true); }
  }, 1000);

  async function hostConnect() {
    CONN = "connecting"; CONN_WHY = ""; renderHost();
    const ns = await getRoomNs();
    if (MODE !== "host") return;
    if (!ns) { CONN = "off"; CONN_WHY = whyNoRoom(); if (H.phase === "lobby") H.solo = true; renderHost(); return; }
    await leaveRoom();
    if (MODE !== "host") return;
    ROOM = ns;
    roomUnsub.push(ns.onPeers(ch => hostOnPeers(ch.peers), e => { ROOM = null; CONN = "off"; CONN_WHY = errWhy(e); renderHost(); }));
    roomUnsub.push(ns.onConnection(c => { if (CONN !== "off") { const was = CONN; CONN = c ? "on" : "wait"; if (was !== CONN) { if (LAN && H && H.phase === "lobby") renderHost(); else updateHud(); } } }));
    CONN = ns.connected() ? "on" : "wait";
    pushHost(true);
    renderHost();
  }

  // ---------- вид большого экрана ----------
  function hudHTML() {
    const ci = caseOf(H.cs);
    const live = ["intro", "play", "win", "debrief"].includes(H.phase);
    const L = live ? curLevel() : null;
    return `<header class="h-top" id="hud">
<div class="h-brand"><b>${ci.title}</b><small>${live ? `${stageLabel(H.cs, H.old, H.lv)} · ${esc(L.place)}` : `Дело №${ci.no} · ${ci.subject}`}</small></div>
<div class="h-code">Код <b>${esc(H.code)}</b>${LAN && lanAddr() ? `<span class="h-addr">${esc(lanAddr().addr)}</span>` : ""}</div>
<div class="h-conn"><span class="led" id="hud-led"></span><span id="hud-conn"></span></div>
${live ? `<div class="h-meter"><span>Тревога</span><div class="meter alarm"><i id="hud-al"></i></div><b id="hud-alv"></b></div>
<div class="h-meter"><span>Шум</span><div class="meter noise"><i id="hud-nz"></i></div></div>
<div class="h-timer" id="hud-timer" aria-label="Время на сейф">—:—</div>` : ""}
<div class="h-btns"><button class="btn" data-act="music" aria-pressed="${UI.musicOn}">${UI.musicOn ? "♪ Музыка" : "♪ Выкл"}</button><input type="range" id="vol" min="0" max="100" value="${Math.round(UI.vol * 100)}" aria-label="Громкость">${document.fullscreenEnabled ? `<button class="btn" data-act="fullscreen">На весь экран</button>` : ""}<button class="btn btn-ghost" data-act="exit">Выйти</button></div>
</header>`;
  }
  function updateHud() {
    if (MODE !== "host" || !H) return;
    const $ = id => document.getElementById(id);
    const conn = { idle: ["", "подключаем…"], connecting: ["", "подключаем…"], on: ["on", "пульты на связи"], wait: ["", "переподключаем…"], off: ["off", H.solo ? "один экран" : "без связи"] }[CONN];
    if ($("hud-led")) { $("hud-led").className = "led " + conn[0]; $("hud-conn").textContent = conn[1]; }
    if ($("hud-al")) { $("hud-al").style.width = pct(H.alarm) + "%"; $("hud-alv").textContent = pct(H.alarm) + "%"; }
    if ($("hud-nz")) $("hud-nz").style.width = pct(H.noise) + "%";
    const tm = $("hud-timer");
    if (tm) {
      if (H.phase === "play" && H.aux) { const L = curLevel(), left = L.par * 1000 - elapsed(); tm.textContent = left >= 0 ? fmtTime(left) : "+" + fmtTime(-left); tm.classList.toggle("over", left < 0); }
      else tm.textContent = "—:—";
    }
  }
  function goalsHTML(res) {
    return `<ul class="goals">${res.goals.filter(g => !g.hidden).map(g => { const ok = g.ok || (H.aux && H.aux.latched[g.id]); return `<li class="${ok ? "ok" : ""}"><span class="gk">${ok ? "✓" : "○"}</span>${esc(g.label)}</li>`; }).join("")}</ul>`;
  }
  function crewRolesHTML() {
    const roles = roleDefs();
    return `<ul class="roster">${roles.map(r => { const s = H.asg[r.id]; return `<li style="--pc:${H.solo ? roleColor(r.id) : seatColor(s)}"><span class="pchip"></span><b>${esc(r.name)}</b><span class="muted">${H.solo ? "" : esc(nickOfSeat(s))}</span></li>`; }).join("")}</ul>`;
  }
  function sideHTML() {
    const L = curLevel(), res = H.lastRes || L.evaluate(H.V, H.aux), st = H.stats[H.lv];
    const confirm = UI.confirmReveal ? `<div class="confirm"><p>Подсмотреть ответ? Тревога +25%, а добыча за этот сейф сгорит.</p><div class="actions"><button class="btn btn-alarm" data-act="reveal-yes">Показать ответ</button><button class="btn" data-act="reveal-no">Отмена</button></div></div>` : "";
    let chain = "";
    if (L.kind === "proof") {
      const a = H.aux;
      chain = `<div class="chain"><h3>Цепочка доказательства</h3>${a.placed.length ? `<ol class="proof">${a.placed.map(s => `<li><b>${L.canon[s]}</b><span>${L.cardText(L.canon[s])}</span></li>`).join("")}</ol>` : `<p class="muted">Пока пусто. Первый шаг вводит обозначения.</p>`}${a.burned.length ? `<p class="muted">Сожжено: ${a.burned.join(", ")}</p>` : ""}</div>`;
    }
    return `<div class="side-in">
<span class="eyebrow">${stageLabel(H.cs, H.old, H.lv)} · ${esc(L.topic)}</span>
<h2>${L.title}</h2>
<div class="goal"><span>Цель</span><p>${L.goal}</p></div>
${goalsHTML(res)}
${chain}
${UI.hint ? `<div class="hint"><span>Подсказка</span><p>${L.hint}</p></div>` : ""}
<div class="side-sec"><h3>Пульты</h3>${crewRolesHTML()}</div>
<div class="side-sec"><h3>События</h3><ul class="evlog">${H.log.slice(0, 5).map(x => `<li class="${x.k}">${esc(C.stripTags(x.m))}</li>`).join("") || `<li class="muted">Пока тихо.</li>`}</ul></div>
<div class="tools"><button class="btn" data-act="hint"${UI.hint || H.phase !== "play" ? " disabled" : ""}>Подсказка · +8%</button><button class="btn" data-act="reveal"${H.phase !== "play" ? " disabled" : ""}>Подсмотреть</button><button class="btn" data-act="pause"${H.phase !== "play" ? " disabled" : ""}>${H.pausedAt ? "Продолжить" : "Пауза"}</button></div>
${confirm}
${st ? `<p class="muted small">Поймали: ${st.caught} · ошибок: ${st.bad} · сирен: ${st.sirens}</p>` : ""}
</div>`;
  }
  let sideQueued = false;
  function renderSide() {
    if (MODE !== "host" || !H || !["intro", "play", "win", "debrief"].includes(H.phase)) return;
    if (sideQueued) return;
    sideQueued = true;
    requestAnimationFrame(() => {
      sideQueued = false;
      const el = document.getElementById("side");
      if (el) el.innerHTML = sideHTML();
      if (H.solo) renderSoloControls(false);
    });
  }
  function introHTML() {
    const L = curLevel(), roles = roleDefs();
    return `<div class="ovl-card"><span class="eyebrow">${stageLabel(H.cs, H.old, H.lv)} · ${esc(L.place)}${L.old ? " · повторение" : ""}</span>
<h2>${L.title}</h2><p class="story">${L.story}</p><div class="goal"><span>Цель</span><p>${L.goal}</p></div>
<div class="intro-roles">${roles.map(r => `<div class="ir" style="--pc:${H.solo ? roleColor(r.id) : seatColor(H.asg[r.id])}"><span class="pchip"></span><div><b>${esc(r.name)}</b><small>${H.solo ? esc(r.desc) : esc(nickOfSeat(H.asg[r.id]))}</small></div></div>`).join("")}</div>
<div class="actions"><button class="btn btn-gold btn-big" data-act="go">Поехали</button></div>
<p class="muted small">Охрана обходит здание: ${roles.some(r => r.id === "look") ? "сторож увидит её заранее и крикнет «Шухер!»" : "услышите шаги и музыка стихнет"}. Кто крутит пульт, когда она смотрит, — шумит.</p></div>`;
  }
  function debriefHTML() {
    const L = curLevel(), st = H.stats[H.lv] || {};
    const last = H.lv >= NST() - 1;
    const nextLabel = !last ? `Дальше: ${C.getLevel(H.cs, H.code, H.round, H.lv + 1, H.old).title.toLowerCase()}` : caseOf(H.cs).examN && !H.solo ? "Уходим. Дальше — допрос" : "Уходим с добычей";
    return `<div class="ovl-card wide"><span class="eyebrow">${esc(L.topic)} · ${fmtTime(st.time || 0)} · поймали ${st.caught || 0} · ошибок ${st.bad || 0}</span>
<h2 class="win">${st.revealed ? "Замок открыт подсказкой" : L.win} <span class="loot-inline">+${st.loot || 0}</span></h2>
<div class="konspekt"><h3>Конспект</h3>${L.debrief(H.V, H.aux)}${L.bridge || ""}</div>
<div class="actions"><button class="btn btn-gold btn-big" data-act="next">${nextLabel}</button></div></div>`;
  }
  function gameHTML() {
    const ph = H.phase;
    const ovl = ph === "intro" ? introHTML() : ph === "debrief" ? debriefHTML() : H.pausedAt ? `<div class="ovl-card"><h2>Пауза</h2><p class="muted">Охрана тоже ждёт.</p><div class="actions"><button class="btn btn-gold" data-act="pause">Продолжить</button></div></div>` : "";
    return `<div class="host game${H.solo ? " is-solo" : ""}">${hudHTML()}
<div class="g-main"><div class="stage-wrap"><canvas id="stage" aria-label="Сцена ограбления"></canvas><div id="ovl" class="${ovl ? "on" : ""}">${ovl}</div></div>
<aside id="side" class="side">${sideHTML()}</aside></div>
${H.solo ? `<section id="solo" class="solo-ctl" aria-label="Пульты на большом экране"></section>` : ""}
</div>`;
  }
  // решённую задачу больше не трогают: её пульт гаснет
  const solvedRole = (px, rid) => !!(px && px.lk && px.lk.includes(rid));
  function soloEnv(r) {
    const L = curLevel(), px = publicAux();
    return { color: roleColor(r.id), disabled: H.phase !== "play" || solvedRole(px, r.id), theory: L.theory, px, cardText: L.cardText };
  }
  function renderSoloControls(full) {
    const el = document.getElementById("solo");
    if (!el || !H.solo) return;
    if (full || !el.childElementCount) el.innerHTML = `<h3 class="eyebrow">Пульты банды — играете на одном экране</h3><div class="solo-grid">${roleDefs().filter(r => r.id !== "look" && !/^know/.test(r.id)).map(r => Wd.roleHTML(r, H.V[r.id], soloEnv(r))).join("")}</div>`;
    else roleDefs().forEach(r => { if (document.getElementById("role-" + r.id)) Wd.update(el, r, H.V[r.id], soloEnv(r)); });
  }
  function lanJoinHTML() {
    const a = lanAddr();
    const url = a ? `http://${a.addr}/#j=${H.code}` : "";
    let qr = "";
    try { if (url && window.QR) qr = window.QR.svg(url, `QR-код для входа с телефона, код ${H.code}`); } catch (e) { qr = ""; }
    const others = a ? LANI.ips.filter(ip => ip !== a.ip) : [];
    return `<div class="lan">${qr ? `<div class="lan-qr">${qr}</div>` : ""}<div class="lan-txt">
<p class="story">Телефоны подключаются к той же Wi‑Fi сети, что и ноутбук, и наводят камеру на QR-код. Можно и вручную: открыть адрес в браузере и ввести код.</p>
${a ? `<p class="lan-url">http://${esc(a.addr)}</p>` : `<p class="fb bad">Ноутбук не подключён ни к одной сети. Включите мобильный хот-спот: Параметры → Сеть и Интернет → Мобильный хот-спот.</p>`}
${others.length ? `<p class="muted small">Не открывается? Другие адреса ноутбука: ${others.map(ip => `<button type="button" class="linkish" data-act="lan-ip" data-ip="${esc(ip)}">${esc(ip)}</button>`).join(", ")}</p>` : ""}
<details class="lan-help"><summary>Телефон не открывает страницу</summary><ul class="hints">
<li>Телефон подключён к той же сети, что и ноутбук. Надёжнее всего — к хот-споту ноутбука.</li>
<li>Windows при первом запуске спрашивает про брандмауэр: разрешите Python и в частных, и в общественных сетях.</li>
<li>На телефоне выключены мобильный интернет и VPN.</li>
<li>В университетском Wi‑Fi устройства часто не видят друг друга — включите хот-спот на ноутбуке.</li></ul></details>
</div></div>`;
  }
  function lobbyHTML() {
    const ci = caseOf(H.cs);
    const conn = CONN === "off"
      ? `<div class="confirm"><p><b>Телефоны не смогут подключиться.</b> ${esc(whyText(CONN_WHY))}</p><p class="muted">Пока можно играть на одном экране: все пульты будут под сценой.</p></div>`
      : LAN && CONN === "wait"
        ? `<div class="confirm"><p><b>Нет связи с сервером игры.</b> Проверьте, что на ноутбуке не закрыто окно bazis_server.py, — связь восстановится сама.</p></div>`
        : `<p class="muted">Телефоны садятся за стол автоматически. На каждом сейфе роли раздаются заново.</p>`;
    const picks = C.CASE_IDS.map(id => { const c = caseOf(id); return `<button type="button" class="opt${id === H.cs ? " on" : ""}" data-act="pick-case" data-cs="${id}" aria-pressed="${id === H.cs}">№${c.no} · ${c.title}${c.test ? " · тест" : ""}</button>`; }).join("");
    const crew = Object.entries(H.seats).sort((a, b) => a[1] - b[1]).map(([pid, s]) => `<li style="--pc:${seatColor(s)}"><span class="pchip"></span><span class="who">${esc(ONLINE[pid] ? ONLINE[pid].nick : H.nicks[pid] || "Игрок")}<small>${C.nickFlavor(s)}</small></span><span class="state"><span class="led ${ONLINE[pid] ? "on" : "off"}"></span>${ONLINE[pid] ? "в сети" : "отошёл"}</span></li>`).join("");
    return `<div class="host">${hudHTML()}
<div class="h-main"><div class="h-side"><figure class="l-plan">${planSVG(H.cs, H.old, -1, "lobby")}</figure></div>
<div class="h-side"><section class="panel" aria-labelledby="lobby-h">
<span class="eyebrow">Сбор банды</span><h2 id="lobby-h">Код комнаты</h2><div class="bigcode">${esc(H.code)}</div>
${LAN ? lanJoinHTML() : `<p class="story">На телефонах откройте эту же ссылку, нажмите «Я с телефона» и введите код. Телефон станет пультом: у каждого своя часть механизма.</p>`}
<div class="chg"><span class="eyebrow">Дело</span><div class="opts">${picks}</div></div>
<p class="muted">${ci.blurb}</p>
${ci.hasOld ? `<label class="check"><input type="checkbox" id="old" ${H.old ? "checked" : ""}><span>Начать со старого замка из дела №1: разминка и повторение</span></label>` : ""}
${conn}
<h3>За столом: ${H.n}</h3>
${crew ? `<ul class="crew">${crew}</ul>` : `<p class="muted">Пока никого. Как только телефон введёт код, он появится здесь.</p>`}
<ul class="rules"><li>Считайте на бумаге: сцена показывает ход механизма только после верного ответа.</li><li>Охрана ходит часто, предупреждает за 3 секунды. Кто трогает пульт, когда она смотрит, — пойман: тревога +20%.</li><li>Неверный ответ шумит: охрана прибегает сразу, без предупреждения. Подсказки тоже поднимают тревогу. 100% — сирена, и у сейфа новые числа.</li>${ci.examN ? `<li>В конце допрос: каждому по ${ci.examN} вопроса. Доля верных ответов — доля добычи, которую банда сохранит.</li>` : ""}</ul>
<label class="check"><input type="checkbox" id="solo" ${H.solo ? "checked" : ""}><span>Играть на одном экране: все пульты под сценой, без допроса</span></label>
<div class="actions">${Number.isInteger(H.resumeLv) ? `<button class="btn btn-gold btn-big" data-act="resume-level">Продолжить: ${stageLabel(H.cs, H.old, H.resumeLv).toLowerCase()}</button><button class="btn" data-act="start">Начать дело заново</button>` : `<button class="btn btn-gold btn-big" data-act="start">Начать дело</button>`}</div>
</section></div></div></div>`;
  }
  function examPanelHTML() {
    const ci = caseOf(H.cs);
    let correct = 0, total = 0;
    Object.values(H.exam.scores).forEach(r => { correct += r.s; total += r.i; });
    const rows = Object.entries(H.seats).sort((a, b) => a[1] - b[1]).map(([pid, s]) => {
      const r = H.exam.scores[pid], nick = ONLINE[pid] ? ONLINE[pid].nick : H.nicks[pid] || "Игрок";
      const st = !r ? `<span class="state"><span class="led"></span>ещё не начал</span>` : r.i < r.n ? `<span class="state"><span class="led on"></span>отвечает: ${r.i} из ${r.n}</span>` : `<span class="state ok-state">готово: ${r.s} из ${r.n}</span>`;
      return `<li style="--pc:${seatColor(s)}"><span class="pchip"></span><span class="who">${esc(nick)}</span>${st}</li>`;
    }).join("");
    const confirm = UI.confirmFinish ? `<div class="confirm"><p>${total === 0 ? "Ещё никто не ответил. Если подвести итоги сейчас, допрос не повлияет на добычу." : "Не все закончили. Вопросы без ответа не войдут в расчёт."}</p><div class="actions"><button class="btn btn-alarm" data-act="finish">Подвести итоги</button><button class="btn" data-act="finish-no">Подождать</button></div></div>` : "";
    return `<div class="host">${hudHTML()}<div class="h-main"><div class="h-side"><figure class="l-plan">${planSVG(H.cs, H.old, NST(), "exam")}</figure></div><div class="h-side"><section class="panel">
<span class="eyebrow">Допрос · ${ci.examN} вопроса каждому</span><h2>Каждого допрашивают поодиночке</h2>
<p class="story">На телефонах появились вопросы — у каждого свои числа. Отвечайте молча, без подсказок банды. Какую долю ответов банда даст верно, такую долю добычи и сохранит.</p>
<ul class="crew">${rows}</ul><p class="loot-line">Верных ответов: <b>${correct} из ${total}</b></p>
<div class="actions"><button class="btn btn-gold" data-act="finish">Подвести итоги</button></div>${confirm}</section></div></div></div>`;
  }
  function finalize() {
    const base = H.stats.reduce((s, st) => s + (st ? st.loot : 0), 0), max = 120 * NST();
    let correct = 0, total = 0;
    if (H.exam) Object.values(H.exam.scores).forEach(r => { correct += r.s; total += r.i; });
    const mult = total > 0 ? correct / total : 1;
    H.final = { base, max, correct, total, mult, loot: Math.round(base * mult) };
    H.phase = "end"; UI.confirmFinish = false;
    MU.setMode("lobby"); MU.sting("win");
  }
  function endHTML() {
    const ci = caseOf(H.cs), F = H.final;
    const ratio = F.max ? F.loot / F.max : 0;
    const title = ratio >= 0.85 ? "Профессора криминальной математики" : ratio >= 0.62 ? "Опытная банда" : ratio >= 0.35 ? "Банда подаёт надежды" : "Банду спас адвокат";
    const rows = H.stats.map((st, i) => { const L = C.getLevel(H.cs, H.code, H.round, i, H.old); return `<tr><td>${L.old ? "Старый замок · " : ""}${L.title}</td><td class="n">${fmtTime(st.time)}</td><td class="n">${st.caught}</td><td class="n">${st.bad}</td><td class="n">${st.hints}</td><td class="n">${st.revealed ? "—" : st.loot}</td></tr>`; }).join("");
    const people = H.exam ? Object.values(H.exam.scores).filter(r => r.i > 0).map(r => `<span class="tag">${esc(r.nick)}: ${r.s} из ${r.i}</span>`).join("") : "";
    return `<div class="host">${hudHTML()}<div class="h-main"><div class="h-side"><figure class="l-plan">${planSVG(H.cs, H.old, NST(), "end")}</figure></div><div class="h-side"><section class="panel">
<span class="eyebrow">Дело №${ci.no} закрыто · раунд ${H.round}</span><h2 class="win">${title}</h2>
<div class="loot"><b>${F.loot}</b><span>слитков из ${F.max}</span></div>
${F.total > 0 ? `<p>Допрос: верных ответов <b>${F.correct} из ${F.total}</b>, поэтому банда сохраняет ${Math.round(F.mult * 100)}% добычи: ${F.base} → ${F.loot}.</p>` : ci.examN && !H.solo ? `<p class="muted">Допрос не состоялся, добыча засчитана целиком.</p>` : ""}
${people ? `<div class="tags">${people}</div>` : ""}
<div class="tablewrap"><table class="res"><thead><tr><th>Сейф</th><th>Время</th><th>Поймали</th><th>Ошибки</th><th>Подсказки</th><th>Слитки</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">За сейф: 100, минус 12 за каждую поимку, 8 за ошибку, 10 за подсказку и сирену, плюс до 20 за скорость. Подсмотренный ответ — 0.</p>
<div class="actions"><button class="btn btn-gold" data-act="newcase">Новая игра с теми же телефонами</button><button class="btn" data-act="exit">В меню</button></div></section></div></div></div>`;
  }
  let stageRO = null;
  function renderHost() {
    if (MODE !== "host" || !H) return;
    const ph = H.phase;
    if (["intro", "play", "win", "debrief"].includes(ph)) {
      app.innerHTML = gameHTML();
      const cv = document.getElementById("stage");
      R.attach(cv);
      try { if (window.ResizeObserver) { if (stageRO) stageRO.disconnect(); stageRO = new ResizeObserver(() => R.resize()); stageRO.observe(cv); } } catch (e) { stageRO = null; }
      if (H.solo) renderSoloControls(true);
    } else if (ph === "exam") app.innerHTML = examPanelHTML();
    else if (ph === "end") app.innerHTML = endHTML();
    else app.innerHTML = lobbyHTML();
    updateHud();
  }

  function hostAct(act, el) {
    switch (act) {
      case "start":
        reseat();
        if (H.n === 0) H.solo = true;
        H.alarm = 0; H.stats = []; H.exam = null; H.final = null; H.resumeLv = null;
        startLevel(0); break;
      case "resume-level": {
        if (!Number.isInteger(H.resumeLv)) break;
        const lv = Math.min(H.resumeLv, NST() - 1);
        H.resumeLv = null;
        reseat();
        if (H.n === 0) H.solo = true;
        startLevel(lv); break;
      }
      case "go": if (H.phase === "intro") go(); break;
      case "pick-case": { const cs = C.caseOk(el.dataset.cs); if (H.phase === "lobby" && cs !== H.cs) { H.cs = cs; H.old = false; H.resumeLv = null; renderHost(); commit(); } break; }
      case "hint": if (H.phase === "play" && !UI.hint) { UI.hint = true; H.stats[H.lv].hints++; addAlarm(8); log("Взяли подсказку. Тревога +8%.", "info"); renderSide(); pushHost(true); } break;
      case "reveal": UI.confirmReveal = true; renderSide(); break;
      case "reveal-no": UI.confirmReveal = false; renderSide(); break;
      case "reveal-yes": {
        if (H.phase !== "play") break;
        const L = curLevel();
        Object.assign(H.V, clone(L.solution(H.aux)));
        if (L.solve) L.solve(H.aux);
        H.stats[H.lv].revealed = true; H.vv++; UI.confirmReveal = false;
        H.alarm = Math.min(95, H.alarm + 25);
        log("Ответ подсмотрели: механизмы выставлены правильно.", "info");
        renderSide(); pushHost(true); if (H.solo) renderSoloControls(true);
        break;
      }
      case "pause":
        if (H.phase !== "play") break;
        if (H.pausedAt) { const d = now() - H.pausedAt; H.pausedMs += d; H.guard.next += d; H.guard.until += d; H.pausedAt = 0; MU.setMode(H.guard.state === "check" ? "check" : "play"); }
        else { H.pausedAt = now(); MU.setMode("calm"); }
        renderHost(); commit(); break;
      case "next":
        if (H.phase !== "debrief") break;
        if (H.lv >= NST() - 1) {
          if (caseOf(H.cs).examN && !H.solo && H.n > 0) { H.phase = "exam"; H.exam = { scores: {} }; MU.setMode("calm"); renderHost(); commit(); }
          else { finalize(); renderHost(); commit(); }
        } else startLevel(H.lv + 1);
        break;
      case "finish": {
        let total = 0; Object.values(H.exam.scores).forEach(r => { total += r.i; });
        const pending = Object.values(H.exam.scores).some(r => r.i < r.n) || Object.keys(H.seats).some(pid => !H.exam.scores[pid]);
        if ((pending || total === 0) && !UI.confirmFinish) { UI.confirmFinish = true; renderHost(); break; }
        finalize(); renderHost(); commit(); break;
      }
      case "finish-no": UI.confirmFinish = false; renderHost(); break;
      case "lan-ip": if (LANI.ips.includes(el.dataset.ip)) { UI.lanIp = el.dataset.ip; renderHost(); } break;
      case "newcase": H = newHost(H, H.cs); reseat(); MU.setMode("lobby"); renderHost(); commit(); break;
      case "music": UI.musicOn = !UI.musicOn; MU.unlock(); MU.setEnabled(UI.musicOn); LS.set("bazis.audio", { on: UI.musicOn, vol: UI.vol }); el.textContent = UI.musicOn ? "♪ Музыка" : "♪ Выкл"; el.setAttribute("aria-pressed", UI.musicOn); break;
      case "fullscreen": try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => { }); } catch (e) { /* нет полноэкранного режима */ } break;
      default: return false;
    }
    return true;
  }
  function enterHost(resume, cs) {
    MODE = "host";
    MU.unlock();
    if (!resume || !H) H = newHost(null, cs);
    ONLINE = {}; CONN = "idle"; UI.confirmReveal = false; UI.confirmFinish = false;
    MU.setMode("lobby");
    renderHost(); hostConnect(); keepAwake();
    if (LAN) lanInfo(true);
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // Телефон
  // =====================================================================
  function tabPid() {
    let pid = null;
    try { pid = sessionStorage.getItem("bazis.pid"); } catch (e) { pid = null; }
    if (!pid || !PID_RE.test(pid)) { pid = randomPid(); try { sessionStorage.setItem("bazis.pid", pid); } catch (e) { /* id живёт до перезагрузки */ } }
    return pid;
  }
  function newPhone() {
    const s = LS.get("bazis.phone") || {};
    return { pid: tabPid(), nick: typeof s.nick === "string" ? cleanNick(s.nick) : "", code: typeof s.code === "string" ? s.code : "", step: "join", err: "", why: "", seen: [], peersN: 0, hs: null, hostPeer: null, hostMissing: false, hostGone: false, netDown: false, W: {}, wkey: "", skey: "", actSeq: 0, acts: [], msgQ: -1, guard: null, ex: null };
  }
  const savePhone = () => LS.set("bazis.phone", { nick: P.nick, code: P.code });

  function readHostState(pr) {
    const int = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : null);
    const cs = C.CASE_IDS.includes(pr.cs) ? pr.cs : "usadba", old = pr.old === 1;
    const lv = int(pr.lv, 0, C.stageCount(cs, old) - 1), rd = int(pr.rd, 1, 99999), n = int(pr.n, 0, 64), nL = int(pr.nL, 1, 64) || 1, vr = int(pr.vr, 0, 9999) || 0;
    const ph = ["lobby", "intro", "play", "win", "debrief", "exam", "end"].includes(pr.ph) ? pr.ph : null;
    if (lv === null || rd === null || n === null || ph === null) return null;
    const seats = {}, asg = {};
    if (pr.seats && typeof pr.seats === "object") for (const [k, v] of Object.entries(pr.seats)) if (k.length <= 24 && Number.isInteger(v) && v >= 0 && v < 64) seats[k] = v;
    if (pr.asg && typeof pr.asg === "object") for (const [k, v] of Object.entries(pr.asg)) if (k.length <= 24 && Number.isInteger(v) && v >= 0 && v < 64) asg[k] = v;
    const m = pr.msg && typeof pr.msg === "object" && Number.isInteger(pr.msg.q) ? { q: pr.msg.q, m: typeof pr.msg.m === "string" ? pr.msg.m.slice(0, 240) : "", k: ["ok", "bad", "info"].includes(pr.msg.k) ? pr.msg.k : "info" } : null;
    let fin = null;
    if (pr.fin && typeof pr.fin === "object") { const l = int(pr.fin.l, 0, 100000), mm = int(pr.fin.m, 1, 100000); if (l !== null && mm !== null) fin = { l, m: mm }; }
    const px = pr.px && typeof pr.px === "object" ? {
      pl: Array.isArray(pr.px.pl) ? pr.px.pl.filter(x => C.LETTERS.includes(x)) : [], bu: Array.isArray(pr.px.bu) ? pr.px.bu.filter(x => C.LETTERS.includes(x)) : [],
      ch: !!pr.px.ch, op: !!pr.px.op, lk: Array.isArray(pr.px.lk) ? pr.px.lk.filter(x => typeof x === "string").slice(0, 64) : [],
      wr: pr.px.wr && typeof pr.px.wr === "object" ? Object.fromEntries(Object.entries(pr.px.wr).filter(([k, x]) => k.length <= 24 && Number.isInteger(x) && x >= 0 && x < 1000).slice(0, 64)) : {},
    } : {};
    const gw = pr.gw && typeof pr.gw === "object" && Number.isInteger(pr.gw.id) && Number.isFinite(pr.gw.ms) ? { id: pr.gw.id, ms: Math.max(0, Math.min(10000, pr.gw.ms)) } : null;
    return { cs, old, lv, vr, rd, n, nL, ph, seats, asg, cv: pr.cv && typeof pr.cv === "object" ? pr.cv : {}, vv: Number.isInteger(pr.vv) ? pr.vv : 0, px, al: int(pr.al, 0, 100) || 0, nz: int(pr.nz, 0, 100) || 0, gw, gc: Number.isInteger(pr.gc) ? pr.gc : 0, msg: m, fin, solo: !!pr.solo };
  }
  const phLevel = () => C.getLevel(P.hs.cs, P.code, P.hs.rd, P.hs.lv, P.hs.old, P.hs.vr);
  const mySeat = () => (P.hs && Number.isInteger(P.hs.seats[P.pid]) ? P.hs.seats[P.pid] : -1);
  let phRolesMemo = { key: "", roles: [] };
  function myRoles() {
    const s = mySeat(), hs = P.hs;
    if (s < 0 || !hs) return [];
    const key = `${hs.cs}|${hs.old}|${P.code}|${hs.rd}|${hs.lv}|${hs.vr}|${hs.nL}`;
    if (phRolesMemo.key !== key) phRolesMemo = { key, roles: phLevel().roles(hs.nL) };
    return phRolesMemo.roles.filter(r => hs.asg[r.id] === s);
  }
  function phoneOnPeers(peers) {
    if (MODE !== "phone" || !P || P.step !== "online") return;
    const hosts = [], seen = [];
    for (const p of peers) {
      const pr = p.presence || {};
      if (pr.app !== "bazis" || p.sameTab || pr.host !== true || typeof pr.code !== "string" || !/^\d{4}$/.test(pr.code)) continue;
      if (pr.code === P.code) hosts.push(p); else if (!seen.includes(pr.code)) seen.push(pr.code);
    }
    // для подсказок на экране «не нашли»: сколько вообще устройств рядом и какие коды у других больших экранов
    P.seen = seen.slice(0, 4); P.peersN = peers.filter(p => !p.sameTab).length;
    const h = hosts.find(p => p.peer === P.hostPeer) || hosts[0];
    const hs = h ? readHostState(h.presence) : null;
    if (hs) { P.hostPeer = h.peer; P.hostMissing = false; P.hostGone = false; onHostState(hs); }
    else { if (P.hs) P.hostGone = true; renderPhone(); }
  }
  function onHostState(hs) {
    const prev = P.hs;
    P.hs = hs;
    const live = ["intro", "play", "win", "debrief"].includes(hs.ph);
    if (live) {
      const roles = myRoles();
      const wkey = `${hs.cs}|${hs.old}|${hs.rd}|${hs.lv}|${hs.vr}|${hs.vv}|${roles.map(r => r.id).join(",")}`;
      if (wkey !== P.wkey) {
        P.wkey = wkey;
        const W = {};
        roles.forEach(r => { const v = hs.cv[r.id]; W[r.id] = v && C.sanitizeRoleVal(r, v) ? clone(v) : clone(r.init || {}); });
        P.W = W;
        if (roles.length && (!prev || prev.lv !== hs.lv || prev.rd !== hs.rd)) vib(40);
        pushCtl(true);
      }
    }
    if (hs.msg && hs.msg.q !== P.msgQ) { if (P.msgQ >= 0 && hs.msg.m && live) { showToast(hs.msg.m, hs.msg.k === "bad" ? "alarm" : hs.msg.k === "ok" ? "ok" : "gold"); if (hs.msg.k === "bad") vib([80, 50, 80]); } P.msgQ = hs.msg.q; }
    if (hs.gw && (!P.guard || P.guard.id !== hs.gw.id)) { P.guard = { id: hs.gw.id, at: Date.now() + hs.gw.ms }; if (myRoles().some(r => r.id === "look")) vib([200, 100, 200, 100, 200]); }
    if (hs.gc && (!prev || prev.gc !== hs.gc)) vib(120);
    if (hs.ph === "exam" && (!prev || prev.ph !== "exam")) { examState(); pushExam(); vib([60, 40, 60]); }
    if (hs.ph === "win" || hs.ph === "debrief") saveHomework(hs);
    renderPhone();
  }
  // домашка: какие задачи достались этому телефону за игру; в конце — все с решениями
  const hwKey = hs => `${P.code}|${hs.rd}|${hs.cs}`;
  function saveHomework(hs) {
    const s = mySeat();
    if (s < 0 || s >= hs.nL || !phLevel().homework) return;
    const cur = LS.get("bazis.hw"), key = hwKey(hs);
    const hw = cur && cur.key === key && cur.items && typeof cur.items === "object" ? cur : { key, items: {} };
    if (hw.items[hs.lv]) return;
    hw.items[hs.lv] = { old: hs.old ? 1 : 0, vr: hs.vr, s };
    LS.set("bazis.hw", hw);
  }
  function homeworkHTML(hs) {
    const hw = LS.get("bazis.hw");
    if (!hw || hw.key !== hwKey(hs) || !hw.items || typeof hw.items !== "object") return "";
    const parts = Object.keys(hw.items).map(Number).filter(lv => Number.isInteger(lv)).sort((a, b) => a - b).map(lv => {
      const it = hw.items[lv], L = Number.isInteger(it.s) ? C.getLevel(hs.cs, P.code, hs.rd, lv, it.old === 1, it.vr | 0) : null;
      return L && L.homework ? `<article class="hw"><h3>${esc(L.title)}</h3>${L.homework(it.s)}</article>` : "";
    }).join("");
    return parts ? `<div class="ph-box konspekt"><h3 class="eyebrow ok-text">Домашка — перепиши в тетрадь</h3>${parts}</div>` : "";
  }
  let ctlQueued = false;
  function pushCtl(now_) {
    if (!ROOM || !P || P.step !== "online") return;
    if (!now_) { if (ctlQueued) return; ctlQueued = true; setTimeout(() => { ctlQueued = false; pushCtl(true); }, 60); return; }
    ROOM.presence({ ctl: { vv: P.hs ? P.hs.vv : 0, w: P.W } }).catch(() => { /* связь восстановится */ });
  }
  function pushAct(rid, type, data) {
    if (!ROOM || !P) return;
    P.actSeq = Math.max(P.actSeq + 1, Date.now());
    const a = { s: P.actSeq, r: rid, t: type };
    if (typeof data === "string" && data) a.d = data.slice(0, 4);
    P.acts = (P.acts || []).concat([a]).slice(-6);
    // значения пультов — вместе с нажатием: «Проверить» должен видеть последнюю набранную цифру
    ROOM.presence({ ctl: { vv: P.hs ? P.hs.vv : 0, w: P.W }, acts: P.acts }).catch(() => { /* связь восстановится */ });
    vib(25);
  }
  async function phoneJoin() {
    P.step = "connecting"; P.err = ""; P.why = ""; renderPhone(true); keepAwake();
    const ns = await getRoomNs();
    if (MODE !== "phone") return;
    if (!ns) { P.step = "nolink"; P.why = whyNoRoom(); renderPhone(true); return; }
    await leaveRoom();
    if (MODE !== "phone") return;
    ROOM = ns;
    P.step = "online"; P.hs = null; P.hostPeer = null; P.hostMissing = false; P.hostGone = false; P.wkey = ""; P.skey = ""; P.seen = []; P.peersN = 0;
    P.netDown = LAN ? !ns.connected() : false;
    roomUnsub.push(ns.onPeers(ch => phoneOnPeers(ch.peers), e => { ROOM = null; if (MODE === "phone") { P.step = "nolink"; P.why = errWhy(e); renderPhone(true); } }));
    // в локальной сети показываем, когда пропала связь с ноутбуком: она вернётся сама
    if (LAN) roomUnsub.push(ns.onConnection(c => { if (MODE !== "phone" || !P) return; const was = P.netDown; P.netDown = !c; if (was !== P.netDown) renderPhone(true); }));
    try {
      await ns.presence({ app: "bazis", role: "phone", host: null, code: P.code, pid: P.pid, nick: P.nick, acts: P.acts || [] });
    } catch (e) {
      if (MODE === "phone") { await leaveRoom(); P.step = "nolink"; P.why = errWhy(e); renderPhone(true); }
      return;
    }
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (MODE === "phone" && P.step === "online" && !P.hs) { P.hostMissing = true; renderPhone(true); } }, 8000);
    renderPhone(true);
  }

  // ---------- допрос на телефоне ----------
  function examState() {
    const key = `${P.code}|${P.hs.rd}|${P.hs.cs}`;
    if (!P.ex || P.ex.key !== key) {
      const saved = LS.get("bazis.exam");
      const res = saved && saved.key === key && Array.isArray(saved.res) ? saved.res.filter(r => r && typeof r.ok === "boolean").slice(0, 10) : [];
      P.ex = { key, res, fb: false };
    }
    return P.ex;
  }
  const examQs = () => C.getExam(P.hs.cs, P.code, P.hs.rd, P.pid);
  function pushExam() {
    if (!ROOM || !P || P.step !== "online" || !P.hs) return;
    const ex = examState(), n = examQs().length;
    ROOM.presence({ ex: { cs: P.hs.cs, rd: P.hs.rd, i: ex.res.length, s: ex.res.filter(x => x.ok).length, n } }).catch(() => { /* связь восстановится */ });
  }
  function exAnswerHTML(q) {
    const inp = UI.exInput && UI.exInput.key === examState().key + "|" + examState().res.length ? UI.exInput : (UI.exInput = { key: examState().key + "|" + examState().res.length, vals: q.fields.map(() => ""), active: 0, msg: "" });
    const fl = q.fields.map((f, i) => `<button type="button" class="fld${i === inp.active ? " on" : ""}" data-x="fld" data-i="${i}"><small>${f.l}</small><b>${esc((inp.vals[i] || "").replace("-", MINUS))}</b></button>`).join("");
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "neg", "0", "del"].map(k => `<button type="button" class="key" data-x="key" data-k="${k}" aria-label="${k === "neg" ? "Сменить знак" : k === "del" ? "Стереть" : k}">${k === "neg" ? "±" : k === "del" ? "⌫" : k}</button>`).join("") + (q.fields.length > 1 ? `<button type="button" class="key wide" data-x="key" data-k="next">Следующее поле →</button>` : "");
    return `<div class="answer"><div class="answer-row"><div class="fields">${fl}</div><div class="keys">${keys}</div></div>${inp.msg ? `<p class="fb bad">${esc(inp.msg)}</p>` : ""}<div class="submit-row"><button type="button" class="btn btn-gold" data-x="submit">Ответить</button></div></div>`;
  }
  function exKey(k) {
    const inp = UI.exInput; if (!inp) return;
    const n = inp.vals.length;
    if (k === "next") inp.active = (inp.active + 1) % n;
    else {
      let v = inp.vals[inp.active] || "";
      if (/^[0-9]$/.test(k)) { const neg = v.startsWith("-"); let d = neg ? v.slice(1) : v; if (d === "0") d = ""; if (d.length < 3) d += k; v = (neg ? "-" : "") + d; }
      else if (k === "neg") v = v.startsWith("-") ? v.slice(1) : "-" + v;
      else if (k === "del") v = v.slice(0, -1);
      inp.vals[inp.active] = v;
    }
    inp.msg = ""; renderPhone(true);
  }
  function exSubmit() {
    const ex = examState(), qs = examQs(), q = qs[ex.res.length], inp = UI.exInput;
    if (!q || !inp) return;
    if (!inp.vals.every(s => /^-?\d{1,3}$/.test(s))) { inp.msg = "Заполните все поля."; renderPhone(true); return; }
    const vals = inp.vals.map(s => parseInt(s, 10) || 0);
    const r = q.check(vals);
    ex.res.push({ ok: !!r.ok, msg: r.msg || "" }); ex.fb = true;
    LS.set("bazis.exam", { key: ex.key, res: ex.res });
    UI.exInput = null; pushExam(); vib(r.ok ? 50 : [70, 50, 70]);
    renderPhone(true); window.scrollTo(0, 0);
  }
  function examView() {
    const ex = examState(), qs = examQs(), n = qs.length, done = ex.res.length;
    const head = phoneHead(`<div class="ph-meta"><b>Допрос</b>${done < n ? `вопрос ${Math.min(done + (ex.fb ? 0 : 1), n)} из ${n}` : "готово"}</div>`);
    if (ex.fb) {
      const k = done - 1, q = qs[k], r = ex.res[k];
      return `<div class="phone">${head}<div class="ph-box"><span class="eyebrow">Вопрос ${k + 1} из ${n} · ${q.title}</span><h2 class="${r.ok ? "win" : "alarm-h"}">${r.ok ? "✓ Верно" : "✗ Неверно"}</h2>${r.msg ? `<p>${esc(r.msg)}</p>` : ""}
<div class="konspekt"><div class="q">${q.html}</div><p class="muted">Ответ: ${C.tup(q.answer)}</p>${q.explain}</div><button class="btn btn-gold" data-x="exnext">${done < n ? "Следующий вопрос" : "Итоги допроса"}</button></div></div>`;
    }
    if (done < n) { const q = qs[done]; return `<div class="phone">${head}<div class="ph-box"><span class="eyebrow">Вопрос ${done + 1} из ${n} · отвечай молча</span><h2>${q.title}</h2><div class="q">${q.html}</div>${exAnswerHTML(q)}</div></div>`; }
    const s = ex.res.filter(x => x.ok).length;
    return `<div class="phone">${head}<div class="ph-box"><span class="eyebrow">Допрос окончен</span><h2>Верно: ${s} из ${n}</h2><ul class="traps">${qs.map((q, k) => `<li><b class="${ex.res[k] && ex.res[k].ok ? "win" : "alarm-h"}">${ex.res[k] && ex.res[k].ok ? "✓" : "✗"}</b><span>${q.title}: ${C.tup(q.answer)}</span></li>`).join("")}</ul><p class="muted">Ждём остальных: итоги появятся на большом экране.</p></div></div>`;
  }

  // ---------- вид телефона ----------
  function phoneHead(extra) {
    const s = mySeat(), nick = P.nick || "Игрок";
    return `<header class="ph-head" style="--pc:${s >= 0 ? seatColor(s) : "var(--ink-2)"}"><div class="ph-role"><span class="pchip"></span><div><b>${esc(nick)}</b><small>${s >= 0 ? `место ${s + 1} · ${C.nickFlavor(s)}` : "ждёт места"}</small></div></div>${extra || ""}</header>${P.hs ? `<div class="ph-meters"><div class="ph-alarm" role="meter" aria-label="Тревога" aria-valuenow="${P.hs.al}"><i id="ph-al" style="width:${P.hs.al}%"></i></div><div class="ph-noise" role="meter" aria-label="Шум" aria-valuenow="${P.hs.nz}"><i id="ph-nz" style="width:${P.hs.nz}%"></i></div></div>` : ""}`;
  }
  function joinView() {
    return `<div class="phone"><div class="ph-title"><span class="eyebrow">Пульт игрока</span><h2>Вход в банду</h2></div>
<form class="ph-box form" data-form="join" novalidate>
<label for="j-code">Код комнаты<input class="inp" id="j-code" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="Например, 4827" value="${esc(P.code)}"></label>
<label for="j-nick">Кличка<input class="inp" id="j-nick" maxlength="16" autocomplete="nickname" placeholder="Например, Лиса" value="${esc(P.nick)}"></label>
${P.err ? `<p class="fb bad" role="alert">${esc(P.err)}</p>` : ""}<button class="btn btn-gold" type="submit">Войти в банду</button></form>
<p class="muted">Код показан на большом экране. Телефон станет пультом — держи экран включённым.</p>
<div class="actions"><button class="btn btn-ghost" data-act="exit">← В меню</button></div></div>`;
  }
  function onlineView() {
    const hs = P.hs;
    if (!hs) {
      if (P.netDown) return `<div class="phone"><div class="ph-box"><span class="eyebrow">Код ${esc(P.code)}</span><h2>Нет связи с ноутбуком</h2><p>Переподключаемся сами. Если не выходит дольше полминуты, проверьте:</p><ul class="hints"><li>телефон подключён к Wi‑Fi ноутбука (его хот-споту);</li><li>на ноутбуке не закрыто окно сервера игры;</li><li>на телефоне выключены мобильный интернет и VPN.</li></ul><div class="actions"><button class="btn" data-act="change-code">Изменить код</button><button class="btn btn-ghost" data-act="exit">← В меню</button></div></div></div>`;
      if (!P.hostMissing) return `<div class="phone"><div class="ph-box"><span class="eyebrow">Код ${esc(P.code)}</span><h2>Ищем большой экран…</h2><p class="muted">Обычно это занимает пару секунд.</p></div></div>`;
      const other = (P.seen || []).map(c => `<button class="btn btn-gold" data-act="use-code" data-code="${esc(c)}">Войти с кодом ${esc(c)}</button>`).join("");
      const why = P.seen && P.seen.length
        ? `<p>Большого экрана с кодом ${esc(P.code)} нет, но рядом есть экран с другим кодом. Может, код набран с ошибкой?</p>`
        : LAN
          ? `<p>Ноутбук на связи, но большого экрана с кодом ${esc(P.code)} нет. Проверьте код в лобби на ноутбуке — или откройте там игру и нажмите «Начать на большом экране».</p>`
          : P.peersN === 0
            ? `<p>Рядом не видно ни одного устройства. Проверьте:</p><ul class="hints"><li>на большом экране открыта <b>эта же ссылка</b>, выбрано дело и показан код;</li><li>оба устройства открыты <b>на claude.ai в браузере</b>, а не отдельной страницей;</li><li>у аккаунта на телефоне есть доступ к игре — главарь приглашает через «Поделиться».</li></ul>`
            : `<p>Не вижу большой экран с кодом ${esc(P.code)}. Проверьте код на большом экране.</p>`;
      return `<div class="phone"><div class="ph-box"><span class="eyebrow">Код ${esc(P.code)}</span><h2>Большой экран не найден</h2>${why}<div class="actions">${other}<button class="btn" data-act="change-code">Изменить код</button><button class="btn btn-ghost" data-act="retry-join">Искать ещё раз</button></div></div></div>`;
    }
    if (hs.ph === "exam") return examView();
    const ci = caseOf(hs.cs), s = mySeat();
    const gone = P.netDown ? `<p class="fb bad">Нет связи с ноутбуком — переподключаемся…</p>` : P.hostGone ? `<p class="fb bad">Большой экран пропал со связи. Ждём, пока он вернётся.</p>` : "";
    const meta = lab => `<div class="ph-meta"><b>${lab}</b>код ${esc(P.code)}</div>`;
    if (hs.ph === "lobby") return `<div class="phone">${phoneHead(meta("Сбор"))}${gone}<div class="ph-box"><span class="eyebrow">Дело №${ci.no} · ${ci.title}</span><h2>${s >= 0 ? "Ты в банде" : "Садимся за стол…"}</h2><p>${s >= 0 ? "Твой цвет — вот этот, им будут подсвечены твои механизмы на большом экране. Роли раздадут на каждом сейфе заново." : "Большой экран вот-вот выдаст тебе место."}</p><p class="muted">Ждём, пока главарь начнёт дело.</p></div></div>`;
    if (hs.ph === "end") return `<div class="phone">${phoneHead(meta("Финал"))}${gone}<div class="ph-box"><span class="eyebrow">Дело закрыто</span><h2>${hs.fin ? `${hs.fin.l} слитков из ${hs.fin.m}` : "Уходим с добычей"}</h2><p class="muted">Итоги — на большом экране. Главарь может начать новую игру, телефоны подключатся сами.</p></div>${homeworkHTML(hs)}</div>`;
    const L = phLevel(), roles = myRoles();
    const lab = stageLabel(hs.cs, hs.old, hs.lv, true);
    if (hs.ph === "win" || hs.ph === "debrief") {
      const mine = L.homework && s >= 0 && s < hs.nL ? `<div class="ph-box konspekt"><h3 class="eyebrow ok-text">Твоя задача с решением</h3>${L.homework(s)}</div>` : "";
      return `<div class="phone">${phoneHead(meta(lab))}${gone}<div class="ph-title"><span class="eyebrow">${esc(L.topic)}</span><h2 class="win">${L.win}</h2></div>${mine}<div class="ph-box konspekt"><h3 class="eyebrow ok-text">Конспект</h3>${L.debrief(clone(L.solution(L.initAux(hs.nL))), L.initAux(hs.nL))}${L.bridge || ""}</div><p class="muted">Следующий сейф начнётся, когда главарь нажмёт «Дальше».</p></div>`;
    }
    const intro = hs.ph === "intro";
    const taskState = r => {
      if (!r.task || intro) return "";
      if (solvedRole(hs.px, r.id)) return `<p class="dig-state">✓ Верно, замок открыт. Помогай остальным словами — их пульты не трогай.</p>`;
      const n = hs.px.wr && hs.px.wr[r.id];
      return n ? `<p class="fb bad">Неверно (попыток: ${n}). Пересчитай на бумаге — каждая ошибка зовёт охрану.</p>` : `<p class="muted small">Считай на бумаге. Большой экран покажет ход механизма только после верного ответа.</p>`;
    };
    const blocks = roles.length ? roles.map(r => Wd.roleHTML(r, P.W[r.id] || r.init, phoneEnv(r)) + taskState(r)).join("") : `<div class="ph-box"><p>${mySeat() >= 0 && hs.nL <= mySeat() ? "Ты присоединился посреди сейфа: пульт получишь на следующем. А пока следи за большим экраном и подсказывай банде." : "У тебя на этом сейфе нет пульта. Следи за большим экраном и подсказывай банде."}</p></div>`;
    return `<div class="phone">${phoneHead(meta(lab))}${gone}
<div class="ph-title"><span class="eyebrow">${esc(L.title)}${intro ? " · готовимся" : ""}</span><p>${L.goal}</p></div>
${intro ? `<p class="fb">Ждём, пока главарь скажет «Поехали». Посмотри, что у тебя за пульт.</p>` : ""}
<div id="guardbar" class="guardbar" hidden>Охрана смотрит — не трогай пульт!</div>
${blocks}</div>`;
  }
  function phoneEnv(r) {
    const hs = P.hs, L = phLevel();
    return { color: seatColor(mySeat()), disabled: hs.ph !== "play" || hs.solo || solvedRole(hs.px, r.id), theory: L.theory, px: hs.px, cardText: L.cardText };
  }
  function phoneHTML() {
    if (P.step === "join") return joinView();
    if (P.step === "connecting") return `<div class="phone"><div class="ph-box"><span class="eyebrow">Код ${esc(P.code)}</span><h2>Подключаемся…</h2></div></div>`;
    if (P.step === "nolink") return `<div class="phone"><div class="ph-box"><span class="eyebrow">Нет связи</span><h2>Телефон не подключился</h2><p>${esc(whyText(P.why))}</p><p class="muted">Пока можно играть без телефонов: на большом экране отметьте «Играть на одном экране» — все пульты появятся под сценой.</p><div class="actions"><button class="btn btn-gold" data-act="retry-join">Попробовать снова</button><button class="btn" data-act="change-code">Изменить код</button><button class="btn btn-ghost" data-act="exit">← В меню</button></div></div></div>`;
    return onlineView();
  }
  function structKey() {
    if (!P || P.step !== "online" || !P.hs) return P ? [P.step, P.err, P.why, P.hostMissing ? 1 : 0, (P.seen || []).join(","), P.peersN > 0 ? 1 : 0, P.netDown ? 1 : 0].join("|") : "";
    const hs = P.hs;
    const ex = hs.ph === "exam" ? JSON.stringify(examState()) : "";
    return [P.step, hs.ph, hs.cs, hs.old, hs.rd, hs.lv, mySeat(), P.wkey, JSON.stringify(hs.px), P.hostGone ? 1 : 0, P.netDown ? 1 : 0, ex, hs.fin ? hs.fin.l : ""].join("|");
  }
  function renderPhone(force) {
    if (MODE !== "phone" || !P) return;
    const k = structKey();
    if (force || k !== P.skey) { P.skey = k; app.innerHTML = phoneHTML(); }
    livePhone();
  }
  function livePhone() {
    if (!P || !P.hs) return;
    const al = document.getElementById("ph-al"), nz = document.getElementById("ph-nz");
    if (al) al.style.width = P.hs.al + "%";
    if (nz) nz.style.width = P.hs.nz + "%";
    const gb = document.getElementById("guardbar");
    if (gb) gb.hidden = !(P.hs.gc && P.hs.ph === "play");
    const rt = document.getElementById("radar-txt"), rn = document.getElementById("radar-noise");
    if (rn) rn.style.width = P.hs.nz + "%";
    if (rt) {
      const radar = document.getElementById("radar");
      if (P.hs.gc) { rt.textContent = "Охрана смотрит! Все замерли!"; radar.dataset.s = "check"; }
      else if (P.guard && P.guard.at > Date.now()) { const s = Math.ceil((P.guard.at - Date.now()) / 1000); rt.textContent = `Охрана через ${s}… Кричи «Шухер!»`; radar.dataset.s = "warn"; }
      else { rt.textContent = P.hs.nz > 30 ? "Банда шумит — пусть притихнут." : "Тихо. Охрана далеко."; radar.dataset.s = P.hs.nz > 30 ? "loud" : "calm"; }
    }
  }
  setInterval(() => { if (MODE === "phone") livePhone(); }, 250);

  function phoneAct(act, el) {
    switch (act) {
      case "change-code": leaveRoom(); P.step = "join"; P.err = ""; renderPhone(true); break;
      case "retry-join": clearTimeout(waitTimer); phoneJoin(); break;
      case "use-code": { const c = String(el.dataset.code || ""); if (/^\d{4}$/.test(c)) { P.code = c; savePhone(); clearTimeout(waitTimer); phoneJoin(); } break; }
      default: return false;
    }
    return true;
  }
  function enterPhone(code) {
    MODE = "phone"; P = newPhone();
    window.scrollTo(0, 0);
    // пришли по QR-коду: код уже есть; если кличка знакома — сразу садимся за стол
    if (code) { P.code = code; if (P.nick) { savePhone(); phoneJoin(); return; } }
    renderPhone(true);
    if (code) { const el = document.getElementById("j-nick"); if (el) try { el.focus(); } catch (e) { /* без фокуса */ } }
  }

  // ---------- пульты: общая обвязка ----------
  Wd.bind(app, {
    roleOf: rid => {
      if (MODE === "host" && H && H.solo) return roleDefs().find(r => r.id === rid);
      if (MODE === "phone" && P && P.hs) return myRoles().find(r => r.id === rid);
      return null;
    },
    get store() { return MODE === "host" && H ? H.V : P ? P.W : {}; },
    onChange(rid) {
      if (MODE === "host" && H && H.solo) {
        // пульт уже поменял H.V[rid] на месте; приводим к форме роли и считаем это движением
        const role = roleDefs().find(r => r.id === rid);
        if (!role) return;
        const v = C.sanitizeRoleVal(role, H.V[rid]);
        if (v) H.V[rid] = v;
        if (H.phase === "play") touched(rid, "host");
        Wd.update(document.getElementById("solo"), role, H.V[rid], soloEnv(role));
        H.lastRes = curLevel().evaluate(H.V, H.aux);
        return;
      }
      if (MODE === "phone" && P && P.hs) {
        if (P.hs.ph !== "play") return;
        const role = myRoles().find(r => r.id === rid);
        Wd.update(app, role, P.W[rid], phoneEnv(role));
        vib(6); pushCtl();
      }
    },
    refresh(rid) {
      if (MODE === "host" && H && H.solo) { const role = roleDefs().find(r => r.id === rid); if (role) Wd.update(document.getElementById("solo"), role, H.V[rid], soloEnv(role)); }
      else if (MODE === "phone" && P && P.hs) { const role = myRoles().find(r => r.id === rid); if (role) Wd.update(app, role, P.W[rid], phoneEnv(role)); }
    },
    onAct(rid, act, data) {
      // пустой ответ не отправляем: дозаполнить — не ошибка и тревоги не стоит
      const notReady = (L, v) => act === "check" && L.ready && !L.ready(rid, v);
      if (MODE === "host" && H && H.solo) {
        if (notReady(curLevel(), H.V[rid])) { showToast("Заполните ответ целиком.", "gold"); return; }
        doAction(rid, act, data, "host"); renderSoloControls(true); return;
      }
      if (MODE === "phone" && P && P.hs && P.hs.ph === "play") {
        if (notReady(phLevel(), P.W[rid])) { showToast("Заполни ответ целиком: все числа и угол.", "gold"); return; }
        pushAct(rid, act, data);
      }
    },
  });

  // =====================================================================
  // Старт
  // =====================================================================
  function landingHTML() {
    const saved = LS.get("bazis.host");
    const canResume = saved && saved.code && saved.phase && !["end", "lobby"].includes(saved.phase);
    const sc = canResume ? caseOf(saved.cs) : null;
    const cases = C.CASE_IDS.slice().reverse().map(id => {
      const c = caseOf(id);
      return `<article class="case"><figure class="case-plan">${planSVG(id, true, -1, "landing")}</figure><div class="case-body">
<span class="eyebrow">Дело №${c.no} · ${c.subject}</span><h2>${c.title}${c.test ? ` <span class="pill">тест</span>` : ""}</h2><p>${c.blurb}</p>
<div class="tags">${c.topics.map(t => `<span class="tag">${t}</span>`).join("")}</div>
<p class="muted">${c.newN} сейфов${c.hasOld ? " + старый замок" : ""} · допрос: ${c.examN} вопроса каждому</p>
<div class="actions"><button class="btn btn-gold" data-act="go-host" data-cs="${id}">Начать на большом экране</button></div></div></article>`;
    }).join("");
    return `<div class="landing"><header class="l-head"><span class="eyebrow">Кооперативные ограбления по математике · от 3 игроков</span>
<h1>Банда <em>«Базис»</em></h1>
<p class="lede">Телефоны — пульты механизмов, большой экран — живая сцена. Каждый крутит свою часть: центр поворота, зеркало, угол, вектор. Сейф открывается, когда вместе получилось нужное движение. А охрана ходит обходом — не шумите.</p>
<div class="actions"><button class="btn btn-gold btn-big" data-act="go-phone">Я с телефона</button>${canResume ? `<button class="btn" data-act="resume-host">Продолжить: №${sc.no} · ${sc.title}, код ${esc(saved.code)}</button>` : ""}</div></header>
<section class="cases" aria-label="Дела">${cases}</section>
<ol class="howto">${LAN ? `<li>На ноутбуке выберите дело — откроется лобби с QR-кодом. Включите звук: там музыка.</li><li>Телефоны подключаются к Wi‑Fi ноутбука и сканируют QR-код. Или открывают адрес из лобби, жмут «Я с телефона» и вводят код.</li>` : `<li>Откройте страницу на большом экране, выберите дело и включите звук — там музыка.</li><li>Каждый открывает ту же ссылку на телефоне, жмёт «Я с телефона» и вводит код.</li>`}<li>На каждом сейфе роли раздаются заново. Говорите вслух, слушайте сторожа и не крутите пульты, когда охрана смотрит.</li></ol></div>`;
  }
  function render() {
    if (MODE === "host" && H) renderHost();
    else if (MODE === "phone" && P) renderPhone(true);
    else app.innerHTML = landingHTML();
  }

  // ---------- события ----------
  app.addEventListener("click", e => {
    const x = e.target.closest("[data-x]");
    if (x && MODE === "phone") {
      const k = x.dataset.x;
      if (k === "key") exKey(x.dataset.k);
      else if (k === "fld") { if (UI.exInput) { UI.exInput.active = +x.dataset.i; renderPhone(true); } }
      else if (k === "submit") exSubmit();
      else if (k === "exnext") { examState().fb = false; UI.exInput = null; renderPhone(true); window.scrollTo(0, 0); }
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === "go-host") { enterHost(false, b.dataset.cs); return; }
    if (act === "resume-host") { const s = LS.get("bazis.host"); if (s && s.code) { H = Object.assign(newHost(null, s.cs), s, { phase: "lobby" }); H.cs = C.caseOk(H.cs); enterHost(true); if (s.phase === "intro" && Number.isInteger(s.lv)) { startLevel(s.lv); } } return; }
    if (act === "go-phone") { enterPhone(); return; }
    if (act === "exit") {
      leaveRoom(); clearTimeout(waitTimer); MU.setMode("off");
      if (window.KeepAwake) window.KeepAwake.videoOff();
      if (LAN && location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* адрес останется */ } }
      MODE = "landing"; render(); window.scrollTo(0, 0); return;
    }
    if (MODE === "host") hostAct(act, b);
    else if (MODE === "phone") phoneAct(act, b);
  });
  app.addEventListener("input", e => {
    if (e.target.id === "vol") { UI.vol = +e.target.value / 100; MU.unlock(); MU.setVolume(UI.vol); LS.set("bazis.audio", { on: UI.musicOn, vol: UI.vol }); }
  });
  app.addEventListener("change", e => {
    if (MODE !== "host" || !H) return;
    if (e.target.id === "solo") { H.solo = e.target.checked; renderHost(); commit(); }
    if (e.target.id === "old" && H.phase === "lobby") { H.old = e.target.checked; H.resumeLv = null; renderHost(); commit(); }
  });
  app.addEventListener("submit", e => {
    e.preventDefault();
    if (MODE !== "phone" || e.target.dataset.form !== "join") return;
    const code = (document.getElementById("j-code").value || "").replace(/\D/g, "");
    const raw = document.getElementById("j-nick").value || "";
    P.code = code; P.nick = raw.trim() ? cleanNick(raw) : "";
    if (code.length !== 4) { P.err = "Код комнаты — четыре цифры с большого экрана."; renderPhone(true); return; }
    if (!P.nick) { P.err = "Придумайте кличку, чтобы банда вас узнала."; renderPhone(true); return; }
    savePhone(); phoneJoin();
  });
  document.addEventListener("keydown", e => {
    if (MODE === "host" && H && e.key === " " && H.phase === "intro" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target && e.target.tagName) || "")) { e.preventDefault(); go(); }
  });
  // браузер разрешает звук только после жеста: любое нажатие на большом экране будит музыку
  const wakeAudio = () => { if (MODE === "host") MU.unlock(); };
  document.addEventListener("pointerdown", wakeAudio, true);
  document.addEventListener("keydown", wakeAudio, true);

  // ---------- горячее обновление у открытых зрителей ----------
  function snapshot() { return { MODE, H: H ? JSON.parse(JSON.stringify(Object.assign({}, H, { lastRes: null }))) : null, P: P ? Object.assign({}, P, { skey: "" }) : null }; }
  try { if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === "function") window.claude.hot.snapshot(snapshot); } catch (e) { /* нет горячего обновления */ }
  function start(data) {
    data = data || {};
    getRoomNs();
    if (data.MODE === "host" && data.H) { H = Object.assign(newHost(null, data.H.cs), data.H); H.cs = C.caseOk(H.cs); if (["play", "win"].includes(H.phase)) H.phase = "intro"; enterHost(true); if (H.phase === "intro") startLevel(H.lv); return; }
    if (data.MODE === "phone" && data.P) { P = Object.assign(newPhone(), data.P); MODE = "phone"; renderPhone(true); if (P.step === "online" || P.step === "connecting") phoneJoin(); return; }
    const hash = (location.hash || "").replace("#", "");
    const jm = /^j=(\d{4})$/.exec(hash);
    if (jm) { enterPhone(jm[1]); return; }
    if (hash === "phone") { enterPhone(); return; }
    if (hash === "screen") { enterHost(false, "usadba"); return; }
    MODE = "landing"; render();
  }
  try {
    if (window.claude && window.claude.hot && typeof window.claude.hot.ready === "function") window.claude.hot.ready(start);
    else start(window.claude && window.claude.hot ? window.claude.hot.data : null);
  } catch (e) { start(null); }
  window.BazisDebug = { get H() { return H; }, get P() { return P; }, setValue: (rid, v) => { if (MODE === "phone" && P && P.W[rid]) { P.W[rid] = v; pushCtl(true); } }, act: (rid, t, d) => pushAct(rid, t, d) };
})();
