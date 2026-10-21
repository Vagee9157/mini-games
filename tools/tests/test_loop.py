"""游戏循环和手感：轻点只走一格、按住照常连发、方块掉落节奏准、停着的时候不空转

这组测试的来历：曾经加过「没事做时让循环睡一会儿」省电，结果带出两个手感 bug ——
方块掉落慢了 4~5%、轻点左右滑出去 2~5 格。睡眠整个拿掉了，这里把这几条手感钉住，
谁再往循环里加类似的东西，先过这一关。真实时钟跑（不用 T.step），测的就是循环本身。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async (eng) => {
  const T = __tetris, L = [], $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (id, t) => $(id).dispatchEvent(new MouseEvent(t, { bubbles: true }));
  const fresh = (t) => { $('startBtn').click(); T.game.noGarbage = true;
    for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
    T.game.piece = null; T.game.queue.unshift(t || 'O'); T.game.mods.unshift(null); T.spawnNext(); };

  // ── 轻点（比连发门槛短）：只走 1 格。按下时机错开 40 次 ──
  const bad = [];
  for (const hold of [60, T.DAS - 30]){
    for (let k = 0; k < 20; k++){
      fresh(); T.game.piece.x = 2;
      await sleep(250 + k * 13);
      const x0 = T.game.piece.x;
      ev('btnRight', 'mousedown'); await sleep(hold); ev('btnRight', 'mouseup');
      await sleep(60);
      if (T.game.piece.x - x0 !== 1) bad.push(hold + 'ms→' + (T.game.piece.x - x0));
    }
  }
  ok(!bad.length, `轻点右 40 次（60ms / ${T.DAS - 30}ms，时机错开）：每次只走 1 格${bad.length ? '；走多了：' + bad.join(' ') : ''}`);

  // ── 按住：到门槛开始连发，走到墙 ──
  fresh(); T.game.piece.x = 2; await sleep(200);
  const ts = [], t0 = performance.now(); let last = T.game.piece.x;
  ev('btnRight', 'mousedown');
  while (performance.now() - t0 < 700){ await new Promise(r => requestAnimationFrame(r));
    if (T.game.piece.x !== last){ ts.push(Math.round(performance.now() - t0)); last = T.game.piece.x; } }
  ev('btnRight', 'mouseup');
  ok(ts.length >= 4 && ts[0] < 40 && ts[1] >= T.DAS - 10 && ts[1] < T.DAS + 40 && T.game.piece.x === 8,
     `按住右：按下立刻 1 格、${T.DAS}ms 左右开始连发、走到墙（时刻 ${ts.join(', ')}ms）`);

  // ── 掉落节奏 / 游戏时间对表：只在 Chromium 上量 ——
  // 这台机器上的无头 WebKit 偶尔整帧卡住 300ms 以上，超过循环本来就有的单帧补算上限（MAX_CATCHUP 250），
  // 时间被截掉一段，量出来像「掉慢了」（跑全套时偶发红）。那是测试环境的卡顿，不是游戏的问题
  if (eng === 'chromium') for (const lv of [1, 20]){
    fresh('I'); T.game.level = lv;
    const g = T.gravityFor(lv), seen = []; let ly = T.game.piece.y; const s0 = performance.now();
    await new Promise(done => { const f = now => { const q = T.game.piece;
      if (!q || now - s0 > 4200){ done(); return; }
      if (q.y !== ly){ ly = q.y; seen.push(now); } requestAnimationFrame(f); }; requestAnimationFrame(f); });
    // 看累计漂移，不看单格：每格时长不是帧长的整数倍，单格天然会差一帧（~17ms），机器忙时更明显（跑全套时红过）；
    // 「每格都慢」那种真问题会一格格累加（睡眠那次 3 格累计慢 150ms），累计漂移照样抓得住
    const n = seen.length - 1, drift = n > 0 ? (seen[n] - seen[0]) - n * g : 0;
    ok(n >= 3 && Math.abs(drift) < 30, `${lv} 级逐格掉落：${n} 格累计偏差 ${drift.toFixed(1)}ms（每格 ${g.toFixed(0)}ms）`);
  }
  // 游戏时间跟墙钟对得上
  fresh(); await sleep(200);
  if (eng === 'chromium'){
    const e0 = T.game.elapsed, w0 = performance.now(); await sleep(2000);
    const gt = T.game.elapsed - e0, wall = performance.now() - w0;
    ok(Math.abs(gt - wall) < 60, `游戏时间 ${gt.toFixed(0)}ms / 墙钟 ${wall.toFixed(0)}ms`);
  }

  // ── 停着的时候不空转 ──
  $('pauseBtn').click(); await sleep(300);
  const f1 = T.dbg.frames; await sleep(800);
  ok(T.dbg.frames === f1, `暂停后循环停着（醒了 ${T.dbg.frames - f1} 次）`);
  $('pauseBtn').click();
  T.startPractice(); await sleep(300);
  document.querySelector('#modeSw [data-m="normal"]').click(); await sleep(300);
  const f2 = T.dbg.frames; await sleep(800);
  ok(T.dbg.frames === f2 && !T.game.started, `回到开局面板后循环停着（醒了 ${T.dbg.frames - f2} 次）`);
  return L;
}"""

fails = 0
with sync_playwright() as p:
    for eng in ('chromium', 'webkit'):
        b = getattr(p, eng).launch()
        pg = b.new_page(**p.devices['iPhone 13']); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
        r = pg.evaluate(JS, eng)
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'游戏循环和手感（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
