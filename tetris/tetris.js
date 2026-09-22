/* 俄罗斯方块 —— 按现代 Guideline 实现
   7-bag 随机 / SRS 旋转 + wall kick / hold / ghost / lock delay /
   T-spin / back-to-back / combo。纯 Canvas，无依赖。 */
(() => {
'use strict';

// ───────────────────────── 常量 ─────────────────────────

const COLS = 10;
const ROWS = 20;        // 可见行
const BUFFER = 2;       // 顶部隐藏行，方块在这里出生
const TOTAL_ROWS = ROWS + BUFFER;

// 两套配色。clear 那套把青/蓝/紫的明度拉开、红橙黄错开，
// 相邻色块更好分，整体饱和度略降，久看不累。
const PALETTES = {
  classic: { I:'#22d3ee', O:'#fbbf24', T:'#a855f7', S:'#4ade80', Z:'#f43f5e', J:'#3b82f6', L:'#fb923c' },
  clear:   { I:'#5ee7f5', O:'#f2c14e', T:'#a463dd', S:'#56c877', Z:'#e8546b', J:'#3f6fd0', L:'#ef8f4a' },
};

// 四种画法。gap 缝隙 / fill 填充压暗 / edge 描边提亮(0 不描) / lw 线宽 / rad 圆角 / ring 暗外圈
const STYLES = {
  gap:   { name:'标准',  gap:.055, fill:.14, edge:.30, lw:.07, rad:.20 },
  soft:  { name:'柔和',  gap:.06,  fill:.22, edge:.40, lw:.06, rad:.26 },
  ring:  { name:'暗圈',  gap:.045, fill:.14, edge:.32, lw:.07, rad:.20, ring:.40 },
  plain: { name:'纯色',  gap:.08,  fill:.10, edge:0,   lw:0,   rad:.22 },
};

const skin = { pal: 'clear', style: 'gap' };
function colorOf(type){ return PALETTES[skin.pal][type]; }

// 每种方块的四个旋转态，坐标是它在自己 box 里的格子位置 [x, y]。
// 直接写死每一态，比用旋转矩阵算更不容易在旋转中心上出错。
const PIECES = {
  I: { box: 4, spawnX: 3, states: [
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ]},
  O: { box: 2, spawnX: 4, states: [
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
  ]},
  T: { box: 3, spawnX: 3, states: [
    [[1,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[2,1],[1,2]],
    [[1,0],[0,1],[1,1],[1,2]],
  ]},
  S: { box: 3, spawnX: 3, states: [
    [[1,0],[2,0],[0,1],[1,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[1,1],[2,1],[0,2],[1,2]],
    [[0,0],[0,1],[1,1],[1,2]],
  ]},
  Z: { box: 3, spawnX: 3, states: [
    [[0,0],[1,0],[1,1],[2,1]],
    [[2,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,0],[0,1],[1,1],[0,2]],
  ]},
  J: { box: 3, spawnX: 3, states: [
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ]},
  L: { box: 3, spawnX: 3, states: [
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ]},
};
const TYPES = Object.keys(PIECES);

// SRS 踢墙表。原始规范里 y 轴向上为正，这里已全部取反成「向下为正」，
// 可以直接加到画布坐标上。key 是 "从态>到态"。
const KICKS = {
  JLSTZ: {
    '0>1': [[0,0],[-1,0],[-1,-1],[0, 2],[-1, 2]],
    '1>0': [[0,0],[ 1,0],[ 1, 1],[0,-2],[ 1,-2]],
    '1>2': [[0,0],[ 1,0],[ 1, 1],[0,-2],[ 1,-2]],
    '2>1': [[0,0],[-1,0],[-1,-1],[0, 2],[-1, 2]],
    '2>3': [[0,0],[ 1,0],[ 1,-1],[0, 2],[ 1, 2]],
    '3>2': [[0,0],[-1,0],[-1, 1],[0,-2],[-1,-2]],
    '3>0': [[0,0],[-1,0],[-1, 1],[0,-2],[-1,-2]],
    '0>3': [[0,0],[ 1,0],[ 1,-1],[0, 2],[ 1, 2]],
  },
  I: {
    '0>1': [[0,0],[-2,0],[ 1,0],[-2, 1],[ 1,-2]],
    '1>0': [[0,0],[ 2,0],[-1,0],[ 2,-1],[-1, 2]],
    '1>2': [[0,0],[-1,0],[ 2,0],[-1,-2],[ 2, 1]],
    '2>1': [[0,0],[ 1,0],[-2,0],[ 1, 2],[-2,-1]],
    '2>3': [[0,0],[ 2,0],[-1,0],[ 2,-1],[-1, 2]],
    '3>2': [[0,0],[-2,0],[ 1,0],[-2, 1],[ 1,-2]],
    '3>0': [[0,0],[ 1,0],[-2,0],[ 1, 2],[-2,-1]],
    '0>3': [[0,0],[-1,0],[ 2,0],[-1,-2],[ 2, 1]],
  },
};

const LOCK_DELAY = 500;      // 落地后多久锁死（毫秒）
const LOCK_RESET_LIMIT = 15; // 靠移动/旋转续命的次数上限
const DAS = 150;             // 按住方向键多久开始连发
const ARR = 40;              // 连发间隔
const SOFT_DROP_FACTOR = 20; // 软降速度倍率

// 每级重力：秒/格，来自官方公式 (0.8 - (lvl-1)*0.007)^(lvl-1)
function gravityFor(level){
  const l = Math.min(level, 20);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
}

const STORE_KEY = 'tetris.best.v1';
const SKIN_KEY  = 'tetris.skin.v1';
const SAVE_KEY  = 'tetris.save.v1';

// ───────────────────────── 工具 ─────────────────────────

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function readBest(){
  try { return parseInt(localStorage.getItem(STORE_KEY) || '0', 10) || 0; }
  catch { return 0; }          // 隐私模式下 localStorage 会抛异常
}
function writeBest(v){
  try { localStorage.setItem(STORE_KEY, String(v)); } catch { /* 存不了就算了 */ }
}

// 正在玩的这一局也存下来：手机上切个 App、锁个屏回来还能接着打
function saveGame(){
  if (!game.started || game.over){ clearSave(); return; }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      board: game.board,
      queue: game.queue,
      bag: game.bag,
      hold: game.hold,
      holdUsed: game.holdUsed,
      piece: game.piece,
      score: game.score,
      lines: game.lines,
      level: game.level,
      combo: game.combo,
      b2b: game.b2b,
      at: Date.now(),
    }));
  } catch { /* 存不下就算了，不影响玩 */ }
}

