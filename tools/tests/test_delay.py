import os, http.server, socketserver, threading, functools, json
ROOT=os.getcwd()
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
JS = r"""() => {
  const T = __tetris, L = [];
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  document.getElementById('startBtn').click();
  T.heat = 2000;
  const per = T.garbagePeriod();

  // 窗口外不给
  T.garbageTimer = per - T.DELAY_WIN - 1000;
  ok(!T.canDelay(), '窗口外不提供缓期');

  // 进窗口
  T.garbageTimer = per - 2000;
  ok(T.canDelay(), '窗口内提供缓期');

  // 价格 = 热度 × DELAY_FRAC
  const want = Math.max(T.DELAY_MIN, Math.round(2000 * T.DELAY_FRAC));
  ok(T.delayCost() === want, `价格现算 ${T.delayCost()} == ${want}`);

  // 执行
  const h0 = T.heat, g0 = T.garbageTimer;
  T.doDelay();
  ok(Math.abs(T.heat - (h0 - want)) < .01, `扣费正确 ${h0}→${Math.round(T.heat)}`);
  ok(Math.abs(T.garbageTimer - (g0 - T.DELAY_MS)) < .01, `钟往回推 ${T.DELAY_MS}ms`);
  ok(T.delayUsed === true, '标记已用');
  ok(!T.canDelay(), '同一行灰线不能缓第二次');

  // 灰线上来之后额度回来
  T.garbageTimer = per - 2000;
  T.riseGarbage();
  ok(T.delayUsed === false, '灰线上来后额度回来');
  T.garbageTimer = T.garbagePeriod() - 2000;
  ok(T.canDelay(), '新一行又能缓了');

  // 热度不够不给
  T.heat = T.DELAY_MIN - 1;
  ok(!T.canDelay(), '热度不够不提供');

  // 价格有下限
  T.heat = 10;
  ok(T.delayCost() === T.DELAY_MIN, '价格有下限 ' + T.DELAY_MIN);

  // 钟停着的时候不给（缓流事件）
  T.heat = 2000;
  T.evForce('calm');
  ok(!T.canDelay(), '缓流期间不提供（钟本来就停着）');

  // 状态框按钮带 data-act
  // 瞬发事件不会覆盖 evActive，所以顶不掉 calm —— 直接重开一局拿干净状态
  document.getElementById('againBtn')?.click();
  document.getElementById('startBtn')?.click();
  ok(!T.evActive, '重开后没有残留事件');
  T.heat = 2000; T.garbageTimer = T.garbagePeriod() - 2000;
  T.syncFx();
  const b = document.querySelector('#fxBox .fxgo[data-act="delay"]');
  ok(!!b, '状态框出现缓期按钮且带 data-act');
  // 真点交给 Playwright —— 处理器有 `if (!e.detail) return`（防 touchstart 重复触发），
  // JS 合成的 el.click() detail 是 0，会被挡掉，不是 bug
  return L;
}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,url in (('疯狂版','crazy/index.html'),('标准版','tetris/index.html')):
        pg=b.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{url}")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        if name=='标准版':
            r=pg.evaluate("""() => { const T=__tetris; document.getElementById('startBtn').click();
              T.heat=99999; T.garbageTimer = T.garbagePeriod()-2000;
              const before=T.heat; T.doDelay();
              return ['标准版 canDelay = '+T.canDelay()+' (要 false)', '标准版 doDelay 无副作用 = '+(T.heat===before)]; }""")
        else:
            r=pg.evaluate(JS)
            # 真实鼠标点击那颗按钮
            h0=pg.evaluate("() => __tetris.heat")
            pg.click('#fxBox .fxgo[data-act="delay"]')
            h1=pg.evaluate("() => __tetris.heat")
            r.append(('PASS ' if h1 < h0 else 'FAIL ') + f'真实点击扣了热度 {round(h0)}→{round(h1)}')
            r.append(('PASS ' if pg.evaluate("() => document.getElementById('helpSheet').hidden") else 'FAIL ')
                     + '点缓期按钮不会顺手打开说明书')
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:3]: print("   !",e)
        for l in r: print("  ",l)
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
