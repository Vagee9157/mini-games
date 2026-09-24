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
  // 原版：Tetris Guideline 规定的七色，街机厅里那套。
  // 纯 #0000F0 在深色底上太沉，J 往上提了一点，其余照搬。
  guide:   { I:'#00f0f0', O:'#f0f000', T:'#a000f0', S:'#00f000', Z:'#f00000', J:'#2b3df0', L:'#f0a000' },
  // 马卡龙：同一套色相，明度拉高饱和度压低，久看不刺眼
  candy:   { I:'#7fe3e8', O:'#f5d77a', T:'#c49be8', S:'#93dda1', Z:'#f2938f', J:'#8faee8', L:'#f0b87e' },
  // 单色：只看形状，不看颜色
  cyan:  mono('#4fd8e8'),   // 和界面同一个调子
  mint:  mono('#5fd99a'),   // 老绿屏终端的味道
};

const PAL_NAMES = {
  clear: '高区分', classic: '霓虹', guide: '原版', candy: '马卡龙',
  cyan: '青', mint: '薄荷',
};
const PAL_ORDER = ['clear', 'classic', 'guide', 'candy', 'cyan', 'mint'];

// 四种画法。gap 缝隙 / fill 填充压暗 / edge 描边提亮(0 不描) / lw 线宽 / rad 圆角 / ring 暗外圈
const STYLES = {
  gap:   { name:'标准',  gap:.055, fill:.14, edge:.30, lw:.07, rad:.20 },
  soft:  { name:'柔和',  gap:.06,  fill:.22, edge:.40, lw:.06, rad:.26 },
  ring:  { name:'暗圈',  gap:.045, fill:.14, edge:.32, lw:.07, rad:.20, ring:.40 },
  plain: { name:'纯色',  gap:.08,  fill:.10, edge:0,   lw:0,   rad:.22 },
};

const skin = { pal: 'clear', style: 'plain' };
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
// 等比曲线，20 个等级铺满「从顶落到底 20 秒 → 8 秒」：
//   间隔 = 1000ms × (400/1000)^((lvl-1)/19)
// 每升一级快约 4.7%，跟原来 15 级那条几乎同一斜率，前中段手感不变，
// 只是在顶上多接了五级。注意盘面堆高之后实际落距变短，
// 同样的 level 手上时间会明显更少。
const MAX_LEVEL = 20;
// 每消几行升一级。等级 = 消行数/9 + 1，所以满级（20 级）要 19×9 = 171 行。
// 7 行一级的时候熟练玩家 95% 的局都能满级，等级系统对他们等于不存在；
// 提到 9 行之后满级重新变成「打得好才摸得到」。
const LINES_PER_LEVEL = 9;
const FALL_TOP = 1000;   // level 1：一秒一格 = 满屏 20 秒
const FALL_END = 400;    // level 20：满屏 8 秒
function gravityFor(lvl){
  const t = (clamp(lvl, 1, MAX_LEVEL) - 1) / (MAX_LEVEL - 1);
  return FALL_TOP * Math.pow(FALL_END / FALL_TOP, t);
}

// 垃圾行。下落速度不变，所以「越玩越难」全靠这条线升得越来越快。
//
// 用指数衰减的曲线，不是按等级跳台阶：
//   周期 = MIN + (MAX - MIN) · e^(-t / TAU)
// 开局 45 秒一行，之后一路平滑压向 15 秒封顶，全程 3 倍落差。
// 两头都得留够距离：只提封顶不提开局的话曲线会压扁成「每 27 秒恒定来一行」，
// 难度爬升就没了；只提开局不收尾段的话后期躺平，一局能拖到十分钟以上。
// 不会出现「刚好卡在升级线上突然难一截」的断层。
//
// G_LINE_BONUS 曾经是 1200（每消一行给难度钟多推 1.2 秒），现在设 0。
// 模拟发现它专门惩罚打得好的人：熟练档一局消 150 行，等于白送难度钟 180 秒，
// 越会玩、灰线来得越凶。去掉之后难度钟就是纯已玩时长，对谁都一样。
const GARBAGE = 'X';
const G_MAX = 45000;     // 开局周期
const G_MIN = 15000;     // 压到这里就不再往下
const G_TAU = 300000;    // 衰减时间常数，越大掉得越慢
const G_LINE_BONUS = 0;      // 消行不再推快难度钟