function readSave(){
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d || !Array.isArray(d.board) || d.board.length !== TOTAL_ROWS) return null;
    if (typeof d.score !== 'number') return null;
    return d;
  } catch { return null; }
}

function clearSave(){
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ }
}

function restoreGame(d){
  game.board = d.board;
  game.queue = d.queue || [];
  game.bag = d.bag || [];
  game.hold = d.hold || null;
  game.holdUsed = !!d.holdUsed;
  game.piece = d.piece || null;
  game.score = d.score || 0;
  game.lines = d.lines || 0;
  game.level = d.level || 1;
  game.combo = typeof d.combo === 'number' ? d.combo : -1;
  game.b2b = !!d.b2b;
  game.over = false;
  game.paused = false;
  game.frozen = false;
  game.started = true;
  particles.length = 0;
  clearing = null;
  softDropping = false;
  held.left = held.right = false;
  dropTimer = lockTimer = 0;
  lockResets = 0;
  grounded = false;
  fillQueue();
  if (!game.piece) spawnNext();
  $('overlay').classList.remove('show');
  $('pauseBtn').textContent = '暂停';
  syncHud();
  lastFrame = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function readSkin(){
  try {
    const raw = JSON.parse(localStorage.getItem(SKIN_KEY) || 'null');
    if (raw && PALETTES[raw.pal] && STYLES[raw.style]) return raw;
  } catch { /* 坏数据就用默认 */ }
  return null;
}
function writeSkin(){
  try { localStorage.setItem(SKIN_KEY, JSON.stringify(skin)); } catch { /* 忽略 */ }
}

// ───────────────────────── 游戏状态 ─────────────────────────

const game = {
  board: [],          // [y][x] → 颜色字符串或 null
  piece: null,        // { type, x, y, rot }
  hold: null,
  holdUsed: false,
  bag: [],
  queue: [],          // 预览队列，保持 5 个
  score: 0,
  lines: 0,
  level: 1,
  combo: -1,
  b2b: false,
  best: readBest(),
  over: false,
  paused: false,
  frozen: false,      // 样式面板开着时暂停推进，但画面照常刷新
  started: false,
  lastRotKick: -1,    // 最近一次旋转用了第几个踢墙偏移，判 T-spin 用
  lastWasRot: false,
};

const dbg = { frames: 0 };
let dropTimer = 0;
let lockTimer = 0;
let lockResets = 0;
let grounded = false;
let softDropping = false;
let lastFrame = 0;
let rafId = 0;

// 消行动画：记下正在闪的行，动画走完才真正塌陷
let clearing = null;   // { rows:[], t:0, dur:260 }
// 落地/消行时迸的粒子
const particles = [];

// ───────────────────────── 棋盘与方块 ─────────────────────────

function newBoard(){
  return Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(null));
}

