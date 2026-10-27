#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Банда «Базис» — кооперативные ограбления по математике.
Сервер для игры по локальной сети: ноутбук показывает большой экран,
телефоны подключаются к той же Wi-Fi сети (лучше всего — к хот-споту ноутбука)
и открывают игру в браузере по QR-коду из лобби.

Нужен только Python 3.8 или новее, больше ничего ставить не надо.
Запуск: двойной щелчок по файлу, или Run в PyCharm, или в терминале:  py bazis_server.py
Параметры: --port 8000 (свой порт)   --no-browser (не открывать браузер)
Остановить: закрыть окно или нажать Ctrl+C.

Внутри: маленький HTTP-сервер отдаёт страницу игры, а WebSocket на /ws пересылает
состояние между большим экраном и телефонами. Сама игра — в конце файла (сжатая страница).
"""
import argparse
import asyncio
import base64
import gzip
import hashlib
import ipaddress
import json
import os
import queue
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

APP = "bazis"
VERSION = "__VERSION__"
DEFAULT_PORTS = [8000, 8080, 8001, 8002, 8003, 8004, 8005, 8888]
MAX_FRAME = 256 * 1024        # одно сообщение от браузера
MAX_PRESENCE = 64 * 1024      # состояние одного устройства
MAX_CLIENTS = 64
MAX_BUFFER = 1024 * 1024      # столько может скопиться для устройства, которое не успевает принимать
HB_EVERY = 4.0                # «тик» всем раз в 4 с
DEAD_AFTER = 15.0             # молчит дольше — считаем отключившимся
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# ---------------------------------------------------------------------------
# журнал: печатаем из отдельного потока, чтобы игра не замирала,
# даже если окно консоли занято (например, в нём выделили текст)
# ---------------------------------------------------------------------------
_log_q = queue.Queue()


def _log_worker():
    while True:
        line = _log_q.get()
        if line is None:
            return
        try:
            print(line, flush=True)
        except Exception:
            pass


def say(msg=""):
    _log_q.put(msg)


def log(msg):
    _log_q.put(time.strftime("[%H:%M:%S] ") + msg)


def setup_console():
    for s in (sys.stdout, sys.stderr):
        try:
            if s.isatty():
                s.reconfigure(errors="replace")
            else:  # вывод читает программа (PyCharm, Claude Code): им понятнее UTF-8
                s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if os.name != "nt":
        return
    try:
        import ctypes
        k = ctypes.windll.kernel32
        k.SetConsoleTitleW("Банда «Базис» — сервер игры")
        # выключаем «быстрое выделение»: клик в окне консоли иначе ставит программу на паузу
        h = k.GetStdHandle(-10)
        mode = ctypes.c_uint32()
        if k.GetConsoleMode(h, ctypes.byref(mode)):
            k.SetConsoleMode(h, (mode.value | 0x0080) & ~0x0040)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# адреса ноутбука в сети: какие показать телефонам
# ---------------------------------------------------------------------------
def _ips_from_commands():
    found = set()
    if sys.platform.startswith("linux"):
        cmds = [["ip", "-4", "-o", "addr", "show"]]
    elif sys.platform == "darwin":
        cmds = [["ifconfig"]]
    else:
        cmds = []
    for cmd in cmds:
        try:
            out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1.5).stdout.decode("utf-8", "replace")
        except Exception:
            continue
        found.update(re.findall(r"inet (\d{1,3}(?:\.\d{1,3}){3})", out))
    return found


# адаптеры, которые телефонам не видны: виртуальные машины, эмуляторы, VPN
VIRTUAL = re.compile(r"virtualbox|vmware|hyper-v|vethernet|wsl|docker|loopback|vpn|tap-|tunnel|radmin|hamachi|zerotier|tailscale|wireguard|bluetooth", re.I)


def parse_ipconfig(text):
    """Адреса IPv4 из вывода ipconfig вместе с названиями адаптеров (подписи бывают и русские, и английские)."""
    res, name = [], ""
    for line in text.splitlines():
        if line and not line[0].isspace() and line.rstrip().endswith(":"):
            name = line.strip()
            continue
        m = re.search(r"IPv4[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})", line)
        if m:
            res.append((m.group(1), name))
    return res


def _ipconfig():
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        raw = subprocess.run(["ipconfig"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, creationflags=flags).stdout
    except Exception:
        return []
    return parse_ipconfig(raw.decode("latin-1"))  # нужны только цифры и латинские названия — так ничего не ломается


def _route_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))  # пакеты не уходят: так система лишь выбирает основную сеть
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return None


def ip_rank(ip, route, virtual=()):
    if ip == "192.168.137.1":
        return 0  # мобильный хот-спот Windows
    if ip in virtual:
        return 9
    if ip.startswith("172.20.10.") or ip.startswith("192.168.43.") or ip.startswith("192.168.49."):
        return 1  # точка доступа на телефоне (iPhone, Android)
    if ip == route:
        return 2  # сеть, через которую ноутбук ходит в интернет
    if ip.startswith("192.168.56."):
        return 9  # VirtualBox и эмуляторы — телефонам не видно
    if ip.startswith("192.168."):
        return 3
    if ip.startswith("10."):
        return 4
    if ipaddress.IPv4Address(ip) in ipaddress.IPv4Network("172.16.0.0/12"):
        return 6  # чаще всего виртуальные сети (WSL, Hyper-V, Docker)
    return 5


def local_ips():
    ips, virtual = set(), set()
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    route = _route_ip()
    if route:
        ips.add(route)
    if os.name == "nt":
        for ip, name in _ipconfig():
            ips.add(ip)
            if VIRTUAL.search(name):
                virtual.add(ip)
    else:
        ips.update(_ips_from_commands())
    good = []
    for ip in ips:
        try:
            a = ipaddress.IPv4Address(ip)
        except ValueError:
            continue
        if a.is_loopback or a.is_link_local or a.is_unspecified or a.is_multicast:
            continue
        good.append(ip)
    good.sort(key=lambda ip: (ip_rank(ip, route, virtual), tuple(int(x) for x in ip.split("."))))
    return good


_ips_cache = {"at": 0.0, "ips": []}


async def cached_ips():
    if time.monotonic() - _ips_cache["at"] > 2.0:
        loop = asyncio.get_running_loop()
        try:
            _ips_cache["ips"] = await loop.run_in_executor(None, local_ips)
        except Exception:
            pass
        _ips_cache["at"] = time.monotonic()
    return _ips_cache["ips"]


# ---------------------------------------------------------------------------
# связь: у каждого устройства есть «состояние» (presence); сервер хранит его,
# новичку отдаёт состояния всех, изменения рассылает остальным, при отключении сообщает «ушёл»
# ---------------------------------------------------------------------------
class Client:
    def __init__(self, num, writer, ip):
        self.id = "c%d" % num
        self.cid = ""
        self.writer = writer
        self.ip = ip
        self.pres = {}
        self.joined = False
        self.alive = True
        self.last = time.monotonic()
        self.win_at = self.last
        self.win_n = 0
        self.label = ""


clients = {}
_counter = [0]


def ws_frame(op, payload):
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | op, 127, n)
    return head + payload


def unmask(data, mask):
    n = len(data)
    if not n:
        return data
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(m, "big")).to_bytes(n, "big")


def json_frame(obj):
    return ws_frame(1, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def send_raw(c, data):
    if not c.alive:
        return
    try:
        tr = c.writer.transport
        if tr is None or tr.is_closing():
            drop(c)
            return
        if tr.get_write_buffer_size() > MAX_BUFFER:
            drop(c, "не успевает принимать данные")
            return
        c.writer.write(data)
    except Exception:
        drop(c)


def broadcast(obj, exclude=None):
    data = json_frame(obj)
    for o in list(clients.values()):
        if o is not exclude and o.joined:
            send_raw(o, data)


def apply_patch(target, patch):
    for k, v in patch.items():
        if not isinstance(k, str):
            continue
        if v is None:
            target.pop(k, None)
        else:
            target[k] = v


def clean_text(s, n=16):
    if not isinstance(s, str):
        return ""
    s = "".join(ch for ch in s if ch.isprintable())
    return s.strip()[:n]


def describe(c):
    p = c.pres
    if p.get("app") != APP:
        label = ""
    elif p.get("host") is True:
        label = "большой экран (код %s)" % clean_text(str(p.get("code", "")), 8)
    elif p.get("role") == "phone":
        label = "телефон «%s»" % (clean_text(p.get("nick")) or "Игрок")
    else:
        label = ""
    if label and label != c.label:
        log("%s на связи (%s)" % (label, c.ip))
    c.label = label or c.label


def drop(c, why=None):
    if not c.alive:
        return
    c.alive = False
    clients.pop(c.id, None)
    try:
        c.writer.close()
    except Exception:
        pass
    if c.joined:
        broadcast({"t": "bye", "id": c.id})
    if c.label:
        log("%s отключился%s" % (c.label, " — " + why if why else ""))


def on_hello(c, m):
    if c.joined:
        return
    cid = m.get("cid")
    if isinstance(cid, str) and 0 < len(cid) <= 64:
        c.cid = cid
        for o in list(clients.values()):
            if o is not c and o.cid == cid:
                drop(o)  # та же вкладка переподключилась: старое соединение больше не нужно
    c.joined = True
    p = m.get("p")
    if isinstance(p, dict):
        apply_patch(c.pres, p)
        if len(json.dumps(c.pres)) > MAX_PRESENCE:
            c.pres = {}
    peers = {o.id: o.pres for o in clients.values() if o is not c and o.joined and o.pres}
    send_raw(c, json_frame({"t": "welcome", "id": c.id, "peers": peers}))
    if c.pres:
        broadcast({"t": "p", "id": c.id, "d": c.pres}, exclude=c)
    describe(c)


def on_patch(c, d):
    if not isinstance(d, dict) or not d:
        return
    trial = dict(c.pres)
    apply_patch(trial, d)
    if len(json.dumps(trial)) > MAX_PRESENCE:
        return
    c.pres = trial
    broadcast({"t": "p", "id": c.id, "d": d}, exclude=c)
    describe(c)


def on_message(c, data):
    try:
        m = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return
    if not isinstance(m, dict):
        return
    t = m.get("t")
    if t == "hi":
        on_hello(c, m)
    elif t == "p":
        if not c.joined:
            on_hello(c, {})
        on_patch(c, m.get("d"))


async def ws_loop(c, reader):
    parts, kind = [], None
    while c.alive:
        h = await reader.readexactly(2)
        fin, op, masked, n = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x80, h[1] & 0x7F
        if n == 126:
            n = struct.unpack("!H", await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", await reader.readexactly(8))[0]
        if n > MAX_FRAME:
            raise ValueError("слишком большое сообщение")
        mask = await reader.readexactly(4) if masked else None
        payload = await reader.readexactly(n) if n else b""
        if mask:
            payload = unmask(payload, mask)
        c.last = time.monotonic()
        if op == 8:  # закрытие
            send_raw(c, ws_frame(8, payload[:2]))
            return
        if op == 9:  # ping
            send_raw(c, ws_frame(10, payload[:125]))
            continue
        if op == 10:  # pong
            continue
        if op in (1, 2):
            parts, kind = [payload], op
        elif op == 0 and kind is not None:
            parts.append(payload)
        else:
            raise ValueError("непонятный кадр")
        if sum(len(x) for x in parts) > MAX_FRAME:
            raise ValueError("слишком большое сообщение")
        if not fin:
            continue
        data, k = b"".join(parts), kind
        parts, kind = [], None
        if k != 1:
            continue
        if c.last - c.win_at > 2.0:
            c.win_at, c.win_n = c.last, 0
        c.win_n += 1
        if c.win_n > 400:
            raise ValueError("слишком много сообщений")
        on_message(c, data)


async def ws_session(reader, writer, headers, ip):
    key = headers.get("sec-websocket-key", "")
    if not key or headers.get("sec-websocket-version", "") != "13":
        await respond(writer, "400 Bad Request", "text/plain; charset=utf-8", b"WebSocket only")
        return
    origin = headers.get("origin")
    if origin:
        o = urllib.parse.urlsplit(origin).netloc.lower()
        if o != headers.get("host", "").lower():
            await respond(writer, "403 Forbidden", "text/plain; charset=utf-8", b"Wrong origin")
            return
    if len(clients) >= MAX_CLIENTS:
        await respond(writer, "503 Service Unavailable", "text/plain; charset=utf-8", b"Too many devices")
        return
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("ascii")).digest()).decode("ascii")
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode("ascii"))
    _counter[0] += 1
    c = Client(_counter[0], writer, ip)
    clients[c.id] = c
    try:
        sock = writer.get_extra_info("socket")
        if sock is not None:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass
    try:
        await ws_loop(c, reader)
    except (asyncio.IncompleteReadError, ConnectionError, OSError, ValueError):
        pass
    finally:
        drop(c)


async def heartbeat():
    hb = ws_frame(1, b'{"t":"hb"}')
    while True:
        await asyncio.sleep(HB_EVERY)
        t = time.monotonic()
        for c in list(clients.values()):
            if t - c.last > DEAD_AFTER:
                drop(c, "долго молчал")
            else:
                send_raw(c, hb)


async def ticker():
    # частые пробуждения цикла, чтобы Ctrl+C срабатывал сразу и в Windows
    while True:
        await asyncio.sleep(0.5)


# ---------------------------------------------------------------------------
# HTTP: страница игры, адреса ноутбука, вход для WebSocket
# ---------------------------------------------------------------------------
GAME_GZ = b""
GAME_HTML = b""
PORT = [0]
TOKEN = base64.urlsafe_b64encode(os.urandom(9)).decode("ascii")  # чтобы узнать себя на порту
_seen_pages = {}


async def respond(writer, status, ctype, body, head=False, extra=()):
    lines = ["HTTP/1.1 " + status, "Content-Type: " + ctype, "Content-Length: %d" % len(body),
             "Cache-Control: no-store", "Connection: close", "X-Content-Type-Options: nosniff"]
    lines.extend(extra)
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + (b"" if head else body))
    try:
        await writer.drain()
    except Exception:
        pass


async def handle(reader, writer):
    peer = writer.get_extra_info("peername")
    ip = peer[0] if peer else "?"
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    try:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError, OSError):
            return
        lines = raw.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) < 3:
            await respond(writer, "400 Bad Request", "text/plain; charset=utf-8", b"Bad request")
            return
        method, target = parts[0], parts[1]
        headers = {}
        for ln in lines[1:]:
            if ":" in ln:
                k, v = ln.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        path = urllib.parse.urlsplit(target).path or "/"
        if path == "/ws" and "websocket" in headers.get("upgrade", "").lower():
            await ws_session(reader, writer, headers, ip)
            return
        if method not in ("GET", "HEAD"):
            await respond(writer, "405 Method Not Allowed", "text/plain; charset=utf-8", b"GET only", extra=["Allow: GET, HEAD"])
            return
        head = method == "HEAD"
        if path in ("/", "/index.html"):
            if "gzip" in headers.get("accept-encoding", "").lower():
                await respond(writer, "200 OK", "text/html; charset=utf-8", GAME_GZ, head, ["Content-Encoding: gzip", "Vary: Accept-Encoding"])
            else:
                await respond(writer, "200 OK", "text/html; charset=utf-8", GAME_HTML, head, ["Vary: Accept-Encoding"])
            if _is_ip(ip) and not ipaddress.ip_address(ip).is_loopback:
                t = time.monotonic()
                if t - _seen_pages.get(ip, -1e9) > 30:
                    log("страницу игры открыли с %s" % ip)
                _seen_pages[ip] = t
        elif path == "/info":
            body = json.dumps({"app": APP, "ver": VERSION, "port": PORT[0], "id": TOKEN, "ips": await cached_ips()}).encode("utf-8")
            await respond(writer, "200 OK", "application/json; charset=utf-8", body, head)
        elif path == "/favicon.ico":
            await respond(writer, "204 No Content", "image/x-icon", b"", head)
        else:
            await respond(writer, "404 Not Found", "text/plain; charset=utf-8", "Нет такой страницы. Игра — по адресу /".encode("utf-8"), head)
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def _is_ip(s):
    try:
        ipaddress.ip_address(s)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# запуск
# ---------------------------------------------------------------------------
def _info(port):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:%d/info" % port, timeout=0.8) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def already_running():
    for port in DEFAULT_PORTS:
        j = _info(port)
        if isinstance(j, dict) and j.get("app") == APP:
            return port
    return None


def open_browser(url):
    def go():
        try:
            webbrowser.open(url)
        except Exception:
            pass
    threading.Thread(target=go, daemon=True).start()


def banner(port):
    ips = local_ips()
    say("=" * 64)
    say("  Банда «Базис» — сервер игры запущен")
    say("=" * 64)
    say("  Большой экран (этот ноутбук):  http://localhost:%d" % port)
    if ips:
        say("  Телефоны в той же Wi-Fi сети:  http://%s:%d" % (ips[0], port))
        for ip in ips[1:4]:
            say("                     или так:    http://%s:%d" % (ip, port))
        say("  QR-код для телефонов будет в лобби игры на большом экране.")
    else:
        say("  Ноутбук пока не подключён ни к одной сети.")
        say("  Включи мобильный хот-спот: Параметры -> Сеть и Интернет -> Мобильный хот-спот.")
        say("  Адрес для телефонов появится в лобби игры, как только сеть заработает.")
    say("")
    say("  Не закрывай это окно, пока играете. Остановить: Ctrl+C.")
    say("")
    say("  Телефон не открывает страницу?")
    say("   - он подключён к той же сети, что и ноутбук (лучше всего - к хот-споту ноутбука);")
    say("   - Windows спросила про брандмауэр: разреши Python и в частных, и в общественных сетях;")
    say("   - выключи на телефоне мобильный интернет и VPN.")
    say("-" * 64)


class PortError(Exception):
    pass


async def serve(args):
    ports = [args.port] if args.port else DEFAULT_PORTS
    server, err = None, None
    loop = asyncio.get_running_loop()
    for p in ports:
        try:
            server = await asyncio.start_server(handle, args.bind, p, limit=65536)
        except OSError as e:
            err = e
            continue
        if args.bind not in ("0.0.0.0", "127.0.0.1", ""):
            break
        # Windows разрешает открыть порт, который другая программа держит только на localhost, —
        # тогда браузер ноутбука попал бы к ней. Проверяем, что по localhost отвечаем именно мы.
        PORT[0] = server.sockets[0].getsockname()[1]
        j = await loop.run_in_executor(None, _info, PORT[0])
        if isinstance(j, dict) and j.get("id") == TOKEN:
            break
        server.close()
        await server.wait_closed()
        server, err = None, "порт %d занят другой программой" % p
    if server is None:
        raise PortError("Не получилось открыть порт %s: %s" % (", ".join(map(str, ports)), err))
    PORT[0] = server.sockets[0].getsockname()[1]
    banner(PORT[0])
    if not args.no_browser:
        open_browser("http://localhost:%d/" % PORT[0])
    tasks = [asyncio.ensure_future(heartbeat()), asyncio.ensure_future(ticker())]
    try:
        async with server:
            await server.serve_forever()
    finally:
        for t in tasks:
            t.cancel()


def main():
    setup_console()
    ap = argparse.ArgumentParser(description="Банда «Базис»: игра по локальной сети")
    ap.add_argument("--port", type=int, default=None, help="порт (по умолчанию 8000 или первый свободный)")
    ap.add_argument("--bind", default="0.0.0.0", help="на каком адресе слушать (по умолчанию все сети)")
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер на ноутбуке")
    args = ap.parse_args()
    threading.Thread(target=_log_worker, daemon=True).start()
    if sys.version_info < (3, 8):
        say("Нужен Python 3.8 или новее. Скачай с python.org.")
        return 1
    global GAME_GZ, GAME_HTML
    GAME_GZ = base64.b64decode("".join(GAME_B64.split()))
    GAME_HTML = gzip.decompress(GAME_GZ)
    running = None if args.port else already_running()
    if running:
        say("Сервер игры уже запущен (http://localhost:%d) — открываю большой экран." % running)
        if not args.no_browser:
            open_browser("http://localhost:%d/" % running)
        time.sleep(1.5)
        return 0
    code = 0
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        say("Сервер остановлен.")
    except PortError as e:
        say(str(e))
        say("Возможно, порт занят другой программой. Попробуй: py bazis_server.py --port 8123")
        code = 1
    except Exception as e:
        say("Ошибка: %r" % (e,))
        code = 1
    time.sleep(0.3)
    if code and os.name == "nt":
        try:
            input("Нажми Enter, чтобы закрыть окно...")
        except Exception:
            pass
    return code


# Страница игры (index.html), сжатая gzip и записанная base64.
GAME_B64 = """
__GAME_B64__
"""

if __name__ == "__main__":
    sys.exit(main())