// 满级（20 级）之后的加压：每再升一级，灰线周期再收 3%，没有上限。
// 不加这条的话三条难度线全有天花板，15 分钟之后难度就是一条水平线，
// 实测接近满分的 AI 能连打 100 分钟不死（12000 块上限都撑得到）。
// 挂在消行数上而不是时间上：能活过 171 行的人必然在持续消行，
// 等于「打得越好压得越快」—— 这条反向激励只在满级之后才生效。
const G_OVER_RATE = .97;
const G_HARD_MIN = 1000;     // 再快也不低于 1 秒：到这份上谁都必死，
                             // 而且一帧塞进好几行会直接卡死

function garbageClock(){
  return game.elapsed + game.lines * G_LINE_BONUS;
}
function garbagePeriod(){
  let p = G_MIN + (G_MAX - G_MIN) * Math.exp(-garbageClock() / G_TAU);
  const over = game.level - MAX_LEVEL;
  if (over > 0) p *= Math.pow(G_OVER_RATE, over);
  return Math.max(G_HARD_MIN, p);
}

// ── 一次性清档 ──
// 改这个值（随便填个新字符串）= 每个人下次打开时清掉最高分和未完成的存档，
// 清完把新值写回本地，之后再刷新就不会再清，新成绩正常保存。
// 空字符串 = 不清任何东西。
// 只在记分规则变了、老分数变得够不着的时候才动它，别跟着每次发版改。
const WIPE_TOKEN = '2026-09-23-level20';
const WIPE_KEY = 'tetris.wipe.v1';

// 棋盘边框的「温度」。等级越高越往热的一头走：青 → 绿 → 琥珀 → 橙 → 红 → 品红，
// 同时描边更粗、辉光更亮更散。满级之后换成常亮脉动的光环。
const EDGE_STOPS = [
  [1,  '#22d3ee'],
  [5,  '#3ee0a6'],
  [9,  '#f0c24a'],
  [13, '#ff9442'],
  [17, '#ff5470'],
  [20, '#ff3ec8'],
];

const STORE_KEY = 'tetris.best.v1';
const BUZZ_KEY  = 'tetris.buzz.v1';
const MUSIC_KEY = 'tetris.music.v1';
const SKIN_KEY  = 'tetris.skin.v1';
const SAVE_KEY  = 'tetris.save.v1';

// ───────────────────────── 工具 ─────────────────────────

const $ = (id) => document.getElementById(id);