function refillBag(){
  const bag = TYPES.slice();
  for (let i = bag.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function nextType(){
  if (game.bag.length === 0) game.bag = refillBag();
  return game.bag.pop();
}

function fillQueue(){
  while (game.queue.length < 5) game.queue.push(nextType());
}

function cellsOf(type, rot){
  return PIECES[type].states[rot & 3];
}

function collides(type, x, y, rot){
  for (const [cx, cy] of cellsOf(type, rot)){
    const bx = x + cx, by = y + cy;
    if (bx < 0 || bx >= COLS) return true;
    if (by >= TOTAL_ROWS) return true;
    if (by >= 0 && game.board[by][bx]) return true;
  }
  return false;
}

function spawn(type){
  const def = PIECES[type];
  const p = { type, x: def.spawnX, y: 0, rot: 0 };
  game.piece = p;
  game.holdUsed = false;
  game.lastWasRot = false;
  game.lastRotKick = -1;
  dropTimer = 0;
  lockTimer = 0;
  lockResets = 0;
  grounded = false;
  // 出生位置就被占 → 结束
  if (collides(p.type, p.x, p.y, p.rot)) endGame();
}

function spawnNext(){
  fillQueue();
  spawn(game.queue.shift());
  fillQueue();
}

// ───────────────────────── 操作 ─────────────────────────

function tryMove(dx, dy){
  const p = game.piece;
  if (!p) return false;
  if (collides(p.type, p.x + dx, p.y + dy, p.rot)) return false;
  p.x += dx; p.y += dy;
  game.lastWasRot = false;
  if (dy === 0) touchGround(true);   // 横move 可以续 lock delay
  return true;
}

function tryRotate(dir){
  const p = game.piece;
  if (!p || p.type === 'O') return false;
  const from = p.rot & 3;
  const to = (from + dir + 4) & 3;
  const table = (p.type === 'I' ? KICKS.I : KICKS.JLSTZ)[`${from}>${to}`];
  if (!table) return false;
  for (let i = 0; i < table.length; i++){
    const [kx, ky] = table[i];
    if (!collides(p.type, p.x + kx, p.y + ky, to)){
      p.x += kx; p.y += ky; p.rot = to;
      game.lastWasRot = true;
      game.lastRotKick = i;
      touchGround(true);
      sfx('rotate');
      return true;
    }
  }
  return false;
}

function hardDrop(){
  const p = game.piece;
  if (!p) return;
  let d = 0;
  while (!collides(p.type, p.x, p.y + d + 1, p.rot)) d++;
  p.y += d;
  game.score += d * 2;
  burst(p, 1.4);
  lockPiece();
  sfx('drop');
}

function holdPiece(){
  if (!game.piece || game.holdUsed) return;
  const cur = game.piece.type;
  if (game.hold){
    const h = game.hold;
    game.hold = cur;
    spawn(h);
  } else {
    game.hold = cur;
    spawnNext();
  }
  game.holdUsed = true;   // spawn 会把它清掉，所以放在后面
  sfx('hold');
}

// 落地状态变化时重置 lock delay
function touchGround(fromAction){
  const p = game.piece;
  if (!p) return;
  const nowGrounded = collides(p.type, p.x, p.y + 1, p.rot);
  if (nowGrounded){
    if (!grounded){
      grounded = true;
      lockTimer = 0;
    } else if (fromAction && lockResets < LOCK_RESET_LIMIT){
      lockTimer = 0;
      lockResets++;
    }
  } else {
    grounded = false;
    lockTimer = 0;
  }
}

// ───────────────────────── 锁定与消行 ─────────────────────────

// T-spin：T 块、最后一步是旋转、中心四角至少三个被挡
function detectTSpin(){
  const p = game.piece;
  if (!p || p.type !== 'T' || !game.lastWasRot) return null;
  const cx = p.x + 1, cy = p.y + 1;
  const corner = (x, y) =>
    x < 0 || x >= COLS || y >= TOTAL_ROWS || (y >= 0 && !!game.board[y][x]);
  // 四个角，前两个是 T 朝向那一侧的「正面角」
  const front = [[[-1,-1],[1,-1]], [[1,-1],[1,1]], [[1,1],[-1,1]], [[-1,1],[-1,-1]]][p.rot & 3];
  const back  = [[[-1,1],[1,1]],  [[-1,-1],[-1,1]], [[-1,-1],[1,-1]], [[1,-1],[1,1]]][p.rot & 3];
  const f = front.filter(([dx,dy]) => corner(cx+dx, cy+dy)).length;
  const b = back .filter(([dx,dy]) => corner(cx+dx, cy+dy)).length;
  if (f + b < 3) return null;
  // 正面两角都被挡 = 实打实的 T-spin；否则算 mini（踢墙踢到底那次除外）
  if (f === 2 || game.lastRotKick === 4) return 'tspin';
  return 'mini';
}

function lockPiece(){
  const p = game.piece;
  if (!p) return;
  const spin = detectTSpin();

  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy, bx = p.x + cx;
    if (by >= 0 && by < TOTAL_ROWS) game.board[by][bx] = p.type;
  }
  game.piece = null;

  // 找满行
  const full = [];
  for (let y = 0; y < TOTAL_ROWS; y++){
    if (game.board[y].every(c => c)) full.push(y);
  }

  scoreFor(full.length, spin);

  if (full.length){
    clearing = { rows: full, t: 0, dur: 260 };
    for (const y of full) burstRow(y);
    if (spin)                    sfx('tspin', full.length);
    else if (full.length === 4)  sfx('tetris', game.combo);
    else                         sfx('clear', full.length, game.combo);
    flashBoard(full.length);
  } else {
    sfx('lock');
    // 锁在隐藏区之上 = 顶出局
    const topOut = cellsOf(p.type, p.rot).every(([, cy]) => p.y + cy < BUFFER);
    if (topOut) endGame(); else { spawnNext(); saveGame(); }
  }
}

function scoreFor(n, spin){
  const lvl = game.level;
  let base = 0, label = '';

  if (spin === 'tspin'){
    base = [400, 800, 1200, 1600][n] || 400;
    label = n ? `T-SPIN ${['','SINGLE','DOUBLE','TRIPLE'][n]}` : 'T-SPIN';
  } else if (spin === 'mini'){
    base = n ? (n === 1 ? 200 : 400) : 100;
    label = n ? 'MINI T-SPIN' : '';
  } else if (n){
    base = [0, 100, 300, 500, 800][n];
    label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][n];
  }

  // back-to-back：连续的 Tetris 或 T-spin 消行，额外五成
  const isHard = n > 0 && (n === 4 || spin);
  if (n > 0){
    if (isHard && game.b2b){ base = Math.floor(base * 1.5); label = 'B2B ' + label; }
    game.b2b = isHard;
    game.combo++;
    if (game.combo > 0){
      base += 50 * game.combo;
      label += `  ${game.combo} COMBO`;
    }
  } else {
    game.combo = -1;
  }

  game.score += base * lvl;

  if (n > 0){
    game.lines += n;
    const newLevel = Math.floor(game.lines / 10) + 1;
    if (newLevel > game.level){ game.level = newLevel; flashLevel(); }
  }
  if (label) showToast(label.trim());
  if (game.score > game.best){ game.best = game.score; writeBest(game.best); }
}

function applyClear(rows){
  const set = new Set(rows);
  const kept = [];
  for (let y = 0; y < TOTAL_ROWS; y++) if (!set.has(y)) kept.push(game.board[y]);
  while (kept.length < TOTAL_ROWS) kept.unshift(new Array(COLS).fill(null));
  game.board = kept;
}

