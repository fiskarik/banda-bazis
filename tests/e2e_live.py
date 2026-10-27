"""Прогон живой версии: большой экран + несколько телефонов на имитации room.
Телефоны выставляют решение своими пультами и жмут свои действия; большой экран засчитывает уровни.
Проходит дело целиком, допрос и финал. Снимает скриншоты сцены и пультов на каждом уровне."""
import json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import MOCK, shots_dir, static_server, launch, is_noise

SHOTS = shots_dir("e2e_live")
CASES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["usadba", "bazis"]
srv = static_server(8765)
URL = "http://127.0.0.1:8765/test.html"
errors = []

SET_SOLUTION = """(() => {
  const D = window.BazisDebug, P = D.P, hs = P && P.hs, C = window.BazisCore;
  if (!hs) return { err: "no hs" };
  const L = C.getLevel(hs.cs, P.code, hs.rd, hs.lv, hs.old, hs.vr);
  const seat = hs.seats[P.pid];
  const roles = L.roles(hs.nL).filter(r => hs.asg[r.id] === seat);
  const sol = L.solution(L.initAux(hs.nL));
  const set = [];
  roles.forEach(r => { if (sol[r.id]) { D.setValue(r.id, sol[r.id]); set.push(r.id); } });
  const hand = L.kind === "proof" ? L.hand(seat, hs.nL) : [];
  return { kind: L.kind, seat, roles: roles.map(r => r.id), set, ph: hs.ph, lv: hs.lv, hand,
           canon: L.canon || [], traps: L.byLetter ? Object.keys(L.byLetter).filter(k => L.byLetter[k].trap !== undefined) : [],
           checks: roles.filter(r => r.task).map(r => r.id) };
})()"""


def watch(page, name):
    page.on("console", lambda m: errors.append(f"{name}: {m.text}") if m.type == "error" and not is_noise(m) else None)
    page.on("pageerror", lambda e: errors.append(f"{name}: pageerror {e}"))


def host_state(host):
    return host.evaluate("""(() => { const H = BazisDebug.H; if (!H) return null;
      return { ph: H.phase, lv: H.lv, alarm: H.alarm, n: H.n, nL: H.nL, goals: H.lastRes ? H.lastRes.goals.map(g => [g.id, !!g.ok, !!(H.aux && H.aux.latched && H.aux.latched[g.id])]) : [],
               log: (H.log || []).map(x => x.m).slice(0, 4), guard: H.guard && H.guard.state }; })()""")


def wait_host(host, cond, timeout=20000, what=""):
    try:
        host.wait_for_function(f"(() => {{ const H = BazisDebug.H; return !!H && ({cond}); }})()", timeout=timeout)
    except PWTimeout:
        print("TIMEOUT waiting for", what or cond, json.dumps(host_state(host), ensure_ascii=False))
        raise


def wait_phone(ph, cond, timeout=15000, what=""):
    try:
        ph.wait_for_function(f"(() => {{ const P = BazisDebug.P; return !!(P && P.hs) && ({cond}); }})()", timeout=timeout)
    except PWTimeout:
        print("TIMEOUT phone", what or cond, ph.evaluate("JSON.stringify(BazisDebug.P && BazisDebug.P.hs ? {ph: BazisDebug.P.hs.ph, lv: BazisDebug.P.hs.lv} : null)"))
        raise


def act(ph, rid, t, d=None):
    """Жмём настоящую кнопку на пульте телефона; если такой нет — шлём действие напрямую."""
    sel = f'#role-{rid} [data-op=act][data-act="{t}"]' + (f'[data-v="{d}"]' if d and t in ("play", "burn") else "")
    loc = ph.locator(sel)
    if loc.count():
        loc.first.click(timeout=8000)
    else:
        print("no button for", rid, t, d)
        ph.evaluate("([r, t, d]) => window.BazisDebug.act(r, t, d)", [rid, t, d])


