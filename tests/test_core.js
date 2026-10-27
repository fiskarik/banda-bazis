// Проверка ядра живой игры: каждый уровень решаем ровно своими пультами и действиями, не решён в начале,
// роли раздаются всем, значения пультов проходят санитайзер, тексты целые, допрос сходится.
const assert = require("assert");
const load = () => { delete require.cache[require.resolve("../src/core.js")]; return require("../src/core.js"); };
const C = load();
const X = C._test;

const bad = s => /undefined|NaN|\[object|\$\{/.test(s);
const VOID = new Set(["br", "img", "hr", "input", "line", "circle", "polygon", "path", "rect", "meta"]);
function balanced(html) {
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) { if (stack.pop() !== tag) return `mismatch </${tag}> near …${html.slice(Math.max(0, m.index - 60), m.index + 10)}`; }
    else if (!VOID.has(tag) && m[2] !== "/") stack.push(tag);
  }
  return stack.length ? `unclosed ${stack.join(",")}` : null;
}
const clone = o => JSON.parse(JSON.stringify(o));

// упрощённый хост: применяет значения, действия и фиксацию целей
function run(L, n, V, acts) {
  const roles = L.roles(n);
  const asg = C.assignRoles(roles, n, 0);
  const aux = L.initAux(n);
  const ctx = (role, now) => ({ role, seat: asg[role], n, V, now, solo: false });
  let now = 1000;
  const evalLatch = () => {
    for (let k = 0; k < 3; k++) {
      const res = L.evaluate(V, aux);
      res.goals.forEach(g => { if (g.latch && g.ok && !aux.latched[g.id]) { aux.latched[g.id] = g.by || true; if (L.onLatch) L.onLatch(aux, g.id, V); } });
    }
    const res = L.evaluate(V, aux);
    return res.done !== undefined ? res.done : res.goals.filter(g => g.latch).every(g => aux.latched[g.id]);
  };
  const log = [];
  for (const a of acts || []) { now += a.dt || 100; const r = L.act(aux, a.type, a.data, ctx(a.role, now)) || {}; log.push(r); }
  return { done: evalLatch(), aux, roles, asg, log };
}

function solveActs(L, n, aux0) {
  const roles = L.roles(n);
  if (L.solveActs) return L.solveActs(aux0);
  if (L.kind === "proof") {
    const acts = [];
    const holder = L2 => roles.find(r => /^h\d+$/.test(r.id) && r.cards.includes(L2)).id;
    L.canon.forEach(Lt => acts.push({ role: holder(Lt), type: "play", data: Lt }));
    Object.keys(L.byLetter).filter(Lt => L.byLetter[Lt].trap !== undefined).forEach(Lt => acts.push({ role: holder(Lt), type: "burn", data: Lt }));
    acts.push({ role: "k1", type: "key", dt: 50 }, { role: "k2", type: "key", dt: 300 });
    return acts;
  }
  return [];
}

const stats = {};
let levels = 0;
for (let t = 0; t < 700; t++) {
  const code = String(1000 + (t * 7919) % 9000), round = 1 + (t % 3);
  for (const cs of C.CASE_IDS) {
    for (const withOld of cs === "usadba" ? [false, true] : [false]) {
      const N = C.stageCount(cs, withOld);
      for (let pos = 0; pos < N; pos++) {
        const L = C.getLevel(cs, code, round, pos, withOld);
        assert(L, `null level ${cs}/${pos}`);
        stats[L.kind] = (stats[L.kind] || 0) + 1;
        for (const n of [1, 2, 3, 4, 5, 6, 8]) {
          const roles = L.roles(n);
          const ids = roles.map(r => r.id);
          assert.strictEqual(new Set(ids).size, ids.length, `dup role ids ${L.kind}`);
          ids.forEach(id => assert(/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id), `role id not identifier: ${id}`));
          const asg = C.assignRoles(roles, n, pos);
          const seatsUsed = new Set(Object.values(asg));
          assert.strictEqual(seatsUsed.size, Math.min(n, roles.length), `${L.kind} n=${n}: not every seat got a role`);
          roles.forEach(r => { assert(asg[r.id] >= 0 && asg[r.id] < n); assert(r.name && r.desc); (r.w || []).forEach(w => assert(w.t)); });
          // начальное состояние не решено
          const V0 = {}; roles.forEach(r => { V0[r.id] = clone(r.init || {}); });
          const r0 = run(L, n, V0, []);
          assert(!r0.done, `${L.kind} solved at start (n=${n}, ${code})`);
          // решение
          const aux = L.initAux(n);
          const V = Object.assign({}, V0, clone(L.solution(aux)));
          roles.forEach(r => { const sv = C.sanitizeRoleVal(r, V[r.id]); assert(sv, `${L.kind}: solution value fails sanitizer for ${r.id}: ${JSON.stringify(V[r.id])}`); });
          const r1 = run(L, n, V, solveActs(L, n, aux));
          assert(r1.done, `${L.kind} not solved by its solution (n=${n}, code ${code}, round ${round}) ${JSON.stringify(r1.log.map(x => x.msg))}`);
        }
        // тексты
        const n = 5, aux = L.initAux(n), roles = L.roles(n);
        const V = {}; roles.forEach(r => { V[r.id] = clone(r.init || {}); });
        const parts = [L.title, L.story, L.goal, L.hint, L.win, L.topic, L.debrief(Object.assign(V, L.solution(aux)), aux), ...(L.theory || []).map(x => x.title + x.html), ...roles.map(r => r.name + r.desc + (r.info || ""))];
        if (L.bridge) parts.push(L.bridge);
        if (L.homework) for (let s = 0; s < n; s++) parts.push(L.homework(s));
        for (const s of parts) { assert(typeof s === "string" && !bad(s), `bad text ${L.kind}: ${String(s).slice(0, 160)}`); const b = balanced(s); assert(!b, `${L.kind}: ${b}`); }
        levels++;
      }
    }
  }
}