function endGame(){
  game.over = true;
  game.piece = null;
  clearSave();
  cancelAnimationFrame(rafId);
  if (game.score > game.best){ game.best = game.score; writeBest(game.best); }
  $('overScore').textContent = game.score.toLocaleString();
  $('overLines').textContent = game.lines;
  $('overLevel').textContent = game.level;
  $('overBest').textContent = game.best.toLocaleString();
  $('overlay').classList.add('show');
  $('overlay').dataset.mode = 'over';
  syncHud();
  sfx('over');
}

// ───────────────────────── 画面 ─────────────────────────

const canvas = $('board');
const ctx = canvas.getContext('2d');
const nextCv = $('nextCv');
const nextCtx = nextCv.getContext('2d');
const holdCv = $('holdCv');
const holdCtx = holdCv.getContext('2d');

let CELL = 30;   // 实际由 layout() 按容器算

function layout(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // 必须量 boardWrap（由 grid 定尺寸），不能量 canvas 的直接父元素
  // ——那层 .board-box 是贴着 canvas 的，拿它算会变成自己算自己。
  const wrap = $('boardWrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  if (!availW || !availH) return;      // 样式还没到位，等 observer 再喊一次
  // 让 10×20 的棋盘在容器里等比最大化
  CELL = Math.floor(Math.min(availW / COLS, availH / ROWS));
  CELL = Math.max(CELL, 8);
  const w = CELL * COLS, h = CELL * ROWS;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (const [cv, c] of [[nextCv, nextCtx], [holdCv, holdCtx]]){
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw();
}

// 画一个方块格。具体长相由当前 skin.style 决定，见上面的 STYLES。
function drawCell(c, px, py, size, color, opts = {}){
  const { ghost = false, alpha = 1 } = opts;
  const v = STYLES[skin.style];
  const g = size * v.gap, x = px + g, y = py + g, d = size - g * 2;
  const R = v.rad * d;

  c.save();
  c.globalAlpha = alpha;

  if (ghost){
    c.globalAlpha = alpha * .40;
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, d * .075);
    roundRect(c, x + 1, y + 1, d - 2, d - 2, R);
    c.stroke();
    c.globalAlpha = alpha * .07;
    c.fillStyle = color;
    c.fill();
    c.restore();
    return;
  }

  c.fillStyle = mix(color, '#0a1020', v.fill);
  roundRect(c, x, y, d, d, R);
  c.fill();

  let off = 0;
  if (v.ring){            // 先压一圈暗边，相邻同色系方块也能分开
    const lw = Math.max(1, d * .09);
    c.strokeStyle = mix(color, '#050912', v.ring);
    c.lineWidth = lw;
    roundRect(c, x + lw / 2, y + lw / 2, d - lw, d - lw, Math.max(0, R - lw / 2));
    c.stroke();
    off = lw;
  }
  if (v.edge){
    const lw = Math.max(1, d * v.lw), o = off + lw / 2;
    c.strokeStyle = mix(color, '#ffffff', v.edge);
    c.lineWidth = lw;
    roundRect(c, x + o, y + o, d - o * 2, d - o * 2, Math.max(0, R - o));
    c.stroke();
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r){
  c.beginPath();
  if (r <= 0){ c.rect(x, y, w, h); return; }
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y);
  c.arcTo(x + w, y,     x + w, y + h, r);
  c.arcTo(x + w, y + h, x,     y + h, r);
  c.arcTo(x,     y + h, x,     y,     r);
  c.arcTo(x,     y,     x + w, y,     r);
  c.closePath();
}

function mix(a, b, t){
  const pa = hex(a), pb = hex(b);
  const ch = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
function hex(h){
  if (h[0] !== '#') return [255,255,255];
  const v = h.length === 4
    ? h.slice(1).split('').map(x => parseInt(x + x, 16))
    : [1,3,5].map(i => parseInt(h.slice(i, i + 2), 16));
  return v;
}

function draw(){
  const W = CELL * COLS, H = CELL * ROWS;
  ctx.clearRect(0, 0, W, H);

  // 井底格线
  ctx.save();
  ctx.strokeStyle = 'rgba(120,160,255,.09)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++){
    ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, H); ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++){
    ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(W, y * CELL + .5); ctx.stroke();
  }
  ctx.restore();

  const clearingSet = clearing ? new Set(clearing.rows) : null;
  const flash = clearing ? 1 - clearing.t / clearing.dur : 0;

  // 已落地的块（BUFFER 以上不画，自然被裁掉）
  for (let y = BUFFER; y < TOTAL_ROWS; y++){
    for (let x = 0; x < COLS; x++){
      const t = game.board[y][x];
      if (!t) continue;
      const col = colorOf(t);
      const py = (y - BUFFER) * CELL;
      if (clearingSet && clearingSet.has(y)){
        drawCell(ctx, x * CELL, py, CELL, mix(col, '#ffffff', .55 + .45 * flash), { alpha: .35 + .65 * flash });
      } else {
        drawCell(ctx, x * CELL, py, CELL, col);
      }
    }
  }

  // 落点虚影 + 当前块
  const p = game.piece;
  if (p && !game.over){
    const color = colorOf(p.type);
    let gy = p.y;
    while (!collides(p.type, p.x, gy + 1, p.rot)) gy++;
    if (gy !== p.y){
      for (const [cx, cy] of cellsOf(p.type, p.rot)){
        const by = gy + cy;
        if (by < BUFFER) continue;
        drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, color, { ghost: true });
      }
    }
    // 快锁定时轻微发白，提示「要定了」
    const lockPulse = grounded ? clamp(lockTimer / LOCK_DELAY, 0, 1) : 0;
    for (const [cx, cy] of cellsOf(p.type, p.rot)){
      const by = p.y + cy;
      if (by < BUFFER) continue;
      const col = lockPulse ? mix(color, '#ffffff', lockPulse * .45) : color;
      drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, col);
    }
  }

  drawParticles();
  drawPreview();
}

