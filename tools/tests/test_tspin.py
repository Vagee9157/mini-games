"""T 旋练习：认得出槽、教得会搭、T 来了真能照路径打出 T 旋双消、放错了说得清

盘面都是按攻略里「标准 TSD 槽」手摆的：底行只空槽口、上一行空三格、一边有屋檐。
T 旋那条不是把块直接摆到终点，是照教练给的那串按键在真盘面上一步步回放（doAct）。
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
  const toast = () => $('toast').textContent;
  // rows：从上往下写，最后一行贴盘底。# 实心 . 空
  const load = rows => { for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    rows.forEach((r, i) => { const y = R - rows.length + i; for (let x = 0; x < 10; x++) T.game.board[y][x] = r[x] === '#' ? 'J' : null; }); };
  const give = (t, next) => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null);
    if (next) T.game.queue[1] = next; T.spawnNext(); };
  // 标准 TSD 槽：槽口第 4 列，屋檐在右（第 5 列第三行）
  const READY = ['.....#####', '###...####', '####.#####'];
  const NOROOF = ['..........', '###...####', '####.#####'];
  const sim = rows => { const b = Array.from({ length: R }, () => new Array(10).fill(false));
    rows.forEach((r, i) => { for (let x = 0; x < 10; x++) b[R - rows.length + i][x] = r[x] === '#'; }); return b; };

  // ── 认槽 ──
  const s1 = T.tsdSlots(sim(READY));
  ok(s1.length === 1 && s1[0].x === 4 && s1[0].roof === 1 && s1[0].ready, `认出搭好的槽（槽口第 ${s1[0] && s1[0].x} 列、屋檐在右）`);
  const mir = READY.map(r => r.split('').reverse().join(''));
  const s2 = T.tsdSlots(sim(mir));
  ok(s2.length === 1 && s2[0].roof === -1 && s2[0].ready, '屋檐在左的也认得出');
  ok(T.tsdSlots(sim(NOROOF)).length === 0, '没屋檐的缺口不算槽（T 直接落进去，不是 T 旋）');
  const half = ['.....#####', '###...####', '####.###.#'];     // 底行除了槽口，还空着第 8 列
  const s3 = T.tsdSlots(sim(half));
  ok(s3.length === 1 && !s3[0].ready && s3[0].miss === 1, `底下那行还差一格：认得出槽，但不算搭好（还差 ${s3[0] && s3[0].miss} 格）`);

  // ── 进模式 ──
  $('startBtn').click();
  const best0 = T.readBest();
  ok(!!$('tsBtn') && !!$('rsModes').querySelector('[data-rs="tspin"]'), '开局面板和重开面板都有「T 旋练习」');
  $('tsBtn').click();
  ok(T.tsOn() && document.body.classList.contains('tspinning') && T.game.noGarbage, '进 T 旋练习：不涨灰线');
  T.drawPreview();
  ok(T.dbg.previews === 3, `NEXT 看 3 块（要看 T 什么时候来；画了 ${T.dbg.previews}）`);
  ok(getComputedStyle($('hintHide')).display === 'none', '没有「先自己找」那个按钮');

  // ── 教搭屋檐：差一块屋檐的盘面，来一个 J ──
  load(NOROOF); give('J', 'O');
  const rec1 = T.tsRec;
  const after1 = T.simPlace(T.simBoard(), rec1.cells).b;
  ok(rec1.kind === 'place' && T.tsdSlots(after1).some(s => s.ready), `差屋檐时推荐的落点把槽搭好了（「${rec1.why}」）`);
  ok(/屋檐|槽/.test(rec1.why), '理由说的是搭槽');
  ok(T.tsdSlots(after1).some(s => s.ready && s.roof < 0), '优先搭左屋檐（手机只有顺时针，左屋檐好转）');
  { const p = T.game.piece; p.rot = rec1.rot; p.x = rec1.x; p.y = 0; T.hardDrop(); settle(); }
  ok(T.tsStats.built === 1 && /槽搭好了/.test(toast()), `照着放：记一次「搭好槽」（「${toast()}」）`);

  // ── T 来了：给路径，照路径真能打出 T 旋双消（屋檐在左：顺时针两下就进）──
  load(mir); give('T');
  const rec2 = T.tsRec;
  ok(rec2.kind === 'tsd' && /变换/.test(rec2.path), `槽好了来 T：给出路径「${rec2.path}」`);
  const pr = a => a.acts.replace(/d/g, '').length;
  const m = T.simReach(T.simBoard(), 'T').filter(l => l.spin === 'tspin' && l.lines === 2).sort((a, b) => pr(a) - pr(b) || a.acts.length - b.acts.length)[0];
  ok(pr(m) <= 3, `路径按键少（除软降外 ${pr(m)} 下：${m.acts.replace(/d+/g, 'd')}）`);
  for (const a of T.parseActs(m.acts)) T.doAct(a);
  const l0 = T.game.lines; T.doAct('H'); settle();
  ok(T.game.lines - l0 === 2 && T.tsStats.tsd === 1 && /T 旋双消/.test(toast()), `照路径回放：T 旋双消、记 1 个（「${toast()}」）`);
  ok(T.game.level === 1, 'T 旋练习不升级');

  // ── 有槽没打 ──
  load(READY); give('T');
  { const p = T.game.piece; p.rot = 0; p.x = 6; p.y = 0; T.hardDrop(); settle(); }
  ok(T.tsStats.miss === 1 && /槽在这/.test(toast()), `有槽却把 T 放别处：说槽在哪（「${toast()}」）`);
  // ── 把槽填了 ──
  load(READY); give('I');
  { const p = T.game.piece; p.rot = 1; const xs = T.cellsOf('I', 1).map(c => c[0]); p.x = 4 - xs[0]; p.y = 0; T.hardDrop(); settle(); }
  ok(T.tsStats.filled === 1 && /填了/.test(toast()), `别的块塞进槽：提醒「${toast()}」`);
  // ── 没槽来了 T：先暂存 ──
  load(['..........', '##########'.replace(/#$/, '.')]); T.game.hold = null; give('T');
  ok(T.tsRec.kind === 'hold', `没槽时来了 T：建议「${T.tsRec.why}」`);
  T.hardDrop(); settle();
  ok(T.tsStats.waste === 1 && /暂存/.test(toast()), '没槽还把 T 用掉：提醒先暂存');
  // 暂存能用；槽好了暂存里有 T：建议换出来
  load(READY); T.game.hold = 'T'; T.game.holdUsed = false; give('S');
  ok(T.tsRec.kind === 'hold' && /换出来/.test(T.tsRec.why), `槽好了、暂存里是 T：建议「${T.tsRec.why}」`);
  T.holdPiece();
  ok(T.game.piece && T.game.piece.type === 'T' && T.tsRec.kind === 'tsd', '点暂存把 T 换出来：马上给 T 旋路径');

  // ── 要领卡 ──
  T.openHintSheet();
  const body = $('hintRulesBody').textContent;
  ok(/屋檐/.test(body) && /暂存/.test(body) && /T 旋双消/.test(body) && $('hintHideSw').hidden, '规则卡换成 T 旋要领 + 这一局统计');
  ok($('hintSheetTitle').textContent === 'T 旋要领' && $('hintSheetIntro').hidden, `标题也换了（「${$('hintSheetTitle').textContent}」），堆叠的介绍收起来`);
  T.closeHintSheet();

  // ── 隔离 / 切换 ──
  ok(T.readBest() === best0, '不写最高分');
  $('modeSw').querySelector('[data-m="hint"]').click();
  ok(T.hintMode && !T.tsOn() && T.hintKind === 'stack' && !document.body.classList.contains('tspinning'), '顶栏点「提示」：切回堆叠提示');
  T.openHintSheet();
  ok(/留井四消/.test($('hintSheetTitle').textContent) && !$('hintSheetIntro').hidden, '回到堆叠提示：规则卡标题和介绍换回来');
  T.closeHintSheet();
  $('modeSw').querySelector('[data-m="normal"]').click();
  ok(!T.hintMode && !T.tsOn(), '点「普通」退出');

  // ── 性能：出块时算建议要多久 ──
  T.startTspin();
  const ts = { T: [], other: [] };
  for (let i = 0; i < 60; i++){
    load(i % 2 ? READY : ['....######', '###...####', '####.#####']);
    const t = i % 3 === 0 ? 'T' : 'JLSZOI'[i % 6];
    const s0 = performance.now(); give(t); (t === 'T' ? ts.T : ts.other).push(performance.now() - s0);
  }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  ok(med(ts.T) < 12 && med(ts.other) < 12, `出块算建议：T 中位 ${med(ts.T).toFixed(1)}ms、最慢 ${Math.max(...ts.T).toFixed(1)}；其它块中位 ${med(ts.other).toFixed(1)}ms`);

  // ── 速度：要领卡里选慢 / 中 / 快，当场换、不涨级、重开后还记得 ──
  T.startTspin();
  ok(T.game.level === 1 && T.tsSpeed === 1 && $('modeTag').textContent === 'T 旋练习 · 慢', `默认慢速 1 级（标签「${$('modeTag').textContent}」）`);
  $('hintRules').click();
  const sb = [...document.querySelectorAll('#hintRulesBody [data-tsv]')];
  ok(sb.length === 3 && sb[0].classList.contains('on'), '要领卡里有三档速度，慢速亮着');
  sb[2].click();
  ok(T.game.level === 20 && $('modeTag').textContent === 'T 旋练习 · 快'
     && document.querySelector('#hintRulesBody [data-tsv="20"]').classList.contains('on'), '点「快」：当场变 20 级，标签和按钮跟着变');
  T.closeHintSheet && T.closeHintSheet();
  T.game.lines = 199;                  // 普通局这时候一消行就该升级
  const ln0 = T.game.lines;
  load(['###....###']); give('I'); T.game.piece.x = 3; T.game.piece.rot = 0; T.hardDrop(); settle();
  ok(T.game.lines > ln0 && T.game.level === 20, `消行后不涨级（消了 ${T.game.lines - ln0} 行，${T.game.level} 级）`);
  T.startTspin();
  ok(T.game.level === 20 && localStorage.getItem(T.TS_SPEED_KEY) === '20', '重开 T 旋练习还是快速，选择存下来了（刷新也记得）');
  T.startHint();
  ok(T.game.level === 1, '切回堆叠提示：从 1 级开始，不受 T 旋速度影响');
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
    c = pg.evaluate("() => !document.getElementById('tsBtn')")
    r.append(('PASS ' if c else 'FAIL ') + '疯狂版没有 T 旋练习入口')
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    print('T 旋练习')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