// задачи усадьбы: пустой ответ бесплатен, неверный стоит тревоги, верный открывает замок
const TASK_KINDS = ["rotpt", "center", "mirror2", "rotcomp", "treasure"];
const near = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
const rotF = (O, A, deg) => { const a = deg * Math.PI / 180, dx = A[0] - O[0], dy = A[1] - O[1]; return [O[0] + dx * Math.cos(a) - dy * Math.sin(a), O[1] + dx * Math.sin(a) + dy * Math.cos(a)]; };
const LINE = { x: [1, 0], y: [0, 1], d: [-1, 1], a: [1, 1] };  // a·x + b·y = v
const mirror = (l, p) => { const [a, b] = LINE[l.k], t = 2 * (a * p[0] + b * p[1] - l.v) / (a * a + b * b); return [p[0] - t * a, p[1] - t * b]; };
const mod = (x, m) => ((x % m) + m) % m;
// независимая проверка ответа: тригонометрия и формула отражения, а не функции ядра
function checkMath(kind, it, sh) {
  if (kind === "rotpt") assert(near(rotF(it.O, it.A, it.turn), it.A1), "rotpt math");
  else if (kind === "center") assert(near(rotF(it.O, it.A, it.turn), it.A1) && near(rotF(it.O, it.B, it.turn), it.B1), "center math");
  else if (kind === "mirror2") {
    it.F.forEach((p, i) => {
      assert(near(mirror(it.l2, mirror(it.l1, p)), it.F2[i]), "mirror2 composition");
      assert(near(it.rot ? rotF(it.O, p, it.turn) : [p[0] + it.v[0], p[1] + it.v[1]], it.F2[i]), "mirror2 answer");
    });
    if (it.rot) assert.strictEqual(mod(2 * (X.LINE_DEG[it.l2.k] - X.LINE_DEG[it.l1.k]), 360), it.turn, "lemma 6.4: angle = 2∠(l1, l2)");
    else assert.strictEqual(it.l1.k, it.l2.k, "translation only for parallel axes");
  } else if (kind === "rotcomp") {
    it.J.forEach((p, i) => {
      assert(near(rotF(it.O2, rotF(it.O1, p, it.a1), it.a2), it.J2[i]), "rotcomp composition");
      assert(near(it.rot ? rotF(it.O, p, it.turn) : [p[0] + it.v[0], p[1] + it.v[1]], it.J2[i]), "rotcomp answer");
    });
    assert.strictEqual(it.rot ? it.turn : 0, mod(it.a1 + it.a2, 360), "lemma 6.5: angles add");
  } else if (kind === "treasure") {
    assert(near(rotF(sh.W, it.B, -90), it.K1) && near(rotF(sh.D, it.B, 90), it.K2), "stakes");
    assert(near([(it.K1[0] + it.K2[0]) / 2, (it.K1[1] + it.K2[1]) / 2], sh.T), "treasure is the midpoint for every birch");
  }
}
// испортить верный ответ: первое число или координату сдвинуть на 1
function wrongOf(v) {
  const w = clone(v);
  for (const k of Object.keys(w)) {
    if (Array.isArray(w[k]) && typeof w[k][0] === "string") { w[k][0] = String(parseInt(w[k][0], 10) + 1); return w; }
    if (Array.isArray(w[k])) { w[k][0] = w[k][0] >= 6 ? w[k][0] - 1 : w[k][0] + 1; return w; }
  }
  return w;
}
for (let t = 0; t < 300; t++) {
  const code = String(2000 + t);
  for (let pos = 0; pos < TASK_KINDS.length; pos++) {
    const L = C.getLevel("usadba", code, 1, pos, false);
    assert.strictEqual(L.kind, TASK_KINDS[pos]);
    const n = 4, roles = L.roles(n), aux = L.initAux(n), sol = L.solution(aux), V = {};
    roles.forEach(r => { V[r.id] = clone(r.init); });
    let r = L.act(aux, "check", null, { role: "t0", V, now: 1 });
    assert(!r.alarm && !aux.solved.t0 && !L.ready("t0", V.t0), `${L.kind}: empty answer is free`);
    const Vw = clone(V); Vw.t1 = wrongOf(sol.t1);
    assert(L.ready("t1", Vw.t1) && C.sanitizeRoleVal(roles[1], Vw.t1), `${L.kind}: wrong answer is a valid input`);
    r = L.act(aux, "check", null, { role: "t1", V: Vw, now: 2 });
    assert(r.alarm && !aux.solved.t1 && aux.wrong.t1.n === 1, `${L.kind}: wrong answer costs alarm`);
    const Vs = Object.assign(clone(V), clone(sol));
    r = L.act(aux, "check", null, { role: "t1", V: Vs, now: 3 });
    assert(r.fx === "lock" && aux.solved.t1 && !aux.wrong.t1, `${L.kind}: right answer opens`);
    assert.deepStrictEqual(L.act(aux, "check", null, { role: "t1", V: Vw, now: 4 }), {}, "solved lock ignores checks");
    assert(!L.evaluate(V, aux).done, `${L.kind}: one lock is not the whole safe`);
    const sc = L.evaluate(Vs, aux).scene;
    sc.items.forEach(it => checkMath(L.kind, it, sc.shared));
    // у всех свои числа
    assert.strictEqual(new Set(roles.filter(x => x.task).map(x => x.info)).size, n, `${L.kind}: every seat has its own task`);
    // типичная ошибка «повернули не в ту сторону» узнаётся
    if (L.kind === "rotpt") {
      const it = sc.items[2];
      if (it.turn !== 180) {
        const back = rotF(it.O, it.A, -it.turn).map(x => String(Math.round(x) || 0));
        const rr = L.act(aux, "check", null, { role: "t2", V: { t2: { a: back } }, now: 5 });
        assert(/не в ту сторону/.test(rr.msg), "rotpt: wrong direction is named");
      }
    }
  }
  // после сирены — новые числа
  const a = C.getLevel("usadba", code, 1, 0, false, 0), b = C.getLevel("usadba", code, 1, 0, false, 1);
  assert.notStrictEqual(a.roles(3).map(x => x.info).join(), b.roles(3).map(x => x.info).join(), "variant changes numbers");
  // доказательство: фальшивку нельзя выложить, верный шаг нельзя жечь, ключи вразнобой не открывают
  const P = C.getLevel("usadba", code, 1, 5, false);
  const pn = 2, paux = P.initAux(pn), proles = P.roles(pn), pasg = C.assignRoles(proles, pn, 0);
  const holder = Lt => proles.find(rr => /^h\d+$/.test(rr.id) && rr.cards.includes(Lt)).id;
  const trap = Object.keys(P.byLetter).find(Lt => P.byLetter[Lt].trap !== undefined);
  let pr = P.act(paux, "play", trap, { role: holder(trap), seat: pasg[holder(trap)], n: pn, now: 1 });
  assert(pr.alarm && paux.burned.includes(trap));
  const first = P.canon[0], last = P.canon[P.canon.length - 1];
  pr = P.act(paux, "play", last, { role: holder(last), seat: pasg[holder(last)], n: pn, now: 2 });
  assert(/рано/.test(pr.msg), "out of order must bounce");
  pr = P.act(paux, "burn", first, { role: holder(first), seat: pasg[holder(first)], n: pn, now: 3 });
  assert(pr.alarm && !paux.burned.includes(first), "burning a true step is an error");
  // чужую карточку выложить нельзя
  const other = proles.find(rr => /^h\d+$/.test(rr.id) && !rr.cards.includes(first));
  if (other) { pr = P.act(paux, "play", first, { role: other.id, seat: pasg[other.id], n: pn, now: 4 }); assert(!pr.msg && !paux.placed.length, "foreign card"); }
  P.canon.forEach((Lt, i) => P.act(paux, "play", Lt, { role: holder(Lt), seat: pasg[holder(Lt)], n: pn, now: 10 + i }));
  assert.strictEqual(paux.placed.length, P.nSteps);
  P.act(paux, "key", null, { role: "k1", seat: pasg.k1, n: pn, now: 100 });
  pr = P.act(paux, "key", null, { role: "k2", seat: pasg.k2, n: pn, now: 2000 });
  assert(!paux.opened && /одновременно/.test(pr.msg));
  P.act(paux, "key", null, { role: "k1", seat: pasg.k1, n: pn, now: 3000 });
  P.act(paux, "key", null, { role: "k2", seat: pasg.k2, n: pn, now: 3400 });
  assert(paux.opened);
  // собственные векторы: одно и то же направление дважды не засчитывается
  const E = C.getLevel("bazis", code, 1, 4, false), eaux = E.initAux(4), es = E.solution(eaux);
  const Ve = clone(es); Ve.d2 = clone(es.d1); Ve.l2 = clone(es.l1);
  const er = run(E, 4, Ve, []);
  assert(!er.done, "same eigen-direction twice must not pass");
}

