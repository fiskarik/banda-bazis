"""Мелочи лобби в локальной сети: несколько адресов ноутбука, нет сети, сервер упал в лобби, ручной вход телефона."""
import json, os, subprocess, sys, time
import numpy as np, cv2
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import shots_dir, game_server_cmd, server_info, launch, is_noise

SHOTS = shots_dir("e2e_lan_ui")
PORT = 8769
CMD = game_server_cmd(PORT)
checks, errors = [], []


def check(c, w):
    print(("ok   " if c else "FAIL ") + w, flush=True)
    checks.append((bool(c), w))


def qr_text(page):
    png = page.locator(".lan-qr").screenshot()
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    return cv2.QRCodeDetector().detectAndDecode(img)[0]


srv = subprocess.Popen(CMD, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.9)
LAN_IP = (server_info(PORT).get("ips") or [None])[0]
PHONE = LAN_IP or "127.0.0.1"  # телефоны — по адресу ноутбука в сети, а без сети хотя бы так
info = {"app": "bazis", "ver": "t", "port": 8000, "ips": ["192.168.137.1", "10.0.0.5", "192.168.56.1"]}
try:
    with sync_playwright() as pw:
        br = launch(pw, lan_ip=LAN_IP)
        ctx = br.new_context(viewport={"width": 1280, "height": 720}, color_scheme="dark")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not is_noise(m) else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/info", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(info)))
        page.goto(f"http://localhost:{PORT}/")
        open(os.path.join(SHOTS, "lan-landing.png"), "wb").write(page.screenshot(full_page=True))
        page.click("[data-act=go-host][data-cs=bazis]")
        page.wait_for_selector(".lan-qr svg")
        code = page.inner_text(".bigcode").strip()
        check(page.evaluate("window.scrollY") == 0, "лобби открывается с начала страницы")
        check(page.inner_text(".lan-url").strip() == "http://192.168.137.1:8000", "первым показан адрес хот-спота Windows")
        check(qr_text(page) == f"http://192.168.137.1:8000/#j={code}", "QR ведёт на адрес хот-спота с кодом")
        btns = page.locator("[data-act=lan-ip]").all_inner_texts()
        check(btns == ["10.0.0.5", "192.168.56.1"], f"другие адреса — кнопками: {btns}")
        open(os.path.join(SHOTS, "lan-lobby-1280.png"), "wb").write(page.screenshot())
        page.click("[data-act=lan-ip][data-ip='10.0.0.5']")
        check(page.inner_text(".lan-url").strip() == "http://10.0.0.5:8000" and qr_text(page) == f"http://10.0.0.5:8000/#j={code}", "выбранный адрес — в QR и под ним")
        check("10.0.0.5:8000" in page.inner_text(".h-code"), "и в шапке")
        page.click("summary")
        check("брандмауэр" in page.inner_text(".lan-help"), "подсказки «телефон не открывает страницу» раскрываются")
        # сеть пропала совсем
        info["ips"] = []
        page.wait_for_function("!document.querySelector('.lan-qr')", timeout=9000)
        check("Мобильный хот-спот" in page.inner_text(".lan"), "нет сети — подсказка включить хот-спот, QR скрыт")
        info["ips"] = ["192.168.137.1"]
        page.wait_for_selector(".lan-qr svg", timeout=9000)
        check(True, "сеть появилась — QR вернулся сам")
        # сервер закрыли, пока все в лобби
        srv.terminate(); srv.wait(5)
        page.wait_for_selector("text=Нет связи с сервером игры", timeout=8000)
        check(page.inner_text("#hud-conn") == "переподключаем…", "сервер закрыт — лобби предупреждает, индикатор «переподключаем»")
        open(os.path.join(SHOTS, "lan-lobby-noserver.png"), "wb").write(page.screenshot())
        srv = subprocess.Popen(CMD, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page.wait_for_function("!document.body.innerText.includes('Нет связи с сервером игры')", timeout=10000)
        check(page.inner_text("#hud-conn") == "пульты на связи", "сервер снова запущен — предупреждение ушло само")
        # телефон без QR: открыл адрес, нажал «Я с телефона», ввёл код
        pctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme="light")
        ph = pctx.new_page()
        ph.on("pageerror", lambda e: errors.append("phone: " + str(e)))
        ph.goto(f"http://{PHONE}:{PORT}/")
        open(os.path.join(SHOTS, "lan-phone-landing.png"), "wb").write(ph.screenshot())
        ph.click("[data-act=go-phone]")
        ph.fill("#j-code", code); ph.fill("#j-nick", "Барсук"); ph.click("button[type=submit]")
        ph.wait_for_function("BazisDebug.P && BazisDebug.P.hs && BazisDebug.P.hs.seats[BazisDebug.P.pid] !== undefined", timeout=10000)
        page.wait_for_selector("text=Барсук", timeout=8000)
        check(True, "ручной вход по адресу и коду работает")
        open(os.path.join(SHOTS, "lan-phone-lobby-light.png"), "wb").write(ph.screenshot())
        # пришёл по QR без клички и передумал: «В меню» убирает код из адреса
        pctx2 = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        ph2 = pctx2.new_page()
        ph2.goto(f"http://{PHONE}:{PORT}/#j={code}")
        ph2.wait_for_selector("#j-nick")
        ph2.click("[data-act=exit]")
        check(ph2.evaluate("location.hash") == "" and ph2.locator("[data-act=go-phone]").count() == 1, "выход в меню убирает код из адреса")
        ph2.close()
        # неверный код: телефон подсказывает код большого экрана
        ph.close()
        ph = pctx.new_page()
        ph.on("pageerror", lambda e: errors.append("phone: " + str(e)))
        ph.goto(f"http://{PHONE}:{PORT}/")
        ph.click("[data-act=go-phone]")
        ph.fill("#j-code", "0000" if code != "0000" else "1111"); ph.fill("#j-nick", "Барсук"); ph.click("button[type=submit]")
        ph.wait_for_selector("text=Большой экран не найден", timeout=15000)
        txt = ph.inner_text(".ph-box")
        check(code in txt and "Войти с кодом" in txt, "неверный код — телефон предлагает код большого экрана")
        br.close()
finally:
    srv.terminate()
print("errors:", errors or "none")
bad = [w for ok, w in checks if not ok]
print("FAILS:", bad or "none")
sys.exit(1 if bad or errors else 0)
