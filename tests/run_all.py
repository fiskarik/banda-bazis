"""Все проверки по порядку, с итогом в конце.

  python tests/run_all.py --quick   сборка, ядро, протокол сервера, лобби в локальной сети (~2 мин)
  python tests/run_all.py           всё, включая оба дела целиком в обоих режимах (~6–8 мин)

Для браузерных проверок один раз:  pip install playwright opencv-python-headless numpy
                                   python -m playwright install chromium
Проверка ядра запускается, если установлен Node.js. Скриншоты — в shots/.
"""
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
QUICK = "--quick" in sys.argv
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def have(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


results = []


def run(title, cmd, timeout=300):
    t0 = time.time()
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    try:
        r = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, env=env)
        out, ok = r.stdout.decode("utf-8", "replace"), r.returncode == 0
    except subprocess.TimeoutExpired as e:
        out, ok = (e.stdout or b"").decode("utf-8", "replace") + "\n(превышено время %d с)" % timeout, False
    print("%s  %s  (%.0f с)" % ("ok  " if ok else "FAIL", title, time.time() - t0), flush=True)
    if not ok:
        print("    " + "\n    ".join(out.strip().splitlines()[-40:]), flush=True)
    results.append((ok, title))
    return ok


def skip(title, why):
    print("--   %s — пропущено: %s" % (title, why), flush=True)


if not run("сборка (tools/build.py)", [PY, "tools/build.py"], 120):
    sys.exit(1)
if shutil.which("node"):
    run("ядро: все уровни решаемы, тексты целые (tests/test_core.js)", ["node", "tests/test_core.js"], 300)
else:
    skip("ядро (tests/test_core.js)", "нет Node.js")
run("сервер: протокол, обрывы, медленные телефоны (tests/test_server.py)", [PY, "tests/test_server.py"], 180)

if not have("playwright"):
    skip("браузерные проверки", "нет Playwright: pip install playwright && python -m playwright install chromium")
else:
    lan_ok = have("cv2") and have("numpy")
    if lan_ok:
        run("локальная сеть: лобби, QR, адреса, обрыв сервера (tests/e2e_lan_ui.py)", [PY, "tests/e2e_lan_ui.py"], 300)
    else:
        skip("локальная сеть", "нет opencv/numpy: pip install opencv-python-headless numpy")
    if not QUICK:
        if lan_ok:
            run("локальная сеть: оба дела через настоящий сервер (tests/e2e_lan.py)", [PY, "tests/e2e_lan.py"], 900)
        run("артефакт: охрана, сирена, подсказки, один экран (tests/e2e_guard.py)", [PY, "tests/e2e_guard.py"], 600)
        run("артефакт: оба дела и допрос с имитацией комнаты (tests/e2e_live.py)", [PY, "tests/e2e_live.py"], 900)
        run("музыка: громкость по режимам (tests/e2e_music.py)", [PY, "tests/e2e_music.py"], 300)

bad = [t for ok, t in results if not ok]
print()
print("ИТОГ: " + ("всё прошло" if not bad else "не прошло: " + "; ".join(bad)))
sys.exit(1 if bad else 0)