function drawPreview(){
  const nw = nextCv.clientWidth, nh = nextCv.clientHeight;
  nextCtx.clearRect(0, 0, nw, nh);
  if (!nw || !nh) return;

  // 上面一整行放马上要来的那个，下面并排放之后的两个
  const topH = Math.round(nh * 0.54);
  const botH = nh - topH;
  if (game.queue[0]) drawMini(nextCtx, game.queue[0], 0, 0, nw, topH, 1);
  if (game.queue[1]) drawMini(nextCtx, game.queue[1], 0, topH, nw / 2, botH, .62);
  if (game.queue[2]) drawMini(nextCtx, game.queue[2], nw / 2, topH, nw / 2, botH, .62);

  // hold
  const hw = holdCv.clientWidth, hh = holdCv.clientHeight;
  holdCtx.clearRect(0, 0, hw, hh);
  if (game.hold) drawMini(holdCtx, game.hold, 0, 0, hw, hh, game.holdUsed ? .28 : 1);
}

function drawMini(c, type, ox, oy, w, h, alpha){
  const def = PIECES[type];
  const cells = def.states[0];
  const xs = cells.map(v => v[0]), ys = cells.map(v => v[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const cell = Math.min(w / (bw + 1.1), h / (bh + 1.0));
  const px = ox + (w - bw * cell) / 2;
  const py = oy + (h - bh * cell) / 2;
  for (const [cx, cy] of cells){
    drawCell(c, px + (cx - minX) * cell, py + (cy - minY) * cell, cell, colorOf(type), { alpha });
  }
}

// ───────────────────────── 粒子 ─────────────────────────

function burst(p, power){
  const color = colorOf(p.type);
  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy;
    if (by < BUFFER) continue;
    for (let i = 0; i < 3; i++){
      particles.push({
        x: (p.x + cx + .5) * CELL,
        y: (by - BUFFER + .5) * CELL,
        vx: (Math.random() - .5) * 90 * power,
        vy: (Math.random() * -60 - 20) * power,
        life: 1, color, size: CELL * .16,
      });
    }
  }
}

function burstRow(y){
  if (y < BUFFER) return;
  for (let x = 0; x < COLS; x++){
    const t = game.board[y][x];
    const color = t ? colorOf(t) : '#ffffff';
    for (let i = 0; i < 3; i++){
      particles.push({
        x: (x + .5) * CELL,
        y: (y - BUFFER + .5) * CELL,
        vx: (Math.random() - .5) * 220,
        vy: (Math.random() - .5) * 160,
        life: 1, color, size: CELL * .2,
      });
    }
  }
}

function stepParticles(dt){
  for (let i = particles.length - 1; i >= 0; i--){
    const q = particles[i];
    q.life -= dt / 620;
    if (q.life <= 0){ particles.splice(i, 1); continue; }
    q.x += q.vx * dt / 1000;
    q.y += q.vy * dt / 1000;
    q.vy += 520 * dt / 1000;
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function drawParticles(){
  ctx.save();
  for (const q of particles){
    ctx.globalAlpha = clamp(q.life, 0, 1) * .9;
    ctx.fillStyle = q.color;
    ctx.shadowColor = q.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.restore();
}

// ───────────────────────── HUD ─────────────────────────

function syncHud(){
  $('score').textContent = game.score.toLocaleString();
  $('lines').textContent = game.lines;
  $('level').textContent = game.level;
  $('best').textContent  = game.best.toLocaleString();
}

// 消行时让棋盘边框闪一下，四行给更重的那一版
function flashBoard(n){
  const el = canvas;
  el.classList.remove('flash', 'flash-big');
  void el.offsetWidth;                 // 强制重排，动画才会重新播
  el.classList.add(n >= 4 ? 'flash-big' : 'flash');
}

let toastTimer = 0;
function showToast(text){
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;          // 重置动画
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1100);
}

function flashLevel(){
  sfx('level');
  const el = $('levelBox');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  showToast('LEVEL ' + game.level);
}

// ───────────────────────── 音效 ─────────────────────────
// 全部用 WebAudio 现合成，不背资源文件。
// 消行走琶音：几行就多几个音，连击越多整体升得越高。

let actx = null, master = null;
let muted = false;

function audio(){
  try {
    if (!actx){
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = .9;
      // 琶音和连续硬降会让好几个音叠在一起，挂个压限器兜底，免得爆音
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = .003;
      comp.release.value = .18;
      master.connect(comp);
      comp.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch { return null; }
}

// 一个带起落包络的音；filter 给它一点圆润度，别太刺
function tone(o){
  if (muted) return;
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + (o.delay || 0);
  const dur = o.dur || .15;
  const vol = o.vol == null ? .07 : o.vol;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type || 'triangle';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);

  g.gain.setValueAtTime(.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + (o.atk || .008));
  g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);

  if (o.filter){
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filter;
    osc.connect(f); f.connect(g);
  } else {
    osc.connect(g);
  }
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + .03);
}

// 一小段噪声，给落地和消行添点「实体」的冲击感
function noise(o){
  if (muted) return;
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + (o.delay || 0);
  const dur = o.dur || .1;
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = o.hp ? 'highpass' : 'lowpass';
  f.frequency.setValueAtTime(o.filter || 1500, t0);
  if (o.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.filterTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(o.vol == null ? .08 : o.vol, t0);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

// C 大调往上爬的一串音，消几行就取前几个
const LADDER = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
const semitone = (n) => Math.pow(1.05946, n);

const SFX = {
  move(){ tone({ freq: 190, dur: .028, vol: .022, type: 'square', filter: 800 }); },

  rotate(){
    tone({ freq: 330, to: 430, dur: .05, vol: .042, type: 'square', filter: 1900 });
  },

  hold(){
    tone({ freq: 392, dur: .07, vol: .045, type: 'sine' });
    tone({ freq: 587, dur: .10, vol: .040, type: 'sine', delay: .05 });
  },

  // 硬降：噪声冲击 + 一记下沉的低音
  drop(){
    noise({ dur: .085, vol: .085, filter: 2600, filterTo: 300 });
    tone({ freq: 150, to: 52, dur: .14, vol: .09, type: 'sine' });
  },

  lock(){ tone({ freq: 118, to: 84, dur: .055, vol: .04, type: 'triangle' }); },

  // 消行：1~3 行走琶音，combo 越高整体越亮
  clear(n, combo){
    const up = semitone(Math.min(Math.max(combo, 0), 8));
    const notes = LADDER.slice(0, Math.min(2 + n, LADDER.length));
    notes.forEach((f, i) => {
      tone({ freq: f * up, dur: .24, vol: .07, type: 'triangle', filter: 4200, delay: i * .055 });
    });
    tone({ freq: 130.81 * up, dur: .40, vol: .05, type: 'sine' });   // 垫底
    noise({ dur: .16, vol: .045, filter: 5200, hp: true });          // 碎裂感
  },

  // 四行：整条梯子爬完，锯齿音色 + 低音垫，最爽的那一下
  tetris(combo){
    const up = semitone(Math.min(Math.max(combo, 0), 8));
    LADDER.forEach((f, i) => {
      tone({ freq: f * up, dur: .30, vol: .08, type: 'sawtooth', filter: 3200, delay: i * .05 });
    });
    tone({ freq: 65.41, to: 130.81, dur: .55, vol: .085, type: 'sine' });
    noise({ dur: .3, vol: .06, filter: 6000, hp: true });
    tone({ freq: 1046.5 * up, dur: .5, vol: .05, type: 'sine', delay: .3 });
  },

  // T-spin：换小调，听起来「不一样」
  tspin(n){
    [523.25, 622.25, 783.99, 1046.5].slice(0, 2 + n).forEach((f, i) => {
      tone({ freq: f, dur: .26, vol: .07, type: 'square', filter: 2600, delay: i * .06 });
    });
    tone({ freq: 98, dur: .4, vol: .06, type: 'sine' });
  },

  level(){
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ freq: f, dur: .18, vol: .06, type: 'triangle', filter: 4000, delay: i * .07 });
    });
  },

  over(){
    [392, 330, 262, 196].forEach((f, i) => {
      tone({ freq: f, to: f * .96, dur: .34, vol: .075, type: 'sawtooth', filter: 1600, delay: i * .13 });
    });
    tone({ freq: 110, to: 42, dur: .9, vol: .07, type: 'sine', delay: .5 });
  },
};

