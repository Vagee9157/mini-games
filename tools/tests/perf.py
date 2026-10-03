#!/usr/bin/env python3
"""性能。不是断言式测试，是基准 —— 跑完看数，和下面记的基线对比。

跑法：python3 tools/tests/perf.py

三个场景，每个都把机制压到满：
  · Chromium 4× 降频 —— 历史基线就是在这个档位量的，用来做前后对比
  · Chromium 6× 降频 —— 模拟更旧的机器
  · WebKit  iPhone 视口 —— iPhone 上真正跑的引擎，Chromium 的数不能直接代表它

基线（2026-10-03，加完 ZONE / 修行 / 缓期 / 新事件之后）：
  4×  FPS 60.0  p99 ≈ 18ms  卡顿 0  内存 ≈ 9.5MB
"""
import os, http.server, socketserver, threading, functools, json, sys, statistics
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

# 把所有机制同时压满：热度顶档 + ZONE 反复开 + 梭哈 + 事件轮番 + 连击 + 全消特效
STRESS = """() => {
  const T = __tetris;
  document.getElementById('startBtn').click();
  document.querySelector('#upList [data-up]')?.click();
  window.__fr = []; let last = performance.now();
  const tick = () => { const n = performance.now(); window.__fr.push(n - last); last = n;
                       requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const EV = T.EVENTS.map(e => e.key);
  let i = 0;
  window.__iv = setInterval(() => {
    i++;
    const B = T.game.board, R = B.length, C = B[0].length;
    T.heat = 4000;
    T.game.combo = 12; T.game.b2b = true; T.syncStreak();
    // ZONE 反复开，并往里灌行（死行渲染 + 结算特效）
    if (T.zoneLeft <= 0){ T.zoneCharge = T.zoneNeed(); T.zoneStart(); }
    const y = R - 1 - T.zoneRows;
    if (y > 3){ for (let x = 0; x < C; x++) B[y][x] = 'T'; T.applyClear([y]); }
    // 事件轮番
    T.evForce(EV[i % EV.length]);
    // 梭哈横幅 + 结算
    if (i % 4 === 0){ T.crazyOnClear(T.BET_OFFER_NEED, null, false); T.betAccept(); }
    // 最重的两套特效
    if (i % 5 === 0) T.perfectFx();
    if (i % 7 === 0) T.recordFx();
    if (i % 3 === 0) T.feverStart();
    T.redraw();
  }, 700);
}"""
READ = """() => { clearInterval(window.__iv);
  const f = window.__fr.slice(30).sort((a,b)=>a-b);
  if (!f.length) return null;
  const q = (p) => f[Math.min(f.length-1, Math.floor(f.length*p))];
  const avg = f.reduce((a,b)=>a+b,0)/f.length;
  return { 帧数: f.length, FPS: +(1000/avg).toFixed(1),
           p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), p99: +q(.99).toFixed(1),
           最慢帧: +f[f.length-1].toFixed(1),
           卡顿: f.filter(x=>x>50).length, 掉帧: f.filter(x=>x>33).length,
           内存MB: performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(1) : null }; }"""

SECS = int(sys.argv[1]) if len(sys.argv)>1 else 30
rows=[]
with sync_playwright() as p:
    for name, engine, throttle, device in (
        ('Chromium 4× 降频', 'chromium', 4, None),
        ('Chromium 6× 降频', 'chromium', 6, None),
        ('WebKit / iPhone',  'webkit',   0, 'iPhone 13 Pro')):
        br = getattr(p, engine).launch()
        ctx = br.new_context(**(p.devices[device] if device else {}))
        pg = ctx.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        if throttle:
            cdp = ctx.new_cdp_session(pg)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
        pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
        pg.wait_for_function("window.__tetris !== undefined", timeout=15000)
        pg.evaluate(STRESS)
        pg.wait_for_timeout(SECS*1000)
        r = pg.evaluate(READ)
        r['JS错误'] = len(errs)
        rows.append((name, r, errs))
        br.close()
srv.shutdown(); srv.server_close()

print(f"压力场景：热度顶档 + ZONE 反复开并灌行 + 12 个事件轮番 + 梭哈结算 + 全消/破纪录特效 + 15 连击，各跑 {SECS} 秒\n")
hdr = ['场景','FPS','p50','p95','p99','最慢帧','卡顿>50ms','掉帧>33ms','内存MB','JS错误']
print('  ' + '  '.join(h.ljust(w) for h,w in zip(hdr,[17,6,6,6,6,7,9,9,7,6])))
bad=0
for name, r, errs in rows:
    if not r: print(f"  {name} 没采到帧"); bad+=1; continue
    cells=[name, r['FPS'], r['p50'], r['p95'], r['p99'], r['最慢帧'],
           r['卡顿'], r['掉帧'], r['内存MB'] if r['内存MB'] is not None else '—', r['JS错误']]
    print('  ' + '  '.join(str(c).ljust(w) for c,w in zip(cells,[17,6,6,6,6,7,9,9,7,6])))
    for e in errs[:3]: print('      !', e[:100])
    if r['JS错误'] or r['卡顿'] > 2 or r['FPS'] < 50: bad += 1
print('\n' + ('全部达标' if not bad else f'⚠ {bad} 个场景不达标'))
sys.exit(1 if bad else 0)
