"""Проверка живых механик: обход охраны, поимка, сирена, подсказка, пауза, подсмотр, музыка,
настоящие нажатия на пульты телефона и игра на одном экране без телефонов."""
import json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import MOCK, shots_dir, static_server, launch, is_noise

SHOTS = shots_dir("e2e_guard")
srv = static_server(8765)
URL = "http://127.0.0.1:8765/test.html"
errors, shots, checks = [], [], []


def watch(page, name):
    page.on("console", lambda m: errors.append(f"{name}: {m.text}") if m.type == "error" and not is_noise(m) else None)
    page.on("pageerror", lambda e: errors.append(f"{name}: pageerror {e}"))


def ok(cond, what):
    checks.append(("OK " if cond else "FAIL ") + what)
    if not cond:
        print("FAIL:", what)


def H(host, expr):
    return host.evaluate(f"(() => {{ const H = BazisDebug.H; return {expr}; }})()")


def music(host):
    return host.evaluate("Music.state()")


try:
    with sync_playwright() as pw:
        br = launch(pw, args=["--autoplay-policy=no-user-gesture-required"])
        ctx = br.new_context(color_scheme="dark")
        ctx.add_init_script(MOCK)
        host = ctx.new_page(); host.set_viewport_size({"width": 1600, "height": 900}); watch(host, "host")
        host.goto(URL)
        host.click('[data-act=go-host][data-cs=usadba]')
        host.wait_for_selector(".bigcode")
        code = host.inner_text(".bigcode").strip()
        ok(music(host)["mode"] == "lobby", f"music in lobby: {music(host)}")
        phones = []
        for nick in ["Лиса", "Медведь", "Сова"]:
            ph = ctx.new_page(); ph.set_viewport_size({"width": 390, "height": 844}); watch(ph, nick)
            ph.goto(URL); ph.click("[data-act=go-phone]")
            ph.fill("#j-code", code); ph.fill("#j-nick", nick); ph.click("button[type=submit]")
            ph.wait_for_function("BazisDebug.P && BazisDebug.P.hs && BazisDebug.P.hs.ph === 'lobby'")
            phones.append(ph)
        host.wait_for_function("BazisDebug.H.n === 3")
        host.check("#old")
        host.click("[data-act=start]")
        host.wait_for_function("BazisDebug.H.phase === 'intro'")
        host.click("[data-act=go]")
        host.wait_for_function("BazisDebug.H.phase === 'play'")
        for ph in phones:
            ph.wait_for_function("BazisDebug.P.hs.ph === 'play'")
        m = music(host)
        ok(m["mode"] == "play" and m["running"], f"music plays during heist: {m}")

        # --- настоящие нажатия на пульт: стрелка «вправо» у первого столбца
        holder = None
        for ph in phones:
            if ph.locator('#role-c1 [aria-label="Вправо"]').count():
                holder = ph
        ok(holder is not None, "someone holds column 1")
        before = H(host, "JSON.stringify(H.V.c1)")
        holder.click('#role-c1 [aria-label="Вправо"]')
        holder.click('#role-c1 [aria-label="Вверх"]')
        host.wait_for_function(f"JSON.stringify(BazisDebug.H.V.c1) !== {json.dumps(before)}", timeout=5000)
        after = H(host, "JSON.stringify(H.V.c1)")
        ok(after != before, f"phone click reaches big screen: {before} -> {after}")
        ok(holder.inner_text("#role-c1 .pt-val") == "(2, 1)", f"phone shows its own value: {holder.inner_text('#role-c1 .pt-val')}")
        time.sleep(1.2)

        # --- обход охраны: предупреждение, сторож видит отсчёт
        host.evaluate("BazisDebug.H.guard.next = performance.now() - 1")
        host.wait_for_function("BazisDebug.H.guard.state === 'warn'", timeout=5000)
        look = None
        for ph in phones:
            if ph.locator("#radar").count():
                look = ph
        ok(look is not None, "lookout phone has radar")
        if look:
            look.wait_for_function("document.getElementById('radar-txt').textContent.includes('Охрана через')", timeout=4000)
            shots.append(("lookout-warn", look.screenshot(full_page=True)))
        shots.append(("host-warn", host.screenshot()))
        host.wait_for_function("BazisDebug.H.guard.state === 'check'", timeout=9000)
        ok(music(host)["mode"] == "check", f"music hushes during check: {music(host)['mode']}")
        others = [ph for ph in phones if ph is not holder]
        others[0].wait_for_function("!document.getElementById('guardbar').hidden", timeout=3000)
        shots.append(("phone-check", others[0].screenshot(full_page=True)))
        shots.append(("host-check", host.screenshot()))
        time.sleep(0.8)
        al0 = H(host, "H.alarm")
        holder.click('#role-c1 [aria-label="Вниз"]')
        host.wait_for_function("BazisDebug.H.stats[0].caught === 1", timeout=4000)
        ok(H(host, "H.alarm") >= al0 + 12, f"caught raises alarm {al0} -> {H(host, 'H.alarm')}")
        nick = holder.evaluate("BazisDebug.P.nick")
        ok(any(nick in x for x in H(host, "H.log.map(x => x.m)")), f"big screen names who made noise ({nick})")
        shots.append(("host-caught", host.screenshot()))
        host.wait_for_function("BazisDebug.H.guard.state === 'idle'", timeout=6000)
        ok(music(host)["mode"] == "play", "music returns after the guard passes")

        # --- подсказка и пауза
        al1 = H(host, "H.alarm")
        host.click("[data-act=hint]")
        ok(abs(H(host, "H.alarm") - (al1 + 8)) < 0.01, "hint costs 8% alarm")
        host.click("[data-act=pause]")
        ok(H(host, "!!H.pausedAt") and music(host)["mode"] == "calm", "pause stops the clock and calms the music")
        host.click("[data-act=pause]")
        ok(H(host, "!H.pausedAt") and music(host)["mode"] == "play", "resume")

        # --- сирена: тревога у края, ещё одна поимка
        vv0 = H(host, "H.vv")
        host.evaluate("BazisDebug.H.alarm = 99; BazisDebug.H.guard.next = performance.now() - 1")
        host.wait_for_function("BazisDebug.H.guard.state === 'check'", timeout=9000)
        time.sleep(0.8)
        holder.click('#role-c1 [aria-label="Вверх"]')
        host.wait_for_function("BazisDebug.H.sirenUntil > 0", timeout=4000)
        ok(music(host)["mode"] == "siren", f"siren music: {music(host)['mode']}")
        shots.append(("host-siren", host.screenshot()))
        host.wait_for_function("BazisDebug.H.sirenUntil === 0", timeout=6000)
        ok(H(host, "H.alarm") == 55 and H(host, "H.vv") > vv0, f"after siren: alarm 55, controls reset ({H(host, 'H.alarm')})")
        holder.wait_for_function("document.querySelector('#role-c1 .pt-val') && document.querySelector('#role-c1 .pt-val').textContent === '(1, 0)'", timeout=4000)
        ok(True, "phone controls snap back after siren")

        # --- подсмотреть ответ
        host.click("[data-act=reveal]")
        host.click("[data-act=reveal-yes]")
        host.wait_for_function("BazisDebug.H.phase === 'win' || BazisDebug.H.phase === 'debrief'", timeout=6000)
        ok(H(host, "H.stats[0].revealed") and H(host, "H.stats[0].loot") == 0, "revealed level gives no loot")
        host.wait_for_function("BazisDebug.H.phase === 'debrief'", timeout=6000)
        shots.append(("host-debrief", host.screenshot()))
        phones[0].wait_for_selector("text=Конспект")
        ctx.close()

        # --- один экран, без телефонов: банк, первая дверь кнопками
        ctx2 = br.new_context(color_scheme="light")
        ctx2.add_init_script(MOCK)
        solo = ctx2.new_page(); solo.set_viewport_size({"width": 1366, "height": 900}); watch(solo, "solo")
        solo.goto(URL)
        solo.click('[data-act=go-host][data-cs=bazis]')
        solo.wait_for_selector(".bigcode")
        solo.click("[data-act=start]")
        solo.wait_for_function("BazisDebug.H.phase === 'intro' && BazisDebug.H.solo")
        solo.click("[data-act=go]")
        solo.wait_for_function("BazisDebug.H.phase === 'play'")
        sol = solo.evaluate("(() => { const H = BazisDebug.H; const L = BazisCore.getLevel(H.cs, H.code, H.round, H.lv, H.old); return L.solution(L.initAux(H.nL)); })()")
        for rid in ["a0", "c0"]:
            s = sol[rid]["s"]
            lab = "Больше" if s > 0 else "Меньше"
            for _ in range(abs(s)):
                solo.click(f'#role-{rid} [aria-label="{lab}"]')
        shots.append(("solo-play", solo.screenshot(full_page=True)))
        solo.wait_for_function("BazisDebug.H.phase === 'win' || BazisDebug.H.phase === 'debrief'", timeout=6000)
        ok(True, f"solo: door opened with on-screen buttons {sol}")
        shots.append(("solo-win", solo.screenshot()))
        ctx2.close()

        # --- ошибка в коде: телефон видит экран с другим кодом и предлагает войти с ним
        ctx4 = br.new_context(color_scheme="dark")
        ctx4.add_init_script(MOCK)
        h4 = ctx4.new_page(); h4.set_viewport_size({"width": 1366, "height": 900}); watch(h4, "h4")
        h4.goto(URL); h4.click('[data-act=go-host][data-cs=usadba]'); h4.wait_for_selector(".bigcode")
        real = h4.inner_text(".bigcode").strip()
        wrong = "1111" if real != "1111" else "2222"
        p4 = ctx4.new_page(); p4.set_viewport_size({"width": 390, "height": 844}); watch(p4, "p4")
        p4.goto(URL); p4.click("[data-act=go-phone]")
        p4.fill("#j-code", wrong); p4.fill("#j-nick", "Кот"); p4.click("button[type=submit]")
        p4.wait_for_selector(f'[data-act=use-code][data-code="{real}"]', timeout=15000)
        shots.append(("phone-wrong-code", p4.screenshot(full_page=True)))
        p4.click(f'[data-act=use-code][data-code="{real}"]')
        h4.wait_for_function("BazisDebug.H.n === 1", timeout=8000)
        ok(True, "wrong code: phone offers the code it can see and joins with one tap")
        ctx4.close()

        # --- странице не дали связь (use("room") вернул null)
        ctx5 = br.new_context(color_scheme="light")
        ctx5.add_init_script("window.__MOCK_ROOM = 'null';\n" + MOCK)
        p5 = ctx5.new_page(); p5.set_viewport_size({"width": 390, "height": 844}); watch(p5, "p5")
        p5.goto(URL); p5.click("[data-act=go-phone]")
        p5.fill("#j-code", "1234"); p5.fill("#j-nick", "Ёж"); p5.click("button[type=submit]")
        p5.wait_for_selector("text=Телефон не подключился", timeout=15000)
        ok("claude.ai" in p5.inner_text(".ph-box"), "no-room phone explains how to open the link")
        shots.append(("phone-noroom", p5.screenshot(full_page=True)))
        ctx5.close()

        # --- телефон без связи вообще (страница вне Claude)
        ctx3 = br.new_context(color_scheme="light")
        nl = ctx3.new_page(); nl.set_viewport_size({"width": 390, "height": 844}); watch(nl, "nolink")
        nl.goto(URL); nl.click("[data-act=go-phone]")
        nl.fill("#j-code", "1234"); nl.fill("#j-nick", "Ёж"); nl.click("button[type=submit]")
        nl.wait_for_selector("text=Телефон не подключился", timeout=15000)
        shots.append(("phone-nolink", nl.screenshot(full_page=True)))
        ok("не внутри Claude" in nl.inner_text(".ph-box"), "phone outside Claude says so")
        br.close()
        for n, png in shots:
            open(os.path.join(SHOTS, n + ".png"), "wb").write(png)
finally:
    srv.terminate()

print("\n".join(checks))
print("console errors:", json.dumps(errors[:20], ensure_ascii=False, indent=0) if errors else "none")
sys.exit(1 if errors or any(c.startswith("FAIL") for c in checks) else 0)