// 老的调用点统一走这里
function sfx(kind, a, b){
  if (muted) return;
  const fn = SFX[kind];
  if (fn) { try { fn(a, b); } catch { /* 浏览器不给声音就静音运行 */ } }
}

// ───────────────────────── 主循环 ─────────────────────────

function tick(now){
  rafId = requestAnimationFrame(tick);
  dbg.frames++;
  const dt = Math.min(now - lastFrame, 100);   // 切后台回来不要瞬移
  lastFrame = now;
  if (game.paused || game.over || game.frozen) { draw(); return; }

  stepParticles(dt);
  handleAutoRepeat(dt);

  // 消行动画播完再塌陷
  if (clearing){
    clearing.t += dt;
    if (clearing.t >= clearing.dur){
      applyClear(clearing.rows);
      clearing = null;
      spawnNext();
      saveGame();
    }
    draw();
    return;
  }

  if (game.piece){
    const speed = softDropping ? gravityFor(game.level) / SOFT_DROP_FACTOR : gravityFor(game.level);
    dropTimer += dt;
    while (dropTimer >= speed){
      dropTimer -= speed;
      if (!collides(game.piece.type, game.piece.x, game.piece.y + 1, game.piece.rot)){
        game.piece.y++;
        game.lastWasRot = false;
        if (softDropping) game.score++;
      } else break;
    }
    touchGround(false);
    if (grounded){
      lockTimer += dt;
      if (lockTimer >= LOCK_DELAY){ burst(game.piece, .7); lockPiece(); }
    }
  }

  syncHud();
  draw();
}

// ───────────────────────── 输入 ─────────────────────────

const held = { left: false, right: false };
const repeat = { left: 0, right: 0, started: { left: false, right: false } };

function handleAutoRepeat(dt){
  for (const dir of ['left', 'right']){
    if (!held[dir]) continue;
    repeat[dir] += dt;
    const thresh = repeat.started[dir] ? ARR : DAS;
    while (repeat[dir] >= thresh){
      repeat[dir] -= thresh;
      repeat.started[dir] = true;
      tryMove(dir === 'left' ? -1 : 1, 0);
    }
  }
}

