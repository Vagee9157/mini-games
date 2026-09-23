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
const mono = (c) => ({ mono: true, I:c, O:c, T:c, S:c, Z:c, J:c, L:c });

const PALETTES = {
  classic: { I:'#22d3ee', O:'#fbbf24', T:'#a855f7', S:'#4ade80', Z:'#f43f5e', J:'#3b82f6', L:'#fb923c' },
  clear:   { I:'#5ee7f5', O:'#f2c14e', T:'#a463dd', S:'#56c877', Z:'#e8546b', J:'#3f6fd0', L:'#ef8f4a' },
  // 单色：只看形状，不看颜色
  cyan:  mono('#4fd8e8'),   // 和界面同一个调子
  amber: mono('#f0b849'),   // 八十年代那种琥珀色单色显示器，暖、低蓝光
  paper: mono('#d5e0f2'),   // 月白，最接近线稿
  mint:  mono('#5fd99a'),   // 老绿屏终端的味道
};

const PAL_NAMES = {
  clear: '高区分', classic: '原配色',
  cyan: '青', amber: '琥珀', paper: '月白', mint: '薄荷',
};
const PAL_ORDER = ['clear', 'classic', 'cyan', 'amber', 'paper', 'mint'];

// 四种画法。gap 缝隙 / fill 填充压暗 / edge 描边提亮(0 不描) / lw 线宽 / rad 圆角 / ring 暗外圈
const STYLES = {
  gap:   { name:'标准',  gap:.055, fill:.14, edge:.30, lw:.07, rad:.20 },
  soft:  { name:'柔和',  gap:.06,  fill:.22, edge:.40, lw:.06, rad:.26 },
  ring:  { name:'暗圈',  gap:.045, fill:.14, edge:.32, lw:.07, rad:.20, ring:.40 },
  plain: { name:'纯色',  gap:.08,  fill:.10, edge:0,   lw:0,   rad:.22 },
};

const skin = { pal: 'clear', style: 'gap' };
function colorOf(type){ return type === GARBAGE ? '#93a4c4' : PALETTES[skin.pal][type]; }

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

// 下落速度按等级加快。
//
// Guideline 官方公式是 (0.8 - (lvl-1)×0.007)^(lvl-1) 秒一格，到 level 15 只剩 7ms，
// 那是给键盘玩家的，手机点按键跟不上；而且这里真正的压力来自底部升起的灰线，
// 下落速度只负责慢慢收紧思考时间，不需要陡。
//
// 等比曲线，15 个等级铺满「从顶落到底 20 秒 → 10 秒」：
//   间隔 = 1000ms × (500/1000)^((lvl-1)/14)
// 每升一级快约 4.8%，全程一共只快一倍，够平滑。
// 注意盘面堆高之后实际落距变短，同样的 level 手上时间会明显更少。
const MAX_LEVEL = 15;
// 每消几行升一级。按 10 行算的话满级要 140 行，模拟里普通玩家中位只消 54 行，
// 15 个等级有 9 级永远见不到；7 行一级能让他一局摸到 9 级，等级条走得动。
const LINES_PER_LEVEL = 7;
const FALL_TOP = 1000;   // level 1：一秒一格 = 满屏 20 秒
const FALL_END = 500;    // level 15：半秒一格 = 满屏 10 秒
function gravityFor(lvl){
  const t = (clamp(lvl, 1, MAX_LEVEL) - 1) / (MAX_LEVEL - 1);
  return FALL_TOP * Math.pow(FALL_END / FALL_TOP, t);
}

// 垃圾行。下落速度不变，所以「越玩越难」全靠这条线升得越来越快。
//
// 用指数衰减的曲线，不是按等级跳台阶：
//   周期 = MIN + (MAX - MIN) · e^(-t / TAU)
// 开局 30 秒一行，之后一路平滑压向 15 秒封顶，
// 不会出现「刚好卡在升级线上突然难一截」的断层。
//
// t 不是纯挂钟时间，而是 已玩时长 + 消行数 × 1.2 秒：
// 光苟着不消行也会慢慢变难，消得多则难度跟着进度走，两边都不亏。
const GARBAGE = 'X';
const G_MAX = 30000;     // 开局周期
const G_MIN = 15000;     // 压到这里就不再往下
const G_TAU = 240000;    // 衰减时间常数，越大掉得越慢
const G_LINE_BONUS = 1200;

function garbageClock(){
  return game.elapsed + game.lines * G_LINE_BONUS;
}
function garbagePeriod(){
  return G_MIN + (G_MAX - G_MIN) * Math.exp(-garbageClock() / G_TAU);
}

