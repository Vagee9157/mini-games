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
  // 开局修行面板是硬门禁，不选完什么都动不了。测试里先随手选一张。
  // 开局会自动命中一张**随机**修行，必须清掉再量：不清的话长明把 zoneNeed
  // 20→12、缓冲把 delayCost 砍半、缓坡改灰线周期，断言就跟着骰子走 ——
  // 绿是那一掷没抽到相关的卡，不是对。
  const passUp = () => { T.ups.length = 0; };
  document.getElementById('startBtn').click(); passUp();
  T.heat = 2000;
  const per = T.garbagePeriod();

  // 窗口外不给
  T.garbageTimer = per - T.DELAY_WIN - 1000;
  ok(!T.canDelay(), '窗口外不提供缓期');

  // 进窗口
  T.garbageTimer = per - 2000;
  ok(T.canDelay(), '窗口内提供缓期');

  // 价格 = 热度 × DELAY_FRAC
  const want = Math.round(2000 * T.DELAY_FRAC);
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
  T.heat = T.DELAY_GATE - 1;
  ok(!T.canDelay(), `热度低于门槛 ${T.DELAY_GATE} 时不提供`);

  // 价格是纯比例 —— 原来还有个固定下限 150，而那正好推翻了「按比例收所以
  // 穷富一个价」那段论证：heat=300 时扣 150 是扣掉一半，不是 18%。
  T.heat = 400;
  ok(Math.abs(T.delayCost() - 400 * T.DELAY_FRAC) < 1,
     `价格恒为热度的 ${Math.round(T.DELAY_FRAC*100)}%（heat 400 → ${T.delayCost()}）`);
  T.heat = 4000;
  ok(Math.abs(T.delayCost() - 4000 * T.DELAY_FRAC) < 1,
     `热度十倍价格也十倍（heat 4000 → ${T.delayCost()}）—— 这才叫免标度`);

  // 钟停着的时候不给（缓流事件）
  T.heat = 2000;
  T.evForce('calm');
  ok(!T.canDelay(), '缓流期间不提供（钟本来就停着）');

  // 状态框按钮带 data-act
  // 瞬发事件不会覆盖 evActive，所以顶不掉 calm —— 直接重开一局拿干净状态
  document.getElementById('againBtn')?.click();
  document.getElementById('startBtn')?.click(); passUp();
  ok(!T.evActive, '重开后没有残留事件');
  T.heat = 2000; T.garbageTimer = T.garbagePeriod() - 2000;
  T.syncFx();
  // 缓期已经改成自动触发（危险区里自己付），状态框不再给按钮
  ok(!document.querySelector('#fxBox .fxgo[data-act="delay"]'), '状态框不再有缓期按钮');
  ok(T.fxRows().some(r => r.k === 'delay' && !r.go), '只剩一行「待命」，没有号召点击');

  // 注意位置：这一段必须排在上面那次重开**之后**。
  // 第一版插在 calm 测试和重开之间，于是「ZONE 期间不提供缓期」
  // 其实是被 calm 挡住才通过的，跟 ZONE 一点关系没有 —— 假阳性。
  // ZONE 期间钟是停的，不该提供缓期
  T.heat = 2000; T.garbageTimer = T.garbagePeriod() - 2000;
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  ok(!T.canDelay(), 'ZONE 期间不提供缓期（钟本来就停着）');
  const hz = T.heat; T.doDelay();
  ok(T.heat === hz, 'ZONE 期间 doDelay 不扣热度');
  T.zoneEnd('');
  T.heat = 2000; T.garbageTimer = T.garbagePeriod() - 2000;
  ok(T.canDelay(), 'ZONE 结束后又能缓了');

  // 真点交给 Playwright —— 处理器有 `if (!e.detail) return`（防 touchstart 重复触发），
  // JS 合成的 el.click() detail 是 0，会被挡掉，不是 bug
  return L;
}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,url in (('疯狂版','crazy/index.html'),('标准版','tetris/index.html')):
        pg=b.new_page(); errs=[]
        # 拦掉外网字体。index.html 的 Google Fonts 样式表是**渲染阻塞**的，
        # 而 pg.goto 默认等 load —— 网一慢整个文件就 Timeout，红绿和代码无关。
        # 实测撞到过两次：test_content / test_delay 整个挂掉，单独重跑又全绿。
        pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{url}")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        if name=='标准版':
            r=pg.evaluate("""() => { const T=__tetris; document.getElementById('startBtn').click();
              // 标准版没有修行面板，不需要 passUp（它只在疯狂版那个 JS 块里定义）
              T.heat=99999; T.garbageTimer = T.garbagePeriod()-2000;
              const before=T.heat; T.doDelay();
              // 必须带 PASS / FAIL 前缀 —— run_all.py 是按 ^\s+PASS / ^\s+FAIL 统计的，
              // 裸字符串既不计数也不报错，这个分支以前**永远不会红**，
              // 而它是「标准版纯 Guideline」承诺仅有的守门人之一
              const L=[]; const ok=(c,m)=>L.push((c?'PASS ':'FAIL ')+m);
              ok(T.canDelay()===false, '标准版 canDelay 恒为 false');
              ok(T.heat===before, '标准版 doDelay 无副作用');
              return L; }""")
        else:
            r=pg.evaluate(JS)
            # 缓期现在是自动触发的，没有按钮可点 —— 改成验「危险区里会自己付」
            auto=pg.evaluate('''() => { const T=__tetris;
              const B=T.game.board, R=B.length, C=B[0].length;
              for (let y=0;y<R;y++) for (let x=0;x<C;x++) B[y][x]=null;
              // delayUsed 在导出面上只有 getter，`T.delayUsed = false` 是静默失效的
              // （evaluate 不是 strict mode）。靠 riseGarbage 把额度正经还回来。
              T.heat = 3000; T.riseGarbage();
              T.garbageTimer = T.garbagePeriod() - 2000;
              const h0 = T.heat;
              T.delayAuto();
              const safe = T.heat;
              for (let y=2;y<R;y++) for (let x=0;x<C;x++) if (x!==5) B[y][x]='T';
              T.syncDanger(); T.delayAuto();
              return { h0, safe, danger: T.heat }; }''')
            r.append(('PASS ' if auto['safe']==auto['h0'] else 'FAIL ') + '不危险时自动缓期一分不动')
            r.append(('PASS ' if auto['danger']<auto['safe'] else 'FAIL ')
                     + f"进危险区自动付（{round(auto['safe'])}→{round(auto['danger'])}）")
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:3]: print("   !",e)
        for l in r: print("  ",l)
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