function press(dir){
  if (game.over || game.paused) return;
  held[dir] = true;
  repeat[dir] = 0;
  repeat.started[dir] = false;
  tryMove(dir === 'left' ? -1 : 1, 0);
}
function release(dir){
  held[dir] = false;
  repeat[dir] = 0;
  repeat.started[dir] = false;
}

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft',
  ArrowUp: 'cw', KeyX: 'cw', KeyZ: 'ccw', ControlLeft: 'ccw', ControlRight: 'ccw',
  Space: 'hard', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  KeyP: 'pause', Escape: 'pause', KeyR: 'restart', KeyM: 'mute', KeyF: 'fullscreen',
};

window.addEventListener('keydown', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  e.preventDefault();
  if (act === 'restart'){ restart(); return; }
  if (act === 'pause'){ togglePause(); return; }
  if (act === 'mute'){ toggleMute(); return; }
  if (act === 'fullscreen'){ toggleGameMode(); return; }
  if (!game.started || game.over || game.paused) return;
  if (e.repeat && act !== 'soft') return;
  switch (act){
    case 'left':  press('left'); break;
    case 'right': press('right'); break;
    case 'soft':  softDropping = true; break;
    case 'cw':    tryRotate(1); break;
    case 'ccw':   tryRotate(-1); break;
    case 'hard':  hardDrop(); break;
    case 'hold':  holdPiece(); break;
  }
}, { passive: false });

window.addEventListener('keyup', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  if (act === 'left')  release('left');
  if (act === 'right') release('right');
  if (act === 'soft')  softDropping = false;
});

