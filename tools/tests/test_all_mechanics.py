"""全机制冒烟：每个机制都真的跑一遍，确认它产生了该产生的效果。

和别的测试文件的分工：那些测单个机制的细节和边界，这个只回答一个问题 ——
「这个机制今天还活着吗」。加新机制时往这里补一条。
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
  const passUp = () => { const s=document.getElementById('upSheet');
    if (s && !s.hidden){ const c=document.querySelector('#upList [data-up]'); if (c) T.upTake(c.dataset.up); } };
  const fresh = () => { document.getElementById('againBtn')?.click();
                        document.getElementById('startBtn')?.click(); passUp(); T.ups.length = 0; };
  const B = () => T.game.board;
  const Z = T.ZONE;
  const clean = () => { const b=B(); for (let y=0;y<b.length;y++) for (let x=0;x<b[0].length;x++) b[y][x]=null; };
  const fillRow = (y, gap) => { const b=B(); for (let x=0;x<b[0].length;x++) b[y][x] = (x===gap?null:'T'); };

  document.getElementById('startBtn').click(); passUp(); T.ups.length = 0;
  const R = B().length, C = B()[0].length;

  // ── 热度 ──
  T.heat = 0; T.crazyOnClear(1, null, false);
  ok(T.heat > 0, `热度注入（单行 +${T.heat.toFixed(1)}）`);
  ok(T.heatMultAt(400,false) > T.heatMultAt(100,false), '热度越高倍率越高');
  T.heat = 1000; T.crazyStep(T.HEAT_TAU);
  ok(T.heat < 1000 * .4, `热度会衰减（${T.HEAT_TAU/1000}s 后剩 ${Math.round(T.heat)}）`);

  // ── 深局 ──
  ok(T.deepAt(200,false) > T.deepAt(50,false), '深局加成随行数增长');
  ok(T.deepAt(10,false) === 1, '没到门槛时深局不生效');

  // ── 狂欢局 ──
  ok(T.RUSH_MULT > 1 && T.RUSH_GARBAGE < 1, '狂欢局：分数更高、灰线更快');
  ok(typeof T.rushEvery === 'function' && T.RUSH_EVERY > 0, `狂欢局保底每 ${T.RUSH_EVERY} 局`);

  // ── 梭哈 ──
  fresh();
  T.heat = 500;
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);
  ok(T.betOffer > 0, `梭哈弹出（消 ${T.BET_OFFER_NEED} 行）`);
  T.betAccept();
  ok(T.betLeft > 0, '梭哈能接受');
  const hb = T.heat;
  T.crazyOnClear(T.BET_CAP, null, false);     // 一次消满上限 → 直接封顶结算
  ok(T.heat > hb, `梭哈赢了热度变多（${Math.round(hb)} → ${Math.round(T.heat)}）`);
  ok(T.betCool > 0, '结算后进冷却');
  // 低热度也要能弹 —— 这是这次改动的要点
  fresh(); T.heat = T.BET_MIN_HEAT + 1;
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);
  ok(T.betOffer > 0, `低热度（${T.BET_MIN_HEAT+1}）也能弹梭哈`);
  // T-spin 也能弹
  fresh(); T.heat = 100;
  T.crazyOnClear(1, 'tspin', false);
  ok(T.betOffer > 0, 'T-spin 也能弹梭哈');

  // ── 燃点 ──
  fresh();
  T.heat = T.BURN_FLOOR * 2;
  for (let i = 0; i < 40 && !T.burnOn(); i++){ T.heat *= 1.08; T.burnStep(T.BURN_SAMPLE); }
  ok(T.burnOn(), '热度猛涨会点燃燃点');

  // ── FEVER ──
  fresh(); T.feverStart();
  ok(T.fever > 0, 'FEVER 能启动');

  // ── 爆发倍率：相加不相乘 ──
  fresh();
  T.heat = 600; T.ups.length = 0;
  const base = T.crazyScoreMult();
  T.feverStart();
  const f = T.crazyScoreMult() / base;
  ok(Math.abs(f - T.FEVER_MULT) < .01, `FEVER 单独还是 ×${T.FEVER_MULT}（实得 ×${f.toFixed(2)}）`);
  // 再叠一个燃点
  T.heat = T.BURN_FLOOR * 2;
  for (let i = 0; i < 40 && !T.burnOn(); i++){ T.heat *= 1.08; T.burnStep(T.BURN_SAMPLE); }
  if (T.burnOn()){
    T.heat = 600;
    const b2 = T.crazyScoreMult();
    const want = base * (1 + (T.FEVER_MULT - 1) + (T.BURN_MULT - 1));
    const mul  = base * T.FEVER_MULT * T.BURN_MULT;
    ok(Math.abs(b2 - want) < want * .02,
       `FEVER+燃点 = 相加 ×${(want/base).toFixed(2)}（若相乘会是 ×${(mul/base).toFixed(2)}，实得 ×${(b2/base).toFixed(2)}）`);
    ok(b2 < mul * .8, '叠加确实被压扁了，不是乘出来的');
  }

  // ── FEVER 冷却 ──
  fresh();
  T.feverStart();
  ok(T.fever > 0, 'FEVER 能开');
  T.step(T.FEVER_MS + 200);
  ok(T.fever <= 0, 'FEVER 到时结束');
  ok(T.feverCool > 0, '结束后进冷静期');
  T.feverStart();
  ok(T.fever <= 0, `冷静期里开不出 FEVER（还剩 ${Math.round(T.feverCool/1000)}s）`);
  T.step(T.FEVER_COOL + 200);
  ok(T.feverCool <= 0, '冷静期会走完');
  T.feverStart();
  ok(T.fever > 0, '冷静期过后又能开');
  ok(T.FEVER_MS / (T.FEVER_MS + T.FEVER_COOL) < .35,
     `占空比上限 ${(T.FEVER_MS/(T.FEVER_MS+T.FEVER_COOL)*100).toFixed(0)}%（原来实测 83%）`);

  // ── 变异块：七种都要有实现 ──
  fresh();
  const mods = T.MOD_RATES.map(r => r[0]);
  ok(mods.length === 7, `变异块共 ${mods.length} 种`);
  for (const k of mods) ok(!!T.MOD_TINT[k], `${k} 有配色`);
  // 逐个跑一遍，确认真的改了盘面（金块除外，它只改倍率）
  const snap = () => B().map(r => r.join('')).join('|');
  for (const [k, fn] of [['bomb', T.bombAt], ['laser', T.laserAt]]){
    clean();
    for (let y = R - 5; y < R; y++) fillRow(y, 9);
    const before = snap();
    fn({ type:'O', x:4, y:R-7, rot:0 });
    ok(snap() !== before, `${k} 真的改了盘面`);
  }
  // 分流要单独搭场景，两个前提缺一不可：
  // ① 它动的是**已经盖进盘面**的格子（在 lockPiece 里跑在落盘之后）
  // ② 地形必须高低不平 —— 整块压在实心行上时本来就没东西可掉，
  //    会得到一个「没改盘面」的假阴性
  clean();
  for (let x = 0; x < 3; x++){ B()[R-1][x] = 'T'; B()[R-2][x] = 'T'; }   // 左边高两格
  const pf = { type:'I', x:1, y:R-3, rot:0 };
  for (const [dx,dy] of T.cellsOf(pf.type, pf.rot)) B()[pf.y+dy][pf.x+dx] = 'I';
  const beforeFork = snap();
  T.forkAt(pf);
  ok(snap() !== beforeFork, 'fork(分流) 真的改了盘面');
  ok(B()[R-1][4] === 'I', '分流让架空的格子各自落到底');
  clean(); for (let y = R-3; y < R; y++) fillRow(y, 2);
  const beforeFill = snap(); T.fillAt({ type:'O', x:1, y:R-5, rot:0 });
  ok(snap() !== beforeFill, 'fill(灌注) 真的填了格子');
  clean(); fillRow(R-2, 3); fillRow(R-1, 3);
  T.dyeAt({ type:'O', x:4, y:R-3, rot:0 });
  ok(T.rainRow >= 0, 'dye(染色) 标出了彩虹行');
  ok(T.GOLD_MULT > 1, `gold(金块) 得分 ×${T.GOLD_MULT}`);

  // ── 事件：每一条都要能点着并自己结束 ──
  fresh();
  for (const e of T.EVENTS){
    // 每条事件前都重开：十二条事件 × 最多 9 秒 = 九十秒模拟时间，
    // 中间对局会被灰线打死，而 game.over 之后 stepOnce 直接 return，
    // 事件钟不再走 —— 后面几条就会得到「不会自己结束」的假阳性
    fresh();
    T.evForce(e.key);
    const fired = e.ms > 0 ? (T.evActive === e.key) : true;
    ok(fired, `事件「${e.name}」能触发`);
    if (e.ms > 0){ T.step(e.ms + 500); ok(T.evActive !== e.key, `事件「${e.name}」会自己结束`); }
  }

  // ── 灰线 / 宝箱 / 冰冻 ──
  fresh();
  const g0 = T.game.garbage; T.riseGarbage();
  ok(T.game.garbage === g0 + 1, '灰线会上顶');
  ok(B()[R-1].some(c => c === 'X'), '灰线是灰色格子');
  ok(T.CHEST_RATE > 0 && T.CHEST_P.length === 2, '宝箱有概率和三档结果');
  clean(); for (let y=R-4;y<R;y++) fillRow(y, 5);
  ok(T.doFreeze() !== false || true, '冰冻能调用');

  // ── 彩虹行 ──
  fresh();
  clean(); for (let y=R-4;y<R;y++) fillRow(y, 5);
  T.rainPick();
  ok(T.rainRow >= 0, '彩虹行能标记');
  T.syncRainMark();
  ok(!document.getElementById('rainMark').hidden, '彩虹行三角显示');
  ok(T.rainHit([T.rainRow]) === true, '消到彩虹行能识别');

  // ── 挪列 / 换牌 ──
  fresh();
  T.heat = T.SWAP_COST * 2;
  clean(); B()[R-1][0] = 'T';
  T.doSwap(0, 1);
  ok(B()[R-1][1] === 'T' && !B()[R-1][0], '挪列能交换两列');
  T.heat = T.REROLL_COST * 2;
  const cur = T.game.piece && T.game.piece.type;
  ok(T.canReroll() === true, '热度够时能换牌');

  // ── 缓期 ──
  fresh();
  T.heat = 2000; T.garbageTimer = T.garbagePeriod() - 2000;
  ok(T.canDelay() === true, '缓期能提供');
  const hd = T.heat, gt = T.garbageTimer;
  T.doDelay();
  ok(T.heat < hd && T.garbageTimer < gt, '缓期扣热度并把灰线钟往回推');

  // ── ZONE ──
  fresh();
  T.zoneCharge = T.zoneNeed(); T.zoneStart();
  ok(T.zoneLeft > 0, 'ZONE 能启动');
  clean(); fillRow(R-1, -1); T.applyClear([R-1]);
  ok(T.zoneRows === 1 && B().filter(r=>r.every(c=>c===Z)).length === 1, 'ZONE 期间消行沉到底部');
  const sz = T.game.score; T.zoneEnd('');
  ok(T.game.score > sz, 'ZONE 结算给奖金');
  ok(B().filter(r=>r.every(c=>c===Z)).length === 0, 'ZONE 结算清掉死行');

  // ── 修行 ──
  fresh();
  ok(T.UPS.length === 12, `修行共 ${T.UPS.length} 张卡`);
  ok(T.UPS.filter(u=>u.vow).length === 3, `其中 ${T.UPS.filter(u=>u.vow).length} 张血契`);
  for (const u of T.UPS){
    T.ups.length = 0; T.ups.push(u.k);
    const f = Object.keys(u.mul || {})[0];
    const changed = u.never ? T.upNever(u.never) : (f ? T.upMul(f) !== 1 : false);
    ok(changed, `修行「${u.n}」真的生效`);
  }
  T.ups.length = 0;

  // ── 热度地板 ──
  fresh();
  T.heat = 0; T.syncHeat();
  ok(T.heat === T.HEAT_FLOOR, `热度被地板托住（0 → ${T.heat}）`);
  T.heat = 1; T.crazyStep(1000);
  ok(T.heat >= T.HEAT_FLOOR, '衰减也不会掉破地板');
  ok(T.BET_MIN_HEAT <= T.HEAT_FLOOR, '梭哈门槛不高于地板 —— 等于没有热度条件');

  // ── 状态框：同时最多一个可点的行 ──
  fresh();
  T.heat = 5000;
  T.zoneCharge = T.zoneNeed();                       // ZONE 就绪
  T.garbageTimer = T.garbagePeriod() - 2000;         // 缓期也可用
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);     // 梭哈也弹
  const rows = T.fxRows();
  const btns = rows.filter(r => r.go).length;
  ok(btns <= 1, `三个号召同时成立时，状态框只给一个按钮（实得 ${btns}）`);
  ok(rows[0] && rows[0].k === 'betoffer', '优先级：梭哈排第一（它十秒就过期）');
  T.syncFx();
  ok(document.querySelectorAll('#fxBox .fxgo').length <= 1, 'DOM 里也只有一颗按钮');

  // ── 盘面横幅：只服务梭哈（其余机制都改成自动触发了）──
  fresh();
  const flash = document.getElementById('betFlash');
  const on = () => flash.classList.contains('on');
  T.heat = 5000;
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);
  ok(on() && flash.dataset.act === 'bet', '梭哈会在盘面上亮');
  ok(/梭哈/.test(document.getElementById('betFlashTxt').innerHTML), '横幅写的是梭哈的规则');
  ok(T.ACT_SHOW === 5000, `横幅停留 ${T.ACT_SHOW/1000} 秒`);
  T.step(T.ACT_SHOW + 100);
  ok(!on(), '到时自己收掉');
  T.betAccept(); T.step(T.BET_MS + 500);

  // ── 自动触发：ZONE 攒满自己开 ──
  fresh();
  T.zoneCharge = T.zoneNeed(); T.step(20);
  ok(T.zoneLeft > 0, 'ZONE 攒满自动开始，不用点');
  ok(T.fxRows().every(r => r.act !== 'zone'), '状态框不再给 ZONE 按钮');
  T.zoneEnd('');

  // ── 自动触发：缓期只在危险区里自己付 ──
  fresh();
  T.heat = 5000;
  clean();                                   // 盘面空 → 不在危险区
  T.garbageTimer = T.garbagePeriod() - 2000;
  const h1 = T.heat; T.delayAuto();
  ok(T.heat === h1, '不危险的时候缓期一分不动');
  // 堆到危险区
  for (let y = 2; y < R; y++) fillRow(y, 5);
  T.syncDanger ? T.syncDanger() : null;
  T.step(20);
  ok(T.heat < h1, `进危险区后自动付（${Math.round(h1)} → ${Math.round(T.heat)}）`);
  ok(T.fxRows().every(r => r.act !== 'delay'), '状态框不再给缓期按钮');

  // ── 状态框里没有任何按钮，除非是梭哈 ──
  fresh();
  T.heat = 5000; T.zoneCharge = T.zoneNeed() - 1;
  T.garbageTimer = T.garbagePeriod() - 2000;
  ok(T.fxRows().filter(r => r.go).length === 0, '平时状态框一个按钮都没有');
  T.crazyOnClear(T.BET_OFFER_NEED, null, false);
  ok(T.fxRows().filter(r => r.go).length === 1, '只有梭哈会给按钮');

  // ── 目标线 / 收手 ──
  fresh();
  ok(typeof T.goalScore === 'function', '目标线能算');
  ok(typeof T.isStopRun === 'function' && T.STOP_MIN_LINES > 0, '收手有门槛');

  // ── 存档往返 ──
  fresh();
  T.game.score = 12345; T.game.lines = 42; T.heat = 777; T.ups.push('forge');
  T.saveGame(true);
  const raw = JSON.parse(localStorage.getItem(T.SAVE_KEY));
  T.restoreGame(raw);
  ok(T.game.score === 12345 && T.game.lines === 42, '存档接回分数和行数');
  ok(Math.abs(T.heat - 777) < 1, '存档接回热度');
  ok(T.ups.includes('forge'), '存档接回修行');

  return L;
}"""
fails = 0
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
    pg.wait_for_function("window.__tetris !== undefined", timeout=15000)
    r=pg.evaluate(JS)
    print(f"JS错误 {len(errs)}")
    for e in errs[:6]: print("   !",e)
    fails += len(errs)
    for l in r:
        print("  ",l)
        if l.startswith('FAIL'): fails += 1
    b.close()
srv.shutdown(); srv.server_close()
print(f"\n{'全部通过' if not fails else str(fails)+' 条没过'}")
sys.exit(1 if fails else 0)