// 玩法随机和特效随机分成两条流，不要合并。
// 合成一条的话，同一个种子下「开音效」和「静音」会洗出不同的袋 ——
// 因为静音时 sfx 直接 return，根本不消耗噪声那两次 random，A/B 对比就废了。
// 粒子数量也随局面变化（burstLand 按方块底边格数），同理。
// rndGame 只管 7-bag 洗牌和灰线缺口这两处真正影响结果的；没设种子时退回 Math.random。
let gameSeed = 0;
function setSeed(v){ gameSeed = (v | 0) || 0; }
function rndGame(){
  if (!gameSeed) return Math.random();
  gameSeed = (gameSeed + 0x6D2B79F5) | 0;          // mulberry32
  let t = Math.imul(gameSeed ^ (gameSeed >>> 15), 1 | gameSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rndFx = () => Math.random();
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
  syncEdge();
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
  $('pauseTx').textContent = '暂停';
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
    const j = (rndGame() * (i + 1)) | 0;
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
  if (collides(p.type, p.x, p.y, p.rot)){ endGame('出生撞死'); return; }

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
  // 声音和震动排在最前面。后面的炸粒子、锁方块、写存档加起来能有好几毫秒，
  // 排在它们后头就是按下去过一会儿才响。
  sfx('drop');
  buzz(14);
  p.y += d;
  game.score += d * 2;
  needsDraw = true;
  burst(p, 1.4);
  hardLocking = true;
  lockPiece();
  hardLocking = false;
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
    // 同理：先响，再去铺几十颗粒子和改 DOM
    sfx(full.length === 4 ? 'tetris' : 'clear');
    buzz(full.length >= 4 ? [30, 40, 70] : 18 + full.length * 8);
    clearing = { rows: full, t: 0, dur: 260 };
    for (const y of full) burstRow(y);
    flashBoard(full.length);
  } else {
    // 硬降自己已经响过 drop 了，再补一声 lock 会叠成一团糊音
    if (!hardLocking) sfx('lock');
    // 锁在隐藏区之上 = 顶出局
    const topOut = cellsOf(p.type, p.rot).every(([, cy]) => p.y + cy < BUFFER);
    if (topOut) endGame('锁在隐藏区'); else { armPre = true; spawnNext(); saveGame(); }
  }
}

// 等级加成。凹曲线：L1=1.0 L5=3.2 L10=5.0 L15=6.6 L20=8.0。
//
// 为什么不是直线。等级上限从 15 提到 20 之后，原来的 1+(lvl-1)×0.5
// 会把峰值倍率顶到 10.5 倍，分数直接膨胀三成，老成绩全不可比。
// 压斜率（让直线在 L20 收在 8 倍）又会把中段砍掉两成 —— 普通玩家
// 只打到 9、10 级，等于为了一个他们够不到的 20 级白亏分。
// 凹曲线两头都保住：前中段贴着原来走，峰值仍然是 8 倍，一次 TETRIS
// 最高还是 6400 分，跟改之前同一把尺子。
function levelMult(lvl){
  return 1 + 7 * Math.pow((clamp(lvl, 1, MAX_LEVEL) - 1) / (MAX_LEVEL - 1), .75);
}

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
    // 等级本身不封顶，一直往上涨；封顶的是它驱动的三件事：
    // 速度在 gravityFor 里 clamp、倍率在 levelMult 里 clamp、
    // 只有灰线在满级之后继续被它推快，所以再强的人也一定会撞墙。
    const newLevel = Math.floor(game.lines / LINES_PER_LEVEL) + 1;
    if (newLevel > game.level){ game.level = newLevel; flashLevel(); syncEdge(); }
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
  if (game.board[0].some(Boolean)){ endGame('灰线顶出'); return; }   // 顶出去了
  game.board.shift();
  const row = new Array(COLS).fill(GARBAGE);
  row[(rndGame() * COLS) | 0] = null;                   // 留个缺口，不然没法消
  game.board.push(row);
  game.garbage++;

  const p = game.piece;
  if (p){
    if (!collides(p.type, p.x, p.y - 1, p.rot)) p.y--;      // 方块跟着上移
    else if (collides(p.type, p.x, p.y, p.rot)){ endGame('灰线挤死'); return; }
  }
  staticDirty = true;
  needsDraw = true;
  sfx('lock');
}

