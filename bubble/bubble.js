/* 泡泡龙 —— 六边形交错网格、瞄准发射、同色三连消、悬空整串掉落。
   渲染沿用俄罗斯方块那套：固定的泡泡画进离屏层，每帧只画飞行中的那颗和准星。 */
(() => {
'use strict';

const COLS = 8;            // 偶数行的列数，奇数行少一列（往右错半格）
const ROWS = 13;           // 逻辑总行数
const DEAD_ROW = 11;       // 碰到这行就输
const START_ROWS = 5;
const DROP_EVERY = 6;      // 发射几次整体压下来一行
const SPEED = 1050;        // 泡泡飞行速度 px/秒
const SQ3 = Math.sqrt(3);

const COLORS = ['#22d3ee', '#fbbf24', '#a855f7', '#f43f5e'];   // 四色，小盘子上五色太难凑三连
const BEST_KEY = 'bubble.best.v1';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let grid = [];             // grid[row][col] = 颜色下标 or null
let R = 24;                // 泡泡半径（layout 算）
let W = 0, H = 0;
let cur = 0, next = 0;     // 当前 / 下一颗的颜色
let shot = null;           // 飞行中的泡泡 {x,y,vx,vy,c}
let aim = -Math.PI / 2;    // 瞄准角度，-90° 是正上
let aiming = false;
let score = 0, best = 0, shots = 0, rows = 0;
let over = false, won = false, started = false;
let pops = [];             // 消除动画
let staticDirty = true, needsDraw = true;
let aimPath = [];          // 瞄准轨迹，含反弹，setAim 时算一次
let rafId = 0, lastT = 0;

const canvas = $('board');
const ctx = canvas.getContext('2d');
const bg = document.createElement('canvas');
const bgCtx = bg.getContext('2d');

// ── 网格坐标 ──
const colsIn = (r) => r % 2 ? COLS - 1 : COLS;
function cellX(r, c){ return R + c * R * 2 + (r % 2 ? R : 0); }
function cellY(r){ return R + r * R * SQ3; }

// 交错网格的六个邻居，奇偶行偏移不一样
function neighbours(r, c){
  const odd = r % 2;
  const d = odd
    ? [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]]
    : [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]];
  const out = [];
  for (const [dc, dr] of d){
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < colsIn(nr)) out.push([nr, nc]);
  }
  return out;
}

// ── 开局 ──
function newGrid(){
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(colsIn(r)).fill(null));
}

function fillStart(){
  for (let r = 0; r < START_ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      grid[r][c] = (Math.random() * COLORS.length) | 0;
}

// 只在还剩的颜色里抽，免得发一颗盘面上根本没有的
function pickColor(){
  const live = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < colsIn(r); c++)
    if (grid[r][c] != null) live.add(grid[r][c]);
  const pool = live.size ? [...live] : COLORS.map((_, i) => i);
  return pool[(Math.random() * pool.length) | 0];
}

function restart(){
  newGrid();
  fillStart();
  score = 0; shots = 0; rows = 0;
  over = false; won = false; started = true;
  shot = null; pops = [];
  cur = pickColor(); next = pickColor();
  $('overlay').classList.remove('show');
  staticDirty = true; needsDraw = true;
  traceAim();
  syncHud();
  lastT = performance.now();
  if (!rafId) rafId = requestAnimationFrame(tick);
}

// ── 发射 ──
function fire(){
  if (over || shot || !started) return;
  const a = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
  shot = { x: W / 2, y: H - R, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED, c: cur };
  cur = next; next = pickColor();
  shots++;
  sfx('shoot');
  needsDraw = true;
}

function step(dt){
  if (!shot) return;
  const s = dt / 1000;
  let steps = Math.ceil(Math.hypot(shot.vx, shot.vy) * s / (R * 0.5));
  steps = Math.max(1, Math.min(steps, 12));
  for (let i = 0; i < steps && shot; i++) substep(s / steps);
  needsDraw = true;
}

function substep(s){
  shot.x += shot.vx * s;
  shot.y += shot.vy * s;

  // 撞左右墙就反弹
  if (shot.x < R){ shot.x = R; shot.vx = Math.abs(shot.vx); }
  if (shot.x > W - R){ shot.x = W - R; shot.vx = -Math.abs(shot.vx); }

  // 撞顶
  if (shot.y <= R){ land(); return; }

  // 撞到已有的泡泡
  const rr = (R * 1.86) ** 2;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < colsIn(r); c++){
      if (grid[r][c] == null) continue;
      const dx = shot.x - cellX(r, c), dy = shot.y - cellY(r);
      if (dx * dx + dy * dy < rr){ land(); return; }
    }
  }
}

