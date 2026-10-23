"""屏幕锁住：空白处拖不动、双指不缩放、双击不放大；弹层照样能滚。
练习 / 提示 / 每日练习的细栏在最底下，和按键排隔开，不贴着「变换」
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""async (eng) => {
  const T = __tetris, L = [], $ = id => document.getElementById(id);
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tm = (el, n) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
    const ts = Array.from({ length: n }, (_, i) => new Touch({ identifier: i + 1, target: el, clientX: x + i * 30, clientY: y }));
    const e = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: ts, targetTouches: ts, changedTouches: ts });
    el.dispatchEvent(e); return e.defaultPrevented;
  };
  ok(getComputedStyle(document.body).touchAction === 'none', `整页不让浏览器拖动 / 缩放（touch-action: ${getComputedStyle(document.body).touchAction}）`);
  const us = el => getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect;
  ok(['btnCw', 'hintWhy', 'score'].every(id => !$(id) || us($(id)) === 'none') && us(document.querySelector('#btnLeft em') || $('btnLeft')) === 'none',
     '按钮里的字、提示文字、分数：都不能长按选中');
  const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); $('btnCw').dispatchEvent(cm);
  const ss = new Event('selectstart', { bubbles: true, cancelable: true }); $('hintWhy').dispatchEvent(ss);
  ok(cm.defaultPrevented && ss.defaultPrevented, '长按菜单、开始选字：都拦住');
  ok(getComputedStyle(document.querySelector('.overlay .card')).touchAction === 'pan-y', '开局 / 结算卡还能上下滑');
  const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); document.body.dispatchEvent(dbl);
  ok(dbl.defaultPrevented, '双击被拦住');
  const g = new Event('gesturestart', { bubbles: true, cancelable: true }); document.dispatchEvent(g);
  ok(g.defaultPrevented, '双指缩放（gesturestart）被拦住');

  T.startHint(); await wait(300);
  let touchOk = true;
  try { new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: 0 }); } catch { touchOk = false; }
  if (touchOk){
    ok(tm(document.querySelector('.game'), 1), '空白处单指拖：页面不动');
    ok(tm($('board') || document.querySelector('canvas'), 1), '盘面上拖：页面不动');
    ok(tm(document.querySelector('.game'), 2), '两指：不动');
    $('hintRules').click(); await wait(400);
    const box = document.querySelector('#hintSheet .sheet-box');
    ok(box.scrollHeight > box.clientHeight && !tm(box.querySelector('.hr-rule') || box, 1), '规则卡内容超高：照样能滑着看');
    T.closeHintSheet(); await wait(300);
  }

  // ── 弹出面板只许上下滚：横向锁住（历史记录面板原来比自己宽 6px，斜着一划就左右漂） ──
  const a = []; for (let i = 0; i < 40; i++) a.push({ d: Date.now() - i * 36e5, s: 1234567, l: 246, lv: 42, t: 640000, p: 600, ...(i % 3 ? {} : { mid: 180, s0: 1 }) });
  localStorage.setItem(T.HIST_KEY, JSON.stringify(a));
  T.openHistSheet(); await wait(300);
  const hb = document.querySelector('#histSheet .sheet-box'), cs = getComputedStyle(hb);
  ok(cs.overflowX === 'hidden' && cs.overflowY === 'auto' && cs.touchAction === 'pan-y' && cs.overscrollBehaviorY === 'contain',
     `历史记录面板：横向锁住、只能上下滚、滚到头不带动后面（overflow-x ${cs.overflowX} / touch-action ${cs.touchAction}）`);
  ok(hb.scrollHeight > hb.clientHeight, '记录多的时候面板能上下滚');
  ok(getComputedStyle($('histChart').querySelector('svg')).touchAction === 'pan-y', '在曲线上也能上下划着滚');
  const bad = [...document.querySelectorAll('.sheet-box')].filter(b => getComputedStyle(b).overflowX !== 'hidden').length;
  ok(bad === 0, `所有弹出面板都横向锁住（没锁的 ${bad} 个）`);
  T.closeHistSheet(); await wait(200);

  // ── 细栏在最底下，和按键排隔开 ──
  for (const [name, start, bar] of [['提示', () => T.startHint(), 'hintBar'], ['练习', () => T.startPractice(), 'prBar']]){
    start(); await wait(400);
    const pads = document.querySelector('.pads').getBoundingClientRect(), b = $(bar).getBoundingClientRect();
    ok(b.height > 0 && b.top - pads.bottom >= 14 && b.bottom <= innerHeight - 8,
       `${name}细栏在按键排下面隔开 ${Math.round(b.top - pads.bottom)}px，底边 ${Math.round(b.bottom)} / ${innerHeight}`);
  }
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
        r = pg.evaluate(JS, eng)
        if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
        print(f'屏幕锁定和细栏位置（{eng}）')
        for l in r:
            print('  ', l)
            if l.startswith('FAIL'): fails += 1
        b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
