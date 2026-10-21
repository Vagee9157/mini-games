"""消行打击感（标准版）：1~4 行、T 旋、B2B、连击的力度一级比一级重

锁这几条：力度随行数 / 连击单调变大；震屏幅度跟着力度；两行起才有冲击波；
三行起才有外框一闪；第 2 连起弹「N 连」；疯狂版还是原来那套；系统「减弱动态效果」时不震屏。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

# 摆好「底下 n 行只差最右一列」，竖 I 落下去正好消 n 行
CLEAR = r"""([n, combo]) => {
  const T = __tetris, R = T.TOTAL_ROWS, $ = id => document.getElementById(id);
  if (!T.game.started || T.game.over) $('startBtn').click();
  T.game.noGarbage = true;
  for (let y = 0; y < R; y++) T.game.board[y].fill(null);
  for (let y = R - n; y < R; y++) for (let x = 0; x < 9; x++) T.game.board[y][x] = 'J';
  T.game.board[R - n - 1][0] = 'J';                 // 垫一块，免得变成全消
  T.game.combo = combo; T.game.b2b = false;
  T.game.piece = null; T.game.queue.unshift('I'); T.game.mods.unshift(null); T.spawnNext();
  const p = T.game.piece; p.rot = 1; p.x = 7; p.y = R - n - 4;
  while (!T.collides('I', 7, p.y + 1, 1)) p.y++;
  const sh = $('shaker'), hb = $('boardHit');
  sh.classList.remove('hit', 'shake', 'shake-big'); if (hb) hb.classList.remove('on');
  const pops0 = document.querySelectorAll('#fx .pop.combo').length;
  const lines0 = T.game.lines;
  T.hardDrop();
  return { lines: T.game.lines - lines0, hit: T.lastHit, sh: parseFloat(sh.style.getPropertyValue('--sh')) || 0,
           shook: sh.classList.contains('hit'), oldShake: sh.classList.contains('shake') || sh.classList.contains('shake-big'),
           wave: T.waves ? T.waves.length : -1, glow: !!hb && hb.classList.contains('on'),
           combo: document.querySelectorAll('#fx .pop.combo').length - pops0,
           comboText: (document.querySelector('#fx .pop.combo:last-child b') || {}).textContent || '' };
}"""

fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(**p.devices['iPhone 13']); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
    L = []
    ok = lambda c, m: L.append(('PASS ' if c else 'FAIL ') + m)
    hp = pg.evaluate("""() => { const P = __tetris.hitPower;
      return { n: [1, 2, 3, 4].map(n => P(n, null, false, 0, false)), ts: P(2, 'tspin', false, 0, false),
               b2b: P(4, null, false, 0, true), combo: [0, 1, 3, 6, 12].map(c => P(1, null, false, c, false)),
               pc: P(1, null, true, 0, false) }; }""")
    ok(hp['n'] == sorted(hp['n']) and len(set(hp['n'])) == 4, f"力度随行数递增（1~4 行：{hp['n']}）")
    ok(hp['ts'] > hp['n'][1] and hp['b2b'] > hp['n'][3], f"T 旋双消比双消重（{hp['ts']}）、B2B 四消比四消重（{hp['b2b']}）")
    ok(hp['combo'] == sorted(hp['combo']) and hp['combo'][-1] <= hp['n'][0] + 4, f"连击越多越重、加成封顶（{hp['combo']}）")
    ok(hp['pc'] == 10, '全消拉满')
    cols = pg.evaluate("() => [1, 2, 3, 4].map(n => __tetris.hitColor(n, null, 0)).concat([__tetris.hitColor(2, 'tspin', 0), __tetris.hitColor(1, null, 3), __tetris.hitColor(1, null, 6)])")
    ok(len(set(cols[:4])) == 4 and cols[4] == '#ff6bd6' and cols[5] != cols[6], f"颜色：1~4 行各一色、T 旋品红、连击往橙 / 红走（{cols}）")

    r = {n: pg.evaluate(CLEAR, [n, -1]) for n in (1, 2, 3, 4)}
    ok(all(r[n]['lines'] == n for n in r), '（摆的盘面正好消 1~4 行）')
    ok(all(r[n]['shook'] for n in r) and [r[n]['sh'] for n in (1, 2, 3, 4)] == sorted(r[n]['sh'] for n in (1, 2, 3, 4)) and r[1]['sh'] < r[4]['sh'],
       f"每种消行都震，幅度随行数变大（{[r[n]['sh'] for n in (1, 2, 3, 4)]} px）")
    ok(r[1]['wave'] == 0 and all(r[n]['wave'] >= 1 for n in (2, 3, 4)), '两行起才有冲击波')
    ok(not r[1]['glow'] and not r[2]['glow'] and r[3]['glow'] and r[4]['glow'], '三行起外框一闪')
    ok(all(r[n]['combo'] == 0 for n in r), '没连击不弹连击数')
    c = pg.evaluate(CLEAR, [1, 3])
    ok(c['combo'] == 1 and c['comboText'] == '5 连' and c['wave'] >= 1 and c['glow'] and c['sh'] > r[1]['sh'],
       f"第 5 连的单消：弹「{c['comboText']}」、有冲击波和外框、震得比普通单消重（{c['sh']}px）")
    if errs: L.append('FAIL 页面报错：' + '; '.join(errs))
    # 疯狂版：原来那套（双消小震、四消大震，不走 hitFx）
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html"); pg.wait_for_function("() => !!window.__tetris")
    pg.evaluate("() => { document.getElementById('startBtn').click(); __tetris.ups.length = 0; }")
    cz = pg.evaluate(CLEAR, [2, -1])
    ok(cz['oldShake'] and not cz['shook'] and cz['wave'] == 0, '疯狂版还是原来那套震屏，没有冲击波')
    b.close()
    # 减弱动态效果：不震屏
    b = p.chromium.launch()
    ctx = b.new_context(**p.devices['iPhone 13'], reduced_motion='reduce')
    pg = ctx.new_page(); pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.goto(f"http://127.0.0.1:{port}/tetris/index.html"); pg.wait_for_function("() => !!window.__tetris")
    rm = pg.evaluate(CLEAR, [4, -1])
    ok(not rm['shook'] and rm['lines'] == 4, '系统开了「减弱动态效果」：消行不震屏')
    b.close()
    print('消行打击感')
    for l in L:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
