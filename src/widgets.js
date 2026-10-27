/* Пульты: шаговые ручки, точка на сетке, вектор, угол, ось, компас, кнопки, карточки, ключ, радар сторожа, справочник.
   Один и тот же код рисует пульты на телефоне и в одиночном режиме на большом экране. */
(function (root) {
  "use strict";
  const C = root.BazisCore;
  const esc = C.esc, num = C.num, tup = C.tup, MINUS = C.MINUS;
  const ORIENT = [["x", "│", "вертикальная"], ["y", "─", "горизонтальная"], ["d", "╱", "y = x + c"], ["a", "╲", "y = −x + c"]];
  // какое поле ввода сейчас набирается — состояние экрана, а не значение пульта
  const ACTIVE = new Map();
  const activeOf = (rid, k, n) => Math.max(0, Math.min(n - 1, ACTIVE.get(rid + "|" + k) || 0));
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "neg", "0", "del"];

  // ---------- мини-сетка ----------
  function miniGrid(R, opts) {
    const U = 160 / (2 * R), pad = 10, S = 160 + 2 * pad;
    const X = x => (pad + (x + R) * U).toFixed(1), Y = y => (pad + (R - y) * U).toFixed(1);
    let s = `<svg class="mg" viewBox="0 0 ${S} ${S}" data-grid="${R}" role="img" aria-label="${esc(opts.label || "Сетка")}">`;
    for (let k = -R; k <= R; k++) {
      const c = k === 0 ? "mg-ax" : "mg-g";
      s += `<line class="${c}" x1="${X(k)}" y1="${Y(-R)}" x2="${X(k)}" y2="${Y(R)}"/><line class="${c}" x1="${X(-R)}" y1="${Y(k)}" x2="${X(R)}" y2="${Y(k)}"/>`;
    }
    if (opts.line) {
      const { k, v } = opts.line;
      let p1, p2;
      if (k === "x") { p1 = [v, -R]; p2 = [v, R]; }
      else if (k === "y") { p1 = [-R, v]; p2 = [R, v]; }
      else if (k === "d") { const a = Math.max(-R, -R - v), b = Math.min(R, R - v); p1 = [a, a + v]; p2 = [b, b + v]; }
      else { const a = Math.max(-R, v - R), b = Math.min(R, v + R); p1 = [a, v - a]; p2 = [b, v - b]; }
      s += `<line class="mg-line" x1="${X(p1[0])}" y1="${Y(p1[1])}" x2="${X(p2[0])}" y2="${Y(p2[1])}"/>`;
    }
    if (opts.dir) {
      const [dx, dy] = opts.dir, L = R / Math.hypot(dx, dy);
      s += `<line class="mg-line faint" x1="${X(-dx * L)}" y1="${Y(-dy * L)}" x2="${X(dx * L)}" y2="${Y(dy * L)}"/>`;
      s += `<line class="mg-vec" x1="${X(0)}" y1="${Y(0)}" x2="${X(dx)}" y2="${Y(dy)}"/><circle class="mg-pt" cx="${X(dx)}" cy="${Y(dy)}" r="4"/>`;
    }
    if (opts.vec) s += `<line class="mg-vec" x1="${X(0)}" y1="${Y(0)}" x2="${X(opts.vec[0])}" y2="${Y(opts.vec[1])}"/>`;
    if (opts.pt) s += `<circle class="mg-pt" cx="${X(opts.pt[0])}" cy="${Y(opts.pt[1])}" r="5.5"/>`;
    return s + `</svg>`;
  }
  function gridPoint(svg, ev) {
    const R = +svg.dataset.grid, r = svg.getBoundingClientRect();
    const S = 180, pad = 10, U = 160 / (2 * R);
    const sx = ((ev.clientX - r.left) / r.width) * S, sy = ((ev.clientY - r.top) / r.height) * S;
    const x = Math.round((sx - pad) / U - R), y = Math.round(R - (sy - pad) / U);
    return [Math.max(-R, Math.min(R, x)) || 0, Math.max(-R, Math.min(R, y)) || 0];
  }

  // ---------- один виджет ----------
  function widgetHTML(role, w, v, env) {
    const id = `${role.id}|${w.k || w.t}`;
    const dis = env.disabled ? " disabled" : "";
    const lab = w.label ? `<span class="wl">${esc(w.label)}</span>` : "";
    const rep = op => `data-rep="1" data-role="${role.id}" data-k="${w.k}" data-op="${op}"${dis}`;
    switch (w.t) {
      case "stepper": {
        const x = v[w.k];
        return `<div class="wd w-step">${lab}<div class="st-row"><button class="wbtn big" ${rep("dec")} aria-label="Меньше">${MINUS}</button><output class="st-val">${num(x)}</output><button class="wbtn big" ${rep("inc")} aria-label="Больше">+</button></div></div>`;
      }
      case "pick":
      case "dial": {
        const x = v[w.k];
        return `<div class="wd w-pick">${lab}<div class="opts">${w.opts.map((o, j) => `<button class="opt${x === j ? " on" : ""}" data-role="${role.id}" data-k="${w.k}" data-op="set" data-v="${j}" aria-pressed="${x === j}"${dis}>${esc(o)}</button>`).join("")}</div></div>`;
      }
      case "point":
      case "vec": {
        const p = v[w.k];
        const g = miniGrid(w.R, w.t === "vec" ? { vec: p, pt: p, label: w.label } : { pt: p, label: w.label });
        return `<div class="wd w-point">${lab}<div class="pt-row"><div class="mg-wrap" data-role="${role.id}" data-k="${w.k}" data-tap="1">${g}</div>
<div class="pad"><span></span><button class="wbtn" ${rep("up")} aria-label="Вверх">↑</button><span></span><button class="wbtn" ${rep("left")} aria-label="Влево">←</button><output class="pt-val">${tup(p)}</output><button class="wbtn" ${rep("right")} aria-label="Вправо">→</button><span></span><button class="wbtn" ${rep("down")} aria-label="Вниз">↓</button><span></span></div></div></div>`;
      }
      case "line": {
        const l = v[w.k];
        const kinds = ORIENT.filter(o => (w.kinds || ["x", "y", "d", "a"]).includes(o[0]));
        return `<div class="wd w-line">${lab}<div class="pt-row"><div class="mg-wrap">${miniGrid(w.R, { line: l, label: w.label })}</div>
<div class="line-ctl"><div class="opts">${kinds.map(o => `<button class="opt sym${l.k === o[0] ? " on" : ""}" data-role="${role.id}" data-k="${w.k}" data-op="lk" data-v="${o[0]}" aria-label="${o[2]}" aria-pressed="${l.k === o[0]}"${dis}>${o[1]}</button>`).join("")}</div>
<div class="st-row"><button class="wbtn" ${rep("ldec")} aria-label="Сдвинуть назад">${MINUS}</button><output class="st-val small">${C.stripTags(C.lineText(l.k, l.v))}</output><button class="wbtn" ${rep("linc")} aria-label="Сдвинуть вперёд">+</button></div></div></div></div>`;
      }
      case "nums": {
        const vals = v[w.k] || [], cur = activeOf(role.id, w.k, w.fields.length);
        const at = (op, x) => `data-role="${role.id}" data-k="${w.k}" data-op="${op}" data-v="${x}"${dis}`;
        const fl = w.fields.map((f, i) => `<button type="button" class="fld${i === cur ? " on" : ""}" ${at("fld", i)}><small>${esc(f)}</small><b>${esc((vals[i] || "").replace("-", MINUS))}</b></button>`).join("");
        const keys = KEYS.map(k => `<button type="button" class="key" ${at("key", k)} aria-label="${k === "neg" ? "Сменить знак" : k === "del" ? "Стереть" : k}">${k === "neg" ? "±" : k === "del" ? "⌫" : k}</button>`).join("") +
          (w.fields.length > 1 ? `<button type="button" class="key wide" ${at("key", "next")}>Следующее поле →</button>` : "");
        return `<div class="wd w-nums">${lab}<div class="answer-row"><div class="fields">${fl}</div><div class="keys">${keys}</div></div></div>`;
      }
      case "compass": {
        const i = v[w.k], d = C.DIRS[i];
        return `<div class="wd w-compass">${lab}<div class="pt-row"><div class="mg-wrap">${miniGrid(4, { dir: d, label: w.label })}</div>
<div class="line-ctl"><div class="st-row"><button class="wbtn big" ${rep("ccw")} aria-label="Против часовой">⟲</button><output class="st-val">${tup(d)}</output><button class="wbtn big" ${rep("cw")} aria-label="По часовой">⟳</button></div></div></div></div>`;
      }
      case "action":
        return `<button class="wbtn act${w.ghost ? " ghost" : ""}" data-role="${role.id}" data-op="act" data-act="${w.act}" data-v="${esc(w.data || "")}"${dis}>${esc(w.label)}</button>`;
      case "cards": {
        const px = env.px || {};
        const placed = px.pl || [], burned = px.bu || [];
        const cards = role.cards || [];
        if (!cards.length) return `<p class="muted">Карточек у тебя нет — помогай банде решать, кто ходит.</p>`;
        return `<div class="wd w-cards">${cards.map(L => {
          const st = placed.includes(L) ? "placed" : burned.includes(L) ? "burned" : "";
          const txt = env.cardText ? env.cardText(L) : "";
          return `<div class="pcard ${st}"><div class="pc-top"><b class="letter">${L}</b><span class="pc-state">${st === "placed" ? "в цепочке" : st === "burned" ? "сожжена" : ""}</span></div><p>${txt}</p>${st ? "" : `<div class="pc-act"><button class="wbtn act" data-role="${role.id}" data-op="act" data-act="play" data-v="${L}"${dis}>Выложить</button><button class="wbtn act ghost" data-role="${role.id}" data-op="act" data-act="burn" data-v="${L}"${dis}>Сжечь</button></div>`}</div>`;
        }).join("")}</div>`;
      }
      case "key": {
        const ready = env.px && env.px.ch;
        return `<div class="wd w-key"><button class="keybtn" data-role="${role.id}" data-op="act" data-act="key"${ready && !env.disabled ? "" : " disabled"} aria-label="Повернуть ключ"><span>⚿</span></button><p class="muted">${ready ? "Считайте вслух: «три, два, один» — и вместе поворот." : "Ключ заработает, когда цепочка доказательства будет собрана."}</p></div>`;
      }
      case "radar":
        return `<div class="wd w-radar" id="radar"><div class="radar-ring"><span class="radar-sweep"></span></div><p class="radar-txt" id="radar-txt">Тихо. Охрана далеко.</p><div class="mini-meter"><span>Шум банды</span><div class="meter"><i id="radar-noise" style="width:0%"></i></div></div></div>`;
      case "theory":
        return `<div class="wd w-theory">${(env.theory || []).map(t => `<article class="card" data-kind="theory"><span class="card-kind">Справочник</span><h3>${t.title}</h3><div class="cb">${t.html}</div></article>`).join("")}</div>`;
      default:
        return "";
    }
  }

  function roleHTML(role, v, env) {
    const body = role.w.map(w => widgetHTML(role, w, v || {}, env)).join("");
    const acts = role.w.some(w => w.t === "action") ? "" : "";
    return `<section class="role" id="role-${role.id}" style="--pc:${env.color || "var(--gold)"}">
<header class="role-h"><span class="pchip"></span><div><b>${esc(role.name)}</b><small>${esc(role.desc)}</small></div></header>
${role.info ? `<div class="role-info">${role.info}</div>` : ""}
<div class="role-w">${body}</div>${acts}
</section>`;
  }

  // ---------- изменение значения ----------
  function applyOp(role, v, k, op, arg) {
    const w = role.w.find(x => x.k === k);
    if (!w) return false;
    const before = JSON.stringify(v[k]);
    if (w.t === "stepper") {
      let x = v[k] + (op === "inc" ? 1 : op === "dec" ? -1 : 0);
      if (w.wrap) { if (x > w.max) x = w.min; if (x < w.min) x = w.max; }
      v[k] = Math.max(w.min, Math.min(w.max, x));
    } else if (w.t === "pick" || w.t === "dial") {
      if (op === "set") v[k] = Math.max(0, Math.min(w.opts.length - 1, arg | 0));
    } else if (w.t === "point" || w.t === "vec") {
      const p = v[k].slice();
      if (op === "up") p[1]++; else if (op === "down") p[1]--; else if (op === "left") p[0]--; else if (op === "right") p[0]++;
      else if (op === "tap") { p[0] = arg[0]; p[1] = arg[1]; }
      v[k] = [Math.max(-w.R, Math.min(w.R, p[0])) || 0, Math.max(-w.R, Math.min(w.R, p[1])) || 0];
    } else if (w.t === "line") {
      const l = Object.assign({}, v[k]);
      if (op === "lk") l.k = arg; else if (op === "linc") l.v++; else if (op === "ldec") l.v--;
      l.v = Math.max(-w.R, Math.min(w.R, l.v)) || 0;
      v[k] = l;
    } else if (w.t === "compass") {
      const n = C.DIRS.length;
      v[k] = (v[k] + (op === "ccw" ? 1 : op === "cw" ? -1 : 0) + n) % n;
    } else if (w.t === "nums") {
      // выбор поля меняет только экран («ui»), цифры — значение пульта
      const id = role.id + "|" + k, n = w.fields.length, i = activeOf(role.id, k, n);
      if (op === "fld") { ACTIVE.set(id, Math.max(0, Math.min(n - 1, arg | 0))); return "ui"; }
      if (arg === "next") { ACTIVE.set(id, (i + 1) % n); return "ui"; }
      const a = (v[k] || []).slice();
      while (a.length < n) a.push("");
      let s = a[i] || "";
      if (/^[0-9]$/.test(arg)) { const neg = s.startsWith("-"); let d = neg ? s.slice(1) : s; if (d === "0") d = ""; if (d.length < 2) d += arg; s = (neg ? "-" : "") + d; }
      else if (arg === "neg") s = s.startsWith("-") ? s.slice(1) : "-" + s;
      else if (arg === "del") s = s.slice(0, -1);
      a[i] = s;
      v[k] = a;
    }
    return JSON.stringify(v[k]) !== before;
  }

  // ---------- обновление пульта на месте ----------
  // Кнопки не пересоздаются: иначе ломается автоповтор зажатой стрелки и пропадает фокус.
  // Меняются только значения, подсветка вариантов и мини-сетка.
  function update(rootEl, role, v, env) {
    if (!rootEl || !role) return;
    const sec = rootEl.querySelector(`#role-${CSS.escape(role.id)}`);
    if (!sec) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = roleHTML(role, v || {}, env || {});
    const fresh = tmp.firstElementChild;
    const oldW = sec.querySelectorAll(".role-w > .wd"), newW = fresh.querySelectorAll(".role-w > .wd");
    if (oldW.length !== newW.length) { sec.replaceWith(fresh); return; }
    newW.forEach((nw, i) => {
      const ow = oldW[i];
      const ob = ow.querySelectorAll("button"), nb = nw.querySelectorAll("button");
      if (ow.className !== nw.className || ob.length !== nb.length) { ow.replaceWith(nw); return; }
      const oo = ow.querySelectorAll("output, .fld b");
      nw.querySelectorAll("output, .fld b").forEach((x, j) => { if (oo[j] && oo[j].textContent !== x.textContent) oo[j].textContent = x.textContent; });
      nb.forEach((x, j) => {
        const o = ob[j];
        if (o.className !== x.className) o.className = x.className;
        const ap = x.getAttribute("aria-pressed");
        if (ap !== null && o.getAttribute("aria-pressed") !== ap) o.setAttribute("aria-pressed", ap);
        if (o.disabled !== x.disabled) o.disabled = x.disabled;
      });
      const og = ow.querySelectorAll(".mg-wrap");
      nw.querySelectorAll(".mg-wrap").forEach((x, j) => { if (og[j] && og[j].innerHTML !== x.innerHTML) og[j].innerHTML = x.innerHTML; });
    });
  }

  // ---------- подписка на события ----------
  // api: { roleOf(id), store, onChange(roleId), onAct(roleId, act, data), refresh(roleId) }
  function bind(rootEl, api) {
    let repTimer = null, repFired = false, dragging = null;
    const doOp = b => {
      const rid = b.dataset.role, role = api.roleOf(rid);
      if (!role || !api.store[rid]) return;
      const r = applyOp(role, api.store[rid], b.dataset.k, b.dataset.op, b.dataset.v);
      if (r === "ui") { if (api.refresh) api.refresh(rid); }
      else if (r) api.onChange(rid);
    };
    const stopRep = () => { clearTimeout(repTimer); repTimer = null; };
    rootEl.addEventListener("pointerdown", e => {
      const b = e.target.closest("[data-rep]");
      if (b && !b.disabled) {
        e.preventDefault();
        repFired = true;
        doOp(b);
        stopRep();
        const loop = d => { repTimer = setTimeout(() => { doOp(b); loop(85); }, d); };
        loop(380);
        return;
      }
      const g = e.target.closest("[data-tap]");
      if (g) {
        const svg = g.querySelector("svg");
        const rid = g.dataset.role, role = api.roleOf(rid);
        if (!role || !api.store[rid] || g.closest(".role[aria-disabled=true]")) return;
        e.preventDefault();
        dragging = { g, svg, rid, k: g.dataset.k };
        try { g.setPointerCapture(e.pointerId); } catch (er) { /* нет захвата */ }
        if (applyOp(role, api.store[rid], g.dataset.k, "tap", gridPoint(svg, e))) api.onChange(rid);
      }
    });
    rootEl.addEventListener("pointermove", e => {
      if (!dragging) return;
      const role = api.roleOf(dragging.rid);
      const svg = document.querySelector(`#role-${CSS.escape(dragging.rid)} [data-tap][data-k="${dragging.k}"] svg`) || dragging.svg;
      if (role && applyOp(role, api.store[dragging.rid], dragging.k, "tap", gridPoint(svg, e))) api.onChange(dragging.rid);
    });
    const end = () => { stopRep(); dragging = null; };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    rootEl.addEventListener("click", e => {
      const b = e.target.closest("[data-role][data-op]");
      if (!b || b.disabled) return;
      // нажатие пальцем уже сработало на pointerdown; клик с клавиатуры (detail = 0) делаем здесь
      if (b.dataset.rep) { if (e.detail > 0 && repFired) { repFired = false; return; } doOp(b); return; }
      if (b.dataset.op === "act") { api.onAct(b.dataset.role, b.dataset.act, b.dataset.v || null); return; }
      doOp(b);
    });
  }

  root.Widgets = { roleHTML, widgetHTML, bind, applyOp, miniGrid, update };
})(typeof window !== "undefined" ? window : globalThis);
