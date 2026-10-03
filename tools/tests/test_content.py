"""新事件（顺风 / 重影 / 拾穗）与新变异块（分流 / 染色）"""
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
  const B = () => T.game.board;
  const clean = () => { const b=B(); for (let y=0;y<b.length;y++) for (let x=0;x<b[0].length;x++) b[y][x]=null; };
  document.getElementById('startBtn').click(); passUp();
  // passUp 选的是**随机**一张卡，而其中「孤注」会禁掉变异块、「熔炉」会改热度 ——
  // 这个文件测的不是修行，必须把变量清掉，否则断言时好时坏。
  T.ups.length = 0;
  const ROWS = B().length, COLS = B()[0].length;

  // ── 表本身 ──
  const keys = T.EVENTS.map(e => e.key);
  for (const k of ['tail','blind','glean'])
    ok(keys.includes(k), `事件表里有 ${k}`);
  ok(T.EVENTS.every(e => e.tip), '每个事件都有预告文案');
  const w = T.EVENTS.reduce((a,e)=>a+e.w,0);
  const good = T.EVENTS.filter(e=>!e.bad).reduce((a,e)=>a+e.w,0);
  L.push(`INFO 有利事件权重 ${good}/${w} = ${(good/w*100).toFixed(1)}%`);
  ok(good / w > .45, '有利事件占比 > 45%');

  const mods = T.MOD_RATES.map(r => r[0]);
  for (const k of ['fork','dye']) ok(mods.includes(k), `变异块表里有 ${k}`);
  for (const k of mods) ok(!!T.MOD_TINT[k], `${k} 有配色`);

  // ── 顺风：热度注入翻倍 ──
  // 单次采样不可比：热流有 25% 概率把单行注入 ×4，一次采样的方差比效应本身还大。
  // 取 200 次均值 —— 顺风是稳定的 ×2，热流在两组里期望相同，会被均掉。
  const meanGain = (n) => { let t = 0;
    for (let i = 0; i < n; i++){ T.heat = 0; T.crazyOnClear(1); t += T.heat; }
    return t / n; };
  T.evForce('tail');
  ok(T.evTail() === true, '顺风挂上了');
  const withTail = meanGain(200);
  T.step(9000);
  ok(!T.evTail(), '顺风到时结束');
  const without = meanGain(200);
  ok(withTail > without * 1.7 && withTail < without * 2.3,
     `顺风期间热度注入约翻倍（${withTail.toFixed(2)} vs ${without.toFixed(2)} = ${(withTail/without).toFixed(2)}×）`);

  // ── 重影：不画落点虚影 ──
  ok(T.EV_DEADLY.has('blind'), '重影进了高危名单（堆高时不出）');
  T.evForce('blind');
  ok(T.evBlind() === true, '重影挂上了');
  T.step(8000);
  ok(!T.evBlind(), '重影到时结束');

  // ── 拾穗：队列前几块变成变异块 ──
  for (let i = 0; i < T.game.mods.length; i++) T.game.mods[i] = null;
  T.doGlean();
  const got = T.game.mods.slice(0, T.GLEAN_N).filter(Boolean).length;
  ok(got === T.GLEAN_N, `拾穗把前 ${T.GLEAN_N} 块变成变异块（实得 ${got}）`);
  ok(T.game.mods.slice(0, T.GLEAN_N).every(m => mods.includes(m)), '拾穗给的是合法变异块');
  // 孤注这局不出变异块，拾穗也要认
  T.ups.length = 0; T.ups.push('bare');
  for (let i = 0; i < T.game.mods.length; i++) T.game.mods[i] = null;
  T.doGlean();
  ok(T.game.mods.slice(0, T.GLEAN_N).every(m => !m), '孤注期间拾穗不发牌');
  T.ups.length = 0;

  // ── 分流：格子各自落到底 ──
  clean();
  // 造一个高低不平的地形：左半边高两格
  for (let x = 0; x < 3; x++){ B()[ROWS-1][x] = 'T'; B()[ROWS-2][x] = 'T'; }
  // 一块 I 横放在第 ROWS-3 行，x 从 1 到 4 —— 右边两格是架空的
  const piece = { type:'I', x:1, y:ROWS-3, rot:0 };
  for (const [dx,dy] of T.cellsOf('I', 0)) B()[piece.y+dy][piece.x+dx] = 'I';
  const airBefore = [3,4].filter(x => !B()[ROWS-1][x]).length;
  T.forkAt(piece);
  const landed = [3,4].filter(x => B()[ROWS-1][x] === 'I').length;
  ok(airBefore === 2 && landed === 2, `分流让架空的格子各自落到底（${landed}/2）`);
  ok(B()[ROWS-2][0] === 'T' && B()[ROWS-1][0] === 'T', '分流不动别人的格子');

  // ── 染色：最低那一行变成彩虹行 ──
  clean();
  const p2 = { type:'O', x:4, y:ROWS-4, rot:0 };
  const low = Math.max(...T.cellsOf('O',0).map(c => p2.y + c[1]));
  T.dyeAt(p2);
  ok(T.rainRow === low, `染色把彩虹标在最低那一行（${T.rainRow} == ${low}）`);

  // ── 说明书覆盖 ──
  const help = T.helpSections().flatMap(([t,rs]) => rs.map(r => r.name));
  for (const n of ['分流','染色','顺风','重影','拾穗'])
    ok(help.includes(n), `说明书里有「${n}」`);

  return L;
}"""
fails = 0
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,url in (('疯狂版','crazy/index.html'),('标准版','tetris/index.html')):
        pg=b.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{url}")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        if name=='标准版':
            r=pg.evaluate("""() => { const T=__tetris; document.getElementById('startBtn').click();
              const L=[]; const ok=(c,m)=>L.push((c?'PASS ':'FAIL ')+m);
              ok(T.evTail()===false && T.evBlind()===false, '标准版两个新事件恒不触发');
              const before = T.game.mods.slice(); T.doGlean();
              ok(JSON.stringify(T.game.mods)===JSON.stringify(before), '标准版拾穗无副作用');
              ok(T.rollMod()===null, '标准版不出变异块');
              return L; }""")
        else:
            r=pg.evaluate(JS)
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !",e)
        fails += len(errs)
        for l in r:
            print("  ",l)
            if l.startswith('FAIL'): fails += 1
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
