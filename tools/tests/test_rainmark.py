"""彩虹行指示器：必须在棋盘外面，且跟着 rainRow 走"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

JS = r"""() => {
  const T = __tetris, L = [];
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  const passUp = () => { const c = document.querySelector('#upList [data-up]');
                         if (c && !document.getElementById('upSheet').hidden) T.upTake(c.dataset.up); };
  document.getElementById('startBtn').click(); passUp();
  T.ups.length = 0;
  const B = T.game.board, ROWS = B.length, COLS = B[0].length;
  for (let y = ROWS - 6; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 4) B[y][x] = 'T';

  const mark = document.getElementById('rainMark');
  const cv = document.getElementById('board');
  ok(!!mark, '指示器存在');
  ok(!mark.closest('.shaker'), '指示器不在 .shaker 里（震屏时不跟着抖）');

  T.rainPick(); T.syncRainMark();
  ok(!mark.hidden, '有彩虹行时显示');

  // 位置必须对得上 rainRow
  const cr = cv.getBoundingClientRect(), mr = mark.getBoundingClientRect();
  // BUFFER 从导出面读，别自己猜 —— 上一版写死 4，实际是 2，于是「偏了 7px」
  // 这个假阳性把我带去查了半天布局
  const cell = T.CELL;
  const rowMid = cr.top + (T.rainRow - T.BUFFER + .5) * cell;
  ok(Math.abs((mr.top + mr.height / 2) - rowMid) < cell * .3,
     `三角对准第 ${T.rainRow} 行（偏差 ${Math.abs((mr.top+mr.height/2)-rowMid).toFixed(1)}px，格高 ${cell.toFixed(1)}）`);

  // 必须完全在棋盘右框之外
  ok(mr.left >= cr.right - 1,
     `三角在棋盘外侧（三角左沿 ${mr.left.toFixed(1)} >= 棋盘右沿 ${cr.right.toFixed(1)}）`);

  // 换一行要跟着动
  const y0 = mr.top;
  let guard = 0;
  const was = T.rainRow;
  while (T.rainRow === was && guard++ < 200) T.rainPick();
  T.syncRainMark();
  ok(T.rainRow !== was, '能换到别的行');
  ok(Math.abs(mark.getBoundingClientRect().top - y0) > 1, '换行之后三角跟着挪');

  // 对局结束要收起来
  T.endGame('测试'); T.syncRainMark();
  ok(mark.hidden, '对局结束后收起来');

  return L;
}"""
fails = 0
with sync_playwright() as p:
    b=p.webkit.launch()
    for name,url in (('疯狂版','crazy/index.html'),('标准版','tetris/index.html')):
        ctx=b.new_context(**p.devices['iPhone 13 Pro']); pg=ctx.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{url}")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        if name=='标准版':
            r=pg.evaluate("""() => { const T=__tetris; document.getElementById('startBtn').click();
              const L=[]; const ok=(c,m)=>L.push((c?'PASS ':'FAIL ')+m);
              T.rainPick(); T.syncRainMark();
              ok(T.rainRow === -1, '标准版没有彩虹行');
              ok(document.getElementById('rainMark').hidden, '标准版指示器一直藏着');
              return L; }""")
        else:
            r=pg.evaluate(JS)
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !",e)
        fails += len(errs)
        for l in r:
            print("  ",l)
            if l.startswith('FAIL'): fails += 1
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
