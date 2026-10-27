"""Сборка игры из src/ одним Python (Node.js не нужен).

Что получается:
  build/index.html      страница для публикации артефактом в Claude (связь через комнату Claude)
  build/test.html       та же страница в полном HTML-скелете — для тестов с имитацией комнаты
  build/lan.html        страница для игры по локальной сети (связь через bazis_server.py)
  dist/bazis_server.py  сервер для ноутбука со встроенной build/lan.html — этот файл и запускают для игры

Запуск:  python tools/build.py
"""
import base64
import datetime
import gzip
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
BUILD = os.path.join(ROOT, "build")
DIST = os.path.join(ROOT, "dist")

# порядок важен: app.js использует всё, что объявлено выше
PARTS = [("CORE", "core.js"), ("WIDGETS", "widgets.js"), ("RENDER", "render.js"), ("MUSIC", "music.js"),
         ("QR", "qr.js"), ("NET", "net.js"), ("APP", "app.js")]

# скелет, который добавляет публикация артефакта; для тестов повторяем его
SKELETON = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
# для локальной сети: свой скелет и флажок BAZIS_LAN, по которому app.js выбирает связь через сервер
LAN_SKELETON = ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                '<meta name="theme-color" content="#0d2540"><link rel="icon" href="data:,">'
                '<script>window.BAZIS_LAN=1</script>'
                '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
# символы, которые ломают встроенные скрипты или невидимы в редакторе
INVISIBLE = {0x2028: "LINE SEPARATOR", 0x2029: "PARAGRAPH SEPARATOR", 0xAD: "SOFT HYPHEN", 0x200B: "ZERO WIDTH SPACE", 0xFEFF: "BOM"}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def fail(msg):
    print("ОШИБКА СБОРКИ: " + msg)
    sys.exit(1)


def assemble():
    page = read(os.path.join(SRC, "page.html"))
    for key, name in PARTS:
        js = read(os.path.join(SRC, name))
        if re.search(r"</script", js, re.I):
            fail("в %s встречается </script — браузер оборвёт скрипт на этом месте" % name)
        mark = "/*@%s@*/" % key
        if page.count(mark) != 1:
            fail("в src/page.html нет места для %s (%s)" % (name, mark))
        page = page.replace(mark, js)
    for ch, title in INVISIBLE.items():
        if chr(ch) in page:
            fail("невидимый символ %s (U+%04X) в исходниках" % (title, ch))
    return page


def lan_page(page):
    # шрифты из интернета грузим без ожидания: в сети без выхода наружу страница не должна висеть
    m = re.search(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com/[^"]+)">', page)
    if m:
        page = page.replace(m.group(0), '<link rel="stylesheet" href="%s" media="print" onload="this.media=\'all\'">' % m.group(1))
    return LAN_SKELETON + page + "</body></html>"


def server_file(lan_html):
    tpl = read(os.path.join(ROOT, "server", "server_tpl.py"))
    if tpl.count("__GAME_B64__") != 1 or tpl.count("__VERSION__") != 1:
        fail("в server/server_tpl.py должно быть ровно по одному __GAME_B64__ и __VERSION__")
    gz = gzip.compress(lan_html.encode("utf-8"), compresslevel=9, mtime=0)
    b64 = base64.b64encode(gz).decode("ascii")
    lines = "\n".join(b64[i:i + 100] for i in range(0, len(b64), 100))
    return tpl.replace("__GAME_B64__", lines).replace("__VERSION__", datetime.date.today().isoformat()), len(gz)


def main():
    page = assemble()
    write(os.path.join(BUILD, "index.html"), page)
    write(os.path.join(BUILD, "test.html"), SKELETON + page + "</body></html>")
    lan = lan_page(page)
    write(os.path.join(BUILD, "lan.html"), lan)
    server, gz_len = server_file(lan)
    out = os.path.join(DIST, "bazis_server.py")
    write(out, server)
    compile(server, out, "exec")  # сервер хотя бы разбирается Python'ом
    kb = lambda n: "%.0f КБ" % (n / 1024)
    print("build/index.html  %s  (артефакт Claude)" % kb(len(page.encode("utf-8"))))
    print("build/lan.html    %s  (локальная сеть, в архиве %s)" % (kb(len(lan.encode("utf-8"))), kb(gz_len)))
    print("dist/bazis_server.py  %s  — готов к запуску: python dist/bazis_server.py" % kb(os.path.getsize(out)))


if __name__ == "__main__":
    main()
