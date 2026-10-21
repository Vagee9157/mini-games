"""没事做的时候循环睡觉：省下来的是浏览器出帧，规则一点不能变

  · 不按键、方块在空中：一秒只醒几次（原来 60 次）
  · 睡着的时间照实算进重力：game.elapsed 跟墙钟对得上、掉了几格对得上
  · 一按键立刻醒，下一帧就画；按住横移 / 落地等锁定时每帧都跑
  · 退回开局面板 / 暂停时睡醒也不会把循环拉起来空转
  · 疯狂版不睡
真实时钟跑（不用 T.step），因为测的就是循环本身。
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
  const $ = id => document.getElementById(id);
  const ev = (id, t) => $(id).dispatchEvent(new MouseEvent(t, { bubbles: true }));
  const fresh = () => { $('startBtn').click(); T.game.noGarbage = true;
    for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
    T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext(); };

  // ── 不按键：睡着 ──
  fresh();
  await sleep(300);
  const f0 = T.dbg.frames, e0 = T.game.elapsed, y0 = T.game.piece.y, t0 = performance.now();
  await sleep(3000);
  const fps = (T.dbg.frames - f0) / ((performance.now() - t0) / 1000);
  ok(fps < 12, `不按键时循环一秒醒 ${fps.toFixed(1)} 次（原来约 60）`);
  // ── 时间照实算 ──
  const wall = performance.now() - t0, gt = T.game.elapsed - e0;
  ok(Math.abs(gt - wall) < 120, `睡着的时间照实算：游戏时间 ${gt.toFixed(0)}ms / 墙钟 ${wall.toFixed(0)}ms`);
  const g = T.gravityFor(T.game.level), fell = T.game.piece.y - y0;
  ok(Math.abs(fell - gt / g) <= 1, `重力照常：${(gt / 1000).toFixed(1)} 秒掉了 ${fell} 格（每 ${g.toFixed(0)}ms 一格，应约 ${(gt / g).toFixed(1)}）`);

  // ── 掉落节奏：每一格的间隔都要和不睡时一样 ──
  // 第一版这里没测，结果每次睡醒都被补算上限砍掉十几毫秒，方块每格晚 17~50ms（慢了 4~5%），
  // 而上面那条「3 秒掉 3 格」的容差把它藏住了。逐格量间隔才看得出来
  for (const lv of [1, 20]){
    fresh(); T.game.level = lv;
    T.game.piece = null; T.game.queue.unshift('I'); T.game.mods.unshift(null); T.spawnNext();
    const gg = T.gravityFor(lv), seen = [];
    let ly = T.game.piece.y; const ts = performance.now();
    await new Promise(done => { const f = now => { const q = T.game.piece;
      if (!q || now - ts > 4200){ done(); return; }
      if (q.y !== ly){ ly = q.y; seen.push(now); } requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const dev = []; for (let i = 1; i < seen.length; i++) dev.push(Math.abs(seen[i] - seen[i - 1] - gg));
    const med = dev.slice().sort((a, b) => a - b)[dev.length >> 1];
    // 看中位数不看平均：偶尔晚一帧（~17ms）是正常抖动，不睡的版本也有，跑全套时机器忙还会连着晚两格，
    // 平均就被拉过线了（偶发红过）。旧问题是**每一格**都晚（中位 15~50ms），中位数照样抓得住
    ok(dev.length >= 3 && med < 8 && Math.max(...dev) < 25,
       `${lv} 级逐格掉落：${dev.length} 个间隔，偏差中位 ${med.toFixed(1)}ms、最大 ${Math.max(...dev).toFixed(1)}ms（每格 ${gg.toFixed(0)}ms）`);
  }
  fresh(); await sleep(200);

  // ── 一按键立刻醒 ──
  await sleep(150);
  const x0 = T.game.piece.x, d0 = T.dbg.draws, tp = performance.now();
  ev('btnLeft', 'mousedown'); ev('btnLeft', 'mouseup');
  ok(T.game.piece.x === x0 - 1, '按下的那一刻就挪了');
  while (T.dbg.draws === d0 && performance.now() - tp < 200) await new Promise(r => requestAnimationFrame(r));
  ok(performance.now() - tp < 40, `睡着时按键，${(performance.now() - tp).toFixed(0)}ms 内画出来`);

  // ── 按住横移：每帧都跑 ──
  T.game.piece.x = 4;
  const f1 = T.dbg.frames, t1 = performance.now();
  ev('btnRight', 'mousedown'); await sleep(600); ev('btnRight', 'mouseup');
  const fpsHold = (T.dbg.frames - f1) / ((performance.now() - t1) / 1000);
  ok(fpsHold > 40, `按住横移时每帧都跑（${fpsHold.toFixed(0)} 次/秒）`);
  ok(T.game.piece.x === 8, `按住右照常连发到墙（列 ${T.game.piece.x}）`);

  // ── 落地等锁定：每帧都跑，锁定时机不变 ──
  fresh();
  const p = T.game.piece; while (!T.collides(p.type, p.x, p.y + 1, p.rot)) p.y++;
  T.redraw();
  const f2 = T.dbg.frames, t2 = performance.now(), n0 = T.game.pieces;
  await sleep(700);
  ok(T.game.pieces === n0 + 1, '落地后照常在锁定延迟后锁死');
  ok((T.dbg.frames - f2) / ((performance.now() - t2) / 1000) > 30, '落地等锁定时没睡');

  // ── 退回开局 / 暂停：不空转 ──
  // 从练习退回开局面板（exitPractice 那条路会把局停掉），看睡醒的定时器会不会把循环拉起来
  T.startPractice(); await sleep(400);
  document.querySelector('#modeSw [data-m="normal"]').click();
  await sleep(500);
  const f3 = T.dbg.frames; await sleep(1000);
  ok(T.dbg.frames === f3 && !T.game.started, `回到开局面板后循环停着（1 秒醒了 ${T.dbg.frames - f3} 次）`);
  fresh(); await sleep(400);
  $('pauseBtn').click(); await sleep(400);
  const f4 = T.dbg.frames; await sleep(800);
  ok(T.dbg.frames === f4, `暂停后不空转（醒了 ${T.dbg.frames - f4} 次）`);
  $('pauseBtn').click();
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
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    fc = pg.evaluate("""async () => { const T = __tetris; document.getElementById('startBtn').click(); T.ups.length = 0;
      await new Promise(r => setTimeout(r, 300)); const f = T.dbg.frames, t = performance.now();
      await new Promise(r => setTimeout(r, 1500)); return (T.dbg.frames - f) / ((performance.now() - t) / 1000); }""")
    r.append(('PASS ' if fc > 40 else 'FAIL ') + f'疯狂版不睡（{fc:.0f} 次/秒）')
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    print('循环睡觉')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