// 底部按钮：按住能连发
function bindButtons(){
  const map = [
    ['btnLeft',  () => press('left'),   () => release('left')],
    ['btnRight', () => press('right'),  () => release('right')],
    ['btnCw',    () => tryRotate(1),    null],
    ['btnDrop',  () => hardDrop(),      null],
  ];
  for (const [id, down, up] of map){
    const el = $(id);
    if (!el) continue;
    const start = (e) => {
      e.preventDefault();
      if (!game.started || game.over || game.paused) return;
      el.classList.add('active');
      down();
    };
    const end = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('active');
      if (up) up();
    };
    // 触屏走 touch 事件；一旦用过触屏就不再理会浏览器合成的 mouse 事件，
    // 否则一次点按会被当成两次输入。
    let touched = false;
    el.addEventListener('touchstart', (e) => { touched = true; start(e); }, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
    el.addEventListener('mousedown', (e) => { if (!touched) start(e); });
    el.addEventListener('mouseup', (e) => { if (!touched) end(e); });
    el.addEventListener('mouseleave', (e) => { if (!touched) end(e); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

// ───────────────────────── 样式切换 ─────────────────────────

// 面板里每个选项的小预览：三个最容易混的颜色摆一起
function paintSwatch(cv, pal, style, mode){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 96, h = cv.clientHeight || 30;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const keep = { pal: skin.pal, style: skin.style };
  skin.pal = pal; skin.style = style;      // 借 drawCell 当前状态画预览

  if (mode === 'grid'){
    // 2×2：缝隙、描边这些差别要有相邻方块才看得出来
    const s = Math.min(h / 2, w / 2);
    const ox = (w - s * 2) / 2, oy = (h - s * 2) / 2;
    [['I', 0, 0], ['J', 1, 0], ['T', 0, 1], ['Z', 1, 1]].forEach(([t, gx, gy]) => {
      drawCell(c, ox + gx * s, oy + gy * s, s, colorOf(t));
    });
  } else {
    const s = Math.min(h, w / 4);
    ['I', 'J', 'T', 'Z'].forEach((t, i) => {
      drawCell(c, i * s + (w - s * 4) / 2, (h - s) / 2, s, colorOf(t));
    });
  }
  skin.pal = keep.pal; skin.style = keep.style;
}

function buildStylePanel(){
  const palWrap = $('palOpts'), stWrap = $('styleOpts');
  palWrap.innerHTML = ''; stWrap.innerHTML = '';

  [['clear', '高区分'], ['classic', '原配色']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (skin.pal === k ? ' on' : '');
    b.dataset.pal = k;
    b.innerHTML = `<canvas></canvas><span>${label}</span>`;
    b.addEventListener('click', () => { skin.pal = k; applySkin(); });
    palWrap.appendChild(b);
    paintSwatch(b.querySelector('canvas'), k, skin.style, 'row');
  });

  Object.keys(STYLES).forEach(k => {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (skin.style === k ? ' on' : '');
    b.dataset.style = k;
    b.innerHTML = `<canvas></canvas><span>${STYLES[k].name}</span>`;
    b.addEventListener('click', () => { skin.style = k; applySkin(); });
    stWrap.appendChild(b);
    paintSwatch(b.querySelector('canvas'), skin.pal, k, 'grid');
  });
}

function applySkin(){
  writeSkin();
  buildStylePanel();
  draw();
}

function toggleStylePanel(open){
  const el = $('styleSheet');
  const show = open === undefined ? el.hidden : open;
  if (show){
    el.hidden = false;
    buildStylePanel();
    requestAnimationFrame(buildStylePanel);   // 首帧 canvas 还没量到宽高
  } else {
    el.hidden = true;
  }
  game.frozen = show;        // 挑样式的时候方块别接着往下掉
  if (!show) lastFrame = performance.now();
}

// ───────────────────────── 游戏模式 ─────────────────────────
// iPhone 的 Safari 不给网页真全屏，所以这里分两层：
// 能用 Fullscreen API 就用；用不了也至少把页面上的壳收起来，把棋盘放到最大。
// 想在 iPhone 上真全屏，把页面「添加到主屏幕」再从图标打开。

let wakeLock = null;

async function keepAwake(on){
  try {
    if (on && 'wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock){
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* 不支持或被拒就算了，不影响游戏 */ }
}

function fsElement(){
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncFsBtn(){
  const on = document.body.classList.contains('immersive');
  $('fsIc').textContent = on ? '✕' : '⛶';
  $('fsTx').textContent = on ? '退出' : '游戏模式';
  $('fsBtn').setAttribute('aria-label', on ? '退出游戏模式' : '进入游戏模式');
}

async function enterGameMode(){
  document.body.classList.add('immersive');
  syncFsBtn();
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req){
    try { await req.call(el, { navigationUI: 'hide' }); } catch { /* 用户拒绝或不支持 */ }
  }
  keepAwake(true);
  layout();
}

async function exitGameMode(){
  document.body.classList.remove('immersive');
  syncFsBtn();
  if (fsElement()){
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { await exit.call(document); } catch { /* 忽略 */ } }
  }
  keepAwake(false);
  layout();
}

function toggleGameMode(){
  if (document.body.classList.contains('immersive')) exitGameMode();
  else enterGameMode();
}

// 从系统全屏退出（比如按了 Esc、或 iOS 手势）时，把页面状态同步回来
function onFsChange(){
  if (!fsElement() && document.body.classList.contains('immersive')){
    // 只有真用上了 Fullscreen API 的情况才跟着退出
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled){
      document.body.classList.remove('immersive');
      syncFsBtn();
      keepAwake(false);
      layout();
    }
  }
}

// 从主屏幕图标打开（PWA）时直接就是游戏模式
function launchedAsApp(){
  return window.navigator.standalone === true
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: standalone)').matches
      || new URLSearchParams(location.search).get('mode') === 'app';
}

// ───────────────────────── 开关局 ─────────────────────────

function restart(){
  clearSave();
  game.board = newBoard();
  game.bag = [];
  game.queue = [];
  game.hold = null;
  game.holdUsed = false;
  game.score = 0;
  game.lines = 0;
  game.level = 1;
  game.combo = -1;
  game.b2b = false;
  game.over = false;
  game.paused = false;
  game.frozen = false;
  game.started = true;
  particles.length = 0;
  clearing = null;
  softDropping = false;
  held.left = held.right = false;
  $('overlay').classList.remove('show');
  $('pauseBtn').textContent = '暂停';
  fillQueue();
  spawnNext();
  syncHud();
  lastFrame = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  sfx('hold');
}

function togglePause(){
  if (!game.started || game.over) return;
  game.paused = !game.paused;
  $('pauseBtn').textContent = game.paused ? '继续' : '暂停';
  const ov = $('overlay');
  if (game.paused){
    ov.dataset.mode = 'pause';
    ov.classList.add('show');
  } else {
    ov.classList.remove('show');
    lastFrame = performance.now();
  }
}

function toggleMute(){
  muted = !muted;
  syncMuteBtn();
  try { localStorage.setItem('tetris.muted.v1', muted ? '1' : '0'); } catch { /* 忽略 */ }
}

function syncMuteBtn(){
  const b = $('muteBtn');
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-label', muted ? '音效已关' : '音效已开');
  b.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

// ───────────────────────── 启动 ─────────────────────────

function init(){
  const savedSkin = readSkin();
  if (savedSkin) { skin.pal = savedSkin.pal; skin.style = savedSkin.style; }
  try { muted = localStorage.getItem('tetris.muted.v1') === '1'; } catch { /* 忽略 */ }
  game.board = newBoard();
  game.best = readBest();
  syncHud();
  fillQueue();
  layout();
  bindButtons();

  $('startBtn').addEventListener('click', restart);
  $('againBtn').addEventListener('click', restart);
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  $('restartBtn').addEventListener('click', restart);
  $('muteBtn').addEventListener('click', toggleMute);
  $('fsBtn').addEventListener('click', toggleGameMode);
  $('skinBtn').addEventListener('click', () => toggleStylePanel());
  $('skinDone').addEventListener('click', () => toggleStylePanel(false));
  $('styleSheet').addEventListener('click', (e) => { if (e.target.id === 'styleSheet') toggleStylePanel(false); });
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  // HOLD 框本身就是暂存按钮，手机上没地方再塞一个键
  const hs = $('holdSlot');
  hs.addEventListener('click', () => {
    if (game.started && !game.over && !game.paused) holdPiece();
  });
  hs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); holdPiece(); }
  });

  window.addEventListener('pagehide', saveGame);
  window.addEventListener('resize', layout);
  // 字体和外部 CSS 到位后容器尺寸会变，靠 observer 兜住，不然首帧棋盘是塌的
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe($('boardWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('load', layout);
  // iOS 转屏后尺寸要过一会儿才稳，补两次
  window.addEventListener('orientationchange', () => { setTimeout(layout, 120); setTimeout(layout, 450); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  // 切到后台自动暂停，回来不至于已经死了
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      saveGame();
      if (game.started && !game.over && !game.paused) togglePause();
    }
    if (!document.hidden && document.body.classList.contains('immersive')) keepAwake(true);
  });

  if (launchedAsApp()) { document.body.classList.add('immersive'); keepAwake(true); }
  syncFsBtn();
  syncMuteBtn();

  // 上次没打完的那局还在，就给个「接着玩」的入口
  const save = readSave();
  if (save){
    $('resumeScore').textContent = (save.score || 0).toLocaleString();
    $('overlay').classList.add('has-save');
    $('resumeSaveBtn').addEventListener('click', () => restoreGame(save));
  }

  $('overlay').dataset.mode = 'start';
  $('overlay').classList.add('show');
  draw();
}

// 调试出口：在控制台里能看棋盘和当前块，排查手感问题用
window.__tetris = { game, PIECES, cellsOf, collides, restart,
  dbg, peek: () => ({ clearing, grounded, lockTimer, dropTimer, frames: dbg.frames }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