// 落到最近的空格上（必须挨着已有泡泡或在第一行，不然会浮着）
function land(){
  const b = { r: -1, c: -1, d: Infinity };
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < colsIn(r); c++){
      if (grid[r][c] != null) continue;
      if (r > 0 && !neighbours(r, c).some(([nr, nc]) => grid[nr][nc] != null)) continue;
      const dx = cellX(r, c) - shot.x, dy = cellY(r) - shot.y;
      const d = dx * dx + dy * dy;
      if (d < b.d){ b.d = d; b.r = r; b.c = c; }
    }
  }
  const color = shot.c;
  shot = null;
  if (b.r < 0) return;
  grid[b.r][b.c] = color;
  staticDirty = true;

  const same = sameGroup(b.r, b.c);
  if (same.length >= 3){
    same.forEach(([r, c]) => { addPop(r, c, grid[r][c]); grid[r][c] = null; });
    score += same.length * 10;
    const loose = dropFloating();
    if (loose) score += loose * 20;      // 连带掉下来的更值钱
    sfx(same.length >= 5 ? 'big' : 'pop');
  } else {
    sfx('stick');
  }

  if (shots % DROP_EVERY === 0) pushDown();
  checkEnd();
  traceAim();
  syncHud();
}

// 同色连通块
function sameGroup(r0, c0){
  const color = grid[r0][c0];
  const seen = new Set([r0 + ',' + c0]);
  const out = [[r0, c0]], q = [[r0, c0]];
  while (q.length){
    const [r, c] = q.pop();
    for (const [nr, nc] of neighbours(r, c)){
      const k = nr + ',' + nc;
      if (seen.has(k) || grid[nr][nc] !== color) continue;
      seen.add(k); out.push([nr, nc]); q.push([nr, nc]);
    }
  }
  return out;
}

// 从顶行灌一遍，灌不到的就是悬空的，整串掉下来
function dropFloating(){
  const safe = new Set();
  const q = [];
  for (let c = 0; c < colsIn(0); c++) if (grid[0][c] != null){ safe.add('0,' + c); q.push([0, c]); }
  while (q.length){
    const [r, c] = q.pop();
    for (const [nr, nc] of neighbours(r, c)){
      const k = nr + ',' + nc;
      if (safe.has(k) || grid[nr][nc] == null) continue;
      safe.add(k); q.push([nr, nc]);
    }
  }
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] != null && !safe.has(r + ',' + c)){
        addPop(r, c, grid[r][c], true);
        grid[r][c] = null; n++;
      }
  if (n) staticDirty = true;
  return n;
}

// 整体往下压一行
function pushDown(){
  for (let r = ROWS - 1; r > 0; r--) {
    const src = grid[r - 1], dst = grid[r];
    for (let c = 0; c < dst.length; c++) dst[c] = c < src.length ? src[c] : null;
  }
  grid[0] = new Array(colsIn(0)).fill(null);
  for (let c = 0; c < colsIn(0); c++) grid[0][c] = (Math.random() * COLORS.length) | 0;
  rows++;
  staticDirty = true;
}

function checkEnd(){
  let any = false, deep = false;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] != null){ any = true; if (r >= DEAD_ROW) deep = true; }
  if (!any){ finish(true); return; }
  if (deep){ finish(false); return; }
}

function finish(win){
  over = true; won = win;
  if (score > best){ best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* 忽略 */ } }
  $('overlay').dataset.mode = win ? 'win' : 'lose';
  $('endScore').textContent = score.toLocaleString();
  $('endBest').textContent = best.toLocaleString();
  $('overlay').classList.add('show');
  sfx(win ? 'win' : 'over');
  syncHud();
  needsDraw = true;
}

// ── 消除动画 ──
function addPop(r, c, color, fall){
  pops.push({ x: cellX(r, c), y: cellY(r), c: color, t: 0, fall: !!fall, vy: fall ? 60 + Math.random() * 90 : 0 });
}
function stepPops(dt){
  for (let i = pops.length - 1; i >= 0; i--){
    const p = pops[i];
    p.t += dt;
    if (p.fall){ p.vy += 900 * dt / 1000; p.y += p.vy * dt / 1000; }
    if (p.t > (p.fall ? 900 : 260) || p.y > H + R) pops.splice(i, 1);
  }
  if (pops.length) needsDraw = true;
}

