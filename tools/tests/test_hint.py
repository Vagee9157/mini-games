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
  document.getElementById('restartBtn').click();
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