// санитайзер отбрасывает мусор
{
  const r = C.getLevel("usadba", "1234", 1, 0, false).roles(4).find(x => x.id === "t0");
  assert(C.sanitizeRoleVal(r, { a: ["3", "-2"] }) && C.sanitizeRoleVal(r, { a: ["", "-"] }));
  assert.strictEqual(C.sanitizeRoleVal(r, { a: ["3"] }), null);
  assert.strictEqual(C.sanitizeRoleVal(r, { a: [3, 2] }), null);
  assert.strictEqual(C.sanitizeRoleVal(r, { a: ["1234", "1"] }), null);
  assert.strictEqual(C.sanitizeRoleVal(r, { a: ["<b>", "1"] }), null);
  assert.strictEqual(C.sanitizeRoleVal(r, "x"), null);
  const m = C.getLevel("usadba", "1234", 1, 2, false).roles(4).find(x => x.id === "t0");
  assert(C.sanitizeRoleVal(m, { m: -1, p: ["", ""], a: -1 }));
  assert.strictEqual(C.sanitizeRoleVal(m, { m: -2, p: ["", ""], a: -1 }), null);
  assert.strictEqual(C.sanitizeRoleVal(m, { m: 0, p: ["", ""], a: 3 }), null);
  const c = C.getLevel("usadba", "1234", 1, 1, false).roles(4).find(x => x.id === "t0");
  assert(C.sanitizeRoleVal(c, { c: [1, 2], a: 2 }));
  assert.strictEqual(C.sanitizeRoleVal(c, { c: [1, 99], a: 2 }), null);
  assert.strictEqual(C.sanitizeRoleVal(c, { c: ["1", 2], a: 2 }), null);
}

