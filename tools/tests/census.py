"""真实对局普查：跑完整的局，数每个机制实际触发了几次。

不是断言式测试，是**巡检**：单元测试直接调函数，能证明「函数是对的」，
证明不了「真实对局里够得到」。这个只走正常对局路径。
一个机制在这里是 0 次，就要去查是触发条件写错了，还是被什么挡住了 ——
自动缓期就是这么被抓出来的（4604 帧里触发面是 0）。

已知的三个「正常的 0」：
  · 梭哈接受 / bets —— 要点按钮，机器人不会点
  · 瞬发事件（压实/地震/冰冻/拾穗）—— 它们不设 evActive，这个普查看不见
  · 稀有的限时事件 —— 15 局只抓到十几次限时事件，占比 9% 的抓到 0 很正常

跑法：python3 tools/tests/census.py

和单元测试的分工：那些直接调函数，证明「函数是对的」；
这个只走正常对局路径，证明「真实游戏里够得到」。
一个机制如果在这里是 0 次，要么是触发条件写错了，要么是它被什么挡住了。
"""
import os, http.server, socketserver, threading, functools, collections, json, sys
ROOT=os.getcwd()
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright

BOT = r"""() => new Promise((done) => {
  const T = __tetris;
  const C = {};                       // 机制计数
  const bump = (k, n) => { C[k] = (C[k]||0) + (n||1); };
  const passUp = () => { const s=document.getElementById('upSheet');
    if (s && !s.hidden){ const c=document.querySelector('#upList [data-up]');
      if (c){ bump('修行发牌'); T.upTake(c.dataset.up); } } };
  document.getElementById('startBtn').click(); passUp();
  const COLS = T.game.board[0].length;

  // 只做被动观察，不直接调任何机制函数
  let prev = { fever:0, burn:0, zone:0, betOffer:0, betLeft:0, ev:null, rain:-1,
               heat:0, lines:0, delays:0, zones:0 };
  const best = () => {
    const p=T.game.piece; if(!p) return null;
    let bx=p.x,br=p.rot,bs=-1e9;
    for(let r=0;r<4;r++) for(let x=-3;x<COLS+3;x++){
      if(T.collides(p.type,x,p.y,r)) continue;
      let y=p.y; while(!T.collides(p.type,x,y+1,r)) y++;
      const cells=T.cellsOf(p.type,r).map(c=>[x+c[0],y+c[1]]);
      if(cells.some(c=>c[0]<0||c[0]>=COLS)) continue;
      const B=T.game.board,R=B.length;
      const occ=(cx,cy)=>cells.some(c=>c[0]===cx&&c[1]===cy)||!!B[cy][cx];
      let agg=0,holes=0,cl=0; const h=[];
      for(let cx=0;cx<COLS;cx++){ let top=R;
        for(let cy=0;cy<R;cy++) if(occ(cx,cy)){top=cy;break;}
        h.push(R-top); agg+=R-top; let seen=false;
        for(let cy=top;cy<R;cy++){ if(occ(cx,cy)) seen=true; else if(seen) holes++; } }
      for(let cy=0;cy<R;cy++){ let f=true;
        for(let cx=0;cx<COLS;cx++) if(!occ(cx,cy)){f=false;break;} if(f) cl++; }
      let bump2=0; for(let i=0;i+1<h.length;i++) bump2+=Math.abs(h[i]-h[i+1]);
      const s=-0.51*agg+0.76*cl-0.36*holes*10-0.18*bump2;
      if(s>bs){bs=s;bx=x;br=r;}
    }
    return {x:bx,rot:br};
  };
  let frames=0;
  const iv=setInterval(()=>{
    if (frames>9000 || C['__games']>=4){ clearInterval(iv); done(C); return; }
    frames++;
    if (T.game.over){ bump('__games');
      const r=T.game.run; if(r){ for(const k of ['gold','bomb','laser','hammer','tspin','tetris','perfect','chests','saves','rerolls','bets','betWins','delays','zones'])
        if(r[k]) bump('局末统计:'+k, r[k]); }
      document.getElementById('againBtn')?.click();
      document.getElementById('startBtn')?.click(); passUp(); return; }
    passUp();
    // 边沿检测各机制
    if (T.fever>0 && prev.fever<=0) bump('FEVER');
    if (T.burnLeft>0 && prev.burn<=0) bump('燃点');
    if (T.zoneLeft>0 && prev.zone<=0) bump('ZONE 开启');
    if (T.betOffer>0 && prev.betOffer<=0) bump('梭哈弹出');
    if (T.betLeft>0 && prev.betLeft<=0) bump('梭哈接受');
    if (T.evActive && T.evActive!==prev.ev) bump('事件:'+T.evActive);
    if (T.rainRow>=0 && prev.rain<0) bump('彩虹行标记');
    if (T.game.rush && !prev.rush) bump('狂欢局');
    prev={fever:T.fever,burn:T.burnLeft,zone:T.zoneLeft,betOffer:T.betOffer,
          betLeft:T.betLeft,ev:T.evActive,rain:T.rainRow,rush:T.game.rush};
    const b=best();
    if (b && T.game.piece){
      const q=T.game.piece; q.rot=b.rot; q.x=b.x;
      const mod=q.mod;
      while(!T.collides(q.type,q.x,q.y+1,q.rot)) q.y++;
      const L0=T.game.lines, S0=T.game.score;
      T.lockPiece();
      const d=T.game.lines-L0;
      if (mod) bump('变异块:'+mod);
      if (d>0) bump('消行:'+Math.min(d,4)+'行');
      if (T.game.score>S0) bump('得过分');
    }
    T.step(120);
  },4);
})"""
C=collections.Counter()
with sync_playwright() as p:
    b=p.chromium.launch()
    for g in range(3):
        pg=b.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        C.update(pg.evaluate(BOT))
        if errs: print("  ❌ JS 错误:", errs[0][:100]); 
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()

want = ['FEVER','燃点','ZONE 开启','梭哈弹出','梭哈接受','彩虹行标记',
        '变异块:gold','变异块:bomb','变异块:laser','变异块:hammer','变异块:fill',
        '变异块:fork','变异块:dye',
        '事件:blackout','事件:mirror','事件:wind','事件:wall','事件:slam',
        '事件:tail','事件:blind','事件:calm',
        '消行:1行','消行:2行','消行:3行','消行:4行','修行发牌',
        '局末统计:chests','局末统计:delays','局末统计:zones','局末统计:bets']
print(f"--- 真实对局普查（{C.get('__games',0)+3} 局）---")
miss=[]
for k in want:
    v=C.get(k,0)
    mark='✓' if v else '✗ 一次都没触发'
    if not v: miss.append(k)
    print(f"  {mark} {k:<22} {v}")
other=[k for k in C if k not in want and not k.startswith('__')]
if other: print("  其它：", ', '.join(f'{k}={C[k]}' for k in sorted(other)))
print()
print("全部机制都在真实对局里触发过" if not miss else f"⚠ {len(miss)} 个没触发：{'、'.join(miss)}")
