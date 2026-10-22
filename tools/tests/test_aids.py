"""普通局：每行均分（右栏）、保命线 / 标 T 槽两个开关、复盘的分段每行和多余按键"""
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = (id, t) => $(id).dispatchEvent(new MouseEvent(t, { bubbles: true }));
  const tap = id => { ev(id, 'mousedown'); ev(id, 'mouseup'); };
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };
  const load = rows => { for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    rows.forEach((r, i) => { for (let x = 0; x < 10; x++) T.game.board[R - rows.length + i][x] = r[x] === '#' ? 'J' : null; }); };
  const give = t => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
  localStorage.removeItem(T.HIST_KEY);

  // ── 开关 ──
  ok(!T.aids.line && !T.aids.ts && /保命线：关/.test($('aidLineBtn').textContent) && /标 T 槽：关/.test($('aidTsBtn').textContent), '两个开关默认都关');
  $('aidLineBtn').click();
  ok(T.aids.line && /保命线：开/.test($('aidLineBtn').textContent) && JSON.parse(localStorage.getItem(T.AID_KEY)).line === true, '点保命线：打开，存下来');

  // 保命线真画出来了：同一盘面，开 / 关两张图不一样
  $('startBtn').click(); T.game.noGarbage = true; load([]); give('O');
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = $('board'), snap = async () => { await frame(); return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; };
  await snap(); const a1 = await snap(); T.setAid('line', false); await snap(); const a0 = await snap(); T.setAid('line', true);
  // 只比保命线那一带（可见 20 行里从上往下第 7 行的上沿）和最顶上一带（方块在那，不该有差）
  const band = (f0, f1) => { let d = 0; const y0 = Math.floor(cv.height * f0), y1 = Math.ceil(cv.height * f1);
    for (let y = y0; y < y1; y++) for (let x = 0; x < cv.width; x++){ const i = (y * cv.width + x) * 4; if (a1[i] !== a0[i]) d++; } return d; };
  const at = band(7 / 20 - .01, 7 / 20 + .01), off = band(.5, .95);
  ok(at > cv.width * .3 && off === 0, `保命线画在盘面六成高那条线上（线附近差 ${at} 像素，下半盘差 ${off}）`);

  // ── 标 T 槽 ──
  T.setAid('ts', true);
  ok(T.game.run.aidTs, '这局开过标槽：记下来');
  load(['.....#####', '###...####', '####.#####']); give('O');
  ok(T.aidSlots.length === 1 && T.aidSlots[0].x === 4, `搭好的 T 槽圈出来（第 ${T.aidSlots[0] && T.aidSlots[0].x} 列）`);
  load(['..........', '###...####', '####.#####']); give('O');
  ok(T.aidSlots.length === 0, '没屋檐就不圈');
  T.game.pieces = 60; T.game.score = 99999; T.endGame('堆到顶了');
  ok(T.game.best === 0 && T.histRead()[0].aid === 'ts', '开了标槽的局：不进最高分，历史记录标 aid');
  T.openHistSheet(); await wait(30);
  ok(/标槽/.test($('histList').textContent) && !$('histChart').querySelector('svg'), '历史记录里标「标槽」，不画进曲线');
  T.closeHistSheet();
  T.setAid('ts', false);
  $('againBtn').click(); T.game.noGarbage = true;
  ok(!T.game.run.aidTs, '关了标槽重开：这局是正经局');
  T.startHint(); load(['.....#####', '###...####', '####.#####']); T.setAid('ts', true); give('O');
  ok(T.aidSlots.length === 0, '提示模式里不叠这个（它自己有教练）'); T.setAid('ts', false);
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(30);

  // ── 每行均分 ──
  $('startBtn') && $('startBtn').click(); T.game.noGarbage = true;
  ok(!$('paceBox').hidden && $('pace').textContent === '—', '普通局右栏有「每行」，不够 10 行显示 —');
  T.game.lines = 20; T.game.score = 20 * 1000; T.syncPace();
  ok($('pace').textContent === '1,000' && $('paceBox').classList.contains('up'), `20 行 2 万：每行 1,000，比平均水平高 → 绿（${$('paceBox').className}）`);
  T.game.score = 20 * 50; T.syncPace();
  ok($('paceBox').classList.contains('dn'), '每行只有 50：低于平均 → 红');
  T.startHint(); T.syncPace();
  ok($('paceBox').hidden, '提示模式里不显示');
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(30);

  // ── 复盘：多余按键 + 分段每行 ──
  $('startBtn').click(); T.game.noGarbage = true; T.game.lines = 0; T.game.score = 0;
  load([]); give('O');
  tap('btnRight'); tap('btnRight'); tap('btnRight'); tap('btnRight'); tap('btnDrop'); settle();
  await wait(200);
  load([]); give('O'); tap('btnDrop'); settle();
  const r = T.game.run;
  ok(r.finN === 2 && r.faults === 1 && r.extra === 3, `O 块点 4 下右再落（最少是按住到墙 + 落底 2 下）算多余 3 下；直接落底不算（${r.finN} 块 / ${r.faults} 块多 / 多 ${r.extra} 下）`);
  await wait(200);
  T.game.lines = 95; load(['#########.', '#########.', '#########.', '#########.']); give('I'); { const p = T.game.piece; p.rot = 1; p.x = 7; p.y = 0; T.hardDrop(); } settle();
  T.game.lines = 150; load(['#########.', '#########.', '#########.', '#########.']); give('I'); { const p = T.game.piece; p.rot = 1; p.x = 7; p.y = 0; T.hardDrop(); } settle();
  ok(r.seg[0][1] === 4 && r.seg[1][1] === 4 && r.seg[2][1] === 0, `分段：95 行时那次四消算 0~100，150 行那次算 100~200（${JSON.stringify(r.seg)}）`);
  Object.assign(r, { finN: 60, faults: 30, extra: 80 });
  T.game.pieces = 150; T.endGame('堆到顶了');
  ok(/分段每行0~100 [\d,]+ · 100~200 [\d,]+/.test($('rvStats').textContent), `复盘有分段每行（${($('rvStats').textContent.match(/分段每行[^多]*/) || [''])[0]}）`);
  ok(/多余按键50% 的块（多按 80 下）/.test($('rvStats').textContent), '复盘有多余按键');
  const base = { clr: [0, 5, 5, 0, 15], tsc: [0, 0, 3, 0], mini: 0, b2bs: 0, bigPts: 0, bigLines: 60, smallPts: 0, smallLines: 20, holes: 5, highLocks: 10, finN: 300, faults: 120, extra: 300 };
  const n = T.reviewTips(base, 600, 246).map(t => t[0]);
  ok(n.includes('按键绕远了'), `四成的块多按了：建议里提按键（${n.join(' / ')}）`);
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
            c = pg.evaluate("() => !document.getElementById('paceBox') && !document.getElementById('aidLineBtn')")
            r.append(('PASS ' if c else 'FAIL ') + '疯狂版没有这几样')
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'普通局辅助（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
