"""中途开局：直接从第 150 / 180 / 200 行开始

等级、分数、已用时间、灰线钟按平时水平铺好，盘面垫灰线 + 一层方块；不进最高分，历史记录单独标；
结算复盘只算开局之后自己打的那一段。
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  localStorage.removeItem(T.HIST_KEY);
  const height = () => { const t = T.game.board.findIndex(r => r.some(Boolean)); return t < 0 ? 0 : R - t; };
  const gRows = () => T.game.board.filter(r => r.some(c => c === 'X')).length;

  // ── 入口和档位 ──
  ok(!!$('midBtn') && !!document.querySelector('#rsModes [data-rs="mid"]'), '开局面板和重开面板都有「中途开局」');
  $('midBtn').click(); await wait(50);
  const tiers = [...document.querySelectorAll('#midTiers [data-ml]')].map(b => +b.dataset.ml);
  ok(!$('midSheet').hidden && tiers.join(',') === '150,180,200', `三档：${tiers.join(' / ')} 行起`);
  ok(/还不到 3 局/.test($('midSrc').textContent), '没记录：说按默认水平估');
  document.querySelector('[data-ml="180"]').click(); $('midGo').click(); await wait(50);

  // ── 开局状态 ──
  const g = T.game, P = T.midPlan(180);
  ok(g.lines === 180 && g.level >= 29 && g.level <= 33 && g.score >= P.sLo - 1 && g.score <= P.sHi + 1
     && g.elapsed >= P.eLo - 1 && g.elapsed <= P.eHi + 2000 && !g.noGarbage && g.started,
     `从 180 行开：行数固定，等级 ${g.level}（29~33）、${g.score} 分（${Math.round(P.sLo)}~${Math.round(P.sHi)}）、已用 ${Math.round(g.elapsed / 1000)} 秒，灰线开着`);
  const seen = new Set(); for (let i = 0; i < 20; i++) seen.add(T.midPlan(180, true).s);
  ok(seen.size > 10, `每次开局分数都不一样（20 次 ${seen.size} 种）`);
  ok(/29~33 级/.test($('midTiers').textContent), `档位上写范围（${document.querySelector('[data-ml="180"] span').textContent}）`);
  const ms = T.levelMult;
  let sum = 0; for (let i = 0; i < 180; i++) sum += ms(Math.floor(i / T.LINES_PER_LEVEL) + 1);
  ok(Math.abs(P.s - Math.round(153 * sum)) <= 1, `默认分数 = 每行 153 × 一路的等级倍率（${P.s}）`);
  ok(gRows() === 3 && height() >= 7 && height() <= 10, `盘面：底下 ${gRows()} 行灰线，堆高 ${height()} 行`);
  ok(!g.board.some(r => r.every(Boolean)), '盘面上没有满行');
  ok(!g.board.slice(0, R - 12).some(r => r.some(Boolean)), '上面留着地方（12 行以上全空）');
  ok(/中途开局 · 180 行起/.test($('modeTag').textContent) && !$('modeTag').hidden, `盘面角上写着「${$('modeTag').textContent}」`);
  ok(T.readSave() && T.readSave().mid && T.readSave().mid.L === 180, '存档里记着是中途开局（续玩后不会进最高分）');

  // ── 打一段再结束：不进最高分；复盘只算开局后那段；历史单独标 ──
  const best0 = g.best;
  g.score += 50000; g.lines += 20; g.pieces += 60; g.elapsed += 60000;
  T.endGame('堆到顶了');
  ok(g.best === best0, `不进最高分（最高分还是 ${g.best}）`);
  const sStart = T.mid.s;
  ok(/每行均分2,500/.test($('rvStats').textContent), `复盘每行均分只算开局后：5 万 / 20 行 = 2,500（${$('rvStats').textContent.slice(0, 20)}）`);
  let h = T.histRead();
  ok(h.length === 1 && h[0].mid === 180 && h[0].s0 === sStart && h[0].l === 200, '历史记一条，标着 180 行起，记着开局送的分');
  $('againBtn').click(); await wait(50);
  ok(T.mid && T.mid.L === 180 && g.lines === 180, '「再来一局」还是从 180 行起');
  g.pieces += 3; T.endGame('堆到顶了');
  ok(T.histRead().length === 1, '中途开局后马上死（只放了 3 块）不记');

  // ── 换回普通 ──
  T.openRestartSheet(); document.querySelector('#rsModes [data-rs="normal"]') ; $('rsAgain').click(); await wait(50);
  ok(T.mid && g.lines === 180, '重开面板「重新开始」：还是中途开局那一档');
  $('againBtn').click();
  T.endGame('堆到顶了');
  $('startBtn') && T.closeRestartSheet && T.closeRestartSheet();
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(50);
  T.startHint(); T.exitPractice ? T.exitPractice() : 0;

  // ── 有记录时按你的水平估 ──
  const a = []; for (let i = 0; i < 5; i++) a.push({ d: Date.now() - i * 1e6, s: 300000, l: 250, lv: 42, t: 500000, p: 600 });
  localStorage.setItem(T.HIST_KEY, JSON.stringify(a));
  let s250 = 0; for (let i = 0; i < 250; i++) s250 += ms(Math.floor(i / T.LINES_PER_LEVEL) + 1);
  const r = T.midRates(), P2 = T.midPlan(150);
  ok(r.from === 5 && Math.abs(r.b - 300000 / s250) < 1e-6 && r.tpl === 2000, `按最近 5 局估：每行底分 ${r.b.toFixed(1)}、每行 ${r.tpl / 1000} 秒`);
  ok(P2.e === 300000 && P2.eLo === 255000 && P2.eHi === 345000, `150 行起：已用中心 ${P2.e / 1000} 秒（150 × 2 秒），随机范围 ±15%`);
  T.openMidSheet(); await wait(30);
  ok(/最近 5 局/.test($('midSrc').textContent), `面板上说按最近 5 局估（${$('midSrc').textContent}）`);
  T.startMid(200);
  ok(g.lines === 200 && g.level >= 32 && g.level <= 36 && gRows() === 4, `200 行起：${g.level} 级（32~36）、${gRows()} 行灰线`);
  // 消行照常升级
  const lv0 = g.level; g.lines = 203;
  for (let y = 0; y < R; y++) T.game.board[y].fill(null);
  T.game.board[R - 1] = T.game.board[R - 1].map(() => 'J'); T.game.board[R - 1][0] = null;
  T.game.piece = null; T.game.queue.unshift('I'); T.game.mods.unshift(null); T.spawnNext();
  { const p = T.game.piece; p.rot = 1; p.x = -2; p.y = 0; T.hardDrop(); }
  for (let i = 0; i < 40 && (T.clearing || !T.game.piece); i++) T.step(16);
  ok(g.level === lv0 + 1, `消行照常升级（${lv0} → ${g.level}）`);

  // ── 历史记录：曲线只画从头打的局，中途开局列在下面 ──
  a.push({ d: Date.now(), s: 400000, l: 220, lv: 37, t: 200000, p: 200, mid: 180, s0: 160000, l0: 180, t0: 470000 });
  localStorage.setItem(T.HIST_KEY, JSON.stringify(a));
  T.openHistSheet(); await wait(30);
  ok(/共 5 局/.test($('histSum').textContent) && $('histChart').querySelectorAll('circle').length === 5, '曲线和摘要只算从头打的 5 局');
  ok(/180 行起/.test($('histList').textContent) && $('histList').querySelectorAll('.hl-row.mid').length === 1, '中途开局那局列在下面，标着 180 行起');
  T.closeHistSheet();
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
            c = pg.evaluate("() => !document.getElementById('midBtn') && !document.getElementById('midSheet')")
            r.append(('PASS ' if c else 'FAIL ') + '疯狂版没有中途开局')
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'中途开局（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
