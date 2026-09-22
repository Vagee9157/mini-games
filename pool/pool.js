/* 黑八 —— 自己写的物理（球撞球、撞库、落袋）+ 完整的黑八规则。
   两人轮流用一台手机打；拉杆瞄准像拉弹弓，松手出杆。 */
(() => {
'use strict';

// ── 物理常数（都按「每秒」算，跟帧率无关）──
const FRICTION = 0.20;      // 每秒衰减到 20%——再小就要滚五六秒才停
const STOP_V   = 6;         // 低于这个速度就算停了
const CUSHION_E = 0.86;     // 撞库损失
const BALL_E    = 0.96;     // 球撞球损失
const MAX_POWER = 1450;     // 满力出杆速度 px/s，够打一个来回

const BALLS = [
  null,
  '#fbc02d', '#1d4ed8', '#d81f26', '#7b2ec8', '#ef6c1a', '#12803c', '#8e2433',  // 1-7 全色
  '#17181c',                                                                     // 8 黑
  '#fbc02d', '#1d4ed8', '#d81f26', '#7b2ec8', '#ef6c1a', '#12803c', '#8e2433',  // 9-15 花色
];
const isSolid  = (n) => n >= 1 && n <= 7;
const isStripe = (n) => n >= 9 && n <= 15;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ── 台面尺寸（layout 算）──
let R = 12, TW = 300, TH = 600, CU = 22, W = 0, H = 0;
let pockets = [];

let balls = [];             // {n, x, y, vx, vy, in}
let moving = false;
let aimA = -Math.PI / 2, power = 0, pulling = false;
let MODE = 'two';           // solo 单人清台 / ai 人机 / two 双人同屏

// AI 三档。差别不只是手抖多少：
// 远球和薄球会不会失手、会不会翻袋、没球可打时是乱推还是做安全球，各档都不一样。
const AI_LEVELS = {
  //                手抖   远球衰减 薄球衰减 力道飘  翻袋罚分 翻袋额外手抖 安全球  思考
  easy:   { name:'轻松', err:.055, far:1.00, thin:.85, pw:.16, bankPen:2.2, bankErr:2.6, safe:false, think:650 },
  normal: { name:'普通', err:.022, far:.55,  thin:.50, pw:.08, bankPen:1.5, bankErr:1.8, safe:true,  think:900 },
  hard:   { name:'高手', err:.007, far:.20,  thin:.18, pw:.03, bankPen:1.0, bankErr:1.3, safe:true,  think:1100 },
};
let AI_LV = 'normal';
const ai = () => AI_LEVELS[AI_LV];
let aiTimer = 0, aiThinking = false;
let shots = 0;              // 单人模式的杆数
let turn = 0;               // 0 / 1
let groups = [null, null];  // 'solid' | 'stripe'
let phase = 'break';        // break | open | play | over
let ballInHand = false;
let winner = -1;
let shotFirstHit = 0, shotPotted = [], shotCushion = false;
let msg = '', msgT = 0;
let rafId = 0, lastT = 0, needsDraw = true;

const canvas = $('board');
const ctx = canvas.getContext('2d');

// ── 摆球 ──
function rack(){
  balls = [];
  balls.push({ n: 0, x: TW * .5, y: TH * .76, vx: 0, vy: 0, in: false });   // 白球

  // 1 号在尖，8 号在第三排正中，两个底角一全一花——标准摆法
  const order = [1, 9, 2, 8, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const rest = order.slice();
  const tri = [];
  const apexY = TH * .26, dy = R * 1.74, dx = R * 1.02;
  let k = 0;
  for (let row = 0; row < 5; row++){
    for (let i = 0; i <= row; i++){
      tri.push({ row, x: TW * .5 + (i - row / 2) * dx * 2, y: apexY - row * dy });
      k++;
    }
  }
  // 洗一下，但 1 号钉在尖、8 号钉在第三排中间
  const pool = rest.filter(n => n !== 1 && n !== 8);
  for (let i = pool.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const fixed = { 0: 1, 7: 8 };   // tri 下标 0 = 尖，7 = 第三排中间
  let pi = 0;
  tri.forEach((t, i) => {
    const n = fixed[i] != null ? fixed[i] : pool[pi++];
    balls.push({ n, x: t.x, y: t.y, vx: 0, vy: 0, in: false });
  });
}

function reset(showStart){
  clearTimeout(aiTimer); aiThinking = false;
  rack();
  shots = 0;
  turn = 0; groups = [null, null]; phase = 'break';
  ballInHand = false; winner = -1; moving = false;
  power = 0; aimA = -Math.PI / 2;
  msg = '';
  const ov = $('overlay');
  if (showStart){ ov.dataset.mode = 'start'; ov.classList.add('show'); }
  else ov.classList.remove('show');
  syncHud(); needsDraw = true;
  lastT = performance.now();
  if (!rafId) rafId = requestAnimationFrame(tick);
}

const cue = () => balls[0];
const live = () => balls.filter(b => !b.in);

// ── 物理 ──
function physics(dt){
  const s = dt / 1000;
  // 子步进：一步走的距离不超过半个球，否则快球会穿过去
  let maxV = 0;
  for (const b of balls) if (!b.in) maxV = Math.max(maxV, Math.hypot(b.vx, b.vy));
  if (maxV < STOP_V){ settleIfDone(); return; }
  const sub = clamp(Math.ceil(maxV * s / (R * .5)), 1, 24);
  for (let i = 0; i < sub; i++) stepOnce(s / sub);

  const f = Math.pow(FRICTION, s);
  for (const b of balls){
    if (b.in) continue;
    b.vx *= f; b.vy *= f;
    if (Math.hypot(b.vx, b.vy) < STOP_V){ b.vx = 0; b.vy = 0; }
  }
  needsDraw = true;
  settleIfDone();
}

function stepOnce(s){
  for (const b of balls){
    if (b.in) continue;
    b.x += b.vx * s; b.y += b.vy * s;

    // 撞库
    if (b.x < R){ b.x = R; b.vx = Math.abs(b.vx) * CUSHION_E; shotCushion = true; }
    if (b.x > TW - R){ b.x = TW - R; b.vx = -Math.abs(b.vx) * CUSHION_E; shotCushion = true; }
    if (b.y < R){ b.y = R; b.vy = Math.abs(b.vy) * CUSHION_E; shotCushion = true; }
    if (b.y > TH - R){ b.y = TH - R; b.vy = -Math.abs(b.vy) * CUSHION_E; shotCushion = true; }
  }

  // 球撞球：等质量弹性碰撞，沿法线换速度
  for (let i = 0; i < balls.length; i++){
    const a = balls[i]; if (a.in) continue;
    for (let j = i + 1; j < balls.length; j++){
      const b = balls[j]; if (b.in) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d === 0){ dx = .01; d = .01; }
      if (d >= R * 2) continue;

      const nx = dx / d, ny = dy / d;
      const overlap = R * 2 - d;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;

      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) continue;                 // 已经在分开
      const imp = -(1 + BALL_E) * vn / 2;
      a.vx -= imp * nx; a.vy -= imp * ny;
      b.vx += imp * nx; b.vy += imp * ny;

      if (!shotFirstHit && (a.n === 0 || b.n === 0)) shotFirstHit = a.n === 0 ? b.n : a.n;
    }
  }

  // 落袋
  for (const b of balls){
    if (b.in) continue;
    for (const p of pockets){
      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r){
        b.in = true; b.vx = b.vy = 0;
        shotPotted.push(b.n);
        sfx(b.n === 8 ? 'eight' : 'pot');
        break;
      }
    }
  }
}

function allStopped(){
  return balls.every(b => b.in || (b.vx === 0 && b.vy === 0));
}

function settleIfDone(){
  if (!moving || !allStopped()) return;
  moving = false;
  settle();
}

// ── 规则 ──
const myBalls = (who) => {
  const g = groups[who];
  if (!g) return [];
  return balls.filter(b => b.n !== 0 && b.n !== 8 && (g === 'solid' ? isSolid(b.n) : isStripe(b.n)));
};
const cleared = (who) => groups[who] && myBalls(who).every(b => b.in);

function settle(){
  if (MODE === 'solo'){ settleSolo(); return; }
  const me = turn;
  const wasBreak = phase === 'break';
  let foul = false, why = '';

  if (!shotFirstHit){ foul = true; why = '空杆，没碰到球'; }
  if (shotPotted.includes(0)){ foul = true; why = '白球落袋'; }
  if (!foul && !shotPotted.length && !shotCushion){ foul = true; why = '没有球碰库'; }

  // 开球后第一颗进的球定组
  const colored = shotPotted.filter(n => n !== 0 && n !== 8);
  if (!groups[me] && colored.length && !foul && phase !== 'break'){
    const first = colored[0];
    groups[me] = isSolid(first) ? 'solid' : 'stripe';
    groups[1 - me] = isSolid(first) ? 'stripe' : 'solid';
    toast(`${who(me)} 打${groups[me] === 'solid' ? '全色（1–7）' : '花色（9–15）'}`);
  }
  if (phase === 'break') phase = groups[me] ? 'play' : 'open';
  else if (groups[me]) phase = 'play';

  // 该碰的球没碰对
  if (!foul && shotFirstHit && groups[me]){
    const need8 = cleared(me);
    const ok = need8 ? shotFirstHit === 8
                     : (groups[me] === 'solid' ? isSolid(shotFirstHit) : isStripe(shotFirstHit));
    if (!ok){ foul = true; why = need8 ? '该打 8 号了' : '先碰到了对方的球'; }
  }

  // 开球那杆把 8 号也带进去了：按规矩重摆再来，不判负
  if (shotPotted.includes(8) && wasBreak){
    toast('开球打进 8 号 · 重新摆球');
    rack(); turn = me; phase = 'break'; ballInHand = false;
    syncHud(); needsDraw = true;
    return;
  }

  // 8 号球进了：清完自己那组且这杆没犯规才算赢
  if (shotPotted.includes(8)){
    const okWin = cleared(me) && !foul;
    finish(okWin ? me : 1 - me, okWin ? '打进 8 号' : (foul ? '犯规打进 8 号' : '提前打进 8 号'));
    return;
  }

  const potMine = shotPotted.some(n => n !== 0 && n !== 8 &&
    (groups[me] ? (groups[me] === 'solid' ? isSolid(n) : isStripe(n)) : true));

  if (foul){
    turn = 1 - me; ballInHand = true;
    toast(why + ' · 自由球');
    sfx('foul');
  } else if (!potMine){
    turn = 1 - me;
  } else {
    toast('继续');
  }

  if (shotPotted.includes(0)) respotCue();
  syncHud(); needsDraw = true;
  if (MODE === 'ai' && turn === 1 && phase !== 'over') aiTurn();
}

// 单人清台：8 号留最后，白球进袋只是自己挪一下，不换人
function settleSolo(){
  if (shotPotted.includes(8)){
    const rest = balls.filter(b => b.n !== 0 && b.n !== 8 && !b.in).length;
    if (rest === 0) finishSolo(true);
    else finishSolo(false, '8 号提前进袋');
    return;
  }
  if (shotPotted.includes(0)){
    respotCue();
    ballInHand = true;
    toast('白球进袋 · 可以拖到别处');
    sfx('foul');
  }
  const rest = balls.filter(b => b.n !== 0 && b.n !== 8 && !b.in).length;
  if (rest === 0) toast('就剩 8 号了');
  syncHud(); needsDraw = true;
}

function finishSolo(win, why){
  phase = 'over'; winner = win ? 0 : 1;
  let extra = '';
  if (win){
    const best = +(localStorage.getItem('pool.solo.best.v1') || 0);
    if (!best || shots < best){
      try { localStorage.setItem('pool.solo.best.v1', String(shots)); } catch { /* 忽略 */ }
      extra = ' · 新纪录';
    }
  }
  $('overlay').dataset.mode = 'over';
  $('winTitle').textContent = win ? `清台！${shots} 杆` : '没清成';
  $('winWhy').textContent = win ? ('用了 ' + shots + ' 杆' + extra) : (why || '');
  $('overlay').classList.add('show');
  sfx(win ? 'win' : 'foul');
  syncHud(); needsDraw = true;
}

function who(i){
  if (MODE === 'ai') return i === 0 ? '你' : '电脑';
  return i === 0 ? '玩家 1' : '玩家 2';
}

function respotCue(){
  const c = cue();
  c.in = false; c.vx = c.vy = 0;
  let x = TW * .5, y = TH * .76;
  for (let k = 0; k < 200; k++){
    if (!balls.some(b => b !== c && !b.in && Math.hypot(b.x - x, b.y - y) < R * 2.2)) break;
    x = R * 2 + Math.random() * (TW - R * 4);
    y = TH * .55 + Math.random() * (TH * .4 - R * 2);
  }
  c.x = clamp(x, R, TW - R); c.y = clamp(y, R, TH - R);
}

function finish(w, why){
  phase = 'over'; winner = w;
  $('overlay').dataset.mode = 'over';
  $('winTitle').textContent = who(w) + ' 赢';
  $('winWhy').textContent = why;
  $('overlay').classList.add('show');
  sfx('win');
  syncHud(); needsDraw = true;
}

// ── AI ──
// 思路：对「我能打的每颗球 × 每个袋」算一遍。
// 目标球要往袋走，就得从它背后某点撞它——那个点叫幽灵球位置，
// 白球瞄它就行。再检查两段路上有没有别的球挡着，最后挑最直最近的。

function segDist(x1, y1, x2, y2, px, py){
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  if (!L2) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function blocked(x1, y1, x2, y2, skip){
  for (const b of balls){
    if (b.in || b === skip || b.n === 0) continue;
    if (segDist(x1, y1, x2, y2, b.x, b.y) < R * 1.92) return true;
  }
  return false;
}

// 这一杆合法的目标球有哪些
function legalTargets(who){
  const g = groups[who];
  const mine = balls.filter(b => !b.in && b.n !== 0 && b.n !== 8 &&
    (!g || (g === 'solid' ? isSolid(b.n) : isStripe(b.n))));
  if (g && cleared(who)){
    const eight = balls.find(b => b.n === 8 && !b.in);
    return eight ? [eight] : [];
  }
  if (MODE === 'solo'){
    // 单人：8 号留到最后
    const others = balls.filter(b => !b.in && b.n !== 0 && b.n !== 8);
    if (others.length) return others;
    const eight = balls.find(b => b.n === 8 && !b.in);
    return eight ? [eight] : [];
  }
  return mine;
}

// 把袋关于四面库各镜像一次。朝镜像袋打，球撞一次库正好进真袋。
function mirrorPockets(){
  const out = [];
  for (const p of pockets){
    out.push({ x: -p.x,          y: p.y,          real: p, wall: 'L' });
    out.push({ x: 2 * TW - p.x,  y: p.y,          real: p, wall: 'R' });
    out.push({ x: p.x,           y: -p.y,         real: p, wall: 'T' });
    out.push({ x: p.x,           y: 2 * TH - p.y, real: p, wall: 'B' });
  }
  return out;
}

// 目标球打向镜像袋时，先算它在哪面库上反弹，再分两段查路
function bankPathClear(t, mp){
  const dx = mp.x - t.x, dy = mp.y - t.y;
  if (!dx && !dy) return null;
  let hit = null;
  if (mp.wall === 'L' && dx < 0) hit = { x: R, y: t.y + dy * (R - t.x) / dx };
  if (mp.wall === 'R' && dx > 0) hit = { x: TW - R, y: t.y + dy * (TW - R - t.x) / dx };
  if (mp.wall === 'T' && dy < 0) hit = { x: t.x + dx * (R - t.y) / dy, y: R };
  if (mp.wall === 'B' && dy > 0) hit = { x: t.x + dx * (TH - R - t.y) / dy, y: TH - R };
  if (!hit) return null;
  if (hit.x < R || hit.x > TW - R || hit.y < R || hit.y > TH - R) return null;
  if (blocked(t.x, t.y, hit.x, hit.y, t)) return null;
  if (blocked(hit.x, hit.y, mp.real.x, mp.real.y, t)) return null;
  return hit;
}

function aiPlan(who, allowBank){
  const c = cue();
  let best = null;
  const useBank = allowBank !== undefined ? allowBank : true;
  const aims = pockets.map(p => ({ x: p.x, y: p.y, real: p, wall: null }));
  if (useBank) aims.push(...mirrorPockets());

  for (const t of legalTargets(who)){
    for (const p of aims){
      const dx = p.x - t.x, dy = p.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const ux = dx / d, uy = dy / d;
      const gx = t.x - ux * R * 2, gy = t.y - uy * R * 2;      // 幽灵球
      if (gx < R * .4 || gx > TW - R * .4 || gy < R * .4 || gy > TH - R * .4) continue;

      const cdx = gx - c.x, cdy = gy - c.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd < R * .8) continue;
      const cut = (cdx / cd) * ux + (cdy / cd) * uy;            // cos(切角)
      if (cut < 0.22) continue;                                  // 切太薄，打不进
      if (blocked(c.x, c.y, gx, gy, t)) continue;                // 白球过不去

      if (p.wall){
        if (!bankPathClear(t, p)) continue;                      // 翻袋：两段都要通
      } else {
        if (blocked(t.x, t.y, p.x, p.y, t)) continue;
      }

      // 翻袋比直球难，同等条件下不优先选；越菜的档越不爱翻
      const score = cut * 2.2 - (cd + d) / (TW + TH) - (p.wall ? ai().bankPen : 0);
      if (!best || score > best.score){
        best = { score, aim: Math.atan2(cdy, cdx), cut, dist: cd + d, bank: !!p.wall };
      }
    }
  }
  return best;
}

// 找不到进球机会时的退路：轻碰一颗自己的球，力道刚够碰库，
// 尽量让白球停得离对方的球远一点，别直接送杆。
function aiSafety(who){
  const c = cue();
  const mine = legalTargets(who);
  if (!mine.length) return null;
  const foes = balls.filter(b => !b.in && b.n !== 0 && !mine.includes(b));
  let best = null;
  for (const t of mine){
    if (blocked(c.x, c.y, t.x, t.y, t)) continue;
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    // 撞完之后白球大致停在哪（很粗的估计：沿着原方向再走一点）
    const ux = (t.x - c.x) / d, uy = (t.y - c.y) / d;
    const px = clamp(t.x - ux * R * 2.2, R, TW - R);
    const py = clamp(t.y - uy * R * 2.2, R, TH - R);
    const near = foes.length ? Math.min(...foes.map(f => Math.hypot(f.x - px, f.y - py))) : TW;
    const score = near / R - d / (R * 12);
    if (!best || score > best.score) best = { score, aim: Math.atan2(t.y - c.y, t.x - c.x), dist: d };
  }
  return best;
}

function aiPlaceCue(){
  // 自由球：把白球挪到能打上球的地方，试几个点挑最好的
  const c = cue();
  let bestSpot = null;
  for (let i = 0; i < 40; i++){
    const x = R * 2 + Math.random() * (TW - R * 4);
    const y = R * 2 + Math.random() * (TH - R * 4);
    if (balls.some(b => b !== c && !b.in && Math.hypot(b.x - x, b.y - y) < R * 2.4)) continue;
    c.x = x; c.y = y;
    const plan = aiPlan(turn);
    if (plan && (!bestSpot || plan.score > bestSpot.score)) bestSpot = { x, y, score: plan.score };
  }
  if (bestSpot){ c.x = bestSpot.x; c.y = bestSpot.y; }
  else { c.x = TW * .5; c.y = TH * .76; }
  ballInHand = false;
}

function aiTurn(){
  if (MODE !== 'ai' || turn !== 1 || moving || phase === 'over' || aiThinking) return;
  aiThinking = true;
  toast('电脑思考中…');
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    aiThinking = false;
    if (phase === 'over') return;
    if (ballInHand) aiPlaceCue();
    const L = ai();
    const plan = aiPlan(1);
    if (plan){
      // 手抖程度跟难度有关，也跟这一杆本身有多难有关：
      // 球越远、切得越薄，越容易打偏。高手档这两项影响都很小。
      const far = plan.dist / (R * 18);
      const thin = 1 - plan.cut;
      const err = L.err * (1 + far * L.far) * (1 + thin * L.thin * 2) * (plan.bank ? L.bankErr : 1);
      aimA = plan.aim + (Math.random() - .5) * err * 2;
      const base = clamp(.26 + plan.dist / (TH * 1.5) + thin * .3, .22, .95);
      power = clamp(base * (1 + (Math.random() - .5) * L.pw * 2), .18, 1);
    } else if (L.safe){
      const sf = aiSafety(1);
      const c = cue();
      if (sf){
        aimA = sf.aim + (Math.random() - .5) * L.err * 2;
        power = clamp(.20 + sf.dist / (TH * 2.4), .18, .46);   // 刚够碰到并顶到库
      } else {
        aimA = -Math.PI / 2; power = .3;
      }
      toast('电脑做了个安全球');
    } else {
      // 轻松档不会做安全球，找不到就随便推一杆
      const t = legalTargets(1)[0];
      const c = cue();
      aimA = t ? Math.atan2(t.y - c.y, t.x - c.x) : -Math.PI / 2;
      power = .3;
    }
    needsDraw = true;
    shoot();
  }, ai().think);
}