// ── 一次性清档 ──
// 改这个值（随便填个新字符串）= 每个人下次打开时清掉最高分和未完成的存档，
// 清完把新值写回本地，之后再刷新就不会再清，新成绩正常保存。
// 空字符串 = 不清任何东西。
// 只在记分规则变了、老分数变得够不着的时候才动它，别跟着每次发版改。
const WIPE_TOKEN = '';
const WIPE_KEY = 'tetris.wipe.v1';

const STORE_KEY = 'tetris.best.v1';
const BUZZ_KEY  = 'tetris.buzz.v1';
const MUSIC_KEY = 'tetris.music.v1';
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
let lastSaveAt = 0;
function saveGame(force){
  if (!game.started || game.over){ clearSave(); return; }
  // localStorage 是同步 I/O，连续落块时每次都写会拖帧
  const now = performance.now();
  if (!force && now - lastSaveAt < 1500) return;
  lastSaveAt = now;
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
      garbage: game.garbage,
      elapsed: game.elapsed,
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
  game.garbage = d.garbage || 0;
  game.elapsed = d.elapsed || 0;
  garbageTimer = 0;
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
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;
  fillQueue();
  if (!game.piece) spawnNext();
  $('overlay').classList.remove('show');
  $('pauseBtn').textContent = '暂停';
  syncHud();
  lastFrame = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  syncMusic();
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
  garbage: 0,         // 一共升起过几行
  elapsed: 0,         // 实际推进过的毫秒（暂停、消行动画不算），灰线提速看它
  started: false,
  lastRotKick: -1,    // 最近一次旋转用了第几个踢墙偏移，判 T-spin 用
  lastWasRot: false,
};

const dbg = { frames: 0, layouts: 0 };
let garbageTimer = 0;
let lockStep = -1;          // 落地渐白只分几档，省掉大部分重绘
let dropTimer = 0;
let lockTimer = 0;
let lockResets = 0;
let grounded = false;
let softDropping = false;
let lastFrame = 0;
let lastDrawAt = 0;
let rafId = 0;

// 消行动画：记下正在闪的行，动画走完才真正塌陷
let clearing = null;   // { rows:[], t:0, dur:260 }
// 落地/消行时迸的粒子
const particles = [];
let hardLocking = false;   // 硬降那一下已经炸过粒子了，锁定时别再叠一层

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
  previewDirty = true;
  needsDraw = true;
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
  if (collides(p.type, p.x, p.y, p.rot)){ endGame(); return; }

  // IHS 优先于 IRS：按住暂存键就先换块，否则按住旋转键就先转好
  if (!armPre) return;
  armPre = false;
  if (preHeld.hold && !game.holdUsed){ holdPiece(); return; }
  if (preHeld.cw) tryRotate(1);
  else if (preHeld.ccw) tryRotate(-1);
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
  needsDraw = true;
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
      needsDraw = true;
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
  needsDraw = true;
  burst(p, 1.4);
  hardLocking = true;
  lockPiece();
  hardLocking = false;
  sfx('drop');
  buzz(14);
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
  previewDirty = true;
  needsDraw = true;
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
  if (!hardLocking) burstLand(p);
  stampToStatic(p);        // 只补这一块，不整盘重画
  game.piece = null;
  needsDraw = true;

  // 找满行
  const full = [];
  for (let y = 0; y < TOTAL_ROWS; y++){
    if (game.board[y].every(c => c)) full.push(y);
  }

  // 消完这几行之后整个盘就空了 = 全消，Guideline 里给大额奖励
  const perfect = full.length > 0 &&
    game.board.every((row, y) => full.includes(y) || row.every(c => !c));
  scoreFor(full.length, spin, perfect);

  if (full.length){
    clearing = { rows: full, t: 0, dur: 260 };
    for (const y of full) burstRow(y);
    sfx(full.length === 4 ? 'tetris' : 'clear');
    flashBoard(full.length);
    buzz(full.length >= 4 ? [30, 40, 70] : 18 + full.length * 8);
  } else {
    sfx('lock');
    // 锁在隐藏区之上 = 顶出局
    const topOut = cellsOf(p.type, p.rot).every(([, cy]) => p.y + cy < BUFFER);
    if (topOut) endGame(); else { armPre = true; spawnNext(); saveGame(); }
  }
}

// 等级加成。原来是直接 × level，1 级到 15 级差 15 倍，
// 高手「消得多」和「倍率高」两头相乘，分数差被放大到实力差的四倍。
// 改成半速增长：level 15 是 8 倍，等级仍然值钱，但前期的分不至于白打。
function levelMult(lvl){ return 1 + (lvl - 1) * .5; }

