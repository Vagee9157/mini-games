"""修行（开局三选一 + 局内升级）"""
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

  // 开局：直接命中一张，不弹任何面板、不停方块
  ok(T.ups.length === T.UP_FIRST, `开局自动命中 ${T.UP_FIRST} 张（实得 ${T.ups.length}）`);
  ok(T.game.frozen !== true, '不冻住方块 —— 没有要人决策的面板了');
  ok(document.querySelector('.sheet:not([hidden])') === null, '没有任何面板被打开');
  ok(T.upRound === 1, '算发过一次');
  const k = T.ups[0];
  ok(!!T.UP_BY[k], `命中的是表里的卡（${k} / ${T.UP_BY[k].n}）`);

  // 提示要把名字和效果一起报出来 —— 没面板了，这是唯一一次看到描述
  const toast = document.getElementById('toast');
  ok(toast.classList.contains('show'), '屏幕上报了一条提示');
  ok(toast.textContent.includes(T.UP_BY[k].n), `提示里有卡名（「${toast.textContent}」）`);
  ok(toast.textContent.includes(T.UP_BY[k].t), '提示里有效果描述');
  // 只断言常数比 1100 大是假阳性：真正决定能看多久的是 CSS 动画时长，
  // 它 forwards 到 opacity:0，class 还挂着人也看不见了。实测写死 1.1s 时
  // 传 3200 没有任何效果（1.5 秒 opacity 已经是 0）。量算出来的那个值。
  const anim = parseFloat(getComputedStyle(toast).animationDuration) * 1000;
  ok(Math.abs(anim - T.UP_SAY_MS) < 50,
     `提示动画真的跟着时长走（CSS ${anim}ms vs UP_SAY_MS ${T.UP_SAY_MS}ms）`);
  ok(T.UP_SAY_MS > 1100, `而且比默认的 toast 长 —— 带数字的描述读得完`);
  // 折行也要验：绝对定位 + left:50% 时 shrink-to-fit 的可用宽度只有一半，
  // 没有 width:max-content 的话这句会被挤成四行窄条
  ok(toast.getBoundingClientRect().width > toast.parentElement.getBoundingClientRect().width * .6,
     `提示没被挤窄（宽 ${Math.round(toast.getBoundingClientRect().width)}px）`);

  // 命中过的不再出现在池子里
  ok(T.upPool().every(u => u.k !== k), '命中过的不再进池子');
  T.upOffer(1);
  ok(T.ups.length === 2 && T.ups[1] !== k, '再触发一次，命中的是另一张');

  // 乘数真的生效
  // 原来写的是 heatGain(1) / upMul('heat') === 3，那是个恒等式（heatGain 的定义
  // 就是 base × upMul）。而且当时 ups 里是随机抽的卡，多数情况 upMul 本来就是 1，
  // 连「有没有卡」都没区分。改成挂上明确的卡前后对比。
  T.ups.length = 0;
  const g0 = T.heatGain(1);
  T.ups.push('forge');
  const g1 = T.heatGain(1);
  const forgeK = T.UP_BY.forge.mul.heat;
  ok(Math.abs(g1 / g0 - forgeK) < .01,
     `熔炉让热度注入变成 ×${forgeK}（${g0} → ${g1}）`);
  T.ups.length = 0;

  // 逐张验：每张卡的 mul 字段都要被某个计算点读到。
  //
  // 这条以前是假的：没有探针的字段被**静默跳过**（chest / mod / rain / lock 四个），
  // 断言却说「每个」。现在改成反过来 —— 字段没有探针就直接判失败，
  // 这样以后加新字段（比如这次的 rainmult）忘了接计算点，这里会红。
  const probes = {
    heat:     () => T.heatGain(1),
    score:    () => T.crazyScoreMult(),
    deep:     () => T.deepAt(300, false),
    garb:     () => T.garbagePeriod(),
    zone:     () => T.zoneNeed(),
    delay:    () => { T.heat = 5000; return T.delayCost(); },
    lock:     () => T.lockDelay(),
    chest:    () => T.chestRate(),
    mod:      () => T.modRate(false),
    rainmult: () => T.rainMult(),
  };
  const fields = new Set();
  for (const u of T.UPS) for (const f of Object.keys(u.mul || {})) fields.add(f);
  const noProbe = [], unread = [];
  for (const f of fields){
    if (!probes[f]){ noProbe.push(f); continue; }
    const saved = T.ups.slice();
    T.ups.length = 0;
    const clean = probes[f]();
    const card = T.UPS.find(u => u.mul && u.mul[f]);
    T.ups.length = 0; T.ups.push(card.k);
    const withCard = probes[f]();
    T.ups.length = 0; T.ups.push(...saved);
    if (!(Math.abs(withCard - clean) > 1e-9)) unread.push(f + '(' + card.k + ')');
  }
  ok(noProbe.length === 0, '每个 mul 字段都有探针' + (noProbe.length ? '，缺的：' + noProbe.join(' ') : ''));
  ok(unread.length === 0, '每个 mul 字段都被计算点读到' + (unread.length ? '，漏的：' + unread.join(' ') : ''));

  // 血契的禁用真的生效
  T.ups.length = 0; T.ups.push('bare');
  ok(T.rollMod() === null, '孤注：不再出变异块');
  T.ups.length = 0; T.ups.push('vow');
  ok(T.upNever('hold') === true, '断舍：HOLD 被禁');
  T.ups.length = 0;

  // 血契最多两张
  T.ups.push(...T.UPS.filter(u => u.vow).slice(0, 2).map(u => u.k));
  ok(T.upPool().every(u => !u.vow), '已挂两张血契时池子里不再有血契');
  T.ups.length = 0;

  // 池子抽干不会卡死，也不会凭空多出一张
  T.ups.push(...T.UPS.map(u => u.k));
  ok(T.upPool().length === 0, '池子抽干返回空');
  const full = T.ups.length;
  T.upOffer(1);
  ok(T.ups.length === full, '池子抽干时再触发不会多给一张，也不报错');
  T.ups.length = 0;

  // 整局最多命中 UPS.length 张 —— 连触发到死也不会重复
  T.ups.length = 0;
  for (let i = 0; i < 60; i++) T.upOffer(1);
  // 上限不是全表 —— 三张血契最多挂两张，所以整局天花板是 UPS.length - 1。
  // 写成算出来的而不是写死，以后加卡/加血契它自己跟着动。
  const cap = T.UPS.length - Math.max(0, T.UPS.filter(u => u.vow).length - 2);
  ok(T.ups.length === cap,
     `连触发 60 次拿到 ${T.ups.length} 张 = 天花板 ${cap}（全表 ${T.UPS.length}，血契上限扣掉 ${T.UPS.length - cap}）`);
  ok(new Set(T.ups).size === T.ups.length, '没有一张重复命中');
  ok(T.ups.filter(k => T.UP_BY[k].vow).length <= 2,
     `血契上限在连触发下也守得住（实得 ${T.ups.filter(k => T.UP_BY[k].vow).length} 张）`);

  // ── 存档往返 ──
  T.ups.length = 0; T.ups.push('forge', 'ember');
  T.game.lines = T.upNext; T.upStep();
  T.saveGame(true);
  const raw = JSON.parse(localStorage.getItem(T.SAVE_KEY));
  ok(Array.isArray(raw.ups) && raw.ups.length >= 2, '存档里有 ups');
  ok(raw.upNext === T.upNext, `存档里的 upNext 跟着活的走（${raw.upNext}）`);
  const want = T.ups.slice();
  T.restoreGame(raw);
  ok(JSON.stringify(T.ups) === JSON.stringify(want), '续玩把修行卡接回来了');
  const n0 = T.ups.length;
  T.upStep();
  ok(T.ups.length === n0, '续玩之后不连环命中');
  // 老存档里的未知 key 要被过滤掉
  T.restoreGame(Object.assign({}, raw, { ups: ['forge', '这张卡已经删了'] }));
  ok(T.ups.length === 1 && T.ups[0] === 'forge', '续玩过滤掉未知的修行 key');

  // ── 随机触发 ──
  //
  // 「期望值不变、只是不可预测」这句承诺得量出来，否则改成随机顺手把节奏
  // 调快调慢了都看不见 —— 整局能拿几张卡直接决定数值强度。
  const lo = Math.round(T.UP_EVERY * (1 - T.UP_JIT));
  const hi = Math.round(T.UP_EVERY * (1 + T.UP_JIT));
  const N = 4000, seen = new Set();
  let sum = 0, out = 0;
  for (let i = 0; i < N; i++){
    T.upRoll(0);
    const v = T.upNext;
    seen.add(v); sum += v;
    if (v < lo || v > hi) out++;
  }
  ok(out === 0, `${N} 次掷都落在 [${lo}, ${hi}]（越界 ${out} 次）`);
  // 真的在随机：常数实现会只有一个取值
  ok(seen.size > (hi - lo) * .8, `取值铺开了（${seen.size} 种，区间宽 ${hi - lo + 1}）`);
  const mean = sum / N;
  ok(Math.abs(mean - T.UP_EVERY) < T.UP_EVERY * .03,
     `平均间隔 ${mean.toFixed(1)} 行 ≈ UP_EVERY ${T.UP_EVERY}（节奏没被悄悄改）`);
  // 从 from 往后推，不是从 0 —— 累加式碰上压实那种一次吞好几行会连弹两次
  T.upRoll(300);
  ok(T.upNext >= 300 + lo && T.upNext <= 300 + hi,
     `从当前行数往后推（upRoll(300) → ${T.upNext}）`);

  // ── 如常：这张卡的「正确」是什么都不发生 ──
  T.ups.length = 0;
  T.heat = 5000;
  const snap = () => [T.crazyScoreMult(), T.garbagePeriod(), T.heatGain(2), T.modRate(false),
                      T.chestRate(), T.zoneNeed(), T.delayCost(), T.lockDelay(),
                      T.rainMult(), T.deepAt(300, false)];
  const b4 = snap();
  T.ups.push('plain');
  const af = snap();
  ok(b4.every((v, i) => v === af[i]),
     `如常：${b4.length} 个观测点一个都没动（${b4.map(v=>+v.toFixed(2))} → ${af.map(v=>+v.toFixed(2))}）`);
  ok(!T.upNever('hold') && !T.upNever('mod'), '如常：不禁 HOLD、不禁变异块');
  ok(T.rollMod(false) !== undefined, '如常：变异块照常掷');
  T.ups.length = 0;
  ok(T.UPS.filter(u => !u.mul && !u.never).length === 1,
     '表里只有一张空卡 —— 多了就是有卡忘了填 mul');

  // ── 不打断：提示是非阻塞的，梭哈和 ZONE 进行中照发 ──
  // 原来这三件事要专门防（面板会把整局冻住）。改成提示之后守卫删了，
  // 这里把「删对了」钉住：不冻方块、不关掉正在进行的窗口。
  T.restart();
  T.heat = 5000;
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);
  ok(T.betOffer > 0, '梭哈待接');
  let n1 = T.ups.length;
  T.game.lines = T.upNext; T.upStep();
  ok(T.ups.length === n1 + 1, '梭哈待接时照样命中，不推迟');
  ok(T.betOffer > 0, '而且没有把梭哈窗口挤掉');
  ok(T.game.frozen !== true, '方块没有被冻住');

  T.restart();
  T.zoneCharge = T.zoneNeed(); T.step(20);
  ok(T.zoneLeft > 0, 'ZONE 开着');
  n1 = T.ups.length;
  T.game.lines = T.upNext; T.upStep();
  ok(T.ups.length === n1 + 1, 'ZONE 期间照样命中');
  ok(T.zoneLeft > 0, '而且 ZONE 没被打断');

  // 重开要清空
  document.getElementById('againBtn')?.click();
  ok(T.ups.length === T.UP_FIRST, `重开后只剩开局那次命中的（${T.ups.length} 张）`);

  return L;
}"""
fails = 0
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
              const L=[]; const ok=(c,m)=>L.push((c?'PASS ':'FAIL ')+m);
              ok(T.ups.length===0, '标准版开局不发修行');
              ok(document.getElementById('toast').classList.contains('show')===false,
                 '标准版开局没有修行提示');
              T.upOffer(3); T.upHit(); T.game.lines=999; T.upStep();
              ok(T.ups.length===0, '标准版 upOffer / upHit / upStep 全都不给卡');
              ok(T.upMul('heat')===1 && T.upMul('score')===1, '标准版所有乘数恒为 1');
              ok(T.upNever('hold')===false, '标准版不禁用任何东西');
              return L; }""")
        else:
            r=pg.evaluate(JS)
        print(f"== {name} ==  JS错误 {len(errs)}")
        for e in errs[:4]: print("   !",e); 
        fails += len(errs)
        for l in r:
            print("  ",l)
            if l.startswith('FAIL'): fails += 1
        pg.close()
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