// ── 出杆 ──
function shoot(){
  if (moving || phase === 'over' || power < .05) return;
  const c = cue();
  c.vx = Math.cos(aimA) * MAX_POWER * power;
  c.vy = Math.sin(aimA) * MAX_POWER * power;
  shotFirstHit = 0; shotPotted = []; shotCushion = false;
  moving = true; ballInHand = false;
  shots++;
  power = 0;
  sfx('hit');
  needsDraw = true;
}

// 瞄准辅助线：白球沿着方向走，撞到第一颗球就停，顺便标出那颗球会往哪去
function aimPreview(){
  const c = cue();
  let x = c.x, y = c.y;
  const vx = Math.cos(aimA), vy = Math.sin(aimA);
  const stepLen = R * .4;
  for (let i = 0; i < 600; i++){
    x += vx * stepLen; y += vy * stepLen;
    if (x < R || x > TW - R || y < R || y > TH - R) break;
    for (const b of balls){
      if (b.in || b.n === 0) continue;
      if (Math.hypot(b.x - x, b.y - y) < R * 2){
        const nx = (b.x - x), ny = (b.y - y);
        const d = Math.hypot(nx, ny) || 1;
        return { x, y, hit: b, tx: nx / d, ty: ny / d };
      }
    }
  }
  return { x, y, hit: null };
}