// 把瞄准线走一遍，撞墙折回来，碰到泡泡或顶就停。
// 只在角度变了的时候算，不是每帧。
function traceAim(){
  const a = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
  const pts = [{ x: W / 2, y: H - R }];
  let x = W / 2, y = H - R;
  const vx0 = Math.cos(a), vy0 = Math.sin(a);
  let vx = vx0, vy = vy0;
  const stepLen = R * .55, hitR2 = (R * 1.86) ** 2;
  let bounces = 0;
  for (let i = 0; i < 260; i++){
    x += vx * stepLen; y += vy * stepLen;
    if (x < R){ x = R; vx = -vx; pts.push({ x, y }); if (++bounces > 2) break; }
    else if (x > W - R){ x = W - R; vx = -vx; pts.push({ x, y }); if (++bounces > 2) break; }
    if (y <= R){ pts.push({ x, y }); break; }
    let hit = false;
    for (let r = 0; r < ROWS && !hit; r++){
      const row = grid[r];
      for (let c = 0; c < row.length; c++){
        if (row[c] == null) continue;
        const dx = x - cellX(r, c), dy = y - cellY(r);
        if (dx * dx + dy * dy < hitR2){ hit = true; break; }
      }
    }
    if (hit) break;
  }
  pts.push({ x, y });
  aimPath = pts;
}

// ── 画面 ──
function layout(){
  const wrap = $('boardWrap');
  const availW = wrap.clientWidth, availH = wrap.clientHeight;
  if (!availW || !availH) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  // 宽度决定半径；高度不够就再收一点
  let r = availW / (COLS * 2);
  const needH = R_needH(r);
  if (needH > availH) r *= availH / needH;
  R = Math.floor(r);
  W = R * COLS * 2;
  H = Math.round(R + (DEAD_ROW + 0.6) * R * SQ3 + R * 2.2);

  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bg.width = canvas.width; bg.height = canvas.height;
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  staticDirty = true; needsDraw = true;
  traceAim();
}
function R_needH(r){ return r + (DEAD_ROW + 0.6) * r * SQ3 + r * 2.2; }

function ball(c, x, y, color, scale = 1, alpha = 1){
  const rr = R * scale;
  c.save();
  c.globalAlpha = alpha;
  const g = c.createRadialGradient(x - rr * .33, y - rr * .38, rr * .12, x, y, rr);
  g.addColorStop(0, mix(color, '#ffffff', .55));
  g.addColorStop(.55, color);
  g.addColorStop(1, mix(color, '#05080f', .42));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, rr * .94, 0, Math.PI * 2); c.fill();
  c.strokeStyle = mix(color, '#05080f', .3);
  c.lineWidth = Math.max(1, rr * .07);
  c.stroke();
  c.restore();
}

function drawStatic(){
  bgCtx.clearRect(0, 0, W, H);
  // 死亡线
  const dy = cellY(DEAD_ROW) - R * .9;
  bgCtx.save();
  bgCtx.strokeStyle = 'rgba(244,63,94,.34)';
  bgCtx.lineWidth = 1.5;
  bgCtx.setLineDash([6, 6]);
  bgCtx.beginPath(); bgCtx.moveTo(0, dy); bgCtx.lineTo(W, dy); bgCtx.stroke();
  bgCtx.restore();

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] != null) ball(bgCtx, cellX(r, c), cellY(r), COLORS[grid[r][c]]);
  staticDirty = false;
}

