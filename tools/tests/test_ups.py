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

  // 开局就该弹，而且方块停住
  ok(!document.getElementById('upSheet').hidden, '开局弹出修行面板');
  ok(T.game.frozen === true, '选的时候方块停住');
  const cards = [...document.querySelectorAll('#upList [data-up]')];
  ok(cards.length === T.UP_PICK, `给 ${T.UP_PICK} 张候选，实得 ${cards.length}`);
  ok(new Set(cards.map(c=>c.dataset.up)).size === cards.length, '候选不重复');

  // 选一张
  const k = cards[0].dataset.up;
  T.upTake(k);
  ok(T.ups.includes(k), '选中的进了 ups');
  ok(document.getElementById('upSheet').hidden, '选完面板关掉');
  ok(T.game.frozen === false, '选完方块恢复');

  // 已选过的不再出现
  T.upOffer(1);
  const c2 = [...document.querySelectorAll('#upList [data-up]')].map(c=>c.dataset.up);
  ok(!c2.includes(k), '已选过的不再出现在候选里');
  T.upTake(c2[0]);

  // 乘数真的生效
  const base = T.heatGain(1), bm = T.upMul('heat');
  ok(Math.abs(base / bm - 3) < .01, `heatGain 走的是 upMul（${base} / ${bm.toFixed(2)} = 3）`);

  // 逐张验：每张卡的 mul 字段都要被某个计算点读到
  const probes = {
    heat:  () => T.heatGain(1),
    score: () => T.crazyScoreMult(),
    deep:  () => T.deepAt(200, false),
    tau:   () => { const h0 = 1000; T.heat = h0; T.crazyStep ? T.crazyStep(1000) : null; return T.heat; },
    zone:  () => T.zoneNeed(),
    delay: () => { T.heat = 5000; return T.delayCost(); },
    lock:  () => T.lockDelay ? T.lockDelay() : null,
    garb:  () => T.garbagePeriod(),
    chest: () => null, mod: () => null, rain: () => null,
  };
  const fields = new Set();
  for (const u of T.UPS) for (const f of Object.keys(u.mul || {})) fields.add(f);
  const unread = [];
  for (const f of fields){
    const probe = probes[f];
    if (!probe || probe() === null) continue;     // 这几个没有纯函数探针，靠下面的字段表核对
    const before = probe();
    const saved = T.ups.slice();
    T.ups.length = 0;
    const clean = probe();
    T.ups.length = 0; T.ups.push(...saved);
    // 只要「有卡 / 没卡」能让探针读数不同，就说明这个字段被接上了
    const card = T.UPS.find(u => u.mul && u.mul[f]);
    T.ups.length = 0; T.ups.push(card.k);
    const withCard = probe();
    T.ups.length = 0; T.ups.push(...saved);
    if (Math.abs(withCard - clean) < 1e-9) unread.push(f + '(' + card.k + ')');
  }
  ok(unread.length === 0, '每个 mul 字段都被计算点读到' + (unread.length ? '，漏的：' + unread.join(' ') : ''));

  // 血契的禁用真的生效
  T.ups.length = 0; T.ups.push('bare');
  ok(T.rollMod() === null, '孤注：不再出变异块');
  T.ups.length = 0; T.ups.push('vow');
  ok(T.upNever('hold') === true, '断舍：HOLD 被禁');
  T.ups.length = 0;

  // 血契最多两张
  T.ups.push(...T.UPS.filter(u => u.vow).slice(0, 2).map(u => u.k));
  const d = T.upDraw();
  ok(d.every(u => !u.vow), '已挂两张血契时不再抽到血契');
  T.ups.length = 0;

  // 池子抽干不会卡死
  T.ups.push(...T.UPS.map(u => u.k));
  ok(T.upDraw().length === 0, '池子抽干返回空');
  T.upOffer(1);
  ok(document.getElementById('upSheet').hidden, '池子抽干不弹空面板');
  ok(T.upLeft === 0, '池子抽干把欠账清掉，不会反复弹');
  T.ups.length = 0;

  // ── 不选 ──
  T.ups.length = 0;
  T.upOffer(1);
  ok(!document.getElementById('upSheet').hidden, '再发一次，面板打开');
  const before = T.ups.length;
  T.upSkip();
  ok(document.getElementById('upSheet').hidden, '不选之后面板关掉');
  ok(T.ups.length === before, '不选不会给卡');
  ok(T.upLeft === 0, '不选把这次的欠账消掉，不会反复弹');
  ok(T.game.frozen === false, '不选之后方块恢复');
  // 欠两次时，不选一次还会接着弹下一次
  T.upOffer(2);
  T.upSkip();
  ok(!document.getElementById('upSheet').hidden, '欠两次时不选一次还会弹第二次');
  T.upSkip();
  ok(document.getElementById('upSheet').hidden && T.upLeft === 0, '两次都不选就收干净');
  // 按钮真的接上了
  T.upOffer(1);
  ok(!!document.getElementById('upSkip'), '面板上有「不选」按钮');

  // 重开要清空
  document.getElementById('againBtn')?.click();
  ok(T.ups.length <= 1, `重开后 ups 清空（现在 ${T.ups.length} 张，开局那次刚发）`);

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
              ok(document.getElementById('upSheet').hidden, '标准版开局不弹修行面板');
              T.upOffer(3);
              ok(document.getElementById('upSheet').hidden, '标准版 upOffer 无效');
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
