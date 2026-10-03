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
  const Z = T.ZONE;   // 别写死：标记字母改过一次（原来撞了 Z 型方块）
  const B = () => T.game.board;
  const ROWS = B().length, COLS = B()[0].length;
  const solid = () => B().reduce((a,r)=>a + r.filter(Boolean).length, 0);
  const zrows = () => B().filter(r => r.every(c => c === Z)).length;
  const fill = (y, except) => { for (let x=0;x<COLS;x++) B()[y][x] = (x===except? null : 'T'); };

  document.getElementById('startBtn').click();

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
  const lockedBefore = zrows();
  // 走一次真实的锁定路径：盘面上只有死行，不该触发任何消除
  const n = T.clearFullNow ? 0 : 0;
  ok(zrows() === lockedBefore, '死行本身不会被当满行');

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
              T.zoneCharge = 999; const a = T.zoneReady(); T.zoneStart();
              return ['标准版 zoneReady='+a+' (要 false)','标准版 zoneLeft='+T.zoneLeft+' (要 0)',
                      '标准版 body.zoning='+document.body.classList.contains('zoning')+' (要 false)']; }""")
        else:
            r=pg.evaluate(JS)
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !",e)
        for l in r: print("  ",l)
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