// ── 画面 ──
function layout(){
  const wrap = $('boardWrap');
  const aw = wrap.clientWidth, ah = wrap.clientHeight;
  if (!aw || !ah) return;
  const portrait = ah > aw;
  // 台面 1:2；竖屏竖着放，横屏横着放
  const ratio = 2;
  let w, h;
  if (portrait){
    w = Math.min(aw, ah / ratio);
    h = w * ratio;
  } else {
    h = Math.min(ah, aw / ratio);
    w = h * ratio;
  }
  CU = Math.max(10, Math.round(Math.min(w, h) * .055));
  TW = Math.round(w - CU * 2);
  TH = Math.round(h - CU * 2);
  if (!portrait){ const t = TW; TW = Math.round(h - CU * 2); TH = Math.round(w - CU * 2); }
  // 统一成「竖着的台面」，横屏时整体旋转画
  R = Math.max(6, Math.round(Math.min(TW, TH) / 22));
  W = TW + CU * 2; H = TH + CU * 2;

  const pr = R * 1.58;   // 再大就变成「沿边滚过去也掉」
  pockets = [
    { x: 0, y: 0, r: pr }, { x: TW, y: 0, r: pr },
    { x: 0, y: TH / 2, r: pr * .92 }, { x: TW, y: TH / 2, r: pr * .92 },
    { x: 0, y: TH, r: pr }, { x: TW, y: TH, r: pr },
  ];

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  needsDraw = true;
}

