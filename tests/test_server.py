"""Проверка сервера локальной сети без браузера: сырые WebSocket-клиенты на сокетах.
Запуск: python3 test_server.py dist/bazis_server.py"""
import base64, json, os, socket, struct, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import SERVER, need_build

SRV = sys.argv[1] if len(sys.argv) > 1 else SERVER
if len(sys.argv) <= 1:
    need_build()
PORT = 8791
fails = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


class WS:
    def __init__(self, origin=None, path="/ws", connect=True):
        self.s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        hdr = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
        if origin:
            hdr += f"Origin: {origin}\r\n"
        self.s.sendall((hdr + "\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.s.recv(4096)
            if not chunk:
                break
            resp += chunk
        self.status = resp.split(b"\r\n", 1)[0].decode()
        head, _, self.buf = resp.partition(b"\r\n\r\n")

    def send_frame(self, op, payload, fin=True, mask=True):
        b0 = (0x80 if fin else 0) | op
        n = len(payload)
        if n < 126:
            h = struct.pack("!BB", b0, (0x80 if mask else 0) | n)
        elif n < 65536:
            h = struct.pack("!BBH", b0, (0x80 if mask else 0) | 126, n)
        else:
            h = struct.pack("!BBQ", b0, (0x80 if mask else 0) | 127, n)
        if mask:
            m = os.urandom(4)
            payload = bytes(b ^ m[i % 4] for i, b in enumerate(payload))
            h += m
        self.s.sendall(h + payload)

    def send(self, obj):
        self.send_frame(1, json.dumps(obj).encode())

    def _need(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk

    def recv_frame(self, timeout=5):
        self.s.settimeout(timeout)
        self._need(2)
        op, n = self.buf[0] & 0x0F, self.buf[1] & 0x7F
        off = 2
        if n == 126:
            self._need(4); n = struct.unpack("!H", self.buf[2:4])[0]; off = 4
        elif n == 127:
            self._need(10); n = struct.unpack("!Q", self.buf[2:10])[0]; off = 10
        self._need(off + n)
        data = self.buf[off:off + n]
        self.buf = self.buf[off + n:]
        return op, data

    def recv(self, timeout=5, skip_hb=True):
        while True:
            op, data = self.recv_frame(timeout)
            if op == 1:
                m = json.loads(data)
                if skip_hb and m.get("t") == "hb":
                    continue
                return m
            if op == 8:
                raise ConnectionError("close frame")

    def closed(self, timeout=3):
        try:
            while True:
                op, _ = self.recv_frame(timeout)
                if op == 8:
                    return True
        except (ConnectionError, OSError):
            return True
        except socket.timeout:
            return False

    def close(self):
        try:
            self.send_frame(8, b"\x03\xe8")
        except OSError:
            pass
        self.s.close()


srv = subprocess.Popen([os.environ.get("SRV_PY", sys.executable), SRV, "--port", str(PORT), "--no-browser"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.0)
try:
    # 1. базовая раздача состояния
    a = WS(origin=f"http://127.0.0.1:{PORT}")
    check(a.status.startswith("HTTP/1.1 101"), "рукопожатие WebSocket")
    a.send({"t": "hi", "cid": "tabA", "p": {"app": "bazis", "host": True, "code": "1234", "x": 1}})
    w = a.recv()
    check(w["t"] == "welcome" and w["peers"] == {}, "первому — пустой список")
    aid = w["id"]
    b = WS()
    b.send({"t": "hi", "cid": "tabB", "p": {"app": "bazis", "role": "phone", "nick": "Лиса"}})
    w = b.recv()
    check(w["t"] == "welcome" and w["peers"].get(aid, {}).get("x") == 1, "новичок видит состояние большого экрана")
    bid = w["id"]
    m = a.recv()
    check(m == {"t": "p", "id": bid, "d": {"app": "bazis", "role": "phone", "nick": "Лиса"}}, "большой экран узнаёт о новичке")
    a.send({"t": "p", "d": {"x": 2, "code": None}})
    m = b.recv()
    check(m == {"t": "p", "id": aid, "d": {"x": 2, "code": None}}, "изменение доходит, null — удаление ключа")
    # 2. фрагментированное сообщение и ping
    payload = json.dumps({"t": "p", "d": {"frag": "x" * 300}}).encode()
    a.send_frame(1, payload[:100], fin=False)
    a.send_frame(9, b"hello")
    a.send_frame(0, payload[100:200], fin=False)
    a.send_frame(0, payload[200:], fin=True)
    op, data = a.recv_frame()
    check(op == 10 and data == b"hello", "ping -> pong")
    m = b.recv()
    check(m["d"].get("frag") == "x" * 300, "сообщение по кускам собирается")
    # 3. та же вкладка переподключилась — старое соединение выкидывается
    a2 = WS()
    a2.send({"t": "hi", "cid": "tabA", "p": {"app": "bazis", "host": True, "code": "1234", "x": 3}})
    w2 = a2.recv()
    check(a.closed(), "старое соединение той же вкладки закрыто")
    m1, m2 = b.recv(), b.recv()
    check(m1 == {"t": "bye", "id": aid} and m2["t"] == "p" and m2["id"] == w2["id"] and m2["d"]["x"] == 3, "телефон видит: старый ушёл, новый пришёл")
    check(bid in w2["peers"] and w2["peers"][bid]["nick"] == "Лиса", "переподключившийся снова видит телефон")
    # 4. чужой сайт не пускаем
    evil = WS(origin="http://evil.example")
    check(evil.status.startswith("HTTP/1.1 403"), "чужой origin -> 403")
    # 5. слишком большой кадр — отключение
    big = WS()
    big.send({"t": "hi", "cid": "big", "p": {}})
    big.recv()
    big.send_frame(1, b"x" * (300 * 1024))
    check(big.closed(), "кадр больше 256 КБ — отключение")
    m = b.recv()
    check(m["t"] == "bye", "о выкинутом сообщили остальным")
    # 6. медленный телефон не тормозит остальных и в конце концов отключается
    slow = WS()
    slow.s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    slow.send({"t": "hi", "cid": "slow", "p": {"app": "bazis"}})
    sid = None
    while True:  # b читает всё, что пришло о новичке
        m = b.recv()
        if m["t"] == "p" and "app" in m["d"] and m["id"] != aid:
            sid = m["id"]
            break
    t0 = time.time()
    blob = "y" * 60000
    N = 300
    last, dropped_slow = -1, False
    for i in range(N):
        a2.send({"t": "p", "d": {"blob": blob, "i": i}})
        # b читает по ходу, как живой телефон
        while True:
            m = b.recv(timeout=8)
            if m["t"] == "bye" and m["id"] == sid:
                dropped_slow = True
                continue
            if m["t"] == "p" and m["d"].get("i") == i:
                last = i
                break
        if i % 50 == 49:
            time.sleep(0.25)
    check(last == N - 1, f"читающий телефон получил все {N} крупных обновлений за {time.time() - t0:.1f} с")
    check(dropped_slow, "не читающий данные телефон отключён, когда у него скопилось больше 1 МБ")
    slow.s.close()
    # 7. «тик» раз в 4 с и отключение молчуна
    q = WS()
    q.send({"t": "hi", "cid": "quiet", "p": {"app": "bazis", "role": "phone", "nick": "Молчун"}})
    qid = q.recv()["id"]
    got_hb = False
    t0 = time.time()
    while time.time() - t0 < 6:
        op, data = q.recv_frame(timeout=6)
        if op == 1 and json.loads(data).get("t") == "hb":
            got_hb = True
            break
    check(got_hb, "сервер шлёт тик")
    b.send({"t": "hb"}); a2.send({"t": "hb"})
    t0 = time.time()
    quiet_dropped = False
    while time.time() - t0 < 24:
        try:
            m = b.recv(timeout=2)
            if m["t"] == "bye" and m["id"] == qid:
                quiet_dropped = True
                break
        except socket.timeout:
            pass
        b.send({"t": "hb"}); a2.send({"t": "hb"})
    check(quiet_dropped, f"молчащий 15+ с отключён (через {time.time() - t0:.0f} с)")
    # 8. HTTP поверх: /info жив после всего
    import urllib.request
    info = json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f"http://127.0.0.1:{PORT}/info", timeout=3).read())
    check(info["app"] == "bazis" and info["port"] == PORT, "/info отвечает")
finally:
    srv.terminate()
    out = srv.communicate(timeout=5)[0].decode("utf-8", "replace")
print("--- журнал сервера ---")
print("\n".join(out.splitlines()[-14:]))
print("FAILS:", fails if fails else "none")
sys.exit(1 if fails else 0)
