"""Общее для тестов: пути, запуск серверов, браузер для Playwright, вывод в UTF-8."""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "tests")
BUILD = os.path.join(ROOT, "build")
SERVER = os.path.join(ROOT, "dist", "bazis_server.py")
with open(os.path.join(TESTS, "mockroom.js"), encoding="utf-8") as _f:
    MOCK = _f.read()  # имитация комнаты Claude для тестов версии-артефакта

# Windows: вывод в канал (например, в Claude Code) иначе идёт в cp1251 и падает на «→», «−» и т. п.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def shots_dir(name):
    """Папка для скриншотов: первый аргумент командной строки или shots/<name>."""
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "shots", name)
    os.makedirs(d, exist_ok=True)
    return d


def need_build():
    if not os.path.exists(os.path.join(BUILD, "test.html")) or not os.path.exists(SERVER):
        sys.exit("Сначала соберите игру: python tools/build.py")


def static_server(port=8765):
    """Отдаёт build/ на http://127.0.0.1:<port>/ — для тестов версии-артефакта с имитацией комнаты."""
    need_build()
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=BUILD,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    return p


def game_server_cmd(port):
    """Команда запуска dist/bazis_server.py; другой Python можно задать через SRV_PY."""
    need_build()
    return [os.environ.get("SRV_PY", sys.executable), SERVER, "--port", str(port), "--no-browser"]


def server_info(port, tries=25):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(tries):
        try:
            with opener.open("http://127.0.0.1:%d/info" % port, timeout=1) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("сервер игры не отвечает на порту %d" % port)


def launch(pw, lan_ip=None, **kw):
    """Chromium для тестов. Если компьютер ходит в интернет через прокси (как облачная песочница),
    задайте BAZIS_TEST_PROXY=http://host:port — localhost и адрес ноутбука в сети пойдут мимо него."""
    proxy = os.environ.get("BAZIS_TEST_PROXY")
    if proxy:
        bypass = ["localhost", "127.0.0.1"] + ([lan_ip] if lan_ip else [])
        kw["proxy"] = {"server": proxy, "bypass": ",".join(bypass)}
    return pw.chromium.launch(**kw)


def is_noise(m):
    """Ошибки консоли, которые не про игру: шрифты без интернета, сеть во время проверок обрыва."""
    text = m.text or ""
    try:
        url = (m.location or {}).get("url", "")
    except Exception:
        url = ""
    if "fonts.g" in text or "fonts.g" in url:
        return True
    if "Failed to load resource: net::ERR_" in text:  # шрифты без интернета, сервер перезапускается
        return True
    return "WebSocket connection to" in text  # переподключение во время проверок обрыва