// 画一颗球。
// 花色球（9–15）是「白球体 + 中间一条彩带」，号码印在彩带上 —— 不是反过来。
// 全色球（1–7）整颗都是彩色，中间一个白圆写号码。
function drawBall(c, b){
  const col = BALLS[b.n] || '#f8fafc';
  const stripe = isStripe(b.n);
  const white = '#f4f6f8';

  c.save();
  c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.clip();

  // 球体底色：花色球和白球都是白的，全色球是它自己的颜色
  const base = b.n === 0 ? '#fdfdfd' : (stripe ? white : col);
  const g = c.createRadialGradient(b.x - R * .36, b.y - R * .42, R * .06, b.x, b.y, R * 1.06);
  g.addColorStop(0, mix(base, '#ffffff', .62));
  g.addColorStop(.45, base);
  g.addColorStop(1, mix(base, '#000000', b.n === 0 ? .26 : .42));
  c.fillStyle = g;
  c.fillRect(b.x - R, b.y - R, R * 2, R * 2);

  // 中间那条彩带，上下各留一截白
  if (stripe){
    const hh = R * .53;                        // 带子占球高一半上下，上下各留一截白
    const bg = c.createLinearGradient(b.x - R * .4, b.y - hh, b.x + R * .5, b.y + hh);
    bg.addColorStop(0, mix(col, '#ffffff', .48));
    bg.addColorStop(.45, col);
    bg.addColorStop(1, mix(col, '#000000', .40));
    c.fillStyle = bg;
    c.fillRect(b.x - R, b.y - hh, R * 2, hh * 2);
  }
  c.restore();

  // 号码：白圆底 + 数字。6 和 9 底下加一横，倒过来不会认错
  if (b.n > 0 && R > 8){
    c.save();
    c.fillStyle = '#fbfcfd';
    c.beginPath(); c.arc(b.x, b.y, R * .43, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.10)'; c.lineWidth = .8; c.stroke();

    c.fillStyle = '#111827';
    const fs = Math.round(R * (b.n > 9 ? .50 : .58));
    c.font = `700 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(b.n), b.x, b.y + R * .02);
    if (b.n === 6 || b.n === 9){
      c.fillRect(b.x - fs * .28, b.y + R * .26, fs * .56, Math.max(1, R * .05));
    }
    c.restore();
  }

  // 高光和底部的一点环境光，让球看着是圆的
  c.save();
  c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.clip();
  const hi = c.createRadialGradient(b.x - R * .34, b.y - R * .40, 0, b.x - R * .34, b.y - R * .40, R * .55);
  hi.addColorStop(0, 'rgba(255,255,255,.72)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi;
  c.fillRect(b.x - R, b.y - R, R * 2, R * 2);

  const lo = c.createRadialGradient(b.x + R * .3, b.y + R * .46, 0, b.x + R * .3, b.y + R * .46, R * .5);
  lo.addColorStop(0, 'rgba(255,255,255,.12)');
  lo.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = lo;
  c.fillRect(b.x - R, b.y - R, R * 2, R * 2);
  c.restore();

  // 边缘一圈暗，跟台呢分开
  c.strokeStyle = 'rgba(0,0,0,.34)';
  c.lineWidth = 1;
  c.beginPath(); c.arc(b.x, b.y, R - .5, 0, Math.PI * 2); c.stroke();
}

function draw(){
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  // 库边
  ctx.fillStyle = '#2a1d14';
  roundRect(ctx, 0, 0, W, H, CU * .8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.save();
  ctx.translate(CU, CU);

  // 台呢
  const felt = ctx.createLinearGradient(0, 0, 0, TH);
  felt.addColorStop(0, '#12503c');
  felt.addColorStop(1, '#0d3c2d');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, TW, TH);
  // 四周压一圈暗角，台面不至于太平
  const vig = ctx.createRadialGradient(TW / 2, TH / 2, Math.min(TW, TH) * .3, TW / 2, TH / 2, Math.max(TW, TH) * .62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.30)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, TW, TH);

  // 开球线
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, TH * .74); ctx.lineTo(TW, TH * .74); ctx.stroke();

  // 袋口：画得比判定范围小一圈，加点内深外浅的渐变，才像个洞
  for (const p of pockets){
    const vr = p.r * .86;
    const g2 = ctx.createRadialGradient(p.x, p.y, vr * .15, p.x, p.y, vr);
    g2.addColorStop(0, '#04060a');
    g2.addColorStop(.72, '#080c12');
    g2.addColorStop(1, '#141b1a');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(p.x, p.y, vr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 袋口内侧一道高光，看着有深度
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, vr * .92, Math.PI * .15, Math.PI * .85); ctx.stroke();
  }

  // 瞄准辅助
  if (!moving && phase !== 'over'){
    const pv = aimPreview();
    const c = cue();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(pv.x, pv.y); ctx.stroke();
    ctx.setLineDash([]);
    // 白球停的位置
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(pv.x, pv.y, R, 0, Math.PI * 2); ctx.stroke();
    // 目标球会往哪走
    if (pv.hit){
      ctx.strokeStyle = 'rgba(255,220,120,.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pv.hit.x, pv.hit.y);
      ctx.lineTo(pv.hit.x + pv.tx * R * 3.2, pv.hit.y + pv.ty * R * 3.2);
      ctx.stroke();
    }
    ctx.restore();

    // 拉杆力度
    if (pulling && power > .02){
      ctx.save();
      ctx.strokeStyle = `rgba(${Math.round(120 + 135 * power)},${Math.round(220 - 150 * power)},120,.85)`;
      ctx.lineWidth = Math.max(3, R * .5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x - Math.cos(aimA) * R * 1.4, c.y - Math.sin(aimA) * R * 1.4);
      ctx.lineTo(c.x - Math.cos(aimA) * (R * 1.4 + power * R * 5), c.y - Math.sin(aimA) * (R * 1.4 + power * R * 5));
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const b of balls) if (!b.in) drawBall(ctx, b);
  ctx.restore();
}

function roundRect(c, x, y, w, h, r){
  c.beginPath();
  if (c.roundRect){ c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
}
function mix(a, b, t){
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function hex(h){
  return h.length === 4 ? h.slice(1).split('').map(x => parseInt(x + x, 16))
                        : [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}

// ── HUD ──
function syncHud(){
  document.body.dataset.mode = MODE;
  if (MODE === 'solo'){
    const rest = balls.filter(b => b.n !== 0 && b.n !== 8 && !b.in).length;
    const best = +(localStorage.getItem('pool.solo.best.v1') || 0);
    $('p0').classList.add('on');
    $('p0nm').textContent = '单人清台';
    $('p0g').textContent = rest ? `还剩 ${rest} 颗` : '就剩 8 号';
    $('p0n').textContent = `第 ${shots} 杆`;
    $('p1nm').textContent = '最少杆数';
    $('p1g').textContent = best ? best + ' 杆' : '—';
    $('p1n').textContent = best ? '上次最好' : '还没清过台';
    $('p1').classList.remove('on');
  } else {
    for (const i of [0, 1]){
      const el = $('p' + i);
      el.classList.toggle('on', turn === i && phase !== 'over');
      const g = groups[i];
      const left = g ? myBalls(i).filter(b => !b.in).length : null;
      $('p' + i + 'nm').textContent = who(i) + (MODE === 'ai' && i === 1 ? ' · ' + ai().name : '');
      $('p' + i + 'g').textContent = !g ? '未定组' : (g === 'solid' ? '全色 1–7' : '花色 9–15');
      $('p' + i + 'n').textContent = left == null ? '—' : (cleared(i) ? '打 8 号' : left + ' 颗');
    }
  }
  $('hand').hidden = !ballInHand || (MODE === 'ai' && turn === 1);
}

let toastT = 0;
function toast(t){
  const el = $('toast');
  el.textContent = t;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1600);
}

// ── 输入：按住往后拉，像拉弹弓 ──
function bindAim(){
  const wrap = $('boardWrap');
  const pt = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const box = canvas.getBoundingClientRect();
    return { x: t.clientX - box.left - CU, y: t.clientY - box.top - CU };
  };
  let grabCue = false;

  const down = (e) => {
    if (moving || phase === 'over') return;
    if (MODE === 'ai' && turn === 1) return;      // 电脑回合，别抢杆
    const p = pt(e), c = cue();
    if (ballInHand && Math.hypot(p.x - c.x, p.y - c.y) < R * 3){ grabCue = true; return; }
    pulling = true;
    update(p);
  };
  const update = (p) => {
    const c = cue();
    const dx = c.x - p.x, dy = c.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return;
    aimA = Math.atan2(dy, dx);              // 往后拉 → 朝反方向打
    power = clamp((d - R) / (R * 9), 0, 1);
    needsDraw = true;
  };
  const move = (e) => {
    const p = pt(e);
    if (grabCue){
      const c = cue();
      c.x = clamp(p.x, R, TW - R); c.y = clamp(p.y, R, TH - R);
      needsDraw = true;
      return;
    }
    if (pulling) update(p);
  };
  const up = () => {
    if (grabCue){ grabCue = false; ballInHand = false; syncHud(); return; }
    if (!pulling) return;
    pulling = false;
    shoot();
  };

  wrap.addEventListener('touchstart', down, { passive: true });
  wrap.addEventListener('touchmove', move, { passive: true });
  wrap.addEventListener('touchend', up, { passive: true });
  wrap.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ── 音效 ──
let actx = null, muted = false;
const SPECS = {
  hit:   { f: 240, to: 120, d: .06, v: .05,  type: 'triangle' },
  pot:   { f: 180, to: 70,  d: .14, v: .055, type: 'sine' },
  eight: { f: 300, to: 90,  d: .30, v: .07,  type: 'triangle' },
  foul:  { f: 200, to: 110, d: .26, v: .05,  type: 'sawtooth' },
  win:   { f: 520, to: 1040,d: .34, v: .055, type: 'sine' },
};
function sfx(k){
  if (muted) return;
  const s = SPECS[k]; if (!s) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    o.type = s.type;
    o.frequency.setValueAtTime(s.f, t);
    o.frequency.exponentialRampToValueAtTime(s.to, t + s.d);
    g.gain.setValueAtTime(s.v, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + s.d);
    o.start(t); o.stop(t + s.d + .02);
  } catch { /* 没声音就算了 */ }
}

function tick(now){
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(now - lastT, 50);
  lastT = now;
  if (moving) physics(dt);
  if (needsDraw || moving){ draw(); needsDraw = false; }
}

function syncModes(){
  for (const b of document.querySelectorAll('.mbtn')) b.classList.toggle('on', b.dataset.m === MODE);
  $('levels').hidden = MODE !== 'ai';
  for (const b of document.querySelectorAll('#levels button')) b.classList.toggle('on', b.dataset.lv === AI_LV);
}

function init(){
  try {
    muted = localStorage.getItem('pool.muted.v1') === '1';
    const m = localStorage.getItem('pool.mode.v1');
    if (m === 'solo' || m === 'ai' || m === 'two') MODE = m;
    const l = localStorage.getItem('pool.ailv.v1');
    if (l && AI_LEVELS[l]) AI_LV = l;
  } catch { /* 忽略 */ }
  layout();
  reset(true);
  syncModes();
  bindAim();
  syncMute();

  $('restartBtn').addEventListener('click', () => reset(true));
  $('modeBtn').addEventListener('click', () => {
    const ov = $('overlay');
    ov.dataset.mode = 'start';
    ov.classList.add('show');
    syncModes();
  });
  $('levels').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    AI_LV = b.dataset.lv;
    try { localStorage.setItem('pool.ailv.v1', AI_LV); } catch { /* 忽略 */ }
    syncModes();
    if (MODE !== 'ai'){ MODE = 'ai'; syncModes(); reset(false); }
  });

  $('modes').addEventListener('click', (e) => {
    const b = e.target.closest('.mbtn');
    if (!b) return;
    MODE = b.dataset.m;
    try { localStorage.setItem('pool.mode.v1', MODE); } catch { /* 忽略 */ }
    syncModes();
    reset(false);
    if (MODE === 'ai' && turn === 1) aiTurn();
  });
  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('pool.muted.v1', muted ? '1' : '0'); } catch { /* 忽略 */ }
    syncMute();
  });
  window.addEventListener('resize', () => { layout(); });
  window.addEventListener('orientationchange', () => { setTimeout(layout, 120); setTimeout(layout, 450); });
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('boardWrap'));
}
function syncMute(){
  $('muteBtn').classList.toggle('muted', muted);
  $('muteBtn').setAttribute('aria-label', muted ? '音效已关' : '音效已开');
}

window.__pool = {
  get balls(){ return balls; },
  get state(){ return { turn, groups: groups.slice(), phase, ballInHand, winner, moving, R, TW, TH, power, aimA }; },
  reset, shoot, settle, aiPlan, aiTurn, legalTargets,
  setGroups: (g) => { groups[0] = g; groups[1] = g ? (g === 'solid' ? 'stripe' : 'solid') : null; },
  setMode: (m) => { MODE = m; reset(); },
  setLevel: (l) => { if (AI_LEVELS[l]) AI_LV = l; },
  get mode(){ return MODE; },
  get level(){ return AI_LV; },
  aiSafety,
  forceOpen: () => { phase = 'open'; },   // 测试用：跳过开球那一杆
  setAim: (a, p) => { aimA = a; power = p; needsDraw = true; },
  cue, cleared, pockets: () => pockets,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
