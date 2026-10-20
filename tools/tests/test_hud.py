"""侧栏数字和预览框：性能优化之后行为不变

三处优化各自锁一条：
  · fmtScore 手写千分位 —— 0~9999 每个数都要和 toLocaleString 给的一样，万/亿照旧
  · setStat 文字没变不碰 DOM、字号档没变不改 --fit —— 但字数一变，字号必须跟着变
  · drawPreview 用 layout() 量好的尺寸 —— 任何屏幕尺寸下，量好的都要和实际一致
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
  // ① 千分位
  let bad = [];
  for (let v = 0; v < 10000; v++) if (T.fmtScore(v) !== v.toLocaleString('en-US')) bad.push(v);
  for (const v of [999.4, 999.6, 1000.4, 9999.4]) if (T.fmtScore(v) !== Math.round(v).toLocaleString('en-US')) bad.push(v);
  ok(!bad.length, `0~9999 都和 toLocaleString 一致（不一致 ${bad.slice(0, 5)}）`);
  ok(T.fmtScore(9999.6) === '1万' && T.fmtScore(123456) === '12.35万' && T.fmtScore(250000000) === '2.5亿',
     `进位到万/亿照旧（${T.fmtScore(9999.6)} / ${T.fmtScore(123456)} / ${T.fmtScore(250000000)}）`);

  // ② setStat
  const el = document.getElementById('lines');
  let muts = 0;
  const mo = new MutationObserver(ms => { muts += ms.length; });
  mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  T.setStat(el, '12'); await Promise.resolve();
  const m1 = muts;
  T.setStat(el, '12'); T.setStat(el, '12'); await Promise.resolve();
  ok(m1 > 0 && muts === m1, `同样的字再写两遍不碰 DOM（第一次 ${m1} 处变化，之后 +${muts - m1}）`);
  T.setStat(el, '12345678'); await Promise.resolve();
  ok(el.textContent === '12345678' && el.style.getPropertyValue('--fit') === '0.66', `字数变了字号跟着变（--fit ${el.style.getPropertyValue('--fit')}）`);
  T.setStat(el, '7');
  ok(el.textContent === '7' && el.style.getPropertyValue('--fit') === '1', `变回短的字号复原（--fit ${el.style.getPropertyValue('--fit')}）`);
  mo.disconnect();

  // ③ 预览尺寸
  document.getElementById('startBtn').click();
  const cv = document.getElementById('nextCv');
  const near = () => Math.abs(cv._w - cv.getBoundingClientRect().width) < .5 && Math.abs(cv._h - cv.getBoundingClientRect().height) < .5;
  ok(cv._w > 0 && near(), `开局量好的预览尺寸对得上（${cv._w && cv._w.toFixed(1)}×${cv._h && cv._h.toFixed(1)}）`);
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
    # 预览框尺寸由 CSS 定，各尺寸不一定不同；要锁的是「任何屏幕尺寸下，量好的 = 实际的」，
    # 否则画的时候按旧尺寸算，方块会偏、会被裁
    mism = []
    for w, h in [(320, 568), (375, 667), (375, 812), (390, 664), (390, 844), (393, 659), (402, 874), (430, 932), (440, 956), (844, 390)]:
        pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(250)
        c, l = pg.evaluate("() => { const cv = document.getElementById('nextCv'), hv = document.getElementById('holdCv');"
                           "  return [[cv._w, cv._h, hv._w, hv._h], [cv.getBoundingClientRect().width, cv.getBoundingClientRect().height,"
                           "          hv.getBoundingClientRect().width, hv.getBoundingClientRect().height]]; }")
        if any(abs(a - b) > .5 for a, b in zip(c, l)): mism.append(f'{w}×{h} 量好 {c} 实际 {l}')
    r.append(('PASS ' if not mism else 'FAIL ') + '10 种屏幕尺寸（含横屏）来回切，NEXT/HOLD 量好的尺寸都和实际一致' + ('：' + '; '.join(mism) if mism else ''))
    if errs: r.append('FAIL 页面报错：' + '; '.join(errs))
    print('侧栏数字和预览框')
    for l in r:
        print('  ', l)
        if l.startswith('FAIL'): fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
