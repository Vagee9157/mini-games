"""经典 NES 模式：规则对不对得上 1989 红白机版，以及和其它模式隔离

规则逐条对：朝向表（T/J/L 是纯旋转、出生朝向都在顶上两行）、速度表、第一次升级的行数、
ARE、DAS 16/6、没有踢墙、落地即锁、计分 40/100/300/1200×(级+1)、出块概率（连出约 1/28）。
逻辑全部按帧推（nesFrame），不靠真实时钟。
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
  const P = T.NES_PIECES;
  const frames = n => { for (let i = 0; i < n; i++) T.nesFrame(); };

  // ── 朝向表 ──
  const set = cells => cells.map(([dy, dx]) => dx + ',' + dy).sort().join(' ');
  const cw = cells => cells.map(([dy, dx]) => [dx, -dy]);       // 屏幕坐标顺时针：(dx,dy) → (−dy,dx)
  let rotOk = true;
  for (const t of ['T', 'J', 'L'])
    for (let i = 0; i < 4; i++) if (set(cw(P[t].s[i])) !== set(P[t].s[(i + 1) % 4])) rotOk = false;
  ok(rotOk, 'T/J/L 四个朝向按顺序是纯 90° 顺时针旋转（绕中心格）');
  ok(['S', 'Z', 'I'].every(t => P[t].s.length === 2) && P.O.s.length === 1, 'S/Z/I 两个朝向、O 一个');
  ok(Object.values(P).every(p => p.s[p.spawn].every(([dy]) => dy === 0 || dy === 1)), '出生朝向都落在最上面两行');
  ok(set(P.T.s[P.T.spawn]) === set([[0, -1], [0, 0], [0, 1], [1, 0]]), 'T 出生是尖朝下（平的一面朝上）');
  ok(set(P.I.s[P.I.spawn]) === set([[0, -2], [0, -1], [0, 0], [0, 1]]), 'I 出生横着，占第 3~6 列');

  // ── 数表 ──
  const g = [0, 8, 9, 10, 13, 16, 18, 19, 28, 29, 35].map(T.nesGravity).join(',');
  ok(g === '48,8,6,5,4,3,3,2,2,1,1', `每格帧数（0/8/9/10/13/16/18/19/28/29/35 级：${g}）`);
  const fu = [0, 5, 9, 12, 15, 16, 18, 19].map(T.nesFirstLevelUp).join(',');
  ok(fu === '10,60,100,100,100,110,130,140', `第一次升级的行数（起始 0/5/9/12/15/16/18/19：${fu}）`);
  const ar = [19, 18, 17, 14, 13, 10, 9, 6, 5, 0].map(T.nesAre).join(',');
  ok(ar === '10,10,12,12,14,14,16,16,18,18', `ARE 按锁定高度（${ar}）`);

  // ── 先开一局普通局：NES 不能碰它的记录和存档 ──
  localStorage.removeItem(T.NES_KEY);
  $('startBtn').click(); T.game.noGarbage = true;
  for (let i = 0; i < 3; i++){ T.hardDrop(); let k = 0; while ((T.clearing || !T.game.piece) && k++ < 400) T.step(16); }
  // 存档是进 NES 那一刻写的（saveGame(true)），所以拿那一刻的分比
  const best0 = T.readBest(), save0 = T.game.score;

  // ── 进 NES ──
  ok(!!$('nesBtn'), '开局面板有「经典 NES」入口');
  T.startNes(0, 12345);
  ok(!!T.nes && document.body.classList.contains('nesing'), '进 NES 模式');
  ok(/逆转/.test($('btnDrop').textContent), `「落底」键变成逆时针旋转（「${$('btnDrop').textContent.trim()}」）`);
  frames(1);
  const c = T.nes.cur;
  ok(!!c && c.x === 5 && c.y === 0 && c.r === P[c.t].spawn && T.nes.phase === 'fall', `出第一块：中心在第 5 列第 0 行、出生朝向（${c && c.t}）`);
  T.drawPreview();
  ok(T.dbg.previews === 1, 'NEXT 只画 1 块');
  T.holdPiece(); T.hardDrop();
  ok(T.nes.cur === c && c.y === 0, '暂存和硬降都没反应');

  // ── DAS：按下立刻 1 格，16 帧后第 2 格，之后每 6 帧一格 ──
  const xs = [];
  T.nes.cur = { t: 'O', r: 0, x: 1, y: 5 }; T.nes.fall = 0;
  T.nesPress('right'); xs.push(T.nes.cur.x);
  for (let f = 1; f <= 28; f++){ T.nesFrame(); if ([15, 16, 21, 22, 27, 28].includes(f)) xs.push(T.nes.cur.x); }
  T.nesRelease('right');
  ok(xs.join(',') === '2,2,3,3,4,4,5', `横移时刻：按下 / 15·16 帧 / 21·22 / 27·28 → 列 ${xs.join(',')}`);
  // 贴墙：一直按着，到墙停住；松手前不再挪
  T.nes.cur = { t: 'O', r: 0, x: 7, y: 5 }; T.nesPress('right'); frames(60); T.nesRelease('right');
  ok(T.nes.cur.x === 9, `按住右走到墙停住（中心列 ${T.nes.cur.x}）`);

  // ── 没有踢墙 ──
  T.nes.cur = { t: 'I', r: 0, x: 0, y: 6 };
  T.nesRotate(1);
  ok(T.nes.cur.r === 0, '竖 I 贴左墙转不成横的（现代规则会踢墙踢过去）');
  T.nes.cur = { t: 'T', r: 2, x: 4, y: 6 };
  T.nesRotate(1); const r1 = T.nes.cur.r; T.nesRotate(-1);
  ok(r1 === 3 && T.nes.cur.r === 2, '空地上顺/逆时针各转一下');
  // 屏幕上的「落底」键 = 逆时针
  $('btnDrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); $('btnDrop').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  ok(T.nes.cur.r === 1, `点「落底」键：逆时针转了（朝向 2 → ${T.nes.cur.r}）`);

  // ── 落地即锁：重力那一下落不下去就锁死 ──
  const nb = () => { for (const row of T.nes.board) row.fill(null); };
  const put = (t, r, x, y, fall) => { T.nes.cur = { t, r, x, y }; T.nes.phase = 'fall'; T.nes.clearRows = []; T.nes.fall = fall || 0; };
  nb();
  T.nes.cur = { t: 'O', r: 0, x: 4, y: 18 }; T.nes.fall = 0;
  frames(T.nesGravity(T.nes.level) - 1);
  ok(!!T.nes.cur, '落到底之前还没锁');
  frames(1);
  ok(!T.nes.cur && T.nes.phase === 'are' && T.nes.board[19][4] === 'O', '重力那一帧落不下去：当场锁死，进 ARE');
  ok(T.nes.timer === T.nesAre(18), `ARE ${T.nes.timer} 帧`);

  // ── 计分 ──
  T.startNes(5, 7); frames(1);
  const fillExcept = (rows, col) => { nb(); for (const y of rows) for (let x = 0; x < 10; x++) if (x !== col) T.nes.board[y][x] = 'J'; };
  fillExcept([16, 17, 18, 19], 9);
  put('I', 0, 9, 18, T.nesGravity(5) - 1);
  const sc0 = T.nes.score; frames(1);
  ok(T.nes.score - sc0 === 1200 * 6 && T.nes.lines === 4, `5 级打四消 +${T.nes.score - sc0}（应为 1200×6）`);
  frames(40);
  fillExcept([19], 0);
  put('I', 0, 0, 18, T.nesGravity(5) - 1);       // 竖 I 中心在第 18 行 → 占 16~19 行
  const sc1 = T.nes.score; frames(1);
  ok(T.nes.score - sc1 === 40 * 6, `5 级消一行 +${T.nes.score - sc1}（应为 40×6）`);
  // 软降：每 2 帧一格，锁定时按格数给分
  frames(40); nb();
  put('O', 0, 4, 10, 0);
  const sc2 = T.nes.score;
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code }));
  key('ArrowDown', 'keydown');
  const ys = [];
  for (let f = 1; f <= 6; f++){ T.nesFrame(); ys.push(T.nes.cur ? T.nes.cur.y : 'L'); }
  ok(ys.join(',') === '10,11,11,12,12,13', `按住下：每 2 帧落一格（${ys.join(',')}）`);
  let k = 0; while (T.nes.cur && k++ < 100) T.nesFrame();
  key('ArrowDown', 'keyup');
  ok(T.nes.score - sc2 === 8, `从第 10 行软降到第 18 行锁定：+${T.nes.score - sc2}（每格 1 分，应为 8）`);

  // ── 升级 ──
  T.startNes(0, 9); frames(1);
  for (let i = 0; i < 10; i++){
    frames(40); fillExcept([19], 0);
    put('I', 0, 0, 18, T.nesGravity(T.nes.level) - 1); frames(1);
  }
  ok(T.nes.lines === 10 && T.nes.level === 1, `起始 0 级：消到 10 行升 1 级（${T.nes.lines} 行 ${T.nes.level} 级）`);
  ok(T.nes.trans !== null, '记下第一次升级时的分（过渡分）');

  // ── 出块概率 ──
  T.startNes(0, 4242);
  const cnt = {}; let rep = 0, prev = null; const N = 70000;
  for (let i = 0; i < N; i++){ const t = T.nesRoll(); cnt[t] = (cnt[t] || 0) + 1; if (t === prev) rep++; prev = t; }
  const fr = Object.values(cnt).map(v => v / N);
  ok(Object.keys(cnt).length === 7 && fr.every(f => Math.abs(f - 1 / 7) < .012), `七种各约 1/7（${fr.map(f => (f * 100).toFixed(1)).join(' ')}%）`);
  ok(Math.abs(rep / N - 1 / 28) < .006, `连出同一种约 1/28（${(rep / N * 100).toFixed(2)}%，应约 3.57%）`);

  // ── 结束：出生撞死 ──
  T.startNes(18, 5); frames(1);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) T.nes.board[y][x] = (x === 0 && y > 3) ? null : 'J';
  T.nes.cur = null; T.nes.phase = 'are'; T.nes.timer = 1; T.nes.score = 123456;
  frames(1);
  ok(T.nes.over && T.game.over, '新块出不来：这局结束');
  const rec = T.nesRecords();
  ok(rec.best[18] && rec.best[18].score === 123456 && rec.runs.length >= 1, '按起始等级记下最好成绩');
  await sleep(900);
  ok(!$('nesSheet').hidden && /123,456/.test($('nesResult').textContent) && /熟练/.test($('nesResult').textContent),
     `结算：分数 + 水平参照（「${$('nesResult').querySelector('.nes-tier') && $('nesResult').querySelector('.nes-tier').textContent}」）`);
  ok(/123,456|12.35万/.test($('nesLevels').textContent), '选关面板上 18 级显示这一级的最好成绩');

  // ── 隔离 ──
  ok(T.readBest() === best0, 'NES 不写普通局的最高分');
  ok(!!T.readSave() && T.readSave().score === save0, '普通局存档还在');
  $('nesExit').click();
  ok(!T.nes && !document.body.classList.contains('nesing') && $('overlay').classList.contains('show'), '「回普通」回到开局面板');
  ok(/落底/.test($('btnDrop').textContent), '「落底」键换回来');
  ok($('overlay').classList.contains('has-save'), '「接着上次玩」还在');

  // ── 重开 / 暂停 / 切模式 ──
  T.startNes(9, 3); frames(1);
  T.nes.score = 999; T.modeRestart();
  ok(T.nes && T.nes.start === 9 && T.nes.score === 0, '顶栏「重开」：同一起始等级重开');
  const f0 = T.nes.frames;
  document.getElementById('pauseBtn').click(); T.step(500);
  ok(T.nes.frames === f0, '暂停时不走帧');
  document.getElementById('pauseBtn').click(); T.step(100);
  ok(T.nes.frames > f0, '继续后接着走');
  document.querySelector('#modeSw [data-m="normal"]').click();
  ok(!T.nes, '顶栏点「普通」退出 NES');
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
    print('经典 NES')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    c = pg.evaluate("() => { __tetris.startNes(18); return [!document.getElementById('nesBtn'), !__tetris.nes]; }")
    for okk, m in zip(c, ['疯狂版没有 NES 入口', '疯狂版 startNes 不生效']):
        print('  ', ('PASS ' if okk else 'FAIL ') + m)
        if not okk: fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
