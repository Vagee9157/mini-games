"""堆叠提示模式：模式行为 + 推荐质量

推荐好不好不靠「看着像」：让机器人只照着推荐放，跑几百块，看它死不死、
造不造洞、能不能稳定打四消；再拿「哪里最低放哪里」的新手放法做对照。
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
  const msw = document.getElementById('modeSw');
  const settle = () => { let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16); };

  // ── 先开一局普通局，攒点分 —— 切进提示再切回来，这局要还在 ──
  document.getElementById('startBtn').click();
  T.game.noGarbage = true;
  for (let i = 0; i < 5; i++){ T.hardDrop(); settle(); }
  const nScore = T.game.score, nPieces = T.game.pieces;
  const best0 = T.readBest();

  // ── 进提示模式 ──
  ok(!!msw.querySelector('[data-m="hint"]'), '顶栏有「提示」');
  msw.querySelector('[data-m="hint"]').click();
  ok(T.hintMode && !T.practice, '点「提示」进提示模式');
  ok(document.body.classList.contains('hinting'), 'body 挂上 hinting');
  ok(msw.querySelector('[data-m="hint"]').classList.contains('on'), '开关高亮在「提示」');
  ok(T.game.noGarbage === true, '提示模式不涨灰线');
  // 直接画一次再读 —— dbg.previews 只在真正重绘时更新，同步测试等不到下一帧，
  // 不调的话读到的是上一个模式留下的旧值（第一版这两条就是这么假绿/假红的）
  T.drawPreview();
  ok(T.dbg.previews === 1, `NEXT 只画 1 块（画了 ${T.dbg.previews}）`);

  // 推荐存在、合法、能从顶上直接落到
  const hm = T.hintMove;
  ok(!!hm && hm.type === T.game.piece.type, `出块就有推荐（${hm && hm.type} → 列 ${hm && hm.x} 朝向 ${hm && hm.rot}）`);
  const drops = T.simDrops(T.simBoard(), T.game.piece.type).map(d => d.cells.map(c => c.join(',')).sort().join(';'));
  ok(!!hm && drops.includes(hm.cells.map(c => c.join(',')).sort().join(';')), '推荐的位置是从顶上直接落得到的');
  ok(!!hm && hm.why.length > 0 && document.getElementById('hintWhy').textContent.includes(hm.why),
     `细栏写着理由（「${document.getElementById('hintWhy').textContent}」）`);

  // 没有 HOLD
  T.holdPiece();
  ok(T.game.hold === null, '提示模式按暂存没反应');

  // 照推荐放 → 记一笔一致
  const p = T.game.piece;
  p.rot = hm.rot; p.x = hm.x; p.y = 0; T.hardDrop(); settle();
  ok(T.hintStats.same === 1 && T.hintStats.total === 1, `照推荐放记一笔一致（${T.hintStats.same}/${T.hintStats.total}）`);

  // 故意造洞 → 提示一句、只记总数
  for (let y = 0; y < T.TOTAL_ROWS; y++) T.game.board[y].fill(null);
  const R = T.TOTAL_ROWS;
  for (let x = 0; x < 9; x++) T.game.board[R - 1][x] = 'X';      // 底下一行只空最右
  T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext();
  const q = T.game.piece;
  q.x = 8; q.rot = 0; q.y = 0;    // O 压在井口上，左下那格悬空 → 一个洞
  const before = T.hintStats.total, sameBefore = T.hintStats.same;
  T.hardDrop(); settle();
  const toast = document.getElementById('toast').textContent;
  ok(T.hintStats.total === before + 1 && T.hintStats.same === sameBefore, '没按推荐放：总数 +1、一致数不变');
  ok(/洞/.test(toast), `造了洞会说一句（「${toast}」）`);

  // 不记成绩
  T.game.score = 999999999; T.endGame('堆到顶了');
  ok(T.readBest() === best0, '提示模式不写最高分');

  // 重开还在提示模式、灰线照样关着
  document.getElementById('restartBtn').click();          // 先弹确认面板，点「重新开始 · 提示」
  document.getElementById('rsAgain').click();
  ok(T.hintMode && T.game.noGarbage === true && !!T.hintMove, '提示模式里点重开：还是提示模式、没灰线、有推荐');

  // ── 切回普通 ──
  msw.querySelector('[data-m="normal"]').click();
  ok(!T.hintMode && !document.body.classList.contains('hinting'), '点「普通」退出提示模式');
  ok(T.game.noGarbage !== true, '退出后灰线恢复');
  ok(document.getElementById('overlay').classList.contains('has-save'), '「接着上次玩」还在');
  document.getElementById('resumeSaveBtn').click();
  ok(T.game.score === nScore && T.game.pieces === nPieces, `续玩接回进提示之前那局（${T.game.score} 分 ${T.game.pieces} 块）`);
  T.drawPreview();
  ok(T.dbg.previews === 3, `普通局 NEXT 回到 3 块（画了 ${T.dbg.previews}）`);

  // 提示 ↔ 练习 直接切
  msw.querySelector('[data-m="hint"]').click();
  msw.querySelector('[data-m="practice"]').click();
  ok(T.practice && !T.hintMode && !document.body.classList.contains('hinting'), '提示直接切练习：只剩练习');

  // ════════ 按规则说话的提示 ════════
  T.toggleHintHide && T.hintHidden() && T.toggleHintHide();   // 先确保是「直接看推荐」
  msw.querySelector('[data-m="hint"]').click();
  const R2 = T.TOTAL_ROWS;
  const clear = () => { for (let y = 0; y < R2; y++) T.game.board[y].fill(null); };
  // heights：每列高度（从底往上实心，无洞）
  const setH = hs => { clear(); hs.forEach((h, x) => { for (let k = 0; k < h; k++) T.game.board[R2 - 1 - k][x] = 'X'; }); };
  const give = t => { T.game.piece = null; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
  const toastNow = () => document.getElementById('toast').textContent;
  const place = (rot, x) => { const p = T.game.piece; p.rot = rot; p.x = x; p.y = 0; T.hardDrop(); settle(); };

  // 贴合形状是从块的底面算出来的，不是手写的表
  const keys = t => T.pieceFits(t).map(f => f.key).join(' ');
  ok(keys('S') === '001 10' && keys('Z') === '100 01' && keys('O') === '00' && keys('I') === '0000 0',
     `S/Z/O/I 的贴合形状（S ${keys('S')}，Z ${keys('Z')}）`);
  ok(T.pieceFits('T').length === 4 && T.pieceFits('T').some(f => f.key === '101'), `T 四种，含尖朝下塞凹口（${keys('T')}）`);
  // 贴合 = 底下一格不空
  const B = (hs) => { const b = Array.from({ length: R2 }, () => new Array(10).fill(false));
    hs.forEach((h, x) => { for (let k = 0; k < h; k++) b[R2 - 1 - k][x] = true; }); return b; };
  const sFlat = (b, x) => T.simDrops(b, 'S').find(d => d.rot === 0 && Math.min(...d.cells.map(c => c[0])) === x);
  ok(T.fitGaps(B([2, 2, 3, 0, 0, 0, 0, 0, 0, 0]), sFlat(B([2, 2, 3, 0, 0, 0, 0, 0, 0, 0]), 0).cells) === 0,
     'S 横放在「平平高」上：贴合（底下 0 格空）');
  ok(T.fitGaps(B([2, 2, 2, 0, 0, 0, 0, 0, 0, 0]), sFlat(B([2, 2, 2, 0, 0, 0, 0, 0, 0, 0]), 0).cells) === 1,
     'S 横放在平地上：底下空 1 格');

  // 推荐理由先说规则：找哪种台阶（符号 + 名字），再说为什么是这一处
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]);
  give('S');
  const hm2 = T.hintMove;
  const fit2 = T.pieceFits('S').find(f => f.key === T.bottomPattern('S', hm2.rot).join(''));
  ok(hm2.gaps === 0 && hm2.why.startsWith(fit2.glyph + ' ' + fit2.name),
     `理由以台阶形状开头（「${hm2.why}」）`);

  // 照推荐放：放对 +1、一模一样 +1
  let s0 = Object.assign({}, T.hintStats);
  place(hm2.rot, hm2.x);
  ok(T.hintStats.good === s0.good + 1 && T.hintStats.same === s0.same + 1, '照推荐放：放对、一模一样各 +1');

  // 一样好的另一处：算放对、不算一模一样，并且说「这也行」
  let found = null;
  for (const t of 'OTSZJL'){
    setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]); give(t);
    const b0 = T.simBoard(), r = T.hintBest(b0, t, T.game.queue[0]);
    const hb = T.simFeatures(T.simPlace(b0, r.best.cells).b).holes;
    const k = cs => cs.map(c => c.join(',')).sort().join(';');
    const alt = r.all.find(m => k(m.cells) !== k(r.best.cells) && r.best.score - m.score <= T.HINT_TOL
                              && T.simFeatures(T.simPlace(b0, m.cells).b).holes <= hb);
    if (alt){ found = alt; break; }
  }
  ok(!!found, '平地上能找到一处「和推荐一样好」的落点');
  if (found){
    s0 = Object.assign({}, T.hintStats);
    place(found.rot, found.x);
    ok(T.hintStats.good === s0.good + 1 && T.hintStats.same === s0.same, `放另一处一样好的：算放对，不算一模一样（${T.hintStats.good}/${T.hintStats.same}）`);
    ok(/这也行/.test(toastNow()), `说一句「这也行」（「${toastNow()}」）`);
  }

  // ① 有贴合的地方却留了洞
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]); give('S');
  s0 = JSON.parse(JSON.stringify(T.hintStats));
  place(0, 4);                                   // S 横放在平地上（第 4~6 列），底下空一格
  ok(T.hintStats.rules[0] === s0.rules[0] + 1 && /^①/.test(toastNow()), `留洞判 ①（「${toastNow()}」）`);
  ok(T.hintStats.good === s0.good, '判错的不算放对');
  ok(!!T.hintReveal && T.hintReveal.cells.length > 0, '放错了把推荐亮一下对照');

  // ③ 非 I 塞进井：L 竖放「左高两格」正好贴合在第 8、9 列，不留洞，但堵了井
  setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]); give('L');
  const lw = T.simDrops(T.simBoard(), 'L').find(d => d.rot === 3 && d.cells.every(c => c[0] >= 8) && d.cells.some(c => c[0] === 9));
  s0 = JSON.parse(JSON.stringify(T.hintStats));
  const recWell = T.hintMove.cells.some(c => c[0] === 9);
  place(lw.rot, lw.x);
  ok(!recWell && T.hintStats.rules[2] === s0.rules[2] + 1 && /^③/.test(toastNow()), `堵井判 ③（「${toastNow()}」）`);

  // ④ 堆高了能消不消：九列堆到 13 格、最右一列空着，I 进井就能消
  setH([13, 13, 13, 13, 13, 13, 13, 13, 13, 0]); give('I');
  const recLines = T.hintMove.lines;
  s0 = JSON.parse(JSON.stringify(T.hintStats));
  place(0, 0);                                    // I 横放在左边顶上，不消行
  ok(recLines > 0 && T.hintStats.rules[3] === s0.rules[3] + 1 && /^④/.test(toastNow()),
     `堆高了不消判 ④（推荐消 ${recLines} 行；「${toastNow()}」）`);

  // ── 先自己找 ──
  T.toggleHintHide();
  ok(T.hintHidden() && localStorage.getItem('tetris.hint.hide.v1') === '1', '「先自己找」打开并记住');
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]); give('S');
  ok(/^S 找/.test(document.getElementById('hintWhy').textContent) && !/推荐/.test(document.getElementById('hintWhy').textContent),
     `藏着的时候只说找哪种台阶（「${document.getElementById('hintWhy').textContent}」）`);
  const hmh = T.hintMove;
  place(hmh.rot, hmh.x);
  ok(!T.hintReveal || T.hintReveal.until < performance.now() + 1, '放得和推荐一模一样就不用再亮');
  setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]);
  if (found){ give(found.type); place(found.rot, found.x); ok(!!T.hintReveal, '放了另一处一样好的：亮一下推荐给你对照'); }
  T.toggleHintHide();
  ok(!T.hintHidden(), '再点一下改回直接看');

  // ── 规则卡 ──
  T.openHintSheet();
  const hs = document.getElementById('hintSheet'), hb2 = document.getElementById('hintRulesBody');
  ok(!hs.hidden && T.game.frozen, '规则卡打开，方块停住');
  ok(hb2.querySelectorAll('.hr-rule').length === 4 && hb2.querySelectorAll('.hr-fit').length === 7, '四条规则 + 七种块');
  ok(!!hb2.querySelector('.hr-rule.worst'), `标出最常犯的那条（${(hb2.querySelector('.hr-rule.worst b') || {}).textContent}）`);
  T.closeHintSheet();
  ok(hs.hidden && !T.game.frozen, '关掉接着放');
  return L;
}"""

