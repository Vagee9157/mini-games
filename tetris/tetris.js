/* 俄罗斯方块 —— 按现代 Guideline 实现
   7-bag 随机 / SRS 旋转 + wall kick / hold / ghost / lock delay /
   T-spin / back-to-back / combo。纯 Canvas，无依赖。 */
(() => {
'use strict';

// ───────────────────────── 常量 ─────────────────────────

// 疯狂版跟标准版同一份代码，靠这个开关分流。页面在加载 tetris.js 之前设它。
const CRAZY = !!window.TETRIS_CRAZY;
const NS = CRAZY ? 'crazy' : 'tetris';
// 所有 localStorage 访问统一走这里，禁止写裸字符串 —— 之前就漏过
// 内联的 'tetris.muted.v1'（不在常量块里，按常量块改会漏掉）
const nsKey = (name) => `${NS}.${name}`;

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
let activePal = null;   // FEVER 期间临时换肤用，不落盘
function colorOf(type){ return type === GARBAGE ? '#93a4c4' : PALETTES[activePal || skin.pal][type]; }

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
const TRAIL_MS = 130;        // 硬降残影存活时间
const TRAIL_MIN_DROP = 4;    // 落差不到这么多格就不留残影
const TRAIL_MAX = 2;         // 同时最多几道

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
// 疯狂版灰线更凶：FEVER 的「灰线暂停」和行雨的「清灰线」都得有东西可对抗，
// 取消灰线这两个机制就空转了
const G_MAX = CRAZY ? 30000 : 45000;     // 开局周期
const G_MIN = CRAZY ? 10000 : 15000;     // 压到这里就不再往下
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
// 清档令牌按 NS 分开取值，否则为标准版 bump 会连带把疯狂版的最高分清掉
const WIPE_TOKENS = { tetris: '2026-09-23-level20', crazy: '' };
const WIPE_TOKEN = WIPE_TOKENS[NS];
const WIPE_KEY = nsKey('wipe.v1');

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

const STORE_KEY = nsKey('best.v1');       // 隔离：两个模式各有各的最高分
const SAVE_KEY  = nsKey('save.v1');       // 隔离：疯狂版的存档不能被标准版 restore
const LEGACY_KEY = nsKey('best.legacy');  // 清档时把旧纪录留一份
function readLegacy(){
  try { return parseInt(localStorage.getItem(LEGACY_KEY) || '0', 10) || 0; }
  catch { return 0; }
}
// 下面这些是偏好，两个页面共用
const BUZZ_KEY  = 'tetris.buzz.v1';
const MUSIC_KEY = 'tetris.music.v1';
const TRACK_KEY = 'tetris.track.v1';
const PACK_KEY  = 'tetris.sfxpack.v1';
const SKIN_KEY  = 'tetris.skin.v1';
const MUTE_KEY  = 'tetris.muted.v1';

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
  sweeps.length = 0;
  rings.length = 0;
  trails.length = 0;
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
  crazyOnSpawn(p);
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
  // 拖尾：从起点到落点之间留一道残影。掉两三格也留一道，残影就成了糊在
  // 盘面上的装饰；只有真砸下来的那种落差才值得画。
  if (d >= TRAIL_MIN_DROP){
    const cells = [];
    for (const [cx, cy] of cellsOf(p.type, p.rot))
      cells.push([p.x + cx, p.y + cy, p.y + cy + d]);
    trails.push({ cells, color: p.mod === 'gold' ? '#ffd23f' : colorOf(p.type), t: 0 });
    while (trails.length > TRAIL_MAX) trails.shift();
  }
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
  crazyOnLock(p);
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
  lastClearRows = full.slice();      // 必须在 scoreFor 之前，飘字要靠它定位
  lastLockY = p.y + 1;               // 空转 T-spin 没有消除行，飘字落在 T 的中心
  scoreFor(full.length, spin, perfect);
  crazyOnClear(full.length);

  if (full.length){
    // 同理：先响，再去铺几十颗粒子和改 DOM
    // 连击 0~5 逐级升半音（2^(1/12) ≈ 1.0595）
    const pitch = Math.pow(1.0595, Math.min(6, Math.max(0, game.combo)));
    sfx(spin ? 'tspin' : (full.length === 4 ? 'tetris' : 'clear'), pitch);
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

let trails = [];        // 硬降残影 { cells:[[x,y]...], color, t }
let lastClearRows = [];
let lastLockY = 0;
let bestBeaten = false;

// 消除的视觉分级。三条轴分开表达：
//   颜色 = 哪一种消除（普通走冷色梯度，T-spin 系走品红，四行走金）
//   字号 = 这一下有多重
//   附加特效 = 有多稀有（金光横扫 / 环形爆开 / 全屏白闪）
// 以前只有"大不大"一个开关，所以 TETRIS 和 T-SPIN TRIPLE 长得一模一样。
const FALLBACK_STYLE = { name: 'CLEAR', cls: 't1', scale: 1 };
function clearStyle(n, spin, perfect){
  if (perfect) return { name: '全消 PERFECT CLEAR', cls: 'pc', scale: 1.9 };
  if (spin === 'tspin')
    return [{ name: 'T-SPIN',        cls: 'ts',  scale: 1.25 },
            { name: 'T-SPIN SINGLE', cls: 'ts',  scale: 1.40 },
            { name: 'T-SPIN DOUBLE', cls: 'ts',  scale: 1.55 },
            { name: 'T-SPIN TRIPLE', cls: 'ts3', scale: 1.70 }][n] || FALLBACK_STYLE;
  if (spin === 'mini')
    // mini 最多只能消两行，第四格纯属防御
    return [{ name: 'MINI T-SPIN',        cls: 'tm', scale: 1.10 },
            { name: 'MINI T-SPIN SINGLE', cls: 'tm', scale: 1.20 },
            { name: 'MINI T-SPIN DOUBLE', cls: 'tm', scale: 1.30 }][n] || FALLBACK_STYLE;
  return [null,
          { name: 'SINGLE', cls: 't1', scale: 1.00 },
          { name: 'DOUBLE', cls: 't2', scale: 1.15 },
          { name: 'TRIPLE', cls: 't3', scale: 1.30 },
          { name: 'TETRIS', cls: 't4', scale: 1.60 }][n] || null;
}

function scoreFor(n, spin, perfect){
  const mult = levelMult(game.level);
  let base = 0, label = '';
  let b2bApplied = false;   // game.b2b 下面就会被覆盖，飘字得靠这个才知道加成生没生效

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
    if (isHard && game.b2b){ base = Math.floor(base * 1.5); label = 'B2B ' + label; b2bApplied = true; }
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

  const gain = Math.round(base * mult * crazyScoreMult());
  game.score += gain;

  // 飘字落在被消掉那几行的中间；空转的 T-spin 没有消除行，落在方块自己身上
  const st = clearStyle(n, spin, perfect);
  if (st && (n > 0 ? lastClearRows.length : !!spin)){
    const row = n > 0
      ? lastClearRows.reduce((a, b) => a + b, 0) / lastClearRows.length
      : lastLockY;
    const py = (row - BUFFER + .5) * CELL;
    const hot = CRAZY && feverLeft > 0;

    let label = st.name, cls = st.cls;
    if (b2bApplied){ label = 'B2B ' + label; cls += ' b2b'; }
    if (game.combo >= 1){ label += ` ×${game.combo}`; if (game.combo >= 5) cls += ' cmb'; }
    if (hot) cls += ' hot';

    popScore(CELL * COLS / 2, py, '+' + gain.toLocaleString(), label, cls,
             st.scale * (hot ? 1.25 : 1));

    // 附加特效按稀有度给：四行和全消横扫一道金光，T-spin 消行从中心爆开一圈紫环。
    // 两者可以叠（T-spin 打出的全消），但不是必然一起来。
    if (n === 4 || perfect) sweepRows(lastClearRows, '#ffd166');
    if (spin && n > 0) burstRing(lastClearRows, spin === 'tspin' ? '#ff6bd6' : '#c9a6ff');

    const big = n === 4 || spin || perfect;
    if (big) shake(n === 4 || perfect);
    else if (n >= 2) shake(false);
  }

  if (n > 0){
    game.lines += n;
    // 等级本身不封顶，一直往上涨；封顶的是它驱动的三件事：
    // 速度在 gravityFor 里 clamp、倍率在 levelMult 里 clamp、
    // 只有灰线在满级之后继续被它推快，所以再强的人也一定会撞墙。
    const newLevel = Math.floor(game.lines / LINES_PER_LEVEL) + 1;
    if (newLevel > game.level){ game.level = newLevel; flashLevel(); syncEdge(); }
  }
  // toast 只留"够得上事件"的：常态的连击/B2B 交给常驻徽章，
  // 否则同一件事会有飘字 + 徽章 + toast 三个通道同时喊。
  if (label && (n === 4 || spin || perfect)) showToast(label.trim());
  if (game.score > game.best){
    if (game.best > 0 && !bestBeaten){ bestBeaten = true; showToast('破纪录！'); }
    game.best = game.score; writeBest(game.best);
  }
  syncStreak();
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
  if (game.board[0].some(Boolean)){
    if (crazyRescue()) return;                 // 疯狂版：濒死豁免
    endGame('灰线顶出'); return;
  }
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
  sweeps.length = 0;
  rings.length = 0;
  trails.length = 0;
  staticDirty = true;
  needsDraw = true;
  clearSave();
  cancelAnimationFrame(rafId);
  if (game.score > game.best){ game.best = game.score; writeBest(game.best); }
  $('overScore').textContent = game.score.toLocaleString();
  $('overLines').textContent = game.lines;
  $('overLevel').textContent = game.level;
  $('overBest').textContent = game.best.toLocaleString();
  // 清过档的话把旧规则下的纪录也摆出来 —— 个人小游戏里最高分就是全部的意义，
  // 光写进 localStorage 没人看得见等于没留
  const lg = readLegacy();
  $('legacyCell').hidden = !lg;
  if (lg) $('overLegacy').textContent = lg.toLocaleString();
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
    // 消行动画分两段，总时长仍是 260ms，不延长冻结：
    //   0~140ms  要消的那几行盖白光（不重画整盘，只 fillRect 几条）
    //   140~260  上方整块往下滑到位，消掉的行留空
    const FLASH_MS = 140;
    if (clearing.t < FLASH_MS){
      const flash = 1 - clearing.t / FLASH_MS;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${(.10 + .30 * flash).toFixed(3)})`;
      for (const y of clearing.rows){
        if (y < BUFFER) continue;
        ctx.fillRect(0, (y - BUFFER) * CELL, W, CELL);
      }
      ctx.restore();
    } else {
      const k = Math.min(1, (clearing.t - FLASH_MS) / (clearing.dur - FLASH_MS));
      const topRow = Math.min(...clearing.rows);
      const drop = clearing.rows.length * CELL * k;
      const cut = (topRow - BUFFER) * CELL;          // 塌陷区上沿
      ctx.save();
      // 先把塌陷区以下（含被消行）整段擦掉，再把上半部分按位移重贴一次
      ctx.clearRect(0, Math.max(0, cut), W, H - Math.max(0, cut));
      ctx.fillStyle = 'rgba(6, 10, 20, .72)';
      ctx.fillRect(0, Math.max(0, cut), W, H - Math.max(0, cut));
      if (cut > 0){
        ctx.beginPath();
        ctx.rect(0, 0, W, cut + drop);
        ctx.clip();
        ctx.drawImage(bgCv, 0, drop, W, H);
      }
      ctx.restore();
      // 被消行下方的部分原样留着（bg 已经画过，clearRect 抹掉了，补回来）
      ctx.save();
      const below = (Math.max(...clearing.rows) - BUFFER + 1) * CELL;
      if (below < H){
        ctx.beginPath();
        ctx.rect(0, below, W, H - below);
        ctx.clip();
        ctx.drawImage(bgCv, 0, 0, W, H);
      }
      ctx.restore();
    }
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
    // 金块：本色往金里混七成 + 常驻亮边，一眼认得出来
    const gold = p.mod === 'gold';
    const pc = gold ? mix(color, '#ffd23f', .72) : color;
    for (const [cx, cy] of cellsOf(p.type, p.rot)){
      const by = p.y + cy;
      if (by < BUFFER) continue;
      drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, pc,
               { glow: Math.max(lockPulse, gold ? .55 : 0) });
    }
  }

  // 硬降拖尾：落点那端最浓，往起点方向渐隐到透明。
  // 通体一个亮度的话，画出来不是残影，是一根杵在盘面上的色棒。
  // 渐变的起点用同色零透明而不是 'transparent'——后者在部分浏览器里
  // 会经由透明黑插值，边上会浮一道脏边。
  for (const tr of trails){
    const a = Math.max(0, 1 - tr.t / TRAIL_MS);
    ctx.save();
    ctx.globalAlpha = a * .32;
    for (const [x, y0, y1] of tr.cells){
      const top = Math.max(y0, BUFFER) - BUFFER;
      const bot = Math.max(y1, BUFFER) - BUFFER;
      if (bot <= top) continue;
      const g = ctx.createLinearGradient(0, top * CELL, 0, bot * CELL);
      g.addColorStop(0, rgba(tr.color, 0));
      g.addColorStop(1, tr.color);
      ctx.fillStyle = g;
      ctx.fillRect(x * CELL + CELL * .34, top * CELL, CELL * .32, (bot - top) * CELL);
    }
    ctx.restore();
  }
  if (sweeps.length || rings.length) drawFx();
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

// ── 消除的附加特效：四行金光横扫 / T-spin 紫环爆开 ──
// 两样都不走粒子数组。粒子有 110 颗硬上限，四行消除光 burstRow 就吃掉 80 颗，
// 再往里塞只会把先爆的挤掉，等于拿旧特效换新特效。各自一条数组，
// 每帧固定一两次绘制，跟粒子数量无关。
let sweeps = [];   // { y0, y1, color, t }
let rings  = [];   // { x, y, color, t }
const SWEEP_MS = 340, RING_MS = 420;

function sweepRows(rows, color){
  if (!rows.length || !CELL) return;
  const y0 = Math.max(Math.min(...rows), BUFFER), y1 = Math.max(...rows);
  if (y1 < BUFFER) return;
  sweeps.push({ y0, y1, color, t: 0 });
  while (sweeps.length > 2) sweeps.shift();
}

function burstRing(rows, color){
  if (!rows.length || !CELL) return;
  const mid = rows.reduce((a, b) => a + b, 0) / rows.length;
  if (mid < BUFFER) return;
  rings.push({ x: COLS * CELL / 2, y: (mid - BUFFER + .5) * CELL, color, t: 0 });
  while (rings.length > 2) rings.shift();
}

function stepFx(dt){
  for (let i = sweeps.length - 1; i >= 0; i--)
    if ((sweeps[i].t += dt) > SWEEP_MS) sweeps.splice(i, 1);
  for (let i = rings.length - 1; i >= 0; i--)
    if ((rings[i].t += dt) > RING_MS) rings.splice(i, 1);
  if (sweeps.length || rings.length) needsDraw = true;
}

function drawFx(){
  const W = COLS * CELL;
  for (const s of sweeps){
    const k = s.t / SWEEP_MS;
    const top = (s.y0 - BUFFER) * CELL, h = (s.y1 - s.y0 + 1) * CELL;
    // 一道有拖尾的光带从左扫到右。fillRect 只填渐变自己那一段——
    // 填满整行的话，渐变范围之外会被端点颜色铺成一块实心。
    const bandW = W * .38;
    const headX = -bandW + k * (W + bandW * 2);
    const g = ctx.createLinearGradient(headX - bandW, 0, headX, 0);
    g.addColorStop(0, rgba(s.color, 0));
    g.addColorStop(1, rgba(s.color, .8 * (1 - k)));
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(headX - bandW, top, bandW, h);
    ctx.restore();
  }
  for (const r of rings){
    const k = r.t / RING_MS;
    ctx.save();
    ctx.globalAlpha = (1 - k) * .7;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(1.5, CELL * .16 * (1 - k));
    ctx.beginPath();
    ctx.arc(r.x, r.y, CELL * (.6 + k * 4.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function stepTrails(dt){
  for (let i = trails.length - 1; i >= 0; i--){
    trails[i].t += dt;
    if (trails[i].t > TRAIL_MS) trails.splice(i, 1);
  }
  if (trails.length) needsDraw = true;
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
  // 这两个跟分数无关（堆高、连击断掉都不改分），不能挡在下面的缓存早退后面
  syncStreak();
  syncDanger();
  const key = game.score + '/' + game.lines + '/' + game.level + '/' + game.best;
  if (key === hudCache) return;         // 每帧写 DOM 很浪费
  hudCache = key;
  rollScore(false);
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
// ── 反馈层 ──
// 全部走 DOM：结算页和暂停态整个 rAF 循环是停的（tick 的 stop 分支会
// cancelAnimationFrame），任何依赖游戏帧的反馈在那两个状态下都不动。

// 分数飘字。x/y 用棋盘内的像素坐标，落在 #fx 那层上。
// 飘字：上面一行大数字，下面一行小字说这是哪种消除。
// 颜色交给 cls 对应的 CSS 类，不在这里写死——渐变字（TETRIS 的金、全消的彩虹）
// 得靠 background-clip，用 style.color 表达不了。
function popScore(px, py, text, label, cls, scale){
  const fx = $('fx');
  if (!fx || !CELL) return;
  const W = CELL * COLS, H = CELL * ROWS;
  const el = document.createElement('div');
  el.className = 'pop ' + (cls || 't1');
  el.style.left = (px / W * 100) + '%';
  el.style.top  = (py / H * 100) + '%';
  el.style.fontSize = Math.max(13, Math.round(CELL * .58 * (scale || 1))) + 'px';

  const num = document.createElement('b');
  num.textContent = text;
  el.appendChild(num);
  if (label){
    const tag = document.createElement('i');
    tag.textContent = label;
    el.appendChild(tag);
  }
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1050);
}

// 屏幕震动。挂在 .shaker 上，避开 .board-box 的居中 transform
// 和 #board 上被 flash/flash-big 占住的 animation。
function shake(big){
  const el = $('shaker');
  if (!el) return;
  el.classList.remove('shake', 'shake-big');
  void el.offsetWidth;
  el.classList.add(big ? 'shake-big' : 'shake');
}

// B2B / 连击徽章。常驻显示，断了就灭 —— 一闪而过的 toast 教不会人这两个机制。
function syncStreak(){
  const b2b = $('badgeB2B'), cmb = $('badgeCombo');
  if (!b2b || !cmb) return;
  const onB = !!game.b2b && !game.over;
  const onC = game.combo > 0 && !game.over;
  b2b.classList.toggle('on', onB);
  document.body.classList.toggle('hotcombo', game.combo >= 5 && !game.over);
  cmb.classList.toggle('on', onC);
  if (onC) cmb.textContent = 'COMBO ×' + game.combo;
}

// 危险警戒带：堆到距顶三行以内就亮。加滞回，免得在边界上抖。
let dangerOn = false;
function syncDanger(){
  const el = $('danger');
  if (!el) return;
  const top = topFilledRow();
  const left = top < 0 ? 99 : top - BUFFER;
  if (!dangerOn && left <= 3) dangerOn = true;
  else if (dangerOn && left >= 5) dangerOn = false;
  el.classList.toggle('on', dangerOn && !game.over && game.started);
}
function topFilledRow(){
  for (let y = 0; y < TOTAL_ROWS; y++)
    for (let x = 0; x < COLS; x++) if (game.board[y][x]) return y;
  return -1;
}

// 分数滚动。自己跑一条 rAF，不依赖游戏循环 —— 结算那一刻循环已经停了。
let shownScore = 0, rollId = 0;
function rollScore(snap){
  const el = $('score');
  if (!el) return;
  if (snap){ shownScore = game.score; el.textContent = shownScore.toLocaleString(); return; }
  if (rollId) return;
  const tickRoll = () => {
    const d = game.score - shownScore;
    if (Math.abs(d) < 1){ shownScore = game.score; el.textContent = shownScore.toLocaleString(); rollId = 0; return; }
    shownScore += d * .22;
    el.textContent = Math.round(shownScore).toLocaleString();
    rollId = requestAnimationFrame(tickRoll);
  };
  rollId = requestAnimationFrame(tickRoll);
}

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
// 三套音效。duty=占空比（脉冲波的音色），notes 是阶梯跳音的音序，
// noise 是另开的噪声通道。全部保持在 260Hz 以上 —— 手机外放放不出更低的。
const SFX_PACKS = {
  // 8-bit 经典：脉冲波 + 阶梯跳音 + 噪声，老主机那一套
  bit: {
    name: '8-bit',
    rotate: { duty:.5,   v:.105, step:.026, notes:[415, 277], noise:{ v:.055, d:.05, hp:320 } },
    lock:   { duty:.125, v:.060, step:.024, notes:[392, 294] },
    drop:   { duty:.25,  v:.115, step:.016, notes:[1047, 784, 587, 392, 294], noise:{ v:.075, d:.07, hp:900 } },
    clear:  { duty:.25,  v:.100, step:.044, notes:[523, 659, 784, 1047] },
    tetris: { duty:.25,  v:.115, step:.052, notes:[523, 659, 784, 1047, 1319, 1568, 2093], harm:true },
    tspin:  { duty:.125, v:.115, step:.046, notes:[659, 880, 1175, 1568, 2093], harm:true },
    level:  { duty:.25,  v:.090, step:.055, notes:[784, 1047, 1319, 1568] },
    hold:   { duty:.25,  v:.070, step:.024, notes:[440, 587] },
    over:   { duty:.125, v:.100, step:.105, notes:[523, 392, 330, 262, 196, 147] },
  },
  // 柔和：接近正弦的高占空比、音序更短、去掉噪声，办公室能听
  soft: {
    name: '柔和',
    rotate: { duty:.5,   v:.075, step:.034, notes:[523, 587] },
    lock:   { duty:.5,   v:.048, step:.030, notes:[392, 330] },
    drop:   { duty:.5,   v:.085, step:.028, notes:[784, 587, 440] },
    clear:  { duty:.5,   v:.080, step:.056, notes:[523, 659, 784] },
    tetris: { duty:.5,   v:.095, step:.062, notes:[523, 659, 784, 988, 1175], harm:true },
    tspin:  { duty:.5,   v:.095, step:.056, notes:[587, 784, 988, 1319] },
    level:  { duty:.5,   v:.075, step:.066, notes:[659, 880, 1047] },
    hold:   { duty:.5,   v:.058, step:.030, notes:[440, 523] },
    over:   { duty:.5,   v:.080, step:.120, notes:[440, 349, 294, 220] },
  },
  // 厚重电子：占空比压到 12.5%（谐波最多、最"锐"），音更低，噪声给得足
  deep: {
    name: '厚重',
    rotate: { duty:.125, v:.115, step:.030, notes:[330, 262], noise:{ v:.080, d:.06, hp:260 } },
    lock:   { duty:.125, v:.070, step:.028, notes:[330, 262], noise:{ v:.045, d:.04, hp:300 } },
    drop:   { duty:.125, v:.130, step:.020, notes:[784, 523, 392, 294, 262], noise:{ v:.110, d:.10, hp:500 } },
    clear:  { duty:.125, v:.110, step:.048, notes:[392, 523, 659, 784], noise:{ v:.05, d:.05, hp:700 } },
    tetris: { duty:.125, v:.125, step:.056, notes:[392, 523, 659, 784, 1047, 1319], harm:true, noise:{ v:.09, d:.12, hp:400 } },
    tspin:  { duty:.125, v:.125, step:.048, notes:[523, 698, 880, 1175, 1568], harm:true },
    level:  { duty:.125, v:.100, step:.058, notes:[523, 784, 1047] },
    hold:   { duty:.125, v:.075, step:.028, notes:[349, 466] },
    over:   { duty:.125, v:.110, step:.115, notes:[392, 294, 233, 175, 131] },
  },
};
let sfxPack = 'bit';
let SPECS = SFX_PACKS.bit;
function setPack(k){
  if (!SFX_PACKS[k]) return;
  sfxPack = k; SPECS = SFX_PACKS[k];
  try { localStorage.setItem(PACK_KEY, k); } catch { /* 忽略 */ }
}


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

// pitch：整体移调的倍数。连击越高调越高 —— 所有消除类游戏里最上瘾的那个反馈。
function sfx(kind, pitch){
  if (muted) return;
  const spec = SPECS[kind];
  if (!spec) return;
  const mul0 = pitch || 1;
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
      spec.notes.forEach((f, i) => o.frequency.setValueAtTime(f * mul * mul0, t0 + i * spec.step));
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
// ── 曲库 ──
// 三首都是现场合成，不加载任何音频文件 —— 离线能放，也不占缓存。
// 时值单位是八分音符；0 表示休止。BASS 是每小节的低音根音。
const A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, GS5 = 80;
const A3 = 57, B3 = 59, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, GS4 = 68;
const A2 = 57, E2 = 52, D3 = 62, C3 = 60, F3 = 65, G3 = 67;

const TRACKS = [
  {
    name: 'Korobeiniki',
    bpm: 170,
    // 1861 年的俄罗斯民谣，公有领域。就是大家认的那首「俄罗斯方块主题曲」。
    melody: [
      [E5,2],[B4,1],[C5,1],[D5,2],[C5,1],[B4,1],
      [A4,2],[A4,1],[C5,1],[E5,2],[D5,1],[C5,1],
      [B4,3],[C5,1],[D5,2],[E5,2],
      [C5,2],[A4,2],[A4,4],
      [D5,3],[F5,1],[A5,2],[G5,1],[F5,1],
      [E5,3],[C5,1],[E5,2],[D5,1],[C5,1],
      [B4,2],[B4,1],[C5,1],[D5,2],[E5,2],
      [C5,2],[A4,2],[A4,4],
      [E4,4],[C4,4],
      [D4,4],[B3,4],
      [C4,4],[A3,4],
      [GS4,4],[B3,3],[0,1],
      [E4,4],[C4,4],
      [D4,4],[B3,4],
      [C4,4],[E4,4],
      [A4,4],[GS4,4],
    ],
    bass: [A2,A2,E2,A2,D3,A2,E2,A2, A2,A2,A2,E2,A2,A2,A2,E2],
  },
  {
    name: '民谣快板',
    bpm: 186,
    // 原创。小调、密集八分音符的跑动，节奏比上面那首更赶。
    melody: [
      [A4,1],[C5,1],[E5,1],[C5,1],[A4,1],[C5,1],[E5,2],
      [G4,1],[B4,1],[D5,1],[B4,1],[G4,1],[B4,1],[D5,2],
      [F4,1],[A4,1],[C5,1],[A4,1],[F4,1],[A4,1],[C5,2],
      [E4,1],[GS4,1],[B4,1],[GS4,1],[E4,2],[B4,2],
      [A4,2],[E5,2],[D5,1],[C5,1],[B4,1],[A4,1],
      [G4,2],[D5,2],[C5,1],[B4,1],[A4,1],[G4,1],
      [F4,2],[C5,2],[B4,1],[A4,1],[G4,1],[F4,1],
      [E4,2],[B4,2],[A4,4],
    ],
    bass: [A2,G3,F3,E2, A2,G3,F3,E2],
  },
  {
    name: '电子疾行',
    bpm: 200,
    // 原创。五声小调的riff，一直往前推，给疯狂版留的。
    melody: [
      [A4,1],[A4,1],[C5,1],[D5,1],[A4,1],[D5,1],[E5,2],
      [A4,1],[A4,1],[C5,1],[D5,1],[E5,1],[G5,1],[E5,2],
      [D5,1],[C5,1],[A4,1],[C5,1],[D5,1],[E5,1],[D5,2],
      [C5,1],[A4,1],[G4,1],[A4,1],[C5,2],[A4,2],
      [E5,1],[E5,1],[G5,1],[A5,1],[E5,1],[A5,1],[G5,2],
      [E5,1],[D5,1],[C5,1],[D5,1],[E5,1],[D5,1],[C5,2],
      [A4,1],[C5,1],[D5,1],[E5,1],[G5,1],[E5,1],[D5,2],
      [C5,1],[A4,1],[E4,1],[A4,1],[A4,4],
    ],
    bass: [A2,A2,C3,C3, D3,D3,E2,E2],
  },
];

let trackIdx = 0;
let MELODY = TRACKS[0].melody;
let BASS = TRACKS[0].bass;
let EIGHTH = 60 / TRACKS[0].bpm / 2;
let baseBpm = TRACKS[0].bpm;

// 变速必须走这个独立入口。
// 千万别用「改完 BPM 再调 musicStart」那种写法 —— musicStart 的
// `if (mTimer) return` 挡在 mAt 赋值之前，音乐已在放时它只会拉音量，
// 整个变速会静默失效。这里只改步长，绝不碰 mAt（往回调 mAt 会让新音符
// 叠在已排期的旧音符上）。已排期的 0.35 秒撤不回来，所以变速有延迟是正常的。
function setTempo(bpm){ EIGHTH = 60 / Math.max(40, bpm) / 2; }

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
// 每首曲子挂自己的 sub-gain。切歌时旧的单独淡出，不会和新曲子撞在一起 ——
// 音符是 fire-and-forget 的，musicStop 只对总线淡出管不到已排期的振荡器。
let trackGain = null;
function trackBus(){
  const bus = musicBus();
  if (!trackGain){ trackGain = actx.createGain(); trackGain.gain.value = 1; trackGain.connect(bus); }
  return trackGain;
}

function playNote(m, t, dur, kind){
  const bus = trackBus();
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
  try { scheduleInner(); }
  catch (e){
    // 出错就降级静音，别让它在 setInterval 里每 120ms 抛一次 ——
    // 那种情况音乐彻底没了但页面照常跑，只有控制台看得出来
    if (mTimer){ clearInterval(mTimer); mTimer = 0; }
  }
}
function scheduleInner(){
  if (!actx || actx.state !== 'running') return;
  const ahead = actx.currentTime + .35;
  let guard = 0;
  while (mAt < ahead && guard++ < 64){
    const cur = MELODY[mIdx % MELODY.length];
    if (!cur) { mIdx = 0; break; }
    const [note, len] = cur;
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

// 切歌统一走这里：重置指针（不重置的话新旋律比旧的短会让 MELODY[mIdx]
// 解构 undefined）、旧 sub-gain 单独淡出后断开，避免两首重叠。
function switchTrack(i){
  trackIdx = clamp(i, 0, TRACKS.length - 1);
  const t = TRACKS[trackIdx];
  MELODY = t.melody; BASS = t.bass; baseBpm = t.bpm;
  setTempo(t.bpm);
  mIdx = 0; mBar = 0; mBeat = 0;
  try { localStorage.setItem(TRACK_KEY, String(trackIdx)); } catch { /* 忽略 */ }
  if (actx && trackGain){
    const old = trackGain, now = actx.currentTime;
    old.gain.cancelScheduledValues(now);
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.linearRampToValueAtTime(.0001, now + .05);
    // 断开时机按「最后一个已排期音符的结束」推，别写死
    const safe = Math.max(.45, (mAt - now) + .3);
    setTimeout(() => { try { old.disconnect(); } catch { /* 已经断了 */ } }, safe * 1000);
    trackGain = null;
  }
  if (mTimer){ clearInterval(mTimer); mTimer = 0; }
  if (actx) mAt = actx.currentTime + .12;
  syncMusic();
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

// ───────────────────────── 疯狂版 ─────────────────────────
// 所有疯狂逻辑收在这一段里。核心函数只允许留一个钩子调用，
// 不往 lockPiece / scoreFor / spawn 里散 `if (CRAZY)` ——
// 否则半年后没人分得清哪行是给谁的。

// 这几个数是按「疯狂版中位 = 标准版的 2~3 倍」反推出来的。
// 第一版（1/16、10 秒、×3）实测只有 1.24 倍 —— FEVER 十秒只盖得住三次消行，
// 一局三百行里被加成的占比太小。
const GOLD_RATE = 1 / 10;        // 黄金方块出现概率
const GOLD_MULT = 3;
const FEVER_MS = 20000;          // 一次 FEVER 多长（走 game.elapsed，不是墙钟）
const FEVER_MULT = 4;
const PITY_DIV = 55;             // 保底斜率：越小触发越勤
const RAIN_MAX = 3;              // 行雨一局最多几次
const RAIN_ROWS = 3;

let feverLeft = 0;               // 剩余 FEVER 时间（ms，游戏时间）
let feverPity = 0;               // 保底计数：每次消行没中就 +1
let rainLeft = RAIN_MAX;
let goldPending = false;         // 这一杆锁下去的块是不是金的

function crazyReset(){
  feverLeft = 0; feverPity = 0; rainLeft = RAIN_MAX; goldPending = false;
  activePal = null;
  document.body.classList.remove('fever');
  if (CRAZY) setTempo(baseBpm);
}

// 钩子①：出块时摇黄金。只挂在 piece 实例上 ——
// holdPiece 只搬 game.piece.type，实例属性天然丢失，白送一个「进 hold 就掉金」。
// 盘面格子和 queue 都是字符串，一个字节都不用动。
function crazyOnSpawn(p){
  if (!CRAZY) return;
  p.mod = rndFx() < GOLD_RATE ? 'gold' : null;
}

// 钩子②：锁定时记下这块是不是金的（scoreFor 里 game.piece 已经是 null 了）
function crazyOnLock(p){
  if (!CRAZY) return;
  goldPending = p.mod === 'gold';
}

// 钩子③：算分时的倍数。金块 ×2、FEVER ×3，两者相乘。
function crazyScoreMult(){
  if (!CRAZY) return 1;
  let m = 1;
  if (goldPending) m *= GOLD_MULT;
  if (feverLeft > 0) m *= FEVER_MULT;
  return m;
}

// 钩子④：每"次"消行掷一次骰（不是每行）。没中时按消行数加权 +n%，
// 这样打单行和打 TETRIS 的触发频率都不吃亏。线性保底，期望约 12 次消行一次。
function crazyOnClear(lines){
  if (!CRAZY || lines <= 0) return;
  goldPending = false;
  if (feverLeft > 0) return;
  feverPity += lines;
  if (rndFx() < feverPity / PITY_DIV){ feverPity = 0; feverStart(); }
}

function feverStart(){
  feverLeft = FEVER_MS;
  activePal = 'classic';
  staticDirty = true; previewDirty = true; needsDraw = true;
  document.body.classList.add('fever');
  showToast('FEVER  ×' + FEVER_MULT);
  buzz([40, 30, 40, 30, 90]);
  sfx('tetris', 1.26);
  if (musicOn && !muted) setTempo(Math.round(baseBpm * 1.22));
}
function feverEnd(){
  feverLeft = 0;
  activePal = null;
  staticDirty = true; previewDirty = true; needsDraw = true;
  document.body.classList.remove('fever');
  setTempo(baseBpm);
}

// 钩子⑤：行雨 = 濒死豁免。灰线马上要顶出去时才触发，一局最多三次。
// 不计 lines、不给分、不动 combo/b2b —— 它是纯清障，不是奖励，
// 否则「赖在危险区刷免费消行」会变成最优解。
// 优先清最底下的灰线行，清不满就补普通行。
function crazyRescue(){
  if (!CRAZY || rainLeft <= 0) return false;
  rainLeft--;
  const rows = [];
  for (let y = TOTAL_ROWS - 1; y >= 0 && rows.length < RAIN_ROWS; y--)
    if (game.board[y].some(c => c === GARBAGE)) rows.push(y);
  for (let y = TOTAL_ROWS - 1; y >= 0 && rows.length < RAIN_ROWS; y--)
    if (!rows.includes(y) && game.board[y].some(Boolean)) rows.push(y);
  if (!rows.length) return false;
  for (const y of rows) burstRow(y);
  applyClear(rows);                 // 直接塌陷，不走 scoreFor
  showToast(`行雨！剩 ${rainLeft} 次`);
  sfx('tetris', .84);
  buzz([60, 40, 60]);
  return true;
}

// ───────────────────────── 主循环 ─────────────────────────

// 一步逻辑。不画、不排 rAF —— 这样 harness 能脱离真实时钟高速驱动。
// 返回 'stop' / 'clearing' / 'normal'，由调用方决定怎么画。
function stepOnce(dt){
  if (game.paused || game.over || game.frozen) return 'stop';

  stepParticles(dt);
  stepTrails(dt);
  stepFx(dt);
  handleAutoRepeat(dt);

  // 灰线倒计时（消行动画期间不推进，免得叠在一起）
  if (feverLeft > 0){
    feverLeft -= dt;
    if (feverLeft <= 0) feverEnd();
  }
  if (!clearing && game.piece){
    game.elapsed += dt;
    // FEVER 期间灰线暂停 —— 这比「重力减半」有感知得多（重力本来就不痛）
    if (feverLeft <= 0) garbageTimer += dt;
    const period = garbagePeriod();
    if (!game.noGarbage && feverLeft <= 0 && garbageTimer >= period){
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
  if ((needsDraw || particles.length || trails.length || clearing) && now - lastDrawAt >= 32){
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
    ['btnCw',    () => { preHeld.cw = true;  tryRotate(1);  }, () => { preHeld.cw = false;  }],
    ['btnCcw',   () => { preHeld.ccw = true; tryRotate(-1); }, () => { preHeld.ccw = false; }],
    // 软降引擎里本来就有（20 倍重力、每格 +1 分），以前只有键盘 ↓ 能用
    ['btnSoft',  () => { softDropping = true; },  () => { softDropping = false; }],
    ['btnDrop',  () => hardDrop(),      null],
    // HOLD 走同一套 touch 处理，不然它比别的键慢半拍（click 要等浏览器确认不是双击/滚动）
    ['holdSlot', () => { preHeld.hold = true; holdPiece(); }, () => { preHeld.hold = false; }],
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
  if (feverLeft > 0 && $('styleSheet').hidden){ showToast('FEVER 期间不能开面板'); return; }
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
  bestBeaten = false;
  dangerOn = false;
  shownScore = 0;
  crazyReset();
  trails.length = 0;
  sweeps.length = 0;
  rings.length = 0;
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
  if (feverLeft > 0){ showToast('FEVER 期间不能暂停'); return; }
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
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* 忽略 */ }
}

function syncMuteBtn(){
  const b = $('muteBtn');
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-label', muted ? '音效已关' : '音效已开');
  b.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

// 设置面板里的两排三选一
function buildAudioPanel(){
  const tw = $('trackOpts'), pw = $('packOpts');
  if (!tw || !pw) return;
  tw.innerHTML = '';
  TRACKS.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (i === trackIdx ? ' on' : '');
    b.textContent = t.name;
    b.addEventListener('click', () => { switchTrack(i); buildAudioPanel(); });
    tw.appendChild(b);
  });
  pw.innerHTML = '';
  Object.keys(SFX_PACKS).forEach(k => {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (k === sfxPack ? ' on' : '');
    b.textContent = SFX_PACKS[k].name;
    b.addEventListener('click', () => { setPack(k); buildAudioPanel(); sfx('clear'); });
    pw.appendChild(b);
  });
}

// ───────────────────────── 启动 ─────────────────────────

// 返回「这次真的清掉了一个成绩」，只有那样才值得弹提示
function applyWipe(){
  if (!WIPE_TOKEN) return false;
  try {
    if (localStorage.getItem(WIPE_KEY) === WIPE_TOKEN) return false;
    const had = parseInt(localStorage.getItem(STORE_KEY) || '0', 10) || 0;
    // 旧纪录留一份：个人小游戏里最高分就是全部的意义，别直接抹掉。
    // 加条件，免得第二次清档把 legacy 覆盖成 0
    const oldLegacy = readLegacy();
    if (had > 0 && had > oldLegacy) localStorage.setItem(LEGACY_KEY, String(had));
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
    muted = localStorage.getItem(MUTE_KEY) === '1';
    buzzOn = localStorage.getItem(BUZZ_KEY) !== '0';
    musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
    const tk = +localStorage.getItem(TRACK_KEY); if (tk >= 0 && tk < TRACKS.length) trackIdx = tk;
    const pk = localStorage.getItem(PACK_KEY); if (pk && SFX_PACKS[pk]) sfxPack = pk;
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

  MELODY = TRACKS[trackIdx].melody; BASS = TRACKS[trackIdx].bass;
  baseBpm = TRACKS[trackIdx].bpm; setTempo(baseBpm);
  SPECS = SFX_PACKS[sfxPack];
  buildAudioPanel();

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

  // 点按走上面的映射表（touch 优先），这里只补键盘可达性
  const hs = $('holdSlot');
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
window.__tetris = { game, PIECES, TRACKS, SFX_PACKS, CRAZY, NS,
  get fever(){ return feverLeft; }, get rainLeft(){ return rainLeft; }, get feverPity(){ return feverPity; },
  feverStart, crazyRescue, switchTrack, setPack, setTempo,
  get trackIdx(){ return trackIdx; }, get sfxPack(){ return sfxPack; }, cellsOf, collides, restart, riseGarbage, clearStyle, popScore, garbagePeriod, garbageClock, gravityFor, levelMult, edgeColor, syncEdge, MAX_LEVEL,
  step, stepOnce, setSeed, hardDrop, tryRotate, holdPiece, tryMove, lockPiece, LINES_PER_LEVEL, COLS, ROWS, BUFFER, TOTAL_ROWS,
  dbg, peek: () => ({ clearing, grounded, lockTimer, dropTimer, frames: dbg.frames, layouts: dbg.layouts, needsDraw, staticDirty, previewDirty, parts: particles.length, sweeps: sweeps.length, rings: rings.length }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