// допрос
for (const cs of C.CASE_IDS) {
  for (let t = 0; t < 1500; t++) {
    const qs = C.getExam(cs, String(3000 + t), 1 + (t % 2), "p" + t.toString(36) + "abcde");
    assert.strictEqual(qs.length, 3);
    for (const q of qs) {
      assert(q.check(q.answer).ok, `exam answer fails ${cs} ${q.title}`);
      const w = q.answer.slice(); w[0] += 1;
      assert(!q.check(w).ok, `exam wrong accepted ${cs} ${q.title}`);
      [q.html, q.explain, q.title].forEach(s => { assert(!bad(s), s); assert(!balanced(s), balanced(s)); });
    }
  }
}

// детерминизм
const C2 = load();
for (let t = 0; t < 60; t++) for (const cs of C.CASE_IDS) for (let pos = 0; pos < C.stageCount(cs, true); pos++) {
  const a = C.getLevel(cs, String(5000 + t), 2, pos, true), b = C2.getLevel(cs, String(5000 + t), 2, pos, true);
  assert.strictEqual(JSON.stringify(a.solution(a.initAux(5))), JSON.stringify(b.solution(b.initAux(5))));
  assert.strictEqual(a.debrief(a.solution(a.initAux(5)), a.initAux(5)), b.debrief(b.solution(b.initAux(5)), b.initAux(5)));
}

console.log("levels checked:", levels, JSON.stringify(stats));
console.log("OK");
