"""每日练习：四消热身题可解、四段流程、计数口径、按天存档、隔离

热身题（四消热身）：底下 4 行左边九列快满、井空着，第 4 行留一个正好是这题那块底面的缺口 ——
先补平、再把 I 竖进井打四消。出题用 simDrops 验过「从顶上直接落得进去」。
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
  const $ = id => document.getElementById(id);
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && !T.game.frozen && g++ < 400) T.step(16); };
  const tsd = () => T.simReach(T.simBoard(), 'T').find(l => l.spin === 'tspin' && l.lines === 2);
  const play = acts => { for (const a of T.parseActs(acts + 'H')) T.doAct(a); };

  // ── 出题：200 道，道道可解（补平后井够 4 行、I 进井四消）、补之前不够、不重样 ──
  const R = T.TOTAL_ROWS, toB = pz => { const b = Array.from({ length: R }, () => new Array(10).fill(false));
    pz.rows.forEach((r, k) => { for (let x = 0; x < 10; x++) b[R - pz.rows.length + k][x] = r[x] === '#'; }); return b; };
  const seen = new Set(); let bad = 0, pre = 0; const types = new Set();
  for (let i = 0; i < 200; i++){
    const pz = T.drillGenTetris();
    if (!pz){ bad++; continue; }
    seen.add(pz.rows.join('/')); types.add(pz.X);
    const b = toB(pz);
    if (T.wellDepth(b) >= 4) pre++;
    const good = T.simDrops(b, pz.X).find(d => T.wellDepth(T.simPlace(b, d.cells).b) >= 4);
    if (!good){ bad++; continue; }
    const b2 = T.simPlace(b, good.cells).b;
    if (!T.simDrops(b2, 'I').some(d => d.cells.every(c => c[0] === 9) && T.simPlace(b2, d.cells).lines === 4)) bad++;
  }
  ok(bad === 0, `200 道题都能「补平 → I 进井四消」（不行的 ${bad}）`);
  ok(pre === 0, `补之前井都不够 4 行，得先补（${pre}）`);
  ok(seen.size >= 150 && types.size === 6, `200 道里不重样的 ${seen.size} 道，六种块都出（${[...types].join('')}）`);

  // ── 先开一局普通局 —— 练完要能接着玩、纪录不能动 ──
  localStorage.removeItem(T.DRILL_KEY);
  $('startBtn').click(); T.game.noGarbage = true;
  for (let i = 0; i < 4; i++){ T.hardDrop(); settle(); }
  const best0 = T.readBest(), nScore = T.game.score;

  // ── 入口 ──
  ok(!!$('dailyBtn') && !!$('prDaily'), '开局面板和练习面板都有「每日练习」入口');
  $('modeSw').querySelector('[data-m="practice"]').click();
  $('prDaily').click();
  ok(!!T.drill && !$('drSheet').hidden && T.game.frozen, '点进去先停在面板上');
  ok(document.body.classList.contains('drilling'), 'body 挂上 drilling');
  ok($('modeSw').querySelector('[data-m="practice"]').classList.contains('on'), '顶栏高亮在「练习」');
  ok(/热身/.test($('drGo').textContent), `按钮写着下一段（「${$('drGo').textContent}」）`);
  ok(!!T.readSave() && T.readSave().score === nScore, '普通局打到一半进来，存档留着');

  // ── ① 四消热身 ──
  $('drGo').click();
  ok(T.drill.stage === 'warm' && $('drSheet').hidden && !T.game.frozen, '开始热身');
  ok(T.game.piece && T.game.piece.type === T.drill.puz.X && T.game.queue[0] === 'I', `先出补缺口的 ${T.drill.puz.X}，下一块是 I`);
  ok(/先补平/.test($('drLabel').textContent), `细栏写「${$('drLabel').textContent}」`);
  T.holdPiece();
  ok(T.game.hold === null, '热身不能暂存');
  // 第一题故意失手：放到补不平的位置
  const rows0 = JSON.stringify(T.game.board);
  { const b = T.simBoard(), p = T.game.piece;
    const wrong = T.simDrops(b, p.type).find(d => T.wellDepth(T.simPlace(b, d.cells).b) < 4);
    p.rot = wrong.rot; p.x = wrong.x; p.y = 0; T.hardDrop(); }
  ok(T.drill.tries === 1 && T.game.frozen, '没补平：记一次，先停一下');
  await sleep(1000);
  ok(JSON.stringify(T.game.board) === rows0 && T.game.piece.type === T.drill.puz.X, '同一题重摆');
  for (let i = 0; i < T.DRILL_WARM_N; i++){
    await sleep(60);                  // 让计时走一点
    let b = T.simBoard(), p = T.game.piece;
    const fill = T.simDrops(b, p.type).find(d => T.wellDepth(T.simPlace(b, d.cells).b) >= 4);
    p.rot = fill.rot; p.x = fill.x; p.y = 0; T.hardDrop(); settle();
    ok(T.game.piece && T.game.piece.type === 'I' && /I 进井/.test($('drLabel').textContent), `第 ${i + 1} 题补平了，轮到 I`);
    b = T.simBoard(); p = T.game.piece;
    const tet = T.simDrops(b, 'I').find(d => d.cells.every(c => c[0] === 9));
    p.rot = tet.rot; p.x = tet.x; p.y = 0; T.hardDrop();
    ok(i === T.DRILL_WARM_N - 1 || (T.drill.wi === i + 1), `第 ${i + 1} 题 I 进井打出四消`);
    await sleep(1100);
  }
  const w = T.drill && T.drill.done.warm;
  ok(!!w && w.first === T.DRILL_WARM_N - 1 && w.n === T.DRILL_WARM_N, `热身成绩：一次过 ${w && w.first}/${w && w.n}（第一题失手过一次）`);
  ok(!!w && w.ms > 0, `计时有走（${w && w.ms}ms）`);
  ok(!$('drSheet').hidden && /堆叠/.test($('drGo').textContent), '热身完回面板，下一段是堆叠');

  // ── ② 堆叠 ──
  $('drGo').click();
  ok(T.hintMode && T.drill.stage === 'stack', '堆叠段借用提示模式');
  ok(getComputedStyle($('hintBar')).display === 'none' && getComputedStyle($('drBar')).display !== 'none',
     '只挂每日练习那一条细栏，提示细栏收起');
  ok(T.hintHidden() && /^先自己找：[IOTSZJL] /.test($('drLabel').textContent),
     `推荐藏着，细栏只说这块的定式（「${$('drLabel').textContent}」）`);
  ok(T.hintMove && !T.hintReveal, '出块时不亮推荐');
  // 推荐有三种：落点 / 暂存 / T 旋路径（提示模式现在用教练那套），三种都照做
  const prs = a => a.acts.replace(/d/g, '').length;
  for (let i = 0; i < T.DRILL_STACK_N * 2 && T.drill && T.drill.stage === 'stack' && T.game.pieces < T.DRILL_STACK_N; i++){
    const rec = T.tsRec, p = T.game.piece;
    if (!rec || !p) break;
    if (rec.kind === 'hold'){ T.holdPiece(); continue; }
    if (rec.kind === 'tsd'){
      const m = T.simReach(T.simBoard(), 'T').filter(l => l.spin === 'tspin' && l.lines === 2).sort((a, c) => prs(a) - prs(c) || a.acts.length - c.acts.length)[0];
      for (const a of T.parseActs(m.acts)) T.doAct(a); T.doAct('H'); settle(); continue;
    }
    p.rot = rec.rot; p.x = rec.x; p.y = 0;
    T.hardDrop(); settle();
  }
  ok(T.game.level === 1, `堆叠段不升级（${T.game.lines} 行仍是 ${T.game.level} 级）`);
  await sleep(800);
  const st = T.drill && T.drill.done.stack;
  ok(!!st && st.total === T.DRILL_STACK_N && st.same === T.DRILL_STACK_N
     && st.rules.every(v => v === 0) && !st.dead,
     `照推荐放 100 块：放对 ${st && st.same}/${st && st.total}、规则一条没犯（${st && st.rules}）、洞 ${st && st.holes}`);
  ok(!T.hintMode && !document.body.classList.contains('hinting'), '堆叠完退出提示模式');

  // ── ③ 挖灰线 ──
  ok(/挖灰线/.test($('drGo').textContent), `堆叠完下一段是挖灰线（「${$('drGo').textContent}」）`);
  $('drGo').click();
  { const R = T.TOTAL_ROWS, rows = [];
    for (let i = 0; i < T.DRILL_DIG_ROWS; i++){ const row = T.game.board[R - 1 - i]; rows.push(row.map(c => c ? 1 : 0).join('')); }
    const holes = rows.map(r => r.indexOf('0'));
    ok(T.drill.stage === 'dig' && T.drill.clock && rows.every(r => r.split('0').length === 2)
       && holes.every((h, i) => i === 0 || h !== holes[i - 1]),
       `底下垫了 ${T.DRILL_DIG_ROWS} 行灰线，每行一个缺口、相邻两行不在同一列（缺口列 ${holes.join(',')}）`);
    ok(T.game.level === 10 && /还剩 8 行/.test($('drLabel').textContent), `10 级速度，细栏写着还剩几行（「${$('drLabel').textContent}」）`);
    // 挖到只剩最后一行（缺口在最右），竖 I 插进去挖光
    for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    for (let x = 0; x < 9; x++) T.game.board[R - 1][x] = 'X';
    T.game.piece = null; T.game.queue.unshift('I'); T.game.mods.unshift(null); T.spawnNext();
    const p = T.game.piece; p.rot = 1; p.x = 7; p.y = 0;
    await sleep(120); T.hardDrop(); settle();
  }
  await sleep(900);
  const dg = T.drill && T.drill.done.dig;
  ok(!!dg && dg.done && dg.ms > 0 && dg.pieces === 1, `挖光：记下用时 ${dg && T.fmtMs(dg.ms)}、用了 ${dg && dg.pieces} 块`);
  ok(/冲刺/.test($('drGo').textContent), '挖完下一段是冲刺');

  // ── ④ 冲刺：按键计数和多余按键 ──
  $('drGo').click();
  ok(T.drill.stage === 'sprint' && T.drill.clock, '冲刺开始计时');
  for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
  const ev = (id, t) => $(id).dispatchEvent(new MouseEvent(t, { bubbles: true }));
  const tap = id => { ev(id, 'mousedown'); ev(id, 'mouseup'); };
  // 干净的一块：直接落底 = 1 键，最少也是 1 键
  T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext();
  await sleep(200); tap('btnDrop'); settle();
  ok(T.drill.keys === 1 && T.drill.faults === 0, `直接落底：1 键、不算多余（${T.drill.keys} 键 / 多余 ${T.drill.faults}）`);
  // 绕一下：右、左、落底 = 3 键，同一个落点最少 1 键 → 多余一次
  T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext();
  await sleep(200); tap('btnRight'); tap('btnLeft'); tap('btnDrop'); settle();
  ok(T.drill.keys === 4 && T.drill.faults === 1, `右左落底：累计 4 键、多余 1（${T.drill.keys} / ${T.drill.faults}）`);
  // 转四下回原样再落：多余
  T.game.piece = null; T.game.queue.unshift('T'); T.game.mods.unshift(null); T.spawnNext();
  await sleep(200); for (let i = 0; i < 4; i++) tap('btnCw'); tap('btnDrop'); settle();
  ok(T.drill.faults === 2, `转一圈再落：多余 +1（${T.drill.faults}）`);
  // 最少按法：J 竖着靠左墙 = 转一下 + 按住左（一次）+ 落底；用 3 键不算多余
  T.game.piece = null; T.game.queue.unshift('J'); T.game.mods.unshift(null); T.spawnNext();
  await sleep(200);
  tap('btnCw'); ev('btnLeft', 'mousedown'); await sleep(600); ev('btnLeft', 'mouseup'); tap('btnDrop'); settle();
  ok(T.drill.faults === 2, `转一下 + 按住左到墙 + 落底：不算多余（${T.drill.faults}）`);
  // 连点落底被挡掉的那下不数
  const k0 = T.drill.keys;
  T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext();
  await sleep(200); tap('btnDrop'); await sleep(40); tap('btnDrop'); settle();
  ok(T.drill.keys === k0 + 1, `连点落底只数 1 键（+${T.drill.keys - k0}）`);
  // 打到 40 行收尾（行数直接拨到线上，靠下一块锁定触发）
  T.game.lines = T.DRILL_SPRINT_LINES;
  await sleep(250); tap('btnDrop'); settle();
  ok(T.game.level === 1, '冲刺段不升级');
  await sleep(900);
  const sp = T.drill && T.drill.done.sprint;
  ok(!!sp && sp.done && sp.ms > 0 && sp.pieces === 6, `冲刺成绩：${sp && T.fmtMs(sp.ms)}、${sp && sp.pieces} 块、${sp && sp.keys} 键、多余 ${sp && sp.faults}`);
  ok(/练完了/.test($('drGo').textContent) && $('drSkip').disabled, '四段都完：按钮变「练完了」');

  // ── 存档 ──
  const all = T.drillReadAll(), today = all.days[T.bjDay()];
  ok(!!today && !!today.warm && !!today.stack && !!today.dig && !!today.sprint, '今天四项都存下来了');
  ok($('drBody').querySelector('.dr-hist') && /\d+\/\d+/.test($('drBody').querySelector('.dr-hist').textContent), '面板里有最近几天的表');
  // 同一天再来一次更差的：留最好的
  T.drillSave('sprint', { done: true, ms: sp.ms + 5000, lines: 40, pieces: 6, keys: 9, faults: 3 });
  ok(T.drillReadAll().days[T.bjDay()].sprint.ms === sp.ms, '同一天更慢的那次不覆盖');
  T.drillSave('sprint', { done: true, ms: Math.max(1, sp.ms - 1), lines: 40, pieces: 6, keys: 9, faults: 3 });
  ok(T.drillReadAll().days[T.bjDay()].sprint.ms === Math.max(1, sp.ms - 1), '更快的那次覆盖');

  // ── 隔离 ──
  ok(T.readBest() === best0, '每日练习不写最高分');
  ok(!!T.readSave() && T.readSave().score === nScore, '练完普通局存档还在');
  $('drGo').click();
  ok(!T.drill && !document.body.classList.contains('drilling') && $('overlay').classList.contains('show'),
     '练完点按钮回开局面板');
  ok(document.getElementById('overlay').classList.contains('has-save'), '「接着上次玩」还在');

  // ── 跟上次比 ──
  const d = JSON.parse(localStorage.getItem(T.DRILL_KEY));
  d.days['2000-01-01'] = { sprint: { done: true, ms: 999999, lines: 40, pieces: 100, keys: 300, faults: 20 },
                           stack: { same: 10, total: 100, holes: 9, dead: false }, warm: { first: 0, n: 5, ms: 90000 } };
  localStorage.setItem(T.DRILL_KEY, JSON.stringify(d));
  T.startDrill();
  T.drillSave('sprint', T.drillReadAll().days[T.bjDay()].sprint);
  T.drill.done.sprint = T.drillReadAll().days[T.bjDay()].sprint;
  T.drill.done.stack = T.drillReadAll().days[T.bjDay()].stack;
  T.drillSkip();      // 让面板重画
  const txt = $('drBody').textContent;
  ok(/比 01\/01 快/.test(txt) && /放对比 01\/01 \+/.test(txt), `和上次比的那句（${(txt.match(/比 01\/01[^·]*?秒/) || [''])[0]}）`);
  // 坏数据不炸
  localStorage.setItem(T.DRILL_KEY, '{"days":{"<img>":{"sprint":1}}}');
  let threw = false; try { T.drillSkip(); T.startDrill(); } catch { threw = true; }
  ok(!threw && !$('drBody').innerHTML.includes('<img'), '存档里的脏键不进页面、不报错');

  // ── 切模式 ──
  $('modeSw').querySelector('[data-m="hint"]').click();
  ok(!T.drill && T.hintMode && $('drSheet').hidden && !T.game.frozen, '每日练习里点「提示」：直接切过去');
  T.startDrill(); $('drGo').click();
  $('modeSw').querySelector('[data-m="normal"]').click();
  ok(!T.drill && !T.hintMode && !T.game.started, '点「普通」：回开局面板');
  T.startDrill(); $('drGo').click();
  T.drill.ms = 5000; $('restartBtn').click();
  ok(/这一段重来/.test($('rsAgain').textContent), `重开面板的主按钮写着「${$('rsAgain').textContent}」`);
  $('rsAgain').click();
  ok(T.drill.stage === 'warm' && T.drill.ms === 0, '顶栏「重开」→「这一段重来」');
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
    print('每日练习')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    # 最矮的 SE：7 天的表撑满之后，主按钮仍在屏幕里（钉在面板底边）
    for w, h in [(320, 568), (375, 667)]:
        d = dict(p.devices['iPhone 13']); d['viewport'] = {'width': w, 'height': h}
        q = b.new_page(**d); q.route("**fonts.googleapis.com/**", lambda r: r.abort())
        q.goto(f"http://127.0.0.1:{port}/tetris/index.html"); q.wait_for_function("() => !!window.__tetris")
        q.evaluate("""() => { const T = __tetris, days = {};
          for (let i = 1; i <= 7; i++){ const k = new Date(Date.now() + 8*3600e3 - i*864e5).toISOString().slice(0,10);
            days[k] = { warm:{first:2,n:5,ms:50000}, stack:{same:60,total:100,holes:4}, sprint:{done:true,ms:180000,lines:40,pieces:100,keys:330,faults:15} }; }
          localStorage.setItem(T.DRILL_KEY, JSON.stringify({ v:1, days })); T.startDrill(); }""")
        q.wait_for_timeout(450)          # 面板有 .22s 的上滑动画，滑完再量
        g = q.evaluate("""() => {
          const r = document.getElementById('drGo').getBoundingClientRect();
          return [Math.round(r.top), Math.round(r.bottom), innerHeight,
                  document.querySelectorAll('#drBody .dr-hist tr').length]; }""")
        okk = g[1] <= g[2] and g[0] >= 0 and g[3] == 8
        print('  ', ('PASS ' if okk else 'FAIL ') + f'{w}×{h} 面板主按钮在屏幕里（{g[0]}~{g[1]} / {g[2]}，表 {g[3]-1} 行）')
        if not okk: fails += 1
        q.close()
    # 疯狂版没有这些
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    c = pg.evaluate("""() => { __tetris.startDrill();
      return [!document.getElementById('dailyBtn'), !document.getElementById('drBar'), !__tetris.drill]; }""")
    for okk, m in zip(c, ['疯狂版没有入口', '疯狂版没有细栏', '疯狂版 startDrill 不生效']):
        print('  ', ('PASS ' if okk else 'FAIL ') + m)
        if not okk: fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
