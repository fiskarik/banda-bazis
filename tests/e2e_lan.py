"""Прогон версии для локальной сети через настоящий bazis_server.py, без имитаций.
Большой экран открыт на localhost, телефоны — по сетевому адресу из QR-кода (каждый в своём браузерном профиле).
По ходу: обрыв связи у телефона, перезапуск сервера посреди дела, перезагрузка страницы телефона.
Запуск: python tests/e2e_lan.py [папка для скриншотов] [usadba,bazis]"""
import json, os, subprocess, sys, time
import numpy as np, cv2
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import TESTS, shots_dir, game_server_cmd, server_info, launch, is_noise

SHOTS = shots_dir("e2e_lan")
CASES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["usadba", "bazis"]
PORT = 8766
SRV_CMD = game_server_cmd(PORT)
LAN_IP = None  # адрес ноутбука в сети; без сети телефоны ходят на 127.0.0.1, а проверки QR пропускаются
srv = None
errors = []
checks = []


def start_server():
    global srv
    srv = subprocess.Popen(SRV_CMD, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(0.9)


def stop_server():
    srv.terminate()
    return srv.communicate(timeout=5)[0].decode("utf-8", "replace")


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what, flush=True)
    checks.append((bool(cond), what))


SET_SOLUTION = open(os.path.join(TESTS, "e2e_live.py"), encoding="utf-8").read().split('SET_SOLUTION = """', 1)[1].split('"""', 1)[0]


def watch(page, name):
    page.on("console", lambda m: errors.append(f"{name}: {m.text}") if m.type == "error" and not is_noise(m) else None)
    page.on("pageerror", lambda e: errors.append(f"{name}: pageerror {e}"))


def wait_host(host, cond, timeout=20000, what=""):
    try:
        host.wait_for_function(f"(() => {{ const H = BazisDebug.H; return !!H && ({cond}); }})()", timeout=timeout)
    except PWTimeout:
        print("TIMEOUT host", what or cond, host.evaluate("JSON.stringify({ph: BazisDebug.H && BazisDebug.H.phase, lv: BazisDebug.H && BazisDebug.H.lv, n: BazisDebug.H && BazisDebug.H.n})"))
        raise


def wait_phone(ph, cond, timeout=15000, what=""):
    try:
        ph.wait_for_function(f"(() => {{ const P = BazisDebug.P; return !!(P && P.hs) && ({cond}); }})()", timeout=timeout)
    except PWTimeout:
        print("TIMEOUT phone", what or cond, ph.evaluate("JSON.stringify(BazisDebug.P ? {step: BazisDebug.P.step, net: BazisDebug.P.netDown, hs: BazisDebug.P.hs && {ph: BazisDebug.P.hs.ph, lv: BazisDebug.P.hs.lv}} : null)"))
        raise


def act(ph, rid, t, d=None):
    sel = f'#role-{rid} [data-op=act][data-act="{t}"]' + (f'[data-v="{d}"]' if d and t in ("play", "burn") else "")
    loc = ph.locator(sel)
    if loc.count():
        loc.first.click(timeout=8000)
    else:
        print("no button for", rid, t, d)
        ph.evaluate("([r, t, d]) => window.BazisDebug.act(r, t, d)", [rid, t, d])


def read_qr(host):
    png = host.locator(".lan-qr").screenshot()
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    txt, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return txt


def solve_level(phones, lv, tag, shots, host):
    infos = [ph.evaluate(SET_SOLUTION) for ph in phones]
    kind = infos[0]["kind"]
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
        for L in traps:
            ph, rid = holder[L]; act(ph, rid, "burn", L); time.sleep(0.2)
        time.sleep(0.4)
        act(by_role["k1"], "k1", "key"); time.sleep(0.12); act(by_role["k2"], "k2", "key")
    return kind


