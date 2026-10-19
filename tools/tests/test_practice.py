"""练习模式：模式隔离 + 每一关的目标真的做得出来

关卡盘面不是画出来就算数的。这里对每一关做一次**可达性证明**：
从出生状态开始，用真实的 tryMove / tryRotate 做 BFS（状态 = 列/行/朝向/上一步是不是旋转），
对每个落地状态算一次「锁在这里会消几行、算不算 T-spin」，看目标在不在结果集里。

这样盘面画错、或者以后改了 SRS 踢墙表导致某一关做不出来，这里会红。
"""
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

  document.getElementById('startBtn').click();

  // ── 模式隔离 ──
  ok(T.practice === false, '正常开局不是练习模式');
  T.startPractice();
  ok(T.practice === true, '进得去练习模式');
  ok(T.game.noGarbage === true, '练习不涨灰线');
  ok(document.body.classList.contains('practising'), 'body 挂上 practising');
  ok(!document.getElementById('prBar').hidden, '练习条显示出来');

  // 练习局一个记录都不许写
  const best0 = T.readBest(), total0 = T.readTotal();
  T.game.score = 999999999;
  T.endGame('堆到顶了');
  ok(T.readBest() === best0, `练习局不写最高分（${best0} → ${T.readBest()}）`);
  ok(T.readTotal() === total0, '练习局不写累计分');
  ok(T.readSave() === null, '练习局不存档');

  // ── 逐关可达性证明 ──
  const cellsOf = T.cellsOf, COLS = T.COLS, R = T.TOTAL_ROWS;
  function probe(k){
    T.startPractice();
    T.practiceLoad(k);
    const board = T.game.board.map(r => r.slice());
    const need = T.LEVEL_BY[k].queue[0];
    const p0 = T.game.piece;
    if (!p0 || p0.type !== need) return { err: '拿不到 ' + need + ' 块' };

    const key = s => s.x + ',' + s.y + ',' + s.rot + ',' + (s.rot0 ? 1 : 0);
    const start = { x:p0.x, y:p0.y, rot:p0.rot, rot0:false, kick:0 };
    const seen = new Set([key(start)]);
    const q = [start];
    const hits = [];
    let guard = 0;
    while (q.length && guard++ < 20000){
      const st = q.shift();
      // 还原到这个状态
      T.game.board = board.map(r => r.slice());
      T.game.piece = { type:need, x:st.x, y:st.y, rot:st.rot, mod:null };
      T.game.lastWasRot = st.rot0;
      T.game.lastRotKick = st.kick;
      // 落地了？算一次结果。**但不能就此终止** —— 锁定延迟期间照样能转，
      // T-spin 恰恰就是「贴着地再转进去」做出来的。原来这里 continue，
      // 于是所有 T-spin 关都搜不到解，而盘面其实是对的。
      if (T.collides(need, st.x, st.y + 1, st.rot)){
        const spin = T.detectTSpin();
        const b = T.game.board;
        let bad = false;
        for (const [cx, cy] of cellsOf(need, st.rot)){
          const X = st.x + cx, Y = st.y + cy;
          if (X < 0 || X >= COLS || Y < 0 || Y >= R){ bad = true; break; }
          b[Y][X] = need;
        }
        if (!bad){
          let full = 0;
          for (let y = 0; y < R; y++) if (b[y].every(c => !!c)) full++;
          let rest = 0;
          for (let y = 0; y < R; y++) for (let x = 0; x < COLS; x++) if (b[y][x]) rest++;
          const perfect = full > 0 && rest === full * COLS;
          hits.push({ spin, n: full, perfect, x: st.x, rot: st.rot });
        }
        // 落地状态只是不能再往下走，左右和旋转都还在 —— 往下接着展开
      }
      // 展开：左 / 右 / 下 / 顺时针 / 逆时针
      const push = (nx, ny, nrot, isRot) => {
        if (T.collides(need, nx, ny, nrot)) return;
        const ns = { x:nx, y:ny, rot:nrot, rot0:isRot, kick:T.game.lastRotKick|0 };
        if (seen.has(key(ns))) return;
        seen.add(key(ns)); q.push(ns);
      };
      push(st.x - 1, st.y, st.rot, false);
      push(st.x + 1, st.y, st.rot, false);
      push(st.x, st.y + 1, st.rot, false);
      for (const dir of [1, -1]){
        T.game.board = board.map(r => r.slice());
        T.game.piece = { type:need, x:st.x, y:st.y, rot:st.rot, mod:null };
        if (T.tryRotate(dir)){
          const q2 = T.game.piece;
          const ns = { x:q2.x, y:q2.y, rot:q2.rot, rot0:true, kick:T.game.lastRotKick|0 };
          if (!seen.has(key(ns))){ seen.add(key(ns)); q.push(ns); }
        }
      }
    }
    return { hits, states: seen.size };
  }

  // 单招关：对唯一那一块做穷举，证明目标落点存在
  for (const lv of T.LEVELS.filter(l => l.group === 'single')){
    const r = probe(lv.k);
    if (r.err){ ok(false, `${lv.n}：${r.err}`); continue; }
    const g = lv.goals[0];
    const good = r.hits.filter(h =>
      (g.spin === undefined || h.spin === g.spin) &&
      (g.n === undefined || h.n === g.n) &&
      (g.perfect === undefined || !!h.perfect === g.perfect));
    const best = r.hits.reduce((a,h)=> (h.n>(a?a.n:-1)?h:a), null);
    ok(good.length > 0,
       `「${lv.n}」目标做得出来（搜了 ${r.states} 个状态，命中 ${good.length} 个落点`
       + (good.length ? `，例如列 ${good[0].x} 朝向 ${good[0].rot}` : `；最好的只有 ${best?best.n:0} 行 spin=${best?best.spin:null}`)
       + '）');
  }

  // ── 每一关：照解法回放必须过关 ──
  // 组合关多块连着走，穷举太贵；用「构造性证明」—— 给出一条解，回放它，看目标是否全部达成。
  // 这条解也就是「看演示」放的那条，所以这里红 = 演示会演砸。
  for (const lv of T.LEVELS){
    const okSolve = T.practiceSolve(lv.k);
    ok(okSolve, `「${lv.n}」照解法回放能过关（${lv.solution.join(' → ')}；做到第 ${T.practiceStep}/${lv.goals.length} 步）`);
  }
  // 解法只能用手机上按得出来的键：左右、软降、顺时针、落底
  for (const lv of T.LEVELS){
    const bad = lv.solution.join('').replace(/[LRdCH0-9]/g, '');
    ok(bad === '', `「${lv.n}」解法只用手机有的键${bad ? '，多了：' + bad : ''}`);
  }
  // 固定出块顺序生效：开局那块就是 queue[0]，NEXT 第一个是 queue[1]
  T.startPractice(); T.practiceLoad('tsd4');
  ok(T.game.piece.type === 'T' && T.game.queue[0] === 'I',
     `组合关按固定顺序出块（现在 ${T.game.piece.type}，下一个 ${T.game.queue[0]}）`);
  // 多步关：做完第一步只算进了一步，不算过关
  T.startPractice(); T.practiceLoad('tsd4');
  for (const a of T.parseActs(T.LEVEL_BY.tsd4.solution[0])) T.doAct(a);
  { let g=0; while (T.clearing && g++<400) T.step(16); }
  ok(T.practiceStep === 1 && !T.practiceDone, `第一步做完是 1/2，还没过关（step=${T.practiceStep}）`);

  // ── 硬降不该保留「最后一步是旋转」──
  // 原来半空转一下、硬降 19 格落进三角都被挡的坑，会被判成 mini T-spin。
  T.startPractice();
  for (let y=0;y<T.TOTAL_ROWS;y++) T.game.board[y].fill(null);
  const RR = T.TOTAL_ROWS;
  T.game.board[RR-3][4]='X'; T.game.board[RR-1][4]='X'; T.game.board[RR-1][6]='X';
  T.practicePick('T');
  T.tryRotate(1);
  const hp = T.game.piece;
  while (hp.x < 4) T.tryMove(1,0);
  T.tryRotate(1); T.tryRotate(-1);
  ok(T.game.lastWasRot === true, '硬降前一刻最后一步确实是旋转');
  // 看分数，不看标志位 —— 硬降完新块已经出生，出生本身就会清 lastWasRot，
  // 拿它当判据的话修没修都会绿。分数是锁定那一刻算的，骗不了：
  // 只该涨硬降的 2 分/格；被误判成 mini T-spin 会再多 100 分。
  let hd = 0; while (!T.collides('T', hp.x, hp.y + hd + 1, hp.rot)) hd++;
  const hs0 = T.game.score;
  T.hardDrop();
  ok(T.game.score - hs0 === hd * 2,
     `硬降 ${hd} 格只拿硬降分 ${hd * 2}（实得 ${T.game.score - hs0}，多出来就是误判成了 T-spin）`);
  // 贴地转进去再落底（d=0）必须保留 —— 这是手机上做 T 旋的操作链
  ok(T.practiceSolve('tsd'), '贴地转进槽再按落底，T-spin 照样成立');

  // ── 撤销拿回的是同一块 ──
  T.startPractice(); T.practiceLoad('tsd4');
  T.hardDrop();                       // 把 T 随手扔掉
  T.practiceUndo();
  ok(T.game.piece && T.game.piece.type === 'T' && T.game.queue[0] === 'I',
     `撤销之后手里还是那块 T、下一个还是 I（现在 ${T.game.piece && T.game.piece.type} / ${T.game.queue[0]}）`);

  // 撤销
  T.startPractice(); T.practiceLoad('tsd');
  const d0 = T.undoDepth;
  T.hardDrop();
  ok(T.undoDepth === d0 + 1, `落一块压一层撤销（${d0} → ${T.undoDepth}）`);
  const sig = JSON.stringify(T.game.board);
  T.hardDrop();
  T.practiceUndo();
  ok(JSON.stringify(T.game.board) === sig, '撤销把盘面还原了');

  // 指定出块
  T.startPractice();
  T.practicePick('T');
  ok(T.game.piece && T.game.piece.type === 'T', `指定出块生效（现在是 ${T.game.piece && T.game.piece.type}）`);

  // ── 软降（手机上原来没有这个键，T 旋等于做不出来）──
  T.startPractice();
  for (let y=0;y<T.TOTAL_ROWS;y++) T.game.board[y].fill(null);
  T.practicePick('T');
  ok(!!document.getElementById('btnSoft'), '手机按键区有软降键');
  const y0 = T.game.piece.y, s0 = T.game.score;
  // 模拟按住：走够时间让它掉几格
  // 按键走的是 touchstart / mousedown，不是 pointer 事件
  const g = T.gravityFor(T.game.level);
  const soft = document.getElementById('btnSoft');
  soft.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  T.step(g / 4);                   // 这点时间自然重力一格都掉不了
  const dy = T.game.piece ? T.game.piece.y - y0 : -1;
  ok(dy >= 4, `按住软降明显更快（${g/4}ms 掉了 ${dy} 格，自然重力同期是 0 格）`);
  ok(T.game.score - s0 === dy, `软降每格 +1 分（掉 ${dy} 格，加了 ${T.game.score - s0}）`);
  soft.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  const y1 = T.game.piece.y, s1 = T.game.score;
  T.step(g / 4);
  ok(T.game.piece.y === y1 && T.game.score === s1, '松手就停');

  // 软降落地**不锁死** —— 这是它和落底唯一的本质区别，也是 T 旋成立的前提
  T.startPractice();
  for (let y=0;y<T.TOTAL_ROWS;y++) T.game.board[y].fill(null);
  T.practicePick('T');
  const pc = T.game.piece, n0 = T.game.pieces;
  while (!T.collides('T', pc.x, pc.y+1, pc.rot)) pc.y++;
  T.step(16);
  ok(T.game.pieces === n0 && T.game.piece && T.game.piece.type === 'T',
     '软降贴地后没有立刻锁定（还有锁定延迟）');
  ok(T.tryRotate(1) && T.game.lastWasRot === true, '贴地之后还能转，lastWasRot 为真');

  // 只用手机那套键（左右 + 顺时针 + 软降），TSD 还做不做得出来
  T.startPractice(); T.practiceLoad('tsd');
  const bd = T.game.board.map(r=>r.slice());
  T.practicePick('T');
  const pp = T.game.piece;
  const kk = s2 => s2.x+','+s2.y+','+s2.rot+','+(s2.r?1:0);
  const st0 = {x:pp.x,y:pp.y,rot:pp.rot,r:false,kick:0};
  const sn = new Set([kk(st0)]); const qq=[st0]; let tsd=0, gd=0;
  while (qq.length && gd++ < 30000){
    const st = qq.shift();
    T.game.board = bd.map(r=>r.slice());
    T.game.piece = {type:'T',x:st.x,y:st.y,rot:st.rot,mod:null};
    T.game.lastWasRot = st.r; T.game.lastRotKick = st.kick;
    if (T.collides('T', st.x, st.y+1, st.rot)){
      const sp = T.detectTSpin(); const b = T.game.board; let bad=false;
      for (const [cx,cy] of T.cellsOf('T', st.rot)){ const X=st.x+cx, Y=st.y+cy;
        if (X<0||X>=T.COLS||Y<0||Y>=T.TOTAL_ROWS){bad=true;break;} b[Y][X]='T'; }
      if (!bad){ let f=0; for (let y=0;y<T.TOTAL_ROWS;y++) if (b[y].every(c=>!!c)) f++;
        if (sp === 'tspin' && f === 2) tsd++; }
    }
    const pu = (nx,ny,nr) => { if (T.collides('T',nx,ny,nr)) return;
      const ns={x:nx,y:ny,rot:nr,r:false,kick:0};
      if (sn.has(kk(ns))) return; sn.add(kk(ns)); qq.push(ns); };
    pu(st.x-1,st.y,st.rot); pu(st.x+1,st.y,st.rot); pu(st.x,st.y+1,st.rot);
    // 手机上只有顺时针一个旋转键
    T.game.board = bd.map(r=>r.slice());
    T.game.piece = {type:'T',x:st.x,y:st.y,rot:st.rot,mod:null};
    if (T.tryRotate(1)){ const q3=T.game.piece;
      const ns={x:q3.x,y:q3.y,rot:q3.rot,r:true,kick:T.game.lastRotKick|0};
      if (!sn.has(kk(ns))){ sn.add(kk(ns)); qq.push(ns); } }
  }
  ok(tsd > 0, `只用手机那套键（左右 + 顺时针 + 软降）也做得出 TSD（${tsd} 个落点）`);

  // 退出练习要把一切收干净
  T.exitPractice();
  ok(T.practice === false && !document.body.classList.contains('practising'),
     '退出练习，标志和 class 都收掉');
  ok(T.game.noGarbage !== true, '退出后灰线恢复');

  return L;
}"""

STD_ONLY = r"""() => {
  const T = __tetris, L = [];
  const ok = (c, m) => L.push((c ? 'PASS ' : 'FAIL ') + m);
  ok(document.getElementById('practiceBtn') === null, '疯狂版没有练习入口按钮');
  ok(document.getElementById('prBar') === null, '疯狂版没有练习条');
  return L;
}"""

fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url, js in (('标准版','tetris/index.html',JS), ('疯狂版','crazy/index.html',STD_ONLY)):
        pg = b.new_page(); errs=[]
        pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/{url}")
        pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
        r = pg.evaluate(js)
        if name == '标准版':
            # ── 演示：走真实定时器，不是同步回放 ──
            # 上面的 practiceSolve 是同步跑的，演示另有一套 setTimeout 驱动、要等消行动画、
            # 要冻住重力。这里把每一关真放一遍，中途还故意按一下左移，看会不会被带偏。
            for k in pg.evaluate("() => __tetris.LEVELS.map(l => l.k)"):
                pg.evaluate(f"() => {{ __tetris.startPractice(); __tetris.practiceLoad('{k}'); __tetris.practiceDemo(); }}")
                pg.wait_for_timeout(900)
                running = pg.evaluate("() => __tetris.demoRunning")
                pg.evaluate("() => { const b=document.getElementById('btnLeft');"
                            " b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));"
                            " b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); }")
                try:
                    pg.wait_for_function("() => !__tetris.demoRunning", timeout=30000)
                    finished = True
                except Exception:
                    finished = False
                res = pg.evaluate("() => ({ done: __tetris.practiceDone, step: __tetris.practiceStep,"
                                  " n: __tetris.practiceLevel && __tetris.practiceLevel.n,"
                                  " goals: __tetris.practiceLevel && __tetris.practiceLevel.goals.length })")
                ok = running and finished and res['done']
                r.append(('PASS ' if ok else 'FAIL ') +
                         f"「{res['n']}」演示真放一遍能过关，中途乱按也带不偏"
                         f"（放着={running} 放完={finished} 第 {res['step']}/{res['goals']} 步）")
        if name == '标准版':
            # ── 消行动画在 60Hz 上一帧都不能少画 ──
            # CLEAR_DRAW_MS 的算术在 test_all_mechanics 里验过；这里验真实渲染路径：
            # 打出一次四消，由真实 rAF 推进动画，数动画期间跑了几帧、画了几次。
            fd = pg.evaluate("""() => new Promise(done => {
              const T = __tetris;
              T.startPractice(); T.practiceLoad('tetris');
              const f0 = T.dbg.frames, d0 = T.dbg.draws;
              for (const a of T.parseActs(T.LEVEL_BY.tetris.solution[0])) T.doAct(a);
              let seen = false;
              const w = () => { if (T.clearing) seen = true;
                if (seen && !T.clearing) return done({f: T.dbg.frames - f0, d: T.dbg.draws - d0});
                requestAnimationFrame(w); };
              requestAnimationFrame(w);
            })""")
            r.append(('PASS ' if fd['f'] > 3 and fd['d'] >= fd['f'] else 'FAIL ') +
                     f"60Hz 下消行动画每帧都画（{fd['f']} 帧，画了 {fd['d']} 次）")
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !", e)
        fails += len(errs)
        for l in r:
            print("  ", l)
            if l.startswith('FAIL'): fails += 1
        pg.close()
    b.close()

# ── 布局：练习模式不能把盘面压扁、不能把右栏挤到别的控件上 ──
#
# 第一版练习条住在主网格里一个自动生成的 auto 行，长多高盘面就缩多少：
# iPhone 13 上格子 26px → 10px，SE 上 8px，右栏的子元素还溢出盖住了顶栏和变换键。
# 当时只验了「横向没溢出」，没看盘面被压成什么样。这一段把两件事都钉住。
#
# 量右栏要逐个量**子元素** —— <aside> 自己的盒子不会越界，溢出来的是它里面的格子，
# 只量 aside 会得到 0px 的假阴性（实际就这么错过一次）。
LAYOUT = r"""() => {
  const rect = e => e.getBoundingClientRect();
  const header = document.querySelector('.bar'), pads = document.querySelector('.pads');
  const hb = rect(header).bottom, pt = rect(pads).top;
  let worst = 0, who = '';
  for (const c of document.querySelector('.side').children){
    const r = rect(c);
    if (!r.height || getComputedStyle(c).display === 'none') continue;
    const over = Math.max(0, hb - r.top) + Math.max(0, r.bottom - pt);
    if (over > worst){ worst = over; who = c.className || c.id || c.tagName; }
  }
  const bb = rect(document.querySelector('.board-box'));
  return { cell: +(bb.height / 20).toFixed(1), worst: Math.round(worst), who,
           scroll: document.documentElement.scrollHeight - innerHeight };
}"""
with sync_playwright() as p:
    b = p.webkit.launch()
    for dev, min_cell in (('iPhone 13', 22), ('iPhone SE', 17)):
        res = {}
        for mode in ('正常', '练习'):
            pg = b.new_page(**p.devices[dev])
            pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
            pg.goto(f"http://127.0.0.1:{port}/tetris/index.html")
            pg.wait_for_function("() => !!window.__tetris")
            if mode == '正常':
                pg.evaluate("() => document.getElementById('startBtn').click()")
            else:
                pg.evaluate("() => { __tetris.startPractice(); __tetris.practiceLoad('tsd4'); }")
            pg.wait_for_timeout(300)
            res[mode] = pg.evaluate(LAYOUT)
            pg.close()
        n, pr = res['正常'], res['练习']
        checks = [
            (pr['cell'] >= min_cell, f"{dev} 练习时盘面格子 {pr['cell']}px（正常局 {n['cell']}px，下限 {min_cell}）"),
            (pr['worst'] == 0, f"{dev} 练习时右栏不压顶栏/按键（最大越界 {pr['worst']}px {pr['who']}）"),
            (n['worst'] == 0, f"{dev} 正常局右栏不压顶栏/按键（最大越界 {n['worst']}px {n['who']}）"),
            (pr['scroll'] <= 0, f"{dev} 练习时页面不出现滚动（{pr['scroll']}px）"),
        ]
        print(f"== 布局 {dev} ==")
        for c, m in checks:
            print("  ", ('PASS ' if c else 'FAIL ') + m)
            if not c: fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
