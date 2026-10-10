import os, http.server, socketserver, threading, functools
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
  const Z = T.ZONE;   // 别写死：标记字母改过一次（原来撞了 Z 型方块）
  const B = () => T.game.board;
  const ROWS = B().length, COLS = B()[0].length;
  const solid = () => B().reduce((a,r)=>a + r.filter(Boolean).length, 0);
  const zrows = () => B().filter(r => r.every(c => c === Z)).length;
  const fill = (y, except) => { for (let x=0;x<COLS;x++) B()[y][x] = (x===except? null : 'T'); };
  const fillRow = fill;
  const clean = () => { for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) B()[y][x]=null; };
  const fresh = () => { document.getElementById('againBtn')?.click();
                        document.getElementById('startBtn')?.click(); passUp(); };

  document.getElementById('startBtn').click(); passUp();

  // ── 攒条 ──
  ok(!T.zoneReady(), '没攒够不就绪');
  T.zoneCharge = T.ZONE_NEED;
  ok(T.zoneReady(), '攒够就就绪');

  // ── 启动 ──
  T.zoneStart();
  ok(T.zoneLeft > 0, '启动后在计时');
  ok(T.zoneCharge === 0, '启动后攒条清零');
  ok(document.body.classList.contains('zoning'), 'body 挂上 zoning');

  // ── 消一行：应该沉到底，不是消失 ──
  // 先把盘面清干净再铺一个可控场景
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) B()[y][x]=null;
  fill(ROWS-1);            // 底行填满
  B()[ROWS-3][0] = 'T';    // 上方留一颗当参照
  const before = solid();
  T.applyClear([ROWS-1]);
  ok(zrows() === 1, 'ZONE 期间消行沉成 1 行死行，没消失');
  ok(T.zoneRows === 1, 'zoneRows 计数 = 1');
  ok(solid() === before, `格子总数守恒 ${before} → ${solid()}`);
  ok(B()[ROWS-1].every(c => c === Z), '死行在最底下');
  ok(B()[ROWS-3][0] === 'T', '消行之上的堆原地不动（地板涨了，净位移为零）');

  // ── 死行不会被当成满行消掉 ──
  // 原来这里两次 zrows() 之间什么都没做，断言恒真；而且 clearFullNow 当时
  // 根本没导出（三目两边都是 0），连「能不能调到」都没验。
  // 改成真的走一遍工具清行那条路 —— 它是 ZONE 之外第二条会调 applyClear 的路径。
  const lockedBefore = zrows();
  T.collapseCols([0,1,2,3,4,5,6,7,8,9]);     // 内部会调 clearFullNow → applyClear
  ok(zrows() === lockedBefore,
     `死行不会被工具清行当成满行消掉（${lockedBefore} → ${zrows()}）`);

  // ── 封顶提前结算 ──
  for (let i = 0; i < T.ZONE_MAX + 2; i++){
    if (T.zoneLeft <= 0) break;
    fill(ROWS - 1 - T.zoneRows);
    T.applyClear([ROWS - 1 - T.zoneRows]);
  }
  ok(T.zoneLeft <= 0, `沉到 ${T.ZONE_MAX} 行提前结算`);
  ok(zrows() === 0, '结算后死行清空');
  ok(!document.body.classList.contains('zoning'), '结算后 zoning 摘掉');

  // ── 奖金公式 ──
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) B()[y][x]=null;
  for (let i = 0; i < 5; i++){ fill(ROWS-1-i); }
  T.applyClear([ROWS-1,ROWS-2,ROWS-3,ROWS-4,ROWS-5]);
  ok(T.zoneRows === 5, '一次消 5 行沉 5 行');
  const s0 = T.game.score;
  const want = Math.round(T.ZONE_UNIT * 25 / T.ZONE_CURVE * T.levelMult(T.game.level) * T.crazyScoreMult());
  T.zoneEnd('');
  ok(Math.abs((T.game.score - s0) - want) <= 1, `奖金 = UNIT×k²/CURVE×倍率  得 ${T.game.score-s0} 期望 ${want}`);

  // ── 重力冻结 ──
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  T.spawnNext && T.spawnNext();
  const py = T.game.piece ? T.game.piece.y : null;
  T.step(3000);
  ok(T.game.piece == null || T.game.piece.y === py, 'ZONE 期间重力停住（方块没自己掉）');

  // ── 灰线钟冻结 ──
  const g0 = T.garbageTimer;
  T.step(4000);
  ok(Math.abs(T.garbageTimer - g0) < 1, 'ZONE 期间灰线钟不走');

  // ── 到时自动结束 ──
  T.step(T.ZONE_MS + 500);
  ok(T.zoneLeft <= 0, '到时自动结束');

  // ── 死在 ZONE 里要先结算 ──
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) B()[y][x]=null;
  fill(ROWS-1); T.applyClear([ROWS-1]);
  const s1 = T.game.score;
  T.endGame('测试');
  ok(T.game.score > s1, '在 ZONE 里结束对局，奖金照样结算');
  ok(!document.body.classList.contains('zoning'), '结束后 zoning 不残留');


  // ── 封顶要边沉边截，不能事后判 ──
  fresh();
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  clean();
  while (T.zoneRows < T.ZONE_MAX - 1){
    const y = ROWS - 1 - T.zoneRows; if (y < 4) break; fillRow(y); T.applyClear([y]);
  }
  ok(T.zoneRows === T.ZONE_MAX - 1, `先垫到 ${T.ZONE_MAX - 1} 行`);
  const ys = [];
  for (let i = 0; i < 4; i++){ const y = ROWS - 1 - T.zoneRows - i; if (y > 3){ fillRow(y); ys.push(y); } }
  T.applyClear(ys);
  const peak = T.game.run.zoneRows;
  ok(peak <= T.ZONE_MAX,
     `一次消 4 行也不会冲破封顶（峰值 ${peak} ≤ ${T.ZONE_MAX}）—— 原来会冲到 15，奖金按 k² 超发 56%`);

  // ── 冰冻不能吃死行，但正常行照样冻得动 ──
  fresh();
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  clean();
  for (let i = 0; i < 2; i++){ const y = ROWS - 1 - T.zoneRows; fillRow(y); T.applyClear([y]); }
  const floor0 = T.zoneFloor(), dead0 = zrows();
  // 死行之上什么都没有 → 没有合法候选
  ok(T.doFreeze() === false, '死行之上没东西时冻不了（死行不是候选）');
  ok(zrows() === dead0 && T.zoneFloor() === floor0,
     `死行和地板都没动（死行 ${dead0}，地板 ${floor0}）`);
  // 放一行普通行上去，必须还能冻
  fillRow(ROWS - 1 - T.zoneRows - 1, 4);
  ok(T.doFreeze() === true, '死行之上有普通行时照常能冻');
  ok(zrows() === dead0 && T.zoneFloor() === floor0, '冻完死行和地板仍然没动');
  T.zoneEnd('');
  ok(zrows() === 0, '结算能把死行清干净（冻坏过的话这里会留残行）');

  // ── ZONE 到时要等消行动画落地再结算 ──
  fresh();
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  clean();
  fillRow(ROWS - 1); T.applyClear([ROWS - 1]);          // 沉 1 行死行
  T.step(T.ZONE_MS - 60);                               // 烧到快到期
  const tgt = 14;
  fillRow(tgt);
  if (!T.game.piece) T.spawnNext();
  const pc = T.game.piece; pc.x = 0; pc.y = 2;
  T.lockPiece();
  ok(T.clearing && T.clearing.rows.includes(tgt), `消行动画挂着（rows=${JSON.stringify(T.clearing && T.clearing.rows)}）`);
  T.step(300);
  const stillFull = [];
  for (let y = 0; y < ROWS; y++)
    if (B()[y].every(c => c) && !B()[y].every(c => c === Z)) stillFull.push(y);
  ok(stillFull.length === 0,
     `动画落地后那一行真的被消掉了（还剩 ${JSON.stringify(stillFull)}）—— ` +
     'ZONE 在动画中途结算会让 applyClear 拿过期行号删错行，分已经给了行却还在');


  // ── ZONE 期间事件钟整个停住（盘面讲解框承诺的「事件全停」）──
  fresh();
  // 先排出一个待发事件
  let guard = 0;
  while (!T.evPending && guard++ < 400) T.step(500);
  ok(!!T.evPending, `排出了待发事件（${T.evPending}）`);
  const pend = T.evPending;
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  T.step(T.EV_WARN ? T.EV_WARN + 1000 : 4000);
  ok(T.evPending === pend && !T.evActive,
     `ZONE 期间预警冻住、没有点火（evPending=${T.evPending} evActive=${T.evActive}）`);
  T.zoneEnd('');

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
              // 标准版没有修行面板，不需要 passUp（这里曾经误加过，整个文件直接崩）
              T.zoneCharge = 999; const a = T.zoneReady(); T.zoneStart();
              // 同上：裸字符串不会被 run_all.py 统计，也不会报错
              const L=[]; const ok=(c,m)=>L.push((c?'PASS ':'FAIL ')+m);
              ok(a===false, '标准版 zoneReady 恒为 false');
              ok(T.zoneLeft===0, '标准版 zoneStart 不起作用');
              ok(!document.body.classList.contains('zoning'), '标准版不会挂 zoning');
              return L; }""")
        else:
            r=pg.evaluate(JS)
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !",e)
        for l in r: print("  ",l)
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
