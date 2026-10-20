"""手机竖屏兼容：9 种主流竖屏尺寸 × 5 种状态（开局 / 普通 / 练习 / 提示 / 每日练习）

只管手机竖屏（横屏和桌面不在这里）。每个尺寸、每种状态都查：
  ① 页面能不能被滚动 —— 直接去滚 body 和 documentElement，看动不动。
     之前的布局测试只量 documentElement 的滚动高度，而 body 自己设了 overflow:hidden、
     把溢出截在了自己那一层，documentElement 永远是 0。实际上每个尺寸都能被滚 53~115px，
     点一下「开始」顶栏就被顶出屏幕。
  ② 顶栏折行
  ③ 右栏每个框、以及框里的画布不越界 —— 之前只量了框没量画布，375 宽上 NEXT 画布
     98px 塞在 64px 的框里溢出 34px，一直没被发现（测试刚好只跑了 390 和 320）
  ④ 每个键（含软降）不小于 44pt
  ⑤ 横向不溢出
拿修复之前的版本跑这个文件是 84 个问题，修完 0 个。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
threading.Thread(target=srv.serve_forever,daemon=True).start()
port=srv.server_address[1]
from playwright.sync_api import sync_playwright
M = r"""() => {
  const R = e => e.getBoundingClientRect();
  const iss = [];
  // ① body 内部能不能被滚（之前的盲区：只量 documentElement）
  const bo = document.body.scrollHeight - document.body.clientHeight;
  if (bo > 0) iss.push('body 溢出 ' + bo + 'px');
  // 直接试着滚：点击/聚焦就是这么把顶栏顶出屏幕的
  document.body.scrollTop = 200; document.documentElement.scrollTop = 200;
  const moved = document.body.scrollTop + document.documentElement.scrollTop;
  document.body.scrollTop = 0; document.documentElement.scrollTop = 0;
  if (moved > 0) iss.push('页面能被滚动 ' + moved + 'px');
  // ② 顶栏折行
  const bar = document.querySelector('.bar');
  if (bar.scrollWidth > bar.clientWidth + 1) iss.push('顶栏折行');
  // ③ 右栏每个框、以及框里的画布都不越界（之前只量了框，没量画布）
  const hb = R(bar).bottom, pt = R(document.querySelector('.pads')).top;
  for (const c of document.querySelector('.side').children){
    const r = R(c); if (!r.height || getComputedStyle(c).display === 'none') continue;
    if (r.top < hb - 0.5 || r.bottom > pt + 0.5) iss.push('右栏越界 ' + (c.id || c.className));
    for (const cv of c.querySelectorAll('canvas')){
      const q = R(cv);
      if (q.left < r.left - 0.5 || q.right > r.right + 0.5) iss.push('画布越出框 ' + (c.className) + ' ' + Math.round(q.width) + '>' + Math.round(r.width));
    }
  }
  // ④ 键不小于 44
  for (const k of document.querySelectorAll('.pads .k, #btnSoft')){
    const r = R(k); if (Math.min(r.width, r.height) < 44) iss.push('键太小 ' + k.id + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  // ⑤ 横向不溢出
  if (document.documentElement.scrollWidth > innerWidth + 1) iss.push('横向溢出');
  const cell = +(R(document.querySelector('.board-box')).height / 20).toFixed(1);
  return { iss, cell };
}"""
SIZES = [('SE 1代',320,568,'safari'), ('SE 2/3',375,667,'safari'), ('mini / X',375,812,'app'),
         ('13/14',390,664,'safari'), ('13/14 主屏',390,844,'app'), ('15/16',393,659,'safari'),
         ('17/16 Pro 主屏',402,874,'app'), ('Plus/Pro Max',430,932,'app'), ('17 Pro Max',440,956,'app')]
bad = 0
with sync_playwright() as p:
    b = p.webkit.launch()
    base = dict(p.devices['iPhone 13'])
    for name, w, h, kind in SIZES:
        d = dict(base); d['viewport'] = {'width': w, 'height': h}
        row = []
        for mode in ('start', 'normal', 'practice', 'hint', 'drill'):
            pg = b.new_page(**d); pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
            pg.goto(f"http://127.0.0.1:{port}/tetris/index.html" + ("?mode=app" if kind=='app' else ""))
            pg.wait_for_function("() => !!window.__tetris")
            if mode == 'normal': pg.evaluate("() => document.getElementById('startBtn').click()")
            if mode == 'practice': pg.evaluate("() => { __tetris.startPractice(); __tetris.practiceLoad('tsd4'); }")
            if mode == 'hint': pg.evaluate("() => document.querySelector('#modeSw [data-m=\"hint\"]').click()")
            # 每日练习的堆叠段：细栏换成它自己的那条（提示细栏收起），盘面只让出一行
            if mode == 'drill': pg.evaluate("() => { __tetris.startDrill(); __tetris.drillSkip(); __tetris.drillGo(); }")
            pg.wait_for_timeout(250)
            m = pg.evaluate(M)
            tag = f"{name} {w}×{h} {mode}"
            if m['iss']:
                for i in m['iss']: print(f"   FAIL {tag}：{i}")
                bad += len(m['iss'])
            else:
                print(f"   PASS {tag}（格子 {m['cell']}px）")
            pg.close()
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if bad else 0)