def run_case(br, cs, nicks, tag):
    shots = []
    ctx = br.new_context(color_scheme="dark")
    ctx.add_init_script(MOCK)
    host = ctx.new_page(); host.set_viewport_size({"width": 1600, "height": 900}); watch(host, f"{tag}-host")
    host.goto(URL)
    host.wait_for_selector("[data-act=go-host]")
    if tag == "A":
        shots.append(("landing", host.screenshot(full_page=True)))
    host.click(f'[data-act=go-host][data-cs={cs}]')
    host.wait_for_selector(".bigcode")
    code = host.inner_text(".bigcode").strip()
    phones = []
    for nick in nicks:
        ph = ctx.new_page(); ph.set_viewport_size({"width": 390, "height": 844}); watch(ph, f"{tag}-{nick}")
        ph.goto(URL); ph.click("[data-act=go-phone]")
        ph.fill("#j-code", code); ph.fill("#j-nick", nick); ph.click("button[type=submit]")
        wait_phone(ph, "P.hs.ph === 'lobby' && P.hs.seats[P.pid] !== undefined", what="joined")
        phones.append(ph)
    wait_host(host, f"H.n === {len(nicks)}", what="all seated")
    shots.append((f"{tag}-host-lobby", host.screenshot()))
    host.click("[data-act=start]")
    N = host.evaluate(f"BazisCore.stageCount('{cs}', BazisDebug.H.old)")
    kinds = []
    for lv in range(N):
        wait_host(host, f"H.phase === 'intro' && H.lv === {lv}", what=f"intro {lv}")
        for ph in phones:
            wait_phone(ph, f"P.hs.lv === {lv} && P.hs.ph === 'intro'", what=f"phone intro {lv}")
        host.click("[data-act=go]")
        wait_host(host, "H.phase === 'play'", what="play")
        for ph in phones:
            wait_phone(ph, "P.hs.ph === 'play'", what="phone play")
        time.sleep(0.5)
        shots.append((f"{tag}-L{lv}-host-start", host.screenshot()))
        for k, ph in enumerate(phones):
            shots.append((f"{tag}-L{lv}-ctl-{k}", ph.screenshot(full_page=True)))
        infos = [ph.evaluate(SET_SOLUTION) for ph in phones]
        kind = infos[0]["kind"]
        kinds.append(kind)
        time.sleep(0.4)
        by_role = {}
        for ph, inf in zip(phones, infos):
            for r in inf["roles"]:
                by_role[r] = ph
        if any(inf["checks"] for inf in infos):
            # задачи «каждому своя»: ответ выставлен, жмём «Проверить» на каждом телефоне
            time.sleep(0.3)
            for ph, inf in zip(phones, infos):
                for rid in inf["checks"]:
                    act(ph, rid, "check"); time.sleep(0.15)
        elif kind == "proof":
            canon, traps = infos[0]["canon"], infos[0]["traps"]
            holder = {}
            for ph, inf in zip(phones, infos):
                for L in inf["hand"]:
                    holder[L] = (ph, "h" + str(inf["seat"]))
            for L in canon:
                ph, rid = holder[L]; act(ph, rid, "play", L); time.sleep(0.25)
            shots.append((f"{tag}-L{lv}-host-proof", host.screenshot()))
            for L in traps:
                ph, rid = holder[L]; act(ph, rid, "burn", L); time.sleep(0.2)
            time.sleep(0.4)
            act(by_role["k1"], "k1", "key"); time.sleep(0.12); act(by_role["k2"], "k2", "key")
        # первый телефон с пультом — для скриншота
        time.sleep(0.25)
        shots.append((f"{tag}-L{lv}-phone-{kind}", phones[lv % len(phones)].screenshot(full_page=True)))
        wait_host(host, "H.phase === 'win' || H.phase === 'debrief'", timeout=25000, what=f"win {lv} ({kind})")
        shots.append((f"{tag}-L{lv}-host-win", host.screenshot()))
        wait_host(host, "H.phase === 'debrief'", what="debrief")
        host.click("[data-act=next]")
    # допрос
    wait_host(host, "H.phase === 'exam'", what="exam")
    for k, ph in enumerate(phones):
        wait_phone(ph, "P.hs.ph === 'exam'", what="phone exam")
        pid = ph.evaluate("BazisDebug.P.pid")
        qs = ph.evaluate(f"BazisCore.getExam('{cs}', BazisDebug.P.code, BazisDebug.P.hs.rd, '{pid}').map(q => q.answer)")
        for qi, ans in enumerate(qs):
            vals = list(ans)
            if k == 1 and qi == 0:
                vals[0] += 1
            for i, v in enumerate(vals):
                ph.click(f'[data-x=fld][data-i="{i}"]')
                for d in str(abs(v)):
                    ph.click(f'[data-x=key][data-k="{d}"]')
                if v < 0:
                    ph.click('[data-x=key][data-k=neg]')
            if k == 0 and qi == 0:
                shots.append((f"{tag}-phone-exam", ph.screenshot(full_page=True)))
            ph.click("[data-x=submit]")
            ph.wait_for_selector("text=Верно" if not (k == 1 and qi == 0) else "text=Неверно")
            ph.click("[data-x=exnext]")
        ph.wait_for_selector("text=Допрос окончен")
    total = 3 * len(phones)
    wait_host(host, f"Object.values(H.exam.scores).reduce((s, r) => s + r.s, 0) === {total - 1}", what="exam scores")
    shots.append((f"{tag}-host-exam", host.screenshot()))
    host.click("[data-act=finish]")
    wait_host(host, "H.phase === 'end'", what="end")
    shots.append((f"{tag}-host-end", host.screenshot()))
    F = host.evaluate("BazisDebug.H.final")
    pres = max(p.evaluate("window.__mockPresenceBytes || 0") for p in [host] + phones)
    phones[0].wait_for_selector("text=слитков из")
    ctx.close()
    return shots, kinds, F, pres


try:
    with sync_playwright() as pw:
        br = launch(pw)
        all_shots = []
        if "usadba" in CASES:
            s, kinds, F, pres = run_case(br, "usadba", ["Лиса", "Медведь", "Сова"], "A")
            all_shots += s
            print("usadba:", kinds, "final:", json.dumps(F, ensure_ascii=False), "max presence bytes:", pres)
        if "bazis" in CASES:
            s, kinds, F, pres = run_case(br, "bazis", ["Лиса", "Медведь", "Сова", "Ёж"], "B")
            all_shots += s
            print("bazis:", kinds, "final:", json.dumps(F, ensure_ascii=False), "max presence bytes:", pres)
        for n, png in all_shots:
            open(os.path.join(SHOTS, n + ".png"), "wb").write(png)
        print("shots:", len(all_shots))
        br.close()
finally:
    srv.terminate()

print("console errors:", json.dumps(errors[:30], ensure_ascii=False, indent=0) if errors else "none", f"({len(errors)} total)")
sys.exit(1 if errors else 0)
