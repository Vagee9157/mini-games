"""同条件比分数：固定行数检查点 + 终局。可指定 git revision 做改前改后对比。
用法: python3 ab_score.py [revision] [局数]"""
import os,sys,shutil,tempfile,subprocess,http.server,socketserver,threading,functools
ROOT=os.getcwd(); REV=sys.argv[1] if len(sys.argv)>1 else ''; N=int(sys.argv[2]) if len(sys.argv)>2 else 10
serve=ROOT; tmp=None
if REV:
    tmp=tempfile.mkdtemp()
    subprocess.run(f'git archive {REV} | tar -x -C {tmp}', shell=True, check=True, cwd=ROOT)
    serve=tmp
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=serve); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
BOT = r"""() => new Promise((done) => {
  const T = __tetris;
  const passUp = () => { const s=document.getElementById('upSheet');
    if (s && !s.hidden){ const c=document.querySelector('#upList [data-up]'); if(c) T.upTake(c.dataset.up); } };
  document.getElementById('startBtn').click(); passUp();
  const COLS = T.game.board[0].length;
  const st = { cp:{}, lines:0, score:0, heatMax:0, bets:0, zones:0 };
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
      let bp=0; for(let i=0;i+1<h.length;i++) bp+=Math.abs(h[i]-h[i+1]);
      const s=-0.51*agg+0.76*cl-0.36*holes*10-0.18*bp;
      if(s>bs){bs=s;bx=x;br=r;}
    }
    return {x:bx,rot:br};
  };
  let f=0, lastOffer=0;
  const iv=setInterval(()=>{
    if (T.game.over || f>9000){ clearInterval(iv); done(st); return; }
    passUp(); f++;
    if (T.betOffer>0 && lastOffer<=0){ st.bets++; T.betAccept(); }   // 机器人一律接梭哈
    lastOffer=T.betOffer;
    st.heatMax=Math.max(st.heatMax,T.heat);
    const b=best();
    if (b && T.game.piece){
      const q=T.game.piece; q.rot=b.rot; q.x=b.x;
      while(!T.collides(q.type,q.x,q.y+1,q.rot)) q.y++;
      T.lockPiece();
    }
    T.step(120);
    st.lines=T.game.lines; st.score=T.game.score;
    for (const c of [60,120,200,300]) if (T.game.lines>=c && st.cp[c]==null) st.cp[c]=T.game.score;
  },4);
})"""
res=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    for g in range(N):
        pg=b.new_page(); pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
        pg.wait_for_function("window.__tetris !== undefined", timeout=15000)
        res.append(pg.evaluate(BOT)); pg.close()
    b.close()
srv.shutdown(); srv.server_close()
if tmp: shutil.rmtree(tmp)
def med(v): v=sorted(v); return v[len(v)//2] if v else 0
print(f"--- {REV or '当前'}  {N} 局 ---")
L=sorted(r['lines'] for r in res)
print(f"  行数中位 {med(L):>5}   全部: {L}")
print(f"  峰值热度中位 {med([r['heatMax'] for r in res]):>8.0f}   梭哈中位 {med([r['bets'] for r in res])}")
for c in ('60','120','200','300'):
    vals=[r['cp'][c] for r in res if r['cp'].get(c) is not None]
    if vals: print(f"  {c:>4} 行时分数中位 {med(vals):>16,}   （{len(vals)}/{N} 局到达）")
print(f"  终局分数中位 {med([r['score'] for r in res]):>16,}")
