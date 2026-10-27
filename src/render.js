/* Сцена большого экрана на canvas: клетчатая плоскость, механизмы, плавные движения, частицы,
   охрана с фонарём, тряска при шуме. Каждому типу уровня — своя отрисовка. */
(function (root) {
  "use strict";
  const C = root.BazisCore;
  let cv = null, ctx = null, W = 0, H = 0, dpr = 1;
  const col = {};
  const TW = new Map();
  let parts = [];
  let shakeT = 0, shakeAmp = 0, flashT = 0, flashC = "alarm";
  let banner = null;
  const goalPos = {};
  const MONO = '"JetBrains Mono", ui-monospace, monospace', BODY = '"Onest", system-ui, sans-serif', DISP = '"Unbounded", "Arial Black", sans-serif';

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    ["paper", "sheet", "ink", "ink-2", "rule", "grid", "grid-2", "gold", "alarm", "ok", "on-accent", "p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"].forEach(k => { col[k] = cs.getPropertyValue("--" + k).trim() || "#ffffff"; });
  }
  function attach(c) {
    cv = c; ctx = cv.getContext("2d");
    readColors(); resize();
  }
  function resize() {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    W = r.width; H = r.height;
  }
  function rgba(c, a) {
    if (!c) return `rgba(255,255,255,${a})`;
    c = c.trim();
    if (c[0] === "#") {
      let h = c.slice(1);
      if (h.length === 3) h = h.split("").map(x => x + x).join("");
      const n = parseInt(h.slice(0, 6), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(",").map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return c;
  }

  // ---------- плавность ----------
  function tw(key, target, dt, rate) {
    let cur = TW.get(key);
    if (!cur || cur.length !== target.length) { cur = target.slice(); TW.set(key, cur); return cur; }
    const k = 1 - Math.exp(-(rate || 14) * Math.min(0.1, dt));
    for (let i = 0; i < cur.length; i++) cur[i] += (target[i] - cur[i]) * k;
    return cur;
  }
  const flat = pts => pts.reduce((a, p) => { a.push(p[0], p[1]); return a; }, []);
  const unflat = a => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
  const twPts = (key, pts, dt, rate) => unflat(tw(key, flat(pts), dt, rate));
  const twN = (key, x, dt, rate) => tw(key, [x], dt, rate)[0];

  // ---------- панели и примитивы ----------
  function panel(x, y, w, h, R, title) {
    const th = title ? 26 : 0;
    const s = Math.min(w, h - th) / (2 * R + 1.2);
    const cx = x + w / 2, cy = y + th + (h - th) / 2;
    return { x, y, w, h, R, s, cx, cy, title, X: a => cx + a * s, Y: b => cy - b * s };
  }
  function frame(P, accent) {
    ctx.save();
    ctx.strokeStyle = accent ? col[accent] || accent : col.rule; ctx.lineWidth = accent ? 2 : 1;
    ctx.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
    if (P.title) { ctx.fillStyle = accent ? col[accent] || accent : col["ink-2"]; ctx.font = `700 13px ${MONO}`; ctx.textBaseline = "top"; ctx.fillText(P.title.toUpperCase(), P.x + 10, P.y + 8); }
    ctx.restore();
  }
  function grid(P, faint) {
    const R = P.R;
    ctx.save();
    ctx.lineWidth = 1;
    for (let k = -R; k <= R; k++) {
      ctx.strokeStyle = k === 0 ? rgba(col.ink, faint ? 0.18 : 0.32) : rgba(col.ink, faint ? 0.05 : 0.09);
      ctx.beginPath(); ctx.moveTo(P.X(k), P.Y(-R)); ctx.lineTo(P.X(k), P.Y(R)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P.X(-R), P.Y(k)); ctx.lineTo(P.X(R), P.Y(k)); ctx.stroke();
    }
    ctx.fillStyle = rgba(col["ink-2"], 0.7); ctx.font = `500 ${Math.max(9, Math.min(12, P.s * 0.45))}px ${MONO}`; ctx.textBaseline = "top"; ctx.textAlign = "center";
    for (let k = -R + (R % 2); k <= R; k += 2) if (k !== 0) { ctx.fillText(C.num(k), P.X(k), P.Y(0) + 3); }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let k = -R + (R % 2); k <= R; k += 2) if (k !== 0) ctx.fillText(C.num(k), P.X(0) - 4, P.Y(k));
    ctx.restore();
  }
  function clip(P) { ctx.save(); ctx.beginPath(); ctx.rect(P.X(-P.R) - 2, P.Y(P.R) - 2, P.s * 2 * P.R + 4, P.s * 2 * P.R + 4); ctx.clip(); }
  function poly(P, pts, o) {
    if (!pts || !pts.length) return;
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(P.X(p[0]), P.Y(p[1])) : ctx.moveTo(P.X(p[0]), P.Y(p[1]))));
    ctx.closePath();
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 18; }
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) { ctx.setLineDash(o.dash || []); ctx.lineWidth = o.width || 2; ctx.strokeStyle = o.stroke; ctx.lineJoin = "round"; ctx.stroke(); }
    ctx.restore();
  }
  function dot(P, p, r, c, glow) {
    ctx.save(); if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 16; }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(P.X(p[0]), P.Y(p[1]), r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function ring(P, p, r, c, w, dash) {
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = w || 2; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.arc(P.X(p[0]), P.Y(p[1]), r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  function label(P, p, text, c, dx, dy, size) {
    ctx.save(); ctx.fillStyle = c; ctx.font = `700 ${size || 13}px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, P.X(p[0]) + (dx === undefined ? 8 : dx), P.Y(p[1]) + (dy === undefined ? -9 : dy)); ctx.restore();
  }
  function seg(P, a, b, c, w, dash) {
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = w || 2; ctx.setLineDash(dash || []); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(P.X(a[0]), P.Y(a[1])); ctx.lineTo(P.X(b[0]), P.Y(b[1])); ctx.stroke(); ctx.restore();
  }
  function arrow(P, a, b, c, w) {
    const x1 = P.X(a[0]), y1 = P.Y(a[1]), x2 = P.X(b[0]), y2 = P.Y(b[1]);
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 2) return;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L, h = Math.min(12, L * 0.4);
    ctx.save(); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w || 2.4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * h * 0.7, y2 - uy * h * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * h - uy * h * 0.5, y2 - uy * h + ux * h * 0.5); ctx.lineTo(x2 - ux * h + uy * h * 0.5, y2 - uy * h - ux * h * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function lineK(P, kind, v, c, w, dash, glow) {
    const R = P.R + 0.5;
    let p1, p2;
    if (kind === "x") { p1 = [v, -R]; p2 = [v, R]; }
    else if (kind === "y") { p1 = [-R, v]; p2 = [R, v]; }
    else if (kind === "d") { p1 = [-R, -R + v]; p2 = [R, R + v]; }
    else { p1 = [-R, v + R]; p2 = [R, v - R]; }
    ctx.save(); if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 14; }
    seg(P, p1, p2, c, w, dash); ctx.restore();
    return p2;
  }
  function lineThrough(P, d, c, w, dash) {
    const L = (P.R + 1) / Math.max(Math.abs(d[0]), Math.abs(d[1]), 0.001);
    seg(P, [-d[0] * L, -d[1] * L], [d[0] * L, d[1] * L], c, w, dash);
  }
  function crosshair(P, p, c, r) {
    const x = P.X(p[0]), y = P.Y(p[1]); r = r || 10;
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.moveTo(x - r - 5, y); ctx.lineTo(x + r + 5, y); ctx.moveTo(x, y - r - 5); ctx.lineTo(x, y + r + 5); ctx.stroke(); ctx.restore();
  }
  function arcAround(P, O, A, ang, c) {
    const r = Math.hypot(A[0] - O[0], A[1] - O[1]);
    if (r < 0.01) return;
    const a0 = Math.atan2(A[1] - O[1], A[0] - O[0]), a1 = a0 + (ang * Math.PI) / 180;
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(P.X(O[0]), P.Y(O[1]), r * P.s, -a0, -a1, true); ctx.stroke(); ctx.restore();
  }
  function wheel(P, O, rU, c, t, speed, dashed) {
    const x = P.X(O[0]), y = P.Y(O[1]), r = rU * P.s;
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const a0 = t * (speed || 0.6);
    for (let k = 0; k < 8; k++) { const a = a0 + (k * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25); ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function stamp(P, text, c) {
    ctx.save(); ctx.translate(P.cx, P.cy); ctx.rotate(-0.12);
    ctx.font = `800 ${Math.max(16, Math.min(34, P.w / 9))}px ${DISP}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 30, h = Math.max(30, Math.min(52, P.w / 7));
    ctx.fillStyle = rgba(col.paper, 0.78); ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = c; ctx.fillText(text, 0, 2); ctx.restore();
  }
  function note(x, y, text, c, size, align) {
    ctx.save(); ctx.font = `600 ${size || 13}px ${BODY}`; ctx.textAlign = align || "left"; ctx.textBaseline = "top";
    const w = ctx.measureText(text).width;
    const bx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = rgba(col.paper, 0.82); ctx.fillRect(bx - 6, y - 4, w + 12, (size || 13) + 9);
    ctx.fillStyle = c; ctx.fillText(text, x, y); ctx.restore();
  }
  const centroid = ps => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
  const ease = x => (x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3));
  function layout2(n) {
    const m = 14;
    if (n <= 1) return [[m, m, W - 2 * m, H - 2 * m]];
    if (W >= H * 1.15) { const w = (W - 3 * m) / 2; return [[m, m, w, H - 2 * m], [2 * m + w, m, w, H - 2 * m]]; }
    const h = (H - 3 * m) / 2; return [[m, m, W - 2 * m, h], [m, 2 * m + h, W - 2 * m, h]];
  }
  const linText = (cf, vs) => { let o = ""; cf.forEach((c, i) => { if (!c) return; const a = Math.abs(c); const t = (a === 1 ? "" : a) + vs[i]; o += o === "" ? (c < 0 ? "−" : "") + t : (c < 0 ? " − " : " + ") + t; }); return o || "0"; };

  // ---------- уровни ----------
  const D = {};
  // ---------- задачи «каждому своя»: по панели на игрока ----------
  // До верного ответа на панели только условие. После — механизм доезжает до ответа (q от 0 до 1).
  function layoutN(n) {
    const m = 12;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), w = (W - (cols + 1) * m) / cols, h = (H - (rows + 1) * m) / rows, s = Math.min(w, h - 26);
      if (!best || s > best.s) best = { cols, w, h, s };
    }
    return Array.from({ length: n }, (_, i) => [m + (i % best.cols) * (best.w + m), m + Math.floor(i / best.cols) * (best.h + m), best.w, best.h]);
  }
  const spanR = pts => Math.max(5, Math.min(12, Math.ceil(Math.max(...pts.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))))) + 1));
  const rotF = (O, A, deg) => {
    const a = (deg * Math.PI) / 180, dx = A[0] - O[0], dy = A[1] - O[1];
    return [O[0] + dx * Math.cos(a) - dy * Math.sin(a), O[1] + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  // дуга поворота точки A вокруг O на ang градусов (минус — по часовой)
  function arcTurn(P, O, A, ang, c) {
    const r = Math.hypot(A[0] - O[0], A[1] - O[1]);
    if (r < 0.01 || !ang) return;
    const a0 = Math.atan2(A[1] - O[1], A[0] - O[0]), a1 = a0 + (ang * Math.PI) / 180;
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(P.X(O[0]), P.Y(O[1]), r * P.s, -a0, -a1, ang > 0); ctx.stroke(); ctx.restore();
  }
  function xMark(P, p, c) {
    const x = P.X(p[0]), y = P.Y(p[1]);
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); ctx.restore();
  }
  // точка на прямой внутри поля — для подписи
  function linePt(l, R) {
    if (l.k === "x") return [l.v, R - 1];
    if (l.k === "y") return [R - 1.5, l.v];
    if (l.k === "d") { const x = Math.min(R - 1, R - 1 - l.v); return [x, x + l.v]; }
    const x = Math.min(R - 1, R - 1 + l.v); return [x, l.v - x];
  }
  function taskPanels(sc, e, pts, draw) {
    const rects = layoutN(sc.items.length);
    sc.items.forEach((it, i) => {
      const r = rects[i], c = e.color(it.id), nick = e.nick ? e.nick(it.id) : "";
      const P = panel(r[0], r[1], r[2], r[3], spanR(pts(it)), `Замок ${i + 1}${nick && nick !== "—" ? " · " + nick : ""}`);
      goalPos[it.id] = [P.cx, P.cy];
      frame(P, it.solved ? "gold" : c);
      clip(P); grid(P, true);
      const q = it.solved ? ease((e.now - it.solved) / 1400) : 0;
      const wr = !it.solved && it.wrong && e.now - it.wrong.t < 4000 ? it.wrong.ans : null;
      draw(P, it, c, q, wr);
      ctx.restore();
      if (q >= 1) stamp(P, "ОТКРЫТ", col.gold);
      else if (wr) note(P.x + 10, P.y + P.h - 28, `мимо · попыток: ${it.wrong.n}`, col.alarm, 12);
    });
  }
  D.rotpt = (sc, e) => taskPanels(sc, e, it => [it.O, it.A, it.A1], (P, it, c, q, wr) => {
    crosshair(P, it.O, col.ink, 7); label(P, it.O, "O", col.ink, 12, -12); label(P, it.O, it.ang, col["ink-2"], 12, 12, 12);
    dot(P, it.A, 6, c); label(P, it.A, "A", c);
    if (q > 0) {
      const p = rotF(it.O, it.A, it.turn * q);
      seg(P, it.O, it.A, rgba(c, 0.4), 1.4, [3, 4]); seg(P, it.O, p, rgba(col.gold, 0.7), 1.6, [3, 4]);
      arcTurn(P, it.O, it.A, it.turn * q, rgba(col.gold, 0.9));
      dot(P, p, 7, col.gold, col.gold);
      if (q >= 1) label(P, it.A1, "A′", col.gold);
    }
    if (wr) xMark(P, wr.p, col.alarm);
  });
  D.center = (sc, e) => taskPanels(sc, e, it => [it.A, it.B, it.A1, it.B1, it.O], (P, it, c, q, wr) => {
    seg(P, it.A, it.A1, rgba(col.ink, 0.25), 1.2, [2, 4]); seg(P, it.B, it.B1, rgba(col.ink, 0.25), 1.2, [2, 4]);
    dot(P, it.A, 5, col.ink); dot(P, it.B, 5, col.ink); label(P, it.A, "A", col.ink); label(P, it.B, "B", col.ink);
    ring(P, it.A1, 8, col.gold, 2, [4, 3]); ring(P, it.B1, 8, col.gold, 2, [4, 3]);
    label(P, it.A1, "A₁", col.gold, 10, -10); label(P, it.B1, "B₁", col.gold, 10, -10);
    if (q > 0) {
      wheel(P, it.O, 0.9, col.gold, e.t, q < 1 ? 1.2 : 0);
      arcTurn(P, it.O, it.A, it.turn * q, rgba(col.gold, 0.9)); arcTurn(P, it.O, it.B, it.turn * q, rgba(col.gold, 0.9));
      dot(P, rotF(it.O, it.A, it.turn * q), 6, c, c); dot(P, rotF(it.O, it.B, it.turn * q), 6, c, c);
      if (q >= 1) label(P, it.O, `O · ${it.ang}`, col.gold, 12, 16);
    }
    if (wr) crosshair(P, wr.c, col.alarm, 7);
  });
  D.mirror2 = (sc, e) => taskPanels(sc, e, it => it.F.concat(it.F2, it.O ? [it.O] : []), (P, it, c, q, wr) => {
    lineK(P, it.l1.k, it.l1.v, col.ink, 2.4); lineK(P, it.l2.k, it.l2.v, rgba(col.ink, 0.65), 2.4, [8, 5]);
    label(P, linePt(it.l1, P.R), "l₁", col.ink, 6, -10, 14); label(P, linePt(it.l2, P.R), "l₂", col.ink, 6, -10, 14);
    poly(P, it.F, { fill: rgba(col.ink, 0.18), stroke: col.ink, width: 2 });
    if (q > 0) {
      poly(P, it.F1, { stroke: rgba(c, 0.7), dash: [3, 4], width: 1.6 });
      poly(P, it.F2, { fill: rgba(col.gold, 0.3 * q), stroke: rgba(col.gold, q), width: 2.4, glow: q >= 1 ? col.gold : null });
      if (it.rot) { crosshair(P, it.O, col.gold, 8); arcTurn(P, it.O, it.F[0], it.turn * q, rgba(col.gold, 0.8)); }
      else arrow(P, it.F[0], [it.F[0][0] + it.v[0] * q, it.F[0][1] + it.v[1] * q], col.gold, 2.4);
    }
    if (wr && wr.rot) xMark(P, wr.p, col.alarm);
  });
  D.rotcomp = (sc, e) => taskPanels(sc, e, it => it.J.concat(it.J2, [it.O1, it.O2], it.O ? [it.O] : []), (P, it, c, q, wr) => {
    wheel(P, it.O1, 0.8, col.ink, e.t, 0.4); wheel(P, it.O2, 0.8, rgba(col.ink, 0.6), -e.t, 0.4);
    label(P, it.O1, `O₁ · ${it.a1}°`, col.ink, 14, -14, 12); label(P, it.O2, `O₂ · ${it.a2}°`, col.ink, 14, -14, 12);
    poly(P, it.J, { fill: rgba(col.ink, 0.22), stroke: col.ink, width: 2 });
    if (q > 0) {
      poly(P, it.J1, { stroke: rgba(c, 0.7), dash: [3, 4], width: 1.6 });
      poly(P, it.J2, { fill: rgba(col.gold, 0.3 * q), stroke: rgba(col.gold, q), width: 2.4, glow: q >= 1 ? col.gold : null });
      if (it.rot) { wheel(P, it.O, 0.9, col.gold, e.t * 2, q < 1 ? 1.4 : 0); label(P, it.O, `O₃ · ${it.turn}°`, col.gold, 14, 16, 12); }
      else { const j0 = centroid(it.J); arrow(P, j0, [j0[0] + it.v[0] * q, j0[1] + it.v[1] * q], col.gold, 2.4); }
    }
    if (wr && wr.rot) xMark(P, wr.p, col.alarm);
  });
  D.treasure = (sc, e) => {
    const sh = sc.shared, n = sc.items.length, k = sc.items.filter(it => it.solved).length, all = k === n;
    const pts = [sh.W, sh.D, sh.T];
    sc.items.forEach(it => { pts.push(it.B); if (it.solved) pts.push(it.K1, it.K2); });
    const P = panel(14, 14, W - 28, H - 28, spanR(pts), "Сад");
    sc.items.forEach(it => { goalPos[it.id] = [P.cx, P.cy]; });
    frame(P, all ? "gold" : null);
    clip(P); grid(P, true);
    ring(P, sh.W, P.s * 0.55, col.ink, 3); ring(P, sh.W, P.s * 0.25, col.ink, 2); label(P, sh.W, "колодец W", col.ink, 14, -14, 13);
    [[0, 0.35], [-0.32, -0.15], [0.32, -0.12]].forEach(o => { ctx.save(); ctx.fillStyle = rgba(col.ok, 0.55); ctx.beginPath(); ctx.arc(P.X(sh.D[0] + o[0]), P.Y(sh.D[1] + o[1]), P.s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
    label(P, sh.D, "дуб D", col.ok, 16, -18, 13);
    sc.items.forEach((it, i) => {
      const c = e.color(it.id);
      ring(P, it.B, 7, c, 2.5); label(P, it.B, `берёза ${i + 1}`, c, 10, 12, 11);
      if (!it.solved) {
        if (it.wrong && e.now - it.wrong.t < 4000) { xMark(P, it.wrong.ans.k1, col.alarm); xMark(P, it.wrong.ans.k2, col.alarm); }
        return;
      }
      const pr = Math.min(1, (e.now - it.solved) / 2600);
      const leg = (a, b, from, to) => { const q = Math.max(0, Math.min(1, (pr - from) / (to - from))); if (q > 0) seg(P, a, [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q], c, 2, from % 0.5 ? [5, 4] : []); };
      leg(it.B, sh.W, 0, 0.25); leg(sh.W, it.K1, 0.25, 0.5); leg(it.B, sh.D, 0.5, 0.75); leg(sh.D, it.K2, 0.75, 1);
      if (pr >= 0.5) xMark(P, it.K1, c);
      if (pr >= 1) xMark(P, it.K2, c);
      if (all && pr >= 1) seg(P, it.K1, it.K2, rgba(c, 0.6), 1.4, [2, 4]);
    });
    if (all) {
      const x = P.X(sh.T[0]), y = P.Y(sh.T[1]), s = P.s * 0.9;
      ctx.save(); ctx.shadowColor = col.gold; ctx.shadowBlur = 24; ctx.fillStyle = col.gold; ctx.fillRect(x - s / 2, y - s / 3, s, s * 0.66); ctx.fillStyle = col.paper; ctx.fillRect(x - s / 2, y - s * 0.06, s, s * 0.1); ctx.restore();
      label(P, sh.T, "КЛАД", col.gold, 16, -16, 15);
    }
    ctx.restore();
    note(P.x + 12, P.y + P.h - 30, all ? "Все версии сошлись в одной точке: клад — середина колышков у каждого" : `Колышки вбиты: ${k} из ${n}. Клад станет виден, когда вобьют все.`, all ? col.gold : col["ink-2"], 13);
  };
  D.proof = (sc, e) => {
    const cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * 0.42;
    goalPos.keys = goalPos.chain = [cx, cy];
    const op = sc.opened ? ease((e.now - (e.openedAt || e.now)) / 1400) : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 - 0.55 * op, 1);
    ctx.strokeStyle = sc.opened ? col.gold : col.rule; ctx.lineWidth = 6; ctx.fillStyle = rgba(col.sheet, 0.9);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6; ctx.fillStyle = col["ink-2"]; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.91, Math.sin(a) * R * 0.91, 5, 0, Math.PI * 2); ctx.fill(); }
    const n = sc.nSteps;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + ((k + 0.5) / n) * Math.PI * 2, x = Math.cos(a) * R * 0.66, y = Math.sin(a) * R * 0.66;
      const on = k < sc.placed.length;
      ctx.save(); if (on) { ctx.shadowColor = col.gold; ctx.shadowBlur = 18; }
      ctx.fillStyle = on ? col.gold : rgba(col.ink, 0.12); ctx.beginPath(); ctx.arc(x, y, R * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = on ? col["on-accent"] : col["ink-2"]; ctx.font = `800 ${Math.max(14, R * 0.08)}px ${DISP}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(on ? sc.placed[k].letter : String(k + 1), x, y + 1);
    }
    const dial = e.t * (sc.chain ? 2.4 : 0.3);
    ctx.strokeStyle = sc.chain ? col.gold : col.ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 3; k++) { const a = dial + (k * Math.PI * 2) / 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.24, Math.sin(a) * R * 0.24); ctx.stroke(); }
    ["k1", "k2"].forEach((k, i) => {
      const x = (i ? 1 : -1) * R * 0.42, y = R * 0.52, turned = sc.keys.includes(k) || sc.opened;
      ctx.save(); ctx.fillStyle = turned ? col.gold : rgba(col.ink, 0.18); ctx.strokeStyle = sc.chain ? col.gold : col.rule; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R * 0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.translate(x, y); ctx.rotate(turned ? Math.PI / 2 : 0); ctx.fillStyle = turned ? col["on-accent"] : col.ink; ctx.fillRect(-2.5, -R * 0.05, 5, R * 0.1); ctx.restore();
    });
    ctx.restore();
  };
  D.combo = (sc, e) => {
    layout2(sc.doors.length).forEach((r, d) => {
      const dr = sc.doors[d];
      const R = Math.max(8, Math.min(13, Math.max(Math.abs(dr.b[0]), Math.abs(dr.b[1])) + 3));
      const P = panel(r[0], r[1], r[2], r[3], R, sc.doors.length > 1 ? `Дверь ${d + 1}` : "Парадная дверь");
      goalPos["door" + d] = [P.cx, P.cy];
      frame(P, e.goal("door" + d) ? "gold" : null);
      clip(P); grid(P, true);
      const ca = e.color(dr.roleA), cc = e.color(dr.roleC);
      lineThrough(P, dr.u, rgba(ca, 0.45), 1.6, [6, 6]); lineThrough(P, dr.v, rgba(cc, 0.45), 1.6, [6, 6]);
      arrow(P, [0, 0], dr.u, ca, 2); arrow(P, [0, 0], dr.v, cc, 2);
      label(P, dr.u, "u", ca); label(P, dr.v, "v", cc);
      const x = P.X(dr.b[0]), y = P.Y(dr.b[1]);
      ctx.save(); ctx.strokeStyle = col.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col.gold; ctx.beginPath(); ctx.arc(x, y - 2, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 1.5, y - 1, 3, 7); ctx.restore();
      label(P, dr.b, `скважина ${C.tup(dr.b)}`, col.gold, 16, -14, 12);
      const J = twPts(`cj${d}`, [[dr.a * dr.u[0], dr.a * dr.u[1]], dr.tip], e.dt);
      seg(P, [0, 0], J[0], ca, 6); seg(P, J[0], J[1], cc, 6);
      dot(P, [0, 0], 6, col.ink); dot(P, J[0], 5, ca); dot(P, J[1], 8, col.ink, e.goal("door" + d) ? col.gold : null);
      ctx.restore();
      note(P.x + P.w - 12, P.y + 8, `a = ${C.num(dr.a)}, c = ${C.num(dr.c)}`, col.ink, 13, "right");
      if (e.goal("door" + d)) stamp(P, "ОТКРЫТО", col.gold);
    });
  };
  D.matrix = (sc, e) => {
    const P = panel(14, 14, W - 28, H - 28, 9, "Шифратор");
    goalPos.all = [P.cx, P.cy];
    frame(P, e.goal("all") ? "gold" : null);
    clip(P); grid(P, true);
    const cc = twPts("mcol", [sc.c1, sc.c2], e.dt), c1 = cc[0], c2 = cc[1];
    const M = (x, y) => [x * c1[0] + y * c2[0], x * c1[1] + y * c2[1]];
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let i = -5; i <= 5; i++) { seg(P, M(i, -6), M(i, 6), rgba(col["ink-2"], 0.5), 1); seg(P, M(-6, i), M(6, i), rgba(col["ink-2"], 0.5), 1); }
    ctx.restore();
    poly(P, [[0, 0], c1, [c1[0] + c2[0], c1[1] + c2[1]], c2], { fill: rgba(col.ink, 0.1) });
    const k1 = e.color(sc.roles[0]), k2 = e.color(sc.roles[1]);
    arrow(P, [0, 0], c1, k1, 3.4); arrow(P, [0, 0], c2, k2, 3.4);
    label(P, c1, "Me₁", k1); label(P, c2, "Me₂", k2);
    [[sc.p, "кадр 1"], [sc.q, "кадр 2"]].forEach(([p, t]) => { ring(P, p, 12, col.gold, 2.6, [4, 3]); label(P, p, t, col.gold, 15, 14, 12); });
    const mp = [c1[0] + c2[0], c1[1] + c2[1]], mq = [c1[0] - c2[0], c1[1] - c2[1]];
    dot(P, mp, 7, col.ink, e.goal("p") ? col.gold : null); dot(P, mq, 7, col.ink, e.goal("q") ? col.gold : null);
    label(P, mp, "M(1, 1)", col.ink, 10, -12, 12); label(P, mq, "M(1, −1)", col.ink, 10, -12, 12);
    ctx.restore();
    if (e.goal("all")) stamp(P, "ПОДМЕНЕНО", col.gold);
  };
  D.collapse = (sc, e) => {
    layout2(sc.grids.length).forEach((r, d) => {
      const g = sc.grids[d], P = panel(r[0], r[1], r[2], r[3], 9, sc.grids.length > 1 ? `Решётка ${d + 1}` : "Лазерный коридор");
      goalPos["vent" + d] = goalPos["flat" + d] = [P.cx, P.cy];
      frame(P, g.vent ? "gold" : null);
      clip(P); grid(P, true);
      const cc = twPts(`lc${d}`, [g.c1, g.c2], e.dt), c1 = cc[0], c2 = cc[1];
      const M = (x, y) => [x * c1[0] + y * c2[0], x * c1[1] + y * c2[1]];
      const fl = 0.35 + 0.2 * Math.sin(e.t * 9 + d);
      for (let i = -6; i <= 6; i++) { seg(P, M(i, -9), M(i, 9), rgba(col.alarm, fl), 1.4); seg(P, M(-9, i), M(9, i), rgba(col.alarm, fl), 1.4); }
      poly(P, [[0, 0], c1, [c1[0] + c2[0], c1[1] + c2[1]], c2], { fill: rgba(col.alarm, 0.28), stroke: col.alarm, width: 1.5 });
      arrow(P, [0, 0], c1, e.color(g.roleK), 3); arrow(P, [0, 0], c2, e.color(g.roleJ), 3);
      ring(P, g.Vt, 14, g.vent ? col.ok : col.gold, 3); label(P, g.Vt, "люк", g.vent ? col.ok : col.gold, 18, -14, 13);
      ctx.restore();
      note(P.x + P.w - 12, P.y + 8, `det = ${C.num(g.D)}`, g.flat ? col.ok : col.alarm, 18, "right");
      if (g.vent) stamp(P, "ЛАЗ ОТКРЫТ", col.gold);
    });
  };
  function gauge(cx, cy, r, val, target, lo, hi, title, sub, ok, c) {
    const A = v => Math.PI + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * Math.PI;
    ctx.save();
    ctx.lineWidth = 10; ctx.strokeStyle = rgba(col.ink, 0.12); ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();
    for (let v = lo; v <= hi; v += (hi - lo) / 10) { const a = A(v); ctx.strokeStyle = rgba(col.ink, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); ctx.stroke(); }
    const at = A(target);
    ctx.strokeStyle = col.gold; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(at) * (r - 20), cy + Math.sin(at) * (r - 20)); ctx.lineTo(cx + Math.cos(at) * (r + 8), cy + Math.sin(at) * (r + 8)); ctx.stroke();
    const an = A(val);
    ctx.shadowColor = ok ? col.ok : "transparent"; ctx.shadowBlur = ok ? 16 : 0;
    ctx.strokeStyle = ok ? col.ok : c || col.ink; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * (r - 10), cy + Math.sin(an) * (r - 10)); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = col.ink; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = `800 ${Math.max(16, r * 0.24)}px ${MONO}`; ctx.fillStyle = ok ? col.ok : col.ink; ctx.fillText(C.num(Math.round(val)), cx, cy + 12);
    ctx.font = `600 ${Math.max(12, r * 0.12)}px ${MONO}`; ctx.fillStyle = col["ink-2"]; ctx.fillText(title, cx, cy + 14 + Math.max(16, r * 0.24) + 6);
    if (sub) ctx.fillText(sub, cx, cy + 14 + Math.max(16, r * 0.24) + 6 + Math.max(12, r * 0.12) + 6);
    ctx.restore();
  }
  D.gauges = (sc, e) => {
    goalPos.all = [W / 2, H / 2];
    const r = Math.min(W / 7.2, H / 3.6), y = H * 0.42;
    const vs = ["x", "y", "z"];
    for (let k = 0; k < 3; k++) {
      const cx = W * (0.18 + 0.32 * k), v = twN(`gg${k}`, sc.g[k], e.dt, 10);
      gauge(cx, y, r, v, sc.d[k], -40, 40, `стрелка ${k + 1}`, `${linText(sc.M[k], vs)} = ${C.num(sc.d[k])}`, sc.g[k] === sc.d[k]);
    }
    const ry = H * 0.82;
    vs.forEach((v, k) => {
      const cx = W * (0.3 + 0.2 * k), c = e.color("d" + v);
      ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.fillStyle = rgba(col.sheet, 0.9);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - 34, ry - 34, 68, 68, 8) : ctx.rect(cx - 34, ry - 34, 68, 68); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.font = `800 34px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(sc.x[k]), cx, ry + 2);
      ctx.font = `700 13px ${MONO}`; ctx.fillStyle = col["ink-2"]; ctx.fillText(v, cx, ry - 46); ctx.restore();
    });
    if (e.goal("all")) stamp({ cx: W / 2, cy: H / 2, w: W * 0.6 }, "СЕЙФ ВСКРЫТ", col.gold);
  };
  D.eigen = (sc, e) => {
    const P = panel(14, 14, W - 28, H - 28, 7, "Зал вибродатчиков");
    goalPos.e1 = goalPos.e2 = [P.cx, P.cy];
    frame(P, e.goal("e1") && e.goal("e2") ? "gold" : null);
    let shake = 0;
    sc.probes.forEach(p => { if (!p.aligned) { const a = Math.atan2(p.v[1], p.v[0]), b = Math.atan2(p.Av[1], p.Av[0]); shake += Math.abs(Math.sin(a - b)); } });
    clip(P);
    for (let x = -P.R; x <= P.R; x++) for (let y = -P.R; y <= P.R; y++) {
      const j = shake * 2.2 * Math.sin(e.t * 31 + x * 3.1 + y * 1.7);
      ctx.fillStyle = rgba(col.ink, 0.18 + 0.12 * Math.min(1, shake)); ctx.beginPath(); ctx.arc(P.X(x) + j, P.Y(y) - j * 0.6, 2, 0, Math.PI * 2); ctx.fill();
    }
    sc.probes.forEach(p => {
      const c = e.color(p.roleD), sc2 = 2.6 / Math.hypot(p.v[0], p.v[1]);
      const v = twPts(`ev${p.k}`, [[p.v[0] * sc2, p.v[1] * sc2]], e.dt)[0];
      let Av = [p.Av[0] * sc2, p.Av[1] * sc2];
      const L = Math.hypot(Av[0], Av[1]), maxL = P.R - 0.4;
      if (L > maxL) Av = [Av[0] * maxL / L, Av[1] * maxL / L];
      Av = twPts(`ea${p.k}`, [Av], e.dt)[0];
      const okc = e.goal("e" + p.k) ? col.gold : p.aligned ? col.ok : rgba(c, 0.5);
      lineThrough(P, p.v, okc, p.aligned ? 3 : 1.4, p.aligned ? [] : [6, 6]);
      arrow(P, [0, 0], Av, col.ink, 2.4); label(P, Av, "Av", col.ink, 8, -10, 12);
      arrow(P, [0, 0], v, c, 4); label(P, v, `v${p.k === 1 ? "₁" : "₂"}`, c, 8, 12, 13);
    });
    ctx.restore();
    sc.probes.forEach((p, i) => note(P.x + 12, P.y + 36 + i * 26, `щуп ${p.k}: v = ${C.tup(p.v)}, Av = ${C.tup(p.Av)}${p.aligned ? `, растяжение ${C.num(p.L)}` : " — уводит в сторону"}; λ = ${C.num(p.lam)}`, p.ok ? col.ok : col.ink, 13));
    if (e.goal("e1") && e.goal("e2")) stamp(P, "ТИШИНА", col.gold);
  };
  D.kernel = (sc, e) => {
    goalPos.all = [W / 2, H / 2];
    const r = Math.min(W / 5.5, H / 3.2);
    [[sc.s1, "датчик 1", sc.r1], [sc.s2, "датчик 2", sc.r2]].forEach(([s, t, rr], k) => {
      const v = twN(`kv${k}`, s, e.dt, 10);
      gauge(W * (0.3 + 0.4 * k), H * 0.38, r, v, 0, -30, 30, t, linText(rr, ["x", "y", "z"]), s === 0 && !sc.empty);
    });
    const vs = ["x", "y", "z"], by = H * 0.9;
    vs.forEach((v, k) => {
      const cx = W * (0.3 + 0.2 * k), c = e.color("w" + v), n = sc.x[k];
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      for (let i = 0; i < Math.min(9, Math.abs(n)); i++) {
        const y = by - 20 - i * 15;
        if (n > 0) { ctx.fillStyle = c; ctx.fillRect(cx - 16, y - 11, 32, 12); }
        else { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, y - 18 - i * 2, 9, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.fillStyle = c; ctx.font = `800 22px ${MONO}`; ctx.fillText(`${v} = ${C.num(n)}`, cx, by + 6);
      ctx.restore();
    });
    if (e.goal("all")) stamp({ cx: W / 2, cy: H * 0.55, w: W * 0.6 }, "ДАТЧИКИ МОЛЧАТ", col.gold);
  };

  // ---------- эффекты ----------
  function burst(x, y, c, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (sp || 220) * (0.3 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 1, c, s: 2 + Math.random() * 3 });
    }
  }
  function fx(kind, goalId) {
    const p = goalPos[goalId] || [W / 2, H / 2];
    if (kind === "lock") burst(p[0], p[1], col.gold, 40);
    else if (kind === "win") { burst(W / 2, H / 2, col.gold, 120, 380); burst(W / 2, H / 2, col.ok, 50, 260); }
    else if (kind === "treasure" || kind === "open") { burst(p[0], p[1], col.gold, 140, 420); }
    else if (kind === "caught") { shakeT = 0.6; shakeAmp = 14; flashT = 0.5; flashC = "alarm"; }
    else if (kind === "bad") { shakeT = 0.35; shakeAmp = 7; flashT = 0.3; flashC = "alarm"; }
    else if (kind === "place") burst(p[0], p[1], col.gold, 24, 160);
    else if (kind === "burn") burst(p[0], p[1], col.alarm, 30, 180);
  }
  function setBanner(text, sub, kind, dur) { banner = { text, sub, kind, t0: performance.now(), dur: dur || 2200 }; }

  function overlay(env) {
    const now = env.now;
    // тревога по краям
    if (env.alarm > 60) {
      const a = Math.min(0.5, (env.alarm - 60) / 80) * (0.6 + 0.4 * Math.sin(now / 180));
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, rgba(col.alarm, a));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // обход охраны
    if (env.guard && env.guard.state === "check") {
      const p = env.guard.p, x = W * (0.08 + 0.84 * p), y = H * (0.45 + 0.18 * Math.sin(p * 7)), r = Math.min(W, H) * 0.24;
      ctx.save();
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, "rgba(255,248,214,0.22)"); g.addColorStop(1, "rgba(5,10,20,0.66)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(5,10,20,0.66)"; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(x, y, r, 0, Math.PI * 2, true); ctx.fill();
      ctx.font = `800 ${Math.max(18, W / 34)}px ${DISP}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "#ffe9a8"; ctx.fillText("ОХРАНА СМОТРИТ — НЕ ДВИГАЙТЕСЬ", W / 2, 20);
      ctx.restore();
    } else if (env.guard && env.guard.state === "warn" && env.guard.public) {
      ctx.save(); ctx.font = `700 15px ${MONO}`; ctx.fillStyle = col.alarm; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 120); ctx.fillText("…слышны шаги…", W / 2, 16); ctx.restore();
    }
    if (env.siren) {
      ctx.save(); ctx.fillStyle = rgba(col.alarm, 0.25 + 0.2 * Math.sin(now / 90)); ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    // вспышка
    if (flashT > 0) { ctx.save(); ctx.fillStyle = rgba(col[flashC], Math.min(0.45, flashT)); ctx.fillRect(0, 0, W, H); ctx.restore(); }
    // частицы
    parts.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); });
    ctx.globalAlpha = 1;
    // баннер
    if (banner) {
      const q = (now - banner.t0) / banner.dur;
      if (q > 1) banner = null;
      else {
        const a = q < 0.15 ? q / 0.15 : q > 0.8 ? (1 - q) / 0.2 : 1, sc = 0.9 + 0.1 * ease(q * 4);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.scale(sc, sc);
        const c = banner.kind === "bad" ? col.alarm : banner.kind === "ok" ? col.ok : col.gold;
        ctx.font = `800 ${Math.max(26, W / 18)}px ${DISP}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const w = ctx.measureText(banner.text).width + 60, h = Math.max(70, W / 11);
        ctx.fillStyle = rgba(col.paper, 0.9); ctx.fillRect(-w / 2, -h / 2, w, h + (banner.sub ? 30 : 0));
        ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.strokeRect(-w / 2, -h / 2, w, h + (banner.sub ? 30 : 0));
        ctx.fillStyle = c; ctx.fillText(banner.text, 0, 0);
        if (banner.sub) { ctx.font = `600 ${Math.max(14, W / 70)}px ${BODY}`; ctx.fillStyle = col.ink; ctx.fillText(banner.sub, 0, h / 2 + 4); }
        ctx.restore();
      }
    }
  }

  // ---------- кадр ----------
  function frameDraw(kind, scene, env) {
    if (!ctx) return;
    const dt = env.dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col.paper; ctx.fillRect(0, 0, W, H);
    let ox = 0, oy = 0;
    if (shakeT > 0) { shakeT -= dt; ox = (Math.random() - 0.5) * shakeAmp; oy = (Math.random() - 0.5) * shakeAmp; }
    if (flashT > 0) flashT -= dt;
    ctx.save(); ctx.translate(ox, oy);
    if (scene && D[kind]) {
      try { D[kind](scene, env); } catch (er) { if (!frameDraw.warned) { frameDraw.warned = true; console.warn("render", kind, er); } }
    }
    ctx.restore();
    parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 320 * dt; p.life -= dt * 0.9; });
    parts = parts.filter(p => p.life > 0);
    overlay(env);
  }

  root.Render = { attach, resize, readColors, frame: frameDraw, fx, banner: setBanner, colors: () => col, clearTweens: () => TW.clear() };
})(typeof window !== "undefined" ? window : globalThis);
