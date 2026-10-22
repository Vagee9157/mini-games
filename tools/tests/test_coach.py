"""后台教练（普通局悄悄跑推荐，局后复盘报放对几成 / 最常犯哪条 / 损失最大的几手 / T 块去向）、
教练说明不再说「井」、第十列也算堆高、T 旋练习的灰线开关"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H)
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async () => {
  const T = __tetris, L = [], R = T.TOTAL_ROWS, $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };
  const load = rows => { for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    rows.forEach((r, i) => { for (let x = 0; x < 10; x++) T.game.board[R - rows.length + i][x] = r[x] === '#' ? 'J' : null; }); };
  const give = (t, next) => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); if (next) T.game.queue[1] = next; T.spawnNext(); };
  const place = (x, rot) => { const p = T.game.piece; p.rot = rot; p.x = x; p.y = 0; T.hardDrop(); settle(); };
  localStorage.removeItem(T.HIST_KEY);
  $('startBtn').click(); T.game.noGarbage = true;
  const r = T.game.run;

  // ── 放对 / 放偏 ──
  load(['##.....###', '##.....###']); give('O', 'O');
  const rec = T.coachRec(T.simBoard(), 'O', 'O', null, false);
  place(rec.x, rec.rot);
  ok(r.cN === 1 && r.cGood === 1, `照教练放：算放对（${r.cGood}/${r.cN}）`);
  load(['#.########', '#.########']); give('O', 'I');
  place(0, 0);                                              // 盖住第 2 列的缺口：造洞
  ok(r.cN === 2 && r.cGood === 1 && r.cRule[0] === 1 && r.cWorst.length === 1 && r.cWorst[0].rows.length > 0,
     `盖洞那一手：算放偏、记 ①、存进损失最大的几手（${JSON.stringify(r.cRule)}）`);

  // ── T 块去向 ──
  const SLOT = ['.....#####', '###...####', '####.#####'];
  load(SLOT); give('T', 'O'); place(6, 0);
  ok(r.tN === 1 && r.tMiss === 1, `有槽却把 T 放别处：记「有槽没打」（${r.tMiss}）`);
  load(SLOT); give('T', 'O');
  const m = T.simReach(T.simBoard(), 'T').find(l => l.spin === 'tspin' && l.lines === 2);
  for (const a of T.parseActs(m.acts)) T.doAct(a); T.doAct('H'); settle();
  ok(r.tTsd === 1, `照路径打 T 旋双消：记上（${r.tTsd}）`);
  load(['..........', '#####.####']); give('T', 'O'); T.holdPiece(); settle();
  ok(r.tHold === 1, `没槽把 T 放进暂存：记上（${r.tHold}）`);
  load(['..........', '#####.####']); T.game.hold = 'T'; give('T', 'O'); place(0, 0);       // 暂存里已经是 T：这个 T 没法再暂存
  ok(r.tOther >= 1 && r.tFlat === 0, `没槽、这手也没法暂存：记「没法暂存」，不算「能暂存却放掉」（${r.tOther}）`);
  load(['..........', '#####.####']); T.game.hold = null; give('T', 'O'); place(0, 0);
  ok(r.tFlat === 1, `没槽、暂存空着却直接放掉：记「能暂存却放掉」（${r.tFlat}）`);

  // ── 第十列也算堆高 ──
  const tall = Array.from({ length: R }, (_, y) => Array.from({ length: 10 }, (_, x) => x === 9 ? y >= R - 16 : y >= R - 2));
  ok(T.coachRec(tall, 'O', 'O', null, false).danger, '只有最右一列堆到 16 行：教练也知道该保命（原来第十列不算）');

  // ── 复盘里有这几样 ──
  T.game.pieces = 150; T.game.elapsed = 150000;
  r.cN = 120; r.cGood = 60; r.cRule = [5, 40, 10, 5];
  T.endGame('堆到顶了');
  const st = $('rvStats').textContent;
  ok(/跟教练比放对 50% · 最常犯 ②表面要平/.test(st), `复盘：跟教练比（${(st.match(/跟教练比[^T]*/) || [''])[0]}）`);
  ok(/T 块去向\d+ 个 T：T 旋双消 1 · 有槽没打 1 · 能暂存却放掉 1 · 没法暂存 \d+（进过暂存 1 次）/.test(st), `T 块去向一行（${(st.match(/T 块去向[^每]*/) || [''])[0]}）`);
  const cv = $('rvWorstList').querySelector('canvas');
  ok(!$('rvWorst').hidden && cv && cv.width > 0, '损失最大的几手：画出小盘面');
  ok(/放偏的块多/.test($('rvTips').textContent), '建议里提「放偏的块多」');

  // ── 后台教练不能拖慢出块：照教练打 100 块，量每次出块（含后台推荐）的耗时 ──
  $('againBtn').click(); T.game.noGarbage = true;
  const ts = [];
  for (let i = 0; i < 100 && !T.game.over; i++){
    const t0 = performance.now(); T.game.piece = null; T.spawnNext(); ts.push(performance.now() - t0);
    const rc = T.coachRec(T.simBoard(), T.game.piece.type, null, T.game.hold, T.game.holdUsed);
    if (rc && rc.cells){ const p = T.game.piece; p.rot = rc.rot; p.x = rc.x; p.y = 0; }
    T.hardDrop(); settle();
  }
  ts.sort((a, b) => a - b);
  ok(ts[ts.length >> 1] < 4 && ts[ts.length - 1] < 16, `出块含后台推荐：中位 ${ts[ts.length >> 1].toFixed(1)}ms、最慢 ${ts[ts.length - 1].toFixed(1)}ms（一帧 16ms 以内）`);

  // ── 第二轮检查查出的几条 ──
  // 暂存换出来的块：教练知道这一手已经暂存过，不会再推荐「先暂存」
  $('againBtn').click(); T.game.noGarbage = true;
  load(['..........', '#####.####']); T.game.hold = null; give('O', 'T'); T.holdPiece();
  ok(T.game.piece.type === 'T' && T.shadow && T.shadow.rec.kind !== 'hold', `暂存 O 换出 T：后台推荐不再是「先暂存」（${T.shadow && T.shadow.rec.kind}）`);
  // 方块下落途中灰线涨一行：照（新盘面的）推荐放，不算放偏、不记洞
  load(['##.....###', '##.....###']); give('O', 'O');
  const c0 = T.game.run.cGood, n0 = T.game.run.cN, h0 = T.game.run.holes;
  T.riseGarbage();
  { const rc2 = T.coachRec(T.simBoard(), 'O', null, T.game.hold, T.game.holdUsed); place(rc2.x, rc2.rot); }
  ok(T.game.run.cN === n0 + 1 && T.game.run.cGood === c0 + 1 && T.game.run.holes === h0, `下落途中涨了一行灰线：照推荐放算放对、不记洞（洞 ${h0} → ${T.game.run.holes}）`);
  // 照提示模式那套（带 NEXT 看一块）的推荐打 120 块：后台判的放对率要对得上，T 块去向四类加起来 = T 总数
  $('againBtn').click(); T.game.noGarbage = true;
  for (let i = 0; i < 120 && !T.game.over; i++){
    const rc3 = T.coachRec(T.simBoard(), T.game.piece.type, T.game.queue[0], T.game.hold, T.game.holdUsed);
    if (rc3 && rc3.kind === 'hold'){ T.holdPiece(); continue; }
    if (rc3 && rc3.kind === 'tsd'){
      const mm = T.simReach(T.simBoard(), 'T').find(l => l.spin === 'tspin' && l.lines === 2);
      if (mm){ for (const a of T.parseActs(mm.acts)) T.doAct(a); T.doAct('H'); settle(); continue; }
    }
    if (rc3 && rc3.cells){ const p = T.game.piece; p.rot = rc3.rot; p.x = rc3.x; p.y = 0; }
    T.hardDrop(); settle();
  }
  const R3 = T.game.run;
  ok(R3.cN >= 100 && R3.cGood / R3.cN >= .95, `照提示模式的推荐打：后台判放对 ${Math.round(R3.cGood / R3.cN * 100)}%（${R3.cGood}/${R3.cN}）`);
  ok(R3.tTsd + R3.tMiss + R3.tFlat + R3.tOther === R3.tN && R3.tFlat === 0,
     `T 块去向加起来 = T 总数（${R3.tTsd}+${R3.tMiss}+${R3.tFlat}+${R3.tOther} = ${R3.tN}），照教练打不会被说「能暂存却放掉」`);
  // 续玩时带着当前块：后台教练的快照照拍
  T.saveGame(true); T.restoreGame(T.readSave());
  ok(!!T.shadow, '续玩带着当前块：后台教练的快照拍上了');
  // T 旋练习关着灰线练了一阵再打开：不会一下涨好几行
  T.startTspin(); T.step(60000);
  const g0 = T.game.garbage; T.setTsGarbage(true); T.step(500);
  ok(T.garbageTimer < 1000 && T.game.garbage - g0 <= 1, `关着灰线练了 60 秒再打开：没有一下涨好几行（涨了 ${T.game.garbage - g0}）`);
  T.setTsGarbage(false);
  // 提示局结束再退回开局：gameover 标记摘掉
  T.startHint(); T.endGame('堆到顶了'); T.exitPractice();
  ok(!document.body.classList.contains('gameover'), '提示局结束后退回开局：gameover 标记摘掉');

  // ── 提示模式里不跑后台教练（它自己有教练） ──
  T.startHint(); load([]); give('O', 'O'); place(0, 0);
  ok(T.game.run.cN === 0, '提示模式：后台教练不计');

  // ── 教练说明不再说「井」：照推荐打 150 块，收集每块的理由 ──
  const whys = [];
  T.game.noGarbage = true;
  for (let i = 0; i < 150 && !T.game.over; i++){
    const rc = T.tsRec;
    if (rc && rc.why) whys.push(rc.why);
    if (rc && rc.kind === 'hold'){ T.holdPiece(); settle(); continue; }
    if (rc && rc.cells){ const p = T.game.piece; p.rot = rc.rot; p.x = rc.x; p.y = 0; }
    T.hardDrop(); settle();
  }
  const well = whys.filter(w => /井/.test(w));
  ok(whys.length >= 100 && !well.length, `照教练打 ${whys.length} 块：理由里没有「井」${well.length ? '；有：' + well.slice(0, 3).join(' | ') : ''}`);

  // ── T 旋练习的灰线开关 ──
  T.startTspin();
  ok(T.game.noGarbage && !T.tsGarbage, 'T 旋练习默认不涨灰线');
  $('hintRules').click(); await wait(50);
  const gb = document.querySelector('#hintRulesBody [data-tsg="1"]');
  ok(!!gb, '要领卡里有灰线开关'); gb.click();
  ok(!T.game.noGarbage && /灰线/.test($('modeTag').textContent), `打开灰线：当场开始涨，角标「${$('modeTag').textContent}」`);
  T.closeHintSheet(); T.startTspin();
  ok(!T.game.noGarbage, '重开 T 旋练习还开着灰线'); T.setTsGarbage(false);
  return L;
}"""

fails = 0
with sync_playwright() as p:
    for eng in ('chromium', 'webkit'):
        b = getattr(p, eng).launch()
        pg = b.new_page(**p.devices['iPhone 13']); errs = []
        pg.set_default_timeout(120000)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
        r = pg.evaluate(JS)
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'后台教练（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
