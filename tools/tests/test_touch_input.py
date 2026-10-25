"""屏幕按键防误操作：落底连点、按住变换带歪下一块

按键走真实的 bindButtons 路径（派发 mousedown/mouseup，和触屏同一套 start/end），
不直接调 hardDrop —— 防护就加在按键这一层，绕过去测不到。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async () => {
  const T = __tetris, L = [];
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (id, type) => document.getElementById(id).dispatchEvent(new MouseEvent(type, {bubbles:true}));
  const tap = id => { ev(id, 'mousedown'); ev(id, 'mouseup'); };
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, {code, bubbles:true}));
  // 每段之前空出比保护窗口长的间隔，不然上一段最后一下会把这段第一下拦掉
  const fresh = async (t) => {
    await sleep(T.DROP_GUARD_MS + 60);
    document.getElementById('startBtn').click(); T.game.noGarbage = true;
    for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
    if (t){ T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); }
    await sleep(T.DROP_BORN_MS + 20);      // 新块刚出来的落底不认，先等过
  };

  // ① 落底连点：保护窗口内第二下不算，窗口外照常
  for (const gap of [40, 100, T.DROP_GUARD_MS - 30]){
    await fresh(); const n0 = T.game.pieces;
    tap('btnDrop'); await sleep(gap); tap('btnDrop'); await sleep(30);
    ok(T.game.pieces - n0 === 1, `落底隔 ${gap}ms 点两下只落 1 块（落了 ${T.game.pieces - n0}）`);
  }
  await fresh(); { const n0 = T.game.pieces;
    const g = Math.max(T.DROP_GUARD_MS, T.DROP_BORN_MS) + 60;
    tap('btnDrop'); await sleep(g); tap('btnDrop'); await sleep(30);
    ok(T.game.pieces - n0 === 2, `隔 ${g}ms 的两下照常落 2 块（落了 ${T.game.pieces - n0}）`); }
  // 两下之间隔得比 DROP_GUARD_MS 久、但新块还没出来够 DROP_BORN_MS：第二下照样不认（手指回弹常有 200ms 上下）
  await fresh(); { const n0 = T.game.pieces;
    tap('btnDrop'); await sleep(T.DROP_GUARD_MS + 20); tap('btnDrop'); await sleep(30);
    ok(T.DROP_GUARD_MS + 20 < T.DROP_BORN_MS && T.game.pieces - n0 === 1, `隔 ${T.DROP_GUARD_MS + 20}ms 的回弹：新块不被砸下去（落了 ${T.game.pieces - n0}）`); }

  // 键盘空格不受保护：桌面连按是有意的
  await fresh(); { const n0 = T.game.pieces;
    key('Space', 'keydown'); key('Space', 'keyup'); key('Space', 'keydown'); key('Space', 'keyup');
    ok(T.game.pieces - n0 === 2, `键盘空格连按两下落 2 块（落了 ${T.game.pieces - n0}）`); }

  // ② 变换没松手就按落底：下一块按正常朝向出生
  await fresh('T');
  ev('btnCw', 'mousedown'); tap('btnDrop');
  ok(T.game.piece && T.game.piece.rot === 0, `按着变换落底，下一块朝向 ${T.game.piece && T.game.piece.rot}（应为 0）`);
  ev('btnCw', 'mouseup');
  // 按着 HOLD 区落底：下一块不自动进暂存
  await fresh('T');
  ev('holdSlot', 'mousedown'); const held0 = T.game.hold;   // 这一下本身会暂存当前块
  tap('btnDrop');
  ok(T.game.hold === held0, `按着暂存落底，下一块没被自动暂存（hold ${held0} → ${T.game.hold}）`);
  ev('holdSlot', 'mouseup');

  // 键盘 IRS 保留：按住 ↑ 再空格，下一块转好出生。
  // 下一块要固定成能转的：随机到 O 的话它转不了，朝向永远是 0（原来每 7 次红一次）
  await fresh('T');
  T.game.queue[0] = 'T';
  key('ArrowUp', 'keydown'); key('Space', 'keydown'); key('Space', 'keyup');
  ok(T.game.piece && T.game.piece.rot === 1, `键盘按住 ↑ 落底仍有 IRS（朝向 ${T.game.piece && T.game.piece.rot}）`);
  key('ArrowUp', 'keyup');

  // ③ 变换按键本身照常转
  await fresh('T');
  tap('btnCw');
  ok(T.game.piece.rot === 1, '点变换转一下');

  // ④ 按偏了也算：键和键之间的空隙、底排键下面那条空白，就近交给最近的键
  const touch = (x, y, type, tg) => {
    tg = tg || document.elementFromPoint(x, y) || document.body;
    const t = new Touch({ identifier: 7, target: tg, clientX: x, clientY: y });
    tg.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    return tg;
  };
  const tapAt = (x, y) => { const tg = touch(x, y, 'touchstart'); touch(x, y, 'touchend', tg); return tg; };
  const R = id => document.getElementById(id).getBoundingClientRect();
  {
    const cw = R('btnCw'), dr = R('btnDrop'), lf = R('btnLeft'), rt = R('btnRight');
    await fresh('T');
    const tg = tapAt((cw.left + cw.right) / 2, Math.min(innerHeight - 1, cw.bottom + 16));
    ok(!tg.closest('button') && T.game.piece.rot === 1, `点在变换键下面 16px：照样转（落点 ${tg.tagName}.${tg.className}，朝向 ${T.game.piece.rot}）`);
    await fresh('T');
    tapAt(cw.left - 3, (cw.top + cw.bottom) / 2);
    ok(T.game.piece.rot === 1, '点在落底和变换中间、靠变换那边：算变换');
    await fresh('T'); { const x0 = T.game.piece.x;
      tapAt(lf.right + 2, (lf.top + lf.bottom) / 2);
      ok(T.game.piece.x === x0 - 1, `点在左移和右移中间、靠左移那边：左移一格（${x0} → ${T.game.piece.x}）`); }
    await fresh('T'); { const n0 = T.game.pieces, x0 = T.game.piece.x;
      tapAt(rt.right + 2, (rt.top + rt.bottom) / 2);
      ok(T.game.pieces === n0 && T.game.piece.x === x0 + 1, `点在右移和落底中间、靠右移那边：右移，不是落底（落了 ${T.game.pieces - n0}，${x0} → ${T.game.piece.x}）`); }
    // 落底只认按在键上：按偏了的触点不会变成落底（按偏成落底这块就锁死了）
    await fresh('T'); { const n0 = T.game.pieces;
      tapAt(dr.left - 2, (dr.top + dr.bottom) / 2);
      tapAt((dr.left + dr.right) / 2, Math.min(innerHeight - 1, dr.bottom + 10));
      ok(T.game.pieces === n0, `点在落底旁边 2px、落底下面 10px：都不落底（落了 ${T.game.pieces - n0}）`); }
    // 松手要找回去：按住偏了的左移再松手，不能一直连发滑到墙边
    await fresh('T'); { const x0 = T.game.piece.x, y = Math.min(innerHeight - 1, lf.bottom + 12), x = (lf.left + lf.right) / 2;
      const tg = touch(x, y, 'touchstart'); touch(x, y, 'touchend', tg); T.step(600);
      ok(T.game.piece.x === x0 - 1, `按偏的左移松手后停住（${x0} → ${T.game.piece.x}，应只走 1 格）`); }
    // 离得远的、落在盘面上的不管
    await fresh('T'); { const s0 = JSON.stringify([T.game.piece.x, T.game.piece.rot]);
      const bd = document.getElementById('board').getBoundingClientRect();
      tapAt((bd.left + bd.right) / 2, bd.bottom - 4);
      tapAt((rt.left + rt.right) / 2, rt.top - 40);
      ok(JSON.stringify([T.game.piece.x, T.game.piece.rot]) === s0, '点在盘面上、离键 40px 远：都不算按键'); }
  }
  return L;
}"""

fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(**p.devices['iPhone 13']); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
    r = pg.evaluate(JS)
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    # 真实触摸（CDP）：Chromium 会把落在键旁边空白里的触摸直接改派给最近的键，
    # 合成的 TouchEvent 测不到这个。落底 / 软降只认真按在键矩形里的触点。
    cdp = pg.context.new_cdp_session(pg)
    def touch(x, y):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]}); pg.wait_for_timeout(40)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(80)
    def fresh():
        pg.evaluate("""() => { const T = __tetris; document.getElementById('startBtn').click(); T.game.noGarbage = true;
          for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
          T.game.piece = null; T.game.queue.unshift('T'); T.game.mods.unshift(null); T.spawnNext(); }""")
        pg.wait_for_timeout(330)
    state = lambda: pg.evaluate("() => { const g = __tetris.game, p = g.piece; return p ? [g.pieces, p.x, p.rot] : null }")
    rc = lambda id: pg.evaluate("id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }", id)
    fresh(); dr = rc('btnDrop'); cy = (dr[1] + dr[3]) / 2
    for name, x, y, want in [('落底键中心', (dr[0] + dr[2]) / 2, cy, 'drop'),
                             ('落底左边 8px 的空白', dr[0] - 8, cy, 'no-drop'),
                             ('落底右边 8px 的空白', dr[2] + 8, cy, 'no-drop'),
                             ('落底下面 10px', (dr[0] + dr[2]) / 2, dr[3] + 10, 'no-drop')]:
        fresh(); a = state(); touch(x, y); b2 = state()
        dropped = b2[0] - a[0]
        okk = dropped == 1 if want == 'drop' else dropped == 0
        r.append(('PASS ' if okk else 'FAIL ') + f'真实触摸：点{name}，{"落底" if want == "drop" else "不落底"}（落了 {dropped} 块）')
    sf = rc('btnSoft')
    fresh(); a = state(); touch((sf[0] + sf[2]) / 2, sf[1] - 10)
    pg.wait_for_timeout(250); b2 = state()
    r.append(('PASS ' if b2[0] == a[0] else 'FAIL ') + '真实触摸：点在软降上面 10px，不触发软降 / 落底')
    print('屏幕按键防误操作')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
sys.exit(1 if fails else 0)
