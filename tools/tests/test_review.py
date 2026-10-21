"""局后复盘：普通局结算页拆开这一局 —— 消行构成、分从哪来、造洞、高处放块，再给 1~3 条建议

盘面手摆：打一次四消、一次单消、盖一个洞，结算后看数对不对；建议规则拿造好的数据直接喂 reviewTips。
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
  const T = __tetris, L = [], R = T.TOTAL_ROWS, $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };
  const load = rows => { for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    rows.forEach((r, i) => { const y = R - rows.length + i; for (let x = 0; x < 10; x++) T.game.board[y][x] = r[x] === '#' ? 'J' : null; }); };
  const give = t => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
  const drop = (t, x, rot) => { give(t); const p = T.game.piece; p.x = x; p.rot = rot; p.y = 0; T.hardDrop(); settle(); };
  const stat = () => $('rvStats').textContent, tips = () => $('rvTips').textContent;
  const play = () => {
    $('startBtn').click(); T.game.noGarbage = true;
    load(['#########.', '#########.', '#########.', '#########.']); drop('I', 7, 1);   // 四消
    load(['###....###']); drop('I', 3, 0);                                            // 单消
    load(['#.########']); drop('O', 0, 0);                                            // O 盖住第 2 列：1 个洞
  };

  play();
  const r = T.game.run;
  ok(r.clr[4] === 1 && r.clr[1] === 1 && r.holes === 1, `记账：四消 ${r.clr[4]}、单消 ${r.clr[1]}、洞 ${r.holes}（应为 1 / 1 / 1）`);
  ok(r.bigLines === 4 && r.smallLines === 1 && r.bigPts > r.smallPts, `分数分两份：四消那份 ${r.bigPts}、1~3 行那份 ${r.smallPts}`);
  T.game.pieces = 150; T.game.elapsed = 120000;
  T.endGame('堆到顶了');
  ok(!$('review').hidden, '普通局结算页出现复盘');
  ok(/四消1 次/.test(stat()) && /单消 \/ 双消 \/ 三消1 \/ 0 \/ 0 次/.test(stat()) && /造洞1 个/.test(stat()), `复盘的数（${stat()}）`);
  ok(/没打出 T 旋/.test(tips()), `150 块一个 T 旋双消都没有：建议练 T 旋（${tips().slice(0, 30)}…）`);
  ok(!/上局/.test(stat()) && T.reviewRead().length === 1, '第一局没有「上局」，这局存下来了');

  play(); T.game.pieces = 150; T.game.elapsed = 120000; T.endGame('堆到顶了');
  ok(/上局/.test(stat()) && T.reviewRead().length === 2, '第二局：每行均分后面带上局的数');

  // ── 建议规则 ──
  const base = { clr: [0, 30, 20, 10, 15], tsc: [0, 0, 0, 0], mini: 0, b2bs: 0, bigPts: 0, bigLines: 60, smallPts: 0, smallLines: 100, holes: 10, highLocks: 30 };
  const names = r => T.reviewTips(Object.assign({}, base, r), 600, 246).map(t => t[0]);
  let n = names({});
  ok(n.includes('消得太碎') && n.includes('没打出 T 旋') && !n.includes('洞造多了') && !n.includes('在高处待太久'),
     `246 行、62% 是 1~3 行消的、没 T 旋：说消得碎 + 练 T 旋（${n.join(' / ')}）`);
  n = names({ holes: 80 });
  ok(n[0] === '洞造多了', `洞多（每 100 块 13 个）排第一（${n.join(' / ')}）`);
  n = names({ highLocks: 200 });
  ok(n.includes('在高处待太久'), `三成多的块在高处放：提醒先保命（${n.join(' / ')}）`);
  n = names({ smallLines: 20, tsc: [0, 0, 20, 0], clr: [0, 5, 5, 0, 10] });
  ok(n.length === 1 && n[0] === '打法对了', `四消 + T 旋为主、洞少：只说打法对了（${n.join(' / ')}）`);
  n = names({ smallLines: 20, tsc: [0, 0, 3, 0], clr: [0, 5, 5, 0, 15] });
  ok(n.includes('T 旋还能多打'), `T 旋双消 3、四消 15：说 T 旋还能多打（${n.join(' / ')}）`);
  ok(T.reviewTips(Object.assign({}, base, { holes: 80, highLocks: 300 }), 600, 246).length <= 3, '建议最多 3 条');

  // ── 复盘写满（3 条建议）时，「再来一局」不用滑就点得到，复盘在它下面 ──
  play();
  Object.assign(T.game.run, { holes: 70, highLocks: 180, smallLines: 185, bigLines: 61 });
  T.game.pieces = 620; T.game.elapsed = 640000; T.game.lines = 246; T.endGame('堆到顶了');
  await new Promise(r => setTimeout(r, 2500));                   // 结算卡等死亡动画走完才弹
  const ab = $('againBtn').getBoundingClientRect(), rv = $('review').getBoundingClientRect();
  ok(ab.height > 0 && ab.top >= 0 && ab.bottom <= innerHeight && rv.top >= ab.bottom && $('rvTips').children.length === 3,
     `三条建议时「再来一局」在屏幕里（${Math.round(ab.top)}~${Math.round(ab.bottom)} / ${innerHeight}），复盘在它下面往下滑看`);

  // ── 提示模式结束不出复盘 ──
  T.startHint(); T.game.pieces = 150; T.endGame('堆到顶了');
  ok($('review').hidden, '提示模式结束：不出复盘');
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
        r = pg.evaluate(JS)
        if eng == 'chromium':
            pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
            c = pg.evaluate("() => !document.getElementById('review')")
            r.append(('PASS ' if c else 'FAIL ') + '疯狂版没有局后复盘')
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'局后复盘（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
