"""盘面提示不能互相压住。

单独成文件是因为要等 toast 的渐显动画 —— test_all_mechanics 那个大 JS 块
是同步执行的，等不了，于是 opacity 还是 0 时就去量，得到的是假结果。

这是一条**审计**不是单点断言：以后再往盘面加提示，撞上了这里会直接红。
"""
import os, http.server, socketserver, threading, functools, sys, json
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

# 排除 #fx —— 它是整块飘字层，覆盖全盘是定义使然
MEASURE = """() => {
  const ids = ['betFlash','toast','evwarn','badgeHeat','badgeB2B','badgeCombo'];
  const vis = {};
  for (const id of ids){ const e=document.getElementById(id); if (!e) continue;
    const cs=getComputedStyle(e), r=e.getBoundingClientRect();
    if (cs.display==='none'||cs.visibility==='hidden'||r.height<1||+cs.opacity===0) continue;
    vis[id]={t:r.top,b:r.bottom,l:r.left,r:r.right,
             // 父子不算打架：热度/B2B/COMBO 是 .streak 的子元素，竖排的
             path:(function(p,a){while(p){a.push(p.id||p.className);p=p.parentElement;}return a;})(e,[])};
  }
  const k=Object.keys(vis), clash=[];
  for (let i=0;i<k.length;i++) for (let j=i+1;j<k.length;j++){
    const a=vis[k[i]], c=vis[k[j]];
    if (a.path.includes(k[j]) || c.path.includes(k[i])) continue;
    if (!(a.b<c.t||c.b<a.t||a.r<c.l||c.r<a.l)) clash.push(k[i]+'×'+k[j]);
  }
  const box={}; for (const id of k) box[id]=[Math.round(vis[id].t),Math.round(vis[id].b)];
  return { 可见: box, 重叠: clash };
}"""

fails=0
with sync_playwright() as p:
    b=p.webkit.launch()
    for dev in ('iPhone 13 Pro','iPhone 12 Mini'):
        ctx=b.new_context(**p.devices[dev]); pg=ctx.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        pg.evaluate("""() => { const T=__tetris;
          document.getElementById('startBtn').click();
          document.querySelector('#upList [data-up]')?.click();
          T.ups.length = 0;
          // 把能同时出现的提示全逼出来：左上角三个徽章 + 梭哈横幅 + toast
          T.heat = 3000; T.game.combo = 12; T.game.b2b = true; T.syncStreak();
          T.crazyOnClear(T.BET_OFFER_NEED, null, false);
          T.showToast('压实　洞被填上了'); }""")
        pg.wait_for_timeout(500)          # 等 toast 渐显完
        r=pg.evaluate(MEASURE)
        print(f"== {dev} ==  JS错误 {len(errs)}")
        for e in errs[:3]: print("   !",e)
        fails += len(errs)
        print("   可见(上下沿):", json.dumps(r['可见'], ensure_ascii=False))
        n=len(r['可见'])
        if n < 4:
            print(f"   FAIL 只逼出 {n} 个提示，审计没有意义"); fails += 1
        else:
            print(f"   PASS 同时逼出 {n} 个提示")
        if r['重叠']:
            print("   FAIL 重叠：", '、'.join(r['重叠'])); fails += 1
        else:
            print("   PASS 两两不重叠")
        ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
