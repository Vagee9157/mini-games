"""局后复盘：普通局结算页拆开这一局 —— 消行构成、分从哪来、造洞、高处放块，再给 1~3 条建议

盘面手摆：打一次四消、一次单消、盖一个洞，结算后看数对不对；建议规则拿造好的数据直接喂 reviewTips。
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
  ok(tips().length > 0 && !/T 旋/.test(tips()), `有建议、不再劝 T 旋（${tips().slice(0, 30)}…）`);
  ok(!/上局/.test(stat()) && T.histRead().length === 1, '第一局没有「上局」，这局存下来了');

  play(); T.game.pieces = 150; T.game.elapsed = 120000; T.endGame('堆到顶了');
  ok(/上局/.test(stat()) && T.histRead().length === 2, '第二局：每行均分后面带上局的数');

  // ── 建议规则（留井四消口径，阈值按机器人模拟：高处放块 / 四消占比 / 放偏 / I 用掉 / 洞 / 按键 / 手速） ──
  const base = { clr: [0, 30, 20, 10, 30], tsc: [0, 0, 0, 0], mini: 0, b2bs: 0, bigPts: 0, bigLines: 120, smallPts: 0, smallLines: 100,
                 holes: 30, highLocks: 60, cN: 0, cGood: 0, cRule: [0, 0, 0, 0, 0, 0], iN: 0, iTet: 0, iWaste: 0, iOther: 0, iHold: 0 };
  const names = (r, ctx) => T.reviewTips(Object.assign({}, base, r), 600, 246, ctx).map(t => t[0]);
  let n = names({});
  ok(n.length === 1 && n[0] === '打法对了', `四消占一半、洞少不高：打法对了（${n.join(' / ')}）`);
  n = names({ clr: [0, 120, 40, 20, 4] });
  ok(n.includes('四消打得少') && !n.some(t => /T 旋/.test(t)), `246 行里只有 4 次四消：提四消打得少，不再提 T 旋（${n.join(' / ')}）`);
  n = names({ highLocks: 200 });
  ok(n[0] === '在高处待太久', `三成多的块在高处放：排第一（${n.join(' / ')}）`);
  ok(!names({ highLocks: 120 }).includes('在高处待太久'), '两成在高处：不提（照教练打也有一成多）');
  n = names({ holes: 160 });
  ok(n.includes('洞造多了'), `每 100 块 27 个洞：提洞（${n.join(' / ')}）`);
  ok(!names({ holes: 100 }).includes('洞造多了'), '每 100 块 17 个洞：不提（照教练打也有十几个）');
  const big = T.reviewTips(Object.assign({}, base, { cN: 300, cGood: 150, cRule: [0, 10, 80, 5, 5, 0] }), 600, 246).find(t => t[0] === '放偏的块多');
  ok(!!big && /③「井只给 I」/.test(big[1]), `后台教练：只有一半放对、最常犯 ③：提出来（${big && big[1].slice(0, 40)}…）`);
  n = names({ iN: 40, iWaste: 20, iTet: 10, iOther: 10 });
  ok(n.includes('I 用掉了'), `40 个 I 里 20 个井不够深就放掉：提 I 用掉了（${n.join(' / ')}）`);
  n = names({}, { pps: .8, ppsAvg: 1, ppsN: 10 });
  ok(n.includes('比平时慢'), `每秒 0.8 块、平时 1.0：说比平时慢（${n.join(' / ')}）`);
  ok(!T.reviewTips(Object.assign({}, base, { smallLines: 500, bigLines: 10 }), 600, 246).some(t => t[0] === '消得太碎'), '没有「消得太碎」');
  ok(T.reviewTips(Object.assign({}, base, { holes: 300, highLocks: 300, cN: 300, cGood: 10, cRule: [100, 0, 0, 0, 0, 0], iN: 40, iWaste: 30, clr: [0, 200, 0, 0, 0] }), 600, 246, { pps: .5, ppsAvg: 1, ppsN: 5 }).length <= 3, '建议最多 3 条');

  // ── 复盘写满（3 条建议）时，「再来一局」不用滑就点得到，复盘在它下面 ──
  play();
  Object.assign(T.game.run, { holes: 200, highLocks: 220, smallLines: 185, bigLines: 61 });   // 高处 35% + 四消少 + 洞多 = 三条
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
