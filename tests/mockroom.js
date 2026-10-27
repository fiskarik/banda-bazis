// Имитация room-capability через BroadcastChannel: вкладки одного origin видят presence друг друга.
// Как на платформе: сам namespace — это лобби (общая комната артефакта), join(name) — именованная комната.
// Ключи presence проверяются так же, как на платформе: только идентификаторы.
// window.__MOCK_ROOM = "null" перед загрузкой — имитация страницы, которой связь не дали.
(() => {
  const peerId = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  window.__mockPresenceBytes = 0;
  function makeRoom(name, withLeave) {
    const ch = new BroadcastChannel("mockroom-" + name);
    let mine = {};
    const others = new Map();
    const cbs = [];
    const snap = () => Object.freeze([
      { peer: peerId, by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze({ ...mine }), updatedAt: Date.now() },
      ...[...others.entries()].map(([peer, o]) => ({ peer, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: Object.freeze({ ...o.presence }), updatedAt: o.at })),
    ]);
    const notify = () => { const peers = snap(); cbs.forEach(cb => cb.fn && cb.fn({ peers, joined: [], left: [], updated: [] })); };
    ch.onmessage = e => {
      const m = e.data;
      if (m.t === "hello") ch.postMessage({ t: "pres", peer: peerId, presence: mine });
      if (m.t === "pres") { others.set(m.peer, { presence: m.presence, at: Date.now() }); notify(); }
      if (m.t === "bye") { others.delete(m.peer); notify(); }
    };
    addEventListener("pagehide", () => ch.postMessage({ t: "bye", peer: peerId }));
    ch.postMessage({ t: "hello", peer: peerId });
    const room = {
      name,
      presence(patch) {
        const badKey = o => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).some(k => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) || badKey(o[k]));
        if (badKey(patch)) return Promise.reject({ code: "invalid_argument", message: "presence key is not an identifier: " + JSON.stringify(patch).slice(0, 200) });
        const next = { ...mine };
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = JSON.parse(JSON.stringify(v)); }
        const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
        window.__mockPresenceBytes = Math.max(window.__mockPresenceBytes, bytes);
        if (bytes > 4096) { console.error("mockroom: presence over 4 KiB: " + bytes); return Promise.reject({ code: "invalid_argument", message: "presence > 4 KiB" }); }
        mine = next;
        ch.postMessage({ t: "pres", peer: peerId, presence: mine });
        setTimeout(notify, 0);
        return Promise.resolve();
      },
      peers: snap,
      onPeers(cb) { const h = { fn: cb }; cbs.push(h); setTimeout(() => h.fn && h.fn({ peers: snap(), joined: snap(), left: [], updated: [] }), 0); return () => { h.fn = null; }; },
      onConnection(cb) { setTimeout(() => cb(true), 0); return () => {}; },
      connected: () => true,
      emit: () => Promise.resolve(),
      on: () => () => {},
    };
    if (withLeave) room.leave = () => { ch.postMessage({ t: "bye", peer: peerId }); ch.close(); return Promise.resolve(); };
    return room;
  }
  let lobby = null;
  const ns = new Proxy({}, {
    get(_, k) {
      if (k === "join") return async name => { if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw { code: "invalid_argument" }; return makeRoom(name, true); };
      if (!lobby) lobby = makeRoom("lobby", false);
      return lobby[k];
    },
  });
  window.claude = { use: async name => (name === "room" && window.__MOCK_ROOM !== "null" ? ns : null) };
})();
