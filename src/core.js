/* Банда «Базис» — ядро живой игры: дела, уровни-механизмы, роли-пульты, проверка целей, действия, допрос.
   Чистые функции без DOM: один и тот же код комнаты даёт одинаковые уровни на всех устройствах. */
(function (root) {
  "use strict";
  const MINUS = "−";

  // ---------- случайность по сиду ----------
  function hashStr(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const next = mulberry32(hashStr(seed));
    const r = {
      next,
      int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      nz(lo, hi) { let v; do { v = r.int(lo, hi); } while (v === 0); return v; },
      pick(a) { return a[Math.floor(next() * a.length)]; },
      shuffle(a) {
        const b = a.slice();
        for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
        return b;
      },
    };
    return r;
  }

  // ---------- числа и векторы ----------
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; };
  const det2 = m => m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const mulMV = (m, v) => m.map(row => row.reduce((s, x, j) => s + x * v[j], 0));
  const mulMM = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const cr2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  const parallel = (a, b) => cr2(a, b) === 0;
  const isAxis = w => w[0] === 0 || w[1] === 0;
  const z0 = x => (x === 0 ? 0 : x);
  const zz = p => [z0(p[0]), z0(p[1])];
  const eqArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const eqP = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  const eqPts = (A, B) => A.length === B.length && A.every((p, i) => eqP(p, B[i]));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const inBox = (p, r) => Math.abs(p[0]) <= r && Math.abs(p[1]) <= r;

  // ---------- форматирование ----------
  const num = x => (x < 0 ? MINUS + Math.abs(x) : String(z0(x)));
  const tup = v => "(" + v.map(num).join(", ") + ")";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stripTags = s => String(s).replace(/<[^>]*>/g, "");
  function mx(rows) {
    const c = rows[0].length;
    const cells = rows.flat().map(x => `<span>${typeof x === "number" ? num(x) : x}</span>`).join("");
    return `<span class="mx" style="--c:${c}">${cells}</span>`;
  }
  const col = v => mx(v.map(x => [x]));
  const eqn = (lhs, rhs) => `<div class="mline"><span class="mv">${lhs}</span><span class="meq">=</span>${rhs}</div>`;
  function lin(coefs, vars) {
    let out = "";
    coefs.forEach((c, i) => {
      if (c === 0) return;
      const a = Math.abs(c);
      const t = (a === 1 ? "" : a) + `<i>${vars[i]}</i>`;
      out += out === "" ? (c < 0 ? MINUS : "") + t : (c < 0 ? ` ${MINUS} ` : " + ") + t;
    });
    return out || "0";
  }
  function linNum(coefs, vals) {
    let out = "";
    coefs.forEach((c, i) => {
      if (c === 0) return;
      const v = vals[i] < 0 ? "(" + num(vals[i]) + ")" : num(vals[i]);
      const t = `${Math.abs(c)}·${v}`;
      out += out === "" ? (c < 0 ? MINUS : "") + t : (c < 0 ? ` ${MINUS} ` : " + ") + t;
    });
    return out || "0";
  }
  const lin2 = (a, A, c, C) => `${num(a)}·${A} ${c < 0 ? MINUS : "+"} ${Math.abs(c)}·${C}`;
  function poly2(t, d) {
    let s = "λ²";
    if (t !== 0) s += (t > 0 ? ` ${MINUS} ` : " + ") + (Math.abs(t) === 1 ? "" : Math.abs(t)) + "λ";
    if (d !== 0) s += (d > 0 ? " + " : ` ${MINUS} `) + Math.abs(d);
    return s;
  }
  const raza = k => { const a = Math.abs(k) % 100, b = a % 10; return (b >= 2 && b <= 4 && (a < 12 || a > 14)) ? "раза" : "раз"; };
  function stretch(l) {
    if (l === 1) return "он вообще не изменился";
    if (l === -1) return "он развернулся в обратную сторону";
    if (l > 1) return `он растянулся в ${l} ${raza(l)}`;
    return `он развернулся и растянулся в ${Math.abs(l)} ${raza(l)}`;
  }

  // ---------- движения плоскости ----------
  function rotV(v, deg) {
    switch (((deg % 360) + 360) % 360) {
      case 0: return [v[0], v[1]];
      case 90: return [-v[1], v[0]];
      case 180: return [-v[0], -v[1]];
      default: return [v[1], -v[0]];
    }
  }
  const Rot = (o, deg) => p => zz(add(o, rotV(sub(p, o), deg)));
  const Tr = v => p => zz(add(p, v));
  const Sx = a => p => zz([2 * a - p[0], p[1]]);
  const Sy = b => p => zz([p[0], 2 * b - p[1]]);
  const Sd = c => p => zz([p[1] - c, p[0] + c]);
  const Sa = c => p => zz([c - p[1], c - p[0]]);
  const LINE_F = { x: Sx, y: Sy, d: Sd, a: Sa };
  const along = (k, s) => (k === "x" ? [0, s] : k === "y" ? [s, 0] : k === "d" ? [s, s] : [s, -s]);
  const comp = (...fs) => p => fs.reduceRight((acc, f) => f(acc), p);
  function fixedPoint(s, t) {
    let C;
    if (s === 90) C = [(t[0] - t[1]) / 2, (t[0] + t[1]) / 2];
    else if (s === 180) C = [t[0] / 2, t[1] / 2];
    else C = [(t[0] + t[1]) / 2, (t[1] - t[0]) / 2];
    return Number.isInteger(C[0]) && Number.isInteger(C[1]) ? zz(C) : null;
  }
  function lineText(kind, v) {
    if (kind === "x") return `<i>x</i> = ${num(v)}`;
    if (kind === "y") return `<i>y</i> = ${num(v)}`;
    const head = kind === "d" ? "<i>y</i> = <i>x</i>" : `<i>y</i> = ${MINUS}<i>x</i>`;
    return v === 0 ? head : `${head} ${v < 0 ? MINUS : "+"} ${Math.abs(v)}`;
  }
  const Rh = (c, a) => `<i>R</i><span class="ss"><span>${a}</span><span>${c}</span></span>`;
  const Zh = c => `<i>Z</i><sub>${c}</sub>`;
  const Sh = l => `<i>S</i><sub>${l}</sub>`;
  const Th = v => `<i>T</i><sub>${v}</sub>`;
  const ANG = [90, 180, 270];
  const ANG_OPTS = ["90°", "180°", "270°"];
  const KIND4 = ["Перенос", "Поворот", "Осевая", "Скользящая"];
  const FORMULAS = `<p class="f">90°: <i>x</i>′ = <i>x</i>₀ ${MINUS} (<i>y</i> ${MINUS} <i>y</i>₀), <i>y</i>′ = <i>y</i>₀ + (<i>x</i> ${MINUS} <i>x</i>₀)<br>180°: <i>x</i>′ = 2<i>x</i>₀ ${MINUS} <i>x</i>, <i>y</i>′ = 2<i>y</i>₀ ${MINUS} <i>y</i><br>270°: <i>x</i>′ = <i>x</i>₀ + (<i>y</i> ${MINUS} <i>y</i>₀), <i>y</i>′ = <i>y</i>₀ ${MINUS} (<i>x</i> ${MINUS} <i>x</i>₀)</p>`;

  // направления для компаса: примитивные векторы с координатами до 3, с точностью до знака
  const DIRS = (() => {
    const d = [];
    for (let x = -3; x <= 3; x++) for (let y = 0; y <= 3; y++) {
      if ((x === 0 && y === 0) || (y === 0 && x < 0) || gcd(x, y) !== 1) continue;
      d.push([x, y]);
    }
    return d.sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
  })();
  const dirIndex = v => { const g = gcd(v[0], v[1]); let w = [v[0] / g, v[1] / g]; if (w[1] < 0 || (w[1] === 0 && w[0] < 0)) w = [-w[0], -w[1]]; return DIRS.findIndex(d => eqP(d, zz(w))); };

  // ---------- роли ----------
  const val = (V, r, k, d) => (V && V[r] && V[r][k] !== undefined ? V[r][k] : d);
  const LOOK = () => ({ id: "look", name: "Сторож", desc: "Ты видишь охрану заранее. Когда на телефоне пойдёт отсчёт, кричи «Шухер!»: кто в этот момент крутит пульт, тот шумит.", w: [{ t: "radar" }], init: {}, req: false });
  const KNOW = k => ({ id: "know" + k, name: "Знаток", desc: "У тебя справочник по этому сейфу. Сам ничего не двигаешь — подсказывай банде, что и почему крутить.", w: [{ t: "theory" }], init: {}, req: false });
  function withExtras(req, n) {
    const out = req.slice();
    let spare = n - req.length;
    if (spare >= 1) { out.push(LOOK()); spare--; }
    for (let k = 0; spare > 0; k++, spare--) out.push(KNOW(k));
    return out;
  }
  // раздача ролей по местам: закреплённые за местом, затем обязательные по кругу со сдвигом, затем остальные — самым свободным
  function assignRoles(roles, n, shift) {
    n = Math.max(1, n | 0);
    const asg = {}, load = Array(n).fill(0);
    roles.filter(r => r.seat !== undefined).forEach(r => { const s = r.seat % n; asg[r.id] = s; load[s]++; });
    let i = 0;
    roles.filter(r => r.seat === undefined && r.req).forEach(r => { const s = (shift + i++) % n; asg[r.id] = s; load[s]++; });
    roles.filter(r => r.seat === undefined && !r.req).forEach(r => {
      let best = -1;
      for (let k = 0; k < n; k++) { const s = (shift + k) % n; if (best < 0 || load[s] < load[best]) best = s; }
      asg[r.id] = best; load[best]++;
    });
    return asg;
  }

  // значение пульта из чужого presence — недоверенное: приводим к форме роли или отбрасываем
  function sanitizeRoleVal(role, v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out = {};
    for (const w of role.w) {
      if (!w.k || w.t === "action") continue;
      const x = v[w.k];
      if (w.t === "stepper") { if (!Number.isInteger(x) || x < w.min || x > w.max) return null; out[w.k] = x; }
      else if (w.t === "pick" || w.t === "dial") { if (!Number.isInteger(x) || x < (w.none ? -1 : 0) || x >= w.opts.length) return null; out[w.k] = x; }
      else if (w.t === "nums") { if (!Array.isArray(x) || x.length !== w.fields.length || !x.every(s => typeof s === "string" && /^-?\d{0,3}$/.test(s))) return null; out[w.k] = x.slice(); }
      else if (w.t === "compass") { if (!Number.isInteger(x) || x < 0 || x >= DIRS.length) return null; out[w.k] = x; }
      else if (w.t === "point" || w.t === "vec") { if (!Array.isArray(x) || x.length !== 2 || !x.every(z => Number.isInteger(z) && Math.abs(z) <= w.R)) return null; out[w.k] = [z0(x[0]), z0(x[1])]; }
      else if (w.t === "line") { if (!x || typeof x !== "object" || !(w.kinds || ["x", "y", "d", "a"]).includes(x.k) || !Number.isInteger(x.v) || Math.abs(x.v) > w.R) return null; out[w.k] = { k: x.k, v: z0(x.v) }; }
    }
    return out;
  }

  // =====================================================================
  // Дело №1. Банк «Базис» — линейная алгебра
  // =====================================================================

  // ---------- 1. Парадная дверь: линейная комбинация ----------
  function comboData(rng) {
    let u, v, D;
    do {
      u = [rng.int(-3, 3), rng.int(-3, 3)];
      v = [rng.int(-3, 3), rng.int(-3, 3)];
      D = cr2(u, v);
    } while (D === 0 || (isAxis(u) && isAxis(v)) || Math.abs(D) > 9);
    let a, c, b;
    do {
      a = rng.nz(-4, 4); c = rng.nz(-4, 4);
      b = [a * u[0] + c * v[0], a * u[1] + c * v[1]];
    } while (!inBox(b, 11) || (b[0] === 0 && b[1] === 0));
    return { u, v, D, a, c, b };
  }
  function lvCombo(rng) {
    const doors = [comboData(rng), comboData(rng)];
    return {
      kind: "combo", title: "Парадная дверь", win: "Дверь открыта!", topic: "Линейная комбинация и базис", par: 150,
      story: "Замок двери открывает робот-манипулятор. Он ездит только вдоль двух рельсов — векторов <b>u</b> и <b>v</b>. У каждого рельса свой оператор.",
      goal: "Доведите манипулятор до скважины <b>b</b>: <i>a</i>·<b>u</b> + <i>c</i>·<b>v</b> = <b>b</b>.",
      hint: "Распишите <i>a</i>·<b>u</b> + <i>c</i>·<b>v</b> = <b>b</b> по координатам: получится система из двух уравнений с неизвестными <i>a</i> и <i>c</i>.",
      theory: [
        { title: "Линейная комбинация", html: `<p>Равенство <i>a</i>·<b>u</b> + <i>c</i>·<b>v</b> = <b>b</b> — это два уравнения, по одному на координату:</p><p class="f"><i>a</i>·u₁ + <i>c</i>·v₁ = b₁<br><i>a</i>·u₂ + <i>c</i>·v₂ = b₂</p>` },
        { title: "Правило Крамера", html: `<p class="f">Δ = u₁v₂ ${MINUS} u₂v₁<br><i>a</i> = (b₁v₂ ${MINUS} b₂v₁) / Δ<br><i>c</i> = (u₁b₂ ${MINUS} u₂b₁) / Δ</p>` },
      ],
      roles(n) {
        const k = n >= 4 ? 2 : 1, req = [];
        for (let d = 0; d < k; d++) {
          const sfx = k > 1 ? ` · дверь ${d + 1}` : "";
          req.push({ id: `a${d}`, name: `Рельс u${sfx}`, desc: "Двигаешь манипулятор вдоль рельса u: число шагов a. Минус — ход назад.", w: [{ k: "s", t: "stepper", label: "Шагов вдоль u", min: -9, max: 9 }], init: { s: 0 }, req: true, info: `<p class="f"><b>u</b> = ${tup(doors[d].u)}</p>` });
          req.push({ id: `c${d}`, name: `Рельс v${sfx}`, desc: "Двигаешь манипулятор вдоль рельса v: число шагов c. Минус — ход назад.", w: [{ k: "s", t: "stepper", label: "Шагов вдоль v", min: -9, max: 9 }], init: { s: 0 }, req: true, info: `<p class="f"><b>v</b> = ${tup(doors[d].v)}</p>` });
        }
        return withExtras(req, n);
      },
      initAux: n => ({ k: n >= 4 ? 2 : 1, latched: {} }),
      evaluate(V, aux) {
        const ds = doors.slice(0, aux.k).map((dr, d) => {
          const a = val(V, `a${d}`, "s", 0), c = val(V, `c${d}`, "s", 0);
          const tip = [a * dr.u[0] + c * dr.v[0], a * dr.u[1] + c * dr.v[1]];
          return { u: dr.u, v: dr.v, b: dr.b, a, c, tip, ok: eqP(tip, dr.b), roleA: `a${d}`, roleC: `c${d}` };
        });
        return { goals: ds.map((d, i) => ({ id: "door" + i, label: aux.k > 1 ? `Дверь ${i + 1}: ключ в скважине` : "Ключ в скважине", ok: d.ok, latch: true })), scene: { doors: ds } };
      },
      solution: aux => { const V = {}; for (let d = 0; d < aux.k; d++) { V[`a${d}`] = { s: doors[d].a }; V[`c${d}`] = { s: doors[d].c }; } return V; },
      debrief(V, aux) {
        return doors.slice(0, aux.k).map((dr, d) => `<p>${aux.k > 1 ? `<b>Дверь ${d + 1}.</b> ` : ""}Рельсы не параллельны: Δ = u₁v₂ ${MINUS} u₂v₁ = ${num(dr.D)} ≠ 0. Поэтому <b>u</b> и <b>v</b> образуют <b>базис</b> плоскости: манипулятор доезжает до любой точки, причём только одним способом.</p>
<p class="f">${lin2(dr.a, tup(dr.u), dr.c, tup(dr.v))} = ${tup(dr.b)}</p>`).join("") + `<p>Числа <i>a</i> и <i>c</i> — это <b>координаты</b> вектора <b>b</b> в базисе (<b>u</b>, <b>v</b>). Теперь понятно, почему банк называется «Базис».</p>`;
      },
    };
  }

  // ---------- 2. Комната охраны: матрица по образам ----------
  function lvMatrix(rng) {
    let A;
    do {
      A = [[rng.int(-3, 3), rng.int(-3, 3)], [rng.int(-3, 3), rng.int(-3, 3)]];
    } while (det2(A) === 0 || A[0][1] === A[1][0] || A.flat().filter(x => x === 0).length > 1);
    const p = mulMV(A, [1, 1]).map(z0), q = mulMV(A, [1, -1]).map(z0);
    const e1 = [A[0][0], A[1][0]], e2 = [A[0][1], A[1][1]];
    return {
      kind: "matrix", title: "Комната охраны", win: "Запись подменена!", topic: "Матрица линейного преобразования", par: 180,
      story: "Видео с камер идёт через шифратор — линейное преобразование плоскости. Банда собирает поддельный шифратор: двигает образы базисных векторов, пока подделка не начнёт отправлять перехваченные кадры туда же, куда настоящий.",
      goal: `Сделайте так, чтобы <i>M</i>·(1, 1) = ${tup(p)} и <i>M</i>·(1, ${MINUS}1) = ${tup(q)}.`,
      hint: `<i>M</i>·(1, 1) = столбец₁ + столбец₂, а <i>M</i>·(1, ${MINUS}1) = столбец₁ ${MINUS} столбец₂. Сложите и вычтите перехваты, а потом поделите пополам.`,
      theory: [
        { title: "Столбцы матрицы", html: `<p>Первый столбец матрицы — образ e₁ = (1, 0), второй — образ e₂ = (0, 1). Образы базисных векторов пишут в <b>столбцы</b>.</p>` },
        { title: "Линейность", html: `<p class="f"><i>M</i>(1, 1) = <i>M</i>e₁ + <i>M</i>e₂<br><i>M</i>(1, ${MINUS}1) = <i>M</i>e₁ ${MINUS} <i>M</i>e₂</p>` },
      ],
      roles(n) {
        const req = n >= 4
          ? [["c1x", "Столбец 1 · x", "первую координату образа e₁"], ["c1y", "Столбец 1 · y", "вторую координату образа e₁"], ["c2x", "Столбец 2 · x", "первую координату образа e₂"], ["c2y", "Столбец 2 · y", "вторую координату образа e₂"]]
            .map(([id, name, what]) => ({ id, name, desc: `Двигаешь ${what}.`, w: [{ k: "s", t: "stepper", label: name, min: -6, max: 6 }], init: { s: 0 }, req: true }))
          : [{ id: "c1", name: "Столбец 1", desc: "Двигаешь образ e₁ = (1, 0) — первый столбец матрицы.", w: [{ k: "v", t: "vec", label: "Образ e₁", R: 6 }], init: { v: [1, 0] }, req: true },
            { id: "c2", name: "Столбец 2", desc: "Двигаешь образ e₂ = (0, 1) — второй столбец матрицы.", w: [{ k: "v", t: "vec", label: "Образ e₂", R: 6 }], init: { v: [0, 1] }, req: true }];
        return withExtras(req, n);
      },
      initAux: n => ({ split: n >= 4, latched: {} }),
      cols(V, aux) {
        return aux.split
          ? [[val(V, "c1x", "s", 1), val(V, "c1y", "s", 0)], [val(V, "c2x", "s", 0), val(V, "c2y", "s", 1)]]
          : [val(V, "c1", "v", [1, 0]), val(V, "c2", "v", [0, 1])];
      },
      evaluate(V, aux) {
        const [c1, c2] = this.cols(V, aux);
        const mp = add(c1, c2), mq = sub(c1, c2);
        return { goals: [{ id: "p", label: `Перехват 1: (1, 1) → ${tup(p)}`, ok: eqP(mp, p) }, { id: "q", label: `Перехват 2: (1, ${MINUS}1) → ${tup(q)}`, ok: eqP(mq, q) }, { id: "all", label: "Шифратор подменён", ok: eqP(mp, p) && eqP(mq, q), latch: true, hidden: true }], scene: { c1, c2, mp, mq, p, q, roles: aux.split ? ["c1x", "c2x"] : ["c1", "c2"] } };
      },
      solution: aux => aux.split ? { c1x: { s: e1[0] }, c1y: { s: e1[1] }, c2x: { s: e2[0] }, c2y: { s: e2[1] } } : { c1: { v: e1 }, c2: { v: e2 } },
      debrief() {
        return `<p>Столбцы матрицы — это образы базисных векторов. По линейности:</p>
<p class="f">столбец₁ = ½(${tup(p)} + ${tup(q)}) = ${tup(e1)}<br>столбец₂ = ½(${tup(p)} ${MINUS} ${tup(q)}) = ${tup(e2)}</p>
${eqn("<i>A</i>", mx(A))}
<p>Линейное преобразование целиком определяется тем, куда оно отправляет базис. Частая ловушка — записать образы в строки: получится транспонированная матрица.</p>`;
      },
    };
  }

  // ---------- 3. Лазерный коридор: определитель ----------
  function collapseData(rng) {
    for (;;) {
      const g = [rng.nz(-3, 3), rng.nz(-3, 3)];
      if (gcd(g[0], g[1]) !== 1) continue;
      const s1 = rng.nz(-3, 3), s2 = rng.nz(-3, 3);
      const k = s1 * g[0], c = s1 * g[1], b = s2 * g[0], j = s2 * g[1];
      if ([k, c, b, j].some(x => Math.abs(x) > 8)) continue;
      const t = rng.pick([2, 3, -2, -3]);
      const Vt = [t * g[0], t * g[1]];
      if (!inBox(Vt, 9)) continue;
      return { g, k, c, b, j, V: Vt, k0: z0(k === 1 ? 2 : 1), j0: z0(j === 1 ? -1 : 1) };
    }
  }
  function lvCollapse(rng) {
    const grids = [collapseData(rng), collapseData(rng)];
    return {
      kind: "collapse", title: "Лазерный коридор", win: "Лаз открыт!", topic: "Определитель", par: 180,
      story: "Лазерная решётка — это образ клетчатой плоскости под матрицей. Пока определитель не ноль, лучи покрывают всё. Когда он обнуляется, решётка схлопывается в одну линию.",
      goal: "Схлопните решётку (det = 0) так, чтобы линия лучей прошла через люк.",
      hint: "det = 0, когда столбцы параллельны. Линия лучей идёт вдоль столбцов, значит, столбец (<i>b</i>, <i>j</i>) должен смотреть на люк. Найдите <i>j</i>, потом <i>k</i>.",
      theory: [
        { title: "Определитель — площадь", html: `<p>|det <i>M</i>| — во сколько раз матрица меняет площади. Единичный квадрат переходит в параллелограмм на столбцах матрицы.</p>` },
        { title: "Когда det = 0", html: `<p>det <i>M</i> = 0 ⇔ столбцы параллельны ⇔ вся плоскость сплющивается в прямую — ту, вдоль которой идут столбцы.</p>` },
      ],
      roles(n) {
        const k = n >= 4 ? 2 : 1, req = [];
        for (let d = 0; d < k; d++) {
          const sfx = k > 1 ? ` · решётка ${d + 1}` : "";
          req.push({ id: `k${d}`, name: `Регулятор k${sfx}`, desc: "Крутишь левый верхний элемент матрицы.", w: [{ k: "s", t: "stepper", label: "k", min: -9, max: 9 }], init: { s: grids[d].k0 }, req: true });
          req.push({ id: `j${d}`, name: `Регулятор j${sfx}`, desc: "Крутишь правый нижний элемент матрицы.", w: [{ k: "s", t: "stepper", label: "j", min: -9, max: 9 }], init: { s: grids[d].j0 }, req: true });
        }
        return withExtras(req, n);
      },
      initAux: n => ({ k: n >= 4 ? 2 : 1, latched: {} }),
      evaluate(V, aux) {
        const gs = grids.slice(0, aux.k).map((gr, d) => {
          const k = val(V, `k${d}`, "s", gr.k0), j = val(V, `j${d}`, "s", gr.j0);
          const M = [[k, gr.b], [gr.c, j]], D = det2(M);
          const c1 = [k, gr.c], c2 = [gr.b, j];
          const flat = D === 0, vent = flat && parallel(c2, gr.V) && parallel(c1, gr.V);
          return { M, D, c1, c2, Vt: gr.V, flat, vent, roleK: `k${d}`, roleJ: `j${d}` };
        });
        const goals = [];
        gs.forEach((g, i) => {
          const sfx = aux.k > 1 ? ` · решётка ${i + 1}` : "";
          goals.push({ id: "flat" + i, label: `det = 0${sfx}`, ok: g.flat });
          goals.push({ id: "vent" + i, label: `Линия через люк${sfx}`, ok: g.vent, latch: true });
        });
        return { goals, scene: { grids: gs } };
      },
      solution: aux => { const V = {}; for (let d = 0; d < aux.k; d++) { V[`k${d}`] = { s: grids[d].k }; V[`j${d}`] = { s: grids[d].j }; } return V; },
      debrief(V, aux) {
        return grids.slice(0, aux.k).map((g, d) => `<p>${aux.k > 1 ? `<b>Решётка ${d + 1}.</b> ` : ""}Столбец (${num(g.b)}, <i>j</i>) должен идти вдоль направления на люк ${tup(g.V)}, поэтому <i>j</i> = ${num(g.j)}. Тогда det = ${num(g.k === 0 ? 0 : g.k)}·${g.j < 0 ? "(" + num(g.j) + ")" : num(g.j)} ${MINUS} ${g.b < 0 ? "(" + num(g.b) + ")" : num(g.b)}·${g.c < 0 ? "(" + num(g.c) + ")" : num(g.c)} = 0 при <i>k</i> = ${num(g.k)}.</p>
${eqn("<i>M</i>", mx([[g.k, g.b], [g.c, g.j]]))}`).join("") + `<p>Определитель — коэффициент изменения площади. Когда он равен нулю, столбцы параллельны и вся плоскость сплющивается в одну прямую: решётка превращается в линию.</p>`;
      },
    };
  }

  // ---------- 4. Кодовый сейф: система уравнений ----------
  function lvGauges(rng) {
    for (let t = 0; t < 20000; t++) {
      const sol = [rng.int(1, 9), rng.int(0, 9), rng.int(1, 9)];
      if (sol[0] === sol[1] && sol[1] === sol[2]) continue;
      const M = [0, 1, 2].map(() => [rng.int(-3, 3), rng.int(-3, 3), rng.int(-3, 3)]);
      const D = det3(M);
      if (D === 0) continue;
      if (M.some(rr => rr.filter(x => x !== 0).length < 2)) continue;
      if (!M.some(rr => Math.abs(rr[0]) === 1)) continue;
      const d = mulMV(M, sol);
      if (d.some(x => Math.abs(x) > 40)) continue;
      const V = ["x", "y", "z"];
      const init = [0, 0, 0];
      if (eqArr(mulMV(M, init), d)) continue;
      return {
        kind: "gauges", title: "Кодовый сейф", win: "Сейф вскрыт!", topic: "Системы уравнений", par: 210,
        story: "Код сейфа — три цифры <i>x</i>, <i>y</i>, <i>z</i>. У каждой цифры свой барабан и свой медвежатник. Три стрелки на сейфе показывают левые части уравнений — каждая цифра двигает каждую стрелку на свой коэффициент.",
        goal: "Поставьте все три стрелки на отметки. Каждая цифра — от 0 до 9.",
        hint: "Возьмите уравнение, где перед <i>x</i> стоит 1 или −1. Выразите <i>x</i> и подставьте в два других — останется система с двумя неизвестными.",
        theory: [
          { title: "Метод Гаусса", html: `<p>Вычитайте из уравнения другое, умноженное на число, чтобы исключать неизвестные по одной. Система станет ступенчатой: найдите <i>z</i>, потом <i>y</i>, потом <i>x</i>.</p>` },
          { title: "Уравнения стрелок", html: `<p class="f">${[0, 1, 2].map(r => `${lin(M[r], V)} = ${num(d[r])}`).join("<br>")}</p>` },
        ],
        roles(n) {
          const req = [0, 1, 2].map(i => ({ id: "d" + V[i], name: `Барабан ${V[i]}`, desc: `Крутишь цифру ${V[i]}. Смотри, как от неё двигаются все три стрелки.`, w: [{ k: "s", t: "stepper", label: V[i], min: 0, max: 9, wrap: true }], init: { s: 0 }, req: true, info: `<p>Коэффициенты при <i>${V[i]}</i> в трёх уравнениях: ${M.map(rr => num(rr[i])).join(", ")}.</p>` }));
          return withExtras(req, n);
        },
        initAux: () => ({ latched: {} }),
        evaluate(Vv) {
          const x = [val(Vv, "dx", "s", 0), val(Vv, "dy", "s", 0), val(Vv, "dz", "s", 0)];
          const g = mulMV(M, x);
          return { goals: [0, 1, 2].map(r => ({ id: "g" + r, label: `Стрелка ${r + 1}: ${stripTags(lin(M[r], V))} = ${num(d[r])}`, ok: g[r] === d[r] })).concat([{ id: "all", label: "Код набран", ok: eqArr(g, d), latch: true, hidden: true }]), scene: { M, d, g, x } };
        },
        solution: () => ({ dx: { s: sol[0] }, dy: { s: sol[1] }, dz: { s: sol[2] } }),
        debrief() {
          return `<p>Подставим код ${tup(sol)} в каждое уравнение:</p>
<p class="f">${[0, 1, 2].map(r => `${linNum(M[r], sol)} = ${num(d[r])} ✓`).join("<br>")}</p>
<p>Каждая цифра сдвигает каждую стрелку на свой коэффициент — это и есть линейность. Решение единственное, потому что определитель системы равен ${num(D)} ≠ 0: матрица невырождена ⇔ у системы ровно одно решение.</p>`;
        },
      };
    }
    return null;
  }

  // ---------- 5. Зал вибродатчиков: собственные векторы ----------
  function lvEigen(rng) {
    const LAMS = [-3, -2, -1, 2, 3, 4];
    for (let t = 0; t < 20000; t++) {
      const P = [[rng.int(-3, 3), rng.int(-3, 3)], [rng.int(-3, 3), rng.int(-3, 3)]];
      const dP = det2(P);
      if (Math.abs(dP) !== 1) continue;
      const c1 = [P[0][0], P[1][0]], c2 = [P[0][1], P[1][1]];
      if (isAxis(c1) && isAxis(c2)) continue;
      const l1 = rng.pick(LAMS);
      let l2; do { l2 = rng.pick(LAMS); } while (l2 === l1);
      const Pinv = [[P[1][1] * dP, -P[0][1] * dP], [-P[1][0] * dP, P[0][0] * dP]];
      const A = mulMM(mulMM(P, [[l1, 0], [0, l2]]), Pinv).map(rr => rr.map(z0));
      if (A.flat().some(x => Math.abs(x) > 9)) continue;
      if (A[0][1] === 0 && A[1][0] === 0) continue;
      const i1 = dirIndex(c1), i2 = dirIndex(c2);
      if (i1 < 0 || i2 < 0) continue;
      let s1, s2;
      do { s1 = rng.int(0, DIRS.length - 1); s2 = rng.int(0, DIRS.length - 1); } while (s1 === s2 || [s1, s2].some(s => s === i1 || s === i2));
      const tr = A[0][0] + A[1][1], dt = det2(A);
      const lamOf = i => { const v = DIRS[i], Av = mulMV(A, v); if (cr2(v, Av) !== 0) return null; return v[0] !== 0 ? Av[0] / v[0] : Av[1] / v[1]; };
      return {
        kind: "eigen", title: "Зал вибродатчиков", win: "Пол успокоился!", topic: "Собственные векторы", par: 210,
        story: "Пол зала дрожит от датчиков с матрицей <i>A</i>. Тише всего вдоль направлений, которые <i>A</i> не уводит в сторону, а только растягивает: <i>A</i>·<b>v</b> = λ·<b>v</b>. Таких направлений два.",
        goal: "Найдите оба тихих направления и их коэффициенты растяжения λ.",
        hint: "Крутите направление и следите за двумя стрелками: <b>v</b> и <i>A</i><b>v</b>. Когда они легли на одну прямую, направление тихое. λ — во сколько раз <i>A</i><b>v</b> длиннее <b>v</b> (с минусом, если смотрит назад).",
        theory: [
          { title: "Собственный вектор", html: `<p>Вектор <b>v</b> ≠ 0 — собственный, если <i>A</i>·<b>v</b> = λ·<b>v</b>: матрица переводит его в вектор на той же прямой.</p>` },
          { title: "Паспорт датчика", html: `<p class="f">tr <i>A</i> = ${num(tr)}, det <i>A</i> = ${num(dt)}</p><p>Собственные значения — корни уравнения ${poly2(tr, dt)} = 0.</p>` },
        ],
        roles(n) {
          const req = [
            { id: "d1", name: "Щуп 1", desc: "Крутишь первое направление. Тихо, когда v и Av на одной прямой.", w: [{ k: "i", t: "compass", label: "Направление 1" }], init: { i: s1 }, req: true, info: mx(A) },
            { id: "l1", name: "Множитель 1", desc: "Ставишь коэффициент λ для направления 1.", w: [{ k: "s", t: "stepper", label: "λ₁", min: -6, max: 6 }], init: { s: 1 }, req: true },
            { id: "d2", name: "Щуп 2", desc: "Крутишь второе направление — оно должно отличаться от первого.", w: [{ k: "i", t: "compass", label: "Направление 2" }], init: { i: s2 }, req: true, info: mx(A) },
            { id: "l2", name: "Множитель 2", desc: "Ставишь коэффициент λ для направления 2.", w: [{ k: "s", t: "stepper", label: "λ₂", min: -6, max: 6 }], init: { s: 1 }, req: true },
          ];
          return withExtras(req, n);
        },
        initAux: () => ({ latched: {} }),
        evaluate(V, aux) {
          const probes = [1, 2].map(k => {
            const i = val(V, "d" + k, "i", k === 1 ? s1 : s2), lam = val(V, "l" + k, "s", 1);
            const v = DIRS[i], Av = mulMV(A, v), aligned = cr2(v, Av) === 0, L = lamOf(i);
            return { k, i, v, Av, aligned, lam, L, ok: aligned && L === lam, roleD: "d" + k, roleL: "l" + k };
          });
          const diff = !parallel(probes[0].v, probes[1].v);
          return {
            goals: [{ id: "e1", label: "Тихое направление 1 и его λ", ok: probes[0].ok, latch: true },
              { id: "e2", label: "Тихое направление 2 и его λ", ok: probes[1].ok && diff, latch: true }],
            scene: { A, probes, diff },
          };
        },
        solution: () => ({ d1: { i: i1 }, l1: { s: l1 }, d2: { i: i2 }, l2: { s: l2 } }),
        debrief() {
          return `<p>Тихие направления: ${tup(DIRS[i1])} с λ = ${num(l1)} и ${tup(DIRS[i2])} с λ = ${num(l2)}. Например, <i>A</i>·${tup(DIRS[i1])} = ${tup(mulMV(A, DIRS[i1]))} = ${num(l1)}·${tup(DIRS[i1])} — ${stretch(l1)}.</p>
<p>Собственные значения — корни характеристического уравнения det(<i>A</i> ${MINUS} λ<i>E</i>) = ${poly2(tr, dt)} = 0. Их сумма равна следу ${num(tr)}, а произведение — определителю ${num(dt)}.</p>
<p>Остальные направления матрица уводит в сторону — поэтому пол и дрожал.</p>`;
        },
      };
    }
    return null;
  }

  // ---------- 6. Коридор с весами: ядро ----------
  function lvKernel(rng) {
    for (let t = 0; t < 20000; t++) {
      const r1 = [rng.int(-4, 4), rng.int(-4, 4), rng.int(-4, 4)];
      const r2 = [rng.int(-4, 4), rng.int(-4, 4), rng.int(-4, 4)];
      if (r1.filter(x => x !== 0).length < 2 || r2.filter(x => x !== 0).length < 2) continue;
      const cr = cross3(r1, r2);
      if (cr.every(x => x === 0)) continue;
      const g = gcd(gcd(cr[0], cr[1]), cr[2]);
      let k = cr.map(x => x / g);
      if (k.find(x => x !== 0) < 0) k = k.map(x => -x);
      k = k.map(z0);
      if (k.some(x => x === 0) || k.some(x => Math.abs(x) > 7)) continue;
      const V = ["x", "y", "z"];
      return {
        kind: "kernel", title: "Коридор с весами", win: "Датчики молчат!", topic: "Ядро и ранг", par: 180,
        story: "Пол коридора — два датчика давления. Банда несёт мешки трёх видов (<i>x</i>, <i>y</i>, <i>z</i> штук), а отрицательное число — это гелиевые шары, которые тянут вверх. Каждый носильщик отвечает за свой вид груза.",
        goal: "Сделайте так, чтобы оба датчика показывали 0, и при этом груз не был пустым.",
        hint: "Положите <i>z</i> = <i>t</i>, выразите <i>x</i> и <i>y</i> через <i>t</i> из двух уравнений и подберите <i>t</i>, чтобы все числа стали целыми.",
        theory: [
          { title: "Датчики", html: `<p class="f">датчик 1: ${lin(r1, V)}<br>датчик 2: ${lin(r2, V)}</p>` },
          { title: "Ядро", html: `<p>Решения <i>M</i>·<b>x</b> = 0 образуют подпространство — ядро. Если <b>x</b> — решение, то 2<b>x</b> и ${MINUS}<b>x</b> тоже.</p><p>Трюк: векторное произведение строк датчиков всегда лежит в ядре.</p>` },
        ],
        roles(n) {
          const req = [0, 1, 2].map(i => ({ id: "w" + V[i], name: `Носильщик ${V[i]}`, desc: `Отвечаешь за груз ${V[i]}: плюс — мешки, минус — шары.`, w: [{ k: "s", t: "stepper", label: V[i], min: -9, max: 9 }], init: { s: 0 }, req: true, info: `<p>Твой груз давит на датчики с весами ${num(r1[i])} и ${num(r2[i])}.</p>` }));
          return withExtras(req, n);
        },
        initAux: () => ({ latched: {} }),
        evaluate(Vv) {
          const x = [val(Vv, "wx", "s", 0), val(Vv, "wy", "s", 0), val(Vv, "wz", "s", 0)];
          const s1 = dot(r1, x), s2 = dot(r2, x), empty = x.every(v => v === 0);
          return { goals: [{ id: "s1", label: "Датчик 1 на нуле", ok: s1 === 0 && !empty }, { id: "s2", label: "Датчик 2 на нуле", ok: s2 === 0 && !empty }, { id: "all", label: "Оба датчика молчат", ok: s1 === 0 && s2 === 0 && !empty, latch: true, hidden: true }], scene: { r1, r2, x, s1, s2, empty } };
        },
        solution: () => ({ wx: { s: k[0] }, wy: { s: k[1] }, wz: { s: k[2] } }),
        debrief(Vv) {
          const x = [val(Vv, "wx", "s", 0), val(Vv, "wy", "s", 0), val(Vv, "wz", "s", 0)];
          const mine = dot(r1, x) === 0 && dot(r2, x) === 0 && !x.every(v => v === 0) ? `<p>Ваш груз ${tup(x)} = ${num(x[0] / k[0])}·${tup(k)}.</p>` : "";
          return `<p>Строки датчиков не параллельны, поэтому ранг матрицы равен 2. Неизвестных три, значит, размерность ядра 3 ${MINUS} 2 = 1: все решения — кратные одного вектора ${tup(k)}.</p>${mine}
<p>Трюк работает, потому что векторное произведение перпендикулярно обеим строкам: r₁ × r₂ = ${tup(cr)}, а после сокращения на ${g} — тот же ${tup(k)}.</p>`;
        },
      };
    }
    return null;
  }

  // =====================================================================
  // Финал любого дела: доказательство из карточек и двойной ключ
  // =====================================================================
  const LETTERS = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "И"];
  function lvProof(rng, cfg) {
    const th = cfg.theorems[rng.int(0, cfg.theorems.length - 1)];
    const items = rng.shuffle(th.steps.map((t, i) => ({ t, step: i })).concat(th.traps.map((tr, i) => ({ t: tr.t, why: tr.why, trap: i }))));
    items.forEach((it, i) => { it.letter = LETTERS[i]; });
    const byLetter = {};
    items.forEach(it => { byLetter[it.letter] = it; });
    const canon = th.steps.map((_, i) => items.find(it => it.step === i).letter);
    const nSteps = th.steps.length;
    const prereq = s => th.before.filter(([a, b]) => b === s).map(([a]) => a);
    const hand = (seat, n) => items.filter((_, i) => i % Math.max(1, n) === seat).map(it => it.letter);
    return {
      kind: "proof", title: cfg.title, win: cfg.win, topic: "Доказательство", par: 240,
      story: cfg.story,
      goal: `Выложите доказательство: ${th.statement} Фальшивки сожгите. Потом два ключа — одновременно.`,
      statement: th.statement,
      hint: "Первый шаг вводит обозначения. Для каждой карточки спросите: из чего она следует? Если не следует ни из чего верного — это фальшивка.",
      theory: [{ title: "Памятка критика", html: cfg.memo }],
      cardText: L => (byLetter[L] ? byLetter[L].t : ""),
      hand,
      roles(n) {
        n = Math.max(1, n);
        const req = [];
        for (let s = 0; s < n; s++) req.push({ id: "h" + s, seat: s, name: "Хранитель карточек", desc: "У тебя карточки с шагами. Выкладывай свою, когда до неё дошла очередь. Фальшивку сожги.", w: [{ t: "cards" }], init: {}, req: true, cards: hand(s, n) });
        req.push({ id: "k1", seat: 0, name: "Ключ 1", desc: "Когда доказательство собрано, поверни ключ одновременно со вторым ключом.", w: [{ t: "key" }], init: {}, req: true });
        req.push({ id: "k2", seat: n >= 2 ? 1 : 0, name: "Ключ 2", desc: "Когда доказательство собрано, поверни ключ одновременно с первым ключом.", w: [{ t: "key" }], init: {}, req: true });
        if (n >= 4) req.push(Object.assign(LOOK(), { seat: n - 1 }));
        return req;
      },
      initAux: n => ({ n: Math.max(1, n), placed: [], burned: [], keys: {}, opened: false, latched: {} }),
      evaluate(V, aux) {
        const chain = aux.placed.length === nSteps;
        return {
          goals: [{ id: "chain", label: `Цепочка: ${aux.placed.length} из ${nSteps} шагов`, ok: chain }, { id: "fakes", label: `Фальшивки: ${aux.burned.filter(L => byLetter[L].trap !== undefined).length} из ${th.traps.length} сожжено`, ok: aux.burned.filter(L => byLetter[L].trap !== undefined).length === th.traps.length, optional: true }, { id: "keys", label: "Два ключа одновременно", ok: aux.opened }],
          scene: { placed: aux.placed.map(s => ({ step: s, letter: canon[s], t: th.steps[s] })), burned: aux.burned.slice(), nSteps, chain, opened: aux.opened, keys: Object.keys(aux.keys) },
          done: aux.opened,
        };
      },
      act(aux, type, data, ctx) {
        if (type === "play" || type === "burn") {
          const L = data, it = byLetter[L];
          if (!it || aux.burned.includes(L) || (it.step !== undefined && aux.placed.includes(it.step))) return {};
          if (!ctx.solo && !hand(ctx.seat, aux.n).includes(L)) return {};
          if (type === "play") {
            if (it.trap !== undefined) { aux.burned.push(L); return { alarm: 10, fx: "bad", msg: `Фальшивка ${L} легла в цепочку, и охрана это заметила. ${it.why}` }; }
            if (!prereq(it.step).every(s => aux.placed.includes(s))) return { noise: 18, fx: "bounce", msg: `Карточка ${L}: рано — сначала нужны шаги, из которых она следует.` };
            aux.placed.push(it.step);
            return { fx: "place", msg: `Карточка ${L} легла в цепочку.` };
          }
          if (it.trap !== undefined) { aux.burned.push(L); return { fx: "burn", msg: `Фальшивка ${L} сожжена.` }; }
          return { alarm: 10, fx: "bad", msg: `Карточка ${L} — верный шаг, её нельзя жечь!` };
        }
        if (type === "key") {
          if (aux.placed.length < nSteps || aux.opened) return {};
          aux.keys[ctx.role] = ctx.now;
          const t1 = aux.keys.k1, t2 = aux.keys.k2;
          if (t1 && t2) {
            if (Math.abs(t1 - t2) <= 900) { aux.opened = true; return { fx: "open", msg: "Ключи повёрнуты одновременно!" }; }
            aux.keys = {};
            return { noise: 20, fx: "bounce", msg: "Не одновременно! Считайте вслух: «три, два, один — поворот!»" };
          }
          return { fx: "tick", msg: `${ctx.role === "k1" ? "Ключ 1" : "Ключ 2"} повёрнут. Ждём второй…` };
        }
        return {};
      },
      expire(aux, now) { const ks = Object.values(aux.keys); if (ks.length === 1 && now - ks[0] > 1500) { aux.keys = {}; return true; } return false; },
      solve(aux) { aux.placed = th.steps.map((_, i) => i); aux.burned = items.filter(it => it.trap !== undefined).map(it => it.letter); aux.opened = true; },
      solution: () => ({}),
      canon, byLetter, nSteps,
      debrief() {
        const traps = items.filter(it => it.trap !== undefined);
        return `<p>Теорема: ${th.statement}</p>
<ol class="proof">${canon.map(L => `<li><b>${L}</b><span>${byLetter[L].t}</span></li>`).join("")}</ol>
<p>${th.note}</p>
<p>Фальшивки:</p>
<ul class="traps">${traps.map(it => `<li><b>${it.letter}</b><span>${it.why}</span></li>`).join("")}</ul>`;
      },
    };
  }

  const BAZIS_PROOFS = {
    title: "Главное хранилище", win: "Хранилище открыто!",
    story: "Дверь хранилища открывается только безупречным доказательством. Карточки с шагами розданы банде, но охрана подмешала к ним три фальшивки. Выкладывайте шаги по порядку, фальшивки жгите — а потом два ключа одновременно.",
    memo: `<p>Каждая фальшивка нарушает одно из правил:</p><ul><li>на вектор и на матрицу делить нельзя;</li><li>нельзя опираться на то, что доказываешь;</li><li>частный случай не доказывает общее;</li><li>нельзя брать то, чего нет в условии;</li><li>решение существует ≠ решение единственно.</li></ul>`,
    theorems: [
      {
        statement: "собственные векторы, отвечающие разным собственным значениям, линейно независимы (для двух векторов).",
        steps: [
          "Пусть <i>A</i>v₁ = λ₁v₁ и <i>A</i>v₂ = λ₂v₂, где v₁, v₂ ≠ 0 и λ₁ ≠ λ₂. Предположим, что c₁v₁ + c₂v₂ = 0.",
          "Применим <i>A</i> к обеим частям: c₁λ₁v₁ + c₂λ₂v₂ = 0.",
          `Вычтем исходное равенство, умноженное на λ₁: c₂(λ₂ ${MINUS} λ₁)v₂ = 0.`,
          `Так как λ₂ ${MINUS} λ₁ ≠ 0 и v₂ ≠ 0, получаем c₂ = 0.`,
          "Тогда c₁v₁ = 0, а v₁ ≠ 0, значит, c₁ = 0. Векторы линейно независимы. ∎",
        ],
        traps: [
          { t: `Разделим обе части на v₂ и получим c₂(λ₂ ${MINUS} λ₁) = 0.`, why: "На вектор делить нельзя. Правильный ход — сослаться на то, что v₂ ≠ 0." },
          { t: "Векторы v₁ и v₂ ортогональны, поэтому из c₁v₁ + c₂v₂ = 0 сразу следует c₁ = c₂ = 0.", why: "Об ортогональности в условии ничего нет, и в общем случае она неверна." },
          { t: "Векторы v₁ и v₂ различны, а значит, линейно независимы.", why: "Различные векторы бывают зависимы, например v и 2v. Это как раз и надо было доказать." },
        ],
        before: [[0, 1], [1, 2], [2, 3], [3, 4]],
        note: "Здесь порядок строгий: каждый шаг опирается на предыдущий.",
      },
      {
        statement: "если det <i>A</i> ≠ 0, то система <i>A</i>x = 0 имеет только нулевое решение.",
        steps: [
          "Пусть det <i>A</i> ≠ 0 и x — решение, то есть <i>A</i>x = 0.",
          "Так как det <i>A</i> ≠ 0, у <i>A</i> есть обратная матрица <i>A</i>⁻¹.",
          "Умножим равенство слева на <i>A</i>⁻¹: <i>A</i>⁻¹(<i>A</i>x) = <i>A</i>⁻¹·0 = 0.",
          "По ассоциативности <i>A</i>⁻¹(<i>A</i>x) = (<i>A</i>⁻¹<i>A</i>)x = <i>E</i>x = x.",
          "Значит, x = 0, и других решений нет. ∎",
        ],
        traps: [
          { t: "Умножим равенство на <i>A</i>⁻¹ справа: (<i>A</i>x)<i>A</i>⁻¹ = 0.", why: "Ax — столбец, справа на матрицу его не умножить: размеры не сходятся. Умножать нужно слева." },
          { t: "Разделим обе части равенства <i>A</i>x = 0 на <i>A</i>.", why: "Деления на матрицу не существует, вместо него умножают на обратную." },
          { t: "x = 0 — решение системы, значит, других решений нет.", why: "Если решение существует, это ещё не значит, что оно единственное. Единственность и надо было доказать." },
        ],
        before: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4]],
        note: "Шаги с умножением на A⁻¹ и с ассоциативностью можно было поменять местами: оба опираются только на то, что A⁻¹ существует.",
      },
      {
        statement: "ядро матрицы <i>A</i> — подпространство: оно не пусто и замкнуто относительно сложения и умножения на число.",
        steps: [
          "Пусть x, y ∈ ker <i>A</i>, то есть <i>A</i>x = 0 и <i>A</i>y = 0, и α — любое число.",
          "<i>A</i>·0 = 0, поэтому 0 ∈ ker <i>A</i> — ядро не пусто.",
          "<i>A</i>(x + y) = <i>A</i>x + <i>A</i>y = 0 + 0 = 0, значит, x + y ∈ ker <i>A</i>.",
          "<i>A</i>(αx) = α·<i>A</i>x = α·0 = 0, значит, αx ∈ ker <i>A</i>.",
          "Ядро не пусто и замкнуто относительно сложения и умножения на число, то есть это подпространство. ∎",
        ],
        traps: [
          { t: "<i>A</i>(x + y) = <i>A</i>x · <i>A</i>y = 0 · 0 = 0.", why: "Линейность — это A(x + y) = Ax + Ay, а не произведение. Да и векторы так не перемножают." },
          { t: "Так как ker <i>A</i> — подпространство, x + y ∈ ker <i>A</i>.", why: "Порочный круг: шаг опирается на то, что нужно доказать." },
          { t: "Для x = y = 0 всё выполняется, значит, выполняется для любых x и y.", why: "Частный случай не доказывает общее утверждение." },
        ],
        before: [[0, 2], [0, 3], [1, 4], [2, 4], [3, 4]],
        note: "Проверки нуля, суммы и кратного не зависят друг от друга, их можно было делать в любом порядке.",
      },
    ],
  };

  // =====================================================================
  // Дело №2. Механическая усадьба — движения плоскости (лекция 6)
  // У каждого своя задача: считает на бумаге, вводит ответ и жмёт «Проверить».
  // До проверки сцена ничего не подсказывает, поэтому ответ не подобрать тыканьем.
  // =====================================================================
  function randTri(rng, r) {
    for (;;) {
      const t = [0, 1, 2].map(() => [rng.int(-r, r), rng.int(-r, r)]);
      const ar = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]));
      if (ar < 6) continue;
      const d = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => (t[i][0] - t[j][0]) ** 2 + (t[i][1] - t[j][1]) ** 2);
      if (new Set(d).size < 3) continue;
      return t;
    }
  }
  const TASK_SEATS = 12;  // задачи готовим сразу на 12 мест: сколько будет игроков, станет известно позже
  const NUM_RE = /^-?\d{1,3}$/;
  // числа из поля ввода; null, пока заполнено не всё
  function readNums(a, n) {
    if (!Array.isArray(a) || a.length !== n || !a.every(s => typeof s === "string" && NUM_RE.test(s))) return null;
    return a.map(s => z0(parseInt(s, 10)));
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const strs = p => p.map(x => String(z0(x)));
  const fmtH = x => (Number.isInteger(x) ? num(x) : (x < 0 ? MINUS : "") + Math.floor(Math.abs(x)) + ",5");
  const tupH = p => (p.every(Number.isInteger) ? tup(p) : "(" + p.map(fmtH).join("; ") + ")");
  const angTxt = phi => (phi === 270 ? MINUS + "90°" : phi + "°");
  const dirTxt = phi => (phi === 90 ? "на 90° против часовой стрелки" : phi === 180 ? "на 180°" : "на 90° по часовой стрелке");
  const ROT_RULE = {
    90: `(<i>x</i>, <i>y</i>) → (${MINUS}<i>y</i>, <i>x</i>)`,
    180: `(<i>x</i>, <i>y</i>) → (${MINUS}<i>x</i>, ${MINUS}<i>y</i>)`,
    270: `(<i>x</i>, <i>y</i>) → (<i>y</i>, ${MINUS}<i>x</i>)`,
  };
  const ROT_THEORY = { title: "Поворот вокруг точки", html: `<p>Чтобы повернуть точку A вокруг O, берут вектор OA = A ${MINUS} O, поворачивают его и прибавляют O обратно.</p><p class="f">на 90° против часовой: ${ROT_RULE[90]}<br>на 180°: ${ROT_RULE[180]}<br>на 90° по часовой: ${ROT_RULE[270]}</p>` };
  // решение «поворот точки» по шагам: вектор от центра, поворот вектора, обратно
  function rotSteps(cN, Cp, pN, Pp, phi, rN) {
    const d = zz(sub(Pp, Cp)), w = zz(rotV(d, phi)), R = zz(add(Cp, w));
    return `<p class="f">${cN}${pN} = ${pN} ${MINUS} ${cN} = ${tup(d)}<br>${dirTxt(phi)}: ${tup(d)} → ${tup(w)}<br>${rN} = ${cN} + ${tup(w)} = ${tup(R)}</p>`;
  }
  // прямые сцены как a·x + b·y = v и их углы с осью Ox
  const LINE_ABC = { x: [1, 0], y: [0, 1], d: [-1, 1], a: [1, 1] };
  const LINE_DEG = { y: 0, d: 45, x: 90, a: 135 };
  const reflect = l => LINE_F[l.k](l.v);
  function crossPt(l1, l2) {
    const [a1, b1] = LINE_ABC[l1.k], [a2, b2] = LINE_ABC[l2.k], det = a1 * b2 - a2 * b1;
    if (!det) return null;
    const x = (l1.v * b2 - l2.v * b1) / det, y = (a1 * l2.v - a2 * l1.v) / det;
    return Number.isInteger(x) && Number.isInteger(y) ? zz([x, y]) : null;
  }
  // движение, совпадающее с f на трёх точках: перенос или поворот вокруг O
  function identify(f, O) {
    const pts = [[0, 0], [1, 0], [0, 1]], v = zz(f([0, 0]));
    if (pts.every(p => eqP(f(p), add(p, v)))) return { rot: false, v };
    if (!O) return null;
    const ai = ANG.findIndex(a => pts.every(p => eqP(f(p), Rot(O, a)(p))));
    return ai < 0 ? null : { rot: true, O, ai, phi: ANG[ai] };
  }
  const FLAG = [[0, 0], [0, 2], [1, 2], [1, 1], [0, 1]];
  // ответ «поворот или перенос»: вид, центр или вектор, угол
  const MOTION_W = [
    { k: "m", t: "pick", label: "Что получилось", opts: ["Поворот", "Перенос"], none: true },
    { k: "p", t: "nums", label: "Центр поворота или вектор переноса", fields: ["x", "y"] },
    { k: "a", t: "dial", label: "Угол поворота против часовой (для переноса не нужен)", opts: ANG_OPTS, none: true },
  ];
  const MOTION_INIT = { m: -1, p: ["", ""], a: -1 };
  function readMotion(v) {
    if (v.m !== 0 && v.m !== 1) return null;
    const p = readNums(v.p, 2);
    if (!p || (v.m === 0 && !(Number.isInteger(v.a) && v.a >= 0))) return null;
    return { rot: v.m === 0, p, ai: v.m === 0 ? v.a : -1 };
  }
  function checkMotion(t, ans, tips) {
    if (ans.rot !== t.rot) return { ok: false, msg: tips.kind };
    if (t.rot) {
      const cOk = eqP(ans.p, t.O), aOk = ans.ai === t.ai;
      if (cOk && aOk) return { ok: true };
      return { ok: false, msg: cOk ? tips.angle(ANG[ans.ai]) : tips.center(ans.p) };
    }
    return eqP(ans.p, t.v) ? { ok: true } : { ok: false, msg: tips.vec(ans.p) };
  }
  const motionText = t => (t.rot ? `поворот вокруг ${tup(t.O)} на ${t.phi}°` : `перенос на ${tup(t.v)}`);
  const motionAnswer = t => ({ m: t.rot ? 0 : 1, p: strs(t.rot ? t.O : t.v), a: t.rot ? t.ai : -1 });

  // уровень из задач «каждому своя»: роль t<место> с полями ответа и кнопкой «Проверить»
  function lvTasks(rng, cfg) {
    const shared = cfg.prep ? cfg.prep(rng) : null;
    if (cfg.prep && !shared) return null;
    const tasks = [], keys = new Set();
    for (let s = 0; s < TASK_SEATS; s++) {
      let t = null;
      for (let a = 0; a < 4000 && !t; a++) { t = cfg.make(rng, shared); if (t && cfg.key && keys.has(cfg.key(t))) t = null; }
      if (!t) return null;
      if (cfg.key) keys.add(cfg.key(t));
      tasks.push(t);
    }
    const taskOf = s => tasks[s % TASK_SEATS];
    const CHECK = { k: "chk", t: "action", label: "Проверить", act: "check" };
    const role = s => ({ id: "t" + s, seat: s, task: true, name: cfg.who, desc: cfg.desc, w: cfg.w.concat([CHECK]), init: cfg.init, req: true, info: cfg.statement(taskOf(s), shared) });
    return {
      kind: cfg.kind, task: true, title: cfg.title, win: cfg.win, topic: cfg.topic, par: cfg.par,
      story: cfg.story, goal: cfg.goal, hint: cfg.hint, theory: cfg.theory,
      roles(n) {
        n = Math.max(1, n);
        const req = Array.from({ length: n }, (_, s) => role(s));
        if (n >= 4) req.push(Object.assign(LOOK(), { seat: n - 1 }));
        return req;
      },
      initAux: n => ({ n: Math.max(1, n), solved: {}, wrong: {}, latched: {} }),
      evaluate(V, aux) {
        const items = [];
        for (let s = 0; s < aux.n; s++) {
          const id = "t" + s;
          items.push(Object.assign({ id, solved: aux.solved[id] || 0, wrong: aux.wrong[id] || null }, cfg.scene(taskOf(s), shared)));
        }
        const k = items.filter(it => it.solved).length;
        return { goals: [{ id: "all", label: `Открыто замков: ${k} из ${aux.n}`, ok: k === aux.n }], scene: { items, shared }, done: k === aux.n };
      },
      // ответ заполнен целиком — телефон проверяет это сам, чтобы пустое поле не стоило тревоги
      ready: (rid, v) => !!(v && cfg.read(v)),
      act(aux, type, data, ctx) {
        const r = ctx.role;
        if (type !== "check" || !/^t\d+$/.test(r) || aux.solved[r] || +r.slice(1) >= aux.n) return {};
        const s = +r.slice(1), ans = ctx.V && ctx.V[r] ? cfg.read(ctx.V[r]) : null;
        if (!ans) return {};
        const res = cfg.check(taskOf(s), ans, shared);
        if (res.ok) { aux.solved[r] = ctx.now || 1; delete aux.wrong[r]; return { fx: "lock", goal: r, msg: `Замок ${s + 1} открыт.` }; }
        aux.wrong[r] = { n: (aux.wrong[r] ? aux.wrong[r].n : 0) + 1, t: ctx.now || 1, ans };
        return { alarm: 10, fx: "bad", msg: `Замок ${s + 1}: неверно. ${res.msg || "Пересчитайте на бумаге."}` };
      },
      solution(aux) { const V = {}; for (let s = 0; s < aux.n; s++) V["t" + s] = cfg.answer(taskOf(s), shared); return V; },
      solveActs: aux => Array.from({ length: aux.n }, (_, s) => ({ role: "t" + s, type: "check" })),
      solve(aux) { for (let s = 0; s < aux.n; s++) if (!aux.solved["t" + s]) aux.solved["t" + s] = 1; },
      homework: s => `<div class="hw-task">${cfg.statement(taskOf(s), shared)}</div>${cfg.explain(taskOf(s), shared)}<p><b>Ответ:</b> ${cfg.answerText(taskOf(s), shared)}</p>`,
      debrief(V, aux) {
        return cfg.debrief(shared) + `<p>Ответы банды:</p><ul class="traps">${Array.from({ length: aux.n }, (_, s) => `<li><b>${s + 1}</b><span>${cfg.answerText(taskOf(s), shared)}</span></li>`).join("")}</ul>`;
      },
    };
  }
  const lvT = cfg => rng => lvTasks(rng, cfg);

  // ---------- 1. Ворота: поворот точки ----------
  const TASK_ROT = {
    kind: "rotpt", title: "Ворота усадьбы", win: "Ворота открыты!", topic: "Поворот точки", par: 120,
    story: "Ворота усадьбы держат кодовые замки — по одному на каждого из банды. Замок открывается, если заранее назвать, куда повернётся метка. Механизм проверяет ответ только по кнопке «Проверить», а на ошибку прибегает охрана.",
    goal: "Каждый поворачивает свою точку A вокруг своего центра O и вводит координаты образа A′.",
    hint: `Вектор OA = A ${MINUS} O, поверните его и прибавьте O. На 90° против часовой: (x, y) → (${MINUS}y, x); на 180°: (x, y) → (${MINUS}x, ${MINUS}y); на 90° по часовой: (x, y) → (y, ${MINUS}x).`,
    theory: [ROT_THEORY, { title: "Формулы поворота", html: FORMULAS }],
    who: "Взломщик замка", desc: "У тебя свой замок. Посчитай на бумаге, куда повернётся точка, введи координаты и жми «Проверить». Ошибка зовёт охрану.",
    w: [{ k: "a", t: "nums", label: "A′ = (x, y)", fields: ["x", "y"] }],
    init: { a: ["", ""] },
    make(rng) {
      const O = [rng.int(-3, 3), rng.int(-3, 3)], A = [rng.int(-6, 6), rng.int(-6, 6)], phi = rng.pick(ANG);
      const d = sub(A, O);
      if (Math.abs(d[0]) + Math.abs(d[1]) < 3) return null;
      if (eqP(O, [0, 0]) && rng.next() < 0.7) return null;
      const A1 = Rot(O, phi)(A);
      return inBox(A1, 9) ? { O, A, phi, A1 } : null;
    },
    key: t => `${t.O}|${t.A}|${t.phi}`,
    read: v => { const p = readNums(v.a, 2); return p ? { p } : null; },
    check(t, ans) {
      if (eqP(ans.p, t.A1)) return { ok: true };
      if (eqP(ans.p, Rot(t.O, 360 - t.phi)(t.A))) return { ok: false, msg: "Повернули не в ту сторону: против часовой стрелки — положительный угол." };
      if (eqP(ans.p, zz(rotV(sub(t.A, t.O), t.phi)))) return { ok: false, msg: "Повернули вектор OA, но забыли прибавить O." };
      if (eqP(ans.p, Rot([0, 0], t.phi)(t.A))) return { ok: false, msg: "Это поворот вокруг начала координат, а центр — точка O." };
      return { ok: false };
    },
    answer: t => ({ a: strs(t.A1) }),
    answerText: t => `O${tup(t.O)}, ${angTxt(t.phi)}: A${tup(t.A)} → A′${tup(t.A1)}`,
    statement: t => `<p>Поверни точку A${tup(t.A)} вокруг O${tup(t.O)} ${dirTxt(t.phi)}. Найди A′ = ${Rh("O", angTxt(t.phi))}(A).</p>`,
    explain: t => rotSteps("O", t.O, "A", t.A, t.phi, "A′"),
    scene: t => ({ O: t.O, A: t.A, A1: t.A1, turn: t.phi === 270 ? -90 : t.phi, ang: angTxt(t.phi) }),
    debrief: () => `<p>Поворот ${Rh("O", "φ")} вокруг O = (<i>x</i>₀, <i>y</i>₀) считают в три шага: сдвинуть O в начало координат (вектор OA), повернуть вектор, сдвинуть обратно.</p>${FORMULAS}<p>Поворот — движение: он сохраняет расстояния (OA′ = OA) и ориентацию, то есть это движение первого рода.</p>`,
  };

  // ---------- 2. Карусели: центр и угол поворота ----------
  function bisector(P, Q) {
    const d = zz(sub(Q, P));
    let a = 2 * d[0], b = 2 * d[1], c = Q[0] * Q[0] + Q[1] * Q[1] - P[0] * P[0] - P[1] * P[1];
    const g = gcd(gcd(a, b), c) || 1;
    a /= g; b /= g; c /= g;
    if (a < 0 || (a === 0 && b < 0)) { a = -a; b = -b; c = -c; }
    return `${lin([a, b], ["x", "y"])} = ${num(c)}`;
  }
  const TASK_CENTER = {
    kind: "center", title: "Карусели в парке", win: "Карусели остановлены!", topic: "Центр и угол поворота", par: 150,
    story: "В парке крутятся старые карусели — у каждого из банды своя. Центр зарос травой, шкала стёрлась, но известно, куда карусель переносит две метки. Чтобы её остановить, тормоз ставят ровно в центр и выставляют угол.",
    goal: "Найдите центр и угол поворота своей карусели по меткам: A → A₁, B → B₁.",
    hint: "Центр одинаково удалён от точки и её образа, поэтому лежит на серединном перпендикуляре к AA₁ — и к BB₁. Угол — от вектора AB до вектора A₁B₁ против часовой стрелки.",
    theory: [
      { title: "Где центр", html: `<p>Если поворот переводит A в A₁, то OA = OA₁: центр лежит на серединном перпендикуляре к AA₁. Так же и к BB₁. Пересечение перпендикуляров — центр.</p><p class="f">серединный перпендикуляр к PQ: (Q ${MINUS} P)·X = (|Q|² ${MINUS} |P|²)/2</p>` },
      { title: "Какой угол", html: `<p>Угол между вектором и его образом равен углу поворота. Сравните AB и A₁B₁.</p>${FORMULAS}` },
    ],
    who: "Тормозной", desc: "Найди центр и угол своей карусели по меткам. Центр поставь на сетке, угол выбери на шкале, потом «Проверить». Сцена подсказок не даёт.",
    w: [{ k: "c", t: "point", label: "Центр O", R: 6 }, { k: "a", t: "dial", label: "Угол против часовой", opts: ANG_OPTS, none: true }],
    init: { c: [0, 0], a: -1 },
    make(rng) {
      const O = [rng.int(-3, 3), rng.int(-3, 3)], phi = rng.pick(ANG);
      if (eqP(O, [0, 0])) return null;
      const A = [rng.int(-5, 5), rng.int(-5, 5)], B = [rng.int(-5, 5), rng.int(-5, 5)];
      if (eqP(A, O) || eqP(B, O) || eqP(A, B)) return null;
      const f = Rot(O, phi), A1 = f(A), B1 = f(B);
      if (![A1, B1].every(p => inBox(p, 6))) return null;
      if (cr2(sub(A1, A), sub(B1, B)) === 0 || eqP(A1, B) || eqP(B1, A)) return null;
      return { O, phi, ai: ANG.indexOf(phi), A, B, A1, B1 };
    },
    key: t => `${t.A}|${t.B}|${t.O}`,
    read: v => (Array.isArray(v.c) && Number.isInteger(v.a) && v.a >= 0 ? { c: v.c, ai: v.a } : null),
    check(t, ans) {
      const cOk = eqP(ans.c, t.O), aOk = ans.ai === t.ai;
      if (cOk && aOk) return { ok: true };
      if (cOk) return { ok: false, msg: ANG[ans.ai] === 360 - t.phi ? "Центр верный, но угол в другую сторону: считаем против часовой стрелки." : "Центр верный, угол — нет: сравните векторы AB и A₁B₁." };
      if (aOk) return { ok: false, msg: "Угол верный, центр — нет: он лежит на серединных перпендикулярах к AA₁ и BB₁." };
      return { ok: false, msg: "Центр — пересечение серединных перпендикуляров к AA₁ и BB₁." };
    },
    answer: t => ({ c: t.O.slice(), a: t.ai }),
    answerText: t => `A${tup(t.A)} → A₁${tup(t.A1)}, B${tup(t.B)} → B₁${tup(t.B1)}: центр ${tup(t.O)}, ${t.phi}°`,
    statement: t => `<p>Карусель повернула точку A${tup(t.A)} в A₁${tup(t.A1)}, а B${tup(t.B)} — в B₁${tup(t.B1)}. Найди центр поворота и угол против часовой стрелки.</p>`,
    explain(t) {
      const AB = zz(sub(t.B, t.A)), A1B1 = zz(sub(t.B1, t.A1));
      return `<p>Центр одинаково удалён от A и A₁ — он на серединном перпендикуляре к AA₁ (середина ${tupH(mid(t.A, t.A1))}). Так же для BB₁:</p>
<p class="f">${bisector(t.A, t.A1)}<br>${bisector(t.B, t.B1)}</p>
<p>Решаем систему: O = ${tup(t.O)}. Угол: вектор AB = ${tup(AB)} перешёл в A₁B₁ = ${tup(A1B1)}, это поворот на ${t.phi}° против часовой стрелки: ${ROT_RULE[t.phi]}.</p>`;
    },
    scene: t => ({ A: t.A, B: t.B, A1: t.A1, B1: t.B1, O: t.O, turn: t.phi, ang: t.phi + "°" }),
    debrief: () => `<p>Центр поворота равноудалён от любой точки и её образа, поэтому лежит на серединных перпендикулярах к AA₁ и BB₁; если они не параллельны, их пересечение и есть центр. Угол поворота равен углу между вектором AB и его образом A₁B₁.</p><p>Это частный случай леммы о трёх гвоздях: движение задаётся образами трёх неколлинеарных точек, а когда известно, что это поворот, хватает двух.</p>`,
  };

  // ---------- 3. Зеркальная галерея: композиция двух симметрий (лемма 6.4) ----------
  const TASK_MIRRORS = {
    kind: "mirror2", title: "Зеркальная галерея", win: "Датчики обмануты!", topic: "Композиция двух симметрий", par: 150,
    story: "В галерее вора видно в двух зеркалах подряд. Датчик на выходе обманут, если заранее назвать одно движение, которое заменяет оба отражения. У каждого из банды своя пара зеркал.",
    goal: `Каждый определяет, что такое ${Sh("l₂")} ∘ ${Sh("l₁")} для своей пары зеркал: поворот (центр и угол) или перенос (вектор).`,
    hint: "Лемма 6.4: если оси пересекаются в O, композиция — поворот вокруг O на удвоенный угол от l₁ до l₂. Если оси параллельны — перенос перпендикулярно им, от l₁ к l₂, на удвоенное расстояние.",
    theory: [
      { title: "Лемма 6.4", html: `<p>${Sh("l₂")} ∘ ${Sh("l₁")}:</p><ul><li><i>l</i>₁ = <i>l</i>₂ — тождественное движение;</li><li><i>l</i>₁ ∩ <i>l</i>₂ = O — поворот ${Rh("O", "φ")}, φ = 2∠(<i>l</i>₁, <i>l</i>₂);</li><li><i>l</i>₁ ∥ <i>l</i>₂ — перенос на вектор, перпендикулярный осям, от <i>l</i>₁ к <i>l</i>₂, длиной в удвоенное расстояние между ними.</li></ul>` },
      { title: "Углы прямых", html: `<p>Угол с осью Ox: <i>y</i> = <i>c</i> — 0°, <i>y</i> = <i>x</i> + <i>c</i> — 45°, <i>x</i> = <i>c</i> — 90°, <i>y</i> = ${MINUS}<i>x</i> + <i>c</i> — 135°. Угол от <i>l</i>₁ до <i>l</i>₂ считают против часовой стрелки.</p>` },
    ],
    who: "Зеркальщик", desc: "Определи, что дают твои два зеркала: выбери «Поворот» или «Перенос», введи центр или вектор, для поворота — угол. Потом «Проверить».",
    w: MOTION_W, init: MOTION_INIT,
    make(rng) {
      const kinds = ["x", "y", "d", "a"];
      const l1 = { k: rng.pick(kinds), v: rng.int(-3, 3) }, l2 = { k: rng.pick(kinds), v: rng.int(-3, 3) };
      if (l1.k === l2.k && l1.v === l2.v) return null;
      const f = comp(reflect(l2), reflect(l1));
      const m = identify(f, l1.k === l2.k ? null : crossPt(l1, l2));
      if (!m || (m.rot ? !inBox(m.O, 5) : !inBox(m.v, 9))) return null;
      const P0 = [rng.int(-5, 3), rng.int(-5, 3)], F = FLAG.map(p => add(p, P0)), F1 = F.map(reflect(l1)), F2 = F1.map(reflect(l2));
      if (![...F, ...F1, ...F2].every(p => inBox(p, 8))) return null;
      return Object.assign({ l1, l2, F, F1, F2 }, m);
    },
    key: t => `${t.l1.k}${t.l1.v}|${t.l2.k}${t.l2.v}`,
    read: readMotion,
    check(t, ans) {
      const theta = (((LINE_DEG[t.l2.k] - LINE_DEG[t.l1.k]) % 180) + 180) % 180;
      return checkMotion(t, ans, {
        kind: t.rot ? "Оси пересекаются — значит, это поворот вокруг точки пересечения (лемма 6.4)." : "Оси параллельны — значит, это перенос (лемма 6.4).",
        angle: a => (a === theta ? "Угол поворота — удвоенный угол между осями." : a === 360 - t.phi ? "Угол отсчитывают от l₁ к l₂ против часовой стрелки." : "Угол поворота — удвоенный угол от l₁ до l₂."),
        center: () => "Центр поворота — точка пересечения осей.",
        vec: p => (eqP(p, t.v.map(x => x / 2)) ? "Сдвиг на удвоенное расстояние между осями, а не на одно." : eqP(p, [-t.v[0], -t.v[1]]) ? "Направление другое: от l₁ к l₂." : "Вектор переноса перпендикулярен осям, направлен от l₁ к l₂, длина — удвоенное расстояние."),
      });
    },
    answer: motionAnswer,
    answerText: t => `<i>l</i>₁: ${lineText(t.l1.k, t.l1.v)}, <i>l</i>₂: ${lineText(t.l2.k, t.l2.v)} — ${motionText(t)}`,
    statement: t => `<p>Вора отражают два зеркала: сначала <i>l</i>₁: ${lineText(t.l1.k, t.l1.v)}, потом <i>l</i>₂: ${lineText(t.l2.k, t.l2.v)}. Какое движение ${Sh("l₂")} ∘ ${Sh("l₁")}? Найди центр и угол поворота — или вектор переноса.</p>`,
    explain(t) {
      const m1 = reflect(t.l1)([0, 0]), m2 = reflect(t.l2)(m1);
      const path = `<p class="f">проверка на точке (0, 0): (0, 0) → ${tup(m1)} → ${tup(m2)}</p>`;
      if (!t.rot) return `<p>Оси параллельны. По лемме 6.4 ${Sh("l₂")} ∘ ${Sh("l₁")} — перенос перпендикулярно осям, от <i>l</i>₁ к <i>l</i>₂, на удвоенное расстояние между ними: <b>v</b> = ${tup(t.v)}.</p>${path}`;
      const theta = (((LINE_DEG[t.l2.k] - LINE_DEG[t.l1.k]) % 180) + 180) % 180;
      return `<p>Оси пересекаются: из системы ${lineText(t.l1.k, t.l1.v)}, ${lineText(t.l2.k, t.l2.v)} получаем O = ${tup(t.O)}. Угол от <i>l</i>₁ до <i>l</i>₂ против часовой — ${theta}°.</p><p>По лемме 6.4 ${Sh("l₂")} ∘ ${Sh("l₁")} = ${Rh("O", 2 * theta + "°")}: поворот вокруг ${tup(t.O)} на ${t.phi}°.</p>${path}`;
    },
    scene: t => ({ l1: t.l1, l2: t.l2, F: t.F, F1: t.F1, F2: t.F2, rot: t.rot, O: t.O || null, v: t.v || null, turn: t.phi || 0 }),
    debrief: () => `<p>Лемма 6.4: композиция двух осевых симметрий — поворот вокруг точки пересечения осей на удвоенный угол между ними, а для параллельных осей — перенос на удвоенное расстояние. Порядок важен: ${Sh("l₁")} ∘ ${Sh("l₂")} — поворот в обратную сторону.</p><p>Верно и обратное: любой поворот и любой перенос раскладываются в две симметрии, а любое движение — не более чем в три (лемма 6.3).</p>`,
  };

  // ---------- 4. Две карусели: композиция поворотов (лемма 6.5) ----------
  const TASK_ROTS = {
    kind: "rotcomp", title: "Две карусели", win: "Подмена готова!", topic: "Композиция поворотов", par: 180,
    story: "Тайник стоит на двух каруселях: сначала его крутит первая, потом вторая. Механик хвастался, что вместе они работают как одна карусель — а иногда как простой сдвиг. Чтобы подменить тайник, нужно точно назвать это одно движение. У каждого из банды своя пара каруселей.",
    goal: `Найдите, чем заменить ${Rh("O₂", "φ₂")} ∘ ${Rh("O₁", "φ₁")}: одним поворотом (центр и угол) или переносом (вектор).`,
    hint: "Лемма 6.5: углы складываются. Если сумма не кратна 360°, это поворот на сумму углов, его центр — неподвижная точка. Если кратна — перенос. Проследите, куда попадает точка (0, 0).",
    theory: [
      { title: "Лемма 6.5", html: `<p>${Rh("O₂", "φ₂")} ∘ ${Rh("O₁", "φ₁")} при O₁ ≠ O₂ — поворот на φ₁ + φ₂, если сумма не кратна 360°, и перенос, если кратна. Запись читается справа налево: сначала O₁.</p>` },
      { title: "Неподвижная точка", html: `<p>Центр O₃ остаётся на месте: ${Rh("O₂", "φ₂")}(${Rh("O₁", "φ₁")}(O₃)) = O₃. А вектор переноса — куда сдвинулась любая точка.</p>${FORMULAS}` },
    ],
    who: "Механик каруселей", desc: "Найди одно движение, равное твоим двум поворотам: выбери вид, введи центр или вектор, для поворота — угол. Потом «Проверить».",
    w: MOTION_W, init: MOTION_INIT,
    make(rng) {
      const O1 = [rng.int(-3, 3), rng.int(-3, 3)], O2 = [rng.int(-3, 3), rng.int(-3, 3)];
      if (Math.abs(O1[0] - O2[0]) + Math.abs(O1[1] - O2[1]) < 2) return null;
      const a1 = rng.pick(ANG), a2 = rng.pick(ANG), s = (a1 + a2) % 360;
      const f = comp(Rot(O2, a2), Rot(O1, a1));
      const m = identify(f, s ? fixedPoint(s, f([0, 0])) : null);
      if (!m || (m.rot ? !inBox(m.O, 5) : !inBox(m.v, 9))) return null;
      const J = randTri(rng, 2).map(p => add(p, [rng.int(-3, 3), rng.int(-3, 3)])), J1 = J.map(Rot(O1, a1)), J2 = J1.map(Rot(O2, a2));
      if (![...J, ...J1, ...J2].every(p => inBox(p, 9))) return null;
      return Object.assign({ O1, O2, a1, a2, J, J1, J2 }, m);
    },
    key: t => `${t.O1}|${t.O2}|${t.a1}|${t.a2}`,
    read: readMotion,
    check(t, ans) {
      const rev = comp(Rot(t.O1, t.a1), Rot(t.O2, t.a2)), s = (t.a1 + t.a2) % 360;
      return checkMotion(t, ans, {
        kind: t.rot ? `Сумма углов ${t.a1}° + ${t.a2}° не кратна 360°, значит, это поворот (лемма 6.5).` : "Сумма углов кратна 360° — значит, это перенос (лемма 6.5).",
        angle: () => "Угол композиции — сумма углов φ₁ + φ₂ (по модулю 360°).",
        center: p => (s && eqP(p, fixedPoint(s, rev([0, 0])) || [99, 99]) ? "Это центр для обратного порядка: сначала O₂, потом O₁." : "Центр O₃ — неподвижная точка: после двух поворотов она возвращается на место."),
        vec: p => (eqP(p, zz(rev([0, 0]))) ? "Это перенос для обратного порядка: сначала O₂, потом O₁." : "Найдите образ точки (0, 0): вектор переноса ведёт из неё в образ."),
      });
    },
    answer: motionAnswer,
    answerText: t => `O₁${tup(t.O1)}, ${t.a1}°; O₂${tup(t.O2)}, ${t.a2}° — ${motionText(t)}`,
    statement: t => `<p>Тайник крутят две карусели: сначала ${Rh("O₁", t.a1 + "°")} вокруг O₁${tup(t.O1)}, потом ${Rh("O₂", t.a2 + "°")} вокруг O₂${tup(t.O2)} (углы — против часовой стрелки). Каким одним движением их заменить? Найди центр и угол поворота — или вектор переноса.</p>`,
    explain(t) {
      const M1 = Rot(t.O1, t.a1)([0, 0]), sum = t.a1 + t.a2;
      let out = `<p>По лемме 6.5 угол композиции ${t.a1}° + ${t.a2}° = ${sum}°${sum >= 360 ? ` = ${sum % 360}° по модулю 360°` : ""}. Проследим за точкой M = (0, 0):</p>`;
      out += rotSteps("O₁", t.O1, "M", [0, 0], t.a1, "M₁") + rotSteps("O₂", t.O2, "M₁", M1, t.a2, "M′");
      if (!t.rot) return out + `<p>Сумма углов кратна 360°, поэтому это перенос на <b>v</b> = MM′ = ${tup(t.v)}.</p>`;
      const C1 = Rot(t.O1, t.a1)(t.O);
      return out + `<p>Это поворот на ${t.phi}° вокруг неподвижной точки O₃: из M′ = ${Rh("O₃", t.phi + "°")}(M) находим O₃ = ${tup(t.O)}.</p><p class="f">проверка: ${Rh("O₁", t.a1 + "°")}(O₃) = ${tup(C1)}, ${Rh("O₂", t.a2 + "°")}${tup(C1)} = ${tup(t.O)}</p>`;
    },
    scene: t => ({ O1: t.O1, O2: t.O2, a1: t.a1, a2: t.a2, J: t.J, J1: t.J1, J2: t.J2, rot: t.rot, O: t.O || null, v: t.v || null, turn: t.phi || 0 }),
    debrief: () => `<p>Лемма 6.5: композиция поворотов с разными центрами — поворот на сумму углов, если сумма не кратна 360°, и перенос, если кратна. Доказательство раскладывает каждый поворот в две симметрии с общей осью O₁O₂ (лемма 6.4) — общая симметрия сокращается.</p><p>Порядок важен: ${Rh("O₁", "φ₁")} ∘ ${Rh("O₂", "φ₂")} — поворот на тот же угол, но с другим центром.</p>`,
  };

  // ---------- 5. Сад: задача о кладе, у каждого своя берёза ----------
  const TASK_GARDEN = {
    kind: "treasure", title: "Сад", win: "Клад выкопан!", topic: "Повороты в задаче о кладе", par: 180,
    story: "В саду зарыт клад. Свиток описывает дорогу от берёзы, но берёзы давно нет. Колодец W и дуб D на месте. Про берёзу у каждого в банде своя версия — и все уверены, что права именно она.",
    goal: "Каждый по своей версии берёзы находит колышки K₁ и K₂. Когда вбиты все колышки, станет видно, где клад.",
    hint: `K₁ — поворот берёзы вокруг колодца на ${MINUS}90° (по часовой), K₂ — поворот берёзы вокруг дуба на 90° (против часовой). Клад — посередине между колышками.`,
    theory: [
      { title: "Свиток", html: `<p>«Встань у берёзы и дойди до колодца, поверни под прямым углом <b>налево</b> и пройди такое же расстояние — вбей колышек. Снова от берёзы дойди до дуба, поверни <b>направо</b> и пройди столько же — второй колышек. Клад посередине между колышками».</p>` },
      { title: "Шаги — это повороты", html: `<p>Колышек K₁ = ${Rh("W", MINUS + "90°")}(Б), колышек K₂ = ${Rh("D", "90°")}(Б).</p>${FORMULAS}` },
    ],
    who: "Кладоискатель", desc: "У тебя своя версия, где росла берёза. Найди по свитку оба колышка, введи их координаты и жми «Проверить».",
    w: [{ k: "k", t: "nums", label: "Колышки K₁ и K₂", fields: ["K₁: x", "K₁: y", "K₂: x", "K₂: y"] }],
    init: { k: ["", "", "", ""] },
    prep(rng) {
      for (let t = 0; t < 20000; t++) {
        const W = [rng.int(-5, 5), rng.int(-5, 5)], D = [rng.int(-5, 5), rng.int(-5, 5)], d = sub(W, D);
        if (d[0] * d[0] + d[1] * d[1] < 9 || (W[0] + W[1] + D[0] + D[1]) % 2 !== 0) continue;
        const r = rotV(d, 90), T = zz([(W[0] + D[0] + r[0]) / 2, (W[1] + D[1] + r[1]) / 2]);
        if (inBox(T, 6)) return { W, D, T };
      }
      return null;
    },
    make(rng, sh) {
      const B = [rng.int(-6, 6), rng.int(-6, 6)];
      if ([sh.W, sh.D, sh.T].some(q => eqP(q, B))) return null;
      const K1 = Rot(sh.W, -90)(B), K2 = Rot(sh.D, 90)(B);
      return inBox(K1, 12) && inBox(K2, 12) ? { B, K1, K2 } : null;
    },
    key: t => String(t.B),
    read: v => { const a = readNums(v.k, 4); return a ? { k1: [a[0], a[1]], k2: [a[2], a[3]] } : null; },
    check(t, ans, sh) {
      const o1 = eqP(ans.k1, t.K1), o2 = eqP(ans.k2, t.K2);
      if (o1 && o2) return { ok: true };
      if (!o1 && eqP(ans.k1, Rot(sh.W, 90)(t.B))) return { ok: false, msg: `K₁ — поворот Б вокруг колодца на ${MINUS}90°: после поворота налево точка Б уходит по часовой стрелке.` };
      if (!o2 && eqP(ans.k2, Rot(sh.D, -90)(t.B))) return { ok: false, msg: "K₂ — поворот Б вокруг дуба на 90°: после поворота направо точка Б уходит против часовой стрелки." };
      return { ok: false, msg: o1 ? "K₁ верно, K₂ — нет." : o2 ? "K₂ верно, K₁ — нет." : "Оба колышка мимо. Шаги свитка — это повороты вокруг W и D." };
    },
    answer: t => ({ k: strs(t.K1.concat(t.K2)) }),
    answerText: t => `Б${tup(t.B)}: K₁ = ${tup(t.K1)}, K₂ = ${tup(t.K2)}`,
    statement: (t, sh) => `<p>Колодец W${tup(sh.W)}, дуб D${tup(sh.D)}. В твоей версии берёза Б росла в точке ${tup(t.B)}.</p><p>Свиток: «От берёзы дойди до колодца, поверни <b>налево</b> под прямым углом и пройди столько же — вбей колышек K₁. От берёзы дойди до дуба, поверни <b>направо</b>, пройди столько же — колышек K₂. Клад — посередине между колышками».</p><p>Найди K₁ и K₂.</p>`,
    explain: (t, sh) => `<p>Шаги свитка — повороты: K₁ = ${Rh("W", MINUS + "90°")}(Б), K₂ = ${Rh("D", "90°")}(Б).</p>${rotSteps("W", sh.W, "Б", t.B, 270, "K₁")}${rotSteps("D", sh.D, "Б", t.B, 90, "K₂")}<p>Клад — середина K₁K₂: T = ${tup(sh.T)}. Он не зависит от берёзы: K₂ = ${Rh("D", "90°")} ∘ ${Rh("W", "90°")}(K₁), а это по лемме 6.5 поворот на 180°, то есть центральная симметрия с центром в кладе.</p>`,
    scene: (t, sh) => ({ B: t.B, K1: t.K1, K2: t.K2, T: sh.T }),
    debrief: sh => `<p>Колышки — это повороты берёзы Б: K₁ = ${Rh("W", MINUS + "90°")}(Б), K₂ = ${Rh("D", "90°")}(Б). Значит, K₂ = ${Rh("D", "90°")} ∘ ${Rh("W", "90°")}(K₁). По лемме 6.5 это поворот на 90° + 90° = 180°, то есть центральная симметрия ${Zh("T")}.</p><p>Центр центральной симметрии — середина отрезка между точкой и её образом. Поэтому клад — середина K₁K₂ при <b>любом</b> положении берёзы: у всей банды клад в одной точке T${tup(sh.T)}. Это задача 12 листка.</p>`,
  };

  const USADBA_PROOFS = {
    title: "Кабинет механика", win: "Сейф механика открыт!",
    story: "В кабинете механика стоит сейф с главной теоремой усадьбы. Карточки с шагами доказательства розданы банде, но охрана подмешала три фальшивки. Выкладывайте шаги по порядку, фальшивки жгите — а потом два ключа одновременно.",
    memo: `<p>Каждая фальшивка нарушает одно из правил:</p><ul><li>композиция читается справа налево и обычно не перестановочна;</li><li>${Sh("l")} ∘ ${Sh("l")} = <i>E</i> и ${Zh("O")} ∘ ${Zh("O")} = <i>E</i>;</li><li>чётное число несобственных движений даёт собственное;</li><li>параллельные оси дают перенос на удвоенное расстояние, пересекающиеся — поворот на удвоенный угол;</li><li>средняя линия треугольника вдвое короче стороны.</li></ul>`,
    theorems: [
      {
        statement: `композиция двух поворотов ${Rh("B", "<i>b</i>")} ∘ ${Rh("A", "<i>a</i>")} с разными центрами — поворот на угол <i>a</i> + <i>b</i>, если сумма не кратна 360°, и перенос, если кратна.`,
        steps: [
          `Пусть <i>l</i> = (AB). По п. 7.5 представим ${Rh("A", "<i>a</i>")} = ${Sh("l")} ∘ ${Sh("u")}, где прямая <i>u</i> проходит через A и ∠(<i>u</i>, <i>l</i>) = <i>a</i>/2.`,
          `Так же ${Rh("B", "<i>b</i>")} = ${Sh("v")} ∘ ${Sh("l")}, где прямая <i>v</i> проходит через B и ∠(<i>l</i>, <i>v</i>) = <i>b</i>/2.`,
          `Тогда ${Rh("B", "<i>b</i>")} ∘ ${Rh("A", "<i>a</i>")} = ${Sh("v")} ∘ ${Sh("l")} ∘ ${Sh("l")} ∘ ${Sh("u")} = ${Sh("v")} ∘ ${Sh("u")}, потому что ${Sh("l")} ∘ ${Sh("l")} = <i>E</i>.`,
          `Если <i>u</i> и <i>v</i> пересекаются в точке C, то по п. 7.4 ${Sh("v")} ∘ ${Sh("u")} — поворот вокруг C на 2∠(<i>u</i>, <i>v</i>) = 2(<i>a</i>/2 + <i>b</i>/2) = <i>a</i> + <i>b</i>.`,
          `Если <i>u</i> ∥ <i>v</i> — а это ровно случай, когда <i>a</i> + <i>b</i> кратно 360°, — то по п. 7.2 ${Sh("v")} ∘ ${Sh("u")} — перенос. ∎`,
        ],
        traps: [
          { t: `Композиция поворотов перестановочна, поэтому ${Rh("B", "<i>b</i>")} ∘ ${Rh("A", "<i>a</i>")} = ${Rh("A", "<i>a</i>")} ∘ ${Rh("B", "<i>b</i>")}.`, why: "В общем случае композиция движений не перестановочна: в обратном порядке центр поворота другой." },
          { t: `Симметрии перестановочны, поэтому ${Sh("l")} ∘ ${Sh("u")} = ${Sh("u")} ∘ ${Sh("l")}.`, why: "Это верно только для перпендикулярных осей, а здесь угол между u и l равен a/2." },
          { t: "Центр C композиции — середина отрезка AB.", why: "Центр зависит от углов: из него отрезок AB виден под углами a/2 и b/2." },
        ],
        before: [[0, 2], [1, 2], [2, 3], [2, 4]],
        note: "Первые два шага можно было поменять местами, как и два случая в конце. Это упражнение из начала листка.",
      },
      {
        statement: `композиция двух центральных симметрий ${Zh("B")} ∘ ${Zh("A")} — перенос на вектор 2AB.`,
        steps: [
          `Пусть M — произвольная точка, ${Zh("A")}(M) = M₁, ${Zh("B")}(M₁) = M′.`,
          "По определению центральной симметрии A — середина MM₁, а B — середина M₁M′.",
          "Значит, AB — средняя линия треугольника MM₁M′.",
          "По теореме о средней линии вектор MM′ = 2AB.",
          `Вектор 2AB не зависит от выбора M, поэтому ${Zh("B")} ∘ ${Zh("A")} = ${Th("2AB")}. ∎`,
        ],
        traps: [
          { t: `${Zh("B")} ∘ ${Zh("A")} = ${Zh("A")} ∘ ${Zh("B")}, поэтому порядок симметрий неважен.`, why: "Неверно: в обратном порядке получается перенос на 2BA, в другую сторону." },
          { t: "Центральная симметрия меняет ориентацию, поэтому композиция двух таких симметрий — несобственное движение.", why: "Центральная симметрия — поворот на 180°, она ориентацию сохраняет." },
          { t: "По теореме о средней линии MM′ = AB.", why: "Средняя линия вдвое короче стороны, поэтому MM′ = 2AB." },
        ],
        before: [[0, 1], [1, 2], [2, 3], [3, 4]],
        note: "Здесь порядок строгий. Если M лежит на прямой AB, треугольник вырождается, но равенство MM′ = 2AB проверяется напрямую. Это задача 7 листка.",
      },
      {
        statement: `композиция двух осевых симметрий ${Sh("v")} ∘ ${Sh("u")} с осями, пересекающимися в точке O, — поворот вокруг O на угол 2∠(<i>u</i>, <i>v</i>).`,
        steps: [
          `Пусть <i>u</i> ∩ <i>v</i> = O, M ≠ O — произвольная точка, ${Sh("u")}(M) = M₁, ${Sh("v")}(M₁) = M′.`,
          "Точка O лежит на обеих осях, поэтому OM = OM₁ = OM′.",
          "Ось <i>u</i> — биссектриса угла MOM₁, ось <i>v</i> — биссектриса угла M₁OM′.",
          "Поэтому ∠MOM′ = 2∠(<i>u</i>, OM₁) + 2∠(OM₁, <i>v</i>) = 2∠(<i>u</i>, <i>v</i>), и этот угол не зависит от M.",
          `Значит, ${Sh("v")} ∘ ${Sh("u")} — поворот вокруг O на угол 2∠(<i>u</i>, <i>v</i>). ∎`,
        ],
        traps: [
          { t: "Оси — биссектрисы, поэтому ∠MOM′ = ∠(<i>u</i>, <i>v</i>).", why: "Каждая ось делит свой угол пополам, так что угол между осями — половина ∠MOM′." },
          { t: `Две симметрии дважды меняют ориентацию, поэтому ${Sh("v")} ∘ ${Sh("u")} — снова осевая симметрия.`, why: "Чётное число смен ориентации даёт собственное движение, а осевая симметрия несобственная." },
          { t: `${Sh("v")} ∘ ${Sh("u")} = ${Sh("u")} ∘ ${Sh("v")} для любых осей.`, why: "В обратном порядке угол меняет знак: S_u ∘ S_v — поворот на −2∠(u, v)." },
        ],
        before: [[0, 1], [0, 2], [2, 3], [1, 4], [3, 4]],
        note: "Шаги про равные расстояния и про биссектрисы не зависят друг от друга, их можно было поменять местами. Это п. 7.4 у Понарина.",
      },
    ],
  };

  // =====================================================================
  // Допрос: личный зачёт, три вопроса каждому
  // =====================================================================
  function exDet(rng) {
    let M;
    do { M = [[rng.int(-5, 5), rng.int(-5, 5)], [rng.int(-5, 5), rng.int(-5, 5)]]; } while (M.flat().filter(x => x === 0).length > 1 || M[0][1] * M[1][0] === 0);
    const d = det2(M), wrong = M[0][0] * M[1][1] + M[0][1] * M[1][0];
    const p = x => (x < 0 ? "(" + num(x) + ")" : num(x));
    return {
      title: "Определитель", html: `<p>Найдите определитель матрицы</p>${mx(M)}`,
      fields: [{ k: "d", l: "det" }], answer: [d],
      check(v) { if (v[0] === d) return { ok: true }; if (v[0] === wrong) return { ok: false, msg: "Знак: det = a₁₁a₂₂ − a₁₂a₂₁." }; return { ok: false }; },
      explain: `<p class="f">det = ${p(M[0][0])}·${p(M[1][1])} ${MINUS} ${p(M[0][1])}·${p(M[1][0])} = ${num(d)}</p>`,
    };
  }
  function exMV(rng) {
    const M = [[rng.int(-4, 4), rng.int(-4, 4)], [rng.int(-4, 4), rng.int(-4, 4)]];
    let v; do { v = [rng.int(-4, 4), rng.int(-4, 4)]; } while (v[0] === 0 || v[1] === 0);
    const r = mulMV(M, v).map(z0);
    const rt = mulMV([[M[0][0], M[1][0]], [M[0][1], M[1][1]]], v).map(z0);
    return {
      title: "Образ вектора", html: `<p>Найдите <i>A</i>·<b>v</b>:</p><div class="mline">${mx(M)}${col(v)}</div>`,
      fields: [{ k: "x", l: "x" }, { k: "y", l: "y" }], answer: r,
      check(x) { if (eqArr(x, r)) return { ok: true }; if (eqArr(x, rt) && !eqArr(r, rt)) return { ok: false, msg: "Это столбцы на строку: умножайте строку матрицы на столбец v." }; return { ok: false }; },
      explain: `<p class="f">(${M[0].map(num).join(", ")})·${tup(v)} = ${num(r[0])}<br>(${M[1].map(num).join(", ")})·${tup(v)} = ${num(r[1])}</p>`,
    };
  }
  function exCoord(rng) {
    let u, w, D;
    do { u = [rng.int(-3, 3), rng.int(-3, 3)]; w = [rng.int(-3, 3), rng.int(-3, 3)]; D = cr2(u, w); } while (Math.abs(D) !== 1 || (isAxis(u) && isAxis(w)));
    const a = rng.nz(-4, 4), c = rng.nz(-4, 4);
    const b = [a * u[0] + c * w[0], a * u[1] + c * w[1]].map(z0);
    return {
      title: "Координаты в базисе", html: `<p>Найдите <i>a</i> и <i>c</i>, при которых <i>a</i>·<b>u</b> + <i>c</i>·<b>v</b> = <b>b</b>:</p><p class="f"><b>u</b> = ${tup(u)}, <b>v</b> = ${tup(w)}, <b>b</b> = ${tup(b)}</p>`,
      fields: [{ k: "a", l: "a" }, { k: "c", l: "c" }], answer: [a, c],
      check(x) { if (x[0] === a && x[1] === c) return { ok: true }; if (x[0] === c && x[1] === a && a !== c) return { ok: false, msg: "Коэффициенты перепутаны местами." }; return { ok: false }; },
      explain: `<p class="f">${lin2(a, tup(u), c, tup(w))} = ${tup(b)}</p>`,
    };
  }
  function exZ(rng) {
    let A, B;
    do { A = [rng.int(-5, 5), rng.int(-5, 5)]; B = [rng.int(-5, 5), rng.int(-5, 5)]; } while (eqP(A, B));
    const ab = zz(sub(B, A)), v = zz([2 * ab[0], 2 * ab[1]]);
    return {
      title: "Две центральные симметрии", html: `<p>A = ${tup(A)}, B = ${tup(B)}. Композиция ${Zh("B")} ∘ ${Zh("A")} — перенос. На какой вектор?</p>`,
      fields: [{ k: "x", l: "x" }, { k: "y", l: "y" }], answer: v,
      check(x) {
        if (eqArr(x, v)) return { ok: true };
        if (eqArr(x, ab)) return { ok: false, msg: "Это вектор AB, а перенос вдвое длиннее." };
        if (eqArr(x, zz([-v[0], -v[1]]))) return { ok: false, msg: "Направление обратное: сдвиг идёт от A к B." };
        return { ok: false };
      },
      explain: `<p>По формуле (7.1) у Понарина ${Zh("B")} ∘ ${Zh("A")} = ${Th("2AB")}: 2·${tup(ab)} = ${tup(v)}.</p>`,
    };
  }
  function exRot(rng) {
    for (;;) {
      const O = [rng.int(-3, 3), rng.int(-3, 3)], P = [rng.int(-5, 5), rng.int(-5, 5)], phi = rng.pick([90, 270]);
      if (eqP(O, P)) continue;
      const P1 = Rot(O, phi)(P), Pw = Rot(O, 360 - phi)(P);
      if (!inBox(P1, 9)) continue;
      const w = zz(rotV(sub(P, O), phi));
      return {
        title: "Поворот точки", html: `<p>Куда поворот ${Rh("O", phi + "°")} вокруг O = ${tup(O)} переводит точку P = ${tup(P)}?</p>`,
        fields: [{ k: "x", l: "x" }, { k: "y", l: "y" }], answer: P1,
        check(x) { if (eqArr(x, P1)) return { ok: true }; if (eqArr(x, Pw)) return { ok: false, msg: "Это поворот в другую сторону: положительный угол — против часовой стрелки." }; return { ok: false }; },
        explain: `<p>Вектор OP = ${tup(zz(sub(P, O)))} поворачиваем на ${phi}°: получаем ${tup(w)}. Тогда P′ = O + ${tup(w)} = ${tup(P1)}.</p>`,
      };
    }
  }
  function exPar(rng) {
    const kind = rng.pick(["x", "y"]);
    let a, c;
    do { a = rng.int(-5, 5); c = rng.int(-5, 5); } while (a === c);
    const v = zz(kind === "x" ? [2 * (c - a), 0] : [0, 2 * (c - a)]);
    const half = zz(v.map(x => x / 2)), neg = zz([-v[0], -v[1]]);
    return {
      title: "Две параллельные оси", html: `<p>Ось <i>u</i>: ${lineText(kind, a)}, ось <i>v</i>: ${lineText(kind, c)}. Композиция ${Sh("v")} ∘ ${Sh("u")} — перенос. На какой вектор?</p>`,
      fields: [{ k: "x", l: "x" }, { k: "y", l: "y" }], answer: v,
      check(x) {
        if (eqArr(x, v)) return { ok: true };
        if (eqArr(x, half)) return { ok: false, msg: "Вдвое короче: сдвиг на удвоенное расстояние между осями." };
        if (eqArr(x, neg)) return { ok: false, msg: "Направление обратное: от оси u к оси v." };
        return { ok: false };
      },
      explain: `<p>По п. 7.2 это перенос перпендикулярно осям, от <i>u</i> к <i>v</i>, на удвоенное расстояние между ними: ${tup(v)}.</p>`,
    };
  }

  // =====================================================================
  // Реестр дел
  // =====================================================================
  const CASES = {
    bazis: {
      id: "bazis", no: 1, title: "Банк «Базис»", subject: "Линейная алгебра",
      blurb: "Манипулятор на двух рельсах, подделка шифратора, схлопывание лазерной решётки, кодовый сейф, тихие направления и весы. Финал — доказательство и два ключа.",
      levels: [lvCombo, lvMatrix, lvCollapse, lvGauges, lvEigen, lvKernel, rng => lvProof(rng, BAZIS_PROOFS)],
      rooms: ["Вход", "Охрана", "Лазеры", "Сейф", "Датчики", "Весы", "Хранилище"],
      topics: ["Базис и координаты", "Матрица преобразования", "Определитель", "Системы уравнений", "Собственные векторы", "Ядро и ранг", "Доказательство"],
      exam: [exCoord, exMV, exDet],
    },
    usadba: {
      id: "usadba", no: 2, title: "Механическая усадьба", subject: "Движения плоскости", test: true,
      blurb: "Лекция 6 «Движения плоскости»: у каждого своя задача — поворот точки, центр и угол карусели, два зеркала, две карусели, клад. Считаете на бумаге, ответ проверяет замок. Финал — доказательство и два ключа.",
      levels: [lvT(TASK_ROT), lvT(TASK_CENTER), lvT(TASK_MIRRORS), lvT(TASK_ROTS), lvT(TASK_GARDEN), rng => lvProof(rng, USADBA_PROOFS)],
      rooms: ["Сторожка", "Ворота", "Карусели", "Галерея", "Две карусели", "Сад", "Кабинет"],
      roomOfLv: [1, 2, 3, 4, 5, 6], oldRoom: 0,
      old: [{ cs: "bazis", li: 1, bridge: `<p><b>Мостик к теореме Шаля.</b> По формулам (9.3) у Понарина поворот на угол φ имеет матрицу со столбцами (cos φ, sin φ) и (${MINUS}sin φ, cos φ) — это образы базисных векторов, как здесь. У собственных движений определитель такой матрицы равен +1, у несобственных — ${MINUS}1.</p>` }],
      topics: ["Поворот точки", "Центр и угол поворота", "Две осевые симметрии", "Композиция поворотов", "Задача о кладе", "Доказательство"],
      exam: [exZ, exRot, exPar],
    },
  };
  const CASE_IDS = ["bazis", "usadba"];
  const caseOk = cs => (CASES[cs] ? cs : "usadba");

  function stageList(cs, withOld) {
    const c = CASES[caseOk(cs)];
    const out = [];
    if (withOld && c.old) c.old.forEach((o, j) => out.push({ cs: o.cs, li: o.li, old: true, oldNo: j + 1, bridge: o.bridge, room: c.oldRoom }));
    c.levels.forEach((_, li) => out.push({ cs: c.id, li, room: c.roomOfLv ? c.roomOfLv[li] : li }));
    return out;
  }
  const stageCount = (cs, withOld) => stageList(cs, withOld).length;
  const oldCount = (cs, withOld) => (withOld && CASES[caseOk(cs)].old ? CASES[caseOk(cs)].old.length : 0);

  const cache = new Map();
  // vr — вариант: после сирены охрана меняет замки, и у сейфа новые числа
  function getLevel(cs, code, round, pos, withOld, vr) {
    cs = caseOk(cs); vr = vr | 0;
    const key = `${cs}|${withOld ? 1 : 0}|${code}|${round}|${pos}|${vr}`;
    if (cache.has(key)) return cache.get(key);
    const it = stageList(cs, withOld)[pos];
    if (!it) return null;
    const gen = CASES[it.cs].levels[it.li];
    const base = (it.old ? `old|${cs}|${code}|${round}|${pos}` : `${it.cs}|${code}|${round}|${it.li}`) + (vr ? `|v${vr}` : "");
    let L = null, salt = "";
    for (let a = 0; !L && a < 20; a++, salt += "+") L = gen(makeRng(base + salt));
    L.idx = pos;
    L.roomIdx = it.room;
    L.place = CASES[cs].rooms[it.room];
    if (it.old) { L.old = true; L.oldNo = it.oldNo; L.oldFrom = CASES[it.cs].title; L.bridge = it.bridge; }
    cache.set(key, L);
    return L;
  }

  function getExam(cs, code, round, pid) {
    const c = CASES[caseOk(cs)];
    return c.exam.map((g, k) => g(makeRng(`exam|${c.id}|${code}|${round}|${pid}|${k}`)));
  }

  function caseInfo(cs) {
    const c = CASES[caseOk(cs)];
    return {
      id: c.id, no: c.no, title: c.title, subject: c.subject, blurb: c.blurb, test: !!c.test, rooms: c.rooms, topics: c.topics,
      hasOld: !!(c.old && c.old.length), oldN: c.old ? c.old.length : 0, newN: c.levels.length, examN: c.exam ? c.exam.length : 0,
    };
  }

  const ROLES_FLAVOR = ["Хакер", "Медвежатник", "Наблюдатель", "Мозг", "Инсайдер", "Водитель", "Связной", "Акробат", "Механик", "Фальсификатор", "Сапёр", "Стажёр"];
  const nickFlavor = seat => ROLES_FLAVOR[seat % ROLES_FLAVOR.length];

  function makeCode() { return String(1000 + Math.floor(Math.random() * 9000)); }

  // счёт за уровень: 100, минус поимки и ошибки, плюс бонус за скорость, не меньше 20
  function levelLoot(st, par) {
    if (st.revealed) return 0;
    const bonus = Math.round(20 * Math.max(0, 1 - st.time / (par * 1000)));
    return Math.max(20, 100 - 12 * st.caught - 8 * st.bad - 10 * st.hints - 10 * st.sirens + bonus);
  }

  const api = {
    getLevel, stageList, stageCount, oldCount, getExam, caseInfo, caseOk, assignRoles, sanitizeRoleVal, levelLoot, makeCode, nickFlavor,
    esc, stripTags, num, tup, lineText, DIRS, ANG, CASE_IDS, LETTERS, MINUS,
    _test: { makeRng, det2, det3, mulMV, Rot, Tr, Sx, Sy, Sd, Sa, comp, rotV, fixedPoint, along, CASES, eqP, eqPts, val, LINE_DEG, identify },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BazisCore = api;
})(typeof window !== "undefined" ? window : globalThis);