# 推荐质量：照推荐放 vs 哪里最低放哪里。用的是调参时没用过的种子。
QUALITY = r"""(arg) => {
  const T = __tetris, {policy, seed, N} = arg;
  T.setSeed(seed); T.startHint();
  let tetris = 0, holes = 0, placed = 0;
  for (let i = 0; i < N; i++){
    let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16);
    if (T.game.over) break;
    const p = T.game.piece, b0 = T.simBoard(), h0 = T.simFeatures(b0).holes;
    let m = T.hintMove;
    if (policy === 'tol'){
      // 「这也行」的那些落点里随机挑：容差要是放宽了，这一路的质量会先掉
      const r = T.hintBest(b0, p.type, T.game.queue[0]);
      const hb = T.simFeatures(T.simPlace(b0, r.best.cells).b).holes;
      const okm = r.all.filter(c => r.best.score - c.score <= T.HINT_TOL && T.simFeatures(T.simPlace(b0, c.cells).b).holes <= hb);
      m = okm[(i * 7 + seed) % okm.length];
    }
    if (policy === 'lowest'){
      const all = T.simDrops(b0, p.type);
      m = all.reduce((a, c) => { const ta = Math.min(...a.cells.map(v=>v[1])), tc = Math.min(...c.cells.map(v=>v[1]));
        return tc > ta ? c : a; });
    }
    p.rot = m.rot; p.x = m.x; p.y = 0;
    const l0 = T.game.lines; T.hardDrop(); placed++;
    g = 0; while (T.clearing && g++ < 400) T.step(16);
    if (T.game.lines - l0 === 4) tetris++;
    if (T.simFeatures(T.simBoard()).holes > h0) holes++;
  }
  return { placed, over: T.game.over, lines: T.game.lines, tetris, holes };
}"""

fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(); errs = []
    pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/tetris/index.html")
    pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
    pg.set_default_timeout(900000)
    r = pg.evaluate(JS)
    # 造洞率按两局合计算：单局波动很大（调参时同一组权重单局在 1.7%~5.3% 之间），
    # 按单局卡 5% 会因为运气红。5% 这条线是自定的，不是规范。
    tot_holes = tot_placed = 0
    for seed in (77, 88):
        h = pg.evaluate(QUALITY, {'policy': 'hint', 'seed': seed, 'N': 400})
        n = pg.evaluate(QUALITY, {'policy': 'lowest', 'seed': seed, 'N': 400})
        share = h['tetris'] * 4 / max(1, h['lines'])
        tot_holes += h['holes']; tot_placed += h['placed']
        r.append(('PASS ' if not h['over'] and h['placed'] == 400 else 'FAIL ') +
                 f"种子{seed} 照推荐放 400 块不死（放了 {h['placed']}，造洞 {h['holes']} 次）")
        r.append(('PASS ' if share >= .5 else 'FAIL ') +
                 f"种子{seed} 四消占消行至少一半（{int(share*100)}%）")
        r.append(('PASS ' if n['over'] or n['holes'] > h['holes'] * 3 else 'FAIL ') +
                 f"种子{seed} 对照组「哪里最低放哪里」明显更差（{'堆死于第 ' + str(n['placed']) + ' 块' if n['over'] else '造洞 ' + str(n['holes'])}）")
    for seed in (77, 88):
        t = pg.evaluate(QUALITY, {'policy': 'tol', 'seed': seed, 'N': 400})
        share = t['tetris'] * 4 / max(1, t['lines'])
        r.append(('PASS ' if not t['over'] and t['holes'] <= 400 * .05 and share >= .5 else 'FAIL ') +
                 f"种子{seed} 在「这也行」的落点里随便挑：不死、造洞 {t['holes']} 次、四消占 {int(share*100)}%")
    r.append(('PASS ' if tot_holes <= tot_placed * .05 else 'FAIL ') +
             f"两局合计造洞不超过 5%（{tot_holes}/{tot_placed} = {tot_holes*100/max(1,tot_placed):.1f}%）")
    print(f"== 标准版 ==  JS错误 {len(errs)}")
    for e in errs[:4]: print("   !", e)
    fails += len(errs)
    for l in r:
        print("  ", l)
        if l.startswith('FAIL'): fails += 1
    pg.close()

    pg = b.new_page(); pg.route("**fonts.googleapis.com/**", lambda r: r.abort())
    pg.goto(f"http://127.0.0.1:{port}/crazy/index.html")
    pg.wait_for_function("window.__tetris !== undefined", timeout=10000)
    c = pg.evaluate("""() => [document.getElementById('hintBar') === null,
                             !document.querySelector('[data-m="hint"]')]""")
    print("== 疯狂版 ==")
    for okk, m in zip(c, ('疯狂版没有提示细栏', '疯狂版没有「提示」开关')):
        print("  ", ('PASS ' if okk else 'FAIL ') + m)
        if not okk: fails += 1
    b.close()
srv.shutdown(); srv.server_close()
sys.exit(1 if fails else 0)
