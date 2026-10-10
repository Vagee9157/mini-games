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
  const zrows = () => B().filter(r => r.every(c => c === Z)).length;
  const broken = () => B().filter(r => r.some(c => c === Z) && !r.every(c => c === Z)).length;
  const clean = () => { for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) B()[y][x]=null; };
  const fill = (y) => { for (let x=0;x<COLS;x++) B()[y][x]='T'; };
  const fillRow = (y, gap) => { const b=B(); for (let x=0;x<b[0].length;x++) b[y][x] = (x===gap?null:'T'); };
  const sink = (n) => { for (let i=0;i<n;i++){ fill(ROWS-1-T.zoneRows); T.applyClear([ROWS-1-T.zoneRows]); } };

  document.getElementById('startBtn').click(); passUp();

  // 每个工具试一遍：死行必须完好无损
  for (const [name, run] of [
    ['炸弹', () => T.bombAt({ type:'O', x:4, y:ROWS-4, rot:0 })],
    ['激光', () => T.laserAt({ type:'O', x:4, y:ROWS-6, rot:0 })],
    ['重锤', () => T.collapseCols([0,1,2,3,4,5,6,7,8,9])],
    ['地震', () => T.doQuake()],
  ]){
    T.zoneCharge = T.ZONE_NEED; T.zoneStart();
    clean(); sink(3);
    const before = zrows();
    run();
    ok(zrows() === before && broken() === 0,
       `${name} 打不穿死行（死行 ${before}→${zrows()}，半截行 ${broken()}）`);
    T.zoneEnd('');
    ok(zrows() === 0 && broken() === 0, `${name} 之后仍能干净结算`);
  }

  // 彩虹行：ZONE 下消行之上的行，标记要往上挪
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  clean(); sink(2);
  // 手动把标记放到一个已知位置，再消它上面的一行
  // 原来这里 clean() 之后盘面只剩死行，而 rainPick 的候选要求「这一行有格子」，
  // 所以 rainRow 恒为 -1，下面那个析取的第一项直接为真 —— 整条断言从来没走到
  // rainShift 的 ZONE 分支（也就是它想测的那段）。先铺两行普通行给它挑。
  fillRow(ROWS - 1 - T.zoneRows - 1, 3);
  fillRow(ROWS - 1 - T.zoneRows - 2, 5);
  T.rainPick();
  ok(T.rainRow >= 0, `有普通行时彩虹行挑得出来（rainRow=${T.rainRow}）`);
  fill(ROWS - 1 - T.zoneRows);
  T.applyClear([ROWS - 1 - T.zoneRows]);
  ok(T.rainRow < 0 || (T.rainRow >= 0 && T.rainRow < T.zoneFloor()),
     `彩虹行标记没落进死行区（rainRow=${T.rainRow}，地板=${T.zoneFloor()}）`);
  T.zoneEnd('');

  // 真实落块路径：死行不会被当满行消掉
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  clean(); sink(4);
  const z0 = zrows();
  let dropped = 0;
  for (let i = 0; i < 25 && T.zoneLeft > 0 && !T.game.over; i++){
    if (!T.game.piece) T.spawnNext();
    if (!T.game.piece) break;
    // 必须先硬降到底再锁 —— 在出生点直接 lockPiece 等于顶出，对局会结束
    const q = T.game.piece;
    while (!T.collides(q.type, q.x, q.y + 1, q.rot)) q.y++;
    T.lockPiece(); dropped++;
  }
  // 方块全堆在出生列不挪，最后一定会顶出 —— 那时 endGame 会把 ZONE 结算掉，
  // 所以判据是「ZONE 还在时死行没少」而不是「死行一直在」
  ok(T.game.over || zrows() >= z0,
     `真实落了 ${dropped} 块，ZONE 期间死行没被当满行消掉（${z0}→${zrows()}，over=${T.game.over}）`);
  ok(broken() === 0, '真实落块后没有半截死行');
  T.zoneEnd('');
  ok(zrows() === 0, '结算后死行清空');

  // 地板之下不该有任何可落地空间：方块不能穿进死行
  T.zoneCharge = T.ZONE_NEED; T.zoneStart();
  clean(); sink(3);
  // 原来传的是 ROWS-1，而 ROWS 这里是 TOTAL_ROWS，O 块的格子算出 y = ROWS，
  // collides 第一条「超出盘面」就 return true —— 把死行全清空它照样通过。
  // 要落在死行**上沿**那一格才真的在验「死行是实心的」。
  const topDead = ROWS - T.zoneRows;          // 死行区最上面那一行
  ok(T.collides('O', 4, topDead - 1, 0),
     `死行是实心的，方块落不进去（测的是第 ${topDead} 行）`);
  ok(!T.collides('O', 4, topDead - 2, 0), '死行之上还是空的（确认上一条不是因为越界）');
  T.zoneEnd('');

  return L;
}"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]
    # 拦掉外网字体。index.html 的 Google Fonts 样式表是**渲染阻塞**的，而 pg.goto
    # 默认等 load —— 网一慢整个文件就 Timeout，红绿和代码无关（实测撞过两次）。
    pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
    pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
    r=pg.evaluate(JS)
    print(f"JS错误 {len(errs)}")
    for e in errs[:4]: print("  !",e)
    for l in r: print("  ",l)
    b.close()
srv.shutdown(); srv.server_close()
