/* Генеративный шпионский джаз на WebAudio: грув с ходячим басом, напряжение растёт вместе с тревогой,
   при обходе охраны всё стихает до гула и стука сердца, при сирене воет сирена. Плюс короткие звуки событий. */
(function (root) {
  "use strict";
  let ac = null, master = null, bus = null, noiseBuf = null;
  let enabled = true, volume = 0.55;
  let mode = "off", intensity = 0, tempo = 100;
  let timer = null, nextT = 0, step = 0;
  let drone = null, siren = null;

  const N = {
    A1: 55, E2: 82.41, F2: 87.31, G2: 98, Gs2: 103.83, A2: 110, As2: 116.54, B2: 123.47, C3: 130.81, Cs3: 138.59, D3: 146.83,
    E3: 164.81, F3: 174.61, G3: 196, Gs3: 207.65, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392, Gs4: 415.3, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, A5: 880,
  };
  const PROG = [
    { keys: [N.A3, N.C4, N.E4, N.G4], bass: [N.A2, N.C3, N.E3, N.Cs3] },
    { keys: [N.F3, N.A3, N.C4, N.D4], bass: [N.D3, N.A2, N.F2, N.As2] },
    { keys: [N.F3, N.A3, N.B3, N.D4], bass: [N.B2, N.D3, N.A2, N.F2] },
    { keys: [N.Gs3, N.B3, N.D4, N.E4], bass: [N.E2, N.Gs2, N.B2, N.Gs2] },
  ];
  // мотив: [шаг в 4 тактах (16-е), нота, длина в 16-х]
  const LEAD = [
    [0, N.E5, 3], [3, N.D5, 1], [4, N.C5, 2], [6, N.A4, 2], [8, N.B4, 2], [10, N.C5, 2], [12, N.E5, 4],
    [16, N.F5, 3], [19, N.E5, 1], [20, N.D5, 2], [22, N.A4, 2], [24, N.C5, 4], [28, N.A4, 4],
    [32, N.B4, 2], [34, N.D5, 2], [36, N.F4, 2], [38, N.A4, 2], [40, N.Gs4, 6],
    [48, N.E5, 2], [50, N.D5, 2], [52, N.B4, 2], [54, N.Gs4, 2], [56, N.E4, 4], [60, N.Gs4, 4],
  ];

  function ensure() {
    if (ac) return ac;
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = enabled ? volume : 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    bus = ac.createGain();
    const rev = ac.createConvolver(), revGain = ac.createGain();
    rev.buffer = impulse(1.9);
    revGain.gain.value = 0.2;
    bus.connect(comp); bus.connect(rev); rev.connect(revGain); revGain.connect(comp);
    comp.connect(master); master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  function impulse(sec) {
    const len = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return b;
  }
  const env = (g, t, a, peak, dec, sus, rel, end) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + dec);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + rel); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec + rel);
  };
  function noise(t, dur, type, freq, q, peak, decay, dest) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); env(g, t, 0.002, peak, decay, 0.0001, 0.02);
    s.connect(f); f.connect(g); g.connect(dest || bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  function tone(t, freq, type, peak, a, dec, sus, rel, len, filt, dest) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ac.createGain(); env(g, t, a, peak, dec, sus, rel, len ? t + len : 0);
    let node = o;
    if (filt) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filt; f.Q.value = 0.7; o.connect(f); node = f; }
    node.connect(g); g.connect(dest || bus);
    o.start(t); o.stop(t + (len || a + dec) + rel + 0.05);
    return o;
  }
  // ---------- инструменты ----------
  function kick(t, g) {
    const o = ac.createOscillator(), a = ac.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    env(a, t, 0.003, g, 0.28, 0.0001, 0.02);
    o.connect(a); a.connect(bus); o.start(t); o.stop(t + 0.4);
  }
  const snare = (t, g) => { noise(t, 0.2, "bandpass", 1900, 0.7, g, 0.13); tone(t, 210, "triangle", g * 0.5, 0.002, 0.06, 0.0001, 0.02, 0, 0); };
  const brush = (t, g) => noise(t, 0.3, "bandpass", 3200, 0.6, g, 0.2);
  const hat = (t, g, open) => noise(t, open ? 0.35 : 0.08, "highpass", 7600, 0.8, g, open ? 0.26 : 0.035);
  const bass = (t, f, len, g) => { tone(t, f, "triangle", g, 0.006, 0.12, 0.55, 0.06, len, 900); tone(t, f * 2, "sine", g * 0.18, 0.004, 0.08, 0.2, 0.05, len * 0.6, 0); };
  function keys(t, fs, len, g) { fs.forEach(f => { tone(t, f * (1 + (Math.random() - 0.5) * 0.002), "sine", g, 0.004, 0.22, 0.35, 0.12, len, 0); tone(t, f * 2, "sine", g * 0.22, 0.002, 0.07, 0.0001, 0.02, 0, 0); }); }
  function lead(t, f, len, g) {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, t);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.4; lg.gain.value = f * 0.004; lfo.connect(lg); lg.connect(o.frequency);
    const fl = ac.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.setValueAtTime(900, t); fl.frequency.linearRampToValueAtTime(1900, t + 0.08); fl.Q.value = 1.5;
    const a = ac.createGain(); env(a, t, 0.02, g, 0.1, 0.7, 0.1, t + len);
    o.connect(fl); fl.connect(a); a.connect(bus);
    o.start(t); lfo.start(t); o.stop(t + len + 0.2); lfo.stop(t + len + 0.2);
  }
  function startDrone() {
    if (drone || !ac) return;
    const t = ac.currentTime, g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.6);
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260; f.Q.value = 3;
    const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 0.18; lg.gain.value = 120; l.connect(lg); lg.connect(f.frequency);
    const os = [N.A1, N.A1 * 1.004, N.E2].map(fr => { const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(t); return o; });
    f.connect(g); g.connect(bus); l.start(t);
    drone = { g, os: os.concat([l]) };
  }
  function stopDrone() {
    if (!drone) return;
    const t = ac.currentTime, d = drone; drone = null;
    d.g.gain.cancelScheduledValues(t); d.g.gain.setValueAtTime(d.g.gain.value || 0.05, t); d.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    d.os.forEach(o => o.stop(t + 0.6));
  }
  function startSiren() {
    if (siren || !ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = "square"; f.type = "lowpass"; f.frequency.value = 1800;
    for (let k = 0; k < 40; k++) o.frequency.setValueAtTime(k % 2 ? 880 : 660, t + k * 0.42);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.1);
    o.connect(f); f.connect(g); g.connect(bus); o.start(t); o.stop(t + 17);
    siren = { o, g };
  }
  function stopSiren() {
    if (!siren) return;
    const t = ac.currentTime, s = siren; siren = null;
    s.g.gain.cancelScheduledValues(t); s.g.gain.setValueAtTime(0.04, t); s.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    s.o.stop(t + 0.35);
  }

  // ---------- секвенсор ----------
  function stepDur() { return 60 / tempo / 4; }
  function schedule(i, t) {
    const sd = stepDur(), s16 = i % 16, bar = Math.floor(i / 16) % 4, beat = Math.floor(s16 / 4);
    const ch = PROG[bar];
    const sw = s16 % 4 === 2 ? sd * 0.28 : 0;
    const ti = t + sw;
    const I = intensity;
    if (mode === "lobby" || mode === "calm") {
      if (s16 % 4 === 0) bass(t, ch.bass[beat], sd * 3.2, mode === "calm" ? 0.16 : 0.2);
      if (s16 === 0 || s16 === 10) keys(ti, ch.keys, sd * (s16 === 0 ? 6 : 4), mode === "calm" ? 0.035 : 0.045);
      if (mode === "lobby") { if (s16 % 4 === 2) brush(ti, 0.05); if (s16 === 0) kick(t, 0.35); if (s16 % 8 === 4) brush(t, 0.09); }
    } else if (mode === "play") {
      if (s16 % 4 === 0) bass(t, ch.bass[beat], sd * 3.4, 0.24);
      if (I > 0.6 && s16 % 4 === 2) bass(ti, ch.bass[beat] * 2, sd * 1.2, 0.08);
      if (s16 === 0 || s16 === 8 || (s16 === 7 && I > 0.3)) kick(t, 0.55);
      if (s16 === 4 || s16 === 12) snare(t, 0.16 + 0.08 * I);
      if (s16 === 10 && I > 0.4) snare(ti, 0.05);
      if (s16 % 2 === 0) hat(ti, s16 % 4 === 0 ? 0.07 : 0.05, s16 === 14 && I > 0.5);
      else if (I > 0.55) hat(t, 0.025, false);
      if (s16 === 6 || s16 === 11) keys(ti, ch.keys, sd * 1.6, 0.03 + 0.015 * I);
      if (I > 0.5) { const l = LEAD.find(x => x[0] === (i % 64)); if (l) lead(t, l[1], l[2] * sd * 0.95, 0.045 + 0.03 * I); }
    } else if (mode === "check") {
      if (s16 === 0) { kick(t, 0.32); kick(t + 0.17, 0.2); }
      if (s16 === 8 && I > 0.5) { kick(t, 0.28); kick(t + 0.17, 0.16); }
      if (s16 % 8 === 0) tone(t, N.E5 * (s16 === 0 ? 1 : 1.0595), "sine", 0.012, 0.3, 0.6, 0.4, 0.4, sd * 6, 0);
    } else if (mode === "siren") {
      if (s16 % 4 === 0) kick(t, 0.6);
      if (s16 % 4 === 2) snare(t, 0.14);
      hat(t, s16 % 2 ? 0.03 : 0.06, false);
      if (s16 % 2 === 0) bass(t, ch.bass[beat] * (s16 % 4 ? 2 : 1), sd * 1.6, 0.22);
    }
  }
  function tick() {
    if (!ac) return;
    while (nextT < ac.currentTime + 0.14) { schedule(step, nextT); nextT += stepDur(); step++; }
  }
  function run() {
    if (timer || !ac) return;
    nextT = ac.currentTime + 0.06; step = 0;
    timer = setInterval(tick, 25);
  }

  const M = {
    unlock() {
      if (!ensure()) return false;
      if (ac.state === "suspended") ac.resume().catch(() => { /* звук недоступен */ });
      return true;
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (!ac) return;
      if (m === "check") startDrone(); else stopDrone();
      if (m === "siren") startSiren(); else stopSiren();
      tempo = m === "lobby" ? 96 : m === "calm" ? 84 : m === "check" ? 70 : m === "siren" ? 132 : 100 + 18 * intensity;
      if (m === "off") { clearInterval(timer); timer = null; } else run();
    },
    setIntensity(x) {
      intensity = Math.max(0, Math.min(1, x));
      if (mode === "play") tempo = 100 + 18 * intensity;
      if (mode === "check") tempo = 70;
    },
    setEnabled(on) {
      enabled = !!on;
      if (ac) { const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(enabled ? volume : 0, t, 0.05); }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (ac && enabled) { const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(volume, t, 0.05); }
    },
    sting(kind) {
      if (!ac || !enabled) return;
      const t = ac.currentTime + 0.01;
      if (kind === "lock") { tone(t, N.E5, "triangle", 0.24, 0.003, 0.18, 0.0001, 0.05); tone(t + 0.09, N.A5, "triangle", 0.24, 0.003, 0.3, 0.0001, 0.1); noise(t, 0.08, "bandpass", 4200, 2, 0.12, 0.04); }
      else if (kind === "win") { [N.A3, N.Cs3 * 2, N.E4, N.A4, N.Cs3 * 4].forEach((f, k) => tone(t + k * 0.07, f, "sawtooth", 0.05, 0.01, 0.4, 0.3, 0.4, 0.5, 2400)); noise(t + 0.3, 1.4, "highpass", 6000, 0.5, 0.06, 1.1); kick(t, 0.6); }
      else if (kind === "caught") { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5); env(g, t, 0.005, 0.7, 0.55, 0.0001, 0.05); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.7); tone(t, 233, "sawtooth", 0.06, 0.005, 0.4, 0.0001, 0.1, 0, 1600); tone(t, 330, "sawtooth", 0.06, 0.005, 0.4, 0.0001, 0.1, 0, 1600); noise(t, 0.4, "lowpass", 900, 0.5, 0.25, 0.3); }
      else if (kind === "bad") { tone(t, 98, "square", 0.07, 0.005, 0.3, 0.0001, 0.05, 0, 700); tone(t, 104, "square", 0.05, 0.005, 0.3, 0.0001, 0.05, 0, 700); }
      else if (kind === "tick") { noise(t, 0.04, "bandpass", 5200, 3, 0.12, 0.02); }
      else if (kind === "place") { tone(t, N.A4, "sine", 0.2, 0.003, 0.25, 0.0001, 0.05); tone(t, N.E5, "sine", 0.1, 0.003, 0.25, 0.0001, 0.05); }
      else if (kind === "burn") { noise(t, 0.6, "bandpass", 900, 0.6, 0.18, 0.5); tone(t, 180, "sawtooth", 0.03, 0.01, 0.3, 0.0001, 0.05, 0, 500); }
      else if (kind === "spin") { const o = ac.createOscillator(), g = ac.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(330, t); o.frequency.linearRampToValueAtTime(495, t + 0.7); env(g, t, 0.02, 0.16, 0.6, 0.0001, 0.1); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.9); }
      else if (kind === "key") { noise(t, 0.05, "bandpass", 3000, 4, 0.2, 0.03); noise(t + 0.08, 0.05, "bandpass", 2400, 4, 0.18, 0.03); }
      else if (kind === "open") { kick(t, 0.7); [N.A2, N.E3, N.A3, N.C4, N.E4].forEach((f, k) => tone(t + k * 0.05, f, "sawtooth", 0.05, 0.02, 0.8, 0.4, 0.6, 0.6, 1800)); noise(t, 2, "highpass", 5000, 0.4, 0.08, 1.6); }
      else if (kind === "treasure") { for (let k = 0; k < 9; k++) tone(t + k * 0.06 + Math.random() * 0.03, 1300 + Math.random() * 1500, "sine", 0.13, 0.002, 0.2, 0.0001, 0.05); }
      else if (kind === "walk") { for (let k = 0; k < 6; k++) noise(t + k * 0.22, 0.08, "lowpass", 600, 0.7, 0.18, 0.06); }
      else if (kind === "start") { const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter(); o.type = "sawtooth"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.6); f.type = "lowpass"; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.6); env(g, t, 0.05, 0.08, 0.5, 0.0001, 0.1); o.connect(f); f.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.8); }
    },
    state() { return { enabled, volume, mode, running: !!timer, ctx: ac ? ac.state : "none" }; },
  };
  root.Music = M;
})(typeof window !== "undefined" ? window : globalThis);
