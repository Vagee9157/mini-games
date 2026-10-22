"""顶栏菜单 + 历史记录

顶栏只留暂停和菜单；菜单里重开 / 历史记录 / 设置 / 音效（疯狂版多一个玩法说明），开着时这局停住。
历史记录每局正经局一条，看分数 / 行数 / 等级 / 每行均分 / 用时的曲线和最近的局。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async (crazy) => {
  const T = __tetris, L = [], $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  localStorage.removeItem(T.HIST_KEY);

  // ── 顶栏 ──
  const barBtns = [...document.querySelectorAll('.bar button')].filter(vis).map(b => b.id || b.textContent.trim());
  ok(vis($('pauseBtn')) && vis($('menuBtn')) && !['skinBtn', 'muteBtn', 'restartBtn', 'helpBtn'].some(id => barBtns.includes(id)),
     `顶栏只有暂停和菜单（${barBtns.filter(x => x).join(' / ')}）`);
  const bar = document.querySelector('.bar');
  ok(bar.scrollWidth <= bar.clientWidth + 1, `顶栏一行放得下（${bar.scrollWidth} / ${bar.clientWidth}）`);

  // ── 菜单：开着时停住，关了接着走 ──
  $('startBtn').click(); await wait(200);
  $('menuBtn').click();
  ok(!$('menuSheet').hidden && T.game.frozen, '点菜单：面板出来，这局停住');
  const items = [...document.querySelectorAll('#menuSheet .mi')].filter(vis).map(b => b.querySelector('b').textContent);
  ok(items.join(',') === (crazy ? '重新开始,历史记录,设置,音效,玩法说明' : '重新开始,历史记录,设置,音效'), `菜单里：${items.join(' / ')}`);
  const tx0 = $('muteTx').textContent; $('muteBtn').click();
  ok($('muteTx').textContent !== tx0 && !$('menuSheet').hidden, `点音效：当场切换（${tx0} → ${$('muteTx').textContent}），菜单还开着`);
  $('muteBtn').click();
  $('menuClose').click(); await wait(50);
  ok($('menuSheet').hidden && !T.game.frozen, '关菜单：接着打');

  $('menuBtn').click(); $('histBtn').click(); await wait(50);
  ok($('menuSheet').hidden && !$('histSheet').hidden && T.game.frozen, '菜单 → 历史记录：菜单收起，历史记录打开，这局还停着');
  ok(/还没有记录/.test($('histChart').textContent), '没打过：说还没有记录');
  $('histClose').click(); await wait(50);
  ok($('histSheet').hidden && !T.game.frozen, '关历史记录：接着打');
  $('menuBtn').click(); $('restartBtn').click(); await wait(50);
  ok($('menuSheet').hidden && !$('restartSheet').hidden, '菜单 → 重新开始：出重开面板');
  T.closeRestartSheet && T.closeRestartSheet(); $('rsClose') && $('rsClose').click(); await wait(50);
  $('menuBtn').click(); $('skinBtn').click(); await wait(50);
  ok($('menuSheet').hidden && !$('styleSheet').hidden, '菜单 → 设置：出设置面板');
  $('skinDone').click(); await wait(50);

  // ── 记录：正经局记，练习 / 提示不记 ──
  T.game.pieces = 60; T.game.lines = 30; T.game.level = 6; T.game.score = 12345; T.game.elapsed = 95000;
  T.endGame('堆到顶了');
  let h = T.histRead();
  ok(h.length === 1 && h[0].s === 12345 && h[0].l === 30 && h[0].lv === 6 && h[0].t === 95000 && h[0].d > 0,
     `打完一局记一条（分 ${h[0] && h[0].s}、行 ${h[0] && h[0].l}、级 ${h[0] && h[0].lv}、用时 ${h[0] && h[0].t}）`);
  $('againBtn').click(); T.game.pieces = 5; T.endGame('堆到顶了');
  ok(T.histRead().length === 1, '秒死（5 块）不记');
  if (!crazy){
    T.startHint(); T.game.pieces = 60; T.endGame('堆到顶了');
    ok(T.histRead().length === 1, '提示模式不记');
  }

  // ── 曲线 ──
  const a = []; for (let i = 0; i < 30; i++) a.push({ d: Date.now() - (30 - i) * 3600e3, s: 1000 * (i + 1), l: 10 + i, lv: 2 + (i >> 2), t: 60000 + i * 1000, p: 50 });
  localStorage.setItem(T.HIST_KEY, JSON.stringify(a));
  T.openHistSheet(); await wait(50);
  const svg = () => $('histChart').querySelector('svg');
  ok(svg() && svg().querySelectorAll('circle').length === 20, `近 20 局：画 20 个点（${svg() && svg().querySelectorAll('circle').length}）`);
  ok(/最高 3万/.test(svg().textContent) && /共 30 局/.test($('histSum').textContent), `标出最高那局，摘要写共 30 局（${$('histSum').textContent}）`);
  ok(/第 30 局/.test($('histTip').textContent), `默认说的是最后一局（${$('histTip').textContent}）`);
  document.querySelector('#histRange [data-hn="0"]').click();
  ok(svg().querySelectorAll('circle').length === 30, '全部：30 个点');
  document.querySelector('#histMetric [data-hm="lv"]').click();
  ok(/最高 9/.test(svg().textContent) && document.querySelector('#histMetric [data-hm="lv"]').classList.contains('on'), '换成等级：曲线换成等级（最高 9 级）');
  const r = svg().getBoundingClientRect();
  svg().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width * 44 / 340 + 1, clientY: r.top + 40 }));
  ok(/第 1 局/.test($('histTip').textContent), `点最左边：看第 1 局（${$('histTip').textContent}）`);
  ok($('histList').querySelectorAll('.hl-row').length === 31 && /★/.test($('histList').textContent), '下面列最近 30 局，最高分带星');
  ok(JSON.parse(localStorage.getItem(T.HIST_KEY)).length === 30, '看历史不改数据');
  T.closeHistSheet();
  return L;
}"""

fails = 0
with sync_playwright() as p:
    for eng in ('chromium', 'webkit'):
        b = getattr(p, eng).launch()
        for ver in ('tetris', 'crazy'):
            if eng == 'webkit' and ver == 'crazy': continue
            pg = b.new_page(**p.devices['iPhone 13']); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
            pg.goto(f"http://127.0.0.1:{port}/{ver}/index.html"); pg.wait_for_function("() => !!window.__tetris")
            r = pg.evaluate(JS, ver == 'crazy')
            if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
            print(f'菜单和历史记录（{ver} · {eng}）')
            for l in r:
                print('  ', l)
                if l.startswith('FAIL'): fails += 1
            pg.close()
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