// why 只给 harness 统计死因分布用，不影响玩法
function endGame(why){
  game.over = true;
  game.why = why || '?';
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

function edgeColor(lvl){
  const L = clamp(lvl, 1, EDGE_STOPS[EDGE_STOPS.length - 1][0]);
  for (let i = 1; i < EDGE_STOPS.length; i++){
    const [a, ca] = EDGE_STOPS[i - 1], [b, cb] = EDGE_STOPS[i];
    if (L <= b) return mix(ca, cb, (L - a) / (b - a));
  }
  return EDGE_STOPS[EDGE_STOPS.length - 1][1];
}
function rgba(c, a){ const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a.toFixed(3)})`; }

// 边框只在升级时重算一次，不进每帧的绘制循环
function syncEdge(){
  const L = game.level;
  const t = clamp((Math.min(L, MAX_LEVEL) - 1) / (MAX_LEVEL - 1), 0, 1);
  const c = edgeColor(L);
  const st = canvas.style;
  st.setProperty('--bd-w',    (1 + t * 1.4).toFixed(2) + 'px');
  st.setProperty('--bd-ring', rgba(c, .18 + t * .52));
  st.setProperty('--bd-glow', rgba(c, .09 + t * .30));
  st.setProperty('--bd-blur', Math.round(38 + t * 46) + 'px');

  const over = Math.max(0, L - MAX_LEVEL);
  const box = canvas.parentElement;
  if (box) box.classList.toggle('maxed', L >= MAX_LEVEL);
  const aura = $('boardAura');
  if (aura){
    // 超出满级的每一级再亮一点点，让「还在变难」看得见
    aura.style.setProperty('--au-ring', rgba(c, .78));
    aura.style.setProperty('--au-glow', rgba(c, Math.min(.60, .32 + over * .02)));
    aura.style.setProperty('--au-blur', Math.min(150, 72 + over * 4) + 'px');
  }
}

function mix(a, b, t){
  const pa = hex(a), pb = hex(b);
  const ch = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
function hex(h){
  // mix() 吐出来的是 rgb(...)，边框那条链会把它再喂回 mix/rgba，两种格式都得认
  if (h[0] === 'r'){ const m = h.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [255,255,255]; }
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
      const over = game.level > MAX_LEVEL;
      ctx.fillStyle = prog > .82 ? 'rgba(244,63,94,.85)'
                    : over       ? 'rgba(255,140,60,.62)'
                                 : 'rgba(150,175,215,.4)';
      const h = over ? 3 : 2;
      ctx.fillRect(0, H - h, W * prog, h);
    }
  }

  if (previewDirty){ drawPreview(); previewDirty = false; }
}

// HOLD 空着的时候原来就是一片黑，看着像坏了。
// 画个虚线框加一支「收进去」的箭头，明示这儿可以点。
function drawHoldHint(c, w, h){
  if (!w || !h) return;
  const s = Math.min(w, h) * .56;
  const x = (w - s) / 2, y = (h - s) / 2;
  c.save();
  c.strokeStyle = 'rgba(150,180,230,.30)';
  c.lineWidth = 1.5;
  c.setLineDash([4, 4]);
  roundRect(c, x, y, s, s, s * .22);
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(150,180,230,.45)';
  c.lineWidth = Math.max(1.5, s * .09);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const cx = w / 2, top = y + s * .24, bot = y + s * .60;
  c.beginPath();
  c.moveTo(cx, top); c.lineTo(cx, bot);
  c.moveTo(cx - s * .18, bot - s * .18); c.lineTo(cx, bot); c.lineTo(cx + s * .18, bot - s * .18);
  c.moveTo(x + s * .18, y + s * .76); c.lineTo(x + s * .82, y + s * .76);
  c.stroke();
  c.restore();
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
  else drawHoldHint(holdCtx, hw, hh);
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
        vx: (rndFx() - .5) * 90 * power,
        vy: (rndFx() * -60 - 20) * power,
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
        x: (p.x + cx + .5 + (rndFx() - .5) * .7) * CELL,
        y: (by - BUFFER + 1) * CELL,
        vx: (rndFx() - .5) * 70,
        vy: rndFx() * -55 - 15,
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
        vx: (rndFx() - .5) * 220,
        vy: (rndFx() - .5) * 160,
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
  if (particles.length > 110) particles.splice(0, particles.length - 110);
}

function drawParticles(){
  // 以前每颗粒子都开 shadowBlur 做辉光。实测同样次数的 fillRect，
  // 带辉光比不带贵 12 倍，而消行一爆一秒就是几千次 —— 手机发烫主要来自这里。
  // 改成「大一圈的淡底 + 实心核」两次平铺，观感差不多，代价只有六分之一。
  ctx.save();
  ctx.shadowBlur = 0;
  for (const q of particles){
    const a = clamp(q.life, 0, 1);
    ctx.fillStyle = q.color;
    const h = q.size * 2.1;
    ctx.globalAlpha = a * .20;
    ctx.fillRect(q.x - h / 2, q.y - h / 2, h, h);
    ctx.globalAlpha = a * .92;
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

// 音效走 8-bit 手法，不是连续滑音：
//   1) 脉冲波（占空比 12.5% / 25%）代替正弦三角 —— 老主机的方波通道就这个音色
//   2) 阶梯式跳音代替 glide —— 一串离散的音快速走完，才有"叮叮叮"的颗粒感
//   3) 落底另开一路噪声，当作老主机的噪声通道，砸下去那一下才有质感
// 频率全部保持在 260Hz 以上，手机外放才放得出来。
const SPECS = {
  // 转一下：低两档的「咚」，像按实体键那一下。
  // 频率往下走 + 半方波（50% 占空）音色更闷，再配一路低频噪声当撞击体。
  rotate: { duty:.5,   v:.105, step:.026, notes:[415, 277], noise:{ v:.055, d:.05, hp:320 } },
  // 自然落地：闷一点的两段下跳
  lock:   { duty:.125, v:.060, step:.024, notes:[392, 294] },
  // 落底：快速滑梯 + 噪声撞击
  drop:   { duty:.25,  v:.115, step:.016, notes:[1047, 784, 587, 392, 294], noise:{ v:.075, d:.07, hp:900 } },
  // 消行：上行琶音
  clear:  { duty:.25,  v:.100, step:.044, notes:[523, 659, 784, 1047] },
  // 四行：更长的号角，加一层上方五度
  tetris: { duty:.25,  v:.115, step:.052, notes:[523, 659, 784, 1047, 1319, 1568, 2093], harm:true },
  level:  { duty:.25,  v:.090, step:.055, notes:[784, 1047, 1319, 1568] },
  hold:   { duty:.25,  v:.070, step:.024, notes:[440, 587] },
  // 结束：一路掉下去
  over:   { duty:.125, v:.100, step:.105, notes:[523, 392, 330, 262, 196, 147] },
};

// 脉冲波要自己合成。占空比 d 的方波，第 n 次谐波幅度 = 2/(nπ)·sin(nπd)，
// 建一次缓存起来，别每个音效都算一遍。
const waveCache = new Map();
function pulseWave(duty){
  const key = duty;
  if (waveCache.has(key)) return waveCache.get(key);
  const N = 22;
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) real[n] = 2 / (n * Math.PI) * Math.sin(n * Math.PI * duty);
  const w = actx.createPeriodicWave(real, imag, { disableNormalization: false });
  waveCache.set(key, w);
  return w;
}

// 噪声通道。一段白噪声缓存着反复用，比每次现生成便宜得多。
let noiseBuf = null;
function noiseHit(t, cfg){
  if (!noiseBuf){
    noiseBuf = actx.createBuffer(1, actx.sampleRate * .3, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rndFx() * 2 - 1;
  }
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = actx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = cfg.hp || 800;
  const g = actx.createGain();
  src.connect(hp); hp.connect(g); g.connect(actx.destination);
  const v = Math.min(.9, cfg.v * SFX_GAIN);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + cfg.d);
  src.start(t, rndFx() * .2);
  src.stop(t + cfg.d + .02);
}

// iOS 上 AudioContext 只能在用户手势里创建/恢复，否则一直 suspended、永远没声。
// 所以第一次触碰屏幕就把它开起来，不等第一个音效。
// new AudioContext() 要起音频线程，实测 240ms。放在首次手势里建，
// 用户第一次点屏幕就会卡一下；所以挪到加载后的空闲期 —— 那会儿没动画在跑。
// 没手势时建出来是 suspended，合规，贵的那步已经付掉了。
function primeAudio(){
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    // 明确要最小缓冲，别让浏览器为了省电挑个大 buffer
    actx = new AC({ latencyHint: 'interactive' });
    // resume() 是异步的：刚调完 state 还是 suspended，musicStart 会当场退出。
    // 之前靠一次性的 pointerdown 去起音乐，谁先谁后全看运气，
    // 所以「刷新后有时候没有背景音乐」。改成等真的 running 了再回头起一次。
    actx.addEventListener('statechange', () => { if (actx.state === 'running') syncMusic(); });
  } catch { /* 不给就算了 */ }
}
if (window.requestIdleCallback) requestIdleCallback(primeAudio, { timeout: 2500 });
else setTimeout(primeAudio, 700);

function unlockAudio(){
  try {
    primeAudio();
    if (actx && actx.state === 'suspended'){
      const p = actx.resume();
      if (p && p.then) p.then(() => syncMusic(), () => { /* 拒了就算了 */ });
    }
  } catch { /* 不给就算了 */ }
}

// 音效总音量。手机外放偏小，之前那一档在车厢、路上基本听不见。
const SFX_GAIN = 1.9;

function sfx(kind){
  if (muted) return;
  const spec = SPECS[kind];
  if (!spec) return;
  try {
    unlockAudio();
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    const dur = spec.step * spec.notes.length;
    const wave = pulseWave(spec.duty);
    const voice = (mul, vol) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.setPeriodicWave(wave);
      // 一个振荡器走完整串音：频率按格子跳，不做插值
      spec.notes.forEach((f, i) => o.frequency.setValueAtTime(f * mul, t0 + i * spec.step));
      o.connect(g); g.connect(actx.destination);
      const v = Math.min(.9, vol * SFX_GAIN);
      g.gain.setValueAtTime(.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + .0015);
      g.gain.setValueAtTime(v, t0 + Math.max(.002, dur - .028));
      g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + .02);
    };
    voice(1, spec.v);
    if (spec.harm) voice(1.5, spec.v * .3);      // 上方纯五度，厚一点但不抢
    if (spec.noise) noiseHit(t0, spec.noise);
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
    // 2000 太闷了，手机喇叭本来就放不出低频，再把高次谐波削光就什么都不剩。
    // 「不尖锐」靠的是下面那个 34ms 的慢起音，不是靠削高频。
    lp.frequency.value = 2600;
    lp.Q.value = .4;
    musicGain.connect(lp);
    lp.connect(actx.destination);
  }
  return musicGain;
}

// 一个音：主音 + 低五度的薄薄一层，听着不那么单薄
function playNote(m, t, dur, kind){
  const bus = musicBus();
  // 音尾收得早 = 断奏，比拖满音符时值轻快得多。
  // atk 是起音时长：低音原来 12ms 起，四下一小节听着像敲鼓，拉到 34ms 就柔了。
  const cfg = kind === 'bass'
    ? { type: 'triangle', v: .090, rel: .60, atk: .034 }
    : { type: 'square',   v: .080, rel: .52, atk: .016 };
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = cfg.type;
  o.frequency.setValueAtTime(midi(m), t);
  o.connect(g); g.connect(bus);
  const hold = Math.max(.045, dur * cfg.rel);
  const atk = Math.min(cfg.atk, hold * .5);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(cfg.v, t + atk);
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
  bus.gain.linearRampToValueAtTime(.75, actx.currentTime + .5);
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

// 一步逻辑。不画、不排 rAF —— 这样 harness 能脱离真实时钟高速驱动。
// 返回 'stop' / 'clearing' / 'normal'，由调用方决定怎么画。
function stepOnce(dt){
  if (game.paused || game.over || game.frozen) return 'stop';

  stepParticles(dt);
  handleAutoRepeat(dt);

  // 灰线倒计时（消行动画期间不推进，免得叠在一起）
  if (!clearing && game.piece){
    game.elapsed += dt;
    garbageTimer += dt;
    const period = garbagePeriod();
    if (!game.noGarbage && garbageTimer >= period){
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
    return 'clearing';
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
      const phase = Math.min(4, (lockTimer / LOCK_DELAY * 5) | 0);
      if (phase !== lockStep){ lockStep = phase; needsDraw = true; }
      if (lockTimer >= LOCK_DELAY) lockPiece();
    } else lockStep = -1;
  }

  syncHud();
  return 'normal';
}

// 外层切片：单步永远不超过 100ms（切后台回来不要瞬移），
// 但允许一次喂进来一大段，harness 靠这个把一局压到毫秒级。
function step(dt){
  let left = Math.min(Math.max(dt, 0), 600000);
  let r = 'normal';
  do {
    const d = Math.min(left, 100);
    left -= d;
    r = stepOnce(d);
    if (r === 'stop') break;
  } while (left > 0);
  return r;
}

function tick(now){
  rafId = requestAnimationFrame(tick);
  dbg.frames++;
  const dt = now - lastFrame;
  lastFrame = now;

  const r = step(dt);
  if (r === 'stop'){
    draw();
    needsDraw = false;
    cancelAnimationFrame(rafId);      // 停着就别空转了，恢复时再拉起来
    rafId = 0;
    return;
  }
  if (r === 'clearing'){ draw(); return; }

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

// 全屏键去掉了（iPhone 上 Safari 根本不给网页全屏，那个按钮点了没反应）。
// immersive 这套还留着：从主屏图标启动时会自动进，不需要手动按。
function syncFsBtn(){
  const on = document.body.classList.contains('immersive');
  if (!$('fsBtn')) return;
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
  game.why = '';
  syncEdge();
  garbageTimer = 0;
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;
  particles.length = 0;
  clearing = null;
  softDropping = false;
  held.left = held.right = false;
  $('overlay').classList.remove('show');
  $('pauseTx').textContent = '暂停';
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
  $('pauseTx').textContent = game.paused ? '继续' : '暂停';
  // 暂停时图标换成播放三角，一眼知道再点一下是继续
  $('pauseIc').setAttribute('d', game.paused ? 'M9 6.2 18 12l-9 5.8z' : 'M9.5 6.5v11M14.5 6.5v11');
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
  syncEdge();
  syncHud();
  fillQueue();
  layout();
  bindButtons();

  // 任何一次触碰都先把音频上下文拉起来（iOS 必须在手势里做）
  // 一直挂着直到音频真的跑起来为止，不能只试一次
  const KICK_EVENTS = ['pointerdown', 'touchstart', 'keydown'];
  const kickAudio = () => {
    unlockAudio();
    if (actx && actx.state === 'running'){
      syncMusic();
      for (const ev of KICK_EVENTS) window.removeEventListener(ev, kickAudio);
    }
  };
  for (const ev of KICK_EVENTS) window.addEventListener(ev, kickAudio, { passive: true });

  const mb = $('musicBtn');
  if (mb) mb.addEventListener('click', toggleMusic);
  syncMusic();

  $('startBtn').addEventListener('click', restart);
  $('againBtn').addEventListener('click', restart);
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  $('restartBtn').addEventListener('click', restart);
  $('muteBtn').addEventListener('click', toggleMute);
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
window.__tetris = { game, PIECES, cellsOf, collides, restart, riseGarbage, garbagePeriod, garbageClock, gravityFor, levelMult, edgeColor, syncEdge, MAX_LEVEL,
  step, stepOnce, setSeed, hardDrop, tryRotate, holdPiece, tryMove, lockPiece, LINES_PER_LEVEL, COLS, ROWS, BUFFER, TOTAL_ROWS,
  dbg, peek: () => ({ clearing, grounded, lockTimer, dropTimer, frames: dbg.frames, layouts: dbg.layouts, needsDraw, staticDirty, previewDirty, parts: particles.length }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
