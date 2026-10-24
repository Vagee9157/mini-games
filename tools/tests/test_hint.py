"""提示模式：模式行为 + 推荐质量

推荐教一套固定的定式：九列堆平 + 最右一列留井 + 等 I 竖进井打四消（不教 T 旋）。
六条规则 ①保命 ②不留洞 ③井只给 I ④堆平留台阶 ⑤灰线积多了先挖 ⑥暂存；推荐只看当前块 + 下一块；
几处一样好时固定「先低后左」。底部四行说明：放这里（定式）/ 为什么 / 别处为什么不行 / 最少按法。
条件和普通局一样：开灰线、正常升级、能暂存、看 3 个 NEXT。


推荐好不好不靠「看着像」：让机器人只照着推荐放，跑几百块，看它死不死、
造不造洞、能不能稳定打四消；再拿「哪里最低放哪里」的新手放法做对照。
"""
import os, http.server, socketserver, threading, functools, sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message=lambda *a,**k:None
socketserver.TCPServer.allow_reuse_address=True
socketserver.ThreadingTCPServer.daemon_threads=True; srv=socketserver.ThreadingTCPServer(("127.0.0.1",0),H); srv.RequestHandlerClass.log_message=lambda *a,**k:None
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
  ok(T.game.noGarbage === false, '提示模式和普通局一样涨灰线');
  // 直接画一次再读 —— dbg.previews 只在真正重绘时更新，同步测试等不到下一帧，
  // 不调的话读到的是上一个模式留下的旧值（第一版这两条就是这么假绿/假红的）
  T.drawPreview();
  ok(T.dbg.previews === 3, `NEXT 和普通局一样看 3 块（画了 ${T.dbg.previews}）`);

  // 推荐存在、合法、能从顶上直接落到
  // 第一块要是 I 会建议暂存（井还空着），换成 L 再看落点
  if (T.game.piece.type === 'I' || (T.tsRec && T.tsRec.kind === 'hold')){ T.game.piece = null; T.game.queue.unshift('L'); T.game.mods.unshift(null); T.spawnNext(); }
  const hm = T.hintMove;
  ok(!!hm && !!hm.cells && hm.type === T.game.piece.type, `出块就有推荐（${hm && hm.type} → 列 ${hm && hm.x} 朝向 ${hm && hm.rot}）`);
  const drops = T.simDrops(T.simBoard(), T.game.piece.type).map(d => d.cells.map(c => c.join(',')).sort().join(';'));
  ok(!!hm && drops.includes(hm.cells.map(c => c.join(',')).sort().join(';')), '推荐的位置是从顶上直接落得到的');
  ok(!!hm && hm.why.length > 0 && document.getElementById('hintWhy').textContent.includes(hm.why),
     `细栏写着理由（「${document.getElementById('hintWhy').textContent}」）`);

  // 下一块的计划：推荐不消行时，带着「下一块放哪」—— 就是这一手打分时下一块挑的那处，盘面上画成虚框
  {
    const rc = T.wcRec(T.wcBoard(), 'L', 'O', null, true);
    const after = T.simPlace(T.simBoard(), rc.cells).b;
    const key = cs => cs.map(c => c.join(',')).sort().join(';');
    const legal = T.simDrops(after, 'O').map(d => key(d.cells));
    ok(rc.lines === 0 && !!rc.plan && rc.plan.type === 'O' && legal.includes(key(rc.plan.cells)),
       `推荐不消行时带下一块的计划，且是放完这一块之后落得到的位置（${rc.plan && key(rc.plan.cells)}）`);
    ok(!rc.why.join('').includes('下一块 O 接'), '计划只画在盘面上，不往说明里加字（手机上那几行本来就满了）');
    // 这一手要消行：计划是按消完的盘面算的，行号对不上现在的盘面 → 不给
    const b = T.simBoard().map(r => r.map(() => false));
    for (let y = b.length - 4; y < b.length; y++) for (let x = 0; x < 9; x++) b[y][x] = true;
    const rt = T.wcRec(b, 'I', 'O', null, true);
    ok(rt.lines === 4 && !rt.plan, `这一手四消时不给计划（消 ${rt.lines} 行，plan=${!!rt.plan}）`);
  }

  // 能暂存（和普通局一样）
  const t0 = T.game.piece.type;
  T.holdPiece();
  ok(T.game.hold === t0, `提示模式能暂存（暂存了 ${T.game.hold}）`);
  // 照推荐放 → 记一笔一致
  if (!T.hintMove || !T.hintMove.cells){ T.game.piece = null; T.game.queue.unshift('O'); T.game.mods.unshift(null); T.spawnNext(); }
  const hmA = T.hintMove;
  const p = T.game.piece;
  p.rot = hmA.rot; p.x = hmA.x; p.y = 0; T.hardDrop(); settle();
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
  ok(T.hintMode && T.game.noGarbage === false && !!T.hintMove, '提示模式里点重开：还是提示模式、照样涨灰线、有推荐');

  // ── 切回普通 ──
  msw.querySelector('[data-m="normal"]').click();
  ok(!T.hintMode && !document.body.classList.contains('hinting'), '点「普通」退出提示模式');
  ok(T.game.noGarbage !== true, '退出后灰线恢复');
  ok(document.getElementById('overlay').classList.contains('has-save'), '「接着上次玩」还在');
  ok(!document.getElementById('best').parentElement.hidden, '切回普通、还在开局页：BEST 就显示出来（不用等开局）');
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
  const setH = hs => { clear(); hs.forEach((h, x) => { for (let k = 0; k < h; k++) T.game.board[R2 - 1 - k][x] = 'J'; }); };   // 普通方块，不是灰线
  // 下一块固定成 O：推荐看「当前块 + 下一块」，下一块随机的话同一个盘面推荐会变，判哪条规则也跟着变（偶发红过）
  const give = t => { T.game.piece = null; T.game.queue[0] = 'O'; T.game.queue.unshift(t); T.game.mods.unshift(null); T.spawnNext(); };
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

  // ── 推荐 + 四行说明 ──
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]);
  give('S');
  const hm2 = T.hintMove, more = () => [...document.querySelectorAll('#hintMore span')].map(e => e.textContent);
  ok(!!hm2.cells && T.fitGaps(T.simBoard(), hm2.cells) === 0 && /^S：/.test(hm2.why), `推荐贴合，第一行说定式（「${hm2.why}」）`);
  const m3 = more();
  ok(m3.length === 2 && /^为什么：/.test(m3[0]) && /^(别处：|.*一样好)/.test(m3[1]) && !m3.some(l => /按法/.test(l)),
     `底下两行：为什么 / 别处，不写按法（${m3.join(' | ')}）`);
  ok(!T.hintMove.cells.some(c => c[0] === 9), '推荐不碰井（第 10 列）');

  // 一样好时先低后左：空盘 O 推荐最左边
  clear(); give('O');
  ok(Math.min(...T.hintMove.cells.map(c => c[0])) === 0 && /一样好.*更靠左/.test(more()[1]), `空盘 O：放最左，并说明「一样好，选这里更靠左」（${more()[1]}）`);

  // ⑥ I 来了井不够深：先暂存；井够 4 行：竖进井四消；暂存里是 I 且井够了：换出来
  setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]); T.game.hold = null; give('I');
  ok(T.tsRec.kind === 'hold' && /暂存 I/.test(T.hintMove.why) && /差|不够/.test(more()[0]), `井只有 2 行：建议暂存 I（「${T.hintMove.why}」）`);
  const cue = document.getElementById('holdCue'), hsl = document.getElementById('holdSlot');
  ok(!cue.hidden && hsl.classList.contains('hint-hold') && getComputedStyle(hsl).opacity === '1', `推荐暂存：HOLD 框亮起来、盘面挂「${cue.textContent}」`);
  T.holdPiece(); settle();
  ok(cue.hidden && !hsl.classList.contains('hint-hold'), '暂存之后：提示收起');
  setH([4, 4, 4, 4, 4, 4, 4, 4, 4, 0]); give('I');
  ok(T.tsRec.kind === 'place' && T.hintMove.cells.every(c => c[0] === 9) && /四消/.test(T.hintMove.why), `井够 4 行：I 竖进井四消（「${T.hintMove.why}」）`);
  T.game.hold = 'I'; give('O');
  ok(T.tsRec.kind === 'hold' && /换出 I/.test(T.hintMove.why), `暂存里是 I、井够了：建议换出来（「${T.hintMove.why}」）`);
  ok(!cue.hidden && /换出来/.test(cue.textContent), `换出 I 时盘面写「${cue.textContent}」`);
  // 暂存里压着 I、井还不够：说明里写「I 在暂存等井」（不是忘了用）
  setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]); T.game.hold = 'I'; give('O');
  ok(T.tsRec.kind === 'place' && /I 在暂存等井/.test(more()[0]), `暂存里有 I：「${more()[0]}」`);
  // 堆高到要保命：暂存里的 I 换出来消行，不再干等井凑满 4 行
  setH([14, 14, 14, 13, 14, 14, 14, 14, 13, 0]); T.game.board[R2 - 1][0] = null;   // 底行留个洞：井凑不满 4 行
  T.game.hold = 'I'; give('O');
  ok(T.tsRec.kind === 'hold' && /换出 I —— 堆高了/.test(T.hintMove.why), `堆到要保命、井凑不满、暂存里有 I：建议换出来用（「${T.hintMove.why}」）`);
  T.game.hold = null;

  // ③ 井只给 I：照推荐打 150 块（灰线照涨），不在危险区时非 I 块从不推荐进第 10 列；理由里没有 T 旋
  let wellBad = 0, tsTalk = 0, n150 = 0;
  // 固定种子：随机出块的话偶尔会撞上「手上是 S、暂存里是 I、放哪都留洞」那种死局，进井反而最好（20 局 2720 手里 2 次），测试就会时红时绿
  T.setSeed(100); T.startHint(); T.game.noGarbage = true;
  for (let i = 0; i < 150 && !T.game.over; i++){
    const rc = T.tsRec;
    if (rc && rc.kind === 'hold'){ T.holdPiece(); settle(); continue; }
    if (rc && rc.cells){
      // 进井只许在「别处都会留更多洞」的时候（②不留洞 排在 ③ 前面）
      if (T.game.piece.type !== 'I' && !rc.danger && rc.cells.some(c => c[0] === 9) && T.simFeatures(T.simBoard()).maxH < T.WC_WELL.hiH){   // 6 行以上借井减压是允许的
        const b0 = T.simBoard(), h0 = T.simFeatures(b0).holes, hm = c => T.simFeatures(T.simPlace(b0, c).b).holes - h0;
        const mine = hm(rc.cells), wh = b => { for (let y = 0; y < b.length; y++) if (b[y][9]) return b.length - y; return 0; };
        if (wh(T.simPlace(b0, rc.cells).b) <= wh(b0)){ /* 进井顺手消行、消完井还空着：不算堵 */ }
        else
        if (T.simDrops(b0, T.game.piece.type).some(d => !d.cells.some(c => c[0] === 9) && hm(d.cells) <= mine)) wellBad++;
      }
      if (rc.why.some(w => /T 旋|槽/.test(w))) tsTalk++;
      const p = T.game.piece; p.rot = rc.rot; p.x = rc.x; p.y = 0;
    }
    T.hardDrop(); settle(); n150++;
  }
  ok(n150 >= 100 && wellBad === 0 && tsTalk === 0, `照推荐 ${n150} 块：盘面低时，非 I 块只在别处都会留更多洞时才把井垫高（违反 ${wellBad}），理由里不提 T 旋（${tsTalk}）`);

  // ① 保命：九列堆到 14 行，推荐能消就消
  T.startHint(); T.game.noGarbage = true;
  setH([14, 14, 14, 14, 14, 14, 13, 14, 14, 13]); give('O');
  ok(T.tsRec.danger && T.tsRec.lines > 0 || /保命/.test(T.hintMove.why + more().join('')), `堆到 14 行：先保命消行（「${T.hintMove.why}」）`);

  // ⑤ 挖灰线：底下 3 行灰线，缺口在第 1 列露着，推荐把它挖掉
  clear();
  for (let k = 0; k < 3; k++) for (let x = 1; x < 10; x++) T.game.board[R2 - 1 - k][x] = 'X';
  give('I');
  ok(T.hintMove.cells && T.hintMove.cells.every(c => c[0] === 0) && /挖灰线/.test(T.hintMove.why), `3 行灰线、缺口露着：I 竖进缺口挖灰线（「${T.hintMove.why}」）`);

  // ── 判对错 ──
  const s0 = Object.assign({}, T.hintStats, { rules: T.hintStats.rules.slice() });
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]); give('S');
  const rec = T.hintMove;
  place(rec.rot, rec.x);
  ok(T.hintStats.good === s0.good + 1 && T.hintStats.same === s0.same + 1, '照推荐放：放对、一模一样各 +1');
  setH([2, 0, 2, 2, 2, 2, 2, 2, 2, 0]); give('O');
  place(0, 0);                               // O 盖住第 2 列的坑：留洞
  ok(/^②/.test(toastNow()) && /洞/.test(toastNow()), `留洞判 ②（「${toastNow()}」）`);
  ok(!!T.hintReveal && T.hintReveal.cells.length > 0, '放错了把推荐亮一下对照');
  setH([0, 0, 2, 2, 2, 2, 2, 2, 2, 2]); give('O');
  document.getElementById('toast').textContent = '';
  place(0, 8);                               // 推荐是左边的低处；O 放第 9~10 列不留洞，但把井垫高了
  ok(/^③/.test(toastNow()), `O 堵井判 ③（「${toastNow()}」）`);
  setH([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]); T.game.hold = null; give('I');
  place(0, 0);                               // 该暂存的 I 横放掉了
  ok(/^⑥/.test(toastNow()) && /暂存/.test(toastNow()), `该暂存的 I 放掉了判 ⑥（「${toastNow()}」）`);

  // ── 先自己找：只给这块的定式，不给位置；三行说明藏起来 ──
  T.toggleHintHide();
  setH([4, 4, 5, 6, 6, 6, 6, 6, 6, 0]); give('S');
  ok(/^先自己找：S/.test(document.getElementById('hintWhy').textContent) && document.getElementById('hintMore').hidden,
     `先自己找：只说 S 的定式（「${document.getElementById('hintWhy').textContent}」），详细说明藏着`);
  T.toggleHintHide();

  // ── 规则卡：六条规则 + 七种块的定式 + 先低后左 + 只看两块 ──
  document.getElementById('hintRules').click();
  const hb2 = document.getElementById('hintRulesBody'), hs = document.getElementById('hintSheet');
  ok(!hs.hidden && T.game.frozen, '规则卡打开，方块停住');
  ok(hb2.querySelectorAll('.hr-rule').length >= 6 && hb2.querySelectorAll('.hr-fit').length === 7 && /先选更低/.test(hb2.textContent) && /只看当前块和下一块/.test(hb2.textContent),
     '六条规则 + 七种块定式 + 先低后左 + 只看两块');
  ok(/留井四消/.test(document.getElementById('hintSheetTitle').textContent), `标题「${document.getElementById('hintSheetTitle').textContent}」`);
  document.getElementById('hintDone').click();
  ok(hs.hidden && !T.game.frozen, '关掉接着放');

  // ── 局后小结：放对几成、六条规则各犯几次、最该盯哪条、损失最大的几手 ──
  T.startHint(); T.game.noGarbage = true;
  for (let i = 0; i < 14; i++){
    const rc = T.tsRec;
    if (rc && rc.kind === 'hold'){ T.holdPiece(); settle(); continue; }
    const p = T.game.piece;
    if (i % 3 === 0){ const d = T.simDrops(T.simBoard(), p.type); const w = d[d.length - 1]; p.rot = w.rot; p.x = w.x; }   // 每三块故意乱放一块
    else if (rc && rc.cells){ p.rot = rc.rot; p.x = rc.x; }
    p.y = 0; T.hardDrop(); settle();
  }
  T.endGame('堆到顶了');
  const rs = document.getElementById('rvStats').textContent, rt = document.getElementById('rvTips').textContent;
  ok(!document.getElementById('review').hidden && /放对\d+\/\d+（\d+%）/.test(rs) && /六条规则各犯① \d+　② \d+/.test(rs),
     `提示局结束：小结有放对几成和六条规则各犯几次（${rs.slice(0, 60)}…）`);
  ok(/下一局先盯 [①-⑥]/.test(rt) || /先慢下来|可以加难度|打法对了/.test(rt), `给出下一局先盯哪条（${rt.slice(0, 30)}…）`);
  ok(T.hintStats.rules.some(v => v > 0) ? !document.getElementById('rvWorst').hidden && !!document.querySelector('#rvWorstList canvas') : true, '放偏过：列出损失最大的几手（小盘面）');
  ok(!/T 块|T 旋/.test(rs + rt), '小结里不提 T 旋');
  T.startHint();

  // ── 暂停：遮罩半透明，盘面和提示都看得见 ──
  document.getElementById('pauseBtn').click();
  const ov = document.getElementById('overlay'), bg = getComputedStyle(ov).backgroundColor;
  const a = +(bg.match(/rgba?\([^)]*,\s*([\d.]+)\)/) || [0, 1])[1];
  ok(T.game.paused && a <= .4 && getComputedStyle(document.getElementById('hintBar')).visibility === 'visible',
     `暂停：遮罩半透明（${bg}），提示栏还在`);
  document.getElementById('pauseBtn').click();
  return L;
}"""

# 推荐质量：照推荐放（含暂存、T 旋路径）vs 哪里最低放哪里。开着灰线（提示模式现在就是普通局的条件）
QUALITY = r"""(arg) => {
  const T = __tetris, {policy, seed, N} = arg;
  T.setSeed(seed); T.startHint();
  let tet = 0, holes = 0, placed = 0, guard = 0;
  while (placed < N && guard++ < N * 3){
    let g = 0; while ((T.clearing || !T.game.piece) && !T.game.over && g++ < 400) T.step(16);
    if (T.game.over) break;
    const p = T.game.piece, b0 = T.simBoard(), h0 = T.simFeatures(b0).holes;
    const rec = T.tsRec, l0 = T.game.lines;
    if (policy === 'hint' && rec && rec.kind === 'hold'){ T.holdPiece(); continue; }
    let m = rec && rec.cells ? rec : null;
    if (policy === 'lowest' || !m){
      const all = T.simDrops(b0, p.type);
      m = all.reduce((a, c) => { const ta = Math.min(...a.cells.map(v=>v[1])), tc = Math.min(...c.cells.map(v=>v[1])); return tc > ta ? c : a; });
    }
    p.rot = m.rot; p.x = m.x; p.y = 0; T.hardDrop();
    placed++;
    g = 0; while (T.clearing && g++ < 400) T.step(16);
    if (T.game.lines - l0 === 4) tet++;
    if (T.simFeatures(T.simBoard()).holes > h0) holes++;
    T.step(250);                       // 让灰线照普通局的节奏涨
  }
  return { placed, over: T.game.over, lines: T.game.lines, tet, holes, score: T.game.score };
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
        tot_holes += h['holes']; tot_placed += h['placed']
        r.append(('PASS ' if not h['over'] and h['placed'] == 400 else 'FAIL ') +
                 f"种子{seed} 照推荐放 400 块不死（放了 {h['placed']}，造洞 {h['holes']} 次）")
        r.append(('PASS ' if h['tet'] >= 15 else 'FAIL ') + f"种子{seed} 照推荐打出四消 {h['tet']} 次（至少 15 次）")
        r.append(('PASS ' if n['over'] or n['score'] < h['score'] * .6 else 'FAIL ') +
                 f"种子{seed} 对照组「哪里最低放哪里」明显更差（{'堆死于第 ' + str(n['placed']) + ' 块' if n['over'] else str(n['score']) + ' 分 vs ' + str(h['score'])}）")
    # 灰线涨上来会把缺口盖成洞（不是这一手造的也会算进来），所以门槛比不涨灰线时宽
    r.append(('PASS ' if tot_holes <= tot_placed * .12 else 'FAIL ') +
             f"两局合计造洞不超过 12%（{tot_holes}/{tot_placed} = {tot_holes*100/max(1,tot_placed):.1f}%，含灰线涨上来盖住的）")
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
