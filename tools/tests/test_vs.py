"""对战机器人：攻击表、抵消、涨行、机器人按速度出手、胜负、定级单调、性能

定级用 vsSimMatch（两个机器人对打，不画不碰主盘面），种子固定所以结果可复现 ——
这条测试红了，说明改动让某一级不再赢下一级。
"""
import os, http.server, socketserver, threading, functools, sys, time
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
  const R = T.TOTAL_ROWS;
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };

  // ── 攻击表 ──
  const A = T.vsAttack;
  ok([1, 2, 3, 4].map(n => A(n, null, false, 0, false)).join(',') === '0,1,2,4', '单/双/三/四 = 0/1/2/4');
  ok([1, 2, 3].map(n => A(n, 'tspin', false, 0, false)).join(',') === '2,4,6', 'T 旋单/双/三 = 2/4/6');
  ok(A(1, 'mini', false, 0, false) === 0 && A(2, 'mini', false, 0, false) === 1, 'mini 单 0、双 1');
  ok(A(4, null, false, 0, true) === 5, 'B2B 四消 = 5');
  ok(A(1, null, false, 3, false) === 2 && A(2, null, false, 1, false) === 2, '连击加成（3 连 +2，1 连 +1）');
  ok(A(4, null, true, 0, false) === 14, '全消 +10');
  ok(A(0, 'tspin', false, 0, false) === 0, '没消行不打');

  // ── 先开一局普通局 ──
  $('startBtn').click(); T.game.noGarbage = true;
  for (let i = 0; i < 3; i++){ T.hardDrop(); settle(); }
  const best0 = T.readBest(), save0 = T.game.score;

  // ── 进对战 ──
  ok(!!$('vsBtn'), '开局面板有「对战机器人」入口');
  localStorage.removeItem(T.VS_KEY);
  T.startVs(3, 77);
  ok(!!T.vs && document.body.classList.contains('vsing') && T.game.noGarbage, '进对战：不按时间涨灰线');
  ok(getComputedStyle(document.querySelector('.side .stats')).display === 'none' && getComputedStyle($('vsBox')).display !== 'none',
     '右栏四个数字格换成机器人小窗');
  const cv = $('vsCv');
  ok(cv._w > 20 && cv._h > 40, `小窗量到了尺寸（${cv._w && cv._w.toFixed(0)}×${cv._h && cv._h.toFixed(0)}）`);
  ok(T.vs.bot.timer < 0, '开局机器人先停一下');

  // ── 你打四消、身上有 3 行待涨：先抵消 3，打过去 1 ──
  const clearB = () => { for (let y = 0; y < R; y++) T.game.board[y].fill(null); };
  const give = t => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
  clearB();
  for (let y = R - 4; y < R; y++) for (let x = 0; x < 9; x++) T.game.board[y][x] = 'J';
  T.game.board[R - 5][0] = 'J';            // 垫一块：消完不是全消（全消会再 +10）
  T.vs.inP = [{ n: 3, hole: 0 }];
  give('I'); { const p = T.game.piece; p.rot = 1; p.x = 7; p.y = 0; }
  const cellsX = T.cellsOf('I', 1).map(c => c[0] + 7);
  ok(cellsX.every(x => x === 9), '（竖 I 放在第 9 列）');
  T.hardDrop(); settle();
  const binc = T.vs.bot.inc.reduce((s, g) => s + g.n, 0);
  ok(T.vs.inP.length === 0 && binc === 1 && T.vs.sent === 4, `四消 4 行：抵掉自己 3 行，打过去 1 行（对方待涨 ${binc}）`);

  // ── 没消行就把待涨的顶上来，同一波缺口同一列 ──
  clearB();
  T.vs.inP = [{ n: 2, hole: 3 }];
  give('O'); { const p = T.game.piece; p.rot = 0; p.x = 6; p.y = 0; }
  T.hardDrop(); settle();
  const g1 = T.game.board[R - 1], g2 = T.game.board[R - 2];
  ok(g1[3] === null && g2[3] === null && g1.filter(Boolean).length === 9 && g2.filter(Boolean).length === 9,
     '锁定没消行：底下顶上来 2 行，缺口都在第 3 列');
  ok(!!T.game.board[R - 3][7] || !!T.game.board[R - 4][7], '刚放的块跟着被顶上去');
  // 一次最多 8 行
  clearB();
  T.vs.inP = [{ n: 12, hole: 5 }];
  give('O'); { const p = T.game.piece; p.rot = 0; p.x = 0; p.y = 0; }
  T.hardDrop(); settle();
  ok(T.vs.inP.reduce((s, g) => s + g.n, 0) === 4, `一次最多顶 8 行，剩 ${T.vs.inP.reduce((s, g) => s + g.n, 0)} 行下次再涨`);
  T.vs.inP = [];

  // ── 机器人按自己的速度出手 ──
  T.startVs(10, 5);
  const p0 = T.vs.bot.pieces;
  for (let i = 0; i < 625; i++) T.vsStep(16);          // 10 秒
  const placed = T.vs.bot.pieces - p0, want = (10000 - 900) / 1000 * T.VS_LEVELS[9].pps;
  ok(Math.abs(placed - want) <= 1.5, `Lv10 十秒放了 ${placed} 块（每秒 ${T.VS_LEVELS[9].pps}，开局停 0.9 秒，应约 ${want.toFixed(1)}）`);
  ok(T.vs.bot.b.some(r => r.some(Boolean)), '它的盘面上有块');

  // ── 它被顶死：你赢 ──
  for (let y = 0; y < R; y++) T.vs.bot.b[y].fill('J');
  T.vsStep(1000);
  ok(T.vs.over && T.vs.win === true && T.game.over, '机器人出不了块：你赢');
  ok((T.vsRecords()[10] || {}).w === 1, '记一场胜');
  await sleep(900);
  ok(!$('vsSheet').hidden && /你赢了/.test($('vsResult').textContent), '结算面板：你赢了');
  ok(/1 胜 0 负/.test($('vsLevels').textContent), '级别按钮上显示战绩');

  // ── 你被顶死：输 ──
  T.startVs(2, 9);
  T.endGame('出生撞死');
  ok(T.vs.over && T.vs.win === false && (T.vsRecords()[2] || {}).l === 1, '你被顶死：输，记一场负');
  ok(T.readBest() === best0, '对战不写普通局的最高分');
  ok(!!T.readSave() && T.readSave().score === save0, '普通局存档还在');
  await sleep(900);
  $('vsExit').click();
  ok(!T.vs && !document.body.classList.contains('vsing') && $('overlay').classList.contains('show'), '「回普通」回到开局面板');
  ok(getComputedStyle(document.querySelector('.side .stats')).display !== 'none', '右栏数字格换回来');

  // ── 重开 = 同一级别 ──
  T.startVs(6, 1); T.vs.sent = 9; T.modeRestart();
  ok(T.vs && T.vs.bot.lv === 6 && T.vs.sent === 0, '顶栏「重开」：同一级别重开');
  document.querySelector('#modeSw [data-m="normal"]').click();
  ok(!T.vs, '顶栏点「普通」退出对战');

  // ── 性能：机器人想一步要多久 ──
  T.startVs(10, 3);
  const ts = [];
  for (let i = 0; i < 200 && !T.vs.over; i++){ const s = performance.now(); T.vsBotMove(T.vs.bot, T.VS_LEVELS[9], null, T.vs.inP); ts.push(performance.now() - s); if (T.vs.bot.dead) break; }
  ts.sort((a, b) => a - b);
  ok(ts[ts.length >> 1] < 8, `Lv10 每步中位 ${ts[ts.length >> 1].toFixed(2)}ms、最慢 ${ts[ts.length - 1].toFixed(2)}ms（${ts.length} 步）`);
  return L;
}"""

LADDER = """([a, c, n]) => { let w = 0; for (let s = 1; s <= n; s++){ const m = __tetris.vsSimMatch(a, c, s * 101, 300000); if (m.win === true) w++; } return w; }"""

fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(**p.devices['iPhone 13']); errs = []; pg.set_default_timeout(900000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
    r = pg.evaluate(JS)
    # 定级：每一级都要赢下一级过半（种子固定，结果可复现）
    N = 30
    for a in range(2, 11):
        w = pg.evaluate(LADDER, [a, a - 1, N])
        r.append(('PASS ' if w > N * .55 else 'FAIL ') + f'Lv{a} 对 Lv{a-1}：{N} 局赢 {w}')
    w = pg.evaluate(LADDER, [10, 5, 12])
    r.append(('PASS ' if w >= 11 else 'FAIL ') + f'Lv10 对 Lv5：12 局赢 {w}')
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    print('对战机器人')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    c = pg.evaluate("() => { __tetris.startVs(3); return [!document.getElementById('vsBtn'), !document.getElementById('vsBox'), !__tetris.vs]; }")
    for okk, m in zip(c, ['疯狂版没有对战入口', '疯狂版没有机器人小窗', '疯狂版 startVs 不生效']):
        print('  ', ('PASS ' if okk else 'FAIL ') + m)
        if not okk: fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
