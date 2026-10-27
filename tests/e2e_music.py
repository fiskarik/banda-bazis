"""Музыка на слух не проверить, зато можно измерить: громкость (RMS) и пики в каждом режиме.
Подключаем анализатор ко всему, что идёт в динамики, и снимаем уровни по 2,5 секунды на режим."""
import json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import static_server, launch, is_noise

srv = static_server(8765)
URL = "http://127.0.0.1:8765/test.html"
TAP = """
(() => {
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const ctx = dest.context;
      if (!ctx.__an) { ctx.__an = ctx.createAnalyser(); ctx.__an.fftSize = 2048; window.__an = ctx.__an; }
      orig.call(this, ctx.__an);
    }
    return orig.call(this, dest, ...rest);
  };
  window.__measure = ms => new Promise(res => {
    const an = window.__an; if (!an) return res(null);
    const buf = new Float32Array(an.fftSize); let sum = 0, n = 0, peak = 0;
    const t0 = performance.now();
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) { sum += x * x; n++; peak = Math.max(peak, Math.abs(x)); }
      if (performance.now() - t0 < ms) setTimeout(tick, 20); else res({ rms: Math.sqrt(sum / n), peak });
    };
    tick();
  });
})();
"""
errors = []
try:
    with sync_playwright() as pw:
        br = launch(pw, args=["--autoplay-policy=no-user-gesture-required"])
        ctx = br.new_context()
        ctx.add_init_script(TAP)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and not is_noise(m) else None)
        pg.goto(URL)
        pg.click('[data-act=go-host][data-cs=usadba]')
        pg.wait_for_selector(".bigcode")
        time.sleep(0.5)
        rows = []
        for mode, inten in [("lobby", 0), ("calm", 0), ("play", 0), ("play", 0.5), ("play", 1), ("check", 0.3), ("siren", 1), ("off", 0)]:
            pg.evaluate(f"Music.setMode('{mode}'); Music.setIntensity({inten})")
            time.sleep(0.6)
            m = pg.evaluate("window.__measure(2500)")
            st = pg.evaluate("Music.state()")
            rows.append((mode, inten, m, st["mode"]))
        for s in ["lock", "win", "caught", "open", "spin", "treasure"]:
            pg.evaluate("Music.setMode('off')"); time.sleep(0.3)
            pg.evaluate(f"Music.sting('{s}')")
            m = pg.evaluate("window.__measure(900)")
            rows.append(("sting:" + s, None, m, ""))
        pg.evaluate("Music.setMode('play'); Music.setEnabled(false)"); time.sleep(0.5)
        rows.append(("disabled", None, pg.evaluate("window.__measure(1500)"), ""))
        br.close()
    for r in rows:
        m = r[2] or {}
        print(f"{r[0]:<16} int={r[1]!s:<5} rms={m.get('rms', 0):.4f} peak={m.get('peak', 0):.3f} {r[3]}")
finally:
    srv.terminate()
print("errors:", errors or "none")
# грубые рамки: музыка слышна во всех режимах, тишина — когда выключена; заметно ниже обычного уровня — повод разобраться
fails = []
for name, inten, m, _ in rows:
    rms = (m or {}).get("rms", 0)
    if name in ("off", "disabled"):
        if rms > 0.003:
            fails.append("%s: должно быть тихо, rms=%.4f" % (name, rms))
    elif name.startswith("sting:"):
        if (m or {}).get("peak", 0) < 0.03:
            fails.append("%s: звук не слышен" % name)
    elif rms < 0.01:
        fails.append("%s (%s): музыка почти не слышна, rms=%.4f" % (name, inten, rms))
print("FAILS:", fails or "none")
sys.exit(1 if fails or errors else 0)