function draw(){
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  if (staticDirty) drawStatic();
  ctx.drawImage(bg, 0, 0, W, H);

  // 消除 / 掉落动画
  for (const p of pops){
    if (p.fall) ball(ctx, p.x, p.y, COLORS[p.c], 1, Math.max(0, 1 - p.t / 900));
    else {
      const k = p.t / 260;
      ball(ctx, p.x, p.y, COLORS[p.c], 1 + k * .5, Math.max(0, 1 - k));
    }
  }

  // 瞄准线（含撞墙反弹），末端画个落点圈
  if (!over && !shot && started && aimPath.length > 1){
    ctx.save();
    ctx.strokeStyle = 'rgba(190,220,255,.32)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(aimPath[0].x, aimPath[0].y);
    for (let i = 1; i < aimPath.length; i++) ctx.lineTo(aimPath[i].x, aimPath[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    const e = aimPath[aimPath.length - 1];
    ctx.globalAlpha = .5;
    ctx.strokeStyle = COLORS[cur];
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, R * .9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // 飞行中的
  if (shot) ball(ctx, shot.x, shot.y, COLORS[shot.c]);

  // 发射口的这颗
  if (!over) ball(ctx, W / 2, H - R, COLORS[cur]);
}

function mix(a, b, t){
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function hex(h){
  return h.length === 4 ? h.slice(1).split('').map(x => parseInt(x + x, 16))
                        : [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}

function drawNext(){
  const cv = $('nextCv'), c = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const keep = R;
  R = Math.min(w, h) * .42;
  ball(c, w / 2, h / 2, COLORS[next]);
  R = keep;
}

function syncHud(){
  $('score').textContent = score.toLocaleString();
  $('best').textContent = best.toLocaleString();
  $('rows').textContent = Math.max(0, DEAD_ROW - topRow());
  drawNext();
}
function topRow(){
  for (let r = ROWS - 1; r >= 0; r--)
    for (let c = 0; c < colsIn(r); c++) if (grid[r][c] != null) return r;
  return 0;
}

// ── 主循环 ──
function tick(now){
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(now - lastT, 60);
  lastT = now;
  if (over){ if (needsDraw){ draw(); needsDraw = false; } return; }
  if (shot) step(dt);
  if (pops.length) stepPops(dt);
  if (needsDraw || shot || pops.length){ draw(); needsDraw = false; }
}

// ── 输入：拖着瞄，松手发 ──
function bindAim(){
  const wrap = $('boardWrap');
  const point = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const box = canvas.getBoundingClientRect();
    return { x: t.clientX - box.left, y: t.clientY - box.top };
  };
  const setAim = (p) => {
    const dx = p.x - W / 2, dy = p.y - (H - R);
    if (dy > -R * .4) return;                 // 别往下瞄
    aim = Math.atan2(dy, dx);
    traceAim();
    needsDraw = true;
  };
  const start = (e) => { if (over || shot) return; aiming = true; setAim(point(e)); };
  const move  = (e) => { if (!aiming) return; setAim(point(e)); };
  const end   = () => { if (!aiming) return; aiming = false; fire(); };

  wrap.addEventListener('touchstart', (e) => { start(e); }, { passive: true });
  wrap.addEventListener('touchmove',  (e) => { move(e); }, { passive: true });
  wrap.addEventListener('touchend', end, { passive: true });
  wrap.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft'){ aim -= .06; needsDraw = true; }
    if (e.code === 'ArrowRight'){ aim += .06; needsDraw = true; }
    if (e.code === 'Space'){ e.preventDefault(); fire(); }
    if (e.code === 'KeyR') restart();
    aim = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
    traceAim();
  });
}

// ── 音效 ──
let actx = null, muted = false;
const SPECS = {
  shoot: { f: 520, to: 700,  d: .05, v: .024, type: 'sine' },
  stick: { f: 300, to: 240,  d: .05, v: .022, type: 'triangle' },
  pop:   { f: 620, to: 900,  d: .12, v: .04,  type: 'sine' },
  big:   { f: 520, to: 1180, d: .26, v: .055, type: 'triangle' },
  win:   { f: 560, to: 1120, d: .34, v: .055, type: 'sine' },
  over:  { f: 280, to: 62,   d: .55, v: .06,  type: 'triangle' },
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

function init(){
  try {
    best = +localStorage.getItem(BEST_KEY) || 0;
    muted = localStorage.getItem('bubble.muted.v1') === '1';
  } catch { /* 忽略 */ }
  newGrid();
  layout();
  bindAim();
  syncMute();

  $('startBtn').addEventListener('click', restart);
  $('againBtn').addEventListener('click', restart);
  $('restartBtn').addEventListener('click', restart);
  $('fireBtn').addEventListener('click', fire);
  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('bubble.muted.v1', muted ? '1' : '0'); } catch { /* 忽略 */ }
    syncMute();
  });

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => { setTimeout(layout, 120); setTimeout(layout, 450); });
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('boardWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  $('overlay').dataset.mode = 'start';
  $('overlay').classList.add('show');
  syncHud();
  draw();
}
function syncMute(){
  $('muteBtn').classList.toggle('muted', muted);
  $('muteBtn').setAttribute('aria-label', muted ? '音效已关' : '音效已开');
}

window.__bubble = {
  get grid(){ return grid; },
  get state(){ return { score, best, shots, over, won, started, R, W, H, cur, next, shot: !!shot, rows }; },
  restart, fire, land: () => land(),
  setAim: (a) => { aim = a; traceAim(); needsDraw = true; },
  colsIn, neighbours, COLORS, DEAD_ROW, ROWS, COLS,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
