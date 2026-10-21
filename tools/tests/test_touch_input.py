"""屏幕按键防误操作：落底连点、按住变换带歪下一块

按键走真实的 bindButtons 路径（派发 mousedown/mouseup，和触屏同一套 start/end），
不直接调 hardDrop —— 防护就加在按键这一层，绕过去测不到。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
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
  };

  // ① 落底连点：保护窗口内第二下不算，窗口外照常
  for (const gap of [40, 100, T.DROP_GUARD_MS - 30]){
    await fresh(); const n0 = T.game.pieces;
    tap('btnDrop'); await sleep(gap); tap('btnDrop'); await sleep(30);
    ok(T.game.pieces - n0 === 1, `落底隔 ${gap}ms 点两下只落 1 块（落了 ${T.game.pieces - n0}）`);
  }
  await fresh(); { const n0 = T.game.pieces;
    tap('btnDrop'); await sleep(T.DROP_GUARD_MS + 60); tap('btnDrop'); await sleep(30);
    ok(T.game.pieces - n0 === 2, `隔 ${T.DROP_GUARD_MS + 60}ms 的两下照常落 2 块（落了 ${T.game.pieces - n0}）`); }

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
    print('屏幕按键防误操作')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
sys.exit(1 if fails else 0)