def run_case(pw, br, cs, nicks, tag, disrupt):
    shots = []
    hctx = br.new_context(color_scheme="dark", viewport={"width": 1600, "height": 900})
    host = hctx.new_page(); watch(host, f"{tag}-host")
    host.goto(f"http://localhost:{PORT}/")
    host.wait_for_selector("[data-act=go-host]")
    check("Wi‑Fi ноутбука" in host.inner_text(".howto"), f"{tag}: на заставке инструкция для локальной сети")
    host.click(f'[data-act=go-host][data-cs={cs}]')
    host.wait_for_selector(".bigcode")
    code = host.inner_text(".bigcode").strip()
    wait_host(host, "true")
    host.wait_for_function("document.querySelector('#hud-conn') && document.querySelector('#hud-conn').textContent === 'пульты на связи'", timeout=8000)
    if LAN_IP:
        host.wait_for_selector(".lan-qr svg", timeout=8000)
        url = read_qr(host)
        check(url == f"http://{LAN_IP}:{PORT}/#j={code}", f"{tag}: QR из лобби читается камерой: {url}")
        check(host.inner_text(".lan-url").strip() == f"http://{LAN_IP}:{PORT}", f"{tag}: адрес для телефонов под QR")
        check(f"{LAN_IP}:{PORT}" in host.inner_text(".h-code"), f"{tag}: адрес в шапке большого экрана")
    else:
        print(f"{tag}: у компьютера нет сети — QR не проверяем, телефоны идут на 127.0.0.1", flush=True)
        url = f"http://127.0.0.1:{PORT}/#j={code}"
    shots.append((f"{tag}-host-lobby-empty", host.screenshot()))
    phones, pctxs = [], []
    for k, nick in enumerate(nicks):
        pctx = br.new_context(color_scheme="dark", viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        if k % 2 == 1:  # у этих кличка уже сохранена с прошлой игры — по QR садятся сразу
            pctx.add_init_script(f"try {{ if (!localStorage.getItem('bazis.phone')) localStorage.setItem('bazis.phone', JSON.stringify({{nick: {json.dumps(nick)}, code: ''}})); }} catch (e) {{}}")
        ph = pctx.new_page(); watch(ph, f"{tag}-{nick}")
        ph.goto(url)
        if k % 2 == 0:
            ph.wait_for_selector("#j-nick")
            check(ph.input_value("#j-code") == code, f"{tag}: {nick}: код из QR уже в форме")
            if k == 0:
                shots.append((f"{tag}-phone-join-qr", ph.screenshot(full_page=True)))
            ph.fill("#j-nick", nick); ph.click("button[type=submit]")
        wait_phone(ph, "P.hs.ph === 'lobby' && P.hs.seats[P.pid] !== undefined", what="joined")
        phones.append(ph); pctxs.append(pctx)
    if LAN_IP:
        check(phones[0].evaluate("window.isSecureContext") is False, f"{tag}: телефон открыт по http в сети (без Wake Lock)")
        check(all(ph.evaluate("!!(window.KeepAwake && window.KeepAwake.playing)") for ph in phones), f"{tag}: запасное «не засыпать» запущено на всех телефонах")
    wait_host(host, f"H.n === {len(nicks)}", what="all seated")
    shots.append((f"{tag}-host-lobby", host.screenshot()))
    host.click("[data-act=start]")
    N = host.evaluate(f"BazisCore.stageCount('{cs}', BazisDebug.H.old)")
    kinds = []
    for lv in range(N):
        wait_host(host, f"H.phase === 'intro' && H.lv === {lv}", what=f"intro {lv}")
        if disrupt and lv == 2:
            # сервер падает посреди дела и запускается снова: все переподключаются сами
            log1 = stop_server()
            time.sleep(1.5)
            host.wait_for_function("document.querySelector('#hud-conn').textContent === 'переподключаем…'", timeout=6000)
            phones[0].wait_for_function("BazisDebug.P.netDown === true", timeout=6000)
            shots.append((f"{tag}-phone-netdown", phones[0].screenshot(full_page=True)))
            check(True, f"{tag}: сервер остановлен — экран и телефоны видят обрыв")
            start_server()
            host.wait_for_function("document.querySelector('#hud-conn').textContent === 'пульты на связи'", timeout=10000)
            for ph in phones:
                wait_phone(ph, f"!P.netDown && !P.hostGone && P.hs.lv === {lv}", timeout=12000, what="back after restart")
            wait_host(host, f"Object.keys(H.seats).every(pid => !H.lost[pid]) && H.n === {len(nicks)}", what="crew back")
            check(True, f"{tag}: после перезапуска сервера все вернулись на свои места")
        if disrupt and lv == 3:
            # телефон перезагрузил страницу: тот же id вкладки, код из адреса, кличка сохранена — садится сам
            seat_before = phones[2].evaluate("BazisDebug.P.hs.seats[BazisDebug.P.pid]")
            phones[2].reload()
            wait_phone(phones[2], f"P.hs.lv === {lv} && P.hs.seats[P.pid] === {seat_before}", timeout=12000, what="reload rejoin")
            check(True, f"{tag}: перезагруженный телефон сам сел на своё место {seat_before}")
        for ph in phones:
            wait_phone(ph, f"P.hs.lv === {lv} && P.hs.ph === 'intro'", what=f"phone intro {lv}")
        host.click("[data-act=go]")
        wait_host(host, "H.phase === 'play'", what="play")
        for ph in phones:
            wait_phone(ph, "P.hs.ph === 'play'", what="phone play")
        time.sleep(0.4)
        if disrupt and lv == 1:
            # у телефона моргнул Wi‑Fi: соединение рвётся и восстанавливается, пульт остаётся у него
            phones[1].evaluate("LanRoom.create()._drop()")
            phones[1].wait_for_function("BazisDebug.P.netDown === false && BazisDebug.P.hs && !BazisDebug.P.hostGone", timeout=8000)
            wait_host(host, f"H.n === {len(nicks)} && Object.keys(H.lost).length === 0", what="phone back")
            check(True, f"{tag}: телефон после обрыва вернулся за 1–2 с, пульты не отобрали")
        kinds.append(solve_level(phones, lv, tag, shots, host))
        wait_host(host, "H.phase === 'win' || H.phase === 'debrief'", timeout=25000, what=f"win {lv}")
        if lv == 0:
            shots.append((f"{tag}-L0-host-win", host.screenshot()))
        wait_host(host, "H.phase === 'debrief'", what="debrief")
        host.click("[data-act=next]")
    wait_host(host, "H.phase === 'exam'", what="exam")
    for k, ph in enumerate(phones):
        wait_phone(ph, "P.hs.ph === 'exam'", what="phone exam")
        pid = ph.evaluate("BazisDebug.P.pid")
        qs = ph.evaluate(f"BazisCore.getExam('{cs}', BazisDebug.P.code, BazisDebug.P.hs.rd, '{pid}').map(q => q.answer)")
        for qi, ans in enumerate(qs):
            for i, v in enumerate(list(ans)):
                ph.click(f'[data-x=fld][data-i="{i}"]')
                for d in str(abs(v)):
                    ph.click(f'[data-x=key][data-k="{d}"]')
                if v < 0:
                    ph.click('[data-x=key][data-k=neg]')
            ph.click("[data-x=submit]")
            ph.wait_for_selector("text=Верно")
            ph.click("[data-x=exnext]")
        ph.wait_for_selector("text=Допрос окончен")
    wait_host(host, f"Object.values(H.exam.scores).reduce((s, r) => s + r.s, 0) === {3 * len(phones)}", what="exam scores")
    host.click("[data-act=finish]")
    wait_host(host, "H.phase === 'end'", what="end")
    shots.append((f"{tag}-host-end", host.screenshot()))
    F = host.evaluate("BazisDebug.H.final")
    phones[0].wait_for_selector("text=слитков из")
    for c in pctxs:
        c.close()
    hctx.close()
    return shots, kinds, F


start_server()
LAN_IP = (server_info(PORT).get("ips") or [None])[0]
log_all = ""
try:
    with sync_playwright() as pw:
        br = launch(pw, lan_ip=LAN_IP)
        all_shots = []
        if "usadba" in CASES:
            s, kinds, F = run_case(pw, br, "usadba", ["Лиса", "Медведь", "Сова"], "A", True)
            all_shots += s
            print("usadba:", kinds, "final:", json.dumps(F, ensure_ascii=False))
        if "bazis" in CASES:
            s, kinds, F = run_case(pw, br, "bazis", ["Лиса", "Медведь", "Сова", "Ёж"], "B", False)
            all_shots += s
            print("bazis:", kinds, "final:", json.dumps(F, ensure_ascii=False))
        for n, png in all_shots:
            open(os.path.join(SHOTS, n + ".png"), "wb").write(png)
        br.close()
finally:
    log_all = stop_server()
print("--- журнал сервера (хвост) ---")
print("\n".join(log_all.splitlines()[-12:]))
print("console errors:", json.dumps(errors[:30], ensure_ascii=False, indent=0) if errors else "none", f"({len(errors)} total)")
bad = [w for ok, w in checks if not ok]
print("FAILS:", bad if bad else "none")
sys.exit(1 if bad or errors else 0)
