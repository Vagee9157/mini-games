"""全面检查（第一批）查出来的 bug，每条钉一个回归：
中途开局 / 标槽局实时刷最高分、疯狂版 Esc 关说明冻住、续玩丢复盘计数和标槽、中途开局回不到普通、NES 残留 mid、
面板里松手被吞、T 旋练习重开掉速度、IRS + 缓冲转两次、历史摘要被覆盖、中途开局一开就能收手、不消行的 T 旋没记"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H)
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

PRE = r"""
  const T = __tetris, L = [], R = T.TOTAL_ROWS, $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };
  const load = rows => { for (let y = 0; y < R; y++) T.game.board[y].fill(null);
    rows.forEach((r, i) => { for (let x = 0; x < 10; x++) T.game.board[R - rows.length + i][x] = r[x] === '#' ? 'J' : null; }); };
  const give = t => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
  const clear1 = () => { load(['###....###']); give('I'); const p = T.game.piece; p.x = 3; p.rot = 0; p.y = 0; T.hardDrop(); settle(); };
  const key = (code, t) => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true }));
"""
STD = r"""async () => {""" + PRE + r"""
  localStorage.removeItem(T.HIST_KEY);
  // ── 中途开局 / 标槽：消行时不刷最高分 ──
  T.startMid(180); T.game.noGarbage = true; const b0 = T.game.best; clear1();
  ok(T.game.best === b0 && T.game.lines === 181, `中途开局消一行：最高分不动（${T.game.best}）`);
  $('menuBtn').click(); $('restartBtn').click(); await wait(20);
  const nb = document.querySelector('#rsModes [data-rs="normal"]');
  ok(!nb.hidden, '中途开局里重开面板有「普通」');
  nb.click(); await wait(20);
  ok(!T.mid && T.game.lines === 0, '点「普通」：回到从头打的普通局');
  T.setAid('ts', true); T.game.noGarbage = true; clear1();
  ok(T.game.best === b0, '开着标 T 槽消一行：最高分不动');
  T.setAid('ts', false);

  // ── 续玩：复盘计数和标槽跟着存档走 ──
  T.setAid('ts', true); $('againBtn').click(); T.restart(); T.game.noGarbage = true;
  ok(T.game.run.aidTs, '开着标槽开的局');
  T.game.run.clr[4] = 7; T.game.run.tsc[2] = 3; T.game.run.holes = 11; T.game.pieces = 200; T.saveGame(true);
  T.setAid('ts', false);
  T.restoreGame(T.readSave());
  ok(T.game.run.clr[4] === 7 && T.game.run.tsc[2] === 3 && T.game.run.holes === 11 && T.game.run.aidTs,
     `续玩后四消 / T 旋 / 洞 / 标槽都还在（四消 ${T.game.run.clr[4]}、标槽 ${T.game.run.aidTs}）`);
  T.restart();

  // ── NES 清掉 mid ──
  T.startMid(180); T.startNes(9); T.exitPractice ? T.exitPractice() : 0;
  ok(!T.mid, '中途开局后切 NES：中途开局的状态清掉');

  // ── 面板里松手 ──
  T.restart(); T.game.noGarbage = true; load([]); give('O'); T.game.piece.x = 4;
  key('ArrowLeft', 'keydown'); key('KeyR', 'keydown'); key('ArrowLeft', 'keyup'); await wait(20);
  T.closeRestartSheet(); const x0 = T.game.piece.x; await wait(500);
  ok(T.game.piece.x === x0, `按住 ← 弹面板、在面板里松手：关掉后方块不再自己滑（${x0} → ${T.game.piece.x}）`);

  // ── IRS + 缓冲不转两次 ──
  load(['#########.', '#########.', '#########.', '#########.']); give('I'); { const p = T.game.piece; p.rot = 1; p.x = 7; p.y = 0; }
  T.game.queue[0] = 'T'; T.hardDrop();
  ok(!!T.clearing, '消行动画中');
  key('ArrowUp', 'keydown');            // 按下不放
  settle(); key('ArrowUp', 'keyup');
  ok(T.game.piece && T.game.piece.type === 'T' && T.game.piece.rot === 1, `动画里按住变换：新块只转一次（朝向 ${T.game.piece && T.game.piece.rot}）`);

  // ── 不消行的 T 旋记上：右边一列全空，T 转进槽也凑不满行 ──
  load(['.....####.', '###...###.', '####.####.']); give('T');
  const z0 = T.game.run.tsc[0];
  const m = T.simReach(T.simBoard(), 'T').find(l => l.spin === 'tspin' && l.lines === 0);
  if (m){ for (const a of T.parseActs(m.acts)) T.doAct(a); T.doAct('H'); settle(); }
  ok(!!m && T.game.run.tsc[0] === z0 + 1, `不消行的 T 旋记进复盘（${z0} → ${T.game.run.tsc[0]}）`);

  // ── T 旋练习重开保速度 ──
  T.setTsSpeed(20); T.startTspin();
  ok(T.game.level === 20, 'T 旋练习快速：20 级');
  $('menuBtn').click(); $('restartBtn').click(); $('rsAgain').click(); await wait(20);
  ok(T.tsOn() && T.game.level === 20, `重开 T 旋练习：还是 20 级（${T.game.level}）`);
  T.setTsSpeed(1);
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);

  // ── 每日练习热身：题间停顿的定时器不能在菜单底下把游戏解冻 ──
  T.startDrill(); await wait(30); $('drGo').click(); await wait(50);
  if (T.game.piece){ T.hardDrop(); }                  // 随手一放：多半放错，进题间停顿
  $('menuBtn').click(); await wait(1500);
  ok(!$('menuSheet').hidden && T.game.frozen, `热身段放完一块马上开菜单，1.5 秒后还停着（frozen=${T.game.frozen}）`);
  T.closeMenu(); await wait(50);
  ok(!T.game.frozen && $('drSheet').hidden, '关掉菜单：接着练');
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);

  // ── 历史全是中途局：摘要说清楚 ──
  localStorage.setItem(T.HIST_KEY, JSON.stringify([{ d: Date.now(), s: 300000, l: 220, lv: 37, t: 1e5, p: 100, mid: 180, s0: 1e5, l0: 180 }]));
  T.openHistSheet(); await wait(20);
  ok(/共 1 局，都是中途开局/.test($('histSum').textContent), `历史只有中途局：摘要「${$('histSum').textContent.slice(0, 18)}…」`);
  T.closeHistSheet();

  // ── 界面四条：每个模式都显示 BEST、提示栏结束收起、每日练习四段、复盘长行不截断 ──
  const bestBox = () => !$('best').parentElement.hidden;
  T.restart(); await wait(20);
  ok(bestBox(), '普通局：右栏有 BEST');
  T.startMid(180); await wait(20);
  ok(bestBox() && $('best').textContent === '30万', `中途开局：右栏有 BEST，显示这一档打过的最好成绩（${$('best').textContent}）`);
  T.startMid(220); await wait(20);
  ok(bestBox() && $('best').textContent === '—', `中途开局：这一档还没打过就写「—」（不是 0：15 万分旁边一个 0 像出了 bug）（${$('best').textContent}）`);
  T.startPractice(); await wait(20);
  ok(bestBox(), '练习：也有 BEST（总纪录当参照）');
  T.startHint(); await wait(20);
  ok(bestBox() && getComputedStyle($('hintBar')).visibility === 'visible', '提示模式打着：BEST 在，提示栏也在');
  T.endGame('堆到顶了'); await wait(20);
  ok(getComputedStyle($('hintBar')).visibility === 'hidden', '提示模式结束：提示栏收起来，不挂在结算页上');
  ok(/挖灰线/.test($('prDaily').textContent), `每日练习入口写四段（${$('prDaily').textContent}）`);
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);
  $('startBtn').click(); T.game.noGarbage = true;
  Object.assign(T.game.run, { seg: [[90000, 100], [150000, 100], [200000, 46]] });
  T.game.pieces = 600; T.game.lines = 246; T.game.score = 440000; T.game.elapsed = 600000;
  T.endGame('堆到顶了'); await wait(2500);
  const segB = [...$('rvStats').querySelectorAll('span.w')].find(e => /分段每行/.test(e.textContent));
  const bb = segB && segB.querySelector('b');
  ok(bb && /200 后/.test(bb.textContent) && bb.scrollWidth <= bb.clientWidth + 1, `复盘「分段每行」三段都看得到（${bb && bb.textContent}）`);

  // ── 顶栏：选中的模式要亮、点击区够大、打到一半切模式先确认；NES 第一次默认 9 级；结算卡一行 ──
  const lit = () => [...document.querySelectorAll('#modeSw [data-m]')].filter(x => x.classList.contains('on')).map(x => x.dataset.m).join(',');
  T.startNes(9); await wait(20);
  ok(lit() === 'normal', `NES 局：「普通」那格亮着（${lit()}）`);
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);
  ok(!T.nes, 'NES 里点亮着的「普通」：照旧退回普通（这是 NES / 对战的出口）');
  T.startHint(); await wait(20);
  document.querySelector('#modeSw [data-m="hint"]').click(); await wait(20);
  ok(T.hintMode, '提示模式里点亮着的「提示」：不动');
  T.exitPractice(); T.startVs(1); await wait(20);
  ok(lit() === 'normal', '对战局：「普通」亮着');
  T.exitPractice(); T.startHint(); await wait(20);
  ok(lit() === 'hint', '提示模式：「提示」亮着');
  T.startTspin(); await wait(20);
  ok(lit() === 'practice', 'T 旋练习：「练习」亮着');
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);
  ok(!T.nes && !T.hintMode, '从 T 旋练习点「普通」：回普通');
  const sw = [...document.querySelectorAll('#modeSw button')].map(x => x.getBoundingClientRect());
  const bk = document.querySelector('.back').getBoundingClientRect();
  ok(sw.every(r => r.height >= 30 && r.width >= 40) && sw[0].left - bk.right >= 12, `模式开关每格 ${Math.round(sw[0].width)}×${Math.round(sw[0].height)}，「合集」隔开 ${Math.round(sw[0].left - bk.right)}px`);
  ok(getComputedStyle(document.querySelector('#modeSw button'), '::after').content !== 'none', '点击区往外扩（::after）');
  $('startBtn').click(); T.game.noGarbage = true; T.game.pieces = 40;
  document.querySelector('#modeSw [data-m="practice"]').click(); await wait(20);
  ok(!$('leaveSheet').hidden && !T.practice && T.game.frozen, '普通局打了 40 块点「练习」：先问一句，这局停着');
  $('leaveStay').click(); await wait(20);
  ok($('leaveSheet').hidden && !T.game.frozen && !T.practice, '点「接着打」：回到这局');
  document.querySelector('#modeSw [data-m="hint"]').click(); await wait(20);
  ok(/提示/.test($('leaveGo').textContent), '点「提示」：按钮写「去提示模式」');
  $('leaveGo').click(); await wait(20);
  ok(T.hintMode && !!T.readSave(), '点「去提示模式」：切过去，这局存着');
  document.querySelector('#modeSw [data-m="normal"]').click(); await wait(20);
  $('startBtn').click(); T.game.pieces = 3;
  document.querySelector('#modeSw [data-m="practice"]').click(); await wait(20);
  ok($('leaveSheet').hidden && T.practice, '刚开局（3 块）点「练习」：直接切，不问');
  T.exitPractice();
  localStorage.removeItem('tetris.nes.v1');
  T.openNesSheet && T.openNesSheet(); await wait(20);
  ok(/起始 9 级/.test($('nesGo').textContent), `第一次打开 NES：默认 9 级（${$('nesGo').textContent}）`);
  $('nesSheet').hidden = true; T.game.frozen = false;
  $('startBtn').click(); T.game.score = 240000; T.game.lines = 246; T.game.level = 42; T.endGame('堆到顶了'); await wait(30);
  ok(/240,000/.test($('overScore').textContent) && $('overLines').textContent === '246' && $('overLevel').textContent === '42'
     && document.querySelector('.final').getBoundingClientRect().height < 90, `结算卡：分数一行 +「最高 · 行 · 级」一行（高 ${Math.round(document.querySelector('.final').getBoundingClientRect().height)}px）`);

  // ── 中途开局一开局不能「收手」 ──
  T.startMid(200); await wait(20); $('pauseBtn').click(); await wait(20);
  ok($('stopBtn').hidden, '中途开局刚开就暂停：没有「收手」（开局送的块不算）');
  $('pauseBtn').click();
  return L;
}"""
CRZ = r"""async () => {""" + PRE + r"""
  $('startBtn').click(); await wait(50);
  $('menuBtn').click(); $('helpBtn').click(); await wait(50);
  ok(!$('helpSheet').hidden && T.game.frozen, '疯狂版：菜单 → 玩法说明，这局停着');
  key('Escape', 'keydown'); await wait(30);
  ok($('helpSheet').hidden && !T.game.frozen, 'Esc 关掉说明：接着打（原来一直冻住）');
  T.openRankSheet(); await wait(20);
  ok(T.game.frozen, '打开段位面板：这局停住');
  $('rankDone').click(); await wait(20);
  ok(!T.game.frozen, '关掉段位面板：接着打');
  return L;
}"""

fails = 0
with sync_playwright() as p:
    for eng in ('chromium', 'webkit'):
        b = getattr(p, eng).launch()
        for ver, js in (('tetris', STD), ('crazy', CRZ)):
            pg = b.new_page(**p.devices['iPhone 13']); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
            pg.goto(f"http://127.0.0.1:{port}/{ver}/index.html"); pg.wait_for_function("() => !!window.__tetris")
            r = pg.evaluate(js)
            if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
            print(f'全面检查修复（{ver} · {eng}）')
            for l in r:
                print('  ', l)
                if l.startswith('FAIL'): fails += 1
            pg.close()
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