function scoreFor(n, spin, perfect){
  const mult = levelMult(game.level);
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

  // 全消：Guideline 给的分比一次 Tetris 还高，而且很难碰上，值得给个大的
  if (perfect){
    base += [0, 800, 1200, 1800, 2000][n] || 800;
    label = '全消 PERFECT CLEAR';
    buzz([40, 50, 60, 50, 90]);
  }

  game.score += Math.round(base * mult);

  if (n > 0){
    game.lines += n;
    const newLevel = Math.min(MAX_LEVEL, Math.floor(game.lines / LINES_PER_LEVEL) + 1);
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
  staticDirty = true;
  needsDraw = true;
}

// 底部塞一行带缺口的灰线，整盘往上顶一格
function riseGarbage(){
  if (game.board[0].some(Boolean)){ endGame(); return; }   // 顶出去了
  game.board.shift();
  const row = new Array(COLS).fill(GARBAGE);
  row[(Math.random() * COLS) | 0] = null;                   // 留个缺口，不然没法消
  game.board.push(row);
  game.garbage++;

  const p = game.piece;
  if (p){
    if (!collides(p.type, p.x, p.y - 1, p.rot)) p.y--;      // 方块跟着上移
    else if (collides(p.type, p.x, p.y, p.rot)){ endGame(); return; }
  }
  staticDirty = true;
  needsDraw = true;
  sfx('lock');
}

function endGame(){
  game.over = true;
  game.piece = null;
  particles.length = 0;
  staticDirty = true;
  needsDraw = true;
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
  buzz([90, 60, 90, 60, 160]);
  syncMusic();
}

// ───────────────────────── 画面 ─────────────────────────

const canvas = $('board');
const ctx = canvas.getContext('2d');
const nextCv = $('nextCv');
const nextCtx = nextCv.getContext('2d');
const holdCv = $('holdCv');
const holdCtx = holdCv.getContext('2d');

let CELL = 30;   // 实际由 layout() 按容器算

// 已经落地的方块和格线画进这张离屏图，只有棋盘真的变了才重画。
// 不这么做的话，每帧要画两百多个圆角矩形＋描边，手机会烫。
const bgCv = document.createElement('canvas');
const bgCtx = bgCv.getContext('2d');
let staticDirty = true;     // 棋盘内容变了
let previewDirty = true;    // NEXT / HOLD 变了
let needsDraw = true;       // 这一帧到底要不要重画
let hudCache = '';

function layout(){
  dbg.layouts++;
  // 1.75 已经够锐，比 2 少三成像素，手机上省不少
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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

  bgCv.width = canvas.width;
  bgCv.height = canvas.height;
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;

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
  const { ghost = false, alpha = 1, garbage = false, glow = 0 } = opts;
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

  if (garbage){
    // 底部顶上来的灰线：虚线框 + 很淡的填充，一眼能和自己的方块分开
    c.fillStyle = 'rgba(150,170,205,.30)';
    roundRect(c, x, y, d, d, R);
    c.fill();
    c.strokeStyle = 'rgba(205,218,242,.62)';
    c.lineWidth = Math.max(1, d * .075);
    c.setLineDash([Math.max(2.5, d * .22), Math.max(2, d * .16)]);
    roundRect(c, x + c.lineWidth / 2, y + c.lineWidth / 2, d - c.lineWidth, d - c.lineWidth, Math.max(0, R - 1));
    c.stroke();
    c.setLineDash([]);
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
  // 单色时相邻方块颜色一样，没有描边就糊成一片，所以强制给一道
  const isMono = PALETTES[skin.pal].mono;
  const edge = v.edge || (isMono ? .38 : 0);
  const elw  = v.lw   || (isMono ? .07 : 0);
  if (edge){
    const lw = Math.max(1, d * elw), o = off + lw / 2;
    c.strokeStyle = mix(color, isMono ? '#05080f' : '#ffffff', isMono ? .42 : edge);
    c.lineWidth = lw;
    roundRect(c, x + o, y + o, d - o * 2, d - o * 2, Math.max(0, R - o));
    c.stroke();
  }

  // 贴底待锁定：沿边一圈同色光边 + 外扩辉光，越接近锁定越亮越粗。
  // 不动填充色，方块是什么颜色一眼还是认得出来。
  if (glow > 0){
    const lw = Math.max(1.5, d * (.05 + .06 * glow));
    c.globalAlpha = alpha * (.30 + .50 * glow);
    c.strokeStyle = mix(color, '#ffffff', .38);
    c.lineWidth = lw;
    c.shadowColor = color;
    c.shadowBlur = d * .45 * glow;
    roundRect(c, x + lw / 2, y + lw / 2, d - lw, d - lw, Math.max(0, R - lw / 2));
    c.stroke();
    c.shadowBlur = 0;
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

// 刚锁定的方块直接盖到静态层上，省掉一次满盘重画。
// 满盘时全量重画是 150 格 × (fill+stroke)，落一块就来一次，很费。
function stampToStatic(p){
  if (staticDirty) return;          // 反正马上要全量重画了
  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy;
    if (by < BUFFER) continue;
    drawCell(bgCtx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, colorOf(p.type));
  }
}

// 格线 + 已落地的方块，画一次存着用
function drawStatic(){
  const W = CELL * COLS, H = CELL * ROWS;
  bgCtx.clearRect(0, 0, W, H);

  bgCtx.save();
  bgCtx.strokeStyle = 'rgba(120,160,255,.09)';
  bgCtx.lineWidth = 1;
  bgCtx.beginPath();
  for (let x = 1; x < COLS; x++){ bgCtx.moveTo(x * CELL + .5, 0); bgCtx.lineTo(x * CELL + .5, H); }
  for (let y = 1; y < ROWS; y++){ bgCtx.moveTo(0, y * CELL + .5); bgCtx.lineTo(W, y * CELL + .5); }
  bgCtx.stroke();
  bgCtx.restore();

  for (let y = BUFFER; y < TOTAL_ROWS; y++){
    const row = game.board[y];
    for (let x = 0; x < COLS; x++){
      const t = row[x];
      if (!t) continue;
      drawCell(bgCtx, x * CELL, (y - BUFFER) * CELL, CELL, colorOf(t), { garbage: t === GARBAGE });
    }
  }
  staticDirty = false;
}

function draw(){
  const W = CELL * COLS, H = CELL * ROWS;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  if (staticDirty) drawStatic();
  ctx.drawImage(bgCv, 0, 0, W, H);

  if (clearing){
    // 消行动画：不重画整盘，只在要消掉的那几行盖一层白光。
    // 原来逐格混色，满盘时每帧一百多个圆角矩形，纯属浪费。
    const flash = 1 - clearing.t / clearing.dur;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${(.06 + .26 * flash).toFixed(3)})`;
    for (const y of clearing.rows){
      if (y < BUFFER) continue;
      ctx.fillRect(0, (y - BUFFER) * CELL, W, CELL);
    }
    ctx.restore();
  }

  // 落点虚影 + 当前方块
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
    // 快锁定的提示：以前是整块洗白，颜色全丢了，现在改成同色光边
    const lockPulse = grounded ? Math.min(4, (lockTimer / LOCK_DELAY * 5) | 0) / 4 : 0;
    for (const [cx, cy] of cellsOf(p.type, p.rot)){
      const by = p.y + cy;
      if (by < BUFFER) continue;
      drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, color, { glow: lockPulse });
    }
  }

  if (particles.length) drawParticles();

  // 底边那道线：满了就从下面顶一行灰线上来
  if (game.started && !game.over){
    const prog = clamp(garbageTimer / garbagePeriod(), 0, 1);
    if (prog > 0){
      ctx.fillStyle = prog > .82 ? 'rgba(244,63,94,.75)' : 'rgba(150,175,215,.4)';
      ctx.fillRect(0, H - 2, W * prog, 2);
    }
  }

  if (previewDirty){ drawPreview(); previewDirty = false; }
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
    for (let i = 0; i < 2; i++){
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

// 自然落地的一点扬尘，只从方块每一列的最底下那格冒出来
function burstLand(p){
  const color = colorOf(p.type);
  const bottom = new Map();
  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    if (!bottom.has(cx) || cy > bottom.get(cx)) bottom.set(cx, cy);
  }
  for (const [cx, cy] of bottom){
    const by = p.y + cy;
    if (by < BUFFER) continue;
    for (let i = 0; i < 2; i++){
      particles.push({
        x: (p.x + cx + .5 + (Math.random() - .5) * .7) * CELL,
        y: (by - BUFFER + 1) * CELL,
        vx: (Math.random() - .5) * 70,
        vy: Math.random() * -55 - 15,
        life: .55, color, size: CELL * .11,
      });
    }
  }
}

function burstRow(y){
  if (y < BUFFER) return;
  for (let x = 0; x < COLS; x++){
    const t = game.board[y][x];
    const color = t ? colorOf(t) : '#ffffff';
    for (let i = 0; i < 2; i++){
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
    q.life -= dt / 460;
    if (q.life <= 0){ particles.splice(i, 1); continue; }
    q.x += q.vx * dt / 1000;
    q.y += q.vy * dt / 1000;
    q.vy += 520 * dt / 1000;
  }
  if (particles.length > 160) particles.splice(0, particles.length - 160);
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
  const key = game.score + '/' + game.lines + '/' + game.level + '/' + game.best;
  if (key === hudCache) return;         // 每帧写 DOM 很浪费
  hudCache = key;
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
// 回到最早那版：一次一个振荡器，简单干脆。
// 音量整体压低、锯齿换三角波，存在感弱一点，也省电。

let actx = null;
let muted = false;
let buzzOn = true;

// 手机上的触感反馈。桌面浏览器没有 vibrate，静默跳过。
function buzz(pattern){
  if (!buzzOn) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 忽略 */ }
}

// 每个音效一到两层。手机外放喇叭放不出 300Hz 以下的东西，
// 原来 lock 150Hz、drop 190→85Hz 在电脑上听得见，到 iPhone 上就是没声音。
// 所以基频全部抬进 300Hz 以上，低频那口"闷"改用一层高频 click 来代替。
const SPECS = {
  rotate: [{ f: 640,  to: 790, d: .045, v: .070, type: 'triangle' }],
  lock:   [{ f: 320,  to: 230, d: .060, v: .055, type: 'triangle' },
           { f: 940,  to: 720, d: .022, v: .028, type: 'sine' }],
  // 落底要有"砸实"的感觉：一层下沉的身子 + 一层短促的撞击
  drop:   [{ f: 440,  to: 165, d: .105, v: .120, type: 'triangle' },
           { f: 1450, to: 620, d: .032, v: .050, type: 'square' }],
  clear:  [{ f: 620,  to: 940, d: .150, v: .075, type: 'sine' }],
  tetris: [{ f: 520,  to: 1240, d: .26, v: .100, type: 'triangle' },
           { f: 784,  to: 1568, d: .24, v: .040, type: 'sine', delay: .045 }],
  level:  [{ f: 680,  to: 1020, d: .16, v: .065, type: 'sine' }],
  hold:   [{ f: 470,  to: 560, d: .055, v: .050, type: 'sine' }],
  over:   [{ f: 520,  to: 150, d: .60,  v: .085, type: 'triangle' }],
};

// iOS 上 AudioContext 只能在用户手势里创建/恢复，否则一直 suspended、永远没声。
// 所以第一次触碰屏幕就把它开起来，不等第一个音效。
function unlockAudio(){
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* 不给就算了 */ }
}

// 音效总音量。手机外放偏小，之前那一档在车厢、路上基本听不见。
const SFX_GAIN = 1.9;

function sfx(kind){
  if (muted) return;
  const layers = SPECS[kind];
  if (!layers) return;
  try {
    unlockAudio();
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    for (const spec of layers){
      const t = t0 + (spec.delay || 0);
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.connect(g); g.connect(actx.destination);
      o.type = spec.type;
      o.frequency.setValueAtTime(spec.f, t);
      o.frequency.exponentialRampToValueAtTime(spec.to, t + spec.d);
      // 直接 setValueAtTime 会"啪"一下削波，给 4ms 的起音更干净
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.min(.9, spec.v * SFX_GAIN), t + .004);
      g.gain.exponentialRampToValueAtTime(.0001, t + spec.d);
      o.start(t);
      o.stop(t + spec.d + .02);
    }
  } catch { /* 浏览器不给声音就静音运行 */ }
}

// ───────────────────────── 背景音乐 ─────────────────────────

// 《Korobeiniki》，1861 年的俄罗斯民谣，公有领域。这里是自己合成的版本，
// 不加载任何音频文件——离线能放，也不占缓存。
// 时值单位是八分音符；0 表示休止。
const BPM = 170;
const EIGHTH = 60 / BPM / 2;

const A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, GS5 = 80;
const A3 = 57, B3 = 59, C4 = 60, D4 = 62, E4 = 64, GS4 = 68;
// 低音也得待在手机喇叭放得出来的区间：A2 才 110Hz，外放等于没有，
// 整条低音线往上挪一个八度。
const A2 = 57, E2 = 52, D3 = 62;

const MELODY = [
  // A 段
  [E5,2],[B4,1],[C5,1],[D5,2],[C5,1],[B4,1],
  [A4,2],[A4,1],[C5,1],[E5,2],[D5,1],[C5,1],
  [B4,3],[C5,1],[D5,2],[E5,2],
  [C5,2],[A4,2],[A4,4],
  [D5,3],[F5,1],[A5,2],[G5,1],[F5,1],
  [E5,3],[C5,1],[E5,2],[D5,1],[C5,1],
  [B4,2],[B4,1],[C5,1],[D5,2],[E5,2],
  [C5,2],[A4,2],[A4,4],
  // B 段：低一个八度的长音
  [E4,4],[C4,4],
  [D4,4],[B3,4],
  [C4,4],[A3,4],
  [GS4,4],[B3,3],[0,1],
  [E4,4],[C4,4],
  [D4,4],[B3,4],
  [C4,4],[E4,4],
  [A4,4],[GS4,4],
];

// 每小节的低音根音，一小节 8 个八分
const BASS = [A2,A2,E2,A2,D3,A2,E2,A2, A2,A2,A2,E2,A2,A2,A2,E2];

let musicOn = true;
let musicGain = null;     // 音乐总线，暂停时淡出
let mTimer = 0;           // 调度器
let mAt = 0;              // 下一个音符的绝对时间
let mIdx = 0;             // 走到旋律第几个音
let mBar = 0;             // 走到第几小节（给低音用）
let mBeat = 0;            // 当前小节内走了几个八分

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function musicBus(){
  if (!musicGain){
    musicGain = actx.createGain();
    musicGain.gain.value = 0;
    // 方波直接出来太扎耳朵，过一道低通削掉高次谐波，剩下老掌机那种闷闷的味道
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    lp.Q.value = .4;
    musicGain.connect(lp);
    lp.connect(actx.destination);
  }
  return musicGain;
}

// 一个音：主音 + 低五度的薄薄一层，听着不那么单薄
function playNote(m, t, dur, kind){
  const bus = musicBus();
  // 音尾收得早 = 断奏，比拖满音符时值轻快得多
  const cfg = kind === 'bass'
    ? { type: 'triangle', v: .100, rel: .55 }
    : { type: 'square',   v: .062, rel: .52 };
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = cfg.type;
  o.frequency.setValueAtTime(midi(m), t);
  o.connect(g); g.connect(bus);
  const hold = Math.max(.045, dur * cfg.rel);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(cfg.v, t + .012);
  g.gain.exponentialRampToValueAtTime(.0001, t + hold);
  o.start(t);
  o.stop(t + hold + .02);
}

// 提前 0.35 秒排好后面的音，setInterval 抖动就不会听出来
function scheduleMusic(){
  if (!actx || actx.state !== 'running') return;
  const ahead = actx.currentTime + .35;
  let guard = 0;
  while (mAt < ahead && guard++ < 64){
    const [note, len] = MELODY[mIdx];
    if (note) playNote(note, mAt, len * EIGHTH, 'lead');
    // 低音走「根音—五度」的蹦跳型，一小节四下，比压两个长根音跳脱
    for (let k = 0; k < len; k++){
      const pos = (mBeat + k) % 8;
      if (pos % 2 === 0){
        const bar = (mBar + ((mBeat + k) / 8 | 0)) % BASS.length;
        const root = BASS[bar];
        playNote(pos % 4 === 0 ? root : root + 7, mAt + k * EIGHTH, EIGHTH * 1.1, 'bass');
      }
    }
    mAt += len * EIGHTH;
    mBeat += len;
    while (mBeat >= 8){ mBeat -= 8; mBar = (mBar + 1) % BASS.length; }
    mIdx = (mIdx + 1) % MELODY.length;
  }
}

function musicStart(){
  if (!musicOn || muted) return;
  unlockAudio();
  if (!actx || actx.state !== 'running') return;
  const bus = musicBus();
  bus.gain.cancelScheduledValues(actx.currentTime);
  bus.gain.setValueAtTime(Math.max(.0001, bus.gain.value), actx.currentTime);
  bus.gain.linearRampToValueAtTime(.42, actx.currentTime + .5);
  if (mTimer) return;
  mAt = actx.currentTime + .12;
  scheduleMusic();
  mTimer = setInterval(scheduleMusic, 120);
}

function musicStop(fade = .35){
  if (musicGain && actx){
    const t = actx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(Math.max(.0001, musicGain.gain.value), t);
    musicGain.gain.linearRampToValueAtTime(.0001, t + fade);
  }
  if (mTimer){ clearInterval(mTimer); mTimer = 0; }
}

// 只在真正开着局、没暂停、没静音的时候放
function syncMusic(){
  const want = musicOn && !muted && game.started && !game.over && !game.paused && !document.hidden;
  if (want) musicStart(); else musicStop();
  const b = $('musicBtn');
  if (b){
    b.textContent = musicOn ? '音乐：开' : '音乐：关';
    b.classList.toggle('off', !musicOn);
  }
}

function toggleMusic(){
  musicOn = !musicOn;
  try { localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'); } catch { /* 忽略 */ }
  syncMusic();
}

// ───────────────────────── 主循环 ─────────────────────────

function tick(now){
  rafId = requestAnimationFrame(tick);
  dbg.frames++;
  const dt = Math.min(now - lastFrame, 100);   // 切后台回来不要瞬移
  lastFrame = now;
  if (game.paused || game.over || game.frozen){
    draw();
    needsDraw = false;
    cancelAnimationFrame(rafId);      // 停着就别空转了，恢复时再拉起来
    rafId = 0;
    return;
  }

  stepParticles(dt);
  handleAutoRepeat(dt);

  // 灰线倒计时（消行动画期间不推进，免得叠在一起）
  if (!clearing && game.piece){
    game.elapsed += dt;
    garbageTimer += dt;
    const period = garbagePeriod();
    if (garbageTimer >= period){
      garbageTimer -= period;
      riseGarbage();
    }
  }

  // 消行动画播完再塌陷
  if (clearing){
    clearing.t += dt;
    if (clearing.t >= clearing.dur){
      applyClear(clearing.rows);
      clearing = null;
      armPre = true;
      spawnNext();
      saveGame();
    }
    draw();
    return;
  }

  if (game.piece){
    const g = gravityFor(game.level);
    const speed = softDropping ? g / SOFT_DROP_FACTOR : g;
    dropTimer += dt;
    while (dropTimer >= speed){
      dropTimer -= speed;
      if (!collides(game.piece.type, game.piece.x, game.piece.y + 1, game.piece.rot)){
        game.piece.y++;
        game.lastWasRot = false;
        needsDraw = true;
        if (softDropping) game.score++;
      } else break;
    }
    touchGround(false);
    if (grounded){
      lockTimer += dt;
      const step = Math.min(4, (lockTimer / LOCK_DELAY * 5) | 0);
      if (step !== lockStep){ lockStep = step; needsDraw = true; }
      if (lockTimer >= LOCK_DELAY) lockPiece();
    } else lockStep = -1;
  }

  syncHud();

  // 方块匀速往下掉的时候，一秒里其实只有一帧画面变了。
  // 没变就别画——这是手机发烫的主因。
  // 逻辑跑满 60，画面限到 30——这个游戏看不出差别，功耗直接减半
  if ((needsDraw || particles.length || clearing) && now - lastDrawAt >= 32){
    draw();
    lastDrawAt = now;
    needsDraw = false;
  }
}

// ───────────────────────── 输入 ─────────────────────────

const held = { left: false, right: false };
// 按住旋转 / 暂存键的时候下一块正好出来，就让它带着这个动作出场（IRS / IHS）。
// 连着摆块的时候手感顺很多，标准实现都有。
const preHeld = { cw: false, ccw: false, hold: false };
let armPre = false;    // 只有「锁定后自动出的那一块」才吃 IRS/IHS
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
    case 'cw':    preHeld.cw = true;  tryRotate(1); break;
    case 'ccw':   preHeld.ccw = true; tryRotate(-1); break;
    case 'hard':  hardDrop(); break;
    case 'hold':  preHeld.hold = true; holdPiece(); break;
  }
}, { passive: false });

window.addEventListener('keyup', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  if (act === 'left')  release('left');
  if (act === 'right') release('right');
  if (act === 'soft')  softDropping = false;
  if (act === 'cw')    preHeld.cw = false;
  if (act === 'ccw')   preHeld.ccw = false;
  if (act === 'hold')  preHeld.hold = false;
});

// 底部按钮：按住能连发
function bindButtons(){
  const map = [
    ['btnLeft',  () => press('left'),   () => release('left')],
    ['btnRight', () => press('right'),  () => release('right')],
    ['btnCw',    () => { preHeld.cw = true; tryRotate(1); }, () => { preHeld.cw = false; }],
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

  PAL_ORDER.forEach((k) => {
    const label = PAL_NAMES[k] || k;
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
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;
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
  needsDraw = true;
  if (!show) resumeLoop();
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

// 循环停过之后重新拉起来
function resumeLoop(){
  lastFrame = performance.now();
  lastDrawAt = 0;
  if (!rafId) rafId = requestAnimationFrame(tick);
}

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
  game.garbage = 0;
  game.elapsed = 0;
  garbageTimer = 0;
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;
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
  syncMusic();
}

function togglePause(){
  if (!game.started || game.over) return;
  game.paused = !game.paused;
  $('pauseBtn').textContent = game.paused ? '继续' : '暂停';
  const ov = $('overlay');
  if (game.paused){
    ov.dataset.mode = 'pause';
    ov.classList.add('show');
    needsDraw = true;
  } else {
    ov.classList.remove('show');
    resumeLoop();
  }
  syncMusic();
}

function toggleMute(){
  muted = !muted;
  syncMuteBtn();
  syncMusic();
  try { localStorage.setItem('tetris.muted.v1', muted ? '1' : '0'); } catch { /* 忽略 */ }
}

function syncMuteBtn(){
  const b = $('muteBtn');
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-label', muted ? '音效已关' : '音效已开');
  b.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

// ───────────────────────── 启动 ─────────────────────────

// 返回「这次真的清掉了一个成绩」，只有那样才值得弹提示
function applyWipe(){
  if (!WIPE_TOKEN) return false;
  try {
    if (localStorage.getItem(WIPE_KEY) === WIPE_TOKEN) return false;
    const had = parseInt(localStorage.getItem(STORE_KEY) || '0', 10) || 0;
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(WIPE_KEY, WIPE_TOKEN);
    return had > 0;
  } catch { return false; }   // 隐私模式下读写都会抛，那就当没这回事
}

function init(){
  const wiped = applyWipe();
  const savedSkin = readSkin();
  if (savedSkin) { skin.pal = savedSkin.pal; skin.style = savedSkin.style; }
  try {
    muted = localStorage.getItem('tetris.muted.v1') === '1';
    buzzOn = localStorage.getItem(BUZZ_KEY) !== '0';
    musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
  } catch { /* 忽略 */ }
  game.board = newBoard();
  game.best = readBest();
  syncHud();
  fillQueue();
  layout();
  bindButtons();

  // 任何一次触碰都先把音频上下文拉起来（iOS 必须在手势里做）
  for (const ev of ['pointerdown', 'touchstart', 'keydown']){
    window.addEventListener(ev, () => { unlockAudio(); syncMusic(); }, { once: true, passive: true });
  }

  const mb = $('musicBtn');
  if (mb) mb.addEventListener('click', toggleMusic);
  syncMusic();

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
  const bz = $('buzzBtn');
  if (bz){
    const syncBuzz = () => {
      bz.textContent = buzzOn ? '震动：开' : '震动：关';
      bz.classList.toggle('off', !buzzOn);
      bz.hidden = !('vibrate' in navigator);     // 电脑上没这功能，直接不显示
    };
    bz.addEventListener('click', () => {
      buzzOn = !buzzOn;
      try { localStorage.setItem(BUZZ_KEY, buzzOn ? '1' : '0'); } catch { /* 忽略 */ }
      syncBuzz();
      if (buzzOn) buzz(20);
    });
    syncBuzz();
  }

  const hs = $('holdSlot');
  hs.addEventListener('click', () => {
    if (game.started && !game.over && !game.paused) holdPiece();
  });
  hs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); holdPiece(); }
  });

  window.addEventListener('pagehide', () => { saveGame(true); musicStop(0); });
  window.addEventListener('resize', layout);
  // 字体和外部 CSS 到位后容器尺寸会变，靠 observer 兜住，不然首帧棋盘是塌的
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe($('boardWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('load', layout);
  // 分数被清掉的话说一声，不然用户以为成绩自己丢了
  if (wiped) setTimeout(() => showToast('记分规则已更新，最高分重新开始'), 600);
  // iOS 转屏后尺寸要过一会儿才稳，补两次
  window.addEventListener('orientationchange', () => { setTimeout(layout, 120); setTimeout(layout, 450); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  // 切到后台自动暂停，回来不至于已经死了
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      saveGame(true);
      if (game.started && !game.over && !game.paused) togglePause();
    }
    if (!document.hidden && document.body.classList.contains('immersive')) keepAwake(true);
    syncMusic();
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
window.__tetris = { game, PIECES, cellsOf, collides, restart, riseGarbage, garbagePeriod, garbageClock, gravityFor, MAX_LEVEL,
  dbg, peek: () => ({ clearing, grounded, lockTimer, dropTimer, frames: dbg.frames, layouts: dbg.layouts, needsDraw, staticDirty, previewDirty, parts: particles.length }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
