"""右上角「重开」先确认：选了才重开，关掉就接着打

原来一点就重开，那个键就在暂停旁边，误触一下整局白打。现在：
  · 点重开 → 弹面板、方块停住，这局一格都不动
  · 关闭 / 点外面 / Esc → 接着打同一局
  · 主按钮 = 重开当前玩法（对战同级别、NES 同起始等级、每日练习这一段）
  · 下面换玩法；跳去对战/NES 选级别再关掉，原来那局也要接着走
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
  const $ = id => document.getElementById(id);
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };
  const sh = $('restartSheet');
  const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code }));

  // 打一局，攒点分
  $('startBtn').click(); T.game.noGarbage = true;
  for (let i = 0; i < 5; i++){ T.hardDrop(); settle(); }
  const sc = T.game.score, pc = T.game.pieces;

  // ── 点重开：只弹面板，这局停住不动 ──
  $('restartBtn').click();
  ok(!sh.hidden && T.game.frozen, '点重开：弹出面板，方块停住');
  const y0 = T.game.piece.y; T.step(3000);
  ok(T.game.score === sc && T.game.pieces === pc && T.game.piece.y === y0, '面板开着这局一格都不动');
  ok(/^重新开始$/.test($('rsAgain').textContent) && $('rsModes').querySelectorAll('[data-rs]').length === 8, '主按钮「重新开始」+ 八个玩法（含 T 旋练习、中途开局）');

  // ── 三种关法都不重开 ──
  $('rsClose').click();
  ok(sh.hidden && !T.game.frozen && T.game.score === sc && T.game.pieces === pc, '点「关闭」：接着打同一局');
  T.step(1500);
  ok(T.game.piece && T.game.piece.y > y0, '关掉之后方块接着往下掉');
  $('restartBtn').click(); sh.click();
  ok(sh.hidden && !T.game.frozen && T.game.pieces === pc, '点面板外面：也是接着打');
  key('KeyR');
  ok(!sh.hidden, '键盘 R 也是先弹面板');
  key('Escape');
  ok(sh.hidden && !T.game.frozen && T.game.pieces === pc, 'Esc 关掉，不重开');

  // ── 主按钮：重新开始 ──
  $('restartBtn').click(); $('rsAgain').click();
  ok(sh.hidden && T.game.score === 0 && T.game.pieces === 0 && !T.game.frozen, '点「重新开始」才重开');

  // ── 跳去对战选级别、再关掉：原来那局接着走 ──
  for (let i = 0; i < 3; i++){ T.hardDrop(); settle(); }
  const pc2 = T.game.pieces;
  $('restartBtn').click();
  $('rsModes').querySelector('[data-rs="vs"]').click();
  ok(sh.hidden && !$('vsSheet').hidden && T.game.frozen, '「对战机器人」打开选级别');
  $('vsExit').click();
  ok($('vsSheet').hidden && !T.game.frozen && !T.vs && T.game.pieces === pc2, '选级别那里点「回普通」：原来那局接着打');
  $('restartBtn').click();
  $('rsModes').querySelector('[data-rs="nes"]').click();
  $('nesSheet').click();
  ok($('nesSheet').hidden && !T.game.frozen && !T.nes && T.game.pieces === pc2, 'NES 选级别点外面关掉：原来那局接着打');
  // 从面板直接开对战
  $('restartBtn').click();
  $('rsModes').querySelector('[data-rs="vs"]').click();
  $('vsLevels').querySelector('[data-vl="4"]').click(); $('vsGo').click();
  ok(T.vs && T.vs.bot.lv === 4 && !T.game.frozen, '选好级别开打');

  // ── 各模式的主按钮 ──
  $('restartBtn').click();
  ok(/对战 Lv 4/.test($('rsAgain').textContent), `对战里主按钮：「${$('rsAgain').textContent}」`);
  T.vs.sent = 7; $('rsAgain').click();
  ok(T.vs && T.vs.bot.lv === 4 && T.vs.sent === 0, '对战里重开：同一级别');
  $('restartBtn').click(); $('rsClose').click();
  ok(T.vs && !T.game.frozen, '对战里关掉面板：接着打');
  $('restartBtn').click();
  $('rsModes').querySelector('[data-rs="normal"]').click();
  ok(!T.vs && T.game.started && !T.game.over && T.game.pieces === 0 && !$('overlay').classList.contains('show'), '「普通」：退出对战、直接开一局普通局');
  T.startNes(12, 3);
  $('restartBtn').click();
  ok(/NES 起始 12 级/.test($('rsAgain').textContent), `NES 里主按钮：「${$('rsAgain').textContent}」`);
  const f0 = T.nes.frames; T.step(500);
  ok(T.nes.frames === f0, 'NES 里面板开着也不走帧');
  $('rsClose').click(); T.step(200);
  ok(T.nes.frames > f0 && T.nes.start === 12, '关掉 NES 接着走');
  $('restartBtn').click(); $('rsModes').querySelector('[data-rs="hint"]').click();
  ok(T.hintMode && !T.nes, '「提示」：换成提示模式');
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
    # 疯狂版：同样先确认，只是没有换玩法
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    c = pg.evaluate("""() => { const T = __tetris, $ = id => document.getElementById(id);
      $('startBtn').click(); T.ups.length = 0; T.hardDrop(); let g = 0; while ((T.clearing || !T.game.piece) && g++ < 400) T.step(16);
      const pc = T.game.pieces;
      $('restartBtn').click(); const shown = !$('restartSheet').hidden && !$('rsModes');
      $('rsClose').click(); const kept = T.game.pieces === pc && !T.game.frozen;
      $('restartBtn').click(); $('rsAgain').click();
      return [shown, kept, T.game.pieces === 0]; }""")
    for okk, m in zip(c, ['疯狂版：点重开也先弹面板（没有换玩法）', '疯狂版：关掉接着打', '疯狂版：点「重新开始」才重开']):
        r.append(('PASS ' if okk else 'FAIL ') + m)
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    print('重开确认')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
