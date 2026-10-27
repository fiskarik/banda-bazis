// Игра по локальной сети. Страницу и связь даёт bazis_server.py на ноутбуке.
// LanRoom повторяет интерфейс комнаты Claude (presence + onPeers + onConnection), поэтому остальная игра не знает, где она запущена.
(function (root) {
  "use strict";
  let single = null;

  function create() {
    if (single) return single;
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    // одна вкладка — один cid: при переподключении сервер сразу выкидывает её старое, повисшее соединение
    const cid = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    let ws = null, myId = "", mine = {}, others = new Map(), up = false, tries = 0, timer = 0, lastIn = 0;
    const peerCbs = new Set(), connCbs = new Set();
    const now = () => Date.now();

    function snapshot() {
      const list = [{ peer: myId || "self", by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, mine)), updatedAt: now() }];
      others.forEach((o, peer) => list.push({ peer, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: o.p, updatedAt: o.at }));
      return Object.freeze(list);
    }
    function notify() {
      const peers = snapshot();
      peerCbs.forEach(h => { if (h.fn) { try { h.fn({ peers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } } });
    }
    function setUp(v) {
      if (up === v) return;
      up = v;
      connCbs.forEach(h => { if (h.fn) { try { h.fn(v); } catch (e) { console.error(e); } } });
    }
    function send(o) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(o)); return true; } catch (e) { return false; }
    }
    // соединение s больше не живое: забываем всех, сообщаем игре и переподключаемся
    function lost(s) {
      if (s !== ws) return;
      ws = null;
      try { s.onopen = s.onmessage = s.onclose = s.onerror = null; s.close(); } catch (e) { /* уже закрыто */ }
      if (others.size) { others = new Map(); notify(); }
      setUp(false);
      schedule(false);
    }
    function schedule(fast) {
      clearTimeout(timer);
      const d = fast ? 30 : Math.min(3000, Math.round(300 * Math.pow(1.7, tries++)));
      timer = setTimeout(connect, d);
    }
    function onMessage(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "hb") {
        send({ t: "hb" }); // отвечаем сразу: таймеры в свёрнутой вкладке браузер замедляет, а сообщения — нет
      } else if (m.t === "welcome") {
        myId = String(m.id || "");
        tries = 0;
        others = new Map();
        const ps = m.peers && typeof m.peers === "object" ? m.peers : {};
        Object.keys(ps).forEach(id => { if (ps[id] && typeof ps[id] === "object") others.set(id, { p: Object.freeze(ps[id]), at: now() }); });
        setUp(true);
        notify();
      } else if (m.t === "p" && typeof m.id === "string" && m.d && typeof m.d === "object") {
        const o = others.get(m.id), next = Object.assign({}, o ? o.p : {});
        Object.keys(m.d).forEach(k => { const v = m.d[k]; if (v === null) delete next[k]; else next[k] = v; });
        others.set(m.id, { p: Object.freeze(next), at: now() });
        notify();
      } else if (m.t === "bye" && typeof m.id === "string") {
        if (others.delete(m.id)) notify();
      }
    }
    function connect() {
      clearTimeout(timer);
      timer = 0;
      if (ws) return;
      let s;
      try { s = new WebSocket(url); } catch (e) { schedule(false); return; }
      ws = s;
      s.onopen = () => { lastIn = now(); send({ t: "hi", cid, p: mine }); };
      s.onmessage = ev => {
        if (s !== ws) return;
        lastIn = now();
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        onMessage(m);
      };
      s.onclose = () => lost(s);
      s.onerror = () => { /* следом придёт onclose */ };
      setTimeout(() => { if (ws === s && s.readyState === 0) lost(s); }, 6000);
    }
    // сервер шлёт «тик» каждые 4 с; 12 с тишины — соединение мёртвое (телефон засыпал, Wi‑Fi моргнул)
    setInterval(() => {
      if (ws && ws.readyState === 1) { send({ t: "hb" }); if (now() - lastIn > 12000) lost(ws); }
    }, 4000);
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (!ws) { tries = 0; schedule(true); }
      else if (ws.readyState === 1 && now() - lastIn > 6000) lost(ws); // после сна сокет часто висит, хотя считается открытым
    };
    document.addEventListener("visibilitychange", wake);
    root.addEventListener("online", wake);
    root.addEventListener("pageshow", wake);
    connect();

    single = {
      name: "lan",
      presence(patch) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) return Promise.reject({ code: "invalid_argument", message: "presence patch must be an object" });
        let clean;
        try { clean = JSON.parse(JSON.stringify(patch)); } catch (e) { return Promise.reject({ code: "invalid_argument", message: "presence is not JSON" }); }
        const next = Object.assign({}, mine);
        Object.keys(clean).forEach(k => { if (clean[k] === null) delete next[k]; else next[k] = clean[k]; });
        mine = next;
        send({ t: "p", d: clean }); // без связи — уйдёт целиком при переподключении
        return Promise.resolve();
      },
      peers: snapshot,
      onPeers(fn) {
        const h = { fn };
        peerCbs.add(h);
        setTimeout(() => { if (h.fn) { try { h.fn({ peers: snapshot(), joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } } }, 0);
        return () => { h.fn = null; peerCbs.delete(h); };
      },
      onConnection(fn) {
        const h = { fn };
        connCbs.add(h);
        return () => { h.fn = null; connCbs.delete(h); };
      },
      connected: () => up,
      _drop() { if (ws) lost(ws); }, // для проверок: оборвать связь
    };
    return single;
  }

  // Запасной способ держать экран телефона включённым, когда Wake Lock недоступен
  // (страница по http в локальной сети): крошечное беззвучное видео по кругу. Работает не везде — это подстраховка.
  const WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAImEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIQ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjzxBFRgaB3UJyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhA7msoDgibCBELqBEJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYjzxBFRgaB3UGfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXs54EAo6KBAACAEAIAnQEqEAAQAAhHCIWFiIWEiCwCAAwNYAD+7qBAo5WBAPoAsQEAIRH8ABgAGFgv9AAIAACjlYEB9ACxAQAhEfwAGAAYWC/0AAgAAKOVgQLuALEBACER/AAYABhYL/QACAAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==";
  const MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMNbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlx0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHUbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABf21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAT9zdGJsAAAAt3N0c2QAAAAAAAAAAQAAAKdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAe/+EAFWdCwB7aewEQAAADABAAAAMAgPFi6gEABWjOAZcgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAAYgAAAGIAAAAGHN0dHMAAAAAAAAAAQAAAAQAABAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAQAAAABAAAAJHN0c3oAAAAAAAAAAAAAAAQAAAATAAAACgAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAAz0AAAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAAA5bWRhdAAAAA9liIQFc5///w9FAAEAv4AAAAAGQZogFc51AAAABkGaQBTOdQAAAAZBmmATznU=";
  let vid = null;
  function videoOn() {
    try {
      if (!vid) {
        vid = document.createElement("video");
        vid.setAttribute("playsinline", "");
        vid.setAttribute("muted", "");
        vid.setAttribute("aria-hidden", "true");
        vid.muted = true;
        vid.loop = true;
        vid.tabIndex = -1;
        vid.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1";
        [[WEBM, "video/webm"], [MP4, "video/mp4"]].forEach(([src, type]) => { const s = document.createElement("source"); s.src = src; s.type = type; vid.appendChild(s); });
        document.body.appendChild(vid);
      }
      const p = vid.play();
      if (p && p.catch) p.catch(() => { /* браузер не дал — не страшно */ });
    } catch (e) { /* видео недоступно */ }
  }
  function videoOff() { try { if (vid) vid.pause(); } catch (e) { /* уже стоит */ } }

  root.LanRoom = { create };
  root.KeepAwake = { videoOn, videoOff, get playing() { return !!(vid && !vid.paused); } };
})(window);
