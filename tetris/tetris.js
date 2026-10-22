/* 俄罗斯方块 —— 按现代 Guideline 实现
   7-bag 随机 / SRS 旋转 + wall kick / hold / ghost / lock delay /
   T-spin / back-to-back / combo。纯 Canvas，无依赖。 */
(() => {
'use strict';

// ───────────────────────── 常量 ─────────────────────────

// 疯狂版跟标准版同一份代码，靠这个开关分流。页面在加载 tetris.js 之前设它。
const CRAZY = !!window.TETRIS_CRAZY;

// ── 测试开关：每一局都是狂欢局 ──
// 正常态是关的，狂欢局按保底计数攒（见 takeRush / rushEvery）。
// 要连着测狂欢局就在网址后面加 ?rush=1。
//
// 打开时刻意不碰保底计数 —— 既不消耗也不累加，免得测试局把真实进度搅了。
// 分数、最高分、累计、今日最佳照常记：它就是真的狂欢局，只是不用等。
const FORCE_RUSH = CRAZY && /[?&]rush=1\b/.test(location.search);
const NS = CRAZY ? 'crazy' : 'tetris';
// 所有 localStorage 访问统一走这里，禁止写裸字符串 —— 之前就漏过
// 内联的 'tetris.muted.v1'（不在常量块里，按常量块改会漏掉）
const nsKey = (name) => `${NS}.${name}`;

const COLS = 10;
const ROWS = 20;        // 可见行
const BUFFER = 2;       // 顶部隐藏行，方块在这里出生
const TOTAL_ROWS = ROWS + BUFFER;

// 配色。每套给七种块各一个颜色；mono 的七个一样（只看形状），画格子时会强制补一道描边，免得糊成一片。
// 分五组：主流经典 / NES 各等级 / 主题 / 同色系（一个色相七种深浅）/ 单色。
// 盘面底色很深（#0a1020 上下），原版里最暗的那几级（Game Boy 的墨绿、NES 的深色）照搬会看不见，都往亮处提过。
const mono = (c) => ({ mono: true, I:c, O:c, T:c, S:c, Z:c, J:c, L:c });
// NES：每一级只有两个颜色。T / O / I 是白芯带边（这里取偏白的那个），J、Z 用第一色，L、S 用第二色
const nesPal = (a, b) => ({ I: mix(a, '#ffffff', .78), O: mix(a, '#ffffff', .78), T: mix(a, '#ffffff', .78), J: a, Z: a, L: b, S: b });
// 同色系：一个色相，七种明度错开排，常挨在一起的块（S/Z、J/L）深浅拉得最开
const tone = (h, sat) => {
  const L = { I: 78, O: 66, T: 48, S: 72, Z: 54, J: 42, L: 60 };
  const o = {};
  for (const k in L) o[k] = hslHex(h, sat, L[k]);
  return o;
};
function hslHex(h, s, l){
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}

const PALETTES = {
  // ── 主流经典 ──
  // 原版：Tetris Guideline 规定的七色，街机厅里那套。纯 #0000F0 在深色底上太沉，J 往上提了一点，其余照搬
  guide:   { I:'#00f0f0', O:'#f0f000', T:'#a000f0', S:'#00f000', Z:'#f00000', J:'#2b3df0', L:'#f0a000' },
  // 主机亮色：近几年主机 / 手机版（同一套色相，更亮更饱和）
  console: { I:'#2fd9ff', O:'#ffe133', T:'#c04fff', S:'#4dee4d', Z:'#ff3d3d', J:'#3d6cff', L:'#ff9a1f' },
  // TGM 街机：I 红、T 青、S 紫、Z 绿 —— 和 Guideline 对不上的那一派
  tgm:     { I:'#e0342c', O:'#f2d021', T:'#1fc6e0', S:'#d23fd0', Z:'#3bcf3b', J:'#2f5fe0', L:'#f08a1c' },
  // Jstris：网页对战圈最常见的那套，颜色沉一点
  jstris:  { I:'#0f9bd7', O:'#e39f02', T:'#af298a', S:'#59b101', Z:'#d70f37', J:'#2141c6', L:'#e35b02' },
  // Game Boy：四级墨绿，提亮到深底上看得见
  gb:      { I:'#c7dc7a', O:'#9bbc0f', T:'#8bac0f', S:'#b5cf4a', Z:'#7c9e1e', J:'#a6c43c', L:'#6b8e23' },
  // Game Boy Pocket：灰阶
  gbp:     { I:'#e6e6e6', O:'#c8c8c8', T:'#b0b0b0', S:'#d6d6d6', Z:'#9a9a9a', J:'#bcbcbc', L:'#a4a4a4' },
  // ── NES：红白机每一级换一套 ──
  nes0: nesPal('#3c7cfc', '#3cbcfc'), nes1: nesPal('#00b800', '#b8f818'), nes2: nesPal('#d800cc', '#f878f8'),
  nes3: nesPal('#3c7cfc', '#58d854'), nes4: nesPal('#e40058', '#58f898'), nes5: nesPal('#58f898', '#6888fc'),
  nes6: nesPal('#f83800', '#9c9c9c'), nes7: nesPal('#6844fc', '#d82848'), nes8: nesPal('#3c7cfc', '#f83800'),
  nes9: nesPal('#f83800', '#fca044'),
  // ── 主题 ──
  // 高区分：青/蓝/紫的明度拉开、红橙黄错开，相邻色块更好分，饱和度略降，久看不累（默认）
  clear:   { I:'#5ee7f5', O:'#f2c14e', T:'#a463dd', S:'#56c877', Z:'#e8546b', J:'#3f6fd0', L:'#ef8f4a' },
  classic: { I:'#22d3ee', O:'#fbbf24', T:'#a855f7', S:'#4ade80', Z:'#f43f5e', J:'#3b82f6', L:'#fb923c' },
  // 马卡龙：同一套色相，明度拉高饱和度压低，久看不刺眼
  candy:   { I:'#7fe3e8', O:'#f5d77a', T:'#c49be8', S:'#93dda1', Z:'#f2938f', J:'#8faee8', L:'#f0b87e' },
  // 色盲友好：Okabe–Ito 那套七色，红绿色弱也分得开
  okabe:   { I:'#56b4e9', O:'#f0e442', T:'#cc79a7', S:'#009e73', Z:'#d55e00', J:'#3a8fd6', L:'#e69f00' },
  fog:     { I:'#7fb3bf', O:'#cbb67a', T:'#a08fbf', S:'#86b394', Z:'#c48a8a', J:'#7f93bf', L:'#c9a27c' },
  retro:   { I:'#5fa8a0', O:'#e0b84f', T:'#9b6fa8', S:'#7aa65a', Z:'#c75b4a', J:'#5a7fb0', L:'#d98a4a' },
  sakura:  { I:'#f6b4c8', O:'#ffd6a5', T:'#e3a6e8', S:'#bfe3b4', Z:'#f08aa0', J:'#b8b8f0', L:'#f7c08a' },
  ocean:   { I:'#7fe0f0', O:'#a8e6cf', T:'#5b8def', S:'#3fc1c9', Z:'#4a6fb5', J:'#2e86de', L:'#8fb3ff' },
  sunset:  { I:'#ffcf6b', O:'#ffe29a', T:'#c4568f', S:'#ff9f68', Z:'#e2435c', J:'#9a5fb8', L:'#ff7a45' },
  forest:  { I:'#a3d977', O:'#e5d36b', T:'#7f9f5e', S:'#4caf50', Z:'#c0753a', J:'#2e8d6b', L:'#d4a24c' },
  cyber:   { I:'#00f5ff', O:'#f9f871', T:'#bd00ff', S:'#00ff9f', Z:'#ff2079', J:'#6f6fff', L:'#ff8b3d' },
  // ── 同色系 ──
  tBlue: tone(212, 78), tPurple: tone(268, 70), tGreen: tone(145, 55), tWarm: tone(24, 85), tPink: tone(330, 72), tTeal: tone(185, 70),
  // ── 单色：只看形状，不看颜色 ──
  cyan:  mono('#4fd8e8'),   // 和界面同一个调子
  mint:  mono('#5fd99a'),   // 老绿屏终端的味道
  white: mono('#dfe6f0'), gold: mono('#f2c14e'), pink: mono('#f48fb1'), violet: mono('#a78bfa'),
  orange: mono('#fb923c'), red: mono('#f87171'), blue: mono('#60a5fa'), gray: mono('#94a3b8'),
};

const PAL_NAMES = {
  guide: '原版', console: '主机亮色', tgm: 'TGM 街机', jstris: 'Jstris', gb: 'Game Boy', gbp: 'GB 灰',
  nes0: 'NES 0 级', nes1: 'NES 1 级', nes2: 'NES 2 级', nes3: 'NES 3 级', nes4: 'NES 4 级',
  nes5: 'NES 5 级', nes6: 'NES 6 级', nes7: 'NES 7 级', nes8: 'NES 8 级', nes9: 'NES 9 级',
  clear: '高区分', classic: '霓虹', candy: '马卡龙', okabe: '色盲友好', fog: '雾灰', retro: '复古',
  sakura: '樱花', ocean: '海洋', sunset: '日落', forest: '森林', cyber: '赛博',
  tBlue: '蓝调', tPurple: '紫调', tGreen: '绿调', tWarm: '暖橙', tPink: '粉调', tTeal: '青调',
  cyan: '青', mint: '薄荷', white: '白', gold: '金', pink: '粉', violet: '紫', orange: '橙', red: '红', blue: '蓝', gray: '灰',
};
const PAL_GROUPS = [
  ['主流经典', ['guide', 'console', 'tgm', 'jstris', 'gb', 'gbp']],
  ['NES 红白机 · 每一级的配色', ['nes0', 'nes1', 'nes2', 'nes3', 'nes4', 'nes5', 'nes6', 'nes7', 'nes8', 'nes9']],
  ['主题', ['clear', 'classic', 'candy', 'okabe', 'fog', 'retro', 'sakura', 'ocean', 'sunset', 'forest', 'cyber']],
  ['同色系 · 一个颜色七种深浅', ['tBlue', 'tPurple', 'tGreen', 'tWarm', 'tPink', 'tTeal']],
  ['单色 · 只看形状', ['cyan', 'mint', 'white', 'gold', 'pink', 'violet', 'orange', 'red', 'blue', 'gray']],
];
const PAL_ORDER = PAL_GROUPS.flatMap(g => g[1]);

// 画法。gap 缝隙 / fill 填充压暗 / edge 描边提亮(0 不描) / lw 线宽 / rad 圆角 / ring 暗外圈
// gap 是每格四边各内缩多少（占格宽的比例），两格之间的缝 = 2 × gap。
// 原来默认的「纯色」是 .08，缝占了格宽的 16%，堆起来像一格一格的瓷砖、不像一整块。
// 统一收到 .03 上下（缝 6%），圆角也跟着收一点 —— 圆角越大，四个角漏出的底色越多，同样显得空。
// 带 kind 的是另画的几种（立体 / 玻璃 / 宝石 / 红白机 / 掌机 / 空心 / 方砖 / 霓虹光），见 drawKind
const STYLES = {
  gap:   { name:'标准',  gap:.03,  fill:.14, edge:.30, lw:.07, rad:.15 },
  soft:  { name:'柔和',  gap:.035, fill:.22, edge:.40, lw:.06, rad:.20 },
  ring:  { name:'暗圈',  gap:.025, fill:.14, edge:.32, lw:.07, rad:.15, ring:.40 },
  plain: { name:'纯色',  gap:.035, fill:.10, edge:0,   lw:0,   rad:.16 },
  bevel: { name:'立体',  gap:.02,  rad:.04, kind:'bevel' },
  gloss: { name:'玻璃',  gap:.03,  rad:.18, kind:'gloss' },
  gem:   { name:'宝石',  gap:.03,  rad:.12, kind:'gem' },
  nes:   { name:'红白机', gap:.04, rad:0,   kind:'nes' },
  gbpx:  { name:'掌机',  gap:.04,  rad:0,   kind:'gb' },
  hollow:{ name:'空心',  gap:.06,  rad:.14, kind:'hollow' },
  flat:  { name:'方砖',  gap:.015, rad:0,   kind:'flat' },
  neon:  { name:'霓虹光', gap:.07, rad:.18, kind:'neon' },
};

const skin = { pal: 'clear', style: 'plain' };
let activePal = null;   // FEVER 期间临时换肤用，不落盘
const PRESET_COLOR = '#5d6b86';   // 练习关卡预置格子的颜色，见画盘面那里
function colorOf(type){
  if (type === GARBAGE) return '#93a4c4';
  if (type === FROZEN)  return '#8fd8ff';
  if (type === CHEST)   return '#ffd23f';
  if (type === ZONE)    return '#6b4fd8';
  return PALETTES[activePal || skin.pal][type];
}

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
// 锁定模式。Guideline 给了三种，不是一种：
//   Infinite Placement —— 每次移动/旋转都重置，没有次数上限
//   Extended Placement —— 15 次上限，且落到更低的新行时重置（Guideline 默认值）
//   Classic            —— 只有往下掉才重置
//
// 这里选 Infinite。之前的实现是第四种、比三种都严：15 次上限但**从不重置**
// （实测蹭满之后 lockTimer 450→450 不再回退，掉到更低的新行额度也还是 15）。
// 在手机上这条尤其疼 —— 五个按键、没有 DAS 微调，贴地之后调整位置本来就慢，
// 而 T 旋要求的正是「贴地之后再转」。
//
// 没有刷分口子：灰线按墙钟涨、热度按墙钟衰减，磨蹭只会让局面更差；
// 贴墙按住也续不了命（tryMove 撞到就 return false，根本走不到 touchGround）。
// 计数本身留着，lockPiece 还靠它说那句「你在那磨蹭什么」。
const LOCK_RESET_LIMIT = Infinity;
// 横移手感三档（样式面板里选，按设备记住，两个版本共用）。
//   DAS = 按住方向键多久开始连发，ARR = 连发之后每格间隔
// 原来写死 150/40。改成 110/25 之后用户反馈「按一下左右直接就跑过去了，对不齐」：
// 手指在屏幕上按一下常常就有 0.1 秒出头，110ms 起步等于轻点也会触发连发。
// 现在默认「快」= 140/36，只比原来的 150/40 灵敏一点点；三档都往慢收了一截。
const HANDLING = {
  steady: { name: '稳',   das: 165, arr: 45 },
  fast:   { name: '快',   das: 140, arr: 36 },
  faster: { name: '很快', das: 115, arr: 28 },
};
const HANDLING_KEY = 'tetris.handling.v1';
let handling = 'fast';
try { const h = localStorage.getItem(HANDLING_KEY); if (HANDLING[h]) handling = h; } catch { /* 读不到就用默认 */ }
let DAS = HANDLING[handling].das;
let ARR = HANDLING[handling].arr;
function setHandling(k){
  if (!HANDLING[k]) return;
  handling = k; DAS = HANDLING[k].das; ARR = HANDLING[k].arr;
  try { localStorage.setItem(HANDLING_KEY, k); } catch { /* 存不了就算了 */ }
}
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
// 每消几行升一级。等级 = 消行数/LINES_PER_LEVEL + 1，现在 6 行一级，
// 所以满级（20 级）要 19×6 = 114 行。
// 7 行一级的时候熟练玩家 95% 的局都能满级，等级系统对他们等于不存在；
// 提到 9 行之后满级重新变成「打得好才摸得到」。
// 9 → 6：升级快 50%，等级倍率和重力一起提速。节奏加快最直接的一刀 ——
// levelMult 不封顶，所以同样行数下等级更高、每行更值；重力也跟着快，局更短。
const LINES_PER_LEVEL = 6;
const FALL_TOP = 1000;   // level 1：一秒一格 = 满屏 20 秒
const FALL_END = 400;    // level 20：满屏 8 秒（标准版到此为止）

// 疯狂版不封顶：指数逼近 200ms，永远在收紧、永远到不了。
//   间隔 = 200 + 800 · e^(-(lvl-1)/16)
// 中段和标准版几乎重合，20 级附近反而松一口气（444 vs 400），
// 之后一路往下磨。要的就是「缓一点，但没有水平段」——
// 标准版 20 级之后重力是条直线，高手会明确感到「不会更难了」。
const CRAZY_FALL_FLOOR = 200;
// 16 → 26：每级行数从 9 收到 6 之后，同样的行数会升 1.5 倍的级，重力也跟着
// 快 1.5 倍 —— 局被压到只剩三五分钟。等级要留给分数（levelMult 不封顶），
// 但难度不该跟着翻倍，所以把重力曲线按同样的比例拉平，让「多少行时多快」
// 回到原来的手感。
const CRAZY_FALL_K = 32;
function gravityFor(lvl){
  if (CRAZY){
    const L = Math.max(1, lvl);
    return CRAZY_FALL_FLOOR + (FALL_TOP - CRAZY_FALL_FLOOR) * Math.exp(-(L - 1) / CRAZY_FALL_K);
  }
  const t = (clamp(lvl, 1, MAX_LEVEL) - 1) / (MAX_LEVEL - 1);
  return FALL_TOP * Math.pow(FALL_END / FALL_TOP, t);
}

// 垃圾行。下落速度不变，所以「越玩越难」全靠这条线升得越来越快。
//
// 用指数衰减的曲线，不是按等级跳台阶：
//   周期 = MIN + (MAX - MIN) · e^(-t / TAU)
// 开局 G_MAX 秒一行，之后一路平滑压向 G_MIN 封顶（标准版 45→15 秒，
// 疯狂版 36→7 秒，疯狂版落差更大是因为它要把局收进 5~20 分钟）。
// 两头都得留够距离：只提封顶不提开局的话曲线会压扁成「每 27 秒恒定来一行」，
// 难度爬升就没了；只提开局不收尾段的话后期躺平，一局能拖到十分钟以上。
// 不会出现「刚好卡在升级线上突然难一截」的断层。
//
// G_LINE_BONUS 曾经是 1200（每消一行给难度钟多推 1.2 秒），现在设 0。
// 模拟发现它专门惩罚打得好的人：熟练档一局消 150 行，等于白送难度钟 180 秒，
// 越会玩、灰线来得越凶。去掉之后难度钟就是纯已玩时长，对谁都一样。
// ⚠️ 这四个标记和方块类型（I O T S Z J L）共用同一个格子字段，所以**不能撞字母**。
// 已经栽过一次：ZONE 原本写成 'Z'，和 Z 型方块同字母 —— Z 块落下去被当成死行画，
// 而且一整行 Z 块会被判成「死行」永远消不掉（那条扫描不只在 ZONE 期间跑）。
// tools/audit.py 现在会拦这个。往下加标记前先确认字母没被占。
const GARBAGE = 'X';
const FROZEN  = 'F';   // 冰冻格：整行要消两次才掉
const CHEST   = 'C';   // 灰线里的宝箱：消掉那一行就开
const ZONE    = '@';   // ZONE 期间沉到底部的死行：是实心的（会把堆顶上去），但不算满行
// 疯狂版灰线更凶：FEVER 的「灰线暂停」和行雨的「清灰线」都得有东西可对抗，
// 取消灰线这两个机制就空转了
// 疯狂版比标准版凶得多。灰线钟走的是绝对时间、跟手速无关，所以它是唯一
// 真正决定一局多长的旋钮 —— 摊平那一版各档手速全被钉在 9~19 分钟，太久。
const G_MAX = CRAZY ? 36000 : 45000;     // 开局周期（再放慢，少出 <5 分钟的局）
const G_MIN = CRAZY ?  7000 : 15000;     // 后期压紧一点，别超 20 分钟
const G_TAU = CRAZY ? 260000 : 300000;   // 衰减时间常数，越大掉得越慢
const G_LINE_BONUS = 0;      // 消行不再推快难度钟

// 满级（20 级）之后的加压：每再升一级，灰线周期再收 3%，没有上限。
// 不加这条的话三条难度线全有天花板，15 分钟之后难度就是一条水平线，
// 实测接近满分的 AI 能连打 100 分钟不死（12000 块上限都撑得到）。
// 挂在消行数上而不是时间上：能活过 171 行的人必然在持续消行，
// 等于「打得越好压得越快」—— 这条反向激励只在满级之后才生效。
// 满级之后的加压。标准版是 20 级起每级 ×0.97 —— 一道悬崖。
// 疯狂版改成 15 级起每级 ×0.985：开始得早一点、爬得慢得多，摊成一道缓坡。
const G_OVER_FROM = CRAZY ? 15 : MAX_LEVEL;
const G_OVER_RATE = CRAZY ? .985 : .97;
const G_HARD_MIN = 1000;     // 再快也不低于 1 秒：到这份上谁都必死，
                             // 而且一帧塞进好几行会直接卡死

function garbageClock(){
  return game.elapsed + game.lines * G_LINE_BONUS;
}
// 狂欢局灰线涨得快得多（RUSH_GARBAGE 0.70 = 快 43%）—— 它有 RUSH_MULT
// 的分数倍率，就得有对应的代价，
// 否则刷到一局就是白赚。挑灰线钟而不是 level：level 快了 levelMult 跟着涨，
// 分数反而更高，越平衡越失衡。灰线是纯加压，不直接给分。
// .55 → .70：狂欢局中位只有 4.8 分钟、51/90 局不到 5 分钟，够不到 5~20 分的
// 目标区间。放慢灰线让它活得久一点，顺带能打到更多行。
const RUSH_GARBAGE = .70;      // 灰线周期，越小涨得越快
function garbagePeriod(){
  let p = G_MIN + (G_MAX - G_MIN) * Math.exp(-garbageClock() / G_TAU);
  const over = game.level - G_OVER_FROM;
  if (over > 0) p *= Math.pow(G_OVER_RATE, over);
  if (game.rush) p *= RUSH_GARBAGE;
  p *= upMul('garb');            // 薄冰：灰线更快
  return Math.max(G_HARD_MIN, p);
}

// ── 一次性清档 ──
// 改这个值（随便填个新字符串）= 每个人下次打开时清掉最高分和未完成的存档，
// 清完把新值写回本地，之后再刷新就不会再清，新成绩正常保存。
// 空字符串 = 不清任何东西。
// 只在记分规则变了、老分数变得够不着的时候才动它，别跟着每次发版改。
// 清档令牌按 NS 分开取值，否则为标准版 bump 会连带把疯狂版的最高分清掉
// 疯狂版加了热度倍率并解除等级封顶，中位分从 89 万跳到 736 万（8.3 倍），
// 老纪录彻底够不着了，清一次。标准版记分规则没动，令牌保持原样。
// 2026-10-03 再清一次疯狂版：删掉燃点之后，高热度狂欢局的分数掉了一个
// 数量级（同样热度原来能被燃点推到 ×600+，现在就是基础倍率），而旧纪录
// 正是在那个倍率下打出来的，留着会让新梯子永远够不着。标准版没动。
const WIPE_TOKENS = { tetris: '2026-09-23-level20', crazy: '2026-10-03-noburn' };
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
const TOTAL_KEY = nsKey('total.v1');      // 生涯累计分
const DAILY_KEY = nsKey('daily.v1');      // 今日最佳（按北京时间归日）
const SAVE_KEY  = nsKey('save.v1');       // 隔离：疯狂版的存档不能被标准版 restore
const LEGACY_KEY = nsKey('best.legacy');  // 清档时把旧纪录留一份
const RECENT_KEY = nsKey('recent.v1');    // 最近若干局的分数，给「目标线」用
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
  // Number.isFinite 守卫：分数真要算出 Infinity，存进去是字符串 "Infinity"，
  // parseInt 回来 NaN，|| 0 直接变 0 —— 最高分和生涯累计当场清零，
  // 没有报错也没有线索。
  try { const v = parseInt(localStorage.getItem(STORE_KEY) || '0', 10);
        return Number.isFinite(v) && v >= 0 ? v : 0; }
  catch { return 0; }          // 隐私模式下 localStorage 会抛异常
}
function writeBest(v){
  try { localStorage.setItem(STORE_KEY, String(v)); } catch { /* 存不了就算了 */ }
}
function readTotal(){
  try { const v = parseInt(localStorage.getItem(TOTAL_KEY) || '0', 10);
        return Number.isFinite(v) && v >= 0 ? v : 0; }
  catch { return 0; }
}
function addTotal(v){
  try { localStorage.setItem(TOTAL_KEY, String(readTotal() + v)); } catch { /* 忽略 */ }
}

// ── 称号 ──
// 两条独立的梯子，量的是两件不同的事：
//   最强   = 你单局最高打到过多少 —— 「你有多强」
//   段位   = 你一共打出过多少分   —— 「你玩了多久」
// 都从存档里现算，不另存状态：最高分和累计分只增不减，算出来的结果天然单调。
// 最强 · 看单局最高分。⚠ 下面这句「10 万摆第三档、100 万摆第七档」是
// 整体 ×10、×2 两次重标**之前**的描述，现在第三档是 2400 万、第七档 1.9 亿。
// 原文：门槛按真实分数定：普通局 10 万、最好 100 万，
// 所以 10 万摆在第三档（常驻位），100 万落在第七档，上面还留三格看得见。
// 火焰这条隐喻和游戏的核心机制是同一件事 —— 一局就是一次燃烧：
// 热度起来、烧到顶、然后熄灭。
// 节奏提速后整体分数接近翻倍，旧阶梯 10 分钟就能打穿顶格，整体 ×10 重标。
// 对照新实测（普通局整局中位 335 万 / 10~15 分 556~1348 万 / 400 行 3861 万）：
// 一局普通水平落在 烈阳~熔金，打满 10~15 分钟在 炽天~紫微，打到 400 行是 鸿蒙。
// 整体 ×2（2026-10-01）。衰减 45s→135s 把热度平台抬了 3 倍，倍率跟着从
// ×9.3 到 ×13.6；深局形状也改了。实测同 50 行处普通局 ×1.44、狂欢局 ×3.01，
// 取中间的整数 ×2。
// 关键是**保持档间距比例**：梯子的手感全在档之间的跨度上，
// 按「取整到 1/2/5」会把比例压歪（试过一版，赤霄和烈阳挨得过近、
// 熔金又凭空翻倍）。现在按 2 位有效数字取整，档间距漂移 ≤3%。
const RANKS = [
  [7200000,    '微光'],
  [14000000,    '星火'],
  [24000000,  '流焰'],
  [42000000,  '赤霄'],
  [72000000,   '烈阳'],
  [120000000,   '熔金'],
  [190000000,   '炽天'],
  [280000000, '紫微'],
  [480000000, '曜极'],
  [720000000,  '太一'],
  // 太一在道家里已经是本源，再往上只能往「天地未开」那头走：
  // 无极生太极 —— 鸿蒙是未分之气，无极是没有边界，都排在太一之前/之上。
  [960000000,  '鸿蒙'],
  [1200000000,  '无极'],
];
// 段位 · 看累计总分。前七档是按「一局 10 万」铺的，实测一局能打三百万，
// 所以王者二十局就到顶了。已有的阈值不动 —— 往上调等于把已经爬到的人降级，
// 比早期爬得快更难受。坡度加在顶上：王者之上还有荣耀王者、传奇王者。
// 跟着 ×5（不是 ×10 —— 累计分涨得比单局快，局也变短了）。
// 按 10~15 分钟一局 800 万算：王者 38 局、荣耀王者 62 局、传奇王者 150 局。
const CAREER = [
  [120000000,    '青铜'],
  [480000000,   '白银'],
  [1100000000,   '黄金'],
  [2200000000,  '铂金'],
  [3600000000,  '钻石'],
  [5400000000,  '星耀'],
  [7200000000,  '王者'],
  [12000000000,  '荣耀王者'],
  [28000000000, '传奇王者'],
];
function tierOf(table, v){
  let hit = null;
  for (const t of table){ if (v >= t[0]) hit = t; else break; }
  return hit;
}
const rankOf   = (v) => tierOf(RANKS, v);
// ── 狂欢局 ──
// 开局给的一次机会：整局分数 ×RUSH_MULT，而且道具方块概率翻倍。
// 是整局有效，不计时 —— 所以不叫「限时挑战」，那个名字名实不符。
//
// 走保底不走纯随机：纯随机的话你可以一直重开刷到它。保底计数每开一局走一格，
// 所以无论怎么刷，频率都压得住。计数存本地，刷新页面也带着。
// 也刻意不在开始界面预告「还差几局」—— 预告等于教人刷局。
const RUSH_NAME = '狂欢局';
const RUSH_EVERY = 10;         // 基础门槛，今天打得多会往下降，见 rushEvery()
// 狂欢局 = 难度高 + 奖励厚，是给熟练玩家的局，不是白送的糖。
// 第一版把「有利机制」全翻倍（压实、宝箱、FEVER 保底），结果实测中位 2.67 倍
// 而且活得更久 —— 那些是拐杖，让局变简单，方向反了。现在只留两样：
//   难 = 灰线快得多 + 坏事件更密
//   厚 = 分数倍率给足 + 道具方块翻倍（道具是工具也是分数，给熟练玩家转化率）
// 拐杖（压实权重、宝箱率、FEVER 保底）一律回到平时水平。
// ×3 是「道具消行还不给分」那个年代标的。后来道具消行开始给分，而狂欢局道具
// 翻倍，它吃到的加成远多于普通局 —— 实测变成普通局的 2.1 倍中位 / 2.8 倍 p75，
// 普通局没人想打了。配合深局加成一起收到 2.4，模型算下来普通/狂欢 ≈ 0.86：
// 狂欢局十局才摊上一次，它就该更值，只是不该值到把普通局挤没。
// 燃点那时候够不到（它是按热度开的不是按行数，而当时热度平台只有 ~100），
// 补不平普通局的深局加成，所以底薪也要抬。1.8 → 2.2。
// 狂欢局也吃上深局加成（基数 1.2）之后，3.0 的底薪叠上去过了头 —— 实测
// 同时长 1.46~1.74 倍，太压普通局。收到 2.5，落在 1.15~1.45：中段略高，
// 越深领先越多，形状保留。
const RUSH_MULT  = 2.5;        // 分数倍率（底薪，爆发交给燃点）
const RUSH_MOD   = 2;          // 金块之外的变异块全部翻倍（金块不翻，它只是纯加分）
                               // —— 不只是重锤/炸弹/激光，灌注/分流/染色同样吃这个数
const RUSH_BAD   = 1.5;        // 坏事件权重
const RUSH_RATE  = .30;        // 每局 30% 概率直接中
const RUSH_KEY   = nsKey('rush.v1');
const RUSH_NEXT_KEY = nsKey('rush.next.v1');   // 「下一局是狂欢局」，局末掷出来的
const RUSH_INTRO = 3000;       // 狂欢局开局先停这么久报幕

// 今天打得越多，门槛越低：每多打 10 局降一格，50 局起封在 5。
// 今日局数走北京时间日切，零点自己归零。
//   0–9 局 每 10 局   10–19 每 9   20–29 每 8
//   30–39 每 7        40–49 每 6   50 局起 每 5
// 坡度压得很缓：前 30 局和固定每 10 局完全一样，打满 100 局才多出六成。
const RUSH_FLOOR = 5;
function rushEvery(){
  const p = readDaily().plays;
  return Math.max(RUSH_FLOOR, RUSH_EVERY - Math.floor(p / 10));
}

// 报幕期间不落方块也不走表。用「还没生成方块」当闸：hardDrop / holdPiece /
// tryMove 本来就判 !game.piece，所以按键自然全部失效，不用到处补守卫。
let introLeft = 0;
function showRushIntro(){
  introLeft = RUSH_INTRO;
  const el = $('rushIntro');
  if (el){
    $('rushIntroName').textContent = RUSH_NAME;
    const sub = $('rushIntroSub');
    if (sub) sub.textContent = '更难 · 但分数 ×' + RUSH_MULT;
    el.classList.add('on');
    el.setAttribute('aria-hidden', 'false');
  }
  sfx('tetris', 1.3);
  buzz([40, 40, 40, 40, 90]);
}
function endRushIntro(){
  introLeft = 0;
  const el = $('rushIntro');
  if (el){ el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }
  if (game.started && !game.over && !game.piece) spawnNext();
}

// 计数推进放在局末、而且只认「有效局」。
// 原来是开局就走一格 —— 开局秒死再重开，一轮三五秒，九轮不到一分钟就能把
// 狂欢局刷出来，秒死还顺带把今日局数堆上去、把门槛压低。
// 现在落够 RUSH_MIN_PIECES 块或打满 RUSH_MIN_MS 才算一局，垃圾局白刷。
const RUSH_MIN_PIECES = 30;
const RUSH_MIN_MS = 60000;
function isRealRun(){
  return game.pieces >= RUSH_MIN_PIECES || game.elapsed >= RUSH_MIN_MS;
}

// 主动收手要达到的门槛，明显高于 isRealRun —— 见 endGame 里的说明。
const STOP_MIN_LINES = 50;
const STOP_MIN_MS = 180000;
function isStopRun(){
  return game.lines >= STOP_MIN_LINES || game.elapsed >= STOP_MIN_MS;
}

function readRushCount(){
  try { return parseInt(localStorage.getItem(RUSH_KEY) || '0', 10) || 0; }
  catch { return 0; }
}
function readRushNext(){
  try { return localStorage.getItem(RUSH_NEXT_KEY) === '1'; } catch { return false; }
}
function writeRushNext(v){
  try { localStorage.setItem(RUSH_NEXT_KEY, v ? '1' : '0'); } catch { /* 忽略 */ }
}

// 局末调：有效局才走这里。掷 30%，没中就把保底往前推一格；保底满了照样给。
//
// 骰子刻意掷在局末、结果存下来，而不是开局现掷 —— 开局掷的话没中就重开再掷，
// 30% 等于想要多少有多少，保底那套防刷也就白写了。局末掷完结果就定死，
// 重开多少次拿到的都是同一个答案。
// 代价是第一局永远不可能是狂欢局（还没有哪一局的局末可掷），可以接受。
function countRush(){
  const n = readRushCount() + 1;
  const hit = rndFx() < RUSH_RATE || n >= rushEvery();
  try { localStorage.setItem(RUSH_KEY, String(hit ? 0 : n)); } catch { /* 忽略 */ }
  if (hit) writeRushNext(true);
}

// 开局调：把局末掷出来的结果消耗掉。
// 保底阈值用 rushEvery() 本身而不是减一 —— 计数是在局末推进的，减一会让实际
// 间隔比标称少一格（「每 10 局」跑出来是 8~9 局一次）。
function takeRush(){
  if (!readRushNext()) return false;
  writeRushNext(false);
  return true;
}


// ── 目标线 ──
//
// 问题：唯一的参照系是历史最高分，而那是个被设计成追不上的数 ——
// 所以绝大多数局结束时的默认感受都是「又没破纪录」。
//
// 做法：线 = 最近 RECENT_N 局里**第 GOAL_RANK 高**的那个分数。
//
// 为什么用顺序统计量而不是「中位数 × 系数」：
//   新一局超过旧 n 局中第 j 高的概率**恒等于 j/(n+1)**，和分数分布长什么样
//   完全无关（实测重尾和正态都是 45.0% vs 理论 45.5%）。所以过线率由构造
//   保证，不需要任何要实测才知道对不对的魔数，想调手感就是调一个整数。
//   最早写的是「最近 5 局中位数 × 1.2，让大约一半过线」—— 中位数本身就
//   精确是 50%，乘 1.2 反而把它压到 50% 以下；而且 n=5 的中位数在这种
//   重尾分布上抖 ±39%，比它要表达的 +20% 还大两倍。
//
// 狂欢局要归一化：它同行数能高 1.5~2.5 倍，不归一的话连着两局狂欢局就
// 把线拽到普通局够不着的地方。存进去先除以 RUSH_MULT，取出来按本局是不是
// 狂欢局再乘回来。
const RECENT_N = 10;
const GOAL_RANK = 5;        // 第几高 → 过线率 = GOAL_RANK/(RECENT_N+1) ≈ 45%

function readRecent(){
  // 存的是数组，坏数据会在 slice/sort 上抛 —— 这个读取点在开局和侧栏渲染里，
  // 一抛就是白屏。照 readSave 的校验强度来，不是 readDaily 那种。
  try {
    const d = JSON.parse(localStorage.getItem(RECENT_KEY) || 'null');
    if (!d || !Array.isArray(d.v)) return [];
    // 清档只在分数量纲整体位移时才发生（见 WIPE_TOKENS 的注释）。
    // 旧标度的分数留着，线要么这辈子过不去、要么开局就过。
    if (d.tok !== WIPE_TOKEN) return [];
    return d.v.filter(n => typeof n === 'number' && Number.isFinite(n) && n >= 0).slice(-RECENT_N);
  } catch { return []; }
}
function pushRecent(score){
  try {
    const v = readRecent();
    // 归一化后再存：狂欢局的分数先折回普通局口径
    v.push(game.rush ? score / RUSH_MULT : score);
    localStorage.setItem(RECENT_KEY, JSON.stringify({ v: v.slice(-RECENT_N), tok: WIPE_TOKEN }));
  } catch { /* 忽略 */ }
}
// 本局的目标分。样本不够时按比例缩 rank，不足 3 局不给线（太少了没意义）。
function goalScore(){
  const v = readRecent();
  if (v.length < 3) return 0;
  const sorted = v.slice().sort((a, b) => b - a);
  const j = Math.max(1, Math.round(GOAL_RANK * sorted.length / RECENT_N));
  const base = sorted[Math.min(j, sorted.length) - 1];
  return Math.round(game.rush ? base * RUSH_MULT : base);
}

// ── 今日最佳 ──
// 按北京时间归日，而且按「这一局结束的时刻」算 —— 跨零点打完的那局算新的一天，
// 否则昨天的成绩会挤掉今天的第一局。
// 时区不读设备设置：时间戳先推到 UTC+8，再取 UTC 的年月日。
function bjDay(){
  // 先把时间戳推到 UTC+8，再读 UTC 的年月日 —— 这样不依赖运行设备的时区设置
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function readDaily(){
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
    if (d && d.day === bjDay()) return d;
  } catch { /* 坏数据当没有 */ }
  return { day: bjDay(), best: 0, plays: 0 };
}
function writeDaily(d){
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch { /* 忽略 */ }
}
const careerOf = (v) => tierOf(CAREER, v);

// 正在玩的这一局也存下来：手机上切个 App、锁个屏回来还能接着打
let lastSaveAt = 0;
function saveGame(force){
  if (assisted()) return;          // 练习/提示不存也不清 —— 见 clearSave
  if (!game.started || game.over){ clearSave(); return; }
  // localStorage 是同步 I/O，连续落块时每次都写会拖帧
  const now = performance.now();
  if (!force && now - lastSaveAt < 1500) return;
  lastSaveAt = now;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      board: game.board,
      rush: game.rush,          // 不存的话，续玩会把狂欢局静默变成普通局
      pieces: game.pieces,      // 有效局判据要用
      queue: game.queue,
      mods: game.mods,
      holdMod: game.holdMod,
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
      heat,
      // 修行要存。不存的话续玩会把这局选的卡全抹掉 —— 和当年「续玩把狂欢局
      // 静默降成普通局」是同一类 bug：玩家看不见自己被削了什么。
      ups,
      upNext,                   // 不存的话续玩会拿 lines 去比默认值，连环弹面板
      zoneCharge,
      delayUsed,
      mid,                      // 中途开局：不存的话续玩后这局会被当成从头打的，分数进最高分
      run: game.run,            // 复盘的计数（四消 / T 旋 / 洞 / 分段 / 标槽…）：不存的话续玩后全归零，建议也给错
      // 不存 zoneLeft：ZONE 是十秒的窗口，隔一次重开再接着倒计时没有意义。
      // 盘底那几行死行靠 restoreGame 直接从盘面数出来再结算，见那边。
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

// 练习模式下一律不动存档。存档是普通局的「接着上次玩」，而练习会调 restart()、
// 会 endGame()、会不停地落块 —— 这些路径原来都会顺手 clearSave()，于是普通局
// 打到一半切去练一下，回来那局就没了。
function clearSave(){
  if (assisted()) return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ }
}

function restoreGame(d){
  // 先把狂欢局的瞬态清干净（FEVER / 梭哈 / 事件 / 热度）。
  // 目前只有首屏「接着上次玩」能走到这里，模块状态本来就是初值；
  // 但这是个隐式前提，哪天续玩入口挪到暂停页，就会带着上一局的 FEVER 复活。
  crazyReset();
  game.board = d.board;
  game.run = Object.assign(newRun(), d.run && typeof d.run === 'object' ? d.run : {});
  if (!d.run) game.run.aidTs = !CRAZY && !!aids.ts;   // 老存档没有 run：按现在的开关算
  game.queue = d.queue || [];
  // 旧存档没有 mods 字段，或者长度对不上，就地补齐 —— 两条数组必须严格同长，
  // 错位一格会让所有方块的变异都跟着错
  game.mods = Array.isArray(d.mods) ? d.mods.slice(0, game.queue.length) : [];
  while (game.mods.length < game.queue.length) game.mods.push(CRAZY ? rollMod() : null);
  game.holdMod = d.holdMod || null;
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
  game.pieces = d.pieces || 0;
  game.elapsed = d.elapsed || 0;
  // 续玩要把狂欢状态一起接回来。原来这里不碰 game.rush，所以存档一续
  // 狂欢局就静默降成普通局 —— 分数倍率、灰线速度、道具概率全跟着没了。
  game.rush = FORCE_RUSH || (CRAZY && !!d.rush);
  goalNow = CRAZY ? goalScore() : 0;
  goalHit = CRAZY && goalNow > 0 && game.score >= goalNow;
  document.body.classList.toggle('rushrun', !!game.rush);
  const sl = $('scoreLabel');
  if (sl) sl.textContent = game.rush ? 'SCORE ×' + RUSH_MULT : 'SCORE';
  heat = CRAZY ? Math.max(HEAT_FLOOR, +d.heat || 0) : 0;
  // 修行接回来。过滤一遍未知 key —— 老存档里可能有已经删掉的卡。
  ups = CRAZY && Array.isArray(d.ups) ? d.ups.filter(k => UP_BY[k]) : [];
  if (typeof d.upNext === 'number') upNext = d.upNext; else upRoll(game.lines);
  zoneCharge = CRAZY ? (+d.zoneCharge || 0) : 0;
  delayUsed = !!d.delayUsed;
  mid = d.mid && typeof d.mid.L === 'number' ? d.mid : null;
  paceB = midRates().b;
  syncModeTag();
  // ZONE 的死行：**从盘面数出来**，不信任存档字段。
  // 这样连这次改动之前存的那些坏档也能自愈 —— 它们盘面里有死行但没有计数，
  // 于是 zoneEnd 看到 zoneRows=0 直接早退，那几行永久卡在盘底、地板一直被顶高。
  if (CRAZY){
    zoneRows = game.board.filter(row => row.every(c => c === ZONE)).length;
    if (zoneRows > 0) zoneEnd('');     // 行是玩家打出来的，照常结算再清掉
  }
  syncFx();
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
  squash = null;
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
  else aidOnSpawn();          // 存档里带着当前块：不出新块，后台教练 / 多余按键的快照得自己拍
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
  // 这一局都发生了什么。结算页要把它讲出来 —— 所有机制都在跑，
  // 但之前没有任何一个地方把它们汇总给玩家看。
  run: null,
  rush: false,
  pieces: 0,           // 这一局落了几块，给「有效局」判据用
  queue: [],          // 预览队列，保持 5 个
  mods: [],           // 和 queue 一一对应的变异，入队时摇好
  holdMod: null,
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

const dbg = { frames: 0, layouts: 0, draws: 0, previews: 0 };   // draws：测消行重绘节流用
let garbageTimer = 0;
let lockStep = -1;          // 落地渐白只分几档，省掉大部分重绘
let dropTimer = 0;
let lockTimer = 0;
let lockResets = 0;
let grounded = false;
let softDropping = false;
let lastFrame = 0;
let lastDrawAt = 0;
// 这一帧的变化是你按键造成的：下一帧就画，不等 30fps 的节流。
// 节流是为了「方块自己往下掉」时省电（一秒只有一帧真的变了）；但按键也被它卡着，
// 实测横移按下到上屏平均 18ms、最慢 29ms，按住连发的每一格也在 33/50ms 之间跳。
let drawNow = false;
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
  while (game.queue.length < 5){
    game.queue.push(nextType());
    // 变异在入队时就摇好，NEXT 里能提前看见。原来是出生那一刻才摇 ——
    // 于是炸弹永远是惊喜，而惊喜经常被浪费（盘面刚好很干净时来一个炸弹）。
    // 看得见才谈得上规划：「下一个是激光，我先把这列堆起来等着穿」。
    game.mods.push(CRAZY ? rollMod() : null);
  }
}

function cellsOf(type, rot){
  return PIECES[type].states[rot & 3];
}

function collides(type, x, y, rot){
  for (const [cx, cy] of cellsOf(type, rot)){
    const bx = x + cx, by = y + cy;
    if (bx < 0 || bx >= COLS) return true;
    if (bx === wallCol) return true;        // 列封锁：这一列当墙用
    if (by >= TOTAL_ROWS) return true;
    if (by >= 0 && game.board[by][bx]) return true;
  }
  return false;
}

function spawn(type, mod){
  previewDirty = true;
  needsDraw = true;
  const def = PIECES[type];
  const p = { type, x: def.spawnX, y: 0, rot: 0, mod: CRAZY ? (mod || null) : null };
  if (game.run && p.mod) game.run[p.mod]++;
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
  // 提示模式：每块一出生就算推荐（当前块 × 1 个 NEXT）
  if (hintMode) hintCompute();
  if (drill) drillOnSpawn();
  aidOnSpawn();

  // IHS 优先于 IRS：按住暂存键就先换块，否则按住旋转键就先转好
  if (!armPre) return;
  armPre = false;
  if (preHeld.hold && !game.holdUsed){ holdPiece(); return; }
  // 消行动画里按下的那一下已经进了缓冲（flushInputs 会转），按住不放的话 IRS 再转一次就成了 180°
  const bufRot = inputBuf.some(a => a === 'C' || a === 'A');
  if (preHeld.cw && !bufRot) tryRotate(1);
  else if (preHeld.ccw && !bufRot) tryRotate(-1);
}

// 消行动画那 0.26 秒没有当前块，原来这期间的点按（左右 / 旋转 / 暂存）全被吞掉 ——
// 「消完行按了没反应」。现在先存着（最多 3 下），新块一出来就照做。
// 落底不存：存了的话新块一出来就被砸下去，正是之前「连点两下砸掉两块」那个问题
const inputBuf = [];
function bufferInput(a){
  if (clearing && game.started && !game.over && !game.paused && inputBuf.length < 3) inputBuf.push(a);
}
function flushInputs(){
  const acts = inputBuf.splice(0);
  for (const a of acts){
    if (!game.piece || game.over) break;
    if (a === 'L') tryMove(-1, 0);
    else if (a === 'R') tryMove(1, 0);
    else if (a === 'C') tryRotate(1);
    else if (a === 'A') tryRotate(-1);
    else if (a === 'X') holdPiece();
  }
}

function spawnNext(){
  fillQueue();
  const t = game.queue.shift(), m = game.mods.shift();
  fillQueue();
  spawn(t, m);
}

// ───────────────────────── 操作 ─────────────────────────

function tryMove(dx, dy){
  const p = game.piece;
  if (!p) return false;
  if (collides(p.type, p.x + dx, p.y + dy, p.rot)) return false;
  p.x += dx; p.y += dy;
  game.lastWasRot = false;
  needsDraw = true; drawNow = true;
  if (dy === 0) touchGround(true);   // 横move 可以续 lock delay
  return true;
}

function tryRotate(dir){
  if (nes){ nesRotate(dir); return false; }
  const p = game.piece;
  if (!p){ bufferInput(dir > 0 ? 'C' : 'A'); return false; }
  if (p.type === 'O') return false;
  const from = p.rot & 3;
  const to = (from + dir + 4) & 3;
  const table = (p.type === 'I' ? KICKS.I : KICKS.JLSTZ)[`${from}>${to}`];
  if (!table) return false;
  for (let i = 0; i < table.length; i++){
    const [kx, ky] = table[i];
    if (!collides(p.type, p.x + kx, p.y + ky, to)){
      p.x += kx; p.y += ky; p.rot = to;
      game.lastWasRot = true;
      needsDraw = true; drawNow = true;
      game.lastRotKick = i;
      touchGround(true);
      sfx('rotate');
      return true;
    }
  }
  return false;
}

function hardDrop(){
  if (nes){ nesHardDrop(); return; }   // NES 原版没有硬降，这里按用户要求加了（见 nesHardDrop）
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
  drawNow = true;
  // 落了格就不再算「最后一步是旋转」。原来不清：半空转一下、硬降 19 格落进一个
  // 三角都被挡的坑，实测被判成 mini T-spin。Guideline 要求的是最后一个**成功的动作**
  // 是旋转，19 格下落就是一次位移。
  // 但 d = 0 必须保留 —— 贴地转进槽、再按落底锁定，正是手机上做 T 旋的操作链。
  if (d > 0) game.lastWasRot = false;
  game.score += d * 2;
  needsDraw = true;
  burst(p, 1.4);
  hardLocking = true;
  lockPiece();
  hardLocking = false;
}

function holdPiece(){
  if (nes) return;                 // NES 没有暂存
  if (!game.piece){ bufferInput('X'); return; }
  if (game.holdUsed) return;
  if (drill && drill.stage === 'warm') return;     // 题目只给 T，暂存了就没题了
  if (upNever('hold')){ showToast('断舍　这局不能用 HOLD'); return; }
  const cur = game.piece.type, curMod = game.piece.mod || null;
  if (cur === 'T' && aidsOn() && game.run && game.run.tHold !== undefined) game.run.tHold++;   // T 块去向：进了暂存
  if (game.hold){
    const h = game.hold, hm = game.holdMod || null;
    game.hold = cur; game.holdMod = curMod;
    spawn(h, hm);
  } else {
    game.hold = cur; game.holdMod = curMod;
    spawnNext();
  }
  game.holdUsed = true;   // spawn 会把它清掉，所以放在后面
  // spawn 里算推荐（提示模式 / 后台教练）时 holdUsed 还是 false，会推荐「先暂存」这种这时做不到的事 —— 置上之后重算一次
  if (!game.over && game.piece){ if (hintMode) hintCompute(); aidOnSpawn(); }
  previewDirty = true;
  needsDraw = true; drawNow = true;
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
    } else if (fromAction && lockResets < LOCK_RESET_LIMIT){   // 现在恒真，见常量那边
      lockTimer = 0;
      lockResets++;
    }
  } else {
    grounded = false;
    lockTimer = 0;
  }
}

// ───────────────────────── 练习模式 ─────────────────────────
//
// 它不是第三个版本，是标准版里的一个开关 —— 疯狂版走的是 bump.py 生成的
// 另一份文件，而练习要能随时进出，所以只能是运行期标志。
//
// 三条硬约束：
//   ① 不涨灰线（game.noGarbage 这个字段本来就被读三处、从没被赋过值，正好是它）
//   ② 不写任何记录（最高分、累计、今日、狂欢局保底计数全部跳过）
//   ③ 不存档（练习盘面续回来没有意义，而且会污染「接着上次玩」）
let practice = false;
let drill = null;            // 每日练习进行中的状态（见「每日练习」一节）；null = 没在练
let practiceLevel = null;    // 当前这一关（LEVELS 里的对象）；null = 自由练习
let practiceStep = 0;        // 多步关卡做到第几步了
let practiceDone = false;
let practiceReps = 0;        // 这一关自己做到了几次（演示不算）。换关清零
let demoRunning = false;     // 正在放演示：重力和锁定计时都停，玩家输入也先挡掉
let lastClearB2B = false;    // scoreFor 写，practiceCheck 读 —— 判「这一下 B2B 有没有接上」
let undoStack = [];          // 每次锁定前压一份快照
const UNDO_MAX = 20;

function snapForUndo(){
  if (!practice) return;
  undoStack.push({
    board: game.board.map(r => r.slice()),
    score: game.score, lines: game.lines, level: game.level,
    combo: game.combo, b2b: game.b2b,
    queue: game.queue.slice(), mods: game.mods.slice(), bag: game.bag.slice(),
    hold: game.hold, holdUsed: game.holdUsed, pieces: game.pieces,
    // 当前这块也要存 —— 撤销是「回到这块落下之前」，不是「换一块新的」
    piece: game.piece ? game.piece.type : null,
    done: practiceDone, step: practiceStep,
  });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

function practiceUndo(){
  if (!practice || demoRunning || !undoStack.length) return;
  const u = undoStack.pop();
  game.board = u.board; game.score = u.score; game.lines = u.lines;
  game.level = u.level; game.combo = u.combo; game.b2b = u.b2b;
  game.queue = u.queue.slice(); game.mods = u.mods.slice(); game.bag = u.bag.slice();
  game.hold = u.hold; game.holdUsed = u.holdUsed; game.pieces = u.pieces;
  practiceDone = u.done; practiceStep = u.step;
  clearing = null; game.over = false;
  $('overlay').classList.remove('show');
  // 把刚才那块放回队头再出，于是撤销之后拿到的还是同一块
  if (u.piece){ game.queue.unshift(u.piece); game.mods.unshift(null); }
  game.piece = null;
  spawnNext();
  staticDirty = true; previewDirty = true; needsDraw = true;
  syncHud(); syncPractice();
  if (!rafId){ lastFrame = performance.now(); rafId = requestAnimationFrame(tick); }
}

// ── 训练关卡 ──
//
// 盘面按「最底下一行写在最后」铺，# 实心 . 空，只写用到的那几行。
// queue 是这一关固定的出块顺序（用完之后接回正常的 7-bag）。
// goals 是**有序**的：第一步做出 goals[0]，第二步做出 goals[1] …… 全做到才算过。
// 只有消行会被拿去比对；搭形状那几块（比如先放个 O 做屋檐）不消行，不占一步。
//
// solution 是每一块的操作串，「看演示」照着放，test_practice.py 照着回放 ——
// 回放做不出目标就红。所以这里每一关都是**被证明做得出来**的，不是我画出来的。
//   L/R 左右  d 软降一格  C 顺时针  A 逆时针  H 落底（硬降）  X 暂存
//   字母后面跟数字 = 重复几次，比如 R3 = 右移三格
// 解法都只用顺时针 —— 手机上只有那一个旋转键，演示里出现逆时针等于教了个按不出来的操作。
const LEVELS = [
  // ─ 单招：一块定生死，学「这个形状怎么转进去」─
  { k:'tss', n:'T-spin 单', group:'tspin', queue:['T'],
    goals:[{ spin:'tspin', n:1 }],
    tip:'T 在槽口上方竖着软降下去，贴地之后再转进去 —— 单行吃到 ' +
        [400,800,1200,1600][1] + ' 分，是普通单行的八倍',
    rows:['.#........',
          '#...#####.',
          '##.#######'],
    solution:['CL2d19CH'] },
  { k:'tsd', n:'T-spin 双', group:'tspin', queue:['T'],
    goals:[{ spin:'tspin', n:2 }],
    tip:'本作分数效率最高的一招：接上 B2B 是每行 900 分，四消才 300',
    rows:['.#........',
          '#...######',
          '##.#######'],
    solution:['CL2d19CH'] },
  { k:'tetris', n:'四消井', group:'basic', queue:['I'],
    goals:[{ n:4 }],
    tip:'技能练习：九列铺平、留一列井，等 I 块打四消。普通局里优先搭 T 槽（T 旋双消每行的分是四消的三倍），四消留给 I 正好有地方的时候',
    rows:['#########.',
          '#########.',
          '#########.',
          '#########.'],
    solution:['CR4d18H'] },
  { k:'pc', n:'全消', group:'basic', queue:['O'],
    goals:[{ perfect:true }],
    tip:'把盘面清空。全消按行数给 800~2000，还要再乘等级倍率',
    rows:['########..',
          '########..'],
    solution:['R4d20H'] },

  // ─ 组合：几块连起来，学「搭 → 旋 → 接下一招」，以及怎么不断 B2B ─
  { k:'eave', n:'搭屋檐 → T 双', group:'tspin', queue:['O','T'],
    goals:[{ spin:'tspin', n:2 }],
    tip:'槽是现成的，缺的是头顶那块屋檐。先把 O 放到左边盖住槽口一角，' +
        'T 就只能转进去 —— 这就是「搭 TSD」的全部诀窍',
    rows:['#...######',
          '##.#######'],
    solution:['L4d18H', 'CL2d19CH'] },
  { k:'tsd4', n:'T 双 → 四消', group:'combo', queue:['T','I'],
    goals:[{ spin:'tspin', n:2 }, { n:4, b2b:true }],
    tip:'左边那口井被上面两行封着。先 T 旋把那两行消掉，井口自己就开了，' +
        '再下 I 打四消 —— 两招都是「难消」，B2B 不断，四消多拿五成',
    rows:['.#........',
          '#...######',
          '##.#######',
          '.#########',
          '.#########',
          '.#########',
          '.#########'],
    solution:['CL2d15CH', 'CL5d18H'] },
  { k:'tsd2', n:'T 双 × 2', group:'combo', queue:['T','T'],
    goals:[{ spin:'tspin', n:2 }, { spin:'tspin', n:2, b2b:true }],
    tip:'上下两个 TSD 槽。先打上面那个，下面那个的屋檐才露出来；' +
        '第二下接上 B2B，单这一下就是 ' + Math.floor(1200 * 1.5) + ' 分',
    rows:['.#........',
          '#...######',
          '##.#######',
          '##..######',
          '.#..######',
          '#...######',
          '##.#######'],
    solution:['CL2d15CH', 'CL2d19CH'] },



  // ─ 组合：新增 ─
  { k:'hold', n:'先存后旋', group:'combo', queue:['I','T'],
    goals:[{ spin:'tspin', n:2 }, { n:4, b2b:true }],
    tip:'先来的是 I，可井口被封着，现在放哪都是浪费。点 HOLD 把 I 存起来，' +
        '用 T 旋把井打开，下一块再点 HOLD 把 I 换出来打四消',
    rows:['.#........',
          '#...######',
          '##.#######',
          '.#########',
          '.#########',
          '.#########',
          '.#########'],
    // 手写拼出来的（求解器不搜 HOLD）：X 存 I → T 走「T 双 → 四消」那条 → 下一块 X 换回 I
    solution:['XCL2d15CH', 'XCL5d18H'] },
  { k:'combo', n:'连击', group:'combo', queue:['I','L','J','O','T'],
    goals:[{ combo:0 }, { combo:1 }, { combo:2 }, { combo:3 }],
    tip:'右边是一口四格宽的井。每一块都要消掉一行，一断就从头算。' +
        '连击每多一连多拿 50 分（乘等级倍率）—— 但四连单消加起来也比不上一次四消，还会断掉 B2B，' +
        '它是「没机会打四消时别断节奏」的手段，不是主要得分方式',
    rows:['######....',
          '######....',
          '######....',
          '######....',
          '######.###'],
    solution:['CRd18H', 'C2R4d19H', 'R4d19H', 'R4d20H'] },
  { k:'tuck', n:'软降滑入', group:'basic', queue:['O','O'],
    goals:[{ n:2 }],
    tip:'左下角那块空位被头顶的檐子挡着，直接落是进不去的。软降到底、' +
        '贴地之后再往左横着滑进去 —— 这一下只有软降做得到，落底会当场锁死',
    rows:['##........',
          '....######',
          '....######'],
    solution:['L2d20L2H', 'L2d20H'] },
  { k:'pc2', n:'两块全消', group:'basic', queue:['J','J'],
    goals:[{ perfect:true }],
    tip:'两块 J 正好拼满这个 2×4 的坑：一块平放，另一块转半圈（点两下变换）扣上去。' +
        '全消要提前想好两块怎么咬合，不是来一块放一块',
    rows:['....######',
          '....######'],
    solution:['L3d20H', 'C2L2d19H'] },


];
// T-spin 三没收进来：它要求前四次踢墙全部失败、第五次 (+1,+2) 才把 T 甩进深槽，
// 而那两个条件互相打架 —— 起手位要求槽上方那一行空着，可那样第二次踢墙就先成功了。
// 穷举过槽上方一整行的 64 种填法，一种都不成立。与其塞个没验证过的盘面，不如先不要。
const LEVEL_BY = Object.fromEntries(LEVELS.map(l => [l.k, l]));

const SPIN_NAME = ['', '单', '双', '三'];
function goalName(g){
  if (g.combo !== undefined) return g.combo === 0 ? '消一行（起连）' : g.combo + ' 连击';
  let t = g.perfect ? '全消'
        : g.spin === 'tspin' ? 'T-spin ' + (SPIN_NAME[g.n] || g.n)
        : g.spin === 'mini' ? 'mini T-spin'
        : g.n === 4 ? '四消' : g.n + ' 行';
  if (g.b2b) t += '（接 B2B）';
  return t;
}
function clearName(n, spin, perfect){
  if (perfect) return '全消';
  if (spin === 'tspin') return 'T-spin ' + (SPIN_NAME[n] || n);
  if (spin === 'mini') return 'mini T-spin';
  return ['空转', '单行', '双行', '三行', '四消'][n] || n + ' 行';
}

function practiceLoad(k){
  const lv = LEVEL_BY[k];
  if (!practice || !lv) return;
  demoRunning = false;
  undoStack.length = 0;
  if (practiceLevel !== lv) practiceReps = 0;
  practiceLevel = lv; practiceStep = 0; practiceDone = false;
  for (let y = 0; y < TOTAL_ROWS; y++) game.board[y].fill(null);
  // 底对齐：最后一行贴盘底
  lv.rows.forEach((row, i) => {
    const y = TOTAL_ROWS - lv.rows.length + i;
    for (let x = 0; x < COLS; x++) game.board[y][x] = row[x] === '#' ? 'X' : null;
  });
  game.combo = -1; game.b2b = false;
  game.hold = null; game.holdUsed = false;
  // 固定出块顺序排在最前，后面接回正常的 bag
  game.queue = lv.queue.slice(); game.mods = lv.queue.map(() => null);
  game.bag = [];
  clearing = null; game.over = false; softDropping = false;
  $('overlay').classList.remove('show');
  game.piece = null; spawnNext();
  staticDirty = true; previewDirty = true; needsDraw = true;
  syncHud(); syncPractice();
  if (!rafId){ lastFrame = performance.now(); rafId = requestAnimationFrame(tick); }
}

// 达成判定。goal 里写了哪几项就比哪几项。多步关卡只比「当前这一步」。
// 没对上不算失败也不重置 —— 练习就是要能撤销一步接着来，只提示一句差在哪。
function practiceCheck(n, spin, perfect){
  if (!practice || !practiceLevel || practiceDone) return;
  const goals = practiceLevel.goals;
  const g = goals[practiceStep];
  const hit = (g.spin === undefined || spin === g.spin)
           && (g.combo === undefined || (n > 0 && game.combo >= g.combo))
           && (g.n === undefined || n === g.n)
           && (g.perfect === undefined || !!perfect === g.perfect)
           && (g.b2b === undefined || lastClearB2B === g.b2b);
  if (!hit){
    if (!demoRunning)
      showToast('这一下是' + clearName(n, spin, perfect) + (lastClearB2B ? '（B2B）' : '')
                + '，要的是' + goalName(g) + ' —— 撤销一步再来', 2800);
    return;
  }
  practiceStep++;
  if (practiceStep >= goals.length){
    practiceDone = true;
    if (!demoRunning){
      practiceReps++;
      showToast('✓ ' + practiceLevel.n + '　第 ' + practiceReps + ' 次做到', 2000);
      sfx('tetris', 1.25); buzz([40, 30, 40, 30, 90]);
      // 反复练：自动重摆同一关。手感靠的是一遍遍重复，不是过一次就算会了。
      // 只认自己打出来的 —— 演示和测试里的同步回放都在 demoRunning 下跑，不会触发。
      const lv = practiceLevel;
      setTimeout(() => {
        if (practice && practiceLevel === lv && practiceDone && !demoRunning) practiceLoad(lv.k);
      }, 1500);
    }
  } else if (!demoRunning){
    showToast('第 ' + practiceStep + ' 步 ✓　接着：' + goalName(goals[practiceStep]), 2400);
    sfx('tspin', 1.1);
  }
  syncPractice();
}

// ── 解法回放 ──
function parseActs(str){
  const out = [];
  const re = /([LRdCAHX])(\d*)/g;
  let m;
  while ((m = re.exec(str))){
    const n = m[2] ? +m[2] : 1;
    for (let i = 0; i < n; i++) out.push(m[1]);
  }
  return out;
}
function doAct(a){
  switch (a){
    case 'L': return tryMove(-1, 0);
    case 'R': return tryMove(1, 0);
    // 软降一格：和按住软降键一样每格 +1 分、清掉「最后一步是旋转」
    case 'd': if (tryMove(0, 1)){ game.score++; return true; } return false;
    case 'C': return tryRotate(1);
    case 'A': return tryRotate(-1);
    case 'H': hardDrop(); return true;
    case 'X': holdPiece(); return true;
  }
  return false;
}

// 同步跑完一关的解法，返回过没过。测试用 —— 不走定时器，消行动画用 step() 推过去。
function practiceSolve(k){
  const lv = LEVEL_BY[k];
  if (!lv) return false;
  practiceLoad(k);
  demoRunning = true;
  for (const seg of lv.solution){
    let g = 0;
    while ((clearing || !game.piece) && g++ < 400) step(16);
    for (const a of parseActs(seg)) doAct(a);
  }
  let g = 0;
  while (clearing && g++ < 400) step(16);
  demoRunning = false;
  syncPractice();
  return practiceDone;
}

// 看演示：重摆本关，然后一个动作一个动作地放给你看。
// 放的时候重力和锁定计时都停 —— 否则 1 级重力一秒掉一格，演示到一半位置就偏了，
// 照着那条路径转出来的东西会和解法对不上。
function practiceDemo(){
  if (!practice || !practiceLevel || !practiceLevel.solution.length) return;
  const lv = practiceLevel;
  practiceLoad(lv.k);
  demoRunning = true;
  syncPractice();
  const segs = lv.solution.slice();
  let acts = [];
  const run = () => {
    if (!practice || !demoRunning || practiceLevel !== lv) return;
    if (clearing || !game.piece) return void setTimeout(run, 60);
    if (!acts.length){
      if (!segs.length){
        demoRunning = false;
        showToast('演示完了 —— 点「重摆本关」自己来一遍', 2800);
        syncPractice();
        return;
      }
      acts = parseActs(segs.shift());
    }
    doAct(acts.shift());
    needsDraw = true;
    setTimeout(run, acts.length ? 140 : 320);   // 每块最后那下落底多停一拍，看清落在哪
  };
  setTimeout(run, 500);
}

// 指定下一块。塞到队头，不动 bag —— bag 继续按 7-bag 走，
// 所以「指定」是插队不是替换，不会把随机性搞坏。
function practicePick(type){
  if (!practice || demoRunning || !PIECES[type]) return;
  game.queue.unshift(type);
  game.mods.unshift(null);
  // 当前这块直接换掉，否则要等落完才生效，手感像没反应。
  // 没有当前块时也要生成 —— 消行动画刚播完那一瞬 game.piece 是 null，
  // 不补这一步的话那下点击就是哑的。
  if (!clearing){
    game.piece = null;
    spawnNext();
  }
  needsDraw = true; previewDirty = true;
  syncPractice();
}

function syncPractice(){
  syncModeSwitch();
  document.body.classList.toggle('practising', practice);
  document.body.classList.toggle('demoing', practice && demoRunning);
  if (!practice) return;
  const lv = practiceLevel;
  const g = $('prGoal');
  if (g){
    if (!lv) g.textContent = '自由练习';
    else if (practiceDone) g.textContent = '✓ ' + lv.n + (practiceReps > 1 ? '　×' + practiceReps : '');
    else if (lv.goals.length > 1)
      g.textContent = '第 ' + (practiceStep + 1) + '/' + lv.goals.length + ' 步　' + goalName(lv.goals[practiceStep])
                      + (practiceReps ? '　✓×' + practiceReps : '');
    else g.textContent = '目标　' + goalName(lv.goals[0]) + (practiceReps ? '　✓×' + practiceReps : '');
  }
  const t = $('prTip');
  if (t) t.textContent = demoRunning ? '演示中 —— 看它先把块送到哪、在哪一刻转'
                       : lv ? lv.tip : '随便摆，不涨灰线、不记成绩';
  const u = $('prUndo');
  if (u) u.disabled = demoRunning || !undoStack.length;
  const d = $('prDemo');
  if (d){ d.disabled = demoRunning || !lv || !lv.solution.length;
          d.textContent = demoRunning ? '演示中' : '演示'; }
  const rs = $('prReset');
  if (rs) rs.disabled = !lv;
  for (const b of document.querySelectorAll('#prLevels [data-lv]'))
    b.classList.toggle('on', !!lv && b.dataset.lv === lv.k);
}

// 练习弹层。开着时方块停住（和样式面板同一个开关 game.frozen），关掉再接着走。
function openPrSheet(){
  const sh = $('prSheet');
  if (!practice || !sh) return;
  sh.hidden = false;
  game.frozen = true;
  syncPractice();
}
function closePrSheet(){
  const sh = $('prSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  game.frozen = false;
  resumeLoop();
}

// 进练习：先按正常开局把一切铺好，再把模式标志挂上并关掉灰线。
// 顺序不能反 —— restart 里会 crazyReset，挂早了会被它冲掉。
function startPractice(){
  // 普通局打到一半切过来：先存一份。练习期间 clearSave/saveGame 都是空操作，
  // 这份存档会原样留到切回普通模式，开局面板上「接着上次玩」就能接上。
  if (!assisted() && game.started && !game.over) saveGame(true);
  drillEnd(); nesEnd(); vsEnd();
  hintMode = false; hintMove = null;
  syncHint();                // 摘掉 body.hinting —— 不摘的话绿色提示细栏会一直挂在练习界面上
  practice = true;
  restart();
  practice = true;                  // restart 不碰它，这行是防御，别指望
  game.noGarbage = true;
  undoStack.length = 0;
  practiceLevel = null; practiceStep = 0; practiceDone = false; demoRunning = false;
  syncPractice();
}

// 切回普通模式：不自动开新局，回到开局面板。原来这里直接 restart() 开一局新的 ——
// 一来普通局打到一半去练习的那一局就被跳过了，二来「切模式」不该顺手替你按「开始」。
function exitPractice(){
  document.body.classList.remove('gameover');
  closePrSheet();
  closeHintSheet();
  drillEnd(); nesEnd(); vsEnd();
  practice = false;
  hintMode = false; hintMove = null; hintBase = null;
  // restart 不碰 noGarbage（那是 game 对象上的字段，newGame 才铺），
  // 不显式收掉的话之后的普通局永远不涨灰线
  game.noGarbage = false;
  practiceLevel = null; practiceStep = 0; practiceDone = false; demoRunning = false;
  undoStack.length = 0;
  softDropping = false;
  // 停在「还没开局」的状态：盘面清空、没有当前块、循环停掉，和刚打开页面一样
  game.started = false; game.over = false; game.piece = null; clearing = null;
  for (let y = 0; y < TOTAL_ROWS; y++) game.board[y].fill(null);
  cancelAnimationFrame(rafId); rafId = 0;
  staticDirty = true; previewDirty = true; needsDraw = true;
  draw();
  syncPractice();
  syncHint();
  syncResume();
  $('overlay').dataset.mode = 'start';
  $('overlay').classList.add('show');
}

// 「接着上次玩」按存档的**当前**状态显示。原来只在页面打开时读一次，
// 点击回调还捕获了那一刻的存档 —— 之后存档变了（比如切去练习前刚存的那份），
// 按钮不出现，或者点下去恢复的是旧的那局。
function syncResume(){
  const save = readSave(), ov = $('overlay');
  if (!ov) return;
  ov.classList.toggle('has-save', !!save);
  if (save && $('resumeScore')) $('resumeScore').textContent = groupInt(save.score || 0);
}

// 顶栏的「普通 | 练习」。只在标准版有（疯狂版 bump.py 把节点删了，这里拿不到就跳过）。
// 盘面左上角的模式标签：对战 / NES / T 旋练习时显示，顶栏的三个开关管不到这几个模式
function syncModeTag(){
  const t = $('modeTag');
  if (!t) return;
  const txt = vs ? '对战 Lv ' + vs.bot.lv : nes ? 'NES · 起始 ' + nes.start + ' 级' : tsOn() ? 'T 旋练习 · ' + tsSpeedName() + (tsGarbage ? ' · 灰线' : '') : mid ? '中途开局 · ' + mid.L + ' 行起' : '';
  t.textContent = txt;
  t.hidden = !txt;
}
function syncModeSwitch(){
  syncModeTag();
  for (const b of document.querySelectorAll('#modeSw [data-m]')){
    const m = b.dataset.m;
    // 每日练习挂在「练习」下面（它的堆叠段借用了提示模式，但不算提示）
    // T 旋练习挂在「练习」下（第一版亮的是「提示」，用户以为自己在提示模式）。
    // 对战 / NES / 中途开局都算「普通」那一格（正经打的局），具体是哪种看盘面左上角的标签 —— 原来对战 / NES 三格都不亮
    const on = m === 'practice' ? practice || !!drill || tsOn() : m === 'hint' ? hintMode && !drill && !tsOn() : !assisted() || !!nes || !!vs;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ───────────────────────── 堆叠提示 ─────────────────────────
//
// 第三个模式：只看 1 个 NEXT、没有 HOLD、不涨灰线、不记成绩。每块出来的时候，
// 在盘面上用绿框标出推荐位置，细栏写一句为什么。
//
// 推荐不是「最低的地方」，是把高手的堆叠经验写成打分规则（来源：ryanheise.com 的
// 堆叠教程、tetris.wiki、gamertagmythras 的堆叠基础），然后把「当前块所有落点 ×
// 下一块所有落点」全试一遍，挑最终盘面分最高的那个。每条扣分对应一条经验：
//   造洞重罚                      「一个洞能废掉四行」
//   高低差 0~1 可以，2 罚，3+ 重罚  「台阶要浅要宽，差 3 格只剩 I 能填」
//   比两边都低 3 格的竖缝罚         「别造只有 I 能救的坑」
//   最右一列留井，别的块填进去罚    「九列铺平，一列等 I」
//   表面同时要有给 O、S、Z 的位置   「什么块来都有地方放」—— 高手放得快的真正原因
//   堆高了就保命：消单行加分、井可以填  「被埋了就老老实实消单行」
// 只算从顶上直接落下能到的位置，不算滑入和 T 旋 —— 提示教的是基本堆叠。
let hintMode = false;
let hintMove = null;        // { x, y, rot, type, cells, why }
let hintBase = null;        // 出块那一刻的盘面，落下后拿它评你放的位置
// same = 和推荐一模一样；good = 和推荐一样好（含 same）；rules = 四条规则各犯了几次
let hintStats = { same: 0, good: 0, total: 0, holes: 0, rules: [0, 0, 0, 0] };
const HINT_WELL = COLS - 1;
const HINT_DANGER = 13;     // 九列里最高的到这个高度就切保命（可见区 20 行）
// 权重是让机器人只照着推荐放、跑出来调的（不涨灰线，每局 400~600 块）：
//   第一版 burn=+4 hole=60：不死，但每消一行都加分 → 见行就消，四消占消行 30%
//   扫了 24 组之后：安全时消零碎行改成**扣分**（burn=-6）、造洞罚重（hole=100），
//   四消占比 → 66%，造洞率 4.8% → 2.7%。这正是高手的打法：安全时不消零碎行、
//   攒着打四消；堆高了（HINT_DANGER）照样给消行加分，先保命。
//   在没参与调参的另三个种子上复核（1800 块）：造洞 79 → 48、四消占比 43% → 68%、0 死。
//   四消奖励 120 和 220 没有任何区别，井被堵罚 60 反而不如 35 —— 都没动。
//   对照组「哪里最低放哪里」：57~98 块就堆死，结束时 26~29 个洞。
const HW = {
  hole: 100, step1: 2, step2: 8, step3: 25, pit: 30, wellBlock: 35,
  noO: 8, noS: 10, noZ: 10, height: .5, tall: 15,
  tetris: 120, burn: -6, burnDanger: 30,
};

// 这几个模式都不写普通局的记录（最高分、存档、今日）。NES 和对战各有自己的记录
function assisted(){ return practice || hintMode || !!drill || !!nes || !!vs; }

function simBoard(){ return game.board.map(r => r.map(c => !!c)); }
function simFits(b, type, x, y, rot){
  for (const [cx, cy] of cellsOf(type, rot)){
    const X = x + cx, Y = y + cy;
    if (X < 0 || X >= COLS || Y >= TOTAL_ROWS) return false;
    if (Y >= 0 && b[Y][X]) return false;
  }
  return true;
}
// 从顶上直接落下能到的所有位置（同一组格子只留一个）
function simDrops(b, type){
  const out = [], seen = new Set();
  for (const rot of (type === 'O' ? [0] : [0, 1, 2, 3])){
    for (let x = -3; x < COLS + 1; x++){
      if (!simFits(b, type, x, 0, rot)) continue;
      let y = 0;
      while (simFits(b, type, x, y + 1, rot)) y++;
      const cells = cellsOf(type, rot).map(([cx, cy]) => [x + cx, y + cy]);
      const key = cells.map(c => c.join(',')).sort().join(';');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, rot, type, cells });
    }
  }
  return out;
}
function simPlace(b, cells){
  const nb = b.map(r => r.slice());
  for (const [X, Y] of cells) if (Y >= 0) nb[Y][X] = true;
  let lines = 0;
  for (let y = TOTAL_ROWS - 1; y >= 0; y--){
    if (nb[y].every(Boolean)){
      nb.splice(y, 1); nb.unshift(new Array(COLS).fill(false));
      lines++; y++;
    }
  }
  return { b: nb, lines };
}
function simFeatures(b){
  const h = new Array(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++){
    let top = TOTAL_ROWS;
    for (let y = 0; y < TOTAL_ROWS; y++) if (b[y][x]){ top = y; break; }
    h[x] = TOTAL_ROWS - top;
    for (let y = top + 1; y < TOTAL_ROWS; y++) if (!b[y][x]) holes++;
  }
  const field = h.slice(0, HINT_WELL);
  // 「什么块来都有地方放」：表面上有没有 O、S、Z 各自能落的形状
  let o = false, sp = false, zp = false;
  for (let i = 0; i + 1 < field.length; i++){
    const a = field[i], c = field[i + 1], e = i + 2 < field.length ? field[i + 2] : null;
    if (a === c) o = true;
    if (a === c + 1) sp = true;                              // S 竖放：左边高一格
    if (c === a + 1) zp = true;                              // Z 竖放：右边高一格
    if (e !== null && a === c && e === c + 1) sp = true;     // S 平放：右边高一格
    if (e !== null && a === c + 1 && c === e) zp = true;     // Z 平放：左边高一格
  }
  let bump = 0;
  for (let i = 0; i + 1 < field.length; i++) bump += Math.abs(field[i] - field[i + 1]);
  return { h, field, holes, bump, accept: { O: o, S: sp, Z: zp },
           maxH: Math.max(...field), minH: Math.min(...field) };
}
// 盘面本身的分（不含这一手消了几行）
function simScore(b){
  const f = simFeatures(b);
  const danger = f.maxH >= HINT_DANGER;
  let s = -f.holes * HW.hole;
  for (let i = 0; i + 1 < f.field.length; i++){
    const d = Math.abs(f.field[i] - f.field[i + 1]);
    s -= d <= 1 ? d * HW.step1 : d === 2 ? HW.step2 : HW.step3 * (d - 2);
  }
  for (let i = 0; i < f.field.length; i++){
    const l = i > 0 ? f.field[i - 1] : 99, r = i + 1 < f.field.length ? f.field[i + 1] : 99;
    if (Math.min(l, r) - f.field[i] >= 3) s -= HW.pit;
  }
  if (!danger && f.h[HINT_WELL] > f.minH) s -= HW.wellBlock * (f.h[HINT_WELL] - f.minH);
  if (!f.accept.O) s -= HW.noO;
  if (!f.accept.S) s -= HW.noS;
  if (!f.accept.Z) s -= HW.noZ;
  s -= f.field.reduce((a, v) => a + v, 0) * HW.height;
  if (f.maxH > 12) s -= (f.maxH - 12) * HW.tall;
  return s;
}
function lineValue(lines, danger){
  if (lines === 4) return HW.tetris;
  return lines * (danger ? HW.burnDanger : HW.burn);
}

// ── 读表面：每块的「默认去处」──
// 一块的底面在每一列各有一个最低格。它能严丝合缝地落下（底下一格空都不留），当且仅当
// 表面在这几列的高低和底面正好咬合。实测推荐的落点里 92% 都是这种贴合 —— 所以
// 「每块来了，先找和它底面一样的台阶」就是提示模式背后那条主规则，把它直接告诉人。
function bottomPattern(type, rot){
  const low = {};
  for (const [cx, cy] of cellsOf(type, rot)) low[cx] = Math.max(low[cx] ?? -99, cy);
  const xs = Object.keys(low).map(Number).sort((a, b) => a - b);
  const m = Math.max(...xs.map(x => low[x]));
  return xs.map(x => m - low[x]);        // 表面要的相对高度，0 = 这几列里最低的那列
}
const PAT_NAME = {
  '0': '竖插深缝', '00': '两列平', '10': '左高一格', '01': '右高一格', '20': '左高两格', '02': '右高两格',
  '000': '三列平', '001': '平平高', '100': '高平平', '101': '中间凹一格', '0000': '四列平',
  '110': '左两列高一格', '011': '右两列高一格',
};
function patGlyph(p){ return p.map(v => v <= 0 ? '▁' : v === 1 ? '▄' : '█').join(''); }
// 显示用：▁▄█ 在手机字体里是一条下划线加个小块，台阶高低看不出来 —— 换成几根小柱子。
// 原字符留在一个看不见的 <b> 里，复制、读屏、测试读 textContent 都还拿得到。
// 只处理我们自己拼的文字（块名、规则名、数字），照样先转义再插。
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escHtml(t){ return String(t).replace(/[&<>"']/g, c => HTML_ESC[c]); }
function stepsHTML(text){
  return escHtml(text).replace(/[▁▄█]+/g, g => '<span class="stp"><b>' + g + '</b>'
    + [...g].map(ch => '<s class="h' + '▁▄█'.indexOf(ch) + '"></s>').join('') + '</span>');
}
// 每种块不重样的贴合形状（S/Z/I 转两下就回原样，O 只有一种）
const PIECE_FITS = {};
function pieceFits(type){
  if (PIECE_FITS[type]) return PIECE_FITS[type];
  const out = [], seen = new Set();
  for (const rot of (type === 'O' ? [0] : [0, 1, 2, 3])){
    const pat = bottomPattern(type, rot), key = pat.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rot, pat, key, glyph: patGlyph(pat), name: PAT_NAME[key] || patGlyph(pat),
               orient: type === 'O' ? '' : pat.length >= 3 ? '横' : '竖' });
  }
  return (PIECE_FITS[type] = out);
}
function fitFor(type, rot){ const k = bottomPattern(type, rot).join(''); return pieceFits(type).find(f => f.key === k); }
// 这一手底下空了几格（0 = 贴合）。空着的格子会被这块盖住，就是洞
function fitGaps(b, cells){
  const low = {};
  for (const [x, y] of cells) low[x] = Math.max(low[x] ?? -99, y);
  let gaps = 0;
  for (const x in low){
    let top = TOTAL_ROWS;
    for (let y = 0; y < TOTAL_ROWS; y++) if (b[y][x]){ top = y; break; }
    gaps += Math.max(0, top - 1 - low[x]);
  }
  return gaps;
}
function inWell(cells){ return cells.some(c => c[0] === HINT_WELL); }
function pitCount(f){
  let n = 0;
  for (let i = 0; i < f.field.length; i++){
    const l = i > 0 ? f.field[i - 1] : 99, r = i + 1 < f.field.length ? f.field[i + 1] : 99;
    if (Math.min(l, r) - f.field[i] >= 3) n++;
  }
  return n;
}

// 一手的分：放下之后，再给下一块挑最好的落点，看最终盘面
function hintEval(b0, cells, nextType, danger){
  const r1 = simPlace(b0, cells);
  let score = -Infinity;
  if (nextType){
    for (const n of simDrops(r1.b, nextType)){
      const r2 = simPlace(r1.b, n.cells);
      const v = simScore(r2.b) + lineValue(r1.lines, danger) + lineValue(r2.lines, danger);
      if (v > score) score = v;
    }
  }
  if (score === -Infinity) score = simScore(r1.b) + lineValue(r1.lines, danger);
  return { score, lines: r1.lines, b: r1.b };
}

// 当前块 × 下一块，两层全试，挑最终盘面分最高的。每个落点的分都留着，判「这也行」要用
function hintBest(b0, type, nextType){
  const danger = simFeatures(b0).maxH >= HINT_DANGER;
  let best = null;
  const all = simDrops(b0, type);
  for (const m of all){
    const e = hintEval(b0, m.cells, nextType, danger);
    m.score = e.score; m.lines = e.lines; m.gaps = fitGaps(b0, m.cells);
    if (!best || e.score > best.score) best = Object.assign({}, m);
  }
  return best ? { best, all, danger } : null;
}

// 推荐的理由：先说规则（找哪种台阶），再说为什么是这一处
function hintWhy(b0, best, all, danger){
  const fit = fitFor(best.type, best.rot);
  const shape = fit ? fit.glyph + ' ' + fit.name : '';
  if (danger && best.lines) return '先保命 · 消 ' + best.lines + ' 行';
  if (best.type === 'I' && best.cells.every(c => c[0] === HINT_WELL))
    return best.lines === 4 ? '进井 · 四消' : best.lines ? '进井 · 消 ' + best.lines + ' 行' : '进井 · 等四消';
  const fits = all.filter(m => m.gaps === 0);
  if (!fits.length || best.gaps > 0) return '没处贴合 · 选洞最少的';
  const key = cs => cs.map(c => c.join(',')).sort().join(';');
  const others = fits.filter(m => key(m.cells) !== key(best.cells)).sort((a, b) => b.score - a.score);
  if (!others.length) return shape + ' · 只有这一处贴合';
  const alt = others[0];
  const fb = simFeatures(simPlace(b0, best.cells).b), fa = simFeatures(simPlace(b0, alt.cells).b);
  let why;
  if (best.lines > alt.lines) why = '顺手消 ' + best.lines + ' 行';
  else if (!danger && inWell(alt.cells) && !inWell(best.cells)) why = '别处会堵井';
  else if (pitCount(fa) > pitCount(fb)) why = '别处会挖出深坑';
  else if (fb.accept.O && fb.accept.S && fb.accept.Z && !(fa.accept.O && fa.accept.S && fa.accept.Z)) why = 'O/S/Z 都还有地方';
  else if (fb.bump < fa.bump) why = '放完更平';
  else why = '放完更低';
  return shape + ' · ' + why;
}
// 「先自己找」时不给位置，只给这块该找哪几种台阶
function pieceHintText(type){
  if (type === 'I') return 'I 找　井　或　▁▁▁▁';
  return type + ' 找　' + pieceFits(type).map(f => f.glyph).join('　或　');
}

// 推荐落点。提示模式和 T 旋练习共用教练那套（tsCompute）。
// 原来提示模式用的是 hintBest（留最右一列等 I 打四消）：子代理拿机器人在**开着灰线的普通局**里比过，
// 每秒 1 块、各 8 局 —— 照原来的提示打中位 41.7 万，照教练打 58.9 万（+41%）。
// 原因：原来那套把 T 槽屋檐下面那一格当洞扣分，等于一直在劝人别打 T 旋，而 T 旋双消每行的分
// 是四消的三倍；它又是关着灰线调的，开了灰线四消占比从 67% 掉到 31%。
// （对战机器人还用 hintBest —— 十个级别是拿它标定的，不能跟着改）
function hintCompute(){ return tsCompute(); }

// 「这也行」的容差：分差在这之内、洞也不比推荐多，就算放对了。
// 很多时候有两三处一样好，原来只认绿框那一格，放了另一处也算错 —— 学的人会以为自己判断错了。
// 取值是量出来的：机器人在容差内的落点里随机挑，3 局 × 400 块 ——
//   容差 0  造洞 3.4%  四消占比 67%（只走推荐）
//   容差 3  造洞 2.7%  四消占比 72%  ← 在波动范围内，约 19% 的块有不止一处可选
//   容差 6  造洞 3.3%  四消占比 61%  ← 开始掉
//   容差 25 造洞 3.6%  四消占比 55%
// 所以 3：「这也行」得是真的一样好，不是差不多就行。test_hint 里锁着这条。
const HINT_TOL = 3;
// 四条规则，按优先级。判错时只说排最前的那条
const HINT_RULES = [
  { n: '①', t: '不留洞', d: '先找和这块底面一样的台阶，严丝合缝放下去（T 槽屋檐底下那一格是留给 T 的，不算洞）' },
  { n: '②', t: '表面要平', d: '几处都贴合时，挑放完最平、O/S/Z 都还有地方放的；别挖只有 I 能填的深坑' },
  { n: '③', t: '给 T 留槽', d: '每 7 块有一个 T：搭一个两行深、一边有屋檐的槽等它 —— T 旋双消每行的分是四消的三倍。槽好了别拿别的块去填，没槽时来了 T 先暂存' },
  { n: '④', t: '堆高先保命', d: '堆到上半截了，能消就消 —— 灰线会越涨越快' },
];
let hintReveal = null;      // 「先自己找」时，放下之后把推荐亮一下 { cells, until }

// 你放下之后（锁定、消行判定之后）：和推荐一样好就算对；不对就说违反了哪一条
function hintAdjHoles(b){ return simFeatures(b).holes - (tsBestSlot(b) ? 1 : 0); }   // 槽屋檐下那一格不算洞
function hintSlotScore(b){ const s = tsBestSlot(b); return s ? (s.ready ? 100 : Math.max(0, 50 - s.miss * 10)) : 0; }
// 判一手：和推荐比，好不好、违反哪条、差多少（loss，推荐的估值减你的）。提示模式和普通局的后台教练共用
function judgeCore(rec, b0, p, n, spin){
  const cells = cellsOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy]);
  const key = cs => cs.map(c => c.join(',')).sort().join(';');
  const h0 = hintAdjHoles(b0), mineB = simPlace(b0, cells).b, hm = hintAdjHoles(mineB);
  const out = { cells, good: false, exact: false, r: -1, msg: '', loss: 0, holes: Math.max(0, hm - h0), tsd: false };
  if (p.type === 'T' && spin === 'tspin' && n === 2){
    out.good = true; out.exact = rec.kind === 'tsd'; out.tsd = true;
  } else if (rec.kind === 'tsd'){
    out.r = 2; out.msg = '槽在这：' + rec.path; out.loss = 60;
  } else if (rec.kind === 'hold'){
    out.r = 2; out.msg = p.type === 'T' ? '还没有槽，T 先暂存' : '槽好了、暂存里有 T，先换出来'; out.loss = 30;
  } else {
    out.exact = key(cells) === key(rec.cells);
    const recB = simPlace(b0, rec.cells).b, hr = hintAdjHoles(recB);
    const mine = tsEval(b0, cells, rec.next);
    out.loss = Math.max(0, rec.score - mine);
    if (out.exact || (rec.score - mine <= HINT_TOL && hm <= hr)) out.good = true;
    else {
      const recLines = simPlace(b0, rec.cells).lines, myLines = simPlace(b0, cells).lines;
      // 把搭好的槽填了放最前：填槽时屋檐下那格会变成真洞，但这时候该说的是「槽没了」，不是「留了洞」
      if (rec.readyBefore > 0 && tsReadyCount(mineB) < rec.readyBefore){
        out.r = 2; out.msg = '把 T 槽填了，槽留给 T';
      } else if (hm > hr){
        const gaps = fitGaps(b0, cells);
        out.r = 0; out.msg = gaps > 0 ? '留了 ' + gaps + ' 个洞，有能贴合的地方' : hm > h0 ? '这一块造了 ' + (hm - h0) + ' 个洞' : '推荐那里放完洞更少';
      } else if (rec.danger && recLines > 0 && myLines === 0){
        out.r = 3; out.msg = '堆高了，先消行';
      } else if (hintSlotScore(recB) > hintSlotScore(mineB)){
        out.r = 2; out.msg = '推荐那里在搭 T 槽';
      } else {
        const fm = simFeatures(mineB), fr = simFeatures(recB);
        out.r = 1;
        out.msg = pitCount(fm) > pitCount(fr) ? '挖出了只有 I 能填的深坑'
            : !(fm.accept.O && fm.accept.S && fm.accept.Z) && (fr.accept.O && fr.accept.S && fr.accept.Z) ? '放完 O/S/Z 有块没地方放了'
            : fm.bump > fr.bump ? '台阶变陡了' : '推荐那里放完更低更平';
      }
    }
  }
  return out;
}
function hintJudge(p, n, spin){
  if (!hintMode || tsOn() || !tsRec || !tsBase) return;
  hintReveal = null;          // 上一块亮着的推荐作废，不然连着放两块会叠在一起
  const rec = tsRec, b0 = tsBase;
  hintStats.total++;
  const J = judgeCore(rec, b0, p, n, spin);
  const { cells, good, exact, r, msg } = J;
  hintStats.holes = (hintStats.holes || 0) + J.holes;
  if (J.tsd){ tsStats.tsd++; showToast('✓ T 旋双消', 1200); }
  if (exact) hintStats.same++;
  if (good) hintStats.good++;
  // 放偏了，或者藏着推荐自己找的时候，放完把推荐亮一下对照
  if (rec.cells && !exact && (hintHidden() || !good)){
    const full = [];
    const nb = b0.map(row => row.slice());
    for (const [x, y] of cells) if (y >= 0) nb[y][x] = true;
    for (let y = 0; y < TOTAL_ROWS; y++) if (nb[y].every(Boolean)) full.push(y);
    const shown = rec.cells.filter(([, y]) => !full.includes(y))
                           .map(([x, y]) => [x, y + full.filter(rr => rr > y).length]);
    hintReveal = { cells: shown, until: performance.now() + 1400 };
    setTimeout(() => { needsDraw = true; }, 1450);
  }
  if (!good){
    hintStats.rules[r]++;
    showToast(HINT_RULES[r].n + ' ' + msg, 2200);
  } else if (!exact && rec.kind === 'place') showToast(hintHidden() ? '✓ 这也行' : '这也行 ✓　和绿框一样好', 900);
  else if (exact && hintHidden() && !(spin === 'tspin' && n === 2)) showToast('✓ 和推荐一样', 700);
  syncHint();
}

// 「先自己找」：推荐不先给，放完再亮。每日练习的堆叠段强制这样 —— 跟着绿框放，
// 一致率永远是 100%，量不出你自己会不会
const HINT_HIDE_KEY = nsKey('hint.hide.v1');
let hintHide = false;
try { hintHide = localStorage.getItem(HINT_HIDE_KEY) === '1'; } catch { /* 读不到就默认显示 */ }
function hintHidden(){ return !tsOn() && (hintHide || !!(drill && drill.stage === 'stack')); }
function toggleHintHide(){
  hintHide = !hintHide;
  try { localStorage.setItem(HINT_HIDE_KEY, hintHide ? '1' : '0'); } catch { /* 存不了就算了 */ }
  needsDraw = true;
  syncHint();
}

function syncHint(){
  document.body.classList.toggle('hinting', hintMode);
  document.body.classList.toggle('tspinning', tsOn());
  if (tsOn()) return tsSyncBar();
  if (drill) syncDrill();      // 每日练习的堆叠段：推荐理由写在它自己的细栏里
  if (!hintMode) return;
  const w = $('hintWhy');
  if (w) w.innerHTML = stepsHTML(!hintMove ? '' : hintHidden() ? pieceHintText(hintMove.type) : '推荐　' + hintMove.why);
  const sc = $('hintScore');
  if (sc) sc.textContent = '对 ' + hintStats.good + '/' + hintStats.total + (tsStats.tsd ? ' · TSD ' + tsStats.tsd : '');
  const hb = $('hintHide');
  if (hb){ hb.textContent = hintHide ? '看推荐' : '先自己找'; hb.classList.toggle('on', hintHide); }
  const rs = $('hintSheet');
  if (rs && !rs.hidden) renderHintSheet();
}

// 盘面上的绿框。你的落点虚影正好对上推荐时，绿框填实，告诉你「对了」
const HINT_COLOR = '#5ee08a';
function hintBox(c, cells, solid, alpha){
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = HINT_COLOR;
  c.lineWidth = Math.max(2, CELL * .09);
  if (!solid) c.setLineDash([CELL * .22, CELL * .14]);
  for (const [x, y] of cells){
    if (y < BUFFER) continue;
    const px = x * CELL + 2, py = (y - BUFFER) * CELL + 2, d = CELL - 4;
    if (solid){ c.globalAlpha = alpha * .28; c.fillStyle = HINT_COLOR; roundRect(c, px, py, d, d, CELL * .16); c.fill(); c.globalAlpha = alpha; }
    roundRect(c, px, py, d, d, CELL * .16);
    c.stroke();
  }
  c.restore();
}
function drawHint(c, ghostCells){ tsDraw(c, ghostCells); }
// 放完之后亮一下推荐（只在没对上、或者藏着推荐的时候）
function drawHintReveal(c){
  if (!hintMode || !hintReveal || game.over) return;
  if (performance.now() > hintReveal.until){ hintReveal = null; return; }
  hintBox(c, hintReveal.cells, false, .75);
}

// 规则卡：四条优先级（带你这一局各犯了几次）+ 七种块各自找什么台阶
function renderHintSheet(){
  const body = $('hintRulesBody');
  if (!body) return;
  const sw = $('hintHideSw'); if (sw) sw.hidden = false;      // T 旋练习会把它藏起来，回到堆叠提示要放回来
  // 标题和开头那段介绍两个模式各一套（第一版 T 旋练习里还写着「堆叠规则」）
  const tt = $('hintSheetTitle'), ti = $('hintSheetIntro');
  if (tt) tt.textContent = tsOn() ? 'T 旋要领' : '堆叠规则';
  if (ti) ti.hidden = tsOn();
  if (tsOn()) return tsRenderSheet(body);
  const worst = hintStats.rules.indexOf(Math.max(...hintStats.rules));
  let h = '<span class="sheet-lb">放之前按顺序问自己</span>';
  HINT_RULES.forEach((r, i) => {
    const n = hintStats.rules[i];
    h += '<div class="hr-rule' + (n && i === worst ? ' worst' : '') + '"><b>' + r.n + ' ' + r.t + '</b><span>' + r.d + '</span>'
       + '<em>' + (n ? '这次犯了 ' + n + ' 次' + (i === worst ? ' · 最该盯的' : '') : '这次没犯') + '</em></div>';
  });
  h += '<span class="sheet-lb">每种块找什么台阶（▁ 低 ▄ 高一格 █ 高两格）</span><div class="hr-fits">';
  for (const t of TYPES){
    const fits = t === 'I' ? [{ glyph: '井', name: '竖着进井打四消' }, ...pieceFits('I').filter(f => f.pat.length === 4)]
                           : pieceFits(t);
    h += '<div class="hr-fit"><b style="color:' + colorOf(t) + '">' + t + '</b><span>'
       + fits.map(f => '<i>' + stepsHTML(f.glyph) + '</i>' + escHtml((f.orient ? f.orient + ' ' : '') + f.name)).join('<br>') + '</span></div>';
  }
  h += '</div>';
  body.innerHTML = h;
  const tg = $('hintHideSw');
  if (tg) tg.textContent = hintHide ? '现在：先自己找，放完再看推荐 —— 点这里改回直接看' : '现在：直接看推荐 —— 点这里改成先自己找';
}
function openHintSheet(){
  const sh = $('hintSheet');
  if (!hintMode || !sh) return;
  renderHintSheet();
  sh.hidden = false;
  game.frozen = true;
}
function closeHintSheet(){
  const sh = $('hintSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  game.frozen = false;
  resumeLoop();
}

// 进提示模式：和进练习一样，普通局打到一半先存一份
function startHint(){
  if (!assisted() && game.started && !game.over) saveGame(true);
  closePrSheet();
  drillEnd(); nesEnd(); vsEnd();
  practice = false; practiceLevel = null; practiceStep = 0; practiceDone = false;
  demoRunning = false; undoStack.length = 0;
  hintMode = true;
  hintKind = 'stack';
  hintStats = { same: 0, good: 0, total: 0, holes: 0, rules: [0, 0, 0, 0] };
  hintReveal = null;
  tsStats = { tsd: 0, built: 0, miss: 0, filled: 0, waste: 0 };
  restart();                 // 里面 spawn 时会算第一块的推荐
  // 和普通局一样开着灰线、正常升级：你在普通局里是被灰线顶死的，原来提示模式关着灰线练，练的不是那个局面
  game.noGarbage = false;
  syncPractice(); syncHint();
}

// ───────────────────────── T 旋练习 ─────────────────────────
//
// 提示模式的变体：教练的目标从「堆平」换成「打出 T 旋双消（TSD）」。照着几篇公开攻略的共识做：
//   · 槽的样子：两行深的缺口、一边有屋檐，槽下面那行只空槽口一格（tetris.wiki「T-Spin Double」）
//   · 屋檐用 L/J 横放最常用，S/Z 也行；别拿 T 去填平地（gamertagmythras 的 T-spin 指南）
//   · 槽下面那行要补满，不然 T 转进去只消一行
//   · 7 块必有一个 T：槽没好就先暂存 T；转进去时软降到底，最后一下必须是旋转
// 每块出来：普通块推荐「怎么把槽搭起来」；槽好了在盘面上标出来（品红）等 T；
// T 来了给出转进去的路径；没槽时来了 T 建议先暂存。放完马上判，说清楚差在哪。
// 可以暂存、看 3 个 NEXT（要看 T 什么时候来），不涨灰线、不升级、不记成绩（assisted）。
let hintKind = 'stack';
// 这一局用过键盘（有逆时针 Z 键）：教练给路径时也用逆时针，不再偏向左屋檐（那条只对手机屏幕有意义）
let kbUsed = false;           // 'stack' = 堆叠提示，'tspin' = T 旋练习
function tsOn(){ return hintMode && hintKind === 'tspin'; }
let tsStats = { tsd: 0, built: 0, miss: 0, filled: 0, waste: 0 };
let tsRec = null;                 // 这一块的建议 { kind: 'tsd'|'place'|'hold', cells, rot, x, why, path, readyBefore }
let tsBase = null;                // 出块那一刻的盘面

// 盘面上的 TSD 槽：T 尖朝下时中心在 (x, y)。x 是槽口那一列，y 是槽的上一行
function tsdSlots(b){
  const out = [];
  const filled = (X, Y) => X < 0 || X >= COLS || Y >= TOTAL_ROWS || (Y >= 0 && b[Y][X]);
  for (let y = 1; y < TOTAL_ROWS - 1; y++){
    for (let x = 1; x < COLS - 1; x++){
      if (filled(x - 1, y) || filled(x, y) || filled(x + 1, y) || filled(x, y + 1)) continue;
      if (!filled(x - 1, y + 1) || !filled(x + 1, y + 1)) continue;      // 底下两个角
      const roofL = filled(x - 1, y - 1), roofR = filled(x + 1, y - 1);
      if (roofL === roofR) continue;                                      // 没屋檐 / 两边都盖死
      if (filled(x, y - 1)) continue;                                     // 槽口正上方堵了
      let miss = 0;                                                       // 两行还差几格才能一起消
      for (let X = 0; X < COLS; X++){
        if (Math.abs(X - x) > 1 && !b[y][X]) miss++;
        if (X !== x && !b[y + 1][X]) miss++;
      }
      out.push({ x, y, roof: roofL ? -1 : 1, miss, ready: miss === 0 });
    }
  }
  return out;
}
// 手机上只有顺时针键。实测（simReach 只用顺时针，数左右 + 变换的次数）：
//   屋檐在左的槽 2~6 下，固定手法「变换一下 → 送下去 → 到底再变换一下」
//   屋檐在右的槽 5~10 下，要在顶上转三下、到底再转三下（等于逆时针）—— 实战里很容易按乱
// 所以同样差几格时优先左屋檐，搭槽的加分右屋檐只给一半
function tsBestSlot(b){
  let best = null;
  for (const s of tsdSlots(b))
    if (!best || s.miss < best.miss || (s.miss === best.miss && !kbUsed && s.roof < best.roof)) best = s;
  return best;
}
function tsReadyCount(b){ return tsdSlots(b).filter(s => s.ready).length; }
// 搭槽的加分：槽搭好 / 差几格（每差一格扣 step）/ 有雏形。是个可改的对象，调参时机器人直接改它。
// 量出来的（机器人照教练建议打，3 局 × 400 块）：
//   90/44/9/28    每 25 块一个 TSD  新增洞 9.9%  最高 9
//   140/70/12/55  每 21 块一个      洞 11.1%    最高 14
//   120/60/12/25  每 22 块一个      洞 9.6%     最高 10   ← 选这个：TSD 差不多一样多，洞最少、堆得最低
// （「洞」里约一半是搭好的槽屋檐下面那一格，本来就要空着等 T）
const TS_W = { ready: 120, part: 60, step: 12, notch: 25 };
// 槽的雏形：一个「中间深、两边浅」的三格缺口（两边比中间高一格，再外面比中间高两格）。
// 攻略里搭 TSD 的第一步就是留出这个缺口，然后拿 L/J/O 往一边盖屋檐
function tsNotch(h){
  for (let c = 1; c < COLS - 1; c++){
    const k = h[c];
    if (h[c - 1] !== k + 1 || h[c + 1] !== k + 1) continue;
    if (c - 2 >= 0 && h[c - 2] < k + 2) continue;
    if (c + 2 < COLS && h[c + 2] < k + 2) continue;
    return c;
  }
  return -1;
}
// 盘面分。不能直接用堆叠提示那套：它把最右一列留成井等 I 打四消，可 TSD 要求槽两边那两行
// 都填满 —— 井一直空着，这两行就永远满不了，槽永远「搭不好」（第一版跑 500 块只成 0~4 个 TSD）。
// 这里十列一起铺平，不留井；槽本身那一格空不算洞；有槽 / 有雏形就加分
function tsScore(b){
  const f = simFeatures(b), h = f.h;
  let s = -f.holes * HW.hole;
  for (let i = 0; i + 1 < COLS; i++){
    const d = Math.abs(h[i] - h[i + 1]);
    s -= d <= 1 ? d * HW.step1 : d === 2 ? HW.step2 : HW.step3 * (d - 2);
  }
  for (let i = 0; i < COLS; i++){
    const l = i > 0 ? h[i - 1] : 99, r = i + 1 < COLS ? h[i + 1] : 99;
    if (Math.min(l, r) - h[i] >= 3) s -= HW.pit;
  }
  const maxH = Math.max(...h);
  s -= h.reduce((a, v) => a + v, 0) * HW.height;
  if (maxH > 12) s -= (maxH - 12) * HW.tall;
  const best = tsBestSlot(b);
  if (best){
    s += HW.hole;
    const bonus = best.ready ? TS_W.ready : best.miss <= 4 ? TS_W.part - best.miss * TS_W.step : 0;
    s += best.roof < 0 || kbUsed ? bonus : bonus * .5;
  } else if (tsNotch(h) >= 0) s += TS_W.notch;
  return s;
}
// 普通消行：堆高了就放开消（保命），平时别为了一两行去消，留着两行给 T 旋
function tsLineValue(lines, b){
  if (!lines) return 0;
  return lines * (maxHAll(b) >= HINT_DANGER ? HW.burnDanger : HW.burn);
}
function tsEval(b0, cells, nextType){
  const r1 = simPlace(b0, cells);
  let v = -Infinity;
  if (nextType && nextType !== 'T'){
    for (const n of simDrops(r1.b, nextType)){
      const r2 = simPlace(r1.b, n.cells);
      v = Math.max(v, tsScore(r2.b) + tsLineValue(r2.lines, r1.b));
    }
  }
  if (v === -Infinity) v = tsScore(r1.b);
  return v + tsLineValue(r1.lines, b0);
}
// 按键串（simReach 的 L/R/d/C）讲成人话：右 2 → 软降 → 变换
function tsPathText(acts){
  const out = [];
  const re = /(L+|R+|d+|C+|A+)/g;
  let m;
  while ((m = re.exec(acts))){
    const g = m[1], k = g.length;
    if (g[0] === 'L') out.push('左 ' + k);
    else if (g[0] === 'R') out.push('右 ' + k);
    else if (g[0] === 'd') out.push('软降');
    else if (g[0] === 'A') out.push(k > 1 ? '逆时针 ×' + k : '逆时针（Z）');
    else out.push(k > 1 ? '变换 ×' + k : '变换');
  }
  // 开头那段一路往下的软降是「先落到槽口附近」，说成「送下去」更好懂
  return out.join(' → ').replace(/^软降 → /, '');
}
function tsNextT(){
  if (game.hold === 'T' && !game.holdUsed) return '暂存里有 T';
  const i = game.queue.indexOf('T');
  return i < 0 ? 'T 还没进 NEXT' : 'T 还有 ' + (i + 1) + ' 块';
}

// 盘面最高的那一列（十列都算）。simFeatures 的 maxH 只看前九列（老教练留第十列当井），不留井的教练用它判堆高会漏掉第十列
function maxHAll(b){ return Math.max(...simFeatures(b).h); }
// 不留井时的落点理由（原来兜底借用老教练的 hintWhy，会冒出「别处会堵井」「进井 · 等四消」这种留井的说法）
function tsPlainWhy(b0, cells){
  const r = simPlace(b0, cells), f0 = simFeatures(b0), f1 = simFeatures(r.b);
  if (r.lines) return '消 ' + r.lines + ' 行' + (maxHAll(b0) >= HINT_DANGER ? ' · 先保命' : '');
  if (f1.holes > f0.holes) return '没处贴合 · 选洞最少的';
  const low = Math.min(...f0.h);
  if (cells.some(([x]) => f0.h[x] === low)) return '填低处 · 放完更平';
  return '贴合台阶 · 放完更平';
}
// 教练推荐：给定盘面、当前块、下一块、暂存状态，算出这一块该怎么放（提示模式显示它；普通局在后台悄悄算，局后复盘用）
function coachRec(b0, type, next, hold, holdUsed){
  const readyBefore = tsReadyCount(b0);
  const danger = maxHAll(b0) >= HINT_DANGER;
  if (type === 'T'){
    const locks = simReach(b0, 'T', kbUsed);
    const tsd = locks.filter(l => l.spin === 'tspin' && l.lines === 2);
    if (tsd.length){
      // 挑「要按的键最少」的那条：软降是按住不放，不算次数；只数左右和变换。
      // 原来按总长度挑，软降每格都算一下，结果挑出「变换 ×3 → 软降 → 变换 ×3」这种绕远的
      const presses = a => a.acts.replace(/d/g, '').length;
      const m = tsd.sort((a, c) => presses(a) - presses(c) || a.acts.length - c.acts.length)[0];
      return { kind: 'tsd', cells: m.cells, rot: m.rot, x: m.x, path: tsPathText(m.acts), readyBefore,
               why: 'T 来了：' + tsPathText(m.acts) };     // 「最后一下必须是变换」写在要领卡里，细栏放不下
    }
    if (!holdUsed && hold !== 'T') return { kind: 'hold', readyBefore, why: '还没有槽 —— 先暂存 T，留着打 T 旋' };
  } else if (hold === 'T' && !holdUsed && readyBefore){
    return { kind: 'hold', readyBefore, why: '槽好了、暂存里有 T —— 点暂存把 T 换出来' };
  }
  // 普通落点：哪个最有利于把槽搭起来
  let best = null;
  for (const m of simDrops(b0, type)){
    const v = tsEval(b0, m.cells, next);
    if (!best || v > best.v) best = Object.assign({ v }, m);
  }
  if (!best) return null;
  const before = tsBestSlot(b0), after = tsBestSlot(simPlace(b0, best.cells).b);
  let why;
  if (after && after.ready && !(before && before.ready))
    why = ((type === 'L' || type === 'J') ? '搭屋檐' : '这块') + ' —— 槽搭好了' + (after.roof < 0 ? '（屋檐在左，顺时针好转）' : '');
  else if (after && before && after.miss < before.miss) why = '补槽两边 —— 还差 ' + after.miss + ' 格就能等 T';
  else if (after && !before) why = (type === 'L' || type === 'J' || type === 'S' || type === 'Z') ? '起个槽：这块做屋檐' : '起个槽';
  else if (before && before.ready) why = '槽留着别碰 · ' + tsNextT();
  else why = tsPlainWhy(b0, best.cells);
  return { kind: 'place', cells: best.cells, rot: best.rot, x: best.x, readyBefore, why, score: best.v, next, danger };
}
function tsCompute(){
  tsRec = null; hintMove = null;
  const p = game.piece;
  if (!hintMode || !p || game.over) return syncHint();
  const b0 = simBoard();
  tsBase = b0;
  tsRec = coachRec(b0, p.type, game.queue[0], game.hold, game.holdUsed);
  if (tsRec && tsRec.cells) hintMove = { type: p.type, cells: tsRec.cells, rot: tsRec.rot, x: tsRec.x, why: tsRec.why };
  else if (tsRec) hintMove = { type: p.type, cells: null, why: tsRec.why };   // 建议暂存：没有落点，细栏照样有话
  needsDraw = true;
  syncHint();
}

// 锁定之后（消行判定之后）
function tsOnLock(p, n, spin){
  if (!tsOn() || !tsBase) return;
  const rec = tsRec;
  const cells = cellsOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy]);
  if (p.type === 'T'){
    if (spin === 'tspin' && n === 2){
      tsStats.tsd++;
      showToast('✓ T 旋双消　第 ' + tsStats.tsd + ' 个', 1400);
    } else if (rec && rec.kind === 'tsd'){
      tsStats.miss++;
      showToast(spin === 'tspin' && n === 1 ? '只消了一行 —— 槽下面那行没补满'
                : '槽在这：' + rec.path + '（软降到底再变换，转完别再挪）', 2600);
    } else if (rec && rec.kind === 'hold'){
      tsStats.waste++;
      showToast('没槽时别把 T 用掉 —— 先暂存，留着打 T 旋', 2200);
    }
  } else {
    const after = tsReadyCount(simPlace(tsBase, cells).b);
    const before = rec ? rec.readyBefore : tsReadyCount(tsBase);
    if (before > 0 && after < before){
      tsStats.filled++;
      showToast('把 T 槽填了 —— 槽留给 T', 1800);
    } else if (before === 0 && after > 0){
      tsStats.built++;
      showToast('✓ 槽搭好了，等 T（' + tsNextT() + '）', 1800);
    }
  }
  syncHint();
}

// 画：推荐落点（绿框）+ 盘面上已经搭好的槽（品红，T 的形状）
const TS_COLOR = '#ff6bd6';
function tsDraw(c, ghostCells){
  if (!hintMode || game.over || hintHidden()) return;
  const slot = tsBase ? tsdSlots(tsBase).filter(s => s.ready)[0] : null;
  if (slot){
    const cells = [[slot.x - 1, slot.y], [slot.x, slot.y], [slot.x + 1, slot.y], [slot.x, slot.y + 1]];
    c.save();
    c.strokeStyle = TS_COLOR; c.globalAlpha = .85;
    c.lineWidth = Math.max(2, CELL * .08);
    c.setLineDash([CELL * .18, CELL * .12]);
    for (const [x, y] of cells){
      if (y < BUFFER) continue;
      roundRect(c, x * CELL + 3, (y - BUFFER) * CELL + 3, CELL - 6, CELL - 6, CELL * .16);
      c.stroke();
    }
    c.restore();
  }
  if (hintMove && hintMove.cells && game.piece){
    const key = cs => cs.map(v => v.join(',')).sort().join(';');
    hintBox(c, hintMove.cells, !!ghostCells && key(ghostCells) === key(hintMove.cells), 1);
  }
}

function tsSyncBar(){
  const w = $('hintWhy');
  if (w) w.innerHTML = stepsHTML(tsRec ? tsRec.why : '');
  const sc = $('hintScore');
  if (sc) sc.textContent = 'TSD ' + tsStats.tsd;
  const rs = $('hintSheet');
  if (rs && !rs.hidden) renderHintSheet();
}

// 要领卡
const TS_RULES = [
  ['槽长什么样', '两行深的缺口，一边有屋檐盖着；槽下面那行只空槽口那一格。盘面上品红虚线就是一个搭好的槽'],
  ['屋檐用 L / J', 'L、J 横放最顺手，S、Z 也行。别拿 T 去填平地 —— T 是用来转进槽的'],
  ['底下那行要补满', '槽两边都得填满，不然 T 转进去只消一行（T 旋单消）'],
  ['槽没好先暂存 T', '7 块里必有一个 T：槽没搭好就把 T 放进暂存，等槽好了再换出来'],
  ['转进去的手法', '把 T 送到槽口上方，软降到底，最后一下按变换转进去 —— 转完不能再挪，挪了就不算 T 旋'],
  ['手机上屋檐搭在左边', '屏幕上只有顺时针：屋檐在左的槽，手法固定是「变换一下 → 送下去 → 到底再变换一下」，2~3 下；屋檐在右要连按六七下，容易按乱。用键盘（有 Z 键逆时针）就两边都一样'],
];
// 速度：1 级慢慢想，练熟了换快的 —— 普通局到 10 级以后块掉得快，得一眼认出槽、手上直接按出来
const TS_SPEED_KEY = nsKey('ts.speed.v1');
const TS_SPEEDS = [[1, '慢'], [10, '中'], [20, '快']];
let tsSpeed = 1;
try { const v = +localStorage.getItem(TS_SPEED_KEY); if (TS_SPEEDS.some(([l]) => l === v)) tsSpeed = v; } catch { /* 读不到就慢速 */ }
// 灰线：默认关（专心练槽）；开了就跟普通局一样涨灰线 —— 实战里是在灰线顶着的时候打 T 旋
const TS_GARB_KEY = nsKey('ts.garbage.v1');
let tsGarbage = false;
try { tsGarbage = localStorage.getItem(TS_GARB_KEY) === '1'; } catch { /* 默认关 */ }
function setTsGarbage(on){
  tsGarbage = !!on;
  try { localStorage.setItem(TS_GARB_KEY, tsGarbage ? '1' : '0'); } catch { /* 存不了就这一次 */ }
  if (tsOn()) game.noGarbage = !tsGarbage;
  syncModeTag();
  renderHintSheet();
}
function tsSpeedName(){ return (TS_SPEEDS.find(([l]) => l === tsSpeed) || TS_SPEEDS[0])[1]; }
function setTsSpeed(lv){
  if (!TS_SPEEDS.some(([l]) => l === lv)) return;
  tsSpeed = lv;
  try { localStorage.setItem(TS_SPEED_KEY, String(lv)); } catch { /* 存不了就算了 */ }
  if (tsOn()){ game.level = lv; syncEdge(); needsDraw = true; }   // 当场换速，不用重开
  syncModeTag();
  renderHintSheet();
}
function tsRenderSheet(body){
  let h = '<span class="sheet-lb">速度</span><div class="seg seg-3">'
        + TS_SPEEDS.map(([l, n]) => '<button class="seg-btn' + (l === tsSpeed ? ' on' : '') + '" type="button" data-tsv="' + l + '">'
                                   + n + ' · ' + l + ' 级</button>').join('') + '</div>'
        + '<span class="sheet-lb">灰线</span><div class="seg">'
        + [[false, '关 · 专心练槽'], [true, '开 · 跟普通局一样涨']].map(([v, n]) => '<button class="seg-btn' + (v === tsGarbage ? ' on' : '')
          + '" type="button" data-tsg="' + (v ? 1 : 0) + '">' + n + '</button>').join('') + '</div>';
  h += '<span class="sheet-lb">要领（来自 tetris.wiki 等公开攻略的共识）</span>';
  TS_RULES.forEach(([t, d], i) => {
    h += '<div class="hr-rule"><b>' + (i + 1) + ' ' + escHtml(t) + '</b><span>' + escHtml(d) + '</span></div>';
  });
  const s = tsStats;
  h += '<span class="sheet-lb">这一局</span><div class="hr-rule"><span>'
     + '打出 T 旋双消 <b>' + s.tsd + '</b> 个 · 搭好槽 ' + s.built + ' 次<br>'
     + '有槽没打 ' + s.miss + ' 次 · 把槽填了 ' + s.filled + ' 次 · 没槽用掉 T ' + s.waste + ' 次</span></div>';
  body.innerHTML = h;
  body.querySelectorAll('[data-tsv]').forEach(b => b.onclick = () => setTsSpeed(+b.dataset.tsv));
  body.querySelectorAll('[data-tsg]').forEach(b => b.onclick = () => setTsGarbage(b.dataset.tsg === '1'));
  const tg = $('hintHideSw');
  if (tg) tg.hidden = true;
}

function startTspin(){
  startHint();
  hintKind = 'tspin';
  game.noGarbage = !tsGarbage;      // 默认不涨灰线专心练槽；开了灰线就是实战
  game.level = tsSpeed;             // 等级不涨（见锁定后升级那里），停在选的速度
  syncEdge();
  tsStats = { tsd: 0, built: 0, miss: 0, filled: 0, waste: 0 };
  document.body.classList.add('tspinning');
  previewDirty = true;
  syncModeSwitch();
  tsCompute();
}

// ───────────────────────── 每日练习 ─────────────────────────
//
// 练习关是固定盘面，练几遍就背下来了；提示模式和普通局又都不留记录 ——
// 天天练，有没有变强自己说不出来。每日练习把三段串成十分钟左右，每段出一个
// 能跨天比的数，按北京时间归日存下来（每天每项只留最好的那次）：
//   ① T 槽热身：5 道**随机生成**的 T 旋双消题。盘面每次都不同，练的是「认出槽」
//      而不是背按键。每道题生成后用 BFS 验过「只用顺时针能打出来」
//   ② 堆叠：提示模式放 100 块（推荐藏着，放完才亮），看放对几成、造了几个洞、最常犯哪条规则
//   ③ 40 行冲刺：标准计时赛。看用时、每秒几块（PPS）、每块按几下键（KPP），
//      和「多余按键」—— 同一个落点，按的次数比最少按法多的块数
// 隔离和练习/提示一样（assisted）：不涨灰线、不写最高分、不存档。等级也不涨，
// 三段的难度每天一致，数字才能横着比。
const DRILL_KEY = nsKey('drill.v1');
const DRILL_WARM_N = 5;
const DRILL_STACK_N = 100;
const DRILL_SPRINT_LINES = 40;
const DRILL_DAYS_KEPT = 60;
// 挖灰线：底下垫 DRILL_DIG_ROWS 行灰线（每行缺口随机，和普通局涨上来的一样），10 级的速度，挖光就结束。
// 子代理复查时指出的最大缺口：普通局是被灰线顶死的，可所有练习都把灰线关了，从来没练过挖
const DRILL_DIG_ROWS = 8;
const DRILL_DIG_LEVEL = 10;
const DRILL_STAGES = ['warm', 'stack', 'dig', 'sprint'];
const DRILL_NAME = { warm: '① T 槽热身', stack: '② 堆叠', dig: '③ 挖灰线', sprint: '④ 40 行冲刺' };
const DRILL_SHORT = { warm: '热身', stack: '堆叠', dig: '挖灰线', sprint: '冲刺' };
const DRILL_DESC = {
  warm: DRILL_WARM_N + ' 道随机 T 旋双消题，看一次过几道',
  stack: '自己找位置放 ' + DRILL_STACK_N + ' 块，放完对照推荐，看放对几成、最常犯哪条',
  dig: '底下垫 ' + DRILL_DIG_ROWS + ' 行灰线，挖光计时 —— 普通局就是被灰线顶死的',
  sprint: '消 ' + DRILL_SPRINT_LINES + ' 行计时，看用时、PPS、多余按键',
};
// 盘面上还剩几行灰线（马上要消掉的满行不算）
function drillDigLeft(){
  let n = 0;
  for (const row of game.board) if (row.some(c => c === GARBAGE) && !row.every(Boolean)) n++;
  return n;
}

// ── 存取 ── 坏数据一律当没有，日期键和数字都过一遍校验再用
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function drillReadAll(){
  try {
    const d = JSON.parse(localStorage.getItem(DRILL_KEY) || 'null');
    if (d && typeof d === 'object' && d.days && typeof d.days === 'object') return d;
  } catch { /* 坏数据当没有 */ }
  return { v: 1, days: {} };
}
// a 比 b 好吗。b 不存在就算好
function drillBetter(stage, a, b){
  if (!b) return true;
  if (stage === 'warm') return a.first > b.first || (a.first === b.first && a.ms < b.ms);
  if (stage === 'stack'){
    if (!!a.dead !== !!b.dead) return !a.dead;
    const ra = a.same / Math.max(1, a.total), rb = b.same / Math.max(1, b.total);
    return ra > rb || (ra === rb && a.holes < b.holes);
  }
  if (!!a.done !== !!b.done) return !!a.done;
  return a.done ? a.ms < b.ms : a.lines > b.lines;
}
function drillSave(stage, res){
  const all = drillReadAll(), day = bjDay();
  const d = all.days[day] || (all.days[day] = {});
  if (drillBetter(stage, res, d[stage])) d[stage] = res;
  const keep = Object.keys(all.days).filter(k => DAY_RE.test(k)).sort().slice(-DRILL_DAYS_KEPT);
  const days = {};
  for (const k of keep) days[k] = all.days[k];
  try { localStorage.setItem(DRILL_KEY, JSON.stringify({ v: 1, days })); } catch { /* 存不了就算了 */ }
}
// 今天之前、最近一次有这一项的记录 —— 「比上次」拿它比
function drillPrev(stage){
  const all = drillReadAll(), today = bjDay();
  const ks = Object.keys(all.days).filter(k => DAY_RE.test(k) && k < today && all.days[k][stage]).sort();
  return ks.length ? { day: ks[ks.length - 1], r: all.days[ks[ks.length - 1]][stage] } : null;
}

// ── 模拟：从出生点能走到哪些锁定位置 ──
// 动作只有 左 / 右 / 下一格 / 顺时针（带踢墙），和手机上的按键一致。
function simTSpin(b, x, y, rot, lastRot, kick){
  if (!lastRot) return null;
  return tspinKind((X, Y) => X < 0 || X >= COLS || Y >= TOTAL_ROWS || (Y >= 0 && b[Y][X]), x, y, rot, kick);
}
// ccw：也试逆时针（键盘有 Z 键；手机屏幕上只有顺时针，默认不试）
function simReach(b, type, ccw){
  // acts 是走到这里的按键串（parseActs 的写法），测试拿它在真盘面上回放
  const start = { x: PIECES[type].spawnX, y: 0, rot: 0, lr: false, k: -1, acts: '' };
  if (!simFits(b, type, start.x, start.y, start.rot)) return [];
  const seen = new Set(), q = [start], out = [];
  const key = s => s.x + ',' + s.y + ',' + s.rot + ',' + (s.lr ? 1 : 0);
  const push = s => { const k = key(s); if (!seen.has(k)){ seen.add(k); q.push(s); } };
  seen.add(key(start));
  for (let qi = 0; qi < q.length; qi++){
    const s = q[qi];
    if (simFits(b, type, s.x, s.y + 1, s.rot)) push({ x: s.x, y: s.y + 1, rot: s.rot, lr: false, k: -1, acts: s.acts + 'd' });
    else {
      const cells = cellsOf(type, s.rot).map(([cx, cy]) => [s.x + cx, s.y + cy]);
      out.push({ x: s.x, y: s.y, rot: s.rot, cells, acts: s.acts,
                 spin: type === 'T' ? simTSpin(b, s.x, s.y, s.rot, s.lr, s.k) : null,
                 lines: simPlace(b, cells).lines });
    }
    for (const dx of [-1, 1])
      if (simFits(b, type, s.x + dx, s.y, s.rot)) push({ x: s.x + dx, y: s.y, rot: s.rot, lr: false, k: -1, acts: s.acts + (dx < 0 ? 'L' : 'R') });
    if (type === 'O') continue;
    for (const dir of ccw ? [1, -1] : [1]){
      const to = (s.rot + dir + 4) & 3;
      const table = (type === 'I' ? KICKS.I : KICKS.JLSTZ)[s.rot + '>' + to];
      for (let i = 0; i < table.length; i++){
        const [kx, ky] = table[i];
        if (simFits(b, type, s.x + kx, s.y + ky, to)){ push({ x: s.x + kx, y: s.y + ky, rot: to, lr: true, k: i, acts: s.acts + (dir > 0 ? 'C' : 'A') }); break; }
      }
    }
  }
  return out;
}

// ── 随机 T 槽题 ──
// 标准 T 旋双消的槽：最底一行只空槽口那一格，上一行空三格，再上面一侧有屋檐。
// 屋檐朝左朝右、槽在哪一列、两边堆多高、底下垫几行灰线，全随机。
// 生成后用 simReach 验一遍：只用顺时针、能打出 T 旋双消，才算一道题。
function drillGenPuzzle(rand){
  const rnd = rand || Math.random;
  const ri = n => (rnd() * n) | 0;
  for (let t = 0; t < 400; t++){
    const b = Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(false));
    const R = TOTAL_ROWS - 1;
    const g = ri(3);
    for (let i = 0; i < g; i++){
      const hole = ri(COLS);
      for (let x = 0; x < COLS; x++) b[R - i][x] = x !== hole;
    }
    const B = R - g;
    const c = 1 + ri(COLS - 2);
    const s = rnd() < .5 ? 1 : -1;            // 屋檐在哪一侧
    const roof = 1 + ri(2);                   // 屋檐厚度
    for (let x = 0; x < COLS; x++){
      if (x !== c) b[B][x] = true;
      if (Math.abs(x - c) > 1) b[B - 1][x] = true;
    }
    for (let k = 0; k < roof; k++) b[B - 2 - k][c + s] = true;
    for (let x = 0; x < COLS; x++){
      const d = x - c;
      if (Math.abs(d) <= 1) continue;
      const roofSide = Math.sign(d) === s;
      // 紧挨屋檐那一列至少和屋檐一样高，屋檐才是「接着」的
      const extra = roofSide ? (Math.abs(d) === 2 ? roof + ri(2) : ri(4)) : ri(3);
      for (let k = 0; k < extra; k++) b[B - 2 - k][x] = true;
    }
    if (!simReach(b, 'T').some(L => L.spin === 'tspin' && L.lines === 2)) continue;
    let top = 0;
    while (top < TOTAL_ROWS && !b[top].some(Boolean)) top++;
    return { rows: b.slice(top).map(r => r.map(v => v ? '#' : '.').join('')), c, s };
  }
  return null;
}

// ── 多余按键 ──
// 从出生点出发，「点一下左/右、按住到墙、顺时针（键盘再加逆时针）、落底」
// 最少几下能落到同一组格子。用了软降的块不算（那是滑入/旋入，没有可比的最少按法）。
function finesseMin(b, type, cells, ccw){
  const want = cells.map(c => c.join(',')).sort().join(';');
  const start = { x: PIECES[type].spawnX, y: 0, rot: 0 };
  if (!simFits(b, type, start.x, start.y, start.rot)) return null;
  const seen = new Set([start.x + ',' + start.y + ',' + start.rot]);
  let layer = [start];
  for (let d = 0; d < 12 && layer.length; d++){
    const next = [];
    for (const s of layer){
      let y = s.y;
      while (simFits(b, type, s.x, y + 1, s.rot)) y++;
      const k = cellsOf(type, s.rot).map(([cx, cy]) => (s.x + cx) + ',' + (y + cy)).sort().join(';');
      if (k === want) return d + 1;
      const add = (x, yy, rot) => {
        const kk = x + ',' + yy + ',' + rot;
        if (!seen.has(kk)){ seen.add(kk); next.push({ x, y: yy, rot }); }
      };
      for (const dx of [-1, 1]){
        if (!simFits(b, type, s.x + dx, s.y, s.rot)) continue;
        add(s.x + dx, s.y, s.rot);
        let x = s.x + dx;
        while (simFits(b, type, x + dx, s.y, s.rot)) x += dx;
        add(x, s.y, s.rot);
      }
      if (type === 'O') continue;
      for (const dir of ccw ? [1, -1] : [1]){
        const to = (s.rot + dir + 4) & 3;
        const table = (type === 'I' ? KICKS.I : KICKS.JLSTZ)[s.rot + '>' + to];
        for (const [kx, ky] of table)
          if (simFits(b, type, s.x + kx, s.y + ky, to)){ add(s.x + kx, s.y + ky, to); break; }
      }
    }
    layer = next;
  }
  return null;
}

// ── 流程 ──
function drillNew(){
  return { stage: null, done: {}, skipped: {}, ms: 0, clock: false,
           puz: null, wi: 0, tries: 0, first: 0, warmMs: 0,
           keys: 0, pieces: 0, faults: 0, kb: false,
           pk: { keys: 0, soft: false }, spawnB: null, statAt: -1 };
}
function drillPending(){
  if (!drill) return null;
  return DRILL_STAGES.find(s => !drill.done[s] && !drill.skipped[s]) || null;
}

function startDrill(){
  if (CRAZY) return;
  if (!assisted() && game.started && !game.over) saveGame(true);
  closePrSheet();
  nesEnd(); vsEnd();
  practice = false; practiceLevel = null; practiceStep = 0; practiceDone = false;
  demoRunning = false; undoStack.length = 0;
  hintMode = false; hintMove = null; hintBase = null;
  drill = drillNew();
  restart();
  game.noGarbage = true;
  game.piece = null;                 // 开场停在面板上，盘面空着
  syncPractice(); syncHint(); syncDrill();
  openDrSheet();
}

function drillBegin(stage){
  if (!drill) return;
  drill.stage = stage;
  drill.ms = 0; drill.clock = false;
  hintMode = stage === 'stack';
  hintKind = 'stack';
  hintMove = null; hintBase = null;
  hintStats = { same: 0, good: 0, total: 0, holes: 0, rules: [0, 0, 0, 0] };
  restart();
  game.noGarbage = true;
  if (stage === 'warm'){
    drill.wi = 0; drill.first = 0; drill.warmMs = 0;
    drillWarmNext();
  } else if (stage === 'sprint'){
    drill.keys = 0; drill.pieces = 0; drill.faults = 0;
    drill.clock = true;
  } else if (stage === 'dig'){
    const R = TOTAL_ROWS;
    let last = -1;
    for (let i = 0; i < DRILL_DIG_ROWS; i++){
      let hole = (Math.random() * COLS) | 0;
      if (hole === last) hole = (hole + 1 + ((Math.random() * (COLS - 1)) | 0)) % COLS;   // 相邻两行缺口不在同一列
      last = hole;
      for (let x = 0; x < COLS; x++) game.board[R - 1 - i][x] = x === hole ? null : GARBAGE;
    }
    game.level = DRILL_DIG_LEVEL;          // 每日练习不升级，停在这一级
    drill.pieces = 0;
    drill.clock = true;
    staticDirty = true; needsDraw = true;
  }
  syncHint(); syncPractice(); syncDrill();
}

function drillWarmNext(){
  drill.puz = drillGenPuzzle();
  drill.tries = 0;
  drill.ms = 0;
  drillWarmLoad();
}
function drillWarmLoad(){
  const rows = drill.puz ? drill.puz.rows : [];
  for (let y = 0; y < TOTAL_ROWS; y++) game.board[y].fill(null);
  rows.forEach((row, i) => {
    const y = TOTAL_ROWS - rows.length + i;
    for (let x = 0; x < COLS; x++) game.board[y][x] = row[x] === '#' ? 'X' : null;
  });
  game.combo = -1; game.b2b = false;
  game.hold = null; game.holdUsed = false;
  // 题目只出 T。队列也全塞 T —— 锁定后到重摆之间那一瞬会先出一块，别露出随机块。
  // 塞 6 个：出生拿走一个还剩 5，fillQueue 就不会往队尾补 bag 里的随机块
  game.queue = new Array(6).fill('T'); game.mods = new Array(6).fill(null);
  clearing = null; game.over = false; softDropping = false;
  game.piece = null; spawnNext();
  drill.clock = true;
  staticDirty = true; previewDirty = true; needsDraw = true;
  syncHud(); syncDrill();
  // 题间停顿的定时器到点时可能正开着菜单：那就等面板关了再走（unfreezeIfIdle）
  if (!topSheet()){ game.frozen = false; resumeLoop(); }
}
// 题与题之间停一下：先冻住，看清这一下的结果再换
function drillPause(ms, fn){
  game.frozen = true;
  drill.clock = false;
  const d = drill;
  setTimeout(() => { if (drill === d) fn(); }, ms);
}

// 堆叠段的成绩。same 字段存的是「放对」（和推荐一样好就算）—— 字段名沿用，历史表和比较逻辑不用改
function drillStackRes(dead){
  return { same: hintStats.good, exact: hintStats.same, total: hintStats.total, holes: hintStats.holes || 0,
           rules: hintStats.rules.slice(), dead };
}
function drillOnSpawn(){
  if (!drill || drill.stage !== 'sprint' || !game.piece) return;
  drill.pk = { keys: 0, soft: false };
  drill.spawnB = simBoard();
}
// 每次按键（屏幕键和键盘都走这里）。只有冲刺段要数
function drillKey(soft, kb){
  if (fin.b && game.piece){ fin.keys++; if (soft) fin.soft = true; if (kb) fin.kb = true; }   // 普通局复盘的「多余按键」也在这里数
  if (!drill || drill.stage !== 'sprint' || !game.piece) return;
  drill.keys++; drill.pk.keys++;
  if (soft) drill.pk.soft = true;
  if (kb) drill.kb = true;
}

function drillOnLock(p, n, spin){
  if (!drill || !drill.stage) return;
  if (drill.stage === 'warm'){
    if (spin === 'tspin' && n === 2){
      if (!drill.tries) drill.first++;
      drill.warmMs += drill.ms;
      drill.wi++;
      showToast(drill.tries ? '✓ 做到了（第 ' + (drill.tries + 1) + ' 次）' : '✓ 一次过', 1100);
      if (drill.wi >= DRILL_WARM_N)
        drillPause(1000, () => drillFinish('warm', { first: drill.first, n: DRILL_WARM_N, ms: Math.round(drill.warmMs) }));
      else drillPause(900, drillWarmNext);
    } else {
      drill.tries++;
      showToast('这一下是' + clearName(n, spin, false) + '，要的是 T 旋双消 —— 同一题再来'
                + (drill.tries >= 2 ? '。T 竖着送到槽口没屋檐那边，落到底再按变换转进去' : ''),
                drill.tries >= 2 ? 3600 : 1800);
      drillPause(drill.tries >= 2 ? 1600 : 900, drillWarmLoad);
    }
    syncDrill();
    return;
  }
  if (drill.stage === 'stack'){
    if (game.pieces >= DRILL_STACK_N)
      drillPause(600, () => drillFinish('stack', drillStackRes(false)));
    syncDrill();
    return;
  }
  if (drill.stage === 'dig'){
    drill.pieces++;
    if (drillDigLeft() === 0){
      const ms = Math.round(drill.ms);
      drillPause(700, () => drillFinish('dig', { done: true, ms, lines: DRILL_DIG_ROWS, pieces: drill.pieces }));
    }
    syncDrill();
    return;
  }
  // 冲刺
  drill.pieces++;
  if (!drill.pk.soft && drill.spawnB){
    const cells = cellsOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy]);
    const m = finesseMin(drill.spawnB, p.type, cells, drill.kb);
    if (m !== null && drill.pk.keys > m) drill.faults++;
  }
  if (game.lines >= DRILL_SPRINT_LINES){
    const ms = Math.round(drill.ms);
    drillPause(700, () => drillFinish('sprint', {
      done: true, ms, lines: game.lines, pieces: drill.pieces, keys: drill.keys, faults: drill.faults }));
  }
  syncDrill();
}

// 顶出局：不进结算页，算这一段的结果（热身就是这题没做到，重摆）
function drillTopOut(){
  if (!drill || !drill.stage) return false;
  game.piece = null;
  if (drill.stage === 'warm'){ drill.tries++; drillPause(900, drillWarmLoad); return true; }
  if (drill.stage === 'stack'){
    drillPause(600, () => drillFinish('stack', drillStackRes(true)));
    return true;
  }
  if (drill.stage === 'dig'){
    const left = drillDigLeft();
    drillPause(600, () => drillFinish('dig', { done: false, ms: Math.round(drill.ms), lines: DRILL_DIG_ROWS - left, pieces: drill.pieces }));
    return true;
  }
  drillPause(600, () => drillFinish('sprint', {
    done: false, ms: Math.round(drill.ms), lines: game.lines, pieces: drill.pieces, keys: drill.keys, faults: drill.faults }));
  return true;
}

function drillFinish(stage, res){
  if (!drill) return;
  drill.done[stage] = res;
  drill.stage = null; drill.clock = false;
  hintMode = false; hintMove = null; hintBase = null;
  drillSave(stage, res);
  sfx('level', 1.1);
  syncHint(); syncDrill();
  openDrSheet();
}

// 跳过 / 重来 / 结束
function drillSkip(){
  const s = drillPending();
  if (!drill || !s) return;
  drill.skipped[s] = true;
  renderDrSheet();
}
function drillRedo(){
  if (!drill) return;
  const s = drill.stage || drillPending();
  if (s){ closeDrSheet(true); drillBegin(s); }
}
function drillEnd(){
  drill = null;
  const sh = $('drSheet');
  if (sh) sh.hidden = true;
  syncDrill();
}
function drillExit(){
  drillEnd();
  game.frozen = false;
  exitPractice();
}

// ── 显示 ──
function fmtMs(ms){
  const t = Math.max(0, ms) / 1000, m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}
function drillResText(stage, r){
  if (!r) return '';
  if (stage === 'warm') return (r.first | 0) + '/' + (r.n | 0) + ' 一次过 · 每题 ' + (r.ms / 1000 / Math.max(1, r.n | 0)).toFixed(1) + ' 秒';
  if (stage === 'stack') return '放对 ' + Math.round(100 * r.same / Math.max(1, r.total)) + '% · 洞 ' + (r.holes | 0)
                                + drillWorstRule(r)
                                + (r.dead ? ' · 中途堆满' : '');
  if (stage === 'dig') return r.done ? fmtMs(r.ms) + ' 挖光 · 用了 ' + (r.pieces | 0) + ' 块'
                                     : '被顶死了（挖掉 ' + (r.lines | 0) + '/' + DRILL_DIG_ROWS + ' 行）';
  if (!r.done) return '没打完（' + (r.lines | 0) + ' 行）';
  return fmtMs(r.ms) + ' · PPS ' + (r.pieces / (r.ms / 1000)).toFixed(2)
         + ' · 每块 ' + (r.keys / Math.max(1, r.pieces)).toFixed(1) + ' 键 · 多余 ' + (r.faults | 0);
}
// 最常犯的那条规则（没有记录或一次没犯就不说）
function drillWorstRule(r){
  if (!r || !Array.isArray(r.rules)) return '';
  const m = Math.max(...r.rules.map(v => v | 0));
  if (!m) return '';
  const i = r.rules.findIndex(v => (v | 0) === m);
  return HINT_RULES[i] ? ' · 最常犯 ' + HINT_RULES[i].n + HINT_RULES[i].t : '';
}
// 和上次（今天之前最近一次）比
function drillDelta(stage, r){
  const p = drillPrev(stage);
  if (!p || !r) return '';
  const q = p.r, md = p.day.slice(5).replace('-', '/');
  if (stage === 'sprint' || stage === 'dig'){
    if (!r.done || !q.done) return '';
    const d = (q.ms - r.ms) / 1000;
    return d >= 0 ? '比 ' + md + ' 快 ' + d.toFixed(1) + ' 秒' : '比 ' + md + ' 慢 ' + (-d).toFixed(1) + ' 秒';
  }
  if (stage === 'stack'){
    const d = Math.round(100 * r.same / Math.max(1, r.total)) - Math.round(100 * q.same / Math.max(1, q.total));
    return '放对比 ' + md + (d >= 0 ? ' +' : ' ') + d + '%';
  }
  const d = (r.first | 0) - (q.first | 0);
  return d ? '一次过比 ' + md + (d > 0 ? ' 多 ' : ' 少 ') + Math.abs(d) + ' 道' : '一次过和 ' + md + ' 一样';
}
function renderDrSheet(){
  const body = $('drBody');
  if (!body || !drill) return;
  const nx = drillPending();
  let h = '';
  for (const s of DRILL_STAGES){
    const r = drill.done[s];
    const cls = r ? 'done' : drill.skipped[s] ? 'skip' : s === nx ? 'now' : '';
    const delta = r ? drillDelta(s, r) : '';
    h += '<div class="dr-st ' + cls + '"><b>' + DRILL_NAME[s] + (r ? '　✓' : drill.skipped[s] ? '　跳过' : '') + '</b>'
       + '<span>' + (r ? drillResText(s, r) : DRILL_DESC[s]) + '</span>'
       + (delta ? '<em>' + delta + '</em>' : '') + '</div>';
  }
  // 最近 7 天：每天每项取最好
  const all = drillReadAll();
  const days = Object.keys(all.days).filter(k => DAY_RE.test(k)).sort().slice(-7).reverse();
  if (days.length){
    h += '<span class="sheet-lb">最近 ' + days.length + ' 天（每天取最好的一次）</span>'
       + '<table class="dr-hist"><tr><th>日期</th><th>T 槽</th><th>堆叠</th><th>挖灰线</th><th>40 行</th><th>PPS</th><th>多余</th></tr>';
    for (const k of days){
      const d = all.days[k] || {};
      const w = d.warm, st = d.stack, sp = d.sprint, dg = d.dig;
      h += '<tr><td>' + k.slice(5).replace('-', '/') + '</td>'
         + '<td>' + (w ? (w.first | 0) + '/' + (w.n | 0) : '—') + '</td>'
         + '<td>' + (st ? Math.round(100 * st.same / Math.max(1, st.total)) + '%' : '—') + '</td>'
         + '<td>' + (dg && dg.done ? fmtMs(dg.ms) : '—') + '</td>'
         + '<td>' + (sp && sp.done ? fmtMs(sp.ms) : '—') + '</td>'
         + '<td>' + (sp && sp.done ? (sp.pieces / (sp.ms / 1000)).toFixed(2) : '—') + '</td>'
         + '<td>' + (sp && sp.done ? (sp.faults | 0) : '—') + '</td></tr>';
    }
    h += '</table>';
  }
  body.innerHTML = h;
  const go = $('drGo');
  // 按钮字少：.pbtn 是等宽字 + 字距，「开始 ① T 槽热身」会被撑得稀稀拉拉
  if (go) go.textContent = drill.stage ? '接着练' : nx ? '开始' + DRILL_SHORT[nx] : '练完了 · 回普通局';
  const sk = $('drSkip');
  if (sk) sk.disabled = !!drill.stage || !nx;
}
function openDrSheet(){
  const sh = $('drSheet');
  if (!drill || !sh) return;
  renderDrSheet();
  sh.hidden = false;
  game.frozen = true;
}
// begin = true：马上要开下一段，不用恢复循环
function closeDrSheet(begin){
  const sh = $('drSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  if (begin) return;
  if (drill && drill.stage){ game.frozen = false; resumeLoop(); }
}
function drillGo(){
  if (!drill) return;
  if (drill.stage){ closeDrSheet(); return; }
  const nx = drillPending();
  if (!nx){ drillExit(); return; }
  closeDrSheet(true);
  drillBegin(nx);
}

function syncDrill(){
  document.body.classList.toggle('drilling', !!drill);
  syncModeSwitch();
  if (!drill) return;
  const lb = $('drLabel'), st = $('drStat');
  let a = '', b = '';
  if (drill.stage === 'warm'){
    // 细栏在 SE 上只有一百来像素给文字，只写最要紧的
    a = '热身 ' + Math.min(drill.wi + 1, DRILL_WARM_N) + '/' + DRILL_WARM_N + '　T 旋双消';
    b = fmtMs(drill.ms);
  } else if (drill.stage === 'stack'){
    // 堆叠段推荐是藏着的：细栏只说这块该找哪几种台阶
    a = hintMove ? pieceHintText(hintMove.type) : DRILL_NAME.stack;
    b = Math.min(game.pieces, DRILL_STACK_N) + '/' + DRILL_STACK_N;     // 窄屏上「对 N · 」会把台阶提示挤成省略号
  } else if (drill.stage === 'dig'){
    a = '挖灰线　还剩 ' + drillDigLeft() + ' 行';
    b = fmtMs(drill.ms);
  } else if (drill.stage === 'sprint'){
    a = '冲刺 ' + Math.min(game.lines, DRILL_SPRINT_LINES) + '/' + DRILL_SPRINT_LINES + ' 行';
    b = fmtMs(drill.ms);
  } else {
    const nx = drillPending();
    a = nx ? '下一段　' + DRILL_NAME[nx] : '今天练完了';
  }
  if (lb) lb.innerHTML = stepsHTML(a);
  if (st) st.textContent = b;
}
// 计时：只在这一段真正在打的时候走（面板开着、暂停、题间停顿都不算）
function drillStep(dt){
  if (!drill || !drill.clock || !drill.stage) return;
  drill.ms += dt;
  const tenth = (drill.ms / 100) | 0;
  if (tenth !== drill.statAt){ drill.statAt = tenth; const st = $('drStat'); if (st && drill.stage !== 'stack') st.textContent = fmtMs(drill.ms); }
}

// ───────────────────────── 经典 NES 模式 ─────────────────────────
//
// 1989 年任天堂红白机版，经典俄罗斯方块世界锦标赛（CTWC）用的就是它。和上面那套
// 现代规则是两回事，所以单独一套盘面、单独一套逐帧计时，只借画布和按键：
//   · 没有暂存、没有落点影子，只看 1 个 NEXT（原版也没有硬降，这里保留了落底，见下面「按键」）
//   · 旋转用 NES 原版的朝向表（NRS）：绕中心转，**没有踢墙**，转不过去就是转不过去
//   · 落地没有锁定延迟：重力那一下落不下去就锁死
//   · 速度按帧算（NTSC 60.0988 帧/秒），横移是 DAS 16 帧起步、之后每 6 帧一格
//   · 出块：先掷 0~7，掷到 7 或者和上一块相同就重掷一次 0~6（重掷结果照收）
//   · 计分：单/双/三/四 = 40/100/300/1200 ×（等级 + 1），软降每格 1 分
//   · 起始等级 0~19；第一次升级在 min(起始×10+10, max(100, 起始×10−50)) 行，之后每 10 行
// 按键：左右照旧，「变换」= A（顺时针），软降 = 下（键盘 Z = B 逆时针）。
// 「落底」照旧是落底 —— 原版没有硬降，这是唯一和原版不一样的地方（用户要的）。
// 分按「一路软降到底」给，每格 1 分，和原版玩家按住下键能拿到的一样，只是省了等它掉的时间。
const NES_FPS = 60.0988;
const NES_FRAME = 1000 / NES_FPS;
const NES_ROWS = 20;
// 每下落一格要几帧（NTSC），29 级起 1 帧一格（「杀屏」）
const NES_GRAVITY = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3,
                     2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
function nesGravity(l){ return l < NES_GRAVITY.length ? NES_GRAVITY[l] : 1; }
const NES_DAS = 16, NES_ARR = 6;
const NES_SOFT = 2;                 // 软降：每 2 帧一格
const NES_CLEAR_FRAMES = 18;        // 消行动画（原版 17~20 帧，跟帧计数的相位有关，取中间）
const NES_LINE_SCORE = [0, 40, 100, 300, 1200];
const NES_SPAWN_X = 5, NES_SPAWN_Y = 0;
// 朝向表：[dy, dx]，相对中心格。每种块按顺时针顺序排，spawn 是出生时用哪一个。
// 抄的是 NES ROM 里的 orientationTable；T/J/L 四个朝向彼此是纯 90° 旋转（test_nes 验这一点），
// S/Z/I 只有两个朝向，来回切。
const NES_PIECES = {
  T: { spawn: 2, s: [[[-1, 0], [0, -1], [0, 0], [0, 1]],  [[-1, 0], [0, 0], [0, 1], [1, 0]],
                     [[0, -1], [0, 0], [0, 1], [1, 0]],   [[-1, 0], [0, -1], [0, 0], [1, 0]]] },
  J: { spawn: 3, s: [[[-1, 0], [0, 0], [1, -1], [1, 0]],  [[-1, -1], [0, -1], [0, 0], [0, 1]],
                     [[-1, 0], [-1, 1], [0, 0], [1, 0]],  [[0, -1], [0, 0], [0, 1], [1, 1]]] },
  Z: { spawn: 0, s: [[[0, -1], [0, 0], [1, 0], [1, 1]],   [[-1, 1], [0, 0], [0, 1], [1, 0]]] },
  O: { spawn: 0, s: [[[0, -1], [0, 0], [1, -1], [1, 0]]] },
  S: { spawn: 0, s: [[[0, 0], [0, 1], [1, -1], [1, 0]],   [[-1, 0], [0, 0], [0, 1], [1, 1]]] },
  L: { spawn: 1, s: [[[-1, 0], [0, 0], [1, 0], [1, 1]],   [[0, -1], [0, 0], [0, 1], [1, -1]],
                     [[-1, -1], [-1, 0], [0, 0], [1, 0]], [[-1, 1], [0, -1], [0, 0], [0, 1]]] },
  I: { spawn: 1, s: [[[-2, 0], [-1, 0], [0, 0], [1, 0]],  [[0, -2], [0, -1], [0, 0], [0, 1]]] },
};
const NES_ORDER = ['T', 'J', 'Z', 'O', 'S', 'L', 'I'];   // ROM 里的出块编号顺序
// 大致的水平参照（起始 18 级，也就是比赛的起点）。社区里常说的分数段，不是官方标准
const NES_TIERS = [
  [999999, '满分（maxout）'], [800000, '顶尖'], [500000, '很强'],
  [300000, '强'], [100000, '熟练'], [0, '入门'],
];
const NES_KEY = nsKey('nes.v1');

let nes = null;

function nesCells(t, r, x, y){ return NES_PIECES[t].s[r].map(([dy, dx]) => [x + dx, y + dy]); }
function nesFits(t, r, x, y){
  for (const [cx, cy] of nesCells(t, r, x, y)){
    if (cx < 0 || cx >= COLS || cy >= NES_ROWS) return false;
    if (cy >= 0 && nes.board[cy][cx]) return false;    // 顶上越界的格不算撞（竖 I 能转出屏幕上沿）
  }
  return true;
}
// 第一次升级在哪一行
function nesFirstLevelUp(s){ return Math.min(s * 10 + 10, Math.max(100, s * 10 - 50)); }
// 锁定高度决定下一块等多久（ARE）：最底两行 10 帧，往上每 4 行 +2，最多 18
function nesAre(lockY){
  const fromBottom = NES_ROWS - 1 - Math.max(0, Math.min(NES_ROWS - 1, lockY));
  return fromBottom < 2 ? 10 : 10 + 2 * Math.min(4, Math.floor((fromBottom - 2) / 4) + 1);
}
// 出块：掷 0~7，7 或者和上一块相同就重掷 0~6，重掷结果照收（所以还是会连出，约 1/28）
function nesRoll(){
  const prev = nes.prevId;
  let id = (nes.rnd() * 8) | 0;
  if (id === 7 || id === prev) id = (nes.rnd() * 7) | 0;
  nes.prevId = id;
  return NES_ORDER[id];
}
function nesRng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

function nesNew(start, seed){
  const o = {
    start, level: start, lines: 0, score: 0, nextUp: nesFirstLevelUp(start),
    board: Array.from({ length: NES_ROWS }, () => new Array(COLS).fill(null)),
    cur: null, next: null, prevId: 7,
    phase: 'are', timer: 0, fall: 0, acc: 0,
    hl: false, hr: false, dasDir: 0, dasN: 0, downN: 0, soft: 0,
    clearRows: [], pieces: 0, tetrisLines: 0, burns: 0,
    drought: 0, droughtMax: 0, trans: null, over: false, frames: 0,
    rnd: nesRng(seed != null ? seed : (Date.now() ^ (Math.random() * 1e9))),
    dirty: true, hud: '',
  };
  return o;
}

function nesSpawn(){
  const t = nes.next || nesRoll();
  nes.next = nesRoll();
  const r = NES_PIECES[t].spawn;
  nes.cur = { t, r, x: NES_SPAWN_X, y: NES_SPAWN_Y };
  nes.fall = 0; nes.downN = 0; nes.soft = 0;
  nes.phase = 'fall';
  if (t === 'I') nes.drought = 0;
  else if (++nes.drought > nes.droughtMax) nes.droughtMax = nes.drought;
  previewDirty = true; needsDraw = true;
  if (!nesFits(t, r, nes.cur.x, nes.cur.y)) nesOver();
}

function nesShift(d){
  const c = nes.cur;
  if (!c || nes.phase !== 'fall') return false;
  if (!nesFits(c.t, c.r, c.x + d, c.y)) return false;
  c.x += d; needsDraw = true; drawNow = true;
  return true;
}
// 落底：一按到底立刻锁定。落了几格就按软降算几分
function nesHardDrop(){
  const c = nes && nes.cur;
  if (!c || nes.phase !== 'fall' || game.paused) return;
  let d = 0;
  while (nesFits(c.t, c.r, c.x, c.y + d + 1)) d++;
  c.y += d;
  nes.soft += d;
  drawNow = true;
  sfx('drop'); buzz(14);
  nesLock();
}
function nesRotate(dir){
  const c = nes && nes.cur;
  if (!c || nes.phase !== 'fall' || game.paused) return;
  const n = NES_PIECES[c.t].s.length;
  if (n === 1) return;
  const r = (c.r + dir + n) % n;
  if (!nesFits(c.t, r, c.x, c.y)) return;          // 没有踢墙
  c.r = r; needsDraw = true; drawNow = true;
  sfx('rotate');
}
// 按下：立刻挪一格，DAS 从 0 数。挪不动（贴墙）就直接算蓄满，松手前一直贴着
function nesPress(dir){
  if (!nes || game.paused) return;
  if (dir === 'left') nes.hl = true; else nes.hr = true;
  const d = dir === 'left' ? -1 : 1;
  nes.dasDir = d;
  nes.dasN = nesShift(d) ? 0 : NES_DAS;
}
function nesRelease(dir){
  if (!nes) return;
  if (dir === 'left') nes.hl = false; else nes.hr = false;
  const d = nes.hl ? -1 : nes.hr ? 1 : 0;
  if (d !== nes.dasDir){ nes.dasDir = d; nes.dasN = 0; }
}

function nesLock(){
  const c = nes.cur;
  for (const [x, y] of nesCells(c.t, c.r, c.x, c.y)) if (y >= 0) nes.board[y][x] = c.t;
  nes.pieces++;
  nes.score += nes.soft;            // 软降分在锁定时结算
  nes.soft = 0;
  const lockY = c.y;
  nes.cur = null;
  nes.dirty = true; needsDraw = true;
  const rows = [];
  for (let y = 0; y < NES_ROWS; y++) if (nes.board[y].every(Boolean)) rows.push(y);
  sfx(rows.length === 4 ? 'tetris' : rows.length ? 'clear' : 'lock');
  if (rows.length){
    const n = rows.length;
    nes.score += NES_LINE_SCORE[n] * (nes.level + 1);    // 按消行前的等级算
    nes.lines += n;
    if (n === 4) nes.tetrisLines += 4; else nes.burns += n;
    while (nes.lines >= nes.nextUp){
      nes.level++; nes.nextUp += 10;
      if (nes.trans === null) nes.trans = nes.score;     // 第一次升级那一刻的分 = 「过渡分」
      sfx('level');
    }
    if (n === 4) buzz([30, 40, 70]); else buzz(18 + n * 8);
    nes.clearRows = rows;
    nes.phase = 'clear'; nes.timer = NES_CLEAR_FRAMES;
    nes.areNext = nesAre(lockY);
  } else {
    nes.phase = 'are'; nes.timer = nesAre(lockY);
  }
  nesHud();
}

function nesFrame(){
  nes.frames++;
  if (nes.phase === 'clear'){
    if (--nes.timer > 0){ needsDraw = true; return; }
    const keep = nes.board.filter((_, y) => !nes.clearRows.includes(y));
    while (keep.length < NES_ROWS) keep.unshift(new Array(COLS).fill(null));
    nes.board = keep; nes.clearRows = [];
    nes.dirty = true; needsDraw = true;
    nes.phase = 'are'; nes.timer = nes.areNext;
    return;
  }
  if (nes.phase === 'are'){
    if (--nes.timer <= 0) nesSpawn();
    return;
  }
  if (nes.phase !== 'fall' || !nes.cur) return;
  // 横移：按住时每帧 +1，到 16 挪一格并退回 10（于是之后每 6 帧一格）；挪不动就停在 16
  if (nes.dasDir){
    if (++nes.dasN >= NES_DAS) nes.dasN = nesShift(nes.dasDir) ? NES_DAS - NES_ARR : NES_DAS;
  }
  const c = nes.cur;
  // 软降（左右没按的时候才生效，和原版一样）：每 2 帧一格，软降那一下也会把重力计数清零
  if (softDropping && !nes.dasDir){
    if (++nes.downN >= NES_SOFT){
      nes.downN = 0; nes.fall = 0;
      if (nesFits(c.t, c.r, c.x, c.y + 1)){ c.y++; nes.soft++; needsDraw = true; }
      else { nesLock(); return; }
    }
  } else { nes.downN = 0; nes.soft = 0; }
  if (++nes.fall >= nesGravity(nes.level)){
    nes.fall = 0;
    if (nesFits(c.t, c.r, c.x, c.y + 1)){ c.y++; needsDraw = true; }
    else nesLock();                 // 没有锁定延迟
  }
}

// 主循环接这里。逻辑严格按帧走，dt 先攒着，攒够一帧跑一帧
function nesStep(dt){
  if (!nes || nes.over) return 'stop';
  nes.acc += dt;
  let n = 0;
  while (nes.acc >= NES_FRAME){
    nes.acc -= NES_FRAME;
    nesFrame();
    if (nes.over) return 'stop';
    if (++n >= 15){ nes.acc = 0; break; }        // 卡了很久回来，别一口气补几百帧
  }
  return 'normal';
}

function nesHud(){
  if (!nes) return;
  setStat($('score'), fmtScore(nes.score));
  setStat($('lines'), String(nes.lines));
  setStat($('level'), String(nes.level));
  const b = nesRecords().best[nes.start];
  setStat($('best'), fmtScore(b ? b.score : 0));
}

// ── 画 ──
function nesDrawStatic(){
  const W = CELL * COLS, H = CELL * ROWS;
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.save();
  bgCtx.strokeStyle = 'rgba(120,160,255,.06)';
  bgCtx.lineWidth = 1;
  bgCtx.beginPath();
  for (let x = 1; x < COLS; x++){ bgCtx.moveTo(x * CELL + .5, 0); bgCtx.lineTo(x * CELL + .5, H); }
  for (let y = 1; y < ROWS; y++){ bgCtx.moveTo(0, y * CELL + .5); bgCtx.lineTo(W, y * CELL + .5); }
  bgCtx.stroke();
  bgCtx.restore();
  for (let y = 0; y < NES_ROWS; y++)
    for (let x = 0; x < COLS; x++){
      const t = nes.board[y][x];
      if (t) drawCell(bgCtx, x * CELL, y * CELL, CELL, colorOf(t));
    }
  nes.dirty = false;
}
function nesDraw(){
  const W = CELL * COLS, H = CELL * ROWS;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  if (nes.dirty || staticDirty){ nesDrawStatic(); staticDirty = false; }
  ctx.drawImage(bgCv, 0, 0, W, H);
  if (nes.phase === 'clear'){
    // 原版是从中间往两边一格一格擦掉；这里按剩余帧数从中间往外盖黑
    const k = 1 - nes.timer / NES_CLEAR_FRAMES, half = Math.ceil(k * COLS / 2);
    ctx.fillStyle = 'rgba(6, 10, 20, .92)';
    for (const y of nes.clearRows) ctx.fillRect((COLS / 2 - half) * CELL, y * CELL, half * 2 * CELL, CELL);
  }
  const c = nes.cur;
  if (c && nes.phase === 'fall')
    for (const [x, y] of nesCells(c.t, c.r, c.x, c.y))
      if (y >= 0) drawCell(ctx, x * CELL, y * CELL, CELL, colorOf(c.t));
}
function nesDrawPreview(){
  const nw = nextCv._w || nextCv.clientWidth, nh = nextCv._h || nextCv.clientHeight;
  nextCtx.clearRect(0, 0, nw, nh);
  const hw = holdCv._w || holdCv.clientWidth, hh = holdCv._h || holdCv.clientHeight;
  holdCtx.clearRect(0, 0, hw, hh);
  if (!nes.next || !nw) return;
  // NEXT 按 NES 的出生朝向画（和你下一块真正出来的样子一致）
  const cells = NES_PIECES[nes.next].s[NES_PIECES[nes.next].spawn];
  const xs = cells.map(v => v[1]), ys = cells.map(v => v[0]);
  const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
  const cell = Math.min(nw / (bw + 1.1), nh / (bh + 1.0));
  const px = (nw - bw * cell) / 2, py = (nh - bh * cell) / 2;
  for (const [dy, dx] of cells)
    drawCell(nextCtx, px + (dx - Math.min(...xs)) * cell, py + (dy - Math.min(...ys)) * cell, cell, colorOf(nes.next));
  dbg.previews = 1;
}

// ── 记录 ── 按起始等级各存最好的一局 + 最近 20 局
function nesRecords(){
  try {
    const d = JSON.parse(localStorage.getItem(NES_KEY) || 'null');
    if (d && typeof d === 'object' && d.best && Array.isArray(d.runs)) return d;
  } catch { /* 坏数据当没有 */ }
  return { best: {}, runs: [] };
}
function nesTier(score){ return (NES_TIERS.find(([s]) => score >= s) || NES_TIERS[NES_TIERS.length - 1])[1]; }

function nesOver(){
  nes.over = true; nes.cur = null; nes.phase = 'over';
  game.over = true;                    // 让主循环停下；不走 endGame，普通局的记录一个字都不碰
  const run = { day: bjDay(), start: nes.start, score: nes.score, lines: nes.lines, level: nes.level,
                tr: nes.lines ? Math.round(100 * nes.tetrisLines / nes.lines) : 0,
                drought: nes.droughtMax, trans: nes.trans, pieces: nes.pieces };
  const d = nesRecords();
  const prev = d.best[nes.start];
  const isBest = !prev || run.score > prev.score;
  if (isBest) d.best[nes.start] = run;
  d.runs.push(run);
  d.runs = d.runs.slice(-20);
  try { localStorage.setItem(NES_KEY, JSON.stringify(d)); } catch { /* 存不了就算了 */ }
  sfx('over');
  needsDraw = true;
  setTimeout(() => { if (nes && nes.over) openNesSheet(run, isBest); }, 700);
}

// ── 进出 ──
function startNes(level, seed){
  if (CRAZY) return;
  const lv = Math.max(0, Math.min(19, level | 0));
  if (!assisted() && game.started && !game.over) saveGame(true);
  mid = null;                        // NES 不走 restart，中途开局的状态得自己清
  closePrSheet(); closeHintSheet(); drillEnd(); vsEnd();
  const sh = $('nesSheet'); if (sh) sh.hidden = true;
  practice = false; practiceLevel = null; hintMode = false; hintMove = null; demoRunning = false;
  nes = nesNew(lv, seed);
  // 普通局的引擎停在「没有当前块」的状态，主循环整个让给 nesStep
  game.started = true; game.over = false; game.paused = false; game.frozen = false;
  game.piece = null; clearing = null; softDropping = false;
  held.left = held.right = false;
  $('overlay').classList.remove('show');
  document.body.classList.add('nesing');
  syncPractice(); syncHint();
  staticDirty = true; previewDirty = true; needsDraw = true;
  nes.timer = 1;                    // 下一帧出第一块
  nesHud();
  lastFrame = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  sfx('hold');
}
function nesEnd(){
  if (!nes) return;
  nes = null;
  syncModeTag();
  document.body.classList.remove('nesing');
  const sh = $('nesSheet'); if (sh) sh.hidden = true;
  staticDirty = true; previewDirty = true; needsDraw = true;
}

// ── 面板：选起始等级 / 结算 ──
let nesPick = 18;
function openNesSheet(run, isBest){
  const sh = $('nesSheet');
  if (!sh) return;
  const d = nesRecords();
  // 第一次玩（哪一级都没成绩）默认选 9 级 —— 说明里也是这么建议的，原来默认 18
  if (!run && !Object.values(d.best).some(Boolean) && nesPick === 18) nesPick = 9;
  const res = $('nesResult');
  if (res){
    if (run){
      const vs18 = run.start >= 18;
      res.hidden = false;
      res.innerHTML = '<b class="nes-score">' + groupInt(run.score) + '</b>'
        + (isBest ? '<em class="nes-best">起始 ' + run.start + ' 级的新纪录</em>' : '')
        + '<div class="nes-stats">'
        + '<span>消行<b>' + run.lines + '</b></span><span>到达<b>' + run.level + ' 级</b></span>'
        + '<span>四消率<b>' + run.tr + '%</b></span><span>最长没 I<b>' + run.drought + ' 块</b></span>'
        + (run.trans !== null ? '<span>过渡分<b>' + groupInt(run.trans) + '</b></span>' : '')
        + '</div>'
        + '<p class="nes-tier">' + (vs18 ? '水平参照：<b>' + escHtml(nesTier(run.score)) + '</b>（社区常说的分数段，起始 18 级）'
                                          : '要和比赛成绩比，用起始 18 级打') + '</p>';
    } else { res.hidden = true; res.innerHTML = ''; }
  }
  const lv = $('nesLevels');
  if (lv){
    let h = '';
    for (let i = 0; i < 20; i++){
      const b = d.best[i];
      h += '<button type="button" data-nl="' + i + '" class="' + (i === nesPick ? 'on' : '') + '"><b>' + i + '</b><span>'
         + (b ? fmtScore(b.score | 0) : '—') + '</span></button>';
    }
    lv.innerHTML = h;
  }
  const go = $('nesGo');
  if (go) go.textContent = (run ? '再来一局 · ' : '开始 · ') + '起始 ' + nesPick + ' 级';
  sh.hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeNesSheet(){
  const sh = $('nesSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  unfreezeIfIdle();
}

// ───────────────────────── 对战机器人 ─────────────────────────
//
// 你用的还是上面那套现代规则（暂存、5 个 NEXT、T 旋、B2B），只是灰线不再按时间涨，
// 改成对手消行打过来。机器人在右栏小窗里自己打，十个级别只差三样：
//   每秒放几块（PPS）、往后看几块（只看当前 / 当前 + NEXT）、多大概率放偏
// 落点用的是提示模式那套打分（高手堆叠经验），所以它是「照规矩堆、留井打四消」的打法。
//
// 攻击表（Guideline 系，和 Tetris 99 / TETR.IO 同一路）：
//   单 0  双 1  三 2  四 4；T 旋单 2  双 4  三 6；mini 单 0  双 1
//   B2B +1；连击按表加；全消 +10
// 打过去的先抵消自己身上待涨的（抵消），剩下的才给对方。收到的不马上涨：等你下一次
// 「锁定却没消行」时才顶上来，一次最多 8 行；同一波的缺口在同一列（一个 I 就能打穿）。
// 定级是机器人互打量出来的（vsSimMatch，相邻两级各 30~40 局）：高一级赢低一级
//   2:1 70%  3:2 65%  4:3 90%  5:4 80%  6:5 77%  7:6 67%  8:7 87%  9:8 67%  10:9 80%
// 跨级更明显：3:1 85%，5:1 和 10:5 全胜。test_vs 里锁着「每一级都赢下一级」
const VS_LEVELS = [
  { pps: 0.3,  look: 1, err: .45 }, { pps: 0.45, look: 1, err: .25 }, { pps: 0.65, look: 1, err: .18 },
  { pps: 0.8,  look: 2, err: .12 }, { pps: 1.0, look: 2, err: .08 }, { pps: 1.25, look: 2, err: .05 },
  { pps: 1.5,  look: 2, err: .03 }, { pps: 1.8, look: 2, err: .02 }, { pps: 2.2,  look: 2, err: .01 },
  { pps: 2.7,  look: 2, err: 0 },
];
const VS_COMBO = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
const VS_RISE_MAX = 8;
const VS_KEY = nsKey('vs.v1');
const VS_START_DELAY = 900;          // 开局机器人先停一下，给你看清盘面

let vs = null;

// 一次消行能打几行
function vsAttack(n, spin, perfect, combo, b2b){
  if (!n) return 0;
  // 表外（压实之类凑出的 5 行以上）按最大那档算。别写成 `表[n] || 默认`：mini 单是 0，会被当成「没有」
  const k = Math.min(n, 4);
  let a = spin === 'tspin' ? [0, 2, 4, 6, 6][k] : spin === 'mini' ? [0, 0, 1, 1, 1][k] : [0, 0, 1, 2, 4][k];
  if (b2b) a += 1;
  if (combo > 0) a += VS_COMBO[Math.min(combo, VS_COMBO.length - 1)];
  if (perfect) a += 10;
  return a;
}
// 打出去：先抵消自己待涨的，剩下的进对方的队列
function vsSend(amount, mine, theirs){
  let a = amount;
  while (a > 0 && mine.length){
    const k = Math.min(a, mine[0].n);
    mine[0].n -= k; a -= k;
    if (!mine[0].n) mine.shift();
  }
  if (a > 0) theirs.push({ n: a, hole: (vs.rnd() * COLS) | 0 });
  return amount - a;                 // 抵消掉的行数
}
function vsPending(q){ return q.reduce((s, g) => s + g.n, 0); }

function vsBotNew(lv){
  return { lv, b: Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(null)),
           bag: [], cur: null, next: null, timer: -VS_START_DELAY, inc: [], combo: -1, b2b: false,
           sent: 0, pieces: 0, lines: 0, dead: false, dirty: true };
}
function vsBotType(B){
  if (!B.bag.length){
    const t = TYPES.slice();
    for (let i = t.length - 1; i > 0; i--){ const j = (vs.rnd() * (i + 1)) | 0; [t[i], t[j]] = [t[j], t[i]]; }
    B.bag = t;
  }
  return B.bag.shift();
}
// 机器人放一块：挑落点 → 放下 → 消行就打过去，没消就把待涨的顶上来
function vsBotMove(B, conf, foe, foeQueue){
  if (!B.cur){ B.cur = vsBotType(B); B.next = vsBotType(B); }
  const bb = B.b.map(r => r.map(Boolean));
  const t = B.cur;
  if (!simFits(bb, t, PIECES[t].spawnX, 0, 0)){ B.dead = true; return; }
  const r = hintBest(bb, t, conf.look > 1 ? B.next : null);
  if (!r){ B.dead = true; return; }
  let m = r.best;
  if (conf.err){
    // 失误分两种。原来只有一种（前几名里随便挑，常常是留洞的那个），结果低级别全是自杀：
    // 放得越快、失误越多、死得越快，Lv2 对 Lv1 只赢 42%。现在：
    //   小失误（概率 err）：只在「不留洞」的次优落点里挑 —— 像新手，放得不够好但不送
    //   大失误（概率 err/4）：前六名里随便挑，可能留洞
    const s = r.all.slice().sort((a, c) => c.score - a.score);
    const u = vs.rnd();
    if (u < conf.err / 4) m = s[Math.min(s.length - 1, 1 + ((vs.rnd() * 5) | 0))];
    else if (u < conf.err){
      const ok = s.slice(1).filter(c => c.gaps === 0).slice(0, 3);
      if (ok.length) m = ok[(vs.rnd() * ok.length) | 0];
    }
  }
  for (const [x, y] of m.cells) if (y >= 0) B.b[y][x] = t;
  const full = [];
  for (let y = 0; y < TOTAL_ROWS; y++) if (B.b[y].every(Boolean)) full.push(y);
  if (full.length){
    B.b = B.b.filter((_, y) => !full.includes(y));
    while (B.b.length < TOTAL_ROWS) B.b.unshift(new Array(COLS).fill(null));
    const perfect = B.b.every(row => row.every(c => !c));
    const hard = full.length === 4;
    const b2b = hard && B.b2b;
    B.b2b = hard; B.combo++;
    B.lines += full.length;
    const a = vsAttack(full.length, null, perfect, B.combo, b2b);
    if (a){ vsSend(a, B.inc, foeQueue); B.sent += a; }
  } else {
    B.combo = -1;
    vsBotRise(B);
  }
  // 锁在隐藏区之上 = 顶出局
  if (m.cells.every(([, y]) => y < BUFFER)) B.dead = true;
  B.pieces++;
  B.cur = B.next; B.next = vsBotType(B);
  B.dirty = true;
}
function vsBotRise(B){
  let n = 0;
  while (B.inc.length && n < VS_RISE_MAX){
    const g = B.inc[0];
    if (B.b[0].some(Boolean)){ B.dead = true; return; }
    B.b.shift();
    const row = new Array(COLS).fill(GARBAGE); row[g.hole] = null;
    B.b.push(row);
    n++;
    if (!--g.n) B.inc.shift();
  }
}

// 主循环每一小步都喂进来
function vsStep(dt){
  if (!vs || vs.over) return;
  vs.ms += dt;
  const B = vs.bot, conf = VS_LEVELS[B.lv - 1];
  B.timer += dt;
  const gap = 1000 / conf.pps;
  let n = 0;
  while (B.timer >= gap && n++ < 3){
    B.timer -= gap;
    vsBotMove(B, conf, null, vs.inP);
    if (vsPending(vs.inP) !== vs.shownIn){ vs.shownIn = vsPending(vs.inP); needsDraw = true; }
    if (B.dead){ vsFinish(true); return; }
  }
  if (B.dirty) vsDrawBot();
}

// 你锁定一块之后（lockPiece 里，消行判定之后、出下一块之前）
function vsOnLock(n, spin, perfect){
  if (!vs || vs.over) return;
  vs.pieces++;
  if (n > 0){
    const a = vsAttack(n, spin, perfect, game.combo, lastClearB2B);
    if (a){
      vsSend(a, vs.inP, vs.bot.inc);
      vs.sent += a;
      vs.bot.dirty = true;
      if (a >= 4) showToast('打出 ' + a + ' 行', 900);
    }
  } else if (vs.inP.length){
    let k = 0;
    while (vs.inP.length && k < VS_RISE_MAX){
      const g = vs.inP[0];
      if (game.board[0].some(Boolean)){ endGame('灰线顶出'); return; }
      game.board.shift();
      const row = new Array(COLS).fill(GARBAGE); row[g.hole] = null;
      game.board.push(row);
      k++; vs.recv++;
      if (!--g.n) vs.inP.shift();
    }
    staticDirty = true; needsDraw = true;
    sfx('lock'); buzz(20);
  }
  vs.shownIn = vsPending(vs.inP);
}

// 你被顶死（endGame 里拦下来）
function vsTopOut(){
  if (!vs) return false;
  if (!vs.over) vsFinish(false);
  return true;
}
function vsFinish(win){
  vs.over = true; vs.win = win;
  game.over = true; game.piece = null;
  const rec = vsRecords();
  const r = rec[vs.bot.lv] || (rec[vs.bot.lv] = { w: 0, l: 0 });
  if (win) r.w++; else r.l++;
  try { localStorage.setItem(VS_KEY, JSON.stringify(rec)); } catch { /* 存不了就算了 */ }
  sfx(win ? 'level' : 'over', win ? 1.2 : 1);
  buzz(win ? [40, 30, 60] : 60);
  needsDraw = true;
  vsDrawBot();
  setTimeout(() => { if (vs && vs.over) openVsSheet(true); }, 700);
}
function vsRecords(){
  try {
    const d = JSON.parse(localStorage.getItem(VS_KEY) || 'null');
    if (d && typeof d === 'object') return d;
  } catch { /* 坏数据当没有 */ }
  return {};
}

// ── 画：右栏小窗 ── 只在它的盘面变了才重画，一次 200 来个 fillRect
function vsDrawBot(){
  const cv = $('vsCv');
  if (!vs || !cv) return;
  const B = vs.bot;
  B.dirty = false;
  const c = cv.getContext('2d');
  const w = cv._w || cv.clientWidth, h = cv._h || cv.clientHeight;
  if (!w || !h) return;
  const s = Math.floor(Math.min(w / COLS, h / ROWS) * 4) / 4;
  const ox = (w - s * COLS) / 2, oy = h - s * ROWS;
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(8, 12, 24, .9)';
  c.fillRect(ox, oy, s * COLS, s * ROWS);
  for (let y = BUFFER; y < TOTAL_ROWS; y++)
    for (let x = 0; x < COLS; x++){
      const t = B.b[y][x];
      if (!t) continue;
      c.fillStyle = t === GARBAGE ? '#6b7a96' : colorOf(t);
      c.fillRect(ox + x * s + .5, oy + (y - BUFFER) * s + .5, s - 1, s - 1);
    }
  // 它身上待涨的：左边一条红
  const p = Math.min(ROWS, vsPending(B.inc));
  if (p){ c.fillStyle = '#ff5470'; c.fillRect(ox, oy + (ROWS - p) * s, Math.max(2, s * .3), p * s); }
  if (vs.over){
    c.fillStyle = 'rgba(6, 9, 17, .6)'; c.fillRect(ox, oy, s * COLS, s * ROWS);
  }
  const lb = $('vsInfo');
  if (lb) lb.textContent = '你打 ' + vs.sent + '\n它打 ' + B.sent;
}
// 你身上待涨的：主盘面左边一条红（draw 里调）
function vsDrawIncoming(c){
  if (!vs) return;
  const p = Math.min(ROWS, vsPending(vs.inP));
  if (!p) return;
  c.save();
  c.fillStyle = '#ff5470';
  c.globalAlpha = .9;
  c.fillRect(0, (ROWS - p) * CELL, Math.max(3, CELL * .14), p * CELL);
  c.restore();
}

// ── 进出 ──
function startVs(lv, seed){
  if (CRAZY) return;
  const L = Math.max(1, Math.min(VS_LEVELS.length, lv | 0));
  if (!assisted() && game.started && !game.over) saveGame(true);
  mid = null;
  closePrSheet(); closeHintSheet(); drillEnd(); nesEnd();
  const sh = $('vsSheet'); if (sh) sh.hidden = true;
  practice = false; practiceLevel = null; hintMode = false; hintMove = null; demoRunning = false;
  vs = { bot: null, inP: [], sent: 0, recv: 0, pieces: 0, ms: 0, over: false, win: null, shownIn: 0,
         rnd: nesRng(seed != null ? seed : (Date.now() ^ (Math.random() * 1e9))) };
  vs.bot = vsBotNew(L);
  document.body.classList.add('vsing');
  restart();
  game.noGarbage = true;
  const lb = $('vsName'); if (lb) lb.textContent = 'Lv ' + L;
  syncPractice(); syncHint();
  layout();                          // 右栏换成了小窗，量一次尺寸
  vsDrawBot();
}
function vsEnd(){
  if (!vs) return;
  vs = null;
  syncModeTag();
  document.body.classList.remove('vsing');
  const sh = $('vsSheet'); if (sh) sh.hidden = true;
  needsDraw = true;
}

// ── 面板：选级别 / 结算 ──
let vsPick = 3;
function openVsSheet(result){
  const sh = $('vsSheet');
  if (!sh) return;
  const rec = vsRecords();
  const res = $('vsResult');
  if (res){
    if (result && vs){
      const sec = vs.ms / 1000, B = vs.bot;
      res.hidden = false;
      res.innerHTML = '<b class="vs-head ' + (vs.win ? 'win' : 'lose') + '">' + (vs.win ? '你赢了' : '输了') + '</b>'
        + '<div class="nes-stats">'
        + '<span>你打出<b>' + vs.sent + ' 行</b></span><span>它打出<b>' + B.sent + ' 行</b></span>'
        + '<span>你每分钟打<b>' + (vs.sent / Math.max(1, sec) * 60).toFixed(1) + '</b></span>'
        + '<span>你每秒放<b>' + (vs.pieces / Math.max(1, sec)).toFixed(2) + ' 块</b></span>'
        + '<span>用时<b>' + fmtMs(vs.ms) + '</b></span></div>';
      vsPick = B.lv;
    } else { res.hidden = true; res.innerHTML = ''; }
  }
  const lv = $('vsLevels');
  if (lv){
    let h = '';
    VS_LEVELS.forEach((c, i) => {
      const r = rec[i + 1];
      h += '<button type="button" data-vl="' + (i + 1) + '" class="' + (i + 1 === vsPick ? 'on' : '') + '"><b>Lv ' + (i + 1) + '</b>'
         + '<span>' + c.pps + ' 块/秒</span><span>' + (r ? (r.w | 0) + ' 胜 ' + (r.l | 0) + ' 负' : '没打过') + '</span></button>';
    });
    lv.innerHTML = h;
  }
  const go = $('vsGo');
  if (go) go.textContent = (result ? '再来一局 · ' : '开打 · ') + 'Lv ' + vsPick;
  sh.hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeVsSheet(){
  const sh = $('vsSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  unfreezeIfIdle();
}

// 两个机器人对打（测试和定级用，不画、不碰主盘面）。返回 A 赢没赢
function vsSimMatch(lvA, lvB, seed, maxMs){
  const keep = vs;
  vs = { rnd: nesRng(seed), inP: [], bot: null };
  const A = vsBotNew(lvA), Bb = vsBotNew(lvB);
  A.timer = Bb.timer = 0;
  const ca = VS_LEVELS[lvA - 1], cb = VS_LEVELS[lvB - 1];
  let t = 0, ta = 0, tb = 0, win = null;
  const lim = maxMs || 240000;
  while (t < lim){
    const na = ta + 1000 / ca.pps, nb = tb + 1000 / cb.pps;
    if (na <= nb){ t = ta = na; vsBotMove(A, ca, Bb, Bb.inc); }
    else { t = tb = nb; vsBotMove(Bb, cb, A, A.inc); }
    if (A.dead){ win = false; break; }
    if (Bb.dead){ win = true; break; }
  }
  const out = { win, ms: t, sentA: A.sent, sentB: Bb.sent, piecesA: A.pieces, piecesB: Bb.pieces };
  vs = keep;
  return out;
}

// ───────────────────────── 锁定与消行 ─────────────────────────

// T-spin：T 块、最后一步是旋转、中心四角至少三个被挡
function detectTSpin(){
  const p = game.piece;
  if (!p || p.type !== 'T' || !game.lastWasRot) return null;
  return tspinKind((x, y) => x < 0 || x >= COLS || y >= TOTAL_ROWS || (y >= 0 && !!game.board[y][x]),
                   p.x, p.y, p.rot, game.lastRotKick);
}
// 三角判定本体。corner(x, y) 说这一格挡不挡；每日练习的出题验证拿模拟盘面也走这里
function tspinKind(corner, x, y, rot, kick){
  const cx = x + 1, cy = y + 1;
  // 四个角，前两个是 T 朝向那一侧的「正面角」
  const front = [[[-1,-1],[1,-1]], [[1,-1],[1,1]], [[1,1],[-1,1]], [[-1,1],[-1,-1]]][rot & 3];
  const back  = [[[-1,1],[1,1]],  [[-1,-1],[-1,1]], [[-1,-1],[1,-1]], [[1,-1],[1,1]]][rot & 3];
  const f = front.filter(([dx,dy]) => corner(cx+dx, cy+dy)).length;
  const b = back .filter(([dx,dy]) => corner(cx+dx, cy+dy)).length;
  if (f + b < 3) return null;
  // 正面两角都被挡 = 实打实的 T-spin；否则算 mini（踢墙踢到底那次除外）
  if (f === 2 || kick === 4) return 'tspin';
  return 'mini';
}

function lockPiece(){
  const p = game.piece;
  if (!p) return;
  snapForUndo();
  game.pieces++;
  crazyOnLock(p);
  const spin = detectTSpin();

  // 这一下造了几个洞。countHoles 是 220 格扫描，只在锁定时跑两次 ——
  // 一局八十几次，不进每帧循环。
  const review = !CRAZY && !assisted() && !!game.run;    // 普通局的局后复盘要记洞和堆高
  const holesBefore = CRAZY || review ? countHoles() : 0;
  const stalled = lockResets;

  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy, bx = p.x + cx;
    if (by >= 0 && by < TOTAL_ROWS) game.board[by][bx] = p.type;
  }
  if (review){
    if (fin.b && !fin.soft){          // 用了软降的块不算（滑入 / 旋入没有可比的最少按法）
      const m = finesseMin(fin.b, p.type, cellsOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy]), fin.kb || kbUsed);
      if (m !== null){ game.run.finN++; if (fin.keys > m){ game.run.faults++; game.run.extra += fin.keys - m; } }
    }
    // 洞按提示模式的口径算：T 槽屋檐底下那一格是留给 T 的，不算洞（原来照教练搭槽，复盘反说你洞多）
    const made = fin.b ? hintAdjHoles(simBoard()) - hintAdjHoles(fin.b) : countHoles() - holesBefore;
    fin.b = null;
    if (made > 0) game.run.holes += made;
    const top = topFilledRow();
    if (top >= 0 && TOTAL_ROWS - top >= REVIEW_HIGH) game.run.highLocks++;
  }
  if (CRAZY){
    const made = countHoles() - holesBefore;
    // 自嘲比装作没看见舒服。这条休闲档很常见，本来就该有人说一句。
    if (made >= 4) tip('……没事', 5000);
    else if (stalled >= 10) tip('你在那磨蹭什么', 6000);
  }
  if (!hardLocking) burstLand(p);
  // 变异效果要在「已经盖进盘面」之后、「找满行」之前跑，
  // 炸出来的空档才能算进这一次的消行判定。
  // 它们会把 staticDirty 置上，下面的 stampToStatic 自然会空转。
  crazyApplyMod(p);
  stampToStatic(p);        // 只补这一块，不整盘重画
  game.piece = null;
  needsDraw = true;

  // 找满行
  // 凑满的行分两路：带冰的只解冻不消（要消两次才掉），其余正常清。
  const full = [], thaw = [];
  for (let y = 0; y < TOTAL_ROWS; y++){
    if (!game.board[y].every(c => c)) continue;
    // 沉在底部的 ZONE 行天生就是「满」的，不能当满行消掉 —— 它们要等 ZONE 结束一起结算
    if (CRAZY && game.board[y].every(c => c === ZONE)) continue;
    if (CRAZY && game.board[y].some(c => c === FROZEN)) thaw.push(y); else full.push(y);
  }
  if (thaw.length) crazyThaw(thaw);
  // 消行时不压 —— 那时有消行动画顶着，两个特效叠一起反而糊
  if (!full.length && !thaw.length) startSquash(p);

  // 消完这几行之后整个盘就空了 = 全消，Guideline 里给大额奖励
  const perfect = full.length > 0 &&
    game.board.every((row, y) => full.includes(y) || row.every(c => !c));
  lastClearRows = full.slice();      // 必须在 scoreFor 之前，飘字要靠它定位
  lastLockY = p.y + 1;               // 空转 T-spin 没有消除行，飘字落在 T 的中心
  scoreFor(full.length, spin, perfect);
  coachOnLock(p, full.length, spin);
  practiceCheck(full.length, spin, perfect);
  drillOnLock(p, full.length, spin);
  if (tsOn()) tsOnLock(p, full.length, spin);
  else if (hintMode) hintJudge(p, full.length, spin);
  if (vs) vsOnLock(full.length, spin, perfect);
  crazyOnClear(full.length, spin, perfect);

  if (full.length){
    // 同理：先响，再去铺几十颗粒子和改 DOM
    // 连击 0~5 逐级升半音（2^(1/12) ≈ 1.0595）
    const pitch = Math.pow(1.0595, Math.min(6, Math.max(0, game.combo)));
    sfx(spin ? 'tspin' : (full.length === 4 ? 'tetris' : 'clear'), pitch);
    if (CRAZY) buzz(full.length >= 4 ? [30, 40, 70] : 18 + full.length * 8);   // 标准版的震动在 hitFx 里按力度给
    if (full.length === 4 || perfect) musicDuck(170);
    clearing = { rows: full, t: 0, dur: 260 };
    if (CRAZY) for (const y of full) burstRow(y);
    else {
      // 碎块：每格 1~3 颗，力度越大飞得越快。总数照样受粒子上限管着
      const per = lastHit >= 5 ? 3 : lastHit >= 2 ? 2 : 1;
      for (const y of full) burstRow(y, per, 1 + lastHit * .12);
      clearing.color = hitColor(full.length, spin, Math.max(0, game.combo));
      clearing.power = lastHit;
    }
    if (CRAZY) addEmbers(full, full.length === 4 ? '#ffd166' : '#7fe3ff');
    flashBoard(full.length);
  } else {
    // 硬降自己已经响过 drop 了，再补一声 lock 会叠成一团糊音
    if (!hardLocking) sfx('lock');
    // 锁在隐藏区之上 = 顶出局
    const topOut = cellsOf(p.type, p.rot).every(([, cy]) => p.y + cy < BUFFER);
    if (topOut){ endGame('锁在隐藏区'); return; }
    armPre = true; spawnNext(); saveGame();
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
// 疯狂版不封顶：20 级 ×8、30 级 ×10.6、50 级 ×15.3。涨得很慢但永远在涨，
// 「活得久」本身就该是回报 —— 配合不封顶的分数，这是长局的主要奖励通道。
function levelMult(lvl){
  const L = CRAZY ? Math.max(1, lvl) : clamp(lvl, 1, MAX_LEVEL);
  return 1 + 7 * Math.pow((L - 1) / (MAX_LEVEL - 1), .75);
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
  if (n > 4) return { name: `${n} LINES`, cls: 't4', scale: 1.7 };
  return [null,
          { name: 'SINGLE', cls: 't1', scale: 1.00 },
          { name: 'DOUBLE', cls: 't2', scale: 1.15 },
          { name: 'TRIPLE', cls: 't3', scale: 1.30 },
          { name: 'TETRIS', cls: 't4', scale: 1.60 }][n] || null;
}

// 把这一局讲出来。只挑「真的发生过」的条目 —— 一堆 0 比什么都不写更难看。
// 称号牌：右侧栏两格（最强 / 段位）+ 开始页一块 + 称号面板。都从存档现算，不存状态。
// 称号名往格子里填。不走 setStat —— 那套 --fit 是按数字串的字符数标定的，
// 汉字宽得多，「传奇王者」四个字在 402 宽下正好顶到 64px 格子的两条边，
// 不裁但也没留白。四字给一档轻缩收出呼吸感，两三字维持原大小。
function setRank(el, name){
  if (!el) return;
  el.textContent = name;
  el.style.setProperty('--fit', name.length >= 4 ? .86 : name.length === 3 ? .94 : 1);
}

function syncRank(){
  if (!CRAZY) return;
  const best = Math.max(game.best, readBest());
  const r = rankOf(best), c = careerOf(readTotal());
  const box = $('rankBox');
  if (box){
    box.hidden = false;
    setRank($('rankName'), r ? r[1] : '—');
  }
  const cbox = $('careerBox');
  if (cbox){
    cbox.hidden = false;
    setRank($('careerName'), c ? c[1] : '—');
  }
  const chip = $('rankChip');
  if (chip){
    chip.hidden = false;
    $('rankNow').textContent = r ? r[1] : '未入段';
    $('careerNow').textContent = c ? c[1] : '';
  }
  const hl = $('helpLink');
  if (hl) hl.hidden = false;
  const hb = $('helpBtn');
  if (hb) hb.hidden = false;
  const d = readDaily(), tl = $('todayLine');
  if (tl){
    tl.hidden = false;
    $('dailyBest').textContent = d.best > 0 ? fmtScore(d.best) : '—';
  }
}

// 面板里的一条梯子。从高往低排，拿到的亮着，没拿到的灰着并写出门槛 ——
// 要让人看见下一格还差多少。
// 门槛都是整数，用 fmtScore 会显示成「80.00万」，小数位全是零。单写一个。
function fmtNeed(v){
  if (v >= 100000000) return (v / 100000000) + '亿';
  if (v >= 10000) return (v / 10000) + '万';
  return groupInt(v);
}

function fillLadder(el, table, val){
  if (!el) return;
  el.innerHTML = table.slice().reverse().map(([need, name]) => {
    const got = val >= need;
    return `<span class="rk${got ? ' got' : ''}"><i>${name}</i><b>${fmtNeed(need)}</b></span>`;
  }).join('');
}

// ── 玩法说明 ──
// 每个数字都从常量现算。写死的话迟早对不上 —— 这次改动里光注释就过期过两次
// （宝箱「一局 4~5 个」、金块「它本来就多」）。
function fmtRate(r){ return '1/' + Math.round(1 / r); }

function helpSections(){
  const evOn = EVENTS.filter(e => e.ms > 0), evNow = EVENTS.filter(e => !e.ms);
  const wTot = EVENTS.reduce((a, e) => a + e.w, 0);
  const rate = Object.fromEntries(MOD_RATES);
  const evLine = (e) => ({
    dot: e.bad ? '▲' : '●',
    name: e.name,
    meta: (e.ms ? (e.ms / 1000) + ' 秒' : '瞬发') + '　' + Math.round(e.w / wTot * 100) + '%',
    text: MOD_HELP.ev[e.key],
  });
  return [
    ['变异块　约 ' + (Object.values(rate).reduce((a, b) => a + b, 0) * 100).toFixed(1) + '% 的方块',
      ['gold', 'hammer', 'fill', 'fork', 'dye', 'bomb', 'laser'].map(k => ({
        mod: k, name: MOD_HELP.name[k], meta: fmtRate(rate[k]), text: MOD_HELP.mod[k] }))],
    ['事件　开局 ' + (EV_FIRST / 1000) + ' 秒第一次，最密 ' + (EV_MIN / 1000) + ' 秒一次，提前 ' + (EV_WARN / 1000) + ' 秒预告',
      evOn.concat(evNow).map(evLine).concat([{ dot: '◈', name: '堆到高处时', meta: '',
        text: EVENTS.filter(e => EV_DEADLY.has(e.key)).map(e => e.name).join(' / ')
              + ' 不再出现，'
              + EVENTS.filter(e => !e.bad).map(e => e.name).join(' / ') + ' 概率翻倍 —— 但 '
              + EVENTS.filter(e => e.bad && !EV_DEADLY.has(e.key)).map(e => e.name).join(' / ')
              + ' 照旧' }])],
    ['热度　消行注入，停手 ' + (HEAT_TAU / 1000) + ' 秒掉到三分之一，最低 ' + HEAT_FLOOR, [
      // 这两行原来是手写死的，heatGain 整体 ×1.5、拐点 48→90 之后就全错了
      // （写着「一行 2」实际给 3，写着「热度 100 → ×7」实际 ×9.1）。改成现算。
      { dot: '◈', name: '注入', meta: '',
        text: ['一行', '两行', '三行', '四行'].map((s, i) => s + ' ' + heatGain(i + 1, null, false)).join(' · ')
              + ' · T-spin ' + heatGain(1, 'mini', false) + '~' + heatGain(3, 'tspin', false)
              + ' · 全消 ' + heatGain(0, null, true) },
      { dot: '◈', name: '倍率', meta: '不封顶',
        text: [24, 48, HEAT_KNEE, 400, 1500]
              .map(h => '热度 ' + h + ' → ×' + trimZeros(heatMultAt(h).toFixed(1))).join('　') },
      { dot: '◈', name: '险区', meta: '×' + DANGER_HEAT, text: '堆顶进危险区时消行，热度注入翻倍' },
      { dot: '◈', name: '压哨', meta: '+' + SNIPE_HEAT,
        text: '灰线刚顶上来 ' + (SNIPE_MS / 1000) + ' 秒内消掉，额外补 ' + SNIPE_HEAT + ' 点' },
      { dot: '✦', name: '燃点', meta: '×' + BURN_MULT,
        text: Math.round(BURN_WIN / 1000) + ' 秒内热度涨超 ' + Math.round(BURN_RISE * 100) + '%'
              + ' 就点着 ' + Math.round(BURN_MS / 1000) + ' 秒，这期间得分 ×' + BURN_MULT
              + '。看的是**涨得快**不是**够高** —— 攒着不动点不着，要连续猛攻。'
              + '狂欢局更容易点（涨 ' + Math.round(BURN_RISE_RUSH * 100) + '% 就够）'
              + '、烧得更久（' + Math.round(BURN_MS_RUSH / 1000) + ' 秒）' },
      { dot: '✦', name: '热流', meta: '×' + FLOW_MULT,
        text: '每次消行有概率把该次注入翻 ' + FLOW_MULT + ' 倍，行数越少概率越高 —— 单行 '
              + Math.round(FLOW_P[1] * 100) + '%、两行 ' + Math.round(FLOW_P[2] * 100)
              + '%、三行 ' + Math.round(FLOW_P[3] * 100) + '%、四行 ' + Math.round(FLOW_P[4] * 100) + '%' },
      // 两边的曲线形状不一样，所以分开讲，而且交叉点必须现算 —— 它是
      // DEEP_BASE / DEEP_BASE_RUSH / 两个步长 / RUSH_MULT 五个数的交点，
      // 写死任何一个数字，改一次常量就会过期。
      { dot: '◈', name: '深局加成', meta: DEEP_FROM + ' 行起',
        text: '普通局过 ' + DEEP_FROM + ' 行后每行 ×' + DEEP_BASE + '，之后每 ' + DEEP_PER + ' 行再 +'
              + DEEP_STEP + '（' + DEEP_EG[0] + ' 行 ×' + deepAt(DEEP_EG[0], false).toFixed(1)
              + '，' + DEEP_EG[1] + ' 行 ×' + deepAt(DEEP_EG[1], false).toFixed(1) + '），越打越值。'
              + '狂欢局从 ×' + deepAt(DEEP_FROM, true).toFixed(1) + ' 起，每 ' + DEEP_PER
              + ' 行再 +' + DEEP_STEP_RUSH + '（' + DEEP_EG[0] + ' 行 ×'
              + deepAt(DEEP_EG[0], true).toFixed(1) + '，' + DEEP_EG[1] + ' 行 ×'
              + deepAt(DEEP_EG[1], true).toFixed(1) + '）—— 涨得比普通局慢，'
              + '但分数倍率和道具翻倍补回来。前中段比普通局高，'
              + (deepCrossLines() ? deepCrossLines() + ' 行之后，普通局每行的价值就追上来了'
                                  : '而且一直高下去') },
    ]],
    ['宝箱与梭哈', [
      { dot: '▣', name: '宝箱', meta: Math.round(CHEST_RATE * 100) + '%',
        text: '每条灰线有这么大概率带宝箱，消掉那一行才算开。'
              + Math.round(CHEST_P[0] * 100) + '% FEVER / '
              + Math.round((CHEST_P[1] - CHEST_P[0]) * 100) + '% 热度 +' + CHEST_HEAT + ' / '
              + Math.round((1 - CHEST_P[1]) * 100) + '% 下一块是炸弹' },
      { dot: '✦', name: 'FEVER', meta: (FEVER_MS / 1000) + ' 秒 ×' + FEVER_MULT,
        text: '消行累加保底，中了这段时间得分 ×' + FEVER_MULT + '，且热度不衰减。'
              + '结束后冷静 ' + (FEVER_COOL / 1000) + ' 秒，这期间保底和宝箱都开不出它 —— '
              + '否则它八成时间都在，就不是爆发而是底薪了' },
      { dot: '⚄', name: '梭哈', meta: BET_MS / 1000 + ' 秒',
        text: '消 ' + BET_OFFER_NEED + ' 行以上或打出 T-spin 就弹出（热度只要不是几乎为零）。'
              + '接了之后这十秒里累计消行，窗口结束按档结算：'
              + BET_TIERS.map(([n, m]) => n + '行 ×' + m).join(' · ')
              + '。赢了按「行数 × 档位 × 你当时的倍率」直接给分数，'
              + '不足 ' + BET_NEED + ' 行则热度减半 —— 押的是热度，赢的是分数。'
              + '消满 ' + BET_CAP + ' 行直接封顶。'
              + '结算后冷却 ' + (BET_COOL / 1000) + ' 秒' },
      { dot: '⟳', name: '换牌', meta: REROLL_COST + ' 热度', text: '点 NEXT 框，花热度把当前这块换掉' },
      { dot: '✸', name: '修行', meta: '开局 + 平均每 ' + UP_EVERY + ' 行',
        text: '开局命中 ' + UP_FIRST + ' 张，之后随机触发 —— '
              + '平均每 ' + UP_EVERY + ' 行一次，但具体哪一行来是掷出来的，等不到也攒不出。'
              + '**不用你选**：掷中哪张就是哪张，屏幕上会报名字和效果。'
              + '命中的整局有效、不可更换，一共 ' + UPS.length + ' 张，每张最多中一次。'
              + '其中 ' + UPS.filter(u => u.vow).length + ' 张是血契 —— 有明码标价的代价，'
              + '不是更强的卡，是换一种打法，同时最多挂两张；'
              + '还有一张「如常」是空的，中了它这次什么都不给' },
      { dot: '◉', name: 'ZONE', meta: '攒 ' + ZONE_NEED + ' 行',
        text: '消够 ' + ZONE_NEED + ' 行就**自动开始**，不用你操作。开启 ' + (ZONE_MS / 1000)
              + ' 秒：重力、灰线、事件三个钟全停，你随便摆。但这期间消掉的行不会消失，'
              + '而是沉到盘面底部变成死行 —— 地板一格一格往上涨，最多 ' + ZONE_MAX + ' 行就提前结算。'
              + '结束时死行一次清空，按行数的平方给奖金（' + ZONE_EG.map(k =>
                  k + ' 行约 +' + Math.round(ZONE_UNIT * k * k / ZONE_CURVE)).join(' / ')
              + ' 基数，再乘你当时的倍率）。'
              + '消行本身照常计分，ZONE 给的是额外那一笔 —— 所以问题永远是「还敢不敢再消一行」' },
      { dot: '⏳', name: '缓期', meta: Math.round(DELAY_FRAC * 100) + '% 热度',
        text: '灰线还剩 ' + (DELAY_WIN / 1000) + ' 秒、而堆已经占到盘面一半以上时**自动**花热度，'
              + '把灰线钟往回推 ' + (DELAY_MS / 1000) + ' 秒。价格是当前热度的 '
              + Math.round(DELAY_FRAC * 100) + '% —— 按比例收，所以穷富一个价；'
              + '热度不到 ' + DELAY_GATE + ' 时不提供。'
              + '每行灰线只能缓一次，钟还在走，它是延后不是取消。'
              + '平时一分不动，只有堆高了才会动用。'
              + 'FEVER / ZONE / 缓流 期间不动用 —— 那时灰线钟本来就停着，推它没意义' },
      { dot: '✹', name: '彩虹行', meta: '×' + RAIN_MULT,
        text: '棋盘右框外会有个小三角指着某一行，消到它时那一次得分 ×' + rainMult()
              + '。消掉或 ' + Math.round(RAIN_MS / 1000) + ' 秒没消掉就换一行' },
      { dot: '⇄', name: '挪列', meta: SWAP_COST + ' 热度',
        text: '点盘面选一列、再点相邻那列，两列整个对调。'
              + '它不会减少洞也不会凑出满行 —— 只是把结构挪个位置，'
              + '但那是唯一能动已经落地的盘面的手段' },
    ]],
    ['狂欢局　每局 ' + Math.round(RUSH_RATE * 100) + '% 概率，最多 ' + RUSH_EVERY + ' 局必出一次', [
      { dot: '★', name: '分数', meta: '×' + RUSH_MULT, text: '整局有效，不计时' },
      { dot: '★', name: '道具', meta: '×' + RUSH_MOD,
        text: '金块之外的变异块概率全部翻倍 —— 金块不翻，它只是纯加分' },
      { dot: '▲', name: '灰线', meta: '快 ' + Math.round((1 / RUSH_GARBAGE - 1) * 100) + '%', text: '这是它的代价' },
      { dot: '▲', name: '坏事件', meta: '×' + RUSH_BAD, text: '权重提高，好事件相对更少' },
      { dot: '◈', name: '有效局', meta: RUSH_MIN_PIECES + ' 块 / ' + (RUSH_MIN_MS / 1000) + ' 秒',
        text: '一局要落够方块或打够时间才算数，秒死重开刷不出来。'
              + '骰子在局末掷，重开换不来第二次。今天打得多保底会收紧，最紧 ' + RUSH_FLOOR + ' 局' },
    ]],
  ];
}

// ⚠️ MOD_HELP / EV_HELP 是**模块初始化时就求值**的对象字面量。
// 里面引用到的任何常量，声明都必须排在它们前面，否则踩 TDZ，整个页面起不来
// （表现是「开始按钮点不到」，不容易一眼联想到常量顺序）。
// 本仓库已经栽过两次：FILL_MAX 一次、GOLD_MULT 一次。往里加东西前先确认顺序。
const GOLD_MULT = 3;

const MOD_HELP = {
  name: { gold: '金块', hammer: '重锤', bomb: '炸弹', laser: '激光', fill: '灌注',
          fork: '分流', dye: '染色' },
  mod: {
    gold:   '用它消行时，那一次得分 ×' + GOLD_MULT,
    hammer: '锁定后，它占到的每一列整列向下塌实，洞被挤掉',
    bomb:   '炸掉自身周围一圈，然后受影响的列塌实',
    laser:  '整块汽化，再从落点往下打穿中心那一列 —— 开出来的井正好是打四行的形状',
    fill:   '落点下方那几列，空格全部填成实心 —— 堆高不变但行容易凑满，常当场就消。'
            + '位置你自己挑，是激光和地震留下那些深坑的解药',
    fork:   '锁定之后这块的格子各自垂直落到底，像沙子一样散开。'
            + '重锤是整列塌实、连下面原有的洞一起挤掉，堆会变矮；'
            + '分流只动这块自己的格子，堆高几乎不变，但能顺着起伏铺开 —— '
            + '治的是「盘面高低不平，哪块放上去都架空」',
    dye:    '锁定之后，这块占到的最低那一行变成彩虹行。'
            + '彩虹行本来是随机挑的，有它就轮到你自己指',
  },
  ev: {
    blackout: '方块只画轮廓，看不见填充，音效也变闷',
    mirror:   '左右键对调，连发也跟着换向',
    wind:     '每隔不到一秒，把下落中的方块随机吹偏一格',
    wall:     '随机封死一列当墙，不封出生区',
    slam:     '方块一出生就贴到底。落地后还能左右滑和转，失去的是边落边调整',
    quake:    '整个盘面左右平移一格，推出边界的格子直接消失',
    compact:  '挑洞最多的三列塌实 —— 上面的砖掉下来，堆跟着变矮',
    calm:     '灰线停止上涨。不加分不消洞，就是给你一段时间整理盘面',
    freeze:   '冻住上方某一行。冻住的行凑满时不消，只解冻，要消两次才掉',
    tail:     '这几秒里消行的热度注入翻倍。不改盘面，纯粹是「趁现在多打几下」',
    blind:    '落点虚影消失，只能靠自己数。堆到高处时不会出现',
    glean:    '队列最前面几块直接变成变异块。好处要等你自己把牌打出来才兑现',
  },
};

function fillHelp(){
  const box = $('helpBody');
  if (!box) return;
  box.innerHTML = helpSections().map(([title, rows]) => '<h4>' + title + '</h4>' + rows.map(r =>
    '<div class="helprow">'
    + (r.mod ? '<canvas data-mod="' + r.mod + '" width="52" height="52"></canvas>'
             : '<i class="dot">' + r.dot + '</i>')
    + '<div class="tx"><b>' + r.name + (r.meta ? '<em>' + r.meta + '</em>' : '') + '</b>'
    + '<span>' + (r.text || '') + '</span></div></div>').join('')).join('');
  // 图标用游戏自己的画法渲染，不另画一套 —— 这样它永远跟盘面上看到的一致
  for (const cv of box.querySelectorAll('canvas[data-mod]')){
    const c = cv.getContext('2d'), m = cv.dataset.mod, S = 52;
    c.clearRect(0, 0, S, S);
    drawCell(c, 3, 3, S - 6, mix(colorOf('T'), MOD_TINT[m], .72), {});
    drawModIcon(c, S / 2, S / 2, S * .22, m);
  }
}

function openHelp(){
  fillHelp();
  $('helpSheet').hidden = false;
  if (game.started && !game.over) game.frozen = true;    // 看说明时方块别在后面掉（键盘这时也被面板拦着）
}

function openRankSheet(){
  if (!CRAZY) return;
  const best = Math.max(game.best, readBest()), total = readTotal();
  fillLadder($('rankList'), RANKS, best);
  fillLadder($('careerList'), CAREER, total);
  $('rankFoot').textContent = `最强 ${fmtScore(best)}　累计 ${fmtScore(total)}`;
  $('rankSheet').hidden = false;
  if (game.started && !game.over) game.frozen = true;
}

function fillRunLog(){
  const box = $('runlog');
  if (!box) return;
  const r = game.run;
  if (!CRAZY || !r){ box.hidden = true; return; }
  const secs = game.elapsed / 1000;
  const [title, why] = runTitle(r, secs);
  $('runTitle').textContent = title;
  $('runWhy').textContent = why;

  const rows = [];
  // 每条自己是一个 flex 行（名字靠左、数值靠右），两条并成一排 ——
  // 拆成「名字一格、数值一格」的话长数值会顶出格子，实测「激1」被切掉了
  const add = (k, v, wide) => rows.push(`<span${wide ? ' class="w"' : ''}><i>${k}</i><b>${v}</b></span>`);
  if (r.peak > 1.05) add('峰值倍率', '×' + r.peak.toFixed(1));
  if (r.bestHit > 0) add('最大一击', fmtScore(r.bestHit));
  if (r.dangerMs > 500) add('危险区', (r.dangerMs / 1000).toFixed(0) + ' 秒');
  const mods = [['金', r.gold], ['锤', r.hammer], ['弹', r.bomb], ['激', r.laser],
                ['灌', r.fill], ['流', r.fork], ['染', r.dye]]
    .filter(v => v[1] > 0).map(v => v[0] + v[1]).join(' ');
  if (mods) add('变异块', mods, true);
  if (r.chests) add('宝箱', r.chests + ' 个');
  if (r.tetris) add('四行', r.tetris + ' 次');
  if (r.tspin) add('T-SPIN', r.tspin + ' 次');
  if (r.perfect) add('全消', r.perfect + ' 次');
  if (game.rush) add(RUSH_NAME, '分数 ×' + RUSH_MULT, true);
  if (r.bets) add('梭哈', `${r.betWins}/${r.bets}`);
  if (r.rerolls) add('换牌', r.rerolls + ' 次');
  if (r.delays) add('缓期', r.delays + ' 次');
  if (r.zones) add('ZONE', r.zones + ' 次 / 最多 ' + r.zoneRows + ' 行');
  if (r.ups && r.ups.length) add('修行', r.ups.map(k => UP_BY[k] ? UP_BY[k].n : k).join(' · '));
  // 写成 4:47 而不是「4 分 47 秒」—— 后者在 320px 宽的屏上会被截掉尾巴
  add('这局用了', Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0'));

  $('runStats').innerHTML = rows.join('');
  box.hidden = false;
}

// 屏幕锁住不动：双指缩放、双击放大、手指在空白处拖动都不要。iOS Safari 不认 viewport 的
// user-scalable=no；双击放大由 CSS 的 touch-action: manipulation 关，这里挡另外两种。
// 拖动只放行真能滚的东西（弹层、结算卡这些 overflow:auto 且内容超高的），其它一律 preventDefault
function canScroll(el){
  for (; el && el !== document.body && el.nodeType === 1; el = el.parentElement){
    if (el.scrollHeight > el.clientHeight + 1){
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }
  }
  return false;
}
function lockPage(){
  const stop = e => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1 || !canScroll(e.target)) e.preventDefault();
  }, { passive: false });
}



// ───────────────────────── 中途开局 ─────────────────────────
//
// 普通局前面一两百行是在攒倍率（20 级才封顶 ×8），每局都从头打很磨。中途开局直接从第 150 / 180 / 200 行开始：
// 等级、分数、已用时间、灰线钟都按「你平时打到这里大概是什么样」铺好，盘面垫几行灰线、堆一层方块。
// 分数和用时按你最近从头打完的局估（每行底分 × 一路的等级倍率；每行平均几秒），没记录时按 246 行 24 万、10 分 40 秒那种水平。
// 不进最高分（有一截分是送的）；历史记录里单独标「N 行起」，曲线只画从头打的局。
const MID_TIERS = [150, 180, 200];
const MID_SHAPE = { 150: { h: 7, g: 3 }, 180: { h: 8, g: 3 }, 200: { h: 8, g: 4 } };   // 堆多高、其中几行是灰线
const MID_DEF = { b: 153, tpl: 2600 };   // 没记录时：每行底分 153（246 行 ≈ 24 万）、每行 2.6 秒
let mid = null;          // { L, s, p, e }：这局从第 L 行开起，开局送了 s 分、p 块、e 毫秒
let midPick = 150;
function multSum(L){
  let a = 0;
  for (let i = 0; i < L; i++) a += levelMult(Math.floor(i / LINES_PER_LEVEL) + 1);
  return a;
}
function midRates(){
  const full = histRead().filter(e => !e.mid && !e.aid && e.l >= 60 && e.t > 0).slice(-10);
  if (full.length < 3) return Object.assign({ from: 0 }, MID_DEF);
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  return { b: med(full.map(e => e.s / multSum(e.l))), tpl: med(full.map(e => e.t / e.l)), from: full.length };
}
// 行数固定；分数、已用时间、等级每次开局在平均水平附近随机一点，同一档每局不完全一样
const MID_JIT = { s: .12, e: .15, lv: 2 };
function midPlan(L, roll){
  const r = midRates(), lv = Math.floor(L / LINES_PER_LEVEL) + 1, s = r.b * multSum(L), e = L * r.tpl;
  const u = () => roll ? Math.random() * 2 - 1 : 0;
  const dl = Math.round(u() * MID_JIT.lv);
  return { L, lv: lv + dl, dl, s: Math.round(s * (1 + u() * MID_JIT.s)), e: Math.round(e * (1 + u() * MID_JIT.e)),
           p: Math.round(L * COLS / 4), from: r.from,
           lvLo: lv - MID_JIT.lv, lvHi: lv + MID_JIT.lv, sLo: s * (1 - MID_JIT.s), sHi: s * (1 + MID_JIT.s),
           eLo: e * (1 - MID_JIT.e), eHi: e * (1 + MID_JIT.e) };
}
// 先让堆叠提示的老机器人在空盘上放块，堆到 h - g 行高，再从底下顶上来 g 行灰线（缺口随机、上下两行不同列）——
// 和普通局里灰线涨上来的样子一样。反过来先垫灰线的话，机器人放块时会把灰线补满消掉，盘面上就看不到了
function midBoard(h, g){
  const R = TOTAL_ROWS;
  let tb = newBoard();
  const bag = [];
  const next = () => { if (!bag.length) bag.push(...'IJLOSTZ'.split('').sort(() => Math.random() - .5)); return bag.pop(); };
  let cur = next();
  for (let k = 0; k < 80; k++){
    const b = tb.map(r => r.map(Boolean));
    const top = b.findIndex(r => r.some(Boolean));
    if (top >= 0 && R - top >= h - g) break;
    const nx = next();
    const res = hintBest(b, cur, nx);
    if (!res) break;
    for (const [X, Y] of res.best.cells) if (Y >= 0) tb[Y][X] = cur;
    for (let y = R - 1; y >= 0; y--) if (tb[y].every(c => c)){ tb.splice(y, 1); tb.unshift(new Array(COLS).fill(null)); y++; }
    cur = nx;
  }
  let last = -1;
  for (let i = 0; i < g; i++){
    let hole = (Math.random() * COLS) | 0;
    if (hole === last) hole = (hole + 1 + ((Math.random() * (COLS - 1)) | 0)) % COLS;
    last = hole;
    tb.shift();
    tb.push(Array.from({ length: COLS }, (_, x) => x === hole ? null : GARBAGE));
  }
  return tb;
}
function midPlayed(){
  return !!mid && (game.pieces - mid.p >= RUSH_MIN_PIECES || game.elapsed - mid.e >= RUSH_MIN_MS);
}
function startMid(L){
  if (!MID_TIERS.includes(L)) return;
  closeMidSheet(true);
  if (assisted()) exitPractice();
  restart();
  const P = midPlan(L, true), sh = MID_SHAPE[L];
  game.board = midBoard(sh.h, sh.g);
  game.lines = L; game.level = P.lv; game.score = P.s; game.elapsed = P.e; game.pieces = P.p;
  shownScore = P.s;
  garbageTimer = Math.random() * garbagePeriod() * .6;     // 灰线钟从半路走起，别一开局就涨
  mid = { L, s: P.s, p: P.p, e: P.e, dl: P.dl };
  midPick = L;
  aidOnSpawn();                  // restart 里第一块出生时盘面还是空的，换上铺好的盘面后重拍一次（多余按键 / 标槽）
  staticDirty = true; previewDirty = true; needsDraw = true;
  syncEdge(); syncHud(); syncModeTag();
  saveGame(true);                // 马上存：这之后关掉页面再续玩，也知道是中途开局
}
function renderMidSheet(){
  const box = $('midTiers');
  if (!box) return;
  const r = midRates(), h = histRead();
  box.innerHTML = MID_TIERS.map(L => {
    const P = midPlan(L), done = h.filter(e => e.mid === L);
    const best = done.length ? Math.max(...done.map(e => e.l)) : 0;
    return `<button type="button" class="mid-t${L === midPick ? ' on' : ''}" data-ml="${L}"><b>${L} 行起</b>`
      + `<span>${P.lvLo}~${P.lvHi} 级 · ${escHtml(fmtScore(P.sLo))}~${escHtml(fmtScore(P.sHi))} 分 · 已用 ${mmss(P.eLo)}~${mmss(P.eHi)}</span>`
      + `<em>${done.length ? `打过 ${done.length} 次 · 最远 ${best} 行` : '还没打过'}</em></button>`;
  }).join('');
  const src = $('midSrc');
  if (src) src.textContent = (r.from ? `分数和用时按你最近 ${r.from} 局从头打完的局估` : '你从头打完的局还不到 3 局，先按 246 行 24 万、10 分 40 秒的水平估')
    + '，每次开局在这个范围里随机。';
}
function openMidSheet(){
  renderMidSheet();
  $('midSheet').hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeMidSheet(silent){
  const sh = $('midSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  if (!silent) unfreezeIfIdle();
}
function bindMid(){
  const sh = $('midSheet');
  if (!sh) return;
  sh.addEventListener('click', e => {
    if (e.target === sh) return closeMidSheet();
    const t = e.target.closest('[data-ml]');
    if (t){ midPick = +t.dataset.ml; renderMidSheet(); }
  });
  $('midGo').addEventListener('click', () => startMid(midPick));
  $('midClose').addEventListener('click', () => closeMidSheet());
  const mb = $('midBtn'); if (mb) mb.addEventListener('click', () => openMidSheet());
}


// ───────────────────────── 普通局的两个开关 + 每行均分 ─────────────────────────
//
// 「保命线」：盘面六成高（REVIEW_HIGH 行）画一条淡线 —— 和复盘里「高处放块」同一个标准，堆过线就先消低处。
// 只是参考线，不告诉你块放哪，开着打照样算正经局。
// 「标 T 槽」：只把搭好的 T 旋双消槽用虚线圈出来，不推荐落点。算轻度辅助：开过的局不进最高分，
// 历史记录里标「标槽」、不画进曲线。
const AID_KEY = nsKey('aids.v1');
let aids = { line: false, ts: false };
try { const v = JSON.parse(localStorage.getItem(AID_KEY) || 'null'); if (v){ aids.line = !!v.line; aids.ts = !!v.ts; } } catch { /* 默认都关 */ }
let fin = { b: null, keys: 0, soft: false, kb: false };    // 这一块从出生到锁定按了几下（复盘的「多余按键」）
let aidSlots = [];
let paceB = MID_DEF.b;                                       // 每行底分的平均水平，开局时定一次
function aidsOn(){ return !CRAZY && game.started && !assisted(); }
let shadow = null;          // 后台教练这一块的推荐 { b0, rec }
function aidOnSpawn(){
  fin = { b: aidsOn() && game.run ? simBoard() : null, keys: 0, soft: false, kb: fin.kb };
  shadow = null;
  if (aidsOn() && game.run && game.piece){
    const b0 = fin.b;
    // 后台只看当前这一块、不往后看 NEXT（提示模式才看）：往后看一块要多算三十多倍，WebKit 上出块最慢到 40ms，手机上会掉帧
    const rec = coachRec(b0, game.piece.type, null, game.hold, game.holdUsed);
    if (rec) shadow = { b0, rec, next: game.queue[0] };
  }
  aidSlots = aidsOn() && aids.ts ? tsdSlots(simBoard()).filter(s => s.ready).slice(0, 2) : [];
}
function setAid(k, on){
  aids[k] = on;
  try { localStorage.setItem(AID_KEY, JSON.stringify(aids)); } catch { /* 存不了就这一次 */ }
  if (k === 'ts' && on && game.run && aidsOn() && !game.over) game.run.aidTs = true;
  if (k === 'ts') aidSlots = on && aidsOn() ? tsdSlots(simBoard()).filter(s => s.ready).slice(0, 2) : [];
  syncAidBtns();
  needsDraw = true;
}
function syncAidBtns(){
  const a = $('aidLineBtn'), b = $('aidTsBtn');
  if (a){ a.textContent = '保命线：' + (aids.line ? '开' : '关'); a.classList.toggle('off', !aids.line); }
  if (b){ b.textContent = '标 T 槽：' + (aids.ts ? '开' : '关'); b.classList.toggle('off', !aids.ts); }
}
function drawAids(c){
  if (!aidsOn() || game.over) return;
  if (aids.line){
    const y = (TOTAL_ROWS - REVIEW_HIGH - BUFFER) * CELL;
    c.save();
    c.strokeStyle = 'rgba(255, 209, 102, .38)'; c.lineWidth = Math.max(1, CELL * .05);
    c.setLineDash([CELL * .3, CELL * .22]);
    c.beginPath(); c.moveTo(0, y); c.lineTo(COLS * CELL, y); c.stroke();
    c.restore();
  }
  if (aids.ts) for (const slot of aidSlots){
    const cells = [[slot.x - 1, slot.y], [slot.x, slot.y], [slot.x + 1, slot.y], [slot.x, slot.y + 1]];
    c.save();
    c.strokeStyle = TS_COLOR; c.globalAlpha = .7;
    c.lineWidth = Math.max(2, CELL * .07);
    c.setLineDash([CELL * .18, CELL * .12]);
    for (const [x, y] of cells){
      if (y < BUFFER) continue;
      roundRect(c, x * CELL + 3, (y - BUFFER) * CELL + 3, CELL - 6, CELL - 6, CELL * .16);
      c.stroke();
    }
    c.restore();
  }
}
// 右栏「每行」：这局每行拿了多少分，和你平均水平在同样行数时比 —— 高了绿、低了红。消够 10 行才显示
function syncPace(){
  const box = $('paceBox'), v = $('pace');
  if (!box || !v) return;
  const show = aidsOn();
  box.hidden = !show;
  if (!show) return;
  const L0 = mid ? mid.L : 0, s0 = mid ? mid.s : 0, dl = game.lines - L0;
  if (dl < 10){ v.textContent = '—'; box.classList.remove('up', 'dn'); return; }
  v.textContent = groupInt(Math.round((game.score - s0) / dl));
  let expect = 0;
  for (let i = L0; i < game.lines; i++) expect += levelMult(Math.floor(i / LINES_PER_LEVEL) + 1 + (mid ? mid.dl || 0 : 0));
  const ok = game.score - s0 >= paceB * expect;
  box.classList.toggle('up', ok); box.classList.toggle('dn', !ok);
}


// 后台教练：这一块放下之后跟推荐比。只在普通局（aidsOn）跑，局后复盘报「放对几成 / 最常犯哪条 / 损失最大的 3 手 / T 块去向」
const COACH_WORST = 3;
function coachOnLock(p, n, spin){
  const sh = shadow; shadow = null;
  if (!sh || !aidsOn() || !game.run) return;
  const R = game.run, J = judgeCore(sh.rec, sh.b0, p, n, spin);
  // 后台推荐只看当前块；判成放偏的那一手，再带上 NEXT 比一次（和提示模式同一个口径）：
  // 你的落点带上下一块看不比推荐差、洞也不比它多，就算放对。只对放偏的块多算两次，不拖慢出块
  if (!J.good && sh.rec.kind === 'place' && sh.next){
    const recLa = tsEval(sh.b0, sh.rec.cells, sh.next), mineLa = tsEval(sh.b0, J.cells, sh.next);
    const recHoles = Math.max(0, hintAdjHoles(simPlace(sh.b0, sh.rec.cells).b) - hintAdjHoles(sh.b0));
    if (mineLa >= recLa - HINT_TOL && J.holes <= recHoles){ J.good = true; J.r = -1; J.loss = 0; }
  }
  R.cN++;
  if (J.good) R.cGood++;
  else if (J.r >= 0) R.cRule[J.r]++;
  if (p.type === 'T'){
    R.tN++;
    // 四类互不重叠，加起来 = T 的总数（暂存是另外数的「进过暂存几次」，不是去向）
    if (J.tsd) R.tTsd++;
    else if (sh.rec.kind === 'tsd') R.tMiss++;          // 有槽没打
    else if (sh.rec.kind === 'hold') R.tFlat++;         // 没槽、本可以暂存却放掉了
    else R.tOther = (R.tOther || 0) + 1;                // 没槽也没法暂存（暂存里已经是 T / 这一块刚换出来）
  }
  if (!J.good && J.loss > 0){
    // 存这一手的盘面（只存有东西的行，字符串一行一个）、你放的、推荐放的
    const rows = [];
    for (let y = 0; y < TOTAL_ROWS; y++) rows.push(sh.b0[y].map(v => v ? '#' : '.').join(''));
    const top = rows.findIndex(r => r.includes('#'));
    const keep = Math.min(top < 0 ? TOTAL_ROWS - 4 : top, TOTAL_ROWS - 4) - 2;
    const from = Math.max(0, Math.min(keep, ...J.cells.map(c => c[1]), ...(sh.rec.cells || []).map(c => c[1])));
    const w = { loss: Math.round(J.loss), r: J.r, msg: J.msg, type: p.type, from, rows: rows.slice(from),
                mine: J.cells.map(([x, y]) => [x, y - from]), rec: (sh.rec.cells || []).map(([x, y]) => [x, y - from]),
                at: game.lines };
    R.cWorst.push(w);
    R.cWorst.sort((a, b) => b.loss - a.loss);
    R.cWorst.length = Math.min(R.cWorst.length, COACH_WORST);
  }
}
// 损失最大的几手：小盘面，灰的是当时的盘面，红的是你放的，绿框是推荐
function drawWorst(cv, w){
  const rows = w.rows.length, s = Math.max(4, Math.floor(Math.min(110 / COLS, 150 / rows)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = COLS * s * dpr; cv.height = rows * s * dpr;
  cv.style.width = COLS * s + 'px'; cv.style.height = rows * s + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(0, 0, COLS * s, rows * s);
  w.rows.forEach((r, y) => { for (let x = 0; x < COLS; x++) if (r[x] === '#'){ c.fillStyle = '#5d6b86'; c.fillRect(x * s + .5, y * s + .5, s - 1, s - 1); } });
  c.fillStyle = '#ff6b6b';
  for (const [x, y] of w.mine) c.fillRect(x * s + .5, y * s + .5, s - 1, s - 1);
  c.strokeStyle = '#5ee08a'; c.lineWidth = Math.max(1.5, s * .18);
  for (const [x, y] of w.rec) c.strokeRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
}


// ── 离开这一局？ ──
// 普通局（含中途开局）打了 10 块以上、还没结束，就算「在打」：点顶栏切去练习 / 提示前先确认
function liveRun(){
  return !CRAZY && !assisted() && game.started && !game.over && game.pieces - (mid ? mid.p : 0) >= 10;
}
let leaveTo = null;
function askLeave(m){
  const sh = $('leaveSheet');
  if (!sh){ return; }
  leaveTo = m;
  $('leaveGo').textContent = m === 'hint' ? '去提示模式' : '去练习';
  sh.hidden = false;
  game.frozen = true;
}
function closeLeave(go){
  const sh = $('leaveSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  const m = leaveTo; leaveTo = null;
  if (!go){ unfreezeIfIdle(); return; }
  if (m === 'practice'){ startPractice(); openPrSheet(); }
  else if (m === 'hint') startHint();
}

// ───────────────────────── 历史记录 ─────────────────────────
//
// 每一局正经局存一条：时间、分数、行数、等级、用时、块数、四消 / T 旋双消 / 造洞。
// 结算页的「每行均分（上局 …）」也从这里读。本机最多留 HIST_KEPT 局，存在 localStorage 里。
const HIST_KEY = nsKey('hist.v1');
const HIST_KEPT = 300;
const OLD_REVIEW_KEY = nsKey('review.v1');   // 局后复盘第一版自己存的最近 20 局（没有等级），第一次读历史时接过来
function histRead(){
  try {
    const a = JSON.parse(localStorage.getItem(HIST_KEY) || 'null');
    if (Array.isArray(a)) return a.filter(e => e && typeof e.s === 'number' && Number.isFinite(e.s));
    const r = JSON.parse(localStorage.getItem(OLD_REVIEW_KEY) || '[]');
    if (Array.isArray(r)) return r.filter(e => e && typeof e.score === 'number')
      .map(e => ({ d: e.d, s: e.score, l: e.lines, p: e.pieces, t4: e.t4, tsd: e.tsd, h: e.holes }));
  } catch { /* 坏了就当没有 */ }
  return [];
}
function histPush(e){
  const a = histRead(); a.push(e);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(a.slice(-HIST_KEPT))); } catch { /* 存不了就算了 */ }
}
function histEntry(){
  const r = game.run || {};
  return { d: Date.now(), s: game.score, l: game.lines, lv: game.level, t: Math.round(game.elapsed), p: game.pieces,
           t4: r.clr ? r.clr[4] : r.tetris || 0, tsd: r.tsc ? r.tsc[2] + r.tsc[3] : 0, h: r.holes || 0,
           ...(mid ? { mid: mid.L, s0: mid.s, l0: mid.L, t0: mid.e } : {}), ...(r.aidTs ? { aid: 'ts' } : {}) };
}
const mmss = ms => { const s = Math.floor((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// 看哪一项：键、名字、怎么取值、怎么写
const HIST_METRICS = [
  ['s',  '分数',     e => e.s,                               v => fmtScore(v)],
  ['l',  '行数',     e => e.l || 0,                          v => String(Math.round(v))],
  ['lv', '等级',     e => e.lv,                              v => String(Math.round(v))],
  ['pl', '每行均分', e => e.l ? Math.round(e.s / e.l) : null, v => groupInt(Math.round(v))],
  ['t',  '用时',     e => e.t,                               v => mmss(v)],
];
const HIST_RANGES = [[20, '近 20 局'], [50, '近 50 局'], [0, '全部']];
const HIST_VIEW_KEY = nsKey('hist.view.v1');
let histView = { m: 's', n: 20, pick: -1 };
try { const v = JSON.parse(localStorage.getItem(HIST_VIEW_KEY) || 'null');
      if (v && HIST_METRICS.some(x => x[0] === v.m)) histView.m = v.m;
      if (v && HIST_RANGES.some(x => x[0] === v.n)) histView.n = v.n; } catch { /* 用默认 */ }
const histMetric = () => HIST_METRICS.find(x => x[0] === histView.m) || HIST_METRICS[0];
const dateTx = d => { if (!d) return '—'; const t = new Date(d); return (t.getMonth() + 1) + '/' + t.getDate(); };
const timeTx = d => { if (!d) return ''; const t = new Date(d); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
// 坐标轴取整：1 / 2 / 5 × 10^k
function niceCeil(v){
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
// 一条线 + 每局一个点。最高那局标金色，最后一局标数值；点哪里看哪一局
function histChartSVG(rows, pick){
  const W = 340, H = 168, L = 44, R = 12, Tp = 12, B = 22;
  const [, , get, fmt] = histMetric();
  const pts = rows.map((e, i) => ({ i, e, v: get(e) })).filter(p => p.v != null && Number.isFinite(p.v));
  if (!pts.length) return '';
  const top = niceCeil(Math.max(...pts.map(p => p.v)));
  const n = rows.length, xs = i => n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1);
  const ys = v => Tp + (H - Tp - B) * (1 - v / top);
  let h = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escHtml(histMetric()[1])}曲线">`;
  for (const f of [0, .5, 1]){
    const y = ys(top * f);
    h += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 3}" text-anchor="end">${escHtml(fmt(top * f))}</text>`;
  }
  h += `<text class="ax" x="${xs(0)}" y="${H - 6}" text-anchor="start">${escHtml(dateTx(rows[0].d))}</text>`;
  if (n > 1) h += `<text class="ax" x="${xs(n - 1)}" y="${H - 6}" text-anchor="end">${escHtml(dateTx(rows[n - 1].d))}</text>`;
  h += `<path class="ln" d="${pts.map((p, k) => (k ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1)).join('')}"/>`;
  const best = pts.reduce((a, b) => b.v > a.v ? b : a);
  const last = pts[pts.length - 1];
  if (pick >= 0 && pick < n) h += `<line class="xh" x1="${xs(pick)}" x2="${xs(pick)}" y1="${Tp}" y2="${H - B}"/>`;
  for (const p of pts){
    const big = p === best || p === last || p.i === pick;
    if (n > 60 && !big) continue;               // 局数多了只画线，点太密反而糊
    h += `<circle class="pt${p === best ? ' best' : ''}${p.i === pick ? ' on' : ''}" cx="${xs(p.i)}" cy="${ys(p.v)}" r="${big ? 4.5 : 3.2}"/>`;
  }
  const lab = (p, tx, cls) => {
    const x = xs(p.i), anchor = x > W - 60 ? 'end' : x < L + 40 ? 'start' : 'middle', y = Math.max(Tp + 8, ys(p.v) - 9);
    return `<text class="vl ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${escHtml(tx)}</text>`;
  };
  h += lab(best, '最高 ' + fmt(best.v), 'b');
  if (last !== best) h += lab(last, fmt(last.v), '');
  // 透明的点击层：按在哪个横坐标就选哪一局（比点 4px 的圆好按）
  h += `<rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
  return h + '</svg>';
}
function histTipText(rows, i, base){
  const e = rows[i];
  if (!e) return '';
  return `第 ${base + i + 1} 局 · ${dateTx(e.d)} ${timeTx(e.d)} · ${fmtScore(e.s)} 分 · ${e.l ?? '—'} 行 · ${e.lv ?? '—'} 级 · ${e.t != null ? mmss(e.t) : '—'}`;
}
function renderHist(){
  const every = histRead();
  const all = every.filter(e => !e.mid && !e.aid);   // 曲线和摘要只算从头、不开辅助打的局：中途开局的分数里有一截是送的
  const rows = histView.n ? all.slice(-histView.n) : all;
  const [, name, get, fmt] = histMetric();
  $('histMetric').innerHTML = HIST_METRICS.map(([k, t]) => `<button type="button" data-hm="${k}" class="${k === histView.m ? 'on' : ''}">${t}</button>`).join('');
  $('histRange').innerHTML = HIST_RANGES.map(([k, t]) => `<button type="button" data-hn="${k}" class="${k === histView.n ? 'on' : ''}">${t}</button>`).join('');
  const sum = $('histSum'), chart = $('histChart'), tip = $('histTip'), list = $('histList');
  if (!every.length){
    sum.textContent = '';
    tip.textContent = '';
    chart.innerHTML = '<p class="hist-empty">还没有记录。普通局打到 30 块以上，结束后就记在这里。</p>';
    list.innerHTML = '';
    return;
  }
  const vals = all.map(get).filter(v => v != null && Number.isFinite(v));
  const onlyOdd = !all.length;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const last10 = vals.slice(-10), prev10 = vals.slice(-20, -10);
  let tr = '';
  if (prev10.length >= 5 && avg(prev10) > 0){
    const d = Math.round((avg(last10) / avg(prev10) - 1) * 100);
    tr = `，比再往前 10 局 <b class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : ''}${d}%</b>`;
  }
  if (onlyOdd) sum.textContent = `共 ${every.length} 局，都是中途开局或开了标槽（曲线只画从头、不开辅助打的局）`;
  else sum.innerHTML = `共 <b>${all.length}</b> 局 · ${escHtml(name)}最高 <b>${escHtml(vals.length ? fmt(Math.max(...vals)) : '—')}</b>`
    + `<br>近 ${last10.length} 局平均 <b>${escHtml(last10.length ? fmt(avg(last10)) : '—')}</b>${tr}`;
  const pick = histView.pick >= 0 && histView.pick < rows.length ? histView.pick : rows.length - 1;
  chart.innerHTML = !rows.length ? '<p class="hist-empty">还没有从头打完的局（中途开局、开了标槽的局不画进曲线，只列在下面）</p>'
    : histChartSVG(rows, pick) || '<p class="hist-empty">这一项以前的局没记（等级是后来才开始记的）</p>';
  tip.textContent = histTipText(rows, pick, all.length - rows.length);
  const svg = chart.querySelector('svg');
  if (svg){
    const choose = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * 340;
      const k = rows.length === 1 ? 0 : Math.round((x - 44) / (340 - 44 - 12) * (rows.length - 1));
      histView.pick = Math.max(0, Math.min(rows.length - 1, k));
      renderHist();
    };
    svg.addEventListener('pointerdown', choose);
  }
  const best = all.length ? Math.max(...all.map(e => e.s)) : -1;
  list.innerHTML = '<div class="hl-row hl-h"><span>时间</span><span>分数</span><span>行</span><span>级</span><span>用时</span></div>'
    + every.slice(-30).reverse().map(e => `<div class="hl-row${!e.mid && !e.aid && e.s === best ? ' best' : ''}${e.mid || e.aid ? ' mid' : ''}"><span>${dateTx(e.d)} ${timeTx(e.d)}${e.mid ? `<em>${e.mid} 行起</em>` : ''}${e.aid ? '<em>标槽</em>' : ''}</span>`
      + `<span>${escHtml(fmtScore(e.s))}${!e.mid && !e.aid && e.s === best ? ' ★' : ''}</span><span>${e.l ?? '—'}</span><span>${e.lv ?? '—'}</span><span>${e.t != null ? mmss(e.t) : '—'}</span></div>`).join('');
}
function openHistSheet(){
  histView.pick = -1;
  renderHist();
  $('histSheet').hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeHistSheet(){
  const sh = $('histSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  unfreezeIfIdle();
}
function bindHist(){
  const sh = $('histSheet');
  sh.addEventListener('click', e => {
    if (e.target === sh) return closeHistSheet();
    const m = e.target.closest('[data-hm]'), n = e.target.closest('[data-hn]');
    if (!m && !n) return;
    if (m) histView.m = m.dataset.hm;
    if (n){ histView.n = +n.dataset.hn; histView.pick = -1; }
    try { localStorage.setItem(HIST_VIEW_KEY, JSON.stringify({ m: histView.m, n: histView.n })); } catch { /* 记不住就算了 */ }
    renderHist();
  });
  $('histClose').addEventListener('click', closeHistSheet);
}

// ───────────────────────── 菜单 ─────────────────────────
// 顶栏只留「暂停」「菜单」。重开 / 历史记录 / 设置 / 音效 / 玩法说明都在这张面板里
function openMenu(){
  $('menuSheet').hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeMenu(){
  const sh = $('menuSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  unfreezeIfIdle();
}
function bindMenu(){
  const sh = $('menuSheet');
  $('menuBtn').addEventListener('click', openMenu);
  $('menuClose').addEventListener('click', closeMenu);
  sh.addEventListener('click', e => { if (e.target === sh) closeMenu(); });
  // 点了去别的面板：先收起菜单（不解冻），等目标面板开好再看要不要解冻 —— 设置在 FEVER 期间开不了，那时得接着打
  for (const id of ['restartBtn', 'histBtn', 'skinBtn', 'helpBtn']){
    $(id).addEventListener('click', () => { sh.hidden = true; setTimeout(unfreezeIfIdle, 0); });
  }
  $('histBtn').addEventListener('click', openHistSheet);
}

// ───────────────────────── 局后复盘（标准版普通局） ─────────────────────────
//
// 20 级以后倍率封顶 ×8，同样消一行，单消 800、四消 1600、T 旋双消 4800 —— 分数高低主要看「怎么消的」，
// 不是消了多少行。结算页只给总分的话，打了 246 行才 24 万，自己看不出差在哪。
// 这里把这局拆开：消行构成、分数从哪来、造了几个洞、多少块是在高处放的，再挑最要紧的 1~3 条建议。
const REVIEW_HIGH = 13;            // 堆到 13 行以上（盘面过六成）放的块算「在高处放」
function pct(a, b){ return b > 0 ? Math.round(a / b * 100) : 0; }
// 建议按「拉不拉得开分数」排。阈值是拿真实引擎上的机器人对局定的（约 400 局，每秒 1 块、带灰线）：
//   · 堆高：放偏率 0 / 3% / 10% 时高处放块 10% / 13% / 28%，留井打四消 49% —— 区分度最好，排第一
//   · T 旋双消：同节奏的教练每 100 块约 3 个；分数差距主要来自这里（教练 50 万 vs 留井 32 万 vs 见行就消 16 万）
//   · 放偏：放偏率 10% → 3% 分数 +45%，后台教练「放对几成」直接量它
//   · 洞：按提示模式口径（槽屋檐下不算），零失误也有十几个 / 100 块，所以门槛放高
//   · 「消得太碎」删了：零失误的教练也有八成多的行是 1~3 行消的，攒着不消反而 -18%
const COACH_TSD100 = 3;
function reviewTips(r, pieces, lines, ctx){
  const tips = [], c = ctx || {};
  const per100 = pieces ? r.holes / pieces * 100 : 0;
  const high = pct(r.highLocks, pieces);
  const tsd = r.tsc[2] + r.tsc[3];
  const tsd100 = pieces ? tsd / pieces * 100 : 0;
  const cg = r.cN ? pct(r.cGood, r.cN) : -1;
  const worstRule = r.cRule ? r.cRule.indexOf(Math.max(...r.cRule)) : -1;
  const DRILL_FOR = ['每日练习的「堆叠」段', '每日练习的「堆叠」段', '「T 旋练习」', '中途开局 200 行起'];
  if (high >= 25)
    tips.push(['在高处待太久', `${high}% 的块是在盘面过六成时放的（照教练打一般一成多）。堆高了就先消低处、别再攒，降下来再搭槽 —— 灰线一涨就顶死了`]);
  if (pieces >= 100 && tsd100 < COACH_TSD100 / 2)
    tips.push([tsd ? 'T 旋打得少' : '没打出 T 旋', `每 100 块打了 ${tsd100.toFixed(1)} 个 T 旋双消，照教练打大约 ${COACH_TSD100} 个。20 级后一次 T 旋双消 9600 分，比一次四消（6400）还多，只用两行。`
      + (r.tN ? `这局 ${r.tN} 个 T：${r.tTsd} 个打了 T 旋双消、${r.tMiss} 个有槽没打、${r.tFlat} 个能暂存却放掉了。` : '') + '没槽时 T 先暂存'] );
  if (cg >= 0 && r.cN >= 50 && cg < 70 && worstRule >= 0)
    tips.push(['放偏的块多', `只有 ${cg}% 的块放得和教练一样好，最常犯 ${HINT_RULES[worstRule].n}「${HINT_RULES[worstRule].t}」（${r.cRule[worstRule]} 次）。下面列了损失最大的几手；这一条去${DRILL_FOR[worstRule]}练`]);
  if (r.tN >= 20 && r.tFlat / r.tN >= .4)
    tips.push(['T 用掉了', `${r.tN} 个 T 里有 ${r.tFlat} 个没槽、暂存也空着，却直接放掉了。T 是打 T 旋的，没槽先放进暂存，搭好槽再换出来`]);
  if (per100 >= 25)
    tips.push(['洞造多了', `这局造了 ${r.holes} 个洞（每 100 块 ${per100.toFixed(0)} 个，T 槽屋檐下那格不算）。洞上面那几行全都消不掉，放之前看一眼会不会盖住空格`]);
  if (r.finN >= 50 && pct(r.faults, r.finN) >= 30)
    tips.push(['按键绕远了', `${pct(r.faults, r.finN)}% 的块按的比最少按法多（这局多按了 ${r.extra} 下）。后期块掉得快，多按一下就可能放错：横着贴墙的块直接按住到墙，转向先想好再按`]);
  if (c.pps > 0 && c.ppsAvg > 0 && c.pps < c.ppsAvg * .9)
    tips.push(['比平时慢', `每秒 ${c.pps.toFixed(2)} 块，你近 ${c.ppsN} 局平均 ${c.ppsAvg.toFixed(2)}。平常块要快（每秒 1 块提到 1.25 块，模拟里分数 +26%），T 旋那一下慢点没关系`]);
  if (!tips.length)
    tips.push(['打法对了', `四消 + T 旋拿了 ${pct(r.bigPts, r.bigPts + r.smallPts)}% 的分。下一步是扛得更久：盘面一高就先保命`]);
  return tips.slice(0, 3);
}
// 结算卡能往下滑的时候，底边给个「往下滑还有」；滑到底收起
function syncCardMore(){
  const card = document.querySelector('#overlay .card');
  if (!card) return;
  const upd = () => card.classList.toggle('more', card.scrollHeight - card.scrollTop - card.clientHeight > 6);
  if (!card.dataset.moreBound){ card.dataset.moreBound = '1'; card.addEventListener('scroll', upd, { passive: true }); }
  requestAnimationFrame(upd);
  setTimeout(upd, 900);            // 结算卡是等死亡动画走完才弹出来的
  setTimeout(upd, 2600);
}
function fillReview(){
  const box = $('review');
  if (!box) return;
  const r = game.run;
  // 中途开局只看开局之后你自己打的那一段：行、块、用时、分数都减掉开局送的
  const m0 = mid || { L: 0, s: 0, p: 0, e: 0 };
  const show = !CRAZY && !!r && !assisted() && game.pieces - m0.p >= 10;
  box.hidden = !show;
  if (!show) return;
  const secs = (game.elapsed - m0.e) / 1000, lines = game.lines - m0.L, pieces = game.pieces - m0.p;
  const perLine = lines ? Math.round((game.score - m0.s) / lines) : 0;
  // 「上局」跟同一种开局比：从头打的比从头打的，中途开局比同一档
  const prev = histRead().filter(e => (e.mid || 0) === (mid ? mid.L : 0)).slice(-1)[0];
  const tsd = r.tsc[2] + r.tsc[3], tsOther = r.tsc[1] + r.tsc[0] + r.mini;
  const rows = [];
  const add = (k, v, wide) => rows.push(`<span${wide ? ' class="w"' : ''}><i>${k}</i><b>${v}</b></span>`);
  add('每行均分', groupInt(perLine) + (prev && prev.l - (prev.l0 || 0) > 0 ? `（上局 ${groupInt(Math.round((prev.s - (prev.s0 || 0)) / (prev.l - (prev.l0 || 0))))}）` : ''), true);
  add('四消', r.clr[4] + ' 次');
  add('T 旋双消', tsd + ' 次');
  add('单消 / 双消 / 三消', `${r.clr[1]} / ${r.clr[2]} / ${r.clr[3]} 次`, true);
  if (tsOther) add('其它 T 旋（单消 / mini 等）', tsOther + ' 次', true);
  add('四消+T旋 拿分', pct(r.bigPts, r.bigPts + r.smallPts) + '%');
  add('B2B', r.b2bs + ' 次');
  add('造洞', r.holes + ' 个');
  add('高处放块', pct(r.highLocks, pieces) + '%');
  add('用时', Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0'));
  // 手速跟自己近 10 局（从头打的、不开标槽）比
  const pps = secs > 0 ? pieces / secs : 0;
  const ppsHist = histRead().filter(e => !e.mid && !e.aid && e.t > 60000 && e.p > 0).slice(-10).map(e => e.p / (e.t / 1000));
  const ppsAvg = ppsHist.length >= 3 ? ppsHist.reduce((a, b) => a + b, 0) / ppsHist.length : 0;
  add('每秒', pps.toFixed(2) + ' 块' + (ppsAvg ? `（近 ${ppsHist.length} 局 ${ppsAvg.toFixed(2)}）` : ''), !!ppsAvg);
  // 分段看每行均分：分是在哪一段丢的
  const segTx = (r.seg || []).map(([pt, ln], k) => ln ? `${['0~100', '100~200', '200 后'][k]} ${groupInt(Math.round(pt / ln))}` : '').filter(Boolean);
  if (segTx.length > 1) add('分段每行', segTx.join(' · '), true);
  if (r.finN >= 10) add('多余按键', `${pct(r.faults, r.finN)}% 的块（多按 ${r.extra} 下）`, true);
  if (r.cN >= 10){
    const wr = r.cRule.indexOf(Math.max(...r.cRule));
    add('跟教练比', `放对 ${pct(r.cGood, r.cN)}%` + (r.cRule[wr] ? ` · 最常犯 ${HINT_RULES[wr].n}${HINT_RULES[wr].t}` : ''), true);
  }
  if (r.tN) add('T 块去向', `${r.tN} 个 T：T 旋双消 ${r.tTsd} · 有槽没打 ${r.tMiss} · 能暂存却放掉 ${r.tFlat} · 没法暂存 ${r.tOther || 0}（进过暂存 ${r.tHold} 次）`, true);
  $('rvStats').innerHTML = rows.join('');
  $('rvTips').innerHTML = reviewTips(r, pieces, lines, { pps, ppsAvg, ppsN: ppsHist.length })
    .map(([t, d]) => `<li><b>${escHtml(t)}</b><span>${escHtml(d)}</span></li>`).join('');
  // 损失最大的几手：当时的盘面 + 你放的（红）+ 推荐（绿框）
  const wb = $('rvWorst');
  if (wb){
    const ws = (r.cWorst || []).filter(w => w && Array.isArray(w.rows));
    wb.hidden = !ws.length;
    $('rvWorstList').innerHTML = ws.map((w, i) => `<div class="rv-w"><canvas data-w="${i}"></canvas><span><b>${escHtml(HINT_RULES[w.r] ? HINT_RULES[w.r].n + ' ' + HINT_RULES[w.r].t : '')}</b>${escHtml(w.msg)}<em>第 ${w.at} 行时 · ${w.type} 块</em></span></div>`).join('');
    ws.forEach((w, i) => drawWorst($('rvWorstList').querySelector(`[data-w="${i}"]`), w));
  }
  syncCardMore();
}

// 分数关口播报。一局能撞三四个，是频率最高的一条，顺带给「一局之内没有
// 阶段感」补一个节点 —— 分数原来只是个一直涨的数字。
// 关口密一点，一局能多撞几次。大部分只报个数，整数关口才给一句话 ——
// 每个都配文案的话，说得太满反而不值钱了。
const MILE_W = [300, 600, 1200, 3000, 4800, 6000, 9000, 12000, 18000, 30000, 48000, 60000, 90000, 120000];
// key 是「万」数，必须在 MILE_W 里真实存在，否则这条台词永远不会出现。
// 梯子 ×2 之后 300/500/800 这些 key 全落空了，跟着挪到新的档位上。
const MILE_SAY = {
  300:   '三百万，有点东西',
  1200:  '一千二百万',
  3000:  '三千万，你认真的?',
  6000:  '六千万',
  12000: '一亿二，离谱',
  30000: '三亿。没话说了',
};
const MILESTONES = MILE_W.map(w => [w * 10000, MILE_SAY[w] || (w + ' 万')]);
function checkMilestone(){
  const r = game.run;
  if (!CRAZY || !r) return;
  for (let i = r.mile; i < MILESTONES.length; i++){
    if (game.score < MILESTONES[i][0]) break;
    r.mile = i + 1;
    tip(MILESTONES[i][1], 0);           // 里程碑不节流，它比什么都值得说
    shake(i >= 3);
    sfx('level', 1 + i * .04);
  }
}

// 盘面上有几个「埋着的洞」（上方有方块、自己是空的）
function countHoles(){
  let h = 0;
  for (let x = 0; x < COLS; x++){
    let seen = false;
    for (let y = 0; y < TOTAL_ROWS; y++){
      if (game.board[y][x]) seen = true; else if (seen) h++;
    }
  }
  return h;
}

function newRun(){
  // 七种变异块都要有计数器。fill / fork / dye 是后加的，原来没跟上 ——
  // lockPiece 里的 `game.run[p.mod]++` 就变成 undefined++ = NaN，
  // 结算页因此永远看不到这三种（它们占非金块变异的四成多）。
  return { peak: 1, dangerMs: 0, gold: 0, bomb: 0, laser: 0, hammer: 0, fill: 0, fork: 0, dye: 0,
           bets: 0, betWins: 0, rerolls: 0, bestHit: 0, tspin: 0, tetris: 0, perfect: 0,
           mile: 0, wasDanger: false, saves: 0, chests: 0, delays: 0, zones: 0, zoneRows: 0, ups: [],
           // 标准版局后复盘用：普通消行按行数、T 旋按行数各记几次，分数分「四消+T旋」和「1~3 行」两份
           clr: [0, 0, 0, 0, 0], tsc: [0, 0, 0, 0], mini: 0, b2bs: 0, maxCombo: 0,
           bigPts: 0, bigLines: 0, smallPts: 0, smallLines: 0, holes: 0, highLocks: 0,
           seg: [[0, 0], [0, 0], [0, 0]],          // 按行数分三段（0~99 / 100~199 / 200 行以后）各拿了多少分、消了几行
           finN: 0, faults: 0, extra: 0, aidTs: false,
           // 后台教练（普通局悄悄跑提示模式那套推荐，不显示）：跟推荐一样好的块数、违反哪条、损失最大的几手
           cN: 0, cGood: 0, cRule: [0, 0, 0, 0], cWorst: [],
           // T 块去向：打成 T 旋双消 / 有槽没打 / 进了暂存 / 平放掉
           tN: 0, tTsd: 0, tMiss: 0, tHold: 0, tFlat: 0, tOther: 0 };
}

// 按打法给个称号。从最有辨识度的往下判，第一个命中的就是它 ——
// 同时满足好几条的时候，「赖皮」比「稳」更值得说。
function runTitle(r, secs){
  const dangerPct = secs > 0 ? r.dangerMs / (secs * 1000) : 0;
  // 收手局单独给个称号 —— 它不是「没什么惊险」，是主动停下来
  if (game.why === '收手')    return ['收手', '主动结算，分数照算'];
  if (dangerPct > .25)        return ['赖皮', '四分之一的时间泡在危险区'];
  if (r.betWins >= 3)         return ['赌徒', `梭哈赢了 ${r.betWins} 次`];
  if (r.tspin >= 3)           return ['花活', `${r.tspin} 次 T-SPIN`];
  if (r.rerolls >= 5)         return ['挑食', `换掉了 ${r.rerolls} 块`];
  if (r.tetris >= 8)          return ['板砖工', `${r.tetris} 次四行`];
  if (r.peak >= HEAT_TIERS[3]) return ['失控', `峰值 ×${r.peak.toFixed(1)}`];
  if (r.peak >= HEAT_TIERS[2]) return ['上头', `峰值 ×${r.peak.toFixed(1)}`];
  if (r.perfect > 0)          return ['干净', '打出过全消'];
  return ['稳', '没什么惊险，也没什么惊喜'];
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
    // n 理论上不会超过 4，但压实/爆炸曾经把满行攒到下一次锁定，凑出过 5、6 行。
    // 表外取值是 undefined，乘一下整局分数就变 NaN —— 这里兜住，别再让它发生。
    base = n <= 4 ? [0, 100, 300, 500, 800][n] : 800 + (n - 4) * 300;
    label = n <= 4 ? ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][n] : `${n} LINES`;
  }

  // back-to-back：连续的 Tetris 或 T-spin 消行，额外五成
  const isHard = n > 0 && (n === 4 || spin);
  if (n > 0){
    if (isHard && game.b2b){ base = Math.floor(base * 1.5); label = 'B2B ' + label; b2bApplied = true; }
    lastClearB2B = b2bApplied;
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
    base += (n <= 4 ? [0, 800, 1200, 1800, 2000][n] : 2000) || 800;
    label = '全消 PERFECT CLEAR';
    buzz([40, 50, 60, 50, 90]);
  }

  const rainOn = rainHit(lastClearRows);
  const gain = Math.round(base * mult * crazyScoreMult() * (rainOn ? rainMult() : 1));
  if (rainOn) rainBoom();
  game.score += gain;
  if (game.run){
    if (gain > game.run.bestHit) game.run.bestHit = gain;
    if (n === 4) game.run.tetris++;
    if (spin === 'tspin') game.run.tspin++;
    if (perfect) game.run.perfect++;
    if (n === 0 && spin && game.run.tsc){ if (spin === 'tspin') game.run.tsc[0]++; else game.run.mini++; }   // 不消行的 T 旋也记上
    if (n > 0){
      const R = game.run, big = n >= 4 || spin === 'tspin';
      if (spin === 'tspin') R.tsc[Math.min(n, 3)]++;
      else if (spin === 'mini') R.mini++;
      else R.clr[Math.min(n, 4)]++;
      if (b2bApplied) R.b2bs++;
      if (game.combo > R.maxCombo) R.maxCombo = game.combo;
      if (big){ R.bigPts += gain; R.bigLines += n; } else { R.smallPts += gain; R.smallLines += n; }
      const sg = R.seg && R.seg[Math.min(2, Math.floor(game.lines / 100))];    // game.lines 这时还是消之前的
      if (sg){ sg[0] += gain; sg[1] += n; }
    }
  }

  // 飘字落在被消掉那几行的中间；空转的 T-spin 没有消除行，落在方块自己身上
  const st = clearStyle(n, spin, perfect);
  if (st && (n > 0 ? lastClearRows.length : !!spin)){
    // 标准版放在消除行的上方：原来压在正在闪白光的消除行正中，浅色字压浅色底，几乎看不见
    const row = n > 0
      ? (CRAZY ? lastClearRows.reduce((a, b) => a + b, 0) / lastClearRows.length : Math.min(...lastClearRows) - 1.1)
      : lastLockY;
    const py = Math.max(CELL * 1.6, (row - BUFFER + .5) * CELL);
    const hot = CRAZY && feverLeft > 0;

    let label = st.name, cls = st.cls;
    if (b2bApplied){ label = 'B2B ' + label; cls += ' b2b'; }
    if (game.combo >= 1){ label += ` ×${game.combo}`; if (game.combo >= 5) cls += ' cmb'; }
    if (hot) cls += ' hot';

    popScore(CELL * COLS / 2, py, '+' + groupInt(gain), label, cls,
             st.scale * (hot ? 1.25 : 1));

    // 附加特效按稀有度给：四行横扫一道金光，T-spin 消行从中心爆开一圈紫环。
    // 两者可以叠（T-spin 打出的四行），但不是必然一起来。
    if (n === 4) sweepRows(lastClearRows, '#ffd166');
    if (spin && n > 0) burstRing(lastClearRows, spin === 'tspin' ? '#ff6bd6' : '#c9a6ff');
    // 全消单独一套。它原来和四行共用金色扫光 + 同一档震屏，等于没区别 ——
    // 而全消是整局可能一次都打不出来的东西，稀有度差着量级。
    if (perfect) perfectFx();

    if (CRAZY){
      const big = n === 4 || spin || perfect;
      if (big) shake(n === 4 || perfect);
      else if (n >= 2) shake(false);
    } else lastHit = hitFx(n, spin, perfect, b2bApplied);
  }

  if (n > 0){
    game.lines += n;
    // 等级本身不封顶，一直往上涨；封顶的是它驱动的三件事：
    // 速度在 gravityFor 里 clamp、倍率在 levelMult 里 clamp、
    // 只有灰线在满级之后继续被它推快，所以再强的人也一定会撞墙。
    const newLevel = Math.floor(game.lines / LINES_PER_LEVEL) + 1 + (mid ? mid.dl || 0 : 0);   // 中途开局随机多/少的那几级一直带着
    // 每日练习不升级：三段每天同一个速度，数字才能跨天比
    if (newLevel > game.level && !drill && !tsOn()){ game.level = newLevel; flashLevel(); syncEdge(); }
  }
  // toast 只留"够得上事件"的：常态的连击/B2B 交给常驻徽章，
  // 否则同一件事会有飘字 + 徽章 + toast 三个通道同时喊。
  if (CRAZY && label && (n === 4 || spin || perfect)) showToast(label.trim());
  // 里程碑放在 label 的 toast 之后。放前面会被它当场盖掉 —— 而里程碑偏偏
  // 总是和大消除同时发生，等于永远看不见。两者冲突时让里程碑赢，它更少见。
  checkMilestone();
  // 练习局不刷最高分。endGame 那条早就挡了，但这里是**每次锁定**都会走的实时刷新，
  // 原来没挡：练习里落两块就把纪录改了（实测 0 → 76）。
  // 中途开局（开局送了分）和开过标 T 槽的局也不刷：endGame 那条挡了，这条实时刷新原来没挡，消一行就写进纪录
  if (!assisted() && !mid && !(game.run && game.run.aidTs) && game.score > game.best){
    // 破纪录的检测挪到 syncHud 了 —— 分数有三个增长入口（scoreFor /
    // clearFullNow / 软降），只在这里判会漏：道具消行把你推过纪录线时不响。
    game.best = game.score; writeBest(game.best);
  }
  syncStreak();
}

// 堆顶在第几行（越小越高）。空盘返回 TOTAL_ROWS。
function stackTopRow(){
  for (let y = 0; y < TOTAL_ROWS; y++) if (game.board[y].some(Boolean)) return y;
  return TOTAL_ROWS;
}

function applyClear(rows){
  if (CRAZY) claimChests(rows);      // 必须在盘面塌陷之前数，塌完那几行就没了
  if (CRAZY) rainShift(rows);        // 同理：塌陷会改变行下标，标记要跟着挪
  const set = new Set(rows);
  const kept = [];
  for (let y = 0; y < TOTAL_ROWS; y++) if (!set.has(y)) kept.push(game.board[y]);
  if (zoneLeft > 0){
    // ZONE 期间消掉的行不会消失，而是沉到底部变成死行 —— 盘面从下往上缩。
    // 行数守恒：拿掉 n 行、底部补 n 行，所以消行之上的堆**原地不动**，
    // 而消行之下的堆被抬高 n 格。地板在涨，这就是 ZONE 的代价。
    // 边沉边截。原来是把这一次的行全 push 完再回头判封顶 ——
    // 沉到 11 行时再消 4 行会一次冲到 15，而说明书和盘面讲解都写着「最多 12 行」，
    // 奖金又是按 k² 给的，越界那几行恰恰最值钱（实测超发 56%）。
    // 装不下的行就按普通消行处理（它们已经从 kept 里拿掉了，下面补空行时堆会落下来）。
    const room = Math.max(0, ZONE_MAX - zoneRows);
    for (let i = 0; i < Math.min(rows.length, room); i++){
      kept.push(new Array(COLS).fill(ZONE));
      zoneRows++;
    }
    // 不能在这里直接 zoneEnd —— 新盘面还在 kept 里没赋值，zoneEnd 会对着旧盘面动手
    if (zoneRows >= ZONE_MAX) zoneFull = true;
  }
  while (kept.length < TOTAL_ROWS) kept.unshift(new Array(COLS).fill(null));
  game.board = kept;
  staticDirty = true;
  needsDraw = true;
  if (zoneFull){ zoneFull = false; zoneEnd('盘面满了'); }
}

// 底部塞一行带缺口的灰线，整盘往上顶一格
function riseGarbage(){
  if (game.board[0].some(Boolean)){ endGame('灰线顶出'); return; }
  if (aids.ts && aidSlots.length) aidSlots = aidSlots.map(s => Object.assign({}, s, { y: s.y - 1 }));   // 整盘上移一格，标的槽跟着走
  // 整盘上移一格，标记行跟着往上走；走出可见区就重挑
  if (CRAZY && rainRow >= 0){ rainRow--; if (rainRow < BUFFER) rainRow = -1; }
  game.board.shift();
  const row = new Array(COLS).fill(GARBAGE);
  const gap = (rndGame() * COLS) | 0;
  row[gap] = null;                                      // 留个缺口，不然没法消
  // 宝箱：灰线现在只有坏处，这给了它第二个身份 —— 一个看得见、够得到的目标。
  // 状态存在盘面格子里（和冰冻行同一套），塌陷、上顶、地震都会跟着走。
  if (CRAZY && rndFx() < chestRate()){
    let x = (rndFx() * COLS) | 0;
    if (x === gap) x = (x + 1) % COLS;
    row[x] = CHEST;
  }
  game.board.push(row);
  game.garbage++;
  // 出块时拍的盘面快照（后台教练 / 多余按键 / 提示模式）跟着上移，不然这一手会被当成「留了洞」
  if (fin.b){
    fin.b = fin.b.slice(1).concat([row.map(Boolean)]);
    if (shadow && game.piece) shadow = Object.assign({}, shadow, { b0: fin.b, rec: coachRec(fin.b, game.piece.type, null, game.hold, game.holdUsed) || shadow.rec });
  }
  if (hintMode && game.piece) hintCompute();
  delayUsed = false;                                    // 新的一行，缓期额度回来
  lastRiseAt = game.elapsed;

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
// 死因说人话。「锁在隐藏区」「出生撞死」这种词玩家看不懂区别，
// 而这两种死法其实要改的东西完全不一样。
const DEATH_TEXT = {
  '出生撞死':   '新方块出不来了',
  '锁在隐藏区': '方块摞出屏幕了',
  '灰线顶出':   '被灰线顶穿了',
  '灰线挤死':   '灰线把方块挤死了',   // 这个 key 一直缺，结算页死因显示空白
  '收手':       '见好就收',
};
let dieTimer = 0;

function endGame(why){
  // 死亡路径天然单次（调用点后面都 return），但「收手」是个用户能连点的按钮 ——
  // 连点两下就是 addTotal / countRush / plays++ 各跑两遍。
  if (game.over) return;
  // 每日练习里顶出局不进结算页：算这一段的结果（热身就是这题重摆）
  if (drill && drillTopOut()) return;
  // 对战里被顶死 = 输；NES 的结束走它自己的（暂停页的「收手」也会走到这里）
  if (vs && vsTopOut()) return;
  if (nes){ if (!nes.over) nesOver(); return; }
  game.over = true;
  // FEVER 的视觉不能留到结算页 —— crazyReset 要等重开才跑，中间这段
  // 背景条纹会一直在动
  if (CRAZY && feverLeft > 0) feverEnd();
  // ZONE 也一样：正在 ZONE 里死掉的话，底部那几行死行要先结算掉，
  // 否则这局的奖金凭空消失、body.zoning 还会一直挂着
  if (CRAZY) zoneEnd('');
  game.why = why || '?';
  game.piece = null;
  game.paused = false;              // 收手是从暂停页进来的，不复位的话状态会打架
  // 把限时机制的瞬态收干净 —— 它们原本靠「下一局 crazyReset」清，
  // 但那是**重开之后**。中间这段结算页上，梭哈面板会一直挂着，
  // 而 #betFlash 是 role=button 且绑了点击：在结算页上点它还能真的接梭哈。
  if (CRAZY){
    betOffer = 0; betLeft = 0; betShow = 0; betHide();
    evActive = null; evPending = null; evLeft = 0; evWarnLeft = 0;
    delete document.body.dataset.ev;
    const ew = $('evwarn'); if (ew) ew.classList.remove('on');
    syncGarbageWarn(-1);
    document.body.classList.remove('burning');
  }
  particles.length = 0;
  sweeps.length = 0;
  rings.length = 0;
  trails.length = 0;
  squash = null;
  staticDirty = true;
  needsDraw = true;
  clearSave();
  cancelAnimationFrame(rafId);
  // 两条梯子都要在记账之前取一次旧值，才判得出这一局升没升
  const prevRank = rankOf(readBest());        // 「最强」看单局最高分
  const prevCareer = careerOf(readTotal());   // 「段位」看累计总分
  // 练习局一个字都不写：最高分、累计、今日、狂欢局保底计数全部跳过。
  // 练习是可以无限撤销、可以指定出块的，它的分数不能和正经局放一个榜上。
  // 中途开局的分数里有一截是「按你的平均水平估出来」送的，不进最高分
  if (!assisted() && !mid && !(game.run && game.run.aidTs) && game.score > game.best){ game.best = game.score; writeBest(game.best); }
  if (CRAZY && !assisted()) addTotal(game.score);
  if (CRAZY && !assisted()){
    // 有效局才推进狂欢局的计数、才算今日一局 —— 秒死重开刷不出狂欢局，
    // 也压不低门槛。最佳分不设门槛：打出来了就是打出来了。
    // 收手走的是更高的门槛。isRealRun() 是 30 块 / 60 秒 —— 那个口径对
    // 「死了」是合理的（你确实打完了），但对「主动收手」就是个后门：
    // 「开局 → 落 30 块 → 收手」一分钟一轮，既攒狂欢局保底、又把今日局数
    // 刷上去（今日局数每 10 局把保底门槛降一格）。分数全额计入没问题，
    // 那块不存在刷分动机；但这两个计数必须挡住。
    const real = game.why === '收手' ? isStopRun() : isRealRun();
    if (real && !FORCE_RUSH) countRush();   // 测试模式不推进保底计数
    const d = readDaily();          // readDaily 自己会判断是不是还是同一天
    if (real) d.plays++;
    if (real) pushRecent(game.score);   // 只有走到 endGame 才记，中途重开不算
    if (game.score > d.best) d.best = game.score;
    writeDaily(d);
  }
  // 标题写死是「堆到顶了」，收手局那是字面意义上的说谎
  const h2 = $('overTitle');
  if (h2) h2.textContent = game.why === '收手' ? '收手了' : '堆到顶了';
  const gl = $('overGoal');
  if (gl){
    const on = CRAZY && goalNow > 0;
    gl.hidden = !on;
    if (on) gl.textContent = goalHit ? '过线了　目标 ' + fmtScore(goalNow)
                                     : '差一点　目标 ' + fmtScore(goalNow);
    gl.classList.toggle('hit', goalHit);
  }
  $('overScore').textContent = groupInt(game.score);
  $('overLines').textContent = game.lines;
  $('overLevel').textContent = game.level;
  $('overBest').textContent = groupInt(game.best);
  // 清过档的话把旧规则下的纪录也摆出来 —— 个人小游戏里最高分就是全部的意义，
  // 光写进 localStorage 没人看得见等于没留
  const lg = readLegacy();
  $('legacyCell').hidden = !lg;
  if (lg) $('overLegacy').textContent = groupInt(lg);
  fillRunLog();
  fillReview();
  // 历史记录：正经局才记（练习 / 提示 / 对战 / NES 不记），门槛和「今日局数」一样，秒死重开不算
  if (!assisted() && (mid ? midPlayed() : game.why === '收手' ? isStopRun() : isRealRun())) histPush(histEntry());
  syncRank();
  $('overDied').textContent = DEATH_TEXT[game.why] || '';
  // 「最强」只在够得着的时候才提（低于第一档说什么都是扫兴）。
  // 升段要在 writeBest 之后判，拿旧的最高分和这一局比。
  const rk = $('overRank');
  if (rk){
    // 「最强」用这一局的分（够不着第一档就不显示，说什么都是扫兴），
    // 「段位」用记完账之后的累计分，所以它一旦入段就一直在。
    const now = CRAZY ? rankOf(game.score) : null;
    const car = CRAZY ? careerOf(readTotal()) : null;
    rk.hidden = !now && !car;
    if (!rk.hidden){
      const upR = now && (!prevRank || prevRank[0] < now[0]);
      const upC = car && (!prevCareer || prevCareer[0] < car[0]);
      const cell = (cls, name, lb, up) =>
        `<i class="${cls}${up ? ' up' : ''}"><b>${name}</b><span>${up ? '新' + lb : lb}</span></i>`;
      rk.className = 'overrank' + (upR || upC ? ' up' : '');
      rk.innerHTML = (now ? cell('best', now[1], '最强', upR) : '')
                   + (car ? cell('career', car[1], '段位', upC) : '');
      if (upR || upC){ sfx('level', 1.2); buzz([40, 30, 60]); }
    }
  }
  $('overlay').dataset.mode = 'over';

  // 死亡慢镜：结算页晚 700ms 再弹，中间让盘面褪色定住。
  // 以前是瞬间切到结算页，你还没看清自己怎么死的就结束了 —— 输也该有重量。
  cancelAnimationFrame(rafId);
  rafId = 0;              // 不清零的话 resumeLoop 的 if (!rafId) 之后拉不起循环
  clearTimeout(dieTimer);
  document.body.classList.add('dying');
  dieTimer = setTimeout(() => {
    document.body.classList.remove('dying');
    $('overlay').classList.add('show');
  }, 700);
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
    // 存下 CSS 尺寸给 drawPreview 用：它画的时候再读 clientWidth，同一帧里前面刚写过
    // 分数/行数的 DOM，读一下就是一次强制重排（实测它是普通局第二耗时的函数）
    cv._w = r.width; cv._h = r.height;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // 对战右栏的机器人小窗（标准版才有）
  const vc = $('vsCv');
  if (vc){
    const r = vc.getBoundingClientRect();
    vc._w = r.width; vc._h = r.height;
    vc.width = Math.round(r.width * dpr); vc.height = Math.round(r.height * dpr);
    vc.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    if (vs) vsDrawBot();
  }
  draw();
}

// 另画的几种画法。都只用填充 / 描边 / 渐变，不逐帧加滤镜：盘面是缓存进 bgCv 的，只有当前块每帧重画
function drawKind(c, kind, x, y, d, R, color){
  const lite = mix(color, '#ffffff', .45), dark = mix(color, '#05080f', .45);
  if (kind === 'bevel'){                     // 立体：左上亮、右下暗的斜面，中间本色（街机 / 主机最常见的那种）
    const b = Math.max(2, d * .16);
    c.fillStyle = dark; c.fillRect(x, y, d, d);
    c.fillStyle = lite;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + d, y); c.lineTo(x + d - b, y + b); c.lineTo(x + b, y + d - b); c.lineTo(x, y + d); c.closePath(); c.fill();
    c.fillStyle = color; c.fillRect(x + b, y + b, d - b * 2, d - b * 2);
    return;
  }
  if (kind === 'gloss'){                     // 玻璃：上亮下暗的渐变 + 上半一道高光
    const g = c.createLinearGradient(0, y, 0, y + d);
    g.addColorStop(0, mix(color, '#ffffff', .25)); g.addColorStop(.55, color); g.addColorStop(1, mix(color, '#05080f', .3));
    c.fillStyle = g; roundRect(c, x, y, d, d, R); c.fill();
    c.globalAlpha *= .38; c.fillStyle = '#ffffff';
    roundRect(c, x + d * .12, y + d * .08, d * .76, d * .34, R * .8); c.fill();
    return;
  }
  if (kind === 'gem'){                       // 宝石：中心亮、四周暗的放射渐变 + 一道细边
    const g = c.createRadialGradient(x + d * .38, y + d * .34, d * .05, x + d / 2, y + d / 2, d * .72);
    g.addColorStop(0, mix(color, '#ffffff', .6)); g.addColorStop(.45, color); g.addColorStop(1, mix(color, '#05080f', .5));
    c.fillStyle = g; roundRect(c, x, y, d, d, R); c.fill();
    c.strokeStyle = mix(color, '#ffffff', .3); c.lineWidth = Math.max(1, d * .05);
    roundRect(c, x + c.lineWidth / 2, y + c.lineWidth / 2, d - c.lineWidth, d - c.lineWidth, R); c.stroke();
    return;
  }
  if (kind === 'nes'){                       // 红白机：方格、黑缝，左上角一个白色反光点
    c.fillStyle = color; c.fillRect(x, y, d, d);
    const p = Math.max(1, d * .13);
    c.fillStyle = '#ffffff';
    c.fillRect(x + p * .6, y + p * .6, p, p);
    c.fillRect(x + p * 1.6, y + p * 1.6, p * 1.4, p * .9);
    c.fillRect(x + p * 1.6, y + p * 1.6, p * .9, p * 1.4);
    return;
  }
  if (kind === 'gb'){                        // 掌机：一圈深色外框、本色内芯、中间一个深色小方块（Game Boy 那种回字格）
    c.fillStyle = dark; c.fillRect(x, y, d, d);
    const b = Math.max(1.5, d * .14);
    c.fillStyle = color; c.fillRect(x + b, y + b, d - b * 2, d - b * 2);
    const q = d * .3;
    c.fillStyle = mix(color, '#05080f', .3); c.fillRect(x + (d - q) / 2, y + (d - q) / 2, q, q);
    return;
  }
  if (kind === 'hollow'){                    // 空心：只描边，芯里一点点底色
    const lw = Math.max(1.5, d * .13);
    c.globalAlpha *= 1; c.fillStyle = mix(color, '#0a1020', .82); roundRect(c, x, y, d, d, R); c.fill();
    c.strokeStyle = color; c.lineWidth = lw;
    roundRect(c, x + lw / 2, y + lw / 2, d - lw, d - lw, Math.max(0, R - lw / 2)); c.stroke();
    return;
  }
  if (kind === 'flat'){                      // 方砖：纯色直角、细缝，堆起来是一整面墙
    c.fillStyle = color; c.fillRect(x, y, d, d);
    return;
  }
  if (kind === 'neon'){                      // 霓虹光：暗芯 + 发光的边
    c.fillStyle = mix(color, '#0a1020', .78); roundRect(c, x, y, d, d, R); c.fill();
    c.shadowColor = color; c.shadowBlur = d * .35;
    c.strokeStyle = mix(color, '#ffffff', .15); c.lineWidth = Math.max(1.5, d * .09);
    roundRect(c, x + c.lineWidth / 2, y + c.lineWidth / 2, d - c.lineWidth, d - c.lineWidth, Math.max(0, R - c.lineWidth / 2)); c.stroke();
    c.shadowBlur = 0;
    return;
  }
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
    // 落点影子是转完再落底时唯一能确认「会落到哪」的东西：原来 .40/.07 在手机
    // 亮度下几乎看不见，转一下（I 会挪一列）就看不出落点变了。
    c.globalAlpha = alpha * .58;
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, d * .075);
    roundRect(c, x + 1, y + 1, d - 2, d - 2, R);
    c.stroke();
    c.globalAlpha = alpha * .14;
    c.fillStyle = color;
    c.fill();
    c.restore();
    return;
  }

  if (garbage){
    // 底部顶上来的灰线：虚线框 + 灰色填充，一眼能和自己的方块分开。
    // 填充从 .30 提到 .52 —— 原来太淡，一片灰线看着是空心的，盘面显得稀。
    // 能和自己的方块分开靠的是「灰色 + 虚线框」，不靠它透明。
    c.fillStyle = 'rgba(150,170,205,.52)';
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

  if (v.kind) drawKind(c, v.kind, x, y, d, R, color);
  else {
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
const HEAT_EDGE = '#ff6a3c';     // 热度把边框往这个色推
function syncEdge(){
  const L = game.level;
  const t = clamp((Math.min(L, MAX_LEVEL) - 1) / (MAX_LEVEL - 1), 0, 1);
  // 等级定底色，热度定烈度，两者叠在同一组变量上。
  // 注意这里写的是内联样式 —— CSS 里再写一套 body[data-heat] #board 是压不过的，
  // 所以热度必须折进这个函数，不能单独走样式表。
  const h = CRAZY ? clamp((heatMult() - 1) / 12, 0, 1) : 0;
  let c = h > 0 ? mix(edgeColor(L), HEAT_EDGE, h) : edgeColor(L);
  // 燃点期间整圈往橙红推。必须在这里做 —— --au-ring / --bd-ring 是上面
  // 这几行用内联样式写的，CSS 里再写一套 body.burning .board-aura 压不过它。
  if (burnOn()) c = mix(c, BURN_EDGE, .75);
  // ZONE 同理，而且要排在燃点之后 —— ZONE 期间时间都停了，它该是最强的那个信号
  if (CRAZY && zoneLeft > 0) c = mix(c, ZONE_EDGE, .85);
  const st = canvas.style;
  st.setProperty('--bd-w',    (1 + t * 1.4 + h * 1.6).toFixed(2) + 'px');
  st.setProperty('--bd-ring', rgba(c, Math.min(.98, .18 + t * .52 + h * .28)));
  st.setProperty('--bd-glow', rgba(c, Math.min(.85, .09 + t * .30 + h * .28)));
  st.setProperty('--bd-blur', Math.round(38 + t * 46 + h * 40) + 'px');

  const over = Math.max(0, L - MAX_LEVEL);
  const box = canvas.parentElement;
  if (box) box.classList.toggle('maxed', L >= MAX_LEVEL);
  const aura = $('boardAura');
  if (aura){
    // 超出满级的每一级再亮一点点，让「还在变难」看得见
    aura.style.setProperty('--au-ring', rgba(c, .78));
    aura.style.setProperty('--au-glow', rgba(c, Math.min(.60, .32 + over * .02 + h * .2)));
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
      if (squash && squash.keys.has(y * COLS + x)) continue;   // 这几格由主画布带缩放画
      // 暗幕：只剩轮廓，逼你记棋盘。走 ghost 那套画法，不另写一份。
      // 练习不涨灰线，盘面上的 X 全是关卡预置的格子 —— 按实心方块画。虚线框是给
      // 普通局里「这是顶上来的灰线」用的，练习里只会显得空。颜色压到暗一档的石板灰：
      // 灰线那个浅灰画成实心太亮，会抢掉落点虚影和手上那块，槽的形状反而不突出。
      const preset = practice && t === GARBAGE;
      drawCell(bgCtx, x * CELL, (y - BUFFER) * CELL, CELL, preset ? PRESET_COLOR : colorOf(t),
               evBlackout() ? { ghost: true } : { garbage: t === GARBAGE && !preset });
    }
  }
  staticDirty = false;
}

function draw(){
  dbg.draws++;
  if (nes){ nesDraw(); return; }
  const W = CELL * COLS, H = CELL * ROWS;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  if (staticDirty) drawStatic();
  ctx.drawImage(bgCv, 0, 0, W, H);
  if (squash) drawSquash();

  if (clearing){
    // 消行动画分两段，总时长仍是 260ms，不延长冻结：
    //   0~140ms  要消的那几行盖白光（不重画整盘，只 fillRect 几条）
    //   140~260  上方整块往下滑到位，消掉的行留空
    const FLASH_MS = 140;
    if (clearing.t < FLASH_MS){
      const flash = 1 - clearing.t / FLASH_MS;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = clearing.color
        ? rgba(clearing.color, .12 + (.24 + clearing.power * .035) * flash)
        : `rgba(255,255,255,${(.10 + .30 * flash).toFixed(3)})`;
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

  drawHintReveal(ctx);
  if (vs) vsDrawIncoming(ctx);
  // 落点虚影 + 当前方块
  const p = game.piece;
  if (p && !game.over){
    const color = colorOf(p.type);
    let gy = p.y;
    while (!collides(p.type, p.x, gy + 1, p.rot)) gy++;
    if (gy !== p.y && !evBlind()){                   // 重影：这几秒没有落点虚影
      for (const [cx, cy] of cellsOf(p.type, p.rot)){
        const by = gy + cy;
        if (by < BUFFER) continue;
        drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, color, { ghost: true });
      }
    }
    drawHint(ctx, cellsOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, gy + cy]));
    drawAids(ctx);
    // 快锁定的提示：以前是整块洗白，颜色全丢了，现在改成同色光边
    const lockPulse = grounded ? Math.min(4, (lockTimer / lockDelay() * 5) | 0) / 4 : 0;
    // 变异块：本色往对应色里混七成 + 常驻亮边，一眼认得出是哪种
    const tint = CRAZY && p.mod ? MOD_TINT[p.mod] : null;
    const gold = !!tint;
    const pc = tint ? mix(color, tint, .72) : color;
    const cells = cellsOf(p.type, p.rot);
    for (const [cx, cy] of cells){
      const by = p.y + cy;
      if (by < BUFFER) continue;
      drawCell(ctx, (p.x + cx) * CELL, (by - BUFFER) * CELL, CELL, pc,
               { glow: Math.max(lockPulse, gold ? .55 : 0) });
    }
    // 图标画在格子之后，且只在整块都露出隐藏区时画 —— 半截在上面时画出来是悬空的
    if (p.mod && cells.every(([, cy]) => p.y + cy >= BUFFER))
      modIconOn(ctx, cells, p.x * CELL, (p.y - BUFFER) * CELL, CELL, 0, 0, p.mod);
  }

  // 硬降拖尾：落点那端最浓，往起点方向渐隐到透明。
  // 通体一个亮度的话，画出来不是残影，是一根杵在盘面上的色棒。
  // 渐变的起点用同色零透明而不是 'transparent'——后者在部分浏览器里
  // 会经由透明黑插值，边上会浮一道脏边。
  for (const tr of trails){
    const a = Math.max(0, 1 - tr.t / TRAIL_MS);
    ctx.save();
    // 只留落点上方 6 格、调淡：原来从顶拉到底一整根，连着落几块会糊住盘面（看形状要看的正是那里）
    ctx.globalAlpha = a * .22;
    for (const [x, y0, y1] of tr.cells){
      const top = Math.max(y0, y1 - 6, BUFFER) - BUFFER;
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
  if (beams.length){
    for (const bm of beams){
      const k = bm.t / BEAM_MS;
      const g = ctx.createLinearGradient(0, 0, 0, ROWS * CELL);
      g.addColorStop(0, rgba('#7cf4ff', 0));
      g.addColorStop(.5, rgba('#7cf4ff', .85 * (1 - k)));
      g.addColorStop(1, rgba('#7cf4ff', 0));
      ctx.save();
      ctx.fillStyle = g;
      const w = CELL * (1 - k * .5);
      ctx.fillRect(bm.x * CELL + (CELL - w) / 2, 0, w, ROWS * CELL);
      ctx.restore();
    }
  }
  if (CRAZY && embers.length) drawEmbers();
  if (sweeps.length || rings.length || glows.length) drawFx();
  if (CRAZY && wallCol >= 0){
    // 封锁列：斜纹一片，和「这里不能放」这件事对得上
    ctx.save();
    ctx.globalAlpha = .30;
    ctx.fillStyle = '#ff5c6e';
    ctx.fillRect(wallCol * CELL, 0, CELL, ROWS * CELL);
    ctx.globalAlpha = .55;
    ctx.strokeStyle = '#ffd0d6';
    ctx.lineWidth = Math.max(1, CELL * .05);
    ctx.beginPath();
    for (let y = -CELL; y < ROWS * CELL; y += CELL * .5){
      ctx.moveTo(wallCol * CELL, y);
      ctx.lineTo(wallCol * CELL + CELL, y + CELL);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (CRAZY) drawCracks();
  syncRainMark();
  // 挪列选中的那一列：描边 + 轻微提亮，和危险带、封锁墙都区分得开
  if (swapSel >= 0 && CELL){
    ctx.save();
    ctx.fillStyle = 'rgba(159,180,208,.14)';
    ctx.fillRect(swapSel * CELL, 0, CELL, ROWS * CELL);
    ctx.strokeStyle = 'rgba(159,180,208,.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(swapSel * CELL + 1, 1, CELL - 2, ROWS * CELL - 2);
    ctx.restore();
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
  if (nes) return nesDrawPreview();
  // layout() 还没量到（样式没到位）时退回现读
  const nw = nextCv._w || nextCv.clientWidth, nh = nextCv._h || nextCv.clientHeight;
  nextCtx.clearRect(0, 0, nw, nh);
  if (!nw || !nh) return;

  // 上面一整行放马上要来的那个，下面并排放之后的两个
  const topH = Math.round(nh * 0.54);
  const botH = nh - topH;
  // 提示模式只给看 1 个 NEXT（推荐也只拿它算），占满整个框
  // 提示模式原来只给看 1 个 NEXT；现在和普通局一样看 3 个（练的就是普通局）
  if (game.queue[0]) drawMini(nextCtx, game.queue[0], 0, 0, nw, topH, 1, game.mods[0]);
  if (game.queue[1]) drawMini(nextCtx, game.queue[1], 0, topH, nw / 2, botH, .62, game.mods[1]);
  if (game.queue[2]) drawMini(nextCtx, game.queue[2], nw / 2, topH, nw / 2, botH, .62, game.mods[2]);
  dbg.previews = [0, 1, 2].filter(i => game.queue[i]).length;

  // hold
  const hw = holdCv._w || holdCv.clientWidth, hh = holdCv._h || holdCv.clientHeight;
  holdCtx.clearRect(0, 0, hw, hh);
  if (game.hold) drawMini(holdCtx, game.hold, 0, 0, hw, hh, game.holdUsed ? .28 : 1, game.holdMod);
  else drawHoldHint(holdCtx, hw, hh);
}

function drawMini(c, type, ox, oy, w, h, alpha, mod){
  const def = PIECES[type];
  const cells = def.states[0];
  const xs = cells.map(v => v[0]), ys = cells.map(v => v[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const cell = Math.min(w / (bw + 1.1), h / (bh + 1.0));
  const px = ox + (w - bw * cell) / 2;
  const py = oy + (h - bh * cell) / 2;
  const tint = CRAZY && mod ? MOD_TINT[mod] : null;
  const mcolor = tint ? mix(colorOf(type), tint, .72) : colorOf(type);
  for (const [cx, cy] of cells){
    drawCell(c, px + (cx - minX) * cell, py + (cy - minY) * cell, cell, mcolor, { alpha });
  }
  if (CRAZY && mod && alpha > .5) modIconOn(c, cells, px, py, cell, minX, minY, mod);
  // 变异角标。光靠染色不够：七种方块本色里，O 是黄、Z 是红、I 是青、T 是紫，
  // 正好把金/炸弹/激光/重锤四种染色各撞掉一个 —— 撞上就跟普通块长得一样。
  // 落下的那块有辉光圈能区分，预览里没有，所以这里补一个点。
  if (tint){
    const r = Math.max(2.5, cell * .26);
    const bx = px + bw * cell - r * .4, by = py + r * .4;
    c.save();
    c.globalAlpha = alpha;
    c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2);
    c.fillStyle = tint; c.fill();
    c.lineWidth = Math.max(1, r * .34);
    c.strokeStyle = 'rgba(255,255,255,.92)'; c.stroke();
    c.restore();
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

// ── 打击感（标准版）──
// 原来 1~3 行几乎一个样：单消不震，双消三消同一档小震，连击只升个音。
// 现在先算「这一下有多重」，所有反馈都按它加码：
//   行数为主（1/2/3/4 行 = 1/2/3.2/5），T 旋 +1.5、mini +.5，B2B +1，连击每连 +.5（封顶 +4），全消拉满
// 跟着它走的：震屏幅度、消除行闪光的颜色和亮度、往上扩散的柔光（两行起）、碎块多少和速度、
// 棋盘外框一闪（三行起 / 连击）、连击计数、震动、低音重击（三行起）。
// 全部只在消行那零点几秒里画；不加长消行停顿，规则和节奏一点不变。疯狂版走它原来那套。
function hitPower(n, spin, perfect, combo, b2b){
  if (perfect) return 10;
  let p = [0, 1, 2, 3.2, 5][Math.min(4, n)] || 0;
  if (spin === 'tspin') p += 1.5; else if (spin === 'mini') p += .5;
  if (b2b) p += 1;
  if (combo > 0) p += Math.min(4, combo * .5);
  return Math.min(10, p);
}
// 颜色：哪一种消除（白 / 青 / 紫 / 金 / 品红），连击 3 连起往橙、6 连起往红走
function hitColor(n, spin, combo){
  if (combo >= 5) return '#ff5a5a';
  if (combo >= 2) return '#ff9f43';
  if (spin === 'tspin' || spin === 'mini') return '#ff6bd6';
  return ['#ffffff', '#dff6ff', '#7fe3ff', '#c9a6ff', '#ffd166'][Math.min(4, n)];
}
const REDUCED_MOTION = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
let lastHit = 0;
// 往上扩散的柔光 { y（消除带上沿，像素）, h（消除带高）, color, p, t }。
// 原来是两道往上下推开的硬线 + 中间一层底色：消行几乎总在底部，往下那道一出来就被切掉，
// 只剩一条横线和一个框，看着像显示出错（用户嫌难看）。现在整片都是渐变，上沿完全透明，没有线也没有框
let glows = [];
const GLOW_MS = 420;    // 这一次消行的打击力度（lockPiece 拿它定碎块多少、闪光多亮）
function hitFx(n, spin, perfect, b2b){
  const combo = Math.max(0, game.combo);
  const p = hitPower(n, spin, perfect, combo, b2b);
  const color = hitColor(n, spin, combo);
  // 震屏：幅度和时长都按力度连续变（单消约 2px 轻磕，四消 6px，连击 / B2B 再往上）
  const el = $('shaker');
  if (el && !REDUCED_MOTION){
    el.style.setProperty('--sh', (1 + p * .95).toFixed(1) + 'px');
    el.style.setProperty('--sh-ms', Math.round(160 + p * 26) + 'ms');
    el.classList.remove('shake', 'shake-big', 'hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }
  // 柔光：两行起 / T 旋 / 3 连起
  if ((n >= 2 || combo >= 2 || spin) && lastClearRows.length){
    const top = Math.max(BUFFER, Math.min(...lastClearRows)), bottom = Math.max(...lastClearRows);
    if (bottom >= BUFFER){
      glows.push({ y: (top - BUFFER) * CELL, h: (bottom - top + 1) * CELL, color, p, t: 0 });
      while (glows.length > 2) glows.shift();
    }
  }
  // 外框一闪：三行起或连击
  const hb = $('boardHit');
  if (hb && p >= 3){
    // 颜色变了才重设：光晕是一大圈模糊，改一次颜色就要整块重新栅格化
    if (hb._c !== color){ hb._c = color; hb.style.setProperty('--hit-c', color); }
    hb.style.setProperty('--hit-a', Math.min(1, .35 + p * .08).toFixed(2));
    hb.classList.remove('on'); void hb.offsetWidth; hb.classList.add('on');
  }
  // 连击计数：第 2 连起单独弹一个，越连越大
  if (combo >= 1 && CELL){
    const k = combo + 1;
    popScore(CELL * COLS / 2, CELL * ROWS * .2, k + ' 连', 'COMBO', 'combo' + (combo >= 5 ? ' c3' : combo >= 2 ? ' c2' : ''),
             Math.min(1.9, 1 + combo * .12));
  }
  // 震动：节奏跟着行数，连击再加一下
  const v = n >= 4 ? [30, 40, 80] : n === 3 ? [24, 30, 30] : n === 2 ? [22] : [12];
  if (combo >= 2) v.push(30, Math.min(60, 20 + combo * 6));
  buzz(v);
  // 低音重击：三行起
  if (n >= 3 || perfect) sfx('drop', n >= 4 ? .5 : .62);
  return p;
}

// per：每格几颗；spd：速度倍率（标准版按打击力度给，疯狂版用默认）
function burstRow(y, per = 2, spd = 1){
  if (y < BUFFER) return;
  for (let x = 0; x < COLS; x++){
    const t = game.board[y][x];
    const color = t ? colorOf(t) : '#ffffff';
    for (let i = 0; i < per; i++){
      particles.push({
        x: (x + .5) * CELL,
        y: (y - BUFFER + .5) * CELL,
        vx: (rndFx() - .5) * 220 * spd,
        vy: (rndFx() - .5) * 160 * spd,
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

// 全消：整局可能一次都打不出来的东西，值得一套独占表现。
// 原来它和四行共用金色扫光 + 同一档震屏，玩家根本分不出来。
// 四层叠加：整屏白闪 → 全盘自下而上双色扫光 → 中心爆环 → 飘字（走 pop
// 通道不走 toast，toast 是共享的，紧接着一个 FEVER 就把它顶没了）。
function perfectFx(){        // 不吃落点 y —— 飘字位置是写死的 CELL*ROWS*.42
  const el = $('board');
  if (el){ el.classList.remove('flash-big'); void el.offsetWidth; el.classList.add('flash-big'); }
  const all = [];
  for (let y = BUFFER; y < TOTAL_ROWS; y++) all.push(y);
  sweepRows(all, '#ffffff');
  sweepRows(all, '#7cf4ff');
  burstRing(all, '#ffffff');
  if (CELL) popScore(CELL * COLS / 2, CELL * ROWS * .42, '全消', 'PERFECT CLEAR', 'perfect', 1.5);
  sfx('tetris', 1.5); sfx('level', 2.0);
  buzz([60, 40, 60, 40, 120]);
}

// 破纪录：刷分游戏里情绪最高的一下，原来只有一句 showToast ——
// 而它在对局中途触发，那时 toast 正被消行 / FEVER / 里程碑轮流占用。
// 改成在分数格本身做文章（那才是玩家盯着的地方）+ 飘字 + 独立音。
function recordFx(){
  const box = $('score') && $('score').parentElement;
  if (box){ box.classList.remove('record'); void box.offsetWidth; box.classList.add('record'); }
  if (CELL) popScore(CELL * COLS / 2, CELL * ROWS * .22, '破纪录', 'NEW BEST', 'record', 1.2);
  sfx('level', 1.7); buzz([40, 30, 40, 30, 90]);
  showToast('破纪录！');
}

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
  for (let i = glows.length - 1; i >= 0; i--)
    if ((glows[i].t += dt) > GLOW_MS) glows.splice(i, 1);
  if (sweeps.length || rings.length || glows.length) needsDraw = true;
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
  // 柔光：从消除带往上漫开一片渐变，越往上越淡、最上沿完全透明；力度越大漫得越高越亮。
  // 消除带本身也蒙一层，往下不画（底下就是盘底，画了也会被切成一条边）
  for (const g of glows){
    const k = g.t / GLOW_MS, e = 1 - (1 - k) * (1 - k);
    const rise = CELL * (2 + g.p * 1.5) * (.35 + .65 * e);
    const a = (.32 + g.p * .045) * (1 - k);
    const y0 = g.y - rise, y1 = g.y + g.h;
    const grd = ctx.createLinearGradient(0, y0, 0, y1);
    grd.addColorStop(0, rgba(g.color, 0));
    grd.addColorStop(.55, rgba(g.color, a * .55));
    grd.addColorStop(1, rgba(g.color, a));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grd;
    ctx.fillRect(0, Math.max(0, y0), W, y1 - Math.max(0, y0));
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
  // 上限 140：标准版四消每格 3 颗正好 120；再多就挤掉最早的那些
  if (particles.length > 140) particles.splice(0, particles.length - 140);
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

// 本局的目标分和过没过。goalNow 开局算一次就定住 —— 它依赖 game.rush，
// 而 rush 整局不变；每帧重算要读 localStorage，没必要。
let goalNow = 0, goalHit = false;

function goalCheck(){
  if (!CRAZY || goalHit || goalNow <= 0 || game.over) return;
  if (game.score < goalNow) return;
  goalHit = true;
  if (CELL) popScore(CELL * COLS / 2, CELL * ROWS * .18, '过线', '今天的目标', 'goal', 1.15);
  sfx('level', 1.45); buzz([30, 20, 30, 20, 60]);
}

function syncGoal(){
  const el = $('goalLine');
  if (!el) return;
  el.hidden = !(CRAZY && goalNow > 0);
  const b = $('goalVal');
  if (b) b.textContent = fmtScore(goalNow);
}

// 不计最高分的局（练习 / 提示 / T 旋练习 / 每日练习 / 中途开局 / 开过标 T 槽）不显示 BEST：
// 原来照挂着「BEST 0」，中途开局 15 万分旁边一个 0，看着像出了 bug
function syncBestBox(){
  const no = !CRAZY && (assisted() || !!mid || !!(game.run && game.run.aidTs));
  const a = $('best'), b = $('overBest');
  if (a && a.parentElement.hidden !== no) a.parentElement.hidden = no;
  if (b && b.parentElement.hidden !== no) b.parentElement.hidden = no;
  // 结束了就把提示细栏收起来：原来旧推荐和「先自己找 / 规则」还挂在结算页上下
  document.body.classList.toggle('gameover', !!game.over);
}
function syncHud(){
  goalCheck();
  // 破纪录：和过线一样放这里，因为分数有三个增长入口
  if (CRAZY && !bestBeaten && game.best > 0 && game.score > game.best && !game.over){
    bestBeaten = true; recordFx();
  }
  // 这两个跟分数无关（堆高、连击断掉都不改分），不能挡在下面的缓存早退后面
  syncStreak();
  syncDanger();
  syncBestBox();
  const key = game.score + '/' + game.lines + '/' + game.level + '/' + game.best;
  if (key === hudCache) return;         // 每帧写 DOM 很浪费
  hudCache = key;
  rollScore(false);
  setStat($('lines'), String(game.lines));
  setStat($('level'), String(game.level));
  setStat($('best'), fmtScore(game.best));
  syncPace();
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
// 热度可视化：一个常驻徽章报当前倍率，外加整体视觉跟着热度分档变。
// 玩家全程盯着一个数字，那个数字能飙到自己都害怕 —— 这是疯狂版的主轴。
let heatTier = -1, heatQuant = -1;
// ── 状态格 ──
// 三槽固定。优先级：事件 > FEVER > 狂欢 > 热度 —— 满了就砍最后一条。
// 瞬发事件（地震/压实/冰冻）没有时长，给它闪 FX_FLASH 毫秒表示「刚发生过」。
//
// 每帧都重排 DOM 会毁掉帧时间，所以这里只在「内容真的变了」时才写：
// 把要显示的东西压成一个字符串指纹，跟上次比，一样就直接 return。
// 进度条的宽度不进指纹 —— 它走 transform，单独更新，代价可以忽略。
const FX_FLASH = 1500;
let flashFx = null, flashLeft = 0, fxSig = '';

function flashEvent(e){
  if (!CRAZY || !e) return;
  flashFx = e; flashLeft = FX_FLASH;
}

function fxRows(){
  const out = [];
  // 同一时刻**最多一个**可点的行。
  //
  // 侧栏只有 64px 宽、三个槽，同时冒出「ZONE 启动」和「缓期」两个按钮之后
  // 玩家的反应是「不知道展示什么，也不知道要不要点击」—— 两个并排的号召
  // 等于没有号召。优先级按「不点会亏多少」排：
  //   梭哈十秒就过期、ZONE 要攒二十行、缓期每行灰线都有机会。
  let actioned = false;
  const act = (row) => { if (actioned) return; actioned = true; out.push(row); };
  // 待接受的梭哈排在最前，而且带一个真按钮 —— 它是唯一要你当场动手的东西。
  // v 写固定文案不写倒计时：倒计时交给下面那根条，否则每帧都在重建 innerHTML。
  if (betOffer > 0){
    // 只写上限不写区间：侧栏 64px 放不下「梭哈 ×1.6~4」，会被截成「梭… ×1.6…」。
    // 完整档位表盘面横幅上有，那才是讲规则的地方。
    act({ n: '梭哈', v: '最高 ×' + BET_TIERS[BET_TIERS.length - 1][1],
          k: 'betoffer', p: betOffer / BET_MS, go: '接受' });
  }
  // 梭哈排第一：它是唯一有硬时限、且要你当场做事的东西
  if (betLeft > 0){
    // 名字 + 行数 + 秒数 + 倍率四样塞不进 64px —— 实测被截成「梭… 10.0s…」，
    // 把「消了几行」和「在哪一档」这两个决定要不要拼命的量全吃了。
    // 秒数让给下面那根进度条（它本来就在计时），数字位只留「几行 / 上限」。
    out.push({ n: '梭哈', v: betLines + '/' + BET_CAP,
               k: 'betrow', p: betLeft / BET_MS });
  }
  // ZONE 进行中排在事件之前：它有硬时限，而且你正靠它做决定
  // 侧栏只有 64px 宽，名字 + 行数 + 秒数三样塞不下，会被截成「ZO… 5行 1…」。
  // 秒数让给那根进度条（它本来就在表时间），数字位留给行数 ——
  // 奖金是按行数**平方**给的，k 是唯一要你当场做决定的量。
  if (zoneLeft > 0) out.push({ n: 'ZONE', v: zoneRows + '行',
                               k: 'zone', p: zoneLeft / ZONE_MS });
  // ZONE 攒条：只报进度，不给按钮（攒满自己开）
  else if (zoneCharge > 0) out.push({ n: 'ZONE', v: zoneCharge + '/' + zoneNeed(),
                                      k: 'zoneon', p: zoneCharge / zoneNeed() });
  if (evActive) out.push({ n: evActive.name, v: (evLeft / 1000).toFixed(1) + 's',
                           k: evActive.bad ? 'bad' : 'good', p: evLeft / evActive.ms });
  else if (flashLeft > 0 && flashFx) out.push({ n: flashFx.name, v: '已发生',
                           k: flashFx.bad ? 'bad' : 'good', p: flashLeft / FX_FLASH });
  if (burnLeft > 0) out.push({ n: '燃点', v: '×' + BURN_MULT, k: 'burn',
                               p: burnLeft / (game.rush ? BURN_MS_RUSH : BURN_MS) });
  if (feverLeft > 0) out.push({ n: 'FEVER', v: '×' + FEVER_MULT, k: 'fev', p: feverLeft / FEVER_MS });
  if (game.rush) out.push({ n: '狂欢', v: '×' + RUSH_MULT, k: 'rush' });
  // 缓期排在狂欢之后、热度之前：它要你动手，但没有硬时限（最差就是灰线照常上来），
  // 所以优先级低于梭哈和所有限时效果。
  // 缓期：危险区里自动付，所以这里只是告诉你「它在待命」，不是号召你点
  if (canDelay()) out.push({ n: '缓期', v: '待命', k: 'delay',
                             p: 1 - (garbagePeriod() - garbageTimer) / DELAY_WIN });
  // 右侧显示热度值本身，左上角徽章显示倍率 —— 两处各管一个，不重复。
  // 原来两处都是倍率，热度这个被反复提到的数字一处都看不见，
  // 结果就是没人（包括我自己）说得清自己打到过多少热度。
  out.push({ n: '热度', v: String(Math.round(heat)), k: 'heat' });
  // 带按钮的那一行实际占两格的高度（按钮自己就 26px），却一直按一格算 ——
  // 实测梭哈待接时整个框从 93px 涨到 130px，向上顶出侧栏 20px，
  // 「状态」标题会钻到顶栏按钮后面、底下的「段位」被挤出屏幕。
  // 所以有按钮时就只给两行。
  return out.slice(0, out.some(r => r.go) ? 2 : 3);
}

function syncFx(){
  if (!CRAZY) return;
  const box = $('fxBox');
  if (!box) return;
  box.hidden = false;
  const rows = fxRows();
  box.classList.toggle('acting', rows.some(r => r.go));
  const sig = rows.map(r => r.n + r.v + r.k).join('|');
  if (sig !== fxSig){
    fxSig = sig;
    for (let i = 0; i < 3; i++){
      const el = $('fxs' + i), r = rows[i];
      if (!el) continue;
      el.className = 'fxs' + (r ? ' ' + r.k : '');
      el.innerHTML = r
        ? `<div class="fxl"><b class="fxn">${r.n}</b><b class="fxv">${r.v}</b></div>`
          + (r.go ? `<button class="fxgo" type="button" data-act="${r.act || 'bet'}">${r.go}</button>` : '')
          + (r.p == null ? '' : '<span class="fxbar"><i></i></span>')
        : '';
    }
  }
  // 条每帧更新，但只写 transform
  for (let i = 0; i < 3; i++){
    const r = rows[i];
    if (r == null || r.p == null) continue;
    const bar = $('fxs' + i).querySelector('.fxbar i');
    if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, r.p)).toFixed(3) + ')';
  }
}

// 任何改动热度的地方最后都会走到 syncHeat / crazyStep，所以地板只钉这两处。
function heatClamp(){ if (CRAZY && heat < HEAT_FLOOR) heat = HEAT_FLOOR; }

function syncHeat(){
  heatClamp();
  if (!CRAZY) return;
  const el = $('badgeHeat');
  if (!el) return;
  const m = heatMult();
  if (game.run && m > game.run.peak) game.run.peak = m;
  const on = m >= 1.15 && !game.over;
  el.classList.toggle('on', on);
  if (on) el.textContent = '×' + m.toFixed(1);
  // 分档改 data 属性，不逐帧写样式 —— 档位没变就什么都不做
  const t = !on ? 0 : m < HEAT_TIERS[0] ? 1 : m < HEAT_TIERS[1] ? 2
          : m < HEAT_TIERS[2] ? 3 : m < HEAT_TIERS[3] ? 4 : 5;
  if (t !== heatTier){
    heatTier = t;
    document.body.dataset.heat = t;
    el.dataset.tier = t;
    syncEdge();               // 边框的烈度跟着档位走
  }
  // 倍率是连续的，边框每档内部也该跟着走一点，但别逐帧写 —— 每 0.5 档更新一次
  const q = Math.round(m * 2);
  if (q !== heatQuant){
    heatQuant = q;
    syncEdge();
    syncTempo();
  }
}

function syncStreak(){
  syncHeat();
  syncReroll();
  const b2b = $('badgeB2B'), cmb = $('badgeCombo');
  if (!b2b || !cmb) return;
  const onB = !!game.b2b && !game.over;
  const onC = game.combo > 0 && !game.over;
  b2b.classList.toggle('on', onB);
  // 原来只有一个 combo>=5 的开关，连 5 次和连 15 次长得一样，
  // 连击这条线在 5 之后就没追求了。改成三段递进。
  const cb = game.over ? 0 : game.combo;
  document.body.classList.toggle('hotcombo',  cb >= 5  && cb < 10);
  document.body.classList.toggle('hotcombo2', cb >= 10 && cb < 15);
  document.body.classList.toggle('hotcombo3', cb >= 15);
  cmb.classList.toggle('on', onC);
  if (onC) cmb.textContent = 'COMBO ×' + game.combo;
}

// 危险警戒带：堆到距顶三行以内就亮。加滞回，免得在边界上抖。
let dangerOn = false;
const GWARN_MS = 3000;
let gwarnStep = -1;
function syncGarbageWarn(left){
  const el = $('gwarn');
  if (!el) return;
  const on = left >= 0 && left < GWARN_MS && !game.over;
  // 进度量化成 12 档再写，不然每帧都在写自定义属性
  const step = on ? Math.round((1 - left / GWARN_MS) * 12) : -1;
  if (step === gwarnStep) return;
  gwarnStep = step;
  el.classList.toggle('on', on);
  if (on) el.style.setProperty('--p', (step / 12).toFixed(3));
}

function syncDanger(){
  const el = $('danger');
  if (!el) return;
  const top = topFilledRow();
  const left = top < 0 ? 99 : top - BUFFER;
  dangerLeft = left;
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
// 过万换「万」：1.23万 / 12.34万 / 123.5万 / 3041万，过亿换「亿」：1.23亿。
//
// 小数位不是按档写死的，而是按「总长不超过 6 个字符」倒推 —— SCORE 框只有
// 56px，14px 字号下最多放得下 6 个字符，第 7 个就得把字号压到 11px 以下，
// 压到 10px 就没法看了。与其缩字号，不如少给一位小数。
// 边界也顺带兜住了：999,999 算出来是 99.9999，两位小数会进位成「100.00万」
// 变成 7 个字符，这个 while 会把它退成「100.0万」。
// 「80.00万」这种尾零白占两格，抹掉；但只抹小数尾巴，整数位的 0 不动
function trimZeros(t){
  if (t.indexOf('.') < 0) return t;
  return t.replace(/0+$/, '').replace(/\.$/, '');
}
// 整数千分位（任意大小）。全游戏只用这个，**一次都不调 toLocaleString**：浏览器的 Intl 是懒加载的，
// 第一次调用要初始化，4× 降频下实测卡 30~40ms —— 原来它躲在「每局第一次消行的得分飘字」里，
// 正好卡在最该爽的那一下。中文 / 英文环境下 toLocaleString 给的也都是逗号，输出一致。
function groupInt(v){
  const n = Math.round(v), t = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? '-' + t : t;
}
// 千分位手写，不用 toLocaleString：它每次都要走一遍 Intl，滚分动画每帧都调，
// 实测是普通局里最耗时的一个函数。这里只会出现 0~9999 的整数（再大就换万/亿），
// 逗号写死也和原来一致 —— 中文/英文环境下 toLocaleString 给的都是逗号。
function fmtScore(v){
  v = Math.round(v);
  if (v < 10000){
    if (v < 1000) return String(v);
    const r = v % 1000;
    return ((v / 1000) | 0) + ',' + (r < 10 ? '00' : r < 100 ? '0' : '') + r;
  }
  if (v >= 100000000) return trimZeros((v / 100000000).toFixed(2)) + '亿';
  const w = v / 10000;
  let d = w < 100 ? 2 : w < 1000 ? 1 : 0;
  let t = w.toFixed(d);
  while (t.length > 5 && d > 0) t = w.toFixed(--d);
  // 四舍五入进位到 10000 万就是 1 亿了，换个单位，顺带把「10000万」这个
  // 六字符又全是数字的最宽情况（61px > 56px 的框）消掉
  if (parseFloat(t) >= 10000) return trimZeros((v / 100000000).toFixed(2)) + '亿';
  return trimZeros(t) + '万';
}

// 按字数缩字号塞进框里。.stat b 没设 nowrap，放不下不是截省略号而是直接换行，
// 那一格的高度会从 16px 撑到 36px，整个侧栏跟着跳。
// 查表不量 DOM —— rollScore 是逐帧跑的，每帧读一次布局就是每帧一次强制重排。
const STAT_FIT = { 6: .90, 7: .76, 8: .66, 9: .58 };
function setStat(el, text){
  if (!el) return;
  // 滚分动画的后半段每帧取整后是同一个数，原来照样每帧写一遍 textContent 和 --fit
  if (el._stat === text) return;
  el._stat = text;
  el.textContent = text;
  // 字号档只跟字数有关，字数没变就别重设 —— 改 CSS 变量会让这一格重算样式
  const fit = STAT_FIT[Math.min(9, text.length)] || 1;
  if (el._fit !== fit){ el._fit = fit; el.style.setProperty('--fit', fit); }
}

const ROLL_MIN = 100;
function rollScore(snap){
  const el = $('score');
  if (!el) return;
  if (snap){ shownScore = game.score; setStat(el, fmtScore(shownScore)); return; }
  if (rollId) return;
  // 零头分（落底 / 软降那几分）直接跳过去，不滚：原来每落一块分数都要滚 20 来帧，
  // 每帧重写一次侧栏数字 —— 一直在打的时候，这比游戏本身还费渲染。消行的大分照旧滚
  if (game.score - shownScore < ROLL_MIN){ shownScore = game.score; setStat(el, fmtScore(shownScore)); return; }
  const tickRoll = () => {
    const d = game.score - shownScore;
    if (Math.abs(d) < 1){ shownScore = game.score; setStat(el, fmtScore(shownScore)); rollId = 0; return; }
    shownScore += d * .22;
    setStat(el, fmtScore(shownScore));
    rollId = requestAnimationFrame(tickRoll);
  };
  rollId = requestAnimationFrame(tickRoll);
}

// 高频彩蛋走这条。和事件/机制共用 toast，但自己节流 ——
// 一局要说好几句，挨着挤出来就成了刷屏。
let lastTip = -1e9;
function tip(text, minGap){
  const now = game.elapsed;
  // minGap 要用 == null 判而不是 ||：传 0 表示「这条不节流」，
  // 而 0 是 falsy，`minGap || 2600` 会把它变成 2600 —— 里程碑就是这么被自己吞掉的
  const gap = minGap == null ? 2600 : minGap;
  if (now - lastTip < gap) return false;
  lastTip = now;
  showToast(text);
  return true;
}

// ms 可选。默认 1100 是给「金块」「开箱」这种一眼就懂的短句用的；
// 修行要连效果一起报，一句带数字的描述读不完 —— 那边自己传时长。
function showToast(text, ms){
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;          // 重置动画
  // 动画时长也要改，光改定时器没用：keyframes 会 forwards 到 opacity:0，
  // class 还挂着但人早就看不见了
  el.style.setProperty('--toast-ms', (ms || 1100) + 'ms');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 1100);
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

// 曲速跟着热度连续走，不再是 FEVER 固定 ×1.22。
// 热度本来就是「你打得多猛」的读数，让耳朵也听得见它 ——
// 倍率越高鼓点越急，人会不自觉地跟着加速，然后失误。
function syncTempo(){
  if (!CRAZY || !musicOn || muted) return;
  let k = 1 + Math.min(.42, (heatMult() - 1) * .05);
  if (feverLeft > 0) k *= 1.12;
  setTempo(Math.round(baseBpm * k));
}

let musicOn = true;
let musicGain = null;     // 音乐总线，暂停时淡出
let mTimer = 0;           // 调度器
let mAt = 0;              // 下一个音符的绝对时间
let mIdx = 0;             // 走到旋律第几个音
let mBar = 0;             // 走到第几小节（给低音用）
let mBeat = 0;            // 当前小节内走了几个八分

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

let musicLP = null;       // 低通句柄，暗幕时扫下去把音乐压闷
function musicBus(){
  if (!musicGain){
    musicGain = actx.createGain();
    musicGain.gain.value = 0;
    // 方波直接出来太扎耳朵，过一道低通削掉高次谐波，剩下老掌机那种闷闷的味道
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    // 2000 太闷了，手机喇叭本来就放不出低频，再把高次谐波削光就什么都不剩。
    // 「不尖锐」靠的是下面那个 34ms 的慢起音，不是靠削高频。
    lp.frequency.value = LP_OPEN;
    lp.Q.value = .4;
    musicGain.connect(lp);
    lp.connect(actx.destination);
    musicLP = lp;
  }
  return musicGain;
}

const MUSIC_VOL = .75;          // 音乐总线的正常音量，musicStart 爬到这里
const LP_OPEN = 2600, LP_MUFFLE = 560;

// 大消除落地前把音乐掐掉一瞬，消除的那下再回来。老把戏，但它让四行的
// 冲击力翻倍 —— 静默本身就是一种响度。
function musicDuck(ms){
  if (!musicLP || !actx || !musicGain || !musicOn || muted) return;
  const t = actx.currentTime, s = ms / 1000;
  musicGain.gain.cancelScheduledValues(t);
  // 目标值用常量而不是读 .value：读的时候可能正卡在某条斜坡中间，
  // 读回来是个中间值，恢复之后音乐就再也回不到原音量了
  musicGain.gain.setValueAtTime(musicGain.gain.value, t);
  musicGain.gain.linearRampToValueAtTime(.0001, t + .018);
  musicGain.gain.setValueAtTime(.0001, t + s);
  musicGain.gain.linearRampToValueAtTime(MUSIC_VOL, t + s + .10);
}

// 心跳。频率压在 320Hz 以上 —— 手机外放放不出更低的，再「闷」也只是没声音。
function thump(vol){
  if (!actx || muted || actx.state !== 'running') return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(440, t);
  o.frequency.exponentialRampToValueAtTime(330, t + .09);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + .012);
  g.gain.exponentialRampToValueAtTime(.0001, t + .15);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + .17);
}

let heartTimer = 0, dangerLeft = 99;
function stepHeart(dt){
  if (!dangerOn || game.over || !game.started || muted){ heartTimer = 0; return; }
  heartTimer -= dt;
  if (heartTimer > 0) return;
  // 离顶越近跳得越快：还剩 3 行 ≈ 一秒一下，贴到顶 ≈ 每 0.42 秒一下
  const close = Math.max(0, 4 - dangerLeft);
  heartTimer = 1020 - close * 150;
  thump(.11);
  setTimeout(() => thump(.07), 155);     // lub-dub 的第二下
}
// 暗幕时把音乐闷下去。看不见方块已经够慌了，声音再一起蒙住，
// 那五秒的压迫感是加倍的 —— 一个滤波器参数换来的。
function setMuffle(on){
  if (!musicLP || !actx) return;
  const t = actx.currentTime;
  musicLP.frequency.cancelScheduledValues(t);
  musicLP.frequency.setValueAtTime(musicLP.frequency.value, t);
  musicLP.frequency.linearRampToValueAtTime(on ? LP_MUFFLE : LP_OPEN, t + (on ? .35 : .6));
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
// 后来热度那条直线和变异块浓度一起跑飞，倍率冲到 3.78；压完拐点和浓度
// 回到 2.52，又落回当初这个区间里了。
// 1/38 → 1/24。实测一局 299 行只出了 6 个金块，而它只在「这块自己锁下去
// 那一杆正好消行」时才兑现，打空的比例不低 —— 出现频率本来就该比别的
// 变异块高一档，它是纯加分、没有盘面效果，不会像炸弹激光那样改变局势。
const GOLD_RATE = 1 / 24;
// GOLD_MULT 已上移到 MOD_HELP 之前（那个字面量在模块初始化时就要用它）
const FEVER_MS = 20000;          // 一次 FEVER 多长（走 game.elapsed，不是墙钟）
const FEVER_MULT = 4;
const PITY_DIV = 55;             // 保底斜率：越小触发越勤
// FEVER 结束之后的冷静期。
//
// 实测 342 次消行里 **83% 都挂着 FEVER** —— 一个 ×4 的「爆发」八成时间都在，
// 那它就不是爆发，是一条藏起来的底薪：真实基线被悄悄抬高四倍，
// 而没有 FEVER 的那 9% 反而像在受罚。
//
// 调 PITY_DIV 治不好：FEVER 有**两个**来源，保底掷骰之外，宝箱还有 34% 开出它，
// 而宝箱挂在每条灰线上。把 PITY_DIV 提到 6 倍（320）实测也只从 77% 降到 56%。
// 冷却和来源无关，占空比有确定上限：20 /（20 + 45）≈ 31%。
const FEVER_COOL = 45000;
let feverCool = 0;
// 行雨（濒死豁免）已删：顶到顶就该死。留着复活机会一局怎么都收不住 ——
// 实测它一局买回三十多秒，而且让人敢往危险区赖。
// 事件的「濒死只发好事」还要用危险区这个判据，门槛留着。
const DANGER_ROW = 4;            // 堆顶到了这一行（含）算进危险区

// ── 热度 HEAT：疯狂版的核心 ──
// 一条不封顶的倍率条。消行往里注入热度，停手就按比例掉。
//
// 为什么要它：现在慢慢摆和飙着打拿一模一样的分，玩家没有任何理由冒险。
// 热度奖励「快」，而快就会失误，失误才有心跳。这是原来整套机制里缺的那一环
// —— 黄金和 FEVER 都是运气，你自己努力换不来。
//
// 不设上限是故意的：打得够猛它就该失控。实际会被衰减自然拉住，
// 平衡点约等于「注入速率 × 45 秒」，所以上限由手速决定，不由代码决定。
// 45s → 135s（衰减放慢到三分之一）。
//
// 改这个要知道一件事：热度是**平衡点**不是存量。稳态 ≈ 注入速率 × 衰减时间，
// 所以衰减放慢 3 倍，平台也跟着涨 3 倍 —— 实测热度 103 的局会稳在 ~309，
// 倍率从 ×9.3 抬到 ×13.6。它一个人就越过了「要摸到 ×10」那个目标，
// 所以原本打算一起上的倍率曲线改动（HEAT_DIV 12→10 / 拐点 90→110）撤回了，
// 两个叠一起是 ×17.8，热度会常年停在拐点以上很远，曲线那头基本失去意义。
//
// 代价是「停手就掉」的压力大幅减弱：停 60 秒现在只剩 27，改后还剩 198。
// 这是明知的取舍 —— 辛苦攒起来的热度转眼蒸发，是实际玩下来最挫败的一点。
// 倍率分档的三条线。徽章配色、盘面光晕、结算页的「上头」评语共用这一组 ——
// 分开写的话，改一次量程就会有一处忘了跟，两边各自漂。
//
// 旧值 3/6/10 是按平台 ×9.3 标的；衰减放慢后平台到 ×13.6，顶档会常年满格，
// 徽章和边框就不再传递信息。现在平台落在第 3 档，顶档要超过平台才进。
// 四条线 = 五档。原来只有三条线（四档），而第 4 档从 ×14 一直到封顶，
// 倍率实际能冲到 ×35+ —— 实测截图里 ×8.5 和 ×35 的盘面几乎一模一样，
// 从 ×14 往上爬那一段在屏幕上没有任何回报。
// 加一条 22 的线，让顶档真的是「顶」。
// 真人实测倍率能到 ×42（机器人只有 ×16）。原来的 4/8/14/22 在真人手里
// 前三档一闪而过、顶档常年满格。按 ×1~×42 这个真实量程重新铺。
const HEAT_TIERS = [6, 12, 22, 34];
// 热度地板。理由有两条，都不是手感问题：
// ① 梭哈赔的是「热度 ×倍数」，热度 0 的时候赢了也还是 0 —— 机制会空转。
// ② 开局热度从 0 起步，前二三十行基本感觉不到热度这条线存在。
// 地板之下的热度本来也不影响倍率（拐点在 HEAT_KNEE），所以这是纯送。
const HEAT_FLOOR = 50;
const HEAT_TAU = 135000;
const HEAT_DIV = 12;      // 拐点之前：倍率 = 1 + heat / HEAT_DIV
// 拐点之后改走平方根。原来是一条直线，一局打长了热度能压到 160 上下，
// 倍率直接 ×14.5 —— 分数不是被关卡撑起来的，是被这条直线撑起来的，
// 顺带把单局和累计两条称号梯子一起打穿。
// 前半段一格不动（照旧一路冲到 ×5），只把尾巴压下来：
//   heat  48 → ×5.0（不变）   100 → ×7.1（原 ×9.3）
//        162 → ×8.5（原 ×14.5）  300 → ×10.6（原 ×26）
// 还是不封顶，打得猛照样涨，只是涨得动涨不飞。
//
// 平方根那支要在拐点把「值」和「斜率」都接上，不能直接写 sqrt(heat-KNEE)：
// 平方根在 0 处斜率是无穷大，那样刚过拐点会比原来的直线涨得还快
// （heat 48~64 区间新值反而更高），软上限软出个鼓包来。
// 所以整体右移 HEAT_SOFT，再反解 A、B 让 f(KNEE) 和 f'(KNEE) 各自对上。
// 48 → 90：原来拐点太早，热度注入翻 2.5 倍也只能把倍率从 ×6.9 抬到 ×9.7，
// 开方把它压死了 —— 「养热度」这件事的回报太低。抬到 90 之后中段是线性的，
// 热度涨多少倍率就涨多少，养热度才值得。
const HEAT_KNEE = 90;     // 拐点
const HEAT_SOFT = 6;      // 软化半径：越大尾巴抬得越高
const HEAT_B = 2 * Math.sqrt(HEAT_SOFT) / HEAT_DIV;
const HEAT_A = 1 + HEAT_KNEE / HEAT_DIV - 2 * HEAT_SOFT / HEAT_DIV;
let heat = 0;

// ── 燃点 v1 已删除（2026-10-03），v2 见下面的 burnStep ──
//
// 它曾经给狂欢局一个「热度过线之后倍率额外起飞」的加成，
// 公式是 m 乘以 (1 + (h - 线) / 线 × 系数)。两个问题都是结构性的：
//
// 1. 在当前热度量程下会失控。基础倍率过了拐点是**开方**压的，而它是
//    **线性**的 —— 热度一高它就完全主导。真人实测峰值热度约 7400，
//    那个热度普通局 ×42，同样热度的狂欢局会被它推到 ×600+。
//    这公式写于「热度封顶 200」的年代，而现在的量程是它的 37 倍。
// 2. 它只给狂欢局，和深局形状直接打架。形状要的是「狂欢局前段领先、
//    150 行后被普通局反超」，而狂欢局独享的高热度加成会把反超线推到无穷远。
//
// 狂欢局已经有 RUSH_MULT 2.5 和道具翻倍，不缺这一块。
// 以后真要做「高热度爆发」，必须**有封顶**且**两种对局都吃**。
//
// ⚠ 这段讲的是 **v1**。燃点本身没有消失 —— 往下看 burnStep：
// v2 改成挂在「热度涨得够快」上，固定时长 × 固定倍率，两种对局都吃。
// `crazyScoreMult()` 里乘的 BURN_MULT 是 v2 的，活的。

// 纯函数版：给定热度算倍率，不读当前局的状态。
// 说明书要拿它举例，而 heatMult 读的是此刻的 heat ——
// （原来还带一个 rush 参数，函数体里从没用过 —— 燃点 v1 删掉之后热度倍率
//   就和狂欢局无关了，留着会让人以为狂欢局有另一条热度曲线。已去掉。）
// 用后者渲染说明书，等于把「这一局现在的倍率」当成通用规则写上去。
function heatMultAt(h){
  if (!CRAZY) return 1;
  // 夹一下负数。现在没有能让 heat 变负的路径（衰减是乘 exp 且低于 .05 归零、
  // 换牌有余额判、赌输是减半），但公式本身没护栏 —— 真漏进来会算出负倍率，
  // 分数直接变负，排查起来毫无线索。
  if (!(h > 0)) h = 0;
  const m = h <= HEAT_KNEE
    ? 1 + h / HEAT_DIV
    : HEAT_A + HEAT_B * Math.sqrt(h - HEAT_KNEE + HEAT_SOFT);
  return m;
}

function heatMult(){ return heatMultAt(heat); }

// 注入量按含金量给，不按行数摊：一次 TETRIS 给 16，拆成四次单行只给 8。
// 想把倍率烧上去就得打大的。
// 整体 ×1.5：热度升得更快。梯度保持原样（四行仍是单行的 8 倍）。
function heatGain(n, spin, perfect){
  return heatGainBase(n, spin, perfect) * upMul('heat');
}
function heatGainBase(n, spin, perfect){
  if (perfect) return 60;
  if (spin === 'tspin') return [9, 15, 27, 39][n] ?? 39;
  if (spin === 'mini')  return [5, 6, 11][n] ?? 11;
  // 压实可能一次凑满四行以上，表只到 4，超出的按每行 +6 续
  if (n > 4) return 24 + (n - 4) * 6;
  return [0, 3, 8, 14, 24][n] || 0;
}

// ── 热流 ──
// 每次消行有概率把该次热度注入翻倍，行数越少概率越高。
// ⚠ 这段论证的前提在 HEAT_TAU 45s → 135s 之后全部失效，**结论也反了**，
//    下次调 FLOW_P 不要再引用它。按现在的常量重算（单行注入 3、四行 24）：
//      单行平衡  宣称 ×3.1  → 实际 ×9.71
//      有热流后  宣称 ×4.75 → 实际 ×11.87（提升 +51% → +22%）
//      四行平衡  宣称 ×9.78 → 实际 ×20.32
//      四行/单行梯度  宣称 2.06× → 实际 1.27×（开方压缩把它压扁了）
//    也就是说两条支柱都塌了：「只打单行养不起热度」不成立（现在稳在 ×9.7~11.9，
//    是四行玩家的 60~79%），「梯度保住了」也不成立。热流现在是在给一个本来
//    不需要补贴的打法继续补贴，而且在抹平它本来要保住的梯度。
//    要不要继续偏向小消除，得按现在的曲线重新问一遍。
//
// 原文（已作废，保留做沿革）：热度是「每秒注入 × 45 秒衰减」的平衡点，
// 单行注入只有 2，平衡在 ×3.1；偏向之后单行抬到 ×4.75（+51%），四行只抬到 ×9.78。
//
// 用概率不用直接调高单行注入，是因为后者会让单行逼近双行（×5.25 对 ×5.93），
// 而且没有「中了」的瞬间 —— 整套机制里对玩家有利的东西太少，八个事件只有压实一个。
// 只给玩家亲手打出来的消行，道具和压实清出来的不算。
const FLOW_MULT = 4;
let flowHit = false;
const FLOW_P = [.25, .25, .18, .12, .06];   // 索引 = 消了几行，0 行（空转 T-spin）按单行算
const DANGER_HEAT = 2;           // 危险区里消行的热度倍数
// 每条灰线带宝箱的概率。注意这是「生成」的概率，不是「开出来」的 ——
// 宝箱只有在你把那一行消掉时才算开，大量灰线是被顶出去的。
// 实测开出来的数（机器人，一局六七分钟）：普通局中位 3 个，
// 狂欢局灰线快 43%（RUSH_GARBAGE 0.70）。⚠ 原文写的「快 82%」是 .55 时代的遗留。
const CHEST_RATE = 1 / 4;
// 抽成函数：灰线那头和说明书读同一个数，顺带让「富矿这张卡有没有接上」可测
function chestRate(){ return CHEST_RATE * upMul('chest'); }
// 90 → 440，按真人峰值热度的 6% 给，开箱才算一份像样的回报。
const CHEST_HEAT = 440;
let lastRiseAt = -1e9;           // 上一次灰线上顶的时刻，给「压哨」用
// ── 缓期（2026-10-03）──
//
// 灰线是全局唯一跟手速无关的绝对压力钟，所以它一直只有「挨着」这一种关系。
// 缓期给它第一个对手：花热度把钟往回推。
//
// 两个数值决定值得写下来：
//
// ① 推回的是**固定秒数**不是周期比例。按比例推（比如 60%）的话，开局周期
//    36 秒能推 21 秒、后期周期 7 秒只能推 4 秒 —— 正好跟需求反着来，
//    你最需要喘气的是后期。固定 9 秒则是「永远值这么多」。
//
// ② 价格是**热度的固定比例**不是固定值。固定值在热度 5000 的时候等于白送，
//    在热度 200 的时候又贵到没人用。按比例扣则穷富一个价：倍率在拐点之后
//    是 sqrt 压缩的，扣掉 18% 热度大约掉 9% 倍率，和你有多少热度无关。
//    这和燃点 v2 用「涨幅」而不是「绝对值」是同一条原则 —— 机制要免标度，
//    不然 HEAT_TAU 一动就得重标一整排常量。
//
// 每行灰线只能缓一次（delayUsed），所以它是延后不是取消 —— 钟还在走。
const DELAY_MS   = 9000;         // 往回推多少毫秒，固定值
const DELAY_FRAC = .18;          // 价格 = 当前热度的这个比例
// 参与门槛：热度低于这个数就不提供缓期。
//
// 原来这个常量同时当「价格下限」用，而它正好推翻了上面那段论证 ——
// 那段花了一整段说「价格必须是热度的固定比例，否则量程一动就得重标」，
// 下一行就写了个固定值 150，而实测前中期热度区间（峰值中位数几百）里
// **生效的几乎永远是这个固定值**：heat=300 时扣 150 是扣掉一半，
// 倍率从 ×13.5 掉到 ×10.8，是 −20%，不是注释承诺的 −9%。
//
// 拆成两件事：价格纯按比例（真正免标度），门槛单独一个数。
const DELAY_GATE = HEAT_FLOOR * 3;   // 150，但语义是「够不够资格用」不是「最少付多少」
const DELAY_WIN  = 8000;         // 灰线还剩多久时开始提供缓期（要够手机上点得到）
let delayUsed = false;           // 这一行灰线是否已经缓过

// 价格现算 —— 说明书和扣费读的是同一个函数，不会对不上
function delayCost(){ return Math.round(heat * DELAY_FRAC * upMul('delay')); }

// 能不能缓：疯狂版、灰线钟真的在走、进了窗口、热度够、这行还没缓过。
// 梭哈待接时不提供 —— 状态框只有三槽，而梭哈是有硬时限的，不能被挤掉。
function canDelay(){
  if (!CRAZY || !game.started || game.over || game.noGarbage) return false;
  // 钟本来就停着的三种情况，都没得缓。ZONE 是后加的，一开始漏了 ——
  // 于是 ZONE 期间会弹出缓期按钮，点了白花热度（钟没在走），
  // 而那时灰线预警条是藏着的，按钮等于凭空冒出来。
  if (feverLeft > 0 || evCalm() || zoneLeft > 0) return false;
  if (delayUsed || betOffer > 0) return false;
  if (heat < DELAY_GATE) return false;      // 门槛看绝对值，价格看比例
  return garbagePeriod() - garbageTimer <= DELAY_WIN;
}

// 自动缓期。规则一句话：**灰线要来了、堆已经到危险区、而且付得起**，就自动付。
//
// 为什么不是「一有机会就付」：热度直接乘在每一次得分上，无条件自动付等于
// 偷偷削你的分数。绑在危险区上之后它的含义很清楚 —— 热度是保命资源，
// 快被埋的时候自己会顶上去，平时一分不动。
// 为什么不留给玩家按：见 zoneAuto 上面那段。
// 自动缓期的风险门槛：堆顶离可见区顶部还剩几行以内算「该出手了」。
//
// 原来用的是 dangerOn，但那条线要求只剩 3 行（20 行里堆了 17 行）—— 那时候
// 已经快死了，缓 9 秒也救不回来。实测 4604 帧里「危险区 ∩ 可缓期」是 **0 帧**：
// 危险区本身只占 3%，和灰线窗口的重叠又被 FEVER / ZONE / 缓流 全部挡掉
//（那几种情况灰线钟本来就停着，花热度推它没意义，挡是对的）。
// 结果就是这个机制在实战里等于不存在。
const DELAY_RISK = 10;
function delayRisk(){
  const top = stackTopRow();
  return top < TOTAL_ROWS && (top - BUFFER) <= DELAY_RISK;
}
function delayAuto(){
  if (!canDelay() || !delayRisk()) return;
  doDelay();
}

function doDelay(){
  if (!canDelay()) return;
  const c = delayCost();
  heat -= c;
  garbageTimer = Math.max(0, garbageTimer - DELAY_MS);
  delayUsed = true;
  gwarnStep = -1;                                      // 条要立刻回退，别等量化档位变
  heatQuant = -1; syncHeat(); syncEdge(); syncFx();
  if (game.run) game.run.delays = (game.run.delays || 0) + 1;
  showToast(`缓期　−${c} 热度`);
  popScore(CELL * COLS / 2, (TOTAL_ROWS - BUFFER - 2) * CELL,
           '+' + (DELAY_MS / 1000) + 's', '灰线', 'thaw');
  sfx('drop', .7); buzz([25, 15, 40]);
}

// ── ZONE（2026-10-03）──
//
// 游戏里已经有三个「限时加倍窗口」：FEVER ×4 二十秒、燃点 ×1.6 八秒、
// 梭哈十秒按档结算。再加第四个平倍率窗口等于什么都没加。
// ZONE 的价值在于**形状不同** —— 它是唯一一个拿盘面空间换分数的机制：
//
//   · 开启期间重力停、灰线钟停、事件钟停 —— 你有十秒随便摆
//   · 消掉的行不会消失，而是沉到盘面底部变成死行，地板一格一格往上涨
//   · 结束时死行一次清空，按**行数的平方**给一笔奖金
//
// 所以它的张力是「还敢不敢再消一行」：每多沉一行，奖金涨得更快，
// 但你的可用高度也少一格。盘面塞满（ZONE_MAX）就提前结算。
//
// 一个刻意的简化：ZONE 期间的消行**照常计分、照常推连击/B2B/梭哈行数**，
// ZONE 只在结束时额外给奖金。把得分推迟到结算听着更带感，但那会让
// 「一次消除」变得含糊 —— betLines、combo、b2b、彩虹行、压哨全要跟着改，
// 评审里专门点过这个坑。照常结算 + 额外奖金拿到的手感几乎一样，风险小一个量级。
//
// 奖金 = ZONE_UNIT × k² / ZONE_CURVE，再乘和普通消行同一套倍率。
// 相对「这 k 行按单行消掉」的净增益：k=4 约 2 倍、k=8 约 3 倍、k=12 约 4 倍。
const ZONE_NEED  = 20;           // 攒够多少行才能开一次
const ZONE_MS    = 10000;        // 持续时长
const ZONE_MAX   = 12;           // 最多沉多少行，到顶提前结算
const ZONE_UNIT  = 100;          // 奖金基数（和单行消除的 base 同量级）
const ZONE_CURVE = 4;            // 奖金 = UNIT × k² / CURVE
const ZONE_EG = [4, 8, 12];      // 说明书举的三个行数例子
function zoneNeed(){ return Math.round(ZONE_NEED * upMul('zone')); }
let zoneCharge = 0;              // 已攒行数
let zoneLeft = 0;                // 剩余毫秒
let zoneRows = 0;                // 已沉下去几行
let zoneFull = false;            // applyClear 里置位，赋值完盘面再消费

// 死行区的上沿。没有死行时等于 TOTAL_ROWS（也就是「没有地板」）。
//
// 所有会**改写已落地格子**的东西都必须在这条线以上收手：炸弹、激光、重锤、地震。
// 打穿一行死行的后果很隐蔽 —— 那行不再是 every(c === ZONE)，于是
// ① 满行扫描不再跳过它，② zoneEnd 的 filter 也不认它，
// 结果它既不会被消掉也不会被清掉，永久卡在盘底，zoneRows 还跟着对不上。
function zoneFloor(){
  let y = TOTAL_ROWS;
  while (y > 0 && game.board[y - 1].every(c => c === ZONE)) y--;
  return y;
}

// ═══════════ 修行（开局三选一 + 局内升级三选一）═══════════
//
// 清单第 2 期列了六条：波次制 / 局内升级三选一 / 热度商店 / 开局三选一 /
// 血契 / 每局契约。它们收成了这一套，理由：
//
// · 波次制和局内升级三选一被评审标了「必须二选一」—— 都是「停下来做个选择」
//   的载体。这游戏是无尽刷分，波次制要重构整个对局结构，升级三选一是加法，选后者。
// · 血契（有代价的强化）和每局契约（有条件的强化）本质上就是选项池里的两类卡，
//   单独做等于三套 UI 干一件事。
// · 热度商店和升级三选一是同一件事的两种付费方式。而热度已经有换牌 / 挪列 /
//   缓期三个出口了，再加第四个只会把每个都稀释掉。
//
// 实现上只有一个约定：每张卡声明自己乘在**哪个字段**上，计算点统一读 upMul()。
// 这样加一张卡不用碰任何计算代码，也不会出现「这张卡改了 A 忘了改 B」。
const UP_FIRST = 1;              // 开局给几次选择
const UP_EVERY = 50;             // 之后平均每多少行再给一次（期望值，不是刻度）
// 随机抖动幅度：真实间隔在 UP_EVERY × (1 ± UP_JIT) 里均匀取。
// 期望值仍是 UP_EVERY，所以整局能拿到的卡数、以及由此产生的数值强度都不变 ——
// 变的只是「什么时候来」。原来是 50 / 100 / 150 的整数刻度，打到四十几行
// 就知道下一张马上到，可以提前攒着不消行去等它。
const UP_JIT   = .5;
const UP_SAY_MS = 3200;          // 命中提示挂多久。默认 1.1 秒读不完一句带数字的描述

// mul 里的字段名就是 upMul() 的参数。never 列出的是「这局禁用什么」。
// 数值标定的依据（2026-10-08 重标）
//
// 两批各 30 局的 A/B 测下来，12 张卡实际是 3 + 1 + 8 的三层：只有孤注(1.43/1.28)、
// 薄冰(1.34/1.26)、深井(1.24/1.24) 跑得出噪声，其余八张和不选牌没有可区分的差别。
//
// 根因是 **heat 系和 score 系写着同样的单位，却活在两条不同的曲线上**：
// heatMult 过了 HEAT_KNEE 走开方，所以注入 ×k 换来的分数远不止打个折 ——
//   注入 ×1.25 → 分数 +7~9%      ×1.8 → +20~27%
//   注入 ×1.45 → 分数 +12~16%    ×2.4 → +32~43%
// 而 score 字段是恒定的线性倍率，一分不打折。于是「断舍 +45% 注入」卡面看着
// 和「孤注 +45% 得分」同量级，实际只值它的三分之一。
//
// 这一轮按上面那张兑换表把所有卡拉到「每张大约 +20%」—— 选牌该是选**打法**，
// 不是选谁的数字大。两张纯 no-op 换了效果（理由见各自那行）。
const UPS = [
  { k:'forge',  n:'熔炉', t:'消行的热度注入 +80%',          mul:{ heat: 1.8 } },
  // 原来是 tau ×1.4「热度衰减慢 40%」，实测两批都只有 1.00~1.02× —— 因为一局之内
  // 注入速率本身一直在涨（变异块变多、险区翻倍、连击变长），热度是在追一个移动的
  // 目标而不是停在平台上；拉长时间常数让你前期追得更慢、后期留得更多，净值相抵。
  // 换成「灰线慢」——  薄冰的镜像：那张拿命换分，这张拿分换命。
  { k:'ember',  n:'缓坡', t:'灰线涨得慢 25%，活得更久',     mul:{ garb: 1.25 } },
  { k:'scav',   n:'拾荒', t:'变异块出现概率 +50%（含金块）', mul:{ mod: 1.5 } },
  { k:'well',   n:'深井', t:'深局每段的加成 +50%',          mul:{ deep: 1.5 } },
  { k:'vein',   n:'富矿', t:'灰线带宝箱的概率 +140%',       mul:{ chest: 2.4 } },
  { k:'lamp',   n:'长明', t:'ZONE 少攒 40% 行就能开',       mul:{ zone: .6 } },
  { k:'buf',    n:'缓冲', t:'缓期只要一半热度',             mul:{ delay: .5 } },
  { k:'steady', n:'稳手', t:'落地后的锁定延迟 +50%',        mul:{ lock: 1.5 } },
  // 原来是 rain ×1.6「彩虹行停留时间 +60%」，是纯 no-op：rainStep 在标记行消失的
  // 当帧就会重挑，彩虹行的在场率本来就接近 100%，延长停留时间填的是一个不存在的口子。
  // 改成直接加厚那一次的倍率。
  { k:'ribbon', n:'彩练', t:'消到彩虹行时那一次得分再翻倍',  mul:{ rainmult: 2 } },
  // 血契：有明码标价的代价。它们不是「更强的卡」，是**换一种打法**。
  { k:'ice',    n:'薄冰', t:'灰线快 28%，但全局得分 ×1.25', mul:{ garb: .78, score: 1.25 }, vow: true },
  { k:'vow',    n:'断舍', t:'不能用 HOLD，但热度注入 ×2.4',  mul:{ heat: 2.4 }, never: 'hold', vow: true },
  { k:'bare',   n:'孤注', t:'不再出变异块，但全局得分 ×1.3', mul:{ score: 1.3 }, never: 'mod', vow: true },
  // 如常：没有 mul 也没有 never，所以 upMul() 恒返回 1、upNever() 恒为假。
  //
  //
  // 它是骰子上的空面：掷到它这次什么都不给，照样消耗掉。
  // 有这一面，「修行命中」才不等于「一定变强」—— 否则这个机制只是
  // 按固定节奏发的免费增益，掷骰那下毫无悬念。
  { k:'plain',  n:'如常', t:'什么都不变，这一局按原样打' },
];
const UP_BY = Object.fromEntries(UPS.map(u => [u.k, u]));

let ups = [];            // 这局已选的 key
// 发过几次（不是选中几张）。标题必须读这个 ——
// 读 ups.length 的话，开局点了「不选」之后第 50 行那次会再标成「开局修行」，
// 看着就像游戏自己重开了。
let upRound = 0;
let upNext = UP_EVERY;   // 下一次给选择的行数，由 upRoll() 掷出来

// 掷下一次的门槛。**从 from 往后推**，不是在上一个门槛上累加 ——
// 压实、炸弹、激光都能一次吞掉好几行，累加式碰上那种跳跃会把门槛甩在身后，
// 于是下一块落地时 game.lines 已经越过两个门槛，连着弹两次面板。
function upRoll(from){
  upNext = from + Math.max(1, Math.round(UP_EVERY * (1 + (rndFx() * 2 - 1) * UP_JIT)));
}

// 某个字段的总乘数。没有任何卡命中就是 1，所以计算点写法统一：× upMul('heat')
function upMul(field){
  let m = 1;
  for (const k of ups){ const v = UP_BY[k]; if (v && v.mul && v.mul[field]) m *= v.mul[field]; }
  return m;
}
// 这局是否禁用了某样东西（断舍禁 HOLD、孤注禁变异块）
function upNever(what){
  for (const k of ups){ if (UP_BY[k] && UP_BY[k].never === what) return true; }
  return false;
}

// 可抽的池子：已经命中过的不再出；血契最多同时挂两张（三张血契的局基本没法玩）
function upPool(){
  const vows = ups.filter(k => UP_BY[k] && UP_BY[k].vow).length;
  return UPS.filter(u => !ups.includes(u.k) && !(u.vow && vows >= 2));
}

// 修行命中。不弹面板让人选，直接掷一张用上，再在屏幕上报一下。
//
// 三选一那套的张力其实很薄：面板真正做的事是把整局停住、让人读三段字，
// 而十几张里多数时候有一张明显更好，所谓「选择」是在确认一个已经确定的答案。
// 直接命中之后悬念还在（掷到什么事先不知道），停顿没了 —— 跟整套机制
// 「除了梭哈，其他尽可能自动触发」是同一条。
//
// 面板没了，为面板服务的那一串状态也一起没了：选的时候要冻住方块、
// 关面板要按特定顺序复位否则整局卡死、梭哈和 ZONE 进行中得推迟发牌。
// 提示是非阻塞的，不打断任何东西，所以这三件事都不用再防。
function upOffer(n){
  if (!CRAZY) return;
  for (let i = 0; i < n; i++) upHit();
}

function upHit(){
  // 自己守 CRAZY，不靠 upOffer 挡 —— 标准版承诺「什么都没加」，
  // 而这是个能从外面直接调到的入口。
  if (!CRAZY) return;
  const pool = upPool();
  if (!pool.length) return;              // 抽干了就不再打扰
  const u = pool[(rndFx() * pool.length) | 0];
  upRound++;
  ups.push(u.k);
  if (game.run) game.run.ups = ups.slice();
  // 名字 + 效果一起报。没有面板了，这是玩家唯一一次看到这张卡写了什么，
  // 所以描述必须进提示，时长也得给够。
  showToast('修行　' + u.n + (u.vow ? '（血契）' : '') + '　' + u.t, UP_SAY_MS);
  sfx('tetris', 1.1); buzz([35, 20, 35]);
  // 立刻生效的那几张要刷一下 UI
  heatQuant = -1; syncHeat(); syncEdge(); syncFx(); syncHud();
}

// 攒够就自己开，不再等玩家按按钮。
//
// 侧栏只有 64px、三个槽，同时冒出两个「要不要点」的按钮之后，实际反馈是
// 「不知道展示什么，也不知道要不要点击」。而 ZONE 的张力本来就不在
// 「什么时候开」，在开了之后「还敢不敢再消一行」—— 那一部分完整保留。
function zoneAuto(){
  if (zoneReady()) zoneStart();
}

function upStep(){
  if (!CRAZY) return;
  if (game.lines >= upNext){ upRoll(game.lines); upOffer(1); }
}

function zoneReady(){
  return CRAZY && game.started && !game.over && zoneLeft <= 0 && zoneCharge >= zoneNeed();
}

let zoneTold = false;        // 这局讲过 ZONE 是什么了吗
function zoneStart(){
  if (!zoneReady()) return;
  zoneCharge = 0; zoneLeft = ZONE_MS; zoneRows = 0; zoneFull = false;
  // ZONE 改成自动触发之后，玩家能看到的只有一句一闪而过的 toast 和盘面变紫 ——
  // 不够说明它是什么。每局第一次开的时候在盘面上讲 5 秒，之后就不再打扰。
  // 梭哈待接时让路：那个有十秒硬时限，讲解可以等。
  let told = false;
  if (!zoneTold && betOffer <= 0){ zoneTold = true; told = true; actLast = 'zoneinfo'; actFlash('zoneinfo'); }
  document.body.classList.add('zoning');
  if (game.run) game.run.zones = (game.run.zones || 0) + 1;
  if (!told) showToast('ZONE　重力停了');   // 讲解框里已经说了，别再叠一层
  sfx('tetris', .8); buzz([60, 30, 60, 30, 90]);
  syncFx();
}

// 结算：底部死行一次清空，盘面落回来，按行数平方给奖金
function zoneEnd(why){
  if (zoneLeft <= 0 && zoneRows <= 0) return;
  zoneLeft = 0;
  document.body.classList.remove('zoning');
  const k = zoneRows;
  zoneRows = 0;
  if (k > 0){
    // 把底部那 k 行死行拿掉，顶上补 k 行空的
    const kept = game.board.filter(row => !row.every(c => c === ZONE));
    while (kept.length < TOTAL_ROWS) kept.unshift(new Array(COLS).fill(null));
    game.board = kept;
    const gain = Math.round(ZONE_UNIT * k * k / ZONE_CURVE
                            * levelMult(game.level) * crazyScoreMult());
    game.score += gain;
    if (game.run && gain > game.run.bestHit) game.run.bestHit = gain;
    if (game.run) game.run.zoneRows = Math.max(game.run.zoneRows || 0, k);
    sweepRows([TOTAL_ROWS - 1], '#b49bff');
    popScore(CELL * COLS / 2, (TOTAL_ROWS - BUFFER - 1) * CELL,
             '+' + groupInt(gain), k + ' 行', 'zone');
    shake(k >= 6); sfx('tetris', 1.2); buzz([40, 25, 40, 25, 90]);
    syncHud();
  } else if (why){
    showToast('ZONE 结束　' + why);
  }
  staticDirty = true; needsDraw = true;
  syncFx();
}

function zoneStep(dt){
  if (!CRAZY || zoneLeft <= 0) return;
  zoneLeft -= dt;
  // 到时了也要等消行动画落地再结算。
  //
  // clearing.rows 是一组**行下标**，要在盘面上存活 260ms；而 zoneEnd 会把
  // 整个盘面重排（底部拿掉 k 行死行、顶部补 k 行空的，幸存行下标全 +k）。
  // 在这中间结算的话，等动画落地时 applyClear(clearing.rows) 删的是错的行 ——
  // 玩家消掉的那行分数/lines/combo 已经给了，行却留在盘上，下次锁定会**再记一次**，
  // 同时上方一条无关的行被删掉。实测这个窗口占 ZONE 结束的 18%。
  //
  // 灰线早就是这么躲的（stepOnce 里那句 `if (!clearing && game.piece)`），
  // 这里沿用同一条规矩：重排盘面的东西一律让过动画。最多晚 260ms。
  if (zoneLeft <= 0 && !clearing) zoneEnd('');
}

const SNIPE_MS = 1000;           // 灰线顶上来多久内消行算压哨
const SNIPE_HEAT = 8;            // 压哨额外补的热度

// 开箱三档的累积概率：FEVER / 热度 / 下一块炸弹。说明书读的是同一个数组。
const CHEST_P = [.34, .70];
// 消掉带宝箱的行就开箱。三选一，都是当场能感觉到的东西。
function claimChests(rows){
  if (!CRAZY) return;
  let n = 0;
  for (const y of rows) for (let x = 0; x < COLS; x++) if (game.board[y][x] === CHEST) n++;
  if (!n) return;
  if (game.run) game.run.chests += n;
  for (let i = 0; i < n; i++){
    const r = rndFx();
    if (r < CHEST_P[0] && feverLeft <= 0 && feverCool <= 0){ tip('开箱　FEVER！', 0); feverStart(); }
    // FEVER 那一档被「已经在 FEVER 里」或「冷静期」挡住时，会落到这一档 ——
    // CHEST_P[0] < CHEST_P[1]，所以这个条件天然兜得住，不会白开一个箱
    else if (r < CHEST_P[1]){ heat += CHEST_HEAT; heatQuant = -1; syncHeat(); syncEdge(); tip('开箱　热度 +' + CHEST_HEAT, 0); }
    // 孤注（血契）承诺「不再出变异块」换全局得分 ×1.45。rollMod 和 doGlean 都守了
    // upNever('mod')，唯独这里直接写 game.mods[0] 绕过去 —— 实测挂着孤注开 300 次
    // 宝箱，92 次照样塞了炸弹（31%）。玩家付了价钱，线没断干净。
    // 挡住之后退成热度那一档，别白开一个箱。
    else if (upNever('mod')){ heat += CHEST_HEAT; heatQuant = -1; syncHeat(); syncEdge();
                              tip('开箱　热度 +' + CHEST_HEAT, 0); }
    else { game.mods[0] = 'bomb'; previewDirty = true; tip('开箱　下一块是炸弹', 0); }
  }
  sfx('tetris', 1.34); buzz([30, 20, 30, 20, 60]);
}

// 钩子⑥：每帧衰减
function crazyStep(dt){
  if (!CRAZY) return;
  if (feverCool > 0) feverCool -= dt;
  // FEVER 期间不衰减 —— 那二十秒变成「把热度冻住往上堆」的黄金窗口，
  // 而不只是个 ×4
  if (feverLeft > 0) return;
  heat *= Math.exp(-dt / (HEAT_TAU * upMul('tau')));
  heatClamp();
}

// ── 燃点 v2（2026-10-03 重做）──
//
// 旧版是「热度 > 绝对值就额外加成，而且是线性的」，三个结构性毛病：
//   1. 线性叠在开方上 —— 基础倍率过拐点用开方压就是为了给它一个界，
//      再乘线性项等于把界取消。实测真人峰值热度下会被推到 ×619。
//   2. 阈值是绝对热度 —— 而量程会变（机器人 550 / 真人 7400，差 13 倍），
//      改一次 HEAT_TAU 又整体平移 3 倍，写死的阈值活不过下次调参。
//   3. 只给狂欢局 —— 和「150 行后普通局反超」的形状正面冲突。
//
// v2 改成挂在**涨得快**而不是**够高**上：最近 BURN_WIN 毫秒里热度净增
// 超过 BURN_RISE，就点着 BURN_MS 毫秒，期间固定 ×BURN_MULT。
//
//   · 相对增幅 → 天然跟着量程走，不用再标绝对值
//   · 奖励「连续猛攻」这个动作，不是「攒着不动」的存量
//     （攒到 7400 停手不动 = 没有加成；高热且在猛攻才点得着）
//   · 固定时长 × 固定倍率 → 完全有界，平均贡献可算，能折进形状计算
//   · 也更贴这个名字：点火要持续供氧，不是柴火够多就自燃
//
// 狂欢局的身份放在「更容易点着 + 烧得更久」上，而不是「倍率更高」——
// 后者无界，前者有界且可计算。
const BURN_WIN  = 10000;   // 观察窗口
const BURN_RISE = .40;     // 窗口内净增超过这个比例就点着
const BURN_RISE_RUSH = .30;
const BURN_MS   = 8000;    // 烧多久
const BURN_MS_RUSH = 12000;
const BURN_MULT = 1.6;     // 期间的倍率，固定值
// 热度太低时不参与 —— 从 2 涨到 5 也是 +150%，但那没有任何意义，
// 而且会让开局必定点着一次。这个下限只用来掐掉噪声，不是设计阈值。
const BURN_FLOOR = 50;
const BURN_SAMPLE = 500;   // 每隔这么久记一个热度样本
// 燃点的边框色。注意两点：
//   · mix() 收的是 hex 字符串，不是数组 —— 传数组会在 hex() 里变成垃圾值
//   · 不能用橙红：HEAT_EDGE 本来就是 #ff6a3c，高热时光晕已经是橙红了，
//     燃点再推橙红等于没区别。往「更烫」的方向走 —— 亮金。
const BURN_EDGE = '#ffd24a';
const ZONE_EDGE = '#b49bff';   // ZONE 期间的边框色，和燃点一样必须折进 syncEdge

let burnLeft = 0;          // 剩余燃烧时间
let burnHist = [];         // [{t, h}]，只保留窗口内的
let burnT = 0;             // 采样计时
let burnClock = 0;         // 燃点自己的时钟（和热度衰减同源，见 burnStep）

function burnOn(){ return CRAZY && burnLeft > 0; }

// 每帧推进：采样、判定、倒计时
function burnStep(dt){
  if (!CRAZY) return;
  if (burnLeft > 0){
    burnLeft -= dt;
    if (burnLeft <= 0){ burnLeft = 0; syncBurn(); }
  }
  burnT += dt;
  if (burnT < BURN_SAMPLE) return;
  burnT = 0;
  // 用自己累计的时钟，不用 game.elapsed —— 后者在消行动画那 260ms 里不涨，
  // 而热度衰减走的是 dt，照跑。两者不同步会让窗口里的相对涨幅算偏。
  burnClock += BURN_SAMPLE;
  const now = burnClock;
  // 时间倒流就整段作废。窗口清理是「now - 最老样本 > 窗口」，一旦 elapsed
  // 往回跳（重开、或任何把 elapsed 调小的路径），这个判断恒为假，老样本
  // 永远清不掉 —— 而开局那批样本热度是 0，卡在下面的 BURN_FLOOR 直接 return，
  // 燃点就再也点不着了。crazyReset 虽然会清历史，但别把正确性押在「调用方
  // 一定记得清」上。
  if (burnHist.length && now < burnHist[burnHist.length - 1].t) burnHist.length = 0;
  burnHist.push({ t: now, h: heat });
  while (burnHist.length && now - burnHist[0].t > BURN_WIN) burnHist.shift();
  if (burnLeft > 0 || burnHist.length < 2) return;
  const old = burnHist[0].h;
  if (old < BURN_FLOOR) return;
  const rise = (heat - old) / old;
  const need = game.rush ? BURN_RISE_RUSH : BURN_RISE;
  if (rise < need) return;
  burnLeft = game.rush ? BURN_MS_RUSH : BURN_MS;
  burnHist.length = 0;                 // 点着之后重新攒窗口，免得同一波连点
  syncBurn();
  if (CELL) popScore(CELL * COLS / 2, CELL * ROWS * .3, '燃点', '×' + BURN_MULT, 'burn', 1.15);
  sfx('tetris', 1.35); buzz([40, 25, 40, 25, 70]);
}

function syncBurn(){
  document.body.classList.toggle('burning', burnOn());
  syncEdge();
  syncFx();
}

// 事件和赌局的钟要一直走，热度是 0 也得走 —— 上面那个函数会提前 return
function crazyClocks(dt){
  if (!CRAZY) return;
  burnStep(dt);
  rainStep(dt);
  // 狂风：每隔一会儿把下落中的方块吹偏一格。撞墙就算了，不硬推。
  if (evActive && evActive.key === 'wind' && game.piece && !clearing){
    windTimer += dt;
    if (windTimer >= 850){ windTimer = 0; tryMove(rndFx() < .5 ? -1 : 1, 0); }
  }
  if (flashLeft > 0) flashLeft -= dt;
  evStepSchedule(dt);
  betStep(dt);
  // 必须排在 evStepSchedule / betStep 之后 —— 排前面的话，事件点燃的那一帧
  // 状态格还读不到它，要等下一帧才显示
  syncFx();
  for (let i = beams.length - 1; i >= 0; i--)
    if ((beams[i].t += dt) > BEAM_MS) beams.splice(i, 1);
  for (let i = embers.length - 1; i >= 0; i--)
    if ((embers[i].t += dt) > EMBER_MS) embers.splice(i, 1);
  if (beams.length || embers.length) needsDraw = true;
}

let feverLeft = 0;               // 剩余 FEVER 时间（ms，游戏时间）
let feverPity = 0;               // 保底计数：每次消行没中就 +1
let goldPending = false;         // 这一杆锁下去的块是不是金的

function crazyReset(){
  feverLeft = 0; feverPity = 0; feverCool = 0; goldPending = false;
  heat = CRAZY ? HEAT_FLOOR : 0; heatTier = -1; heatQuant = -1;
  evTimer = 0; evWarnLeft = 0; evPending = null; evActive = null; evLeft = 0;
  flashFx = null; flashLeft = 0; fxSig = '';
  wallCol = -1; windTimer = 0; setMuffle(false); embers.length = 0;
  betOffer = 0; betLeft = 0; betCool = 0; betLines = 0; betShow = 0; flowHit = false; beams.length = 0;
  swapSel = -1; rainRow = -1; rainLeft = 0; delayUsed = false; rainMarkSig = '';
  actKind = ''; actLast = ''; zoneTold = false;
  for (const k of Object.keys(actSeen)) delete actSeen[k];
  zoneCharge = 0; zoneLeft = 0; zoneRows = 0; zoneFull = false;
  ups = []; upRound = 0; upRoll(0);
  document.body.classList.remove('zoning');
  burnLeft = 0; burnHist.length = 0; burnT = 0; burnClock = 0;
  document.body.classList.remove('burning');
  delete document.body.dataset.ev;
  document.body.classList.remove('betting');
  const ew = $('evwarn'); if (ew) ew.classList.remove('on');
  betHide();
  activePal = null;
  document.body.classList.remove('fever');
  if (CRAZY) setTempo(baseBpm);
}


// ── 试过「无洞连击链」，两条前提都不成立，已撤 ──
//
// 想法是：现有加成全在奖励「消行速度」，没有一个奖励「整洁」，而整洁恰恰是
// 深局能不能活下去的唯一变量。方向对，执行错了两次：
//
// 1. **经济上无效。** 打算给定额热度，但热度是按比例衰减的池子。凑 12 块
//    整洁约 17 秒，这期间热度 1000 的局自己掉 117 点、7400 的局掉 866 点 ——
//    而奖励只有 26 点。定额加法在按比例衰减的池子里，高位必然失效。
//    而且倍率过拐点是开方压的，热度 7400 时多给 24 点只值 +0.13%，
//    恰恰是它声称要救的深局最不值钱。
//
// 2. **判定失真。** `made` 算在**消行之前**，所以「用一块封顶一个还没消掉的
//    满行」必然被算成造洞 —— 实测盖之前 0 个洞、盖之后 2 个、而那行消掉后
//    实际是 0 个。链会在你打出漂亮消行的那一手上断。对变异块也是瞎的
//    （`crazyApplyMod` 在它之后才跑），而灌注正是用来修洞的。
//
// 还有两个连带问题：给热度会被燃点 v2 的「涨得快」判据点着（一次性注入
// 天然是个 spike），而「断链才结算」等于逼玩家主动造洞去兑现。
//
// 要重做的话正确形态是**乘性**的：整洁期间热度衰减减半。但那会动热度平衡。

// 钩子②：锁定时记下这块是不是金的（scoreFor 里 game.piece 已经是 null 了）
function crazyOnLock(p){
  if (!CRAZY) return;
  goldPending = p.mod === 'gold';
}

// 钩子③：算分时的倍数。热度 × 深局 × 狂欢 × 爆发，其中「爆发」那一组
// （FEVER / 燃点 / 金块）是**相加**的，见函数体里的 burst。
// 这行原来写的是「金块 ×2、FEVER ×3，两者相乘」—— 数值和运算全错，
// 而反例就在八行之下。
// 整体手感微调。想让全局分数涨/跌就只动这一个数 —— 其余旋钮（HEAT_DIV、
// GOLD_MULT、FEVER_MULT、levelMult）都不均匀：有的只在热度高时生效，有的只
// 覆盖一小撮消行，调它们等于顺手改了平衡。
// 现在是 1：道具/压实消行给分那条已经把整体抬了约 18%（狂欢局 33%），
// 再乘就过头了。
// 深局加成改完普通局 100 行约 260 万，离 500 万还差 1.9 倍 —— 这个旋钮就是
// 干这个的：均匀、精确、不牵动任何平衡。两边同乘，所以狂欢局也跟着到 550 万档。
const CRAZY_TUNE = 1.9;

// ── 深局加成（只给普通局）──
// 狂欢局比普通局值多少，是三个常数乘出来的：热度 1.97 倍（梭哈连赢 + 道具
// 翻倍带来的额外注入）× 分数 2.4 倍 × 行数 0.69 倍。
// ⚠ 那个 0.69 是按「灰线快 82%」算的，而现在是 43% —— 狂欢局活得比当初久，
//    这个因子应该更接近 1。也就是说下面推出来的 2.1 倍、以及据此标定的
//    DEEP_BASE_RUSH / RUSH_EXTRA，依据都是一个已经作废的数。下次重标要重算。
// 乘起来约 2.1，而且跟行数无关 —— 所以补偿也得是个接近常数的量，
// 拿「行数越多越值」那种缓坡补不动：实测 100 行就差 2.16 倍、550 行还差 2.08 倍。
//
// 第一版让两边共吃这个加成，等于白给狂欢局也加，方向错了。现在只给普通局：
// 狂欢局已经有 ×2.4 和道具翻倍。
//
// 用两局真实对局校准（普通 137 行 82.5 万 / 狂欢 265 行 1331 万），
// 普通/狂欢 在各水平上的比值：
//   150行 0.76   200行 0.86   250行 0.95   300行 1.02   383行 1.13
// 80 行 ×1.8 → 40 行 ×3.0：目标改成「100 行要到 500 万档」，而普通局早期太薄
// （100 行才 151 万，狂欢局 291 万）。把加成提前并加厚，补的正是这一段。
// 狂欢局不再归零 —— 它也吃深局加成，只是基数低得多（1.2 对 3.0）。
// 之前给它 0 的后果：同时长下它稳定落后 15%，因为灰线快 43%、同样时间打的
// 行数少，而普通局那一大块加成它一分吃不到，RUSH_MULT 抬到 3.0 都补不平。
// 现在差距靠系数拉开，而不是靠「有/没有」。
const DEEP_FROM = 40;
const DEEP_BASE = 3.0;
// 1.87 → 2.6（2026-10-10）。连同步长一起抬，理由在 DEEP_STEP_RUSH 那边。
// 「换来它不再随深度往上爬」那句已经作废：步长从那以后就不是 0 了。
const DEEP_BASE_RUSH = 2.6;
// 步长分模式，这是 v4 的主线改动。
//
// 原来两边步长都是 .4，但狂欢局那份还要再 ×2.5，于是差距随行数单调拉大：
// 40 行持平、200 行 1.26 倍、600 行 1.64 倍 —— 正好是反的。
// 想要的是「普通局是成长型，越深越高；狂欢局是爆发型，容易高但不随深度放大」。
//
// 现在普通局步长加倍、狂欢局归零，两条线在 250 行交叉：
//   40行 1.56×　100行 1.34×　200行 1.09×　250行 持平　400行 0.80×　600行 0.63×
// 注意狂欢局在实际会发生的那一段反而比以前更强（100 行从 1.11 提到 1.34），
// 它只是把深局让给普通局 —— 而且它灰线快 43%，本来就更难活到 250 行。
// .8 → 3.6（2026-10-01 二调）。
//
// 第一版只按**深局加成**算交叉点，得出 249 行。但实测发现总比值比它高
// 约 1.5 倍 —— 多出来的是道具翻倍（RUSH_MOD = 2，金块 ×3、炸弹/激光/
// 重锤直接产分），那部分不随行数变，等于给狂欢局一个恒定加成 C ≈ 1.49。
// 把 C 算进去，真实交叉点其实在 ~535 行，普通局根本追不上。
//
// 前移用的是「加大普通局步长」而不是「压低狂欢局基数」：后者会把狂欢局
// 前期的优势一起削掉（50 行处从 2.07× 掉到 1.26×），而那正是它的身份。
// 加大普通局步长则两头都要：交叉点前移到 ~150 行，狂欢局前期分毫不动，
// 普通局深局分数还大涨（136 行 ×1.71、300 行 ×2.43）。
//
// C 的估计区间是 1.32~1.68（n=3，噪声大），对应交叉点 128~175 行，
// 括住目标 150。要更准得跑 n≥30。
const DEEP_PER = 100;          // 深局步长的分母：每这么多行再加一个 DEEP_STEP
const DEEP_STEP = 3.6;
// 狂欢局也要有成长性，只是比普通局缓得多。
//
// 原来是 0 —— 深局倍率在 100 / 200 / 400 / 600 行全是 1.87，一条水平线。
// 而普通局涨到 23.16，再叠上狂欢局灰线快 43%、更难活长，两个惩罚同向。
// 结果是**狂欢局在数值上不可能刷出纪录**（累计总分比在 600 行只有 0.58），
// 和「两种对局都要能打出高分」这条设计意图直接矛盾 —— 它的身份从
// 「更容易高分」退化成了「更快拿一个中等分」。
//
// 0.6（普通局的六分之一）算出来的累计总分比：
//   100 行 2.12 → 150 行 1.78 → 230 行 1.49 → 400 行 1.20 → 600 行 1.05
// 早期明显更容易高分，长局被普通局追平 —— 这才是「只是更容易」。
// 0.6 → 1.2（2026-10-10）。上面那段算的持平点（100 行 2.12 → 600 行 1.05）
// 是按 RUSH_EXTRA = 1.49 推的，而那个常数实测站不住，见它自己的注释。
// 用实测的 C ≈ 0.94 重算，0.6 的真实持平点只有 105 行 —— 狂欢局从一百行
// 出头就开始落后，和「更容易高分」完全相反。
//
// 配 BASE 2.6、按实测 C = 1.15：
//   100 行 1.75 → 200 行 1.33 → 300 行 1.15 → 持平点 560 行
// 回到当初想要的形状：前期明显更容易高分，深局被普通局追平。
//
// 上限是硬的：渐近比 = STEP_RUSH / DEEP_STEP × RUSH_MULT × C = STEP_RUSH × 0.799，
// 所以 STEP_RUSH ≥ 1.25 的话狂欢局**永远**不会被追上，身份就从
// 「更容易高分」变成「单纯更强」。
//
// 先试的是 1.2 —— 那是按 C = 0.94 定的，而那次测量带幸存者偏差（普通局只有
// 5/20 活到 200 行，那五局是最好的一批）。改完重测，两边都是 14/24 到达，
// C 修正到 1.15，1.2 的持平点就跑到四千行外、实质上是「永不」了。
// 退到 0.9：离阈值 1.25 留足余量，C 在实测见过的 0.94~1.15 之间怎么晃，
// 持平点都还在盘面上（C=0.94 时约 290 行，C=1.15 时 560 行）。
const DEEP_STEP_RUSH = 0.9;
// 狂欢局在深局加成之外还有的那一份优势，主要来自道具翻倍（RUSH_MOD = 2，
// 金块 ×3、炸弹/激光/重锤直接产分）。它不随行数变，所以是个恒定系数。
// 只用来算「几行之后被普通局反超」这一句说明文案，不参与任何计分。
//
// 1.49 → 0.94（2026-10-10）。旧值是 n=3、在 50/100 行、而且 DEEP_STEP_RUSH
// 还是 0 的年代标的，后来三次改曲线都没回来重标。它错得不小：按 1.49 算，
// 狂欢局在 200 行该领先 58%，实测是**落后 23%**。
//
// 新值怎么来的：固定 200 行检查点，普通局 5/20 到达、狂欢局 12/20 到达，
// 分数中位 2.62 亿 vs 2.03 亿 = 0.77；同一批的 crazyScoreMult 中位
// 330 vs 272 = 0.82（这一项是确定性的，就是 deepAt 之比乘 RUSH_MULT）。
// 0.77 / 0.82 = 0.94。但那一批普通局只有 5/20 活到 200 行，是幸存者里最好的
// 一批，把分母抬高了。改完数值重测一次，两边都是 14/24 到达、样本平衡：
// 分数比 1.48、倍率比 1.296（= deepAt 之比 × RUSH_MULT，确定性的），
// 1.48 / 1.296 = 1.15。取这个。
//
// ⚠ 两次测量给了 0.94 和 1.15，差一成半。定狂欢局数值时别踩在
// 「C 再高一点持平点就消失」的刀刃上 —— DEEP_STEP_RUSH 那边留了余量。
const RUSH_EXTRA = 1.15;
let deepSaid = false;
// 狂欢局被普通局反超的行数，给说明书用。
//
// 不能只解两条深局曲线的交点 —— 那只算了深局加成这一项，而狂欢局还有
// 道具翻倍带来的 RUSH_EXTRA。只按深局算会得出 87 行，实际要到 ~150 行，
// 说明书照着写就是在骗人。要解的是**总比值**等于 1：
//   DEEP_BASE_RUSH * RUSH_MULT * RUSH_EXTRA = DEEP_BASE + (L-DEEP_FROM)/100 * DEEP_STEP
// 几行之后「每行的价值」被普通局追上。
//
// 原来是解析解，前提是两条都线性。现在深局过了 DEEP_SOFT 要转开方、
// 狂欢局的步长也不再是 0，那个公式失效了 —— 改成直接扫。
// 扫比解析解更耐改：以后再动曲线形状，这里不用跟着重推。
function deepCrossLines(){
  for (let L = DEEP_FROM; L <= 4000; L += 10){
    if (deepAt(L, true) * RUSH_MULT * RUSH_EXTRA <= deepAt(L, false)) return L;
  }
  return 0;        // 一直没被追上
}

const DEEP_EG = [200, 400];    // 说明书举的两个行数例子
// 任意行数的深局倍率。deepMult 读的是 game.lines，而说明书要问的是
// 「200 行的时候是多少」，所以拆成纯函数给两边共用。
// 原来说明书自己手算 (DEEP_BASE + 1.6 * DEEP_STEP)，那个 1.6 其实是
// (200 - DEEP_FROM) / DEEP_PER —— DEEP_FROM 一改，说明书就开始骗人。
// 深局倍率。过了 DEEP_SOFT 个台阶之后从线性转开方 —— 和热度过 HEAT_KNEE
// 之后那套是同一个做法，连推导都一样。
//
// 为什么要封：deepMult、levelMult（疯狂版不 clamp）、heatMult 三条都随行数
// 单调涨，而它们是**相乘**的，于是总分大约按行数的三次方走 —— 实测行数 ×10、
// 每行价值 ×86。后果有两个：① 技巧差异的量级是 ×1.5~3，而「多活 100 行」是
// ×4~8，排行榜本质上变成耐力榜；② 单局梯子在 400 行左右就打穿（机器人一局
// 404 行打出 12.8 亿，而顶格「无极」是 1.2 亿）。
//
// 三条里挑一条改形状就够。levelMult 的 L^0.75 本来就温和，heatMult 已经是
// 开方压的，所以动深局这条线性无界的。
//
// 接法（x = 已走的台阶数）：
//   x ≤ K:  base + x·step
//   x > K:  A + B·√x，  要求在 x=K 处值和斜率都连续
//   斜率连续 → B/(2√K) = step → B = 2·step·√K
//   值连续   → A = base + K·step − B·√K = base − K·step
// K = 2 即 240 行开始转弯：400 行只压 5%、600 行压 14%、1000 行压 27% ——
// 常见局长几乎不受影响，被削的是本来就没有反馈的长尾。
const DEEP_SOFT = 2;
function deepAt(lines, rush){
  if (lines < DEEP_FROM) return 1;
  const base = rush ? DEEP_BASE_RUSH : DEEP_BASE;
  const step = (rush ? DEEP_STEP_RUSH : DEEP_STEP) * upMul('deep');
  const x = (lines - DEEP_FROM) / DEEP_PER;
  if (x <= DEEP_SOFT || step <= 0) return base + x * step;
  const B = 2 * step * Math.sqrt(DEEP_SOFT);
  const A = base - DEEP_SOFT * step;
  return A + B * Math.sqrt(x);
}
function deepMult(){
  if (!CRAZY) return 1;
  return deepAt(game.lines, game.rush);
}

function crazyScoreMult(){
  if (!CRAZY) return 1;
  let m = heatMult() * CRAZY_TUNE * deepMult() * upMul('score');
  if (game.rush) m *= RUSH_MULT;     // 整局性质的，和深局/热度一样留在乘法链上
  // 限时爆发（FEVER / 燃点 / 金块）**相加不相乘**。
  //
  // 这三个是同一种东西 —— 都是平倍率，都乘在同一个数上。相乘的话
  // ×4 × ×1.6 × ×3 = ×19，屏幕上数字暴涨但玩家分不清是谁给的；
  // 相加则是 1 + 3 + 0.6 + 2 = ×6.6。
  // 这个换法的好处是**单个 buff 完全不变**（FEVER 自己还是 ×4），
  // 只把叠加的尾巴压扁，顶端降约三倍。
  let burst = 1;
  if (feverLeft > 0)  burst += FEVER_MULT - 1;
  if (burnLeft > 0)   burst += BURN_MULT - 1;
  if (goldPending)    burst += GOLD_MULT - 1;
  return m * burst;
}

// 钩子④：每"次"消行掷一次骰（不是每行）。没中时按消行数加权 +n%，
// 这样打单行和打 TETRIS 的触发频率都不吃亏。线性保底，期望约 12 次消行一次。
function crazyOnClear(lines, spin, perfect){
  if (!CRAZY) return;
  if (lines <= 0 && !spin) return;
  goldPending = false;
  // 空转的 T-spin 也给热度：它是实打实的技术动作，只是没消到行
  let gain = heatGain(lines, spin, perfect);
  // 热流：先掷，再叠险区/压哨那些加成
  if (rndFx() < (FLOW_P[Math.min(lines, 4)] ?? FLOW_P[4])){
    gain *= FLOW_MULT;
    flowHit = true;
  }
  if (lines > 0 && evTail()) gain *= 2;              // 顺风
  // 险区加成：危险区原来只有坏处，所以最优解永远是「尽快清下去」，没有选择。
  // 在里面消行热度翻倍之后，才谈得上「敢不敢赖在高处多赚一点」。
  if (lines > 0 && dangerOn){
    gain *= DANGER_HEAT;
    tip('险中取栗　热度 ×' + DANGER_HEAT, 4000);
  }
  // ZONE 攒条。只数真正消掉的行 —— 空转 T-spin 不算，道具清行走的是另一条路也不算。
  // ZONE 进行中不攒：不然一边用一边就把下一次攒出来了。
  if (lines > 0 && zoneLeft <= 0) zoneCharge = Math.min(zoneNeed(), zoneCharge + lines);
  // 压哨：灰线刚顶上来就立刻消掉一行
  if (lines > 0 && game.elapsed - lastRiseAt < SNIPE_MS){
    gain += SNIPE_HEAT;
    tip('压哨', 3000);
  }
  // 越过深局门槛报一次。1.0 → 1.8 是个台阶，不说一声会像数值跳变
  if (!game.rush && !deepSaid && game.lines >= DEEP_FROM){
    deepSaid = true;
    tip('深局　每行 ×' + DEEP_BASE, 0);
  }
  heat += gain;
  // 热流的反馈放在注入之后：它是「这一手更值」，不是独立事件，
  // 所以走飘字而不是 toast —— toast 会被 FEVER / 里程碑顶掉。
  if (flowHit){
    flowHit = false;
    if (CELL) popScore(CELL * COLS / 2, CELL * ROWS * .26, '热度 ×' + FLOW_MULT, '热流', 'flow', .95);
    sfx('rotate', 1.5); buzz(22);
  }
  betResolve(lines);
  syncHeat();
  betMaybeOffer(lines, spin);     // 立刻刷新：消行动画期间 stepOnce 在 syncHud 之前就 return 了
  if (lines <= 0) return;                 // 但不推 FEVER 保底
  if (feverLeft > 0 || feverCool > 0) return;
  feverPity += lines;
  if (rndFx() < feverPity / PITY_DIV){ feverPity = 0; feverStart(); }
}

function feverStart(){
  if (feverCool > 0) return false;    // 冷静期里不开，两个来源都走这道门
  // 下面成功路径最后 return true，别留一个「失败 false / 成功 undefined」的半吊子
  feverLeft = FEVER_MS;
  activePal = 'classic';
  staticDirty = true; previewDirty = true; needsDraw = true;
  document.body.classList.add('fever');
  showToast('FEVER  ×' + FEVER_MULT);
  buzz([40, 30, 40, 30, 90]);
  sfx('tetris', 1.26);
  syncTempo();
  return true;
}
function feverEnd(){
  feverLeft = 0;
  feverCool = FEVER_COOL;        // 冷静期从这里开始走
  syncTempo();
  activePal = null;
  staticDirty = true; previewDirty = true; needsDraw = true;
  document.body.classList.remove('fever');
  setTempo(baseBpm);
}


// ═══════════ 第二批：方块变异 ═══════════
//
// 概率跟着「一局多少块」走，不是拍脑袋定的。
// 难度提上去之后一局只剩 97~160 块（原来 770），旧概率下休闲档六局才见一次
// 炸弹 —— 最带感的两个东西等于白做。按新的块数重新反推。
// 这几个概率原先是照着机器人「一局一百多块就死」调的，人类一局能落六百块，
// 于是实测变成每 6.7 块就有一个变异块 —— 15%，变异成了常态。而且比例是反的：
// 最没戏的金块 60 个，最有戏的激光 3 个。
// ⚠ 下面这段「总量 5.4% / 一局六百块 ≈ 33 个 / 金 16」是**四种变异块时代**的数字，
//    加了灌注 / 分流 / 染色（合计 2.2%）、金块又从 1/38 调到 1/24 之后已经作废。
//    现在总量 9.2%（六百块 ≈ 55 个、金块 25 个），每 10.9 块一个。
//    说明书那条是现算的所以没错，错的只有这段注释 —— 按它反推平衡会偏七成。
//    原文保留做沿革：重调到总量 5.4%（一局六百块 ≈ 33 个），顺带把四种拉平：
//   一局六百块下 ≈ 金 16 / 锤 6.7 / 弹 5.5 / 激 4.6
const MOD_RATES = [
  ['laser',  1 / 130],
  ['bomb',   1 / 110],
  // 灌注比重锤稀一点：它能当场凑满好几行，威力比重锤大
  ['fill',   1 / 120],
  ['hammer', 1 / 90],
  // 分流和染色都不改变盘面高度，只改「铺开方式」和「哪一行值钱」，
  // 所以可以比炸弹激光稠一点
  ['fork',   1 / 140],
  ['dye',    1 / 150],
  ['gold',   GOLD_RATE],
];
const MOD_TINT = { gold:'#ffd23f', bomb:'#ff4d4d', laser:'#7cf4ff', hammer:'#c9a6ff', fill:'#8ef5c0',
                   fork:'#ffa94d', dye:'#ff7ad9' };

// ── 变异块图标 ──
// 原来只靠混色区分，但方块本身有七种颜色，混出来必然撞车 ——
// 实测 I 块+激光 和 I 块原色 都是青的、O 块+金块 和 O 块原色 都是黄的，
// 最该被看见的两个恰好隐形。所以改成画一个图标，颜色只当辅助。
//
// 形状手画不用 emoji：最窄屏格子只有 21px，图标约 12px，emoji 在这个尺寸糊成一团，
// 而且各平台渲染不一致。近白填充 + 深描边，任何底色上都读得出来。
// 一整块只画一个（画在外接框正中），每格一个太吵。
function drawModIcon(c, cx, cy, r, mod){
  c.save();
  c.lineWidth = Math.max(1.3, r * .32);
  c.strokeStyle = 'rgba(6,10,18,.85)';
  c.fillStyle = '#f2f7ff';
  c.lineJoin = 'round';
  c.beginPath();
  if (mod === 'gold'){                       // ◆ 菱形
    c.moveTo(cx, cy - r); c.lineTo(cx + r * .78, cy);
    c.lineTo(cx, cy + r); c.lineTo(cx - r * .78, cy); c.closePath();
  } else if (mod === 'fill'){                // ▮ 实心竖条：下方被塞实
    c.rect(cx - r * .62, cy - r * .86, r * 1.24, r * 1.72);
  } else if (mod === 'hammer'){              // ▼ 下三角
    c.moveTo(cx - r * .88, cy - r * .62); c.lineTo(cx + r * .88, cy - r * .62);
    c.lineTo(cx, cy + r * .82); c.closePath();
  } else if (mod === 'bomb'){                // ● 圆 + 短引线
    c.arc(cx, cy + r * .14, r * .74, 0, Math.PI * 2);
    c.closePath();
    c.moveTo(cx + r * .3, cy - r * .5); c.lineTo(cx + r * .72, cy - r * .95);
  } else if (mod === 'fork'){                // ⋔ 三股下叉：格子各走各的
    c.moveTo(cx, cy - r * .95); c.lineTo(cx, cy - r * .1);
    c.moveTo(cx - r * .8, cy + r * .95); c.lineTo(cx - r * .8, cy - r * .1); c.lineTo(cx + r * .8, cy - r * .1);
    c.lineTo(cx + r * .8, cy + r * .95);
  } else if (mod === 'dye'){                 // ✶ 六角星：和彩虹行同一个意思
    for (let i = 0; i < 6; i++){
      const a = i * Math.PI / 3, b = a + Math.PI / 6;
      if (!i) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else    c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      c.lineTo(cx + Math.cos(b) * r * .42, cy + Math.sin(b) * r * .42);
    }
    c.closePath();
  } else {                                   // ⚡ 竖向折线（激光）
    c.moveTo(cx + r * .42, cy - r);  c.lineTo(cx - r * .48, cy + r * .12);
    c.lineTo(cx + r * .08, cy + r * .12); c.lineTo(cx - r * .38, cy + r);
    c.lineTo(cx + r * .52, cy - r * .16); c.lineTo(cx - r * .04, cy - r * .16);
    c.closePath();
  }
  c.stroke();
  c.fill();
  c.restore();
}

// 图标落在「离质心最近的那个格子」正中，而不是质心本身 ——
// T / L / J / S / Z 这些不对称块的质心在格子交界处，直接画会骑在两行之间。
function modIconOn(c, cells, ox, oy, cell, minX, minY, mod){
  if (!mod) return;
  let sx = 0, sy = 0;
  for (const [dx, dy] of cells){ sx += dx - minX; sy += dy - minY; }
  const n = cells.length, gx = sx / n, gy = sy / n;
  let best = cells[0], bd = Infinity;
  for (const cc of cells){
    const dx = (cc[0] - minX) - gx, dy = (cc[1] - minY) - gy;
    const d = dx * dx + dy * dy;
    if (d < bd){ bd = d; best = cc; }
  }
  const cx = ox + (best[0] - minX + .5) * cell;
  const cy = oy + (best[1] - minY + .5) * cell;
  drawModIcon(c, cx, cy, Math.max(5, cell * .26), mod);
}

// 这一手出变异块的总概率。给说明书和测试用 —— 之前「拾荒接没接上」没有任何
// 纯函数可探，那条断言因此是静默跳过的。
function modRate(rush){
  const k2 = rush ? RUSH_MOD : 1;
  const kMod = upMul('mod');
  return MOD_RATES.reduce((a, [k, rate]) => a + (k === 'gold' ? rate : rate * k2) * kMod, 0);
}

function rollMod(){
  // 自己守一道。两个调用方现在都写了 CRAZY ? rollMod() : null，标准版是干净的，
  // 但那意味着正确性挂在「每个调用方都记得判」上 —— 新加一处忘了判，
  // 变异块就会漏进标准版，而标准版的卖点正是「纯 Guideline，什么都不加」。
  // heatMult / deepMult / crazyScoreMult 都是自己守的，这里保持一致。
  if (!CRAZY || upNever('mod')) return null;        // 孤注：这局不出变异块
  // 狂欢局里三种「干活的」变异翻倍，金块不翻 —— 它只是纯加分，翻了加分不加戏
  // 狂欢局的 RUSH_MOD 刻意不翻金块（翻了加分不加戏），但拾荒原来搭了同一班车，
  // 于是卡面写「+50%」实际只有 +27%。给拾荒单独一条线，它要能吃到金块。
  const k2 = game.rush ? RUSH_MOD : 1;
  const kMod = upMul('mod');
  let r = rndFx();
  for (const [k, rate] of MOD_RATES){
    const p = (k === 'gold' ? rate : rate * k2) * kMod;
    if (r < p) return k;
    r -= p;
  }
  return null;
}

// 六种干活的变异块各解决一类困境，不互相重复：
//   重锤=减堆 / 激光=挖井 / 炸弹=炸开 / 灌注=填实 / 分流=铺平 / 染色=指定彩虹行
// （原来写的是「四种」，分流和染色是后加的）
function crazyApplyMod(p){
  if (!CRAZY || !p.mod || p.mod === 'gold') return;
  if (p.mod === 'bomb')   bombAt(p);
  if (p.mod === 'laser')  laserAt(p);
  if (p.mod === 'hammer') hammerAt(p);
  if (p.mod === 'fill')   fillAt(p);
  if (p.mod === 'fork')   forkAt(p);
  if (p.mod === 'dye')    dyeAt(p);
}

// 分流：锁定之后这块的格子**各自**垂直落到底，像沙子一样散开。
//
// 和重锤的区别要说清楚，否则两个看起来都是「往下掉」：
// 重锤是整列塌实 —— 连带把这块下面原有的洞一起挤掉，堆会明显变矮。
// 分流只动这块自己的格子 —— 堆高几乎不变，但它能顺着起伏铺开，
// 正好治「盘面高低不平，哪块放上去都架空」这种局面。
function forkAt(p){
  const cells = cellsOf(p.type, p.rot)
    .map(([dx, dy]) => [p.x + dx, p.y + dy])
    .filter(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < TOTAL_ROWS)
    .sort((a, b) => b[1] - a[1]);                    // 从最低的格子开始，免得互相挡路
  const floor = zoneFloor();
  let moved = 0;
  for (const [x, y] of cells){
    const v = game.board[y][x];
    if (!v) continue;
    let ny = y;
    while (ny + 1 < floor && !game.board[ny + 1][x]) ny++;
    if (ny === y) continue;
    game.board[y][x] = null;
    game.board[ny][x] = v;
    moved++;
    if (ny >= BUFFER) boom(x, ny, MOD_TINT.fork);
  }
  if (!moved) return;
  staticDirty = true; needsDraw = true;
  sfx('drop', .9); buzz([20, 12, 20]);
}

// 染色：锁定之后，这块占到的最低那一行变成彩虹行。
// 复用彩虹行那套（消到它时那一次得分 ×2），所以它不是第八种新规则，
// 是「你自己决定把彩虹标在哪一行」—— 彩虹行本来是随机挑的。
function dyeAt(p){
  if (!game.started) return;
  const ys = cellsOf(p.type, p.rot).map(([, dy]) => p.y + dy).filter(y => y >= BUFFER && y < zoneFloor());
  if (!ys.length) return;
  rainRow = Math.max(...ys);
  rainLeft = RAIN_MS * upMul('rain');
  staticDirty = true; needsDraw = true;
  popScore(CELL * COLS / 2, (rainRow - BUFFER) * CELL, '彩虹行', '×' + rainMult(), 'rain');
  sfx('level', 1.3); buzz([25, 15, 35]);
}

// 灌注：落点下方那几列，空格全部填成实心。
//
// 激光开井、地震把边列推掉，都会留下又深又窄、几乎填不回去的空。
// 重锤是把上面的砖掉下来（堆变矮，行不一定凑满），灌注是把下面塞满
// （堆高不变，行直接凑满，常常当场就消）—— 两者方向相反，不重复。
//
// 和「填实」事件的区别在于**你能选位置**：事件是随机全盘挑洞，
// 这个是你自己决定扔在哪，所以它是个可规划的工具，不是运气。
function fillAt(p){
  const cells = cellsOf(p.type, p.rot);
  const cols = new Set(cells.map(c => p.x + c[0]));
  // 每一列从这块的最底下那格往下找，空的就填实
  const bottom = {};
  for (const [cx, cy] of cells){
    const x = p.x + cx, y = p.y + cy;
    if (bottom[x] == null || y > bottom[x]) bottom[x] = y;
  }
  let n = 0;
  for (const x of cols){
    if (x < 0 || x >= COLS) continue;
    for (let y = bottom[x] + 1; y < TOTAL_ROWS; y++){
      if (!game.board[y][x]){ game.board[y][x] = GARBAGE; n++; boom(x, y, '#8ef5c0'); }
    }
  }
  if (!n) return;
  staticDirty = true; needsDraw = true;
  // 专属表现：被灌的那一段自上而下扫一道绿光（像灌水），配上行音。
  // 原来只有通用的 boom 碎屑 + shake，和重锤一模一样 —— 而两者效果相反，
  // 一个把堆压矮、一个把洞填平，玩家分不出刚才发生了什么。
  const ys = [];
  for (const x of cols) for (let y = bottom[x] + 1; y < TOTAL_ROWS; y++) ys.push(y);
  if (ys.length) sweepRows(ys, '#8ef5c0');
  clearFullNow();            // 填满的行要正常消掉（冻结行、梭哈计数都走这里）
  shake(false);
  sfx('drop', .66); sfx('level', .9);
  buzz([30, 20, 50]);
}

// 让这几列里的格子落下去填掉下方的空洞。
// 俄罗斯方块本身没有这种重力，所以它只能是特效，必须有明确的视觉来源。
function collapseCols(cols){
  const floor = zoneFloor();                   // 塌实只在死行之上进行
  for (const x of cols){
    if (x < 0 || x >= COLS) continue;
    let w = floor - 1;
    for (let y = floor - 1; y >= 0; y--){
      const v = game.board[y][x];
      if (!v) continue;
      game.board[w][x] = v;
      if (w !== y) game.board[y][x] = null;
      w--;
    }
  }
  staticDirty = true; needsDraw = true;
  clearFullNow();
}

// 压实和爆炸都可能直接把某几行凑满。这些行必须当场清掉：
//   1) 留在盘面上「满了却不消」是明显的 bug 观感；
//   2) 攒到下一次锁定会凑出 5、6 行的超额消除，而记分表只到 4 行 ——
//      [0,100,300,500,800][5] 是 undefined，乘出来整个分数变 NaN。实测踩过。
// 不走 scoreFor：它不是玩家摆出来的消行，不该吃 combo / B2B / 全消那套加成。
// 给行数和热度，不直接给分 —— 热度会把回报体现在之后的每一次消行上。
function clearFullNow(){
  // 跟正常锁定那条路一样分两路：带冰的只解冻不消。
  // 不分的话，炸弹/重锤/压实能一次打掉冰冻行，绕过「要消两次才掉」的规则 ——
  // 同一个盘面状态，换个来源就换套规矩，说明书也对不上。
  const full = [], thaw = [];
  for (let y = 0; y < TOTAL_ROWS; y++){
    if (!game.board[y].every(c => c)) continue;
    // 沉在底部的 ZONE 行天生就是「满」的，不能当满行消掉 —— 它们要等 ZONE 结束一起结算
    if (CRAZY && game.board[y].every(c => c === ZONE)) continue;
    if (CRAZY && game.board[y].some(c => c === FROZEN)) thaw.push(y); else full.push(y);
  }
  if (thaw.length) crazyThaw(thaw);
  if (!full.length) return 0;
  for (const y of full) burstRow(y);
  sweepRows(full, '#9bffdc');
  // 分要在 applyClear 之前算好行号（塌陷之后 full 里的 y 就没意义了），
  // 也要在 game.lines 推进之前算 —— levelMult 用的是这一消之前的等级，
  // 跟 scoreFor 那条路保持一致。
  const n = full.length;
  const base = n <= 4 ? [0, 100, 300, 500, 800][n] : 800 + (n - 4) * 300;
  const rainOn = rainHit(full);
  const gain = Math.round(base * levelMult(game.level) * crazyScoreMult() * (rainOn ? rainMult() : 1));
  if (rainOn) rainBoom();
  const py = (full.reduce((a, b) => a + b, 0) / n - BUFFER + .5) * CELL;
  applyClear(full);
  game.score += gain;
  // 刻意不推 combo / b2b / run.tetris：那三个是奖励「连续的、亲手打出来的消除」，
  // 让道具清出来的行去推它们，等于白送下一次真消除的加成。
  if (game.run && gain > game.run.bestHit) game.run.bestHit = gain;
  popScore(CELL * COLS / 2, py, '+' + groupInt(gain), n >= 2 ? n + ' 行' : '', 'tool');
  game.lines += n;
  if (CRAZY){ heat += heatGain(n, null, false); betResolve(n); }
  const lv = Math.floor(game.lines / LINES_PER_LEVEL) + 1;
  if (lv > game.level){ game.level = lv; flashLevel(); syncEdge(); }
  sfx('clear', 1.1);
  return full.length;
}

// 炸弹：炸掉周围一圈，然后让受影响的列塌下来。
// 只炸不塌等于在盘面中间留一个洞 —— 那是帮倒忙。塌陷才让它成为「减堆」的手段。
function bombAt(p){
  const cols = new Set(), kill = new Set();
  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const x = p.x + cx + dx, y = p.y + cy + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) continue;
      kill.add(y * COLS + x); cols.add(x);
    }
  }
  const floor = zoneFloor();
  for (const k of kill){
    const y = (k / COLS) | 0, x = k % COLS;
    if (y >= floor) continue;                  // 死行是地板，炸不动
    if (y >= BUFFER && game.board[y][x]) boom(x, y, '#ff7a4d');
    game.board[y][x] = null;
  }
  collapseCols(cols);
  burstRing([p.y + 1], '#ff7a4d');
  shake(true); sfx('tetris', .7); buzz([50, 30, 70]);
}

// 激光：从落点正下方打穿一整列。开出来的那口井正好是打 TETRIS 要的形状。
function laserAt(p){
  const cells = cellsOf(p.type, p.rot);
  const xs = cells.map(c => c[0]);
  const cx = p.x + Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  if (cx < 0 || cx >= COLS) return;
  // 整块连同下方那一列一起汽化。
  // 只打一列的话，方块落在别的列上的那几格会悬在半空 —— 看着像 bug 不像特效。
  const floor = zoneFloor();                   // 死行是地板，激光打不穿
  for (const [dx, dy] of cells){
    const x = p.x + dx, y = p.y + dy;
    if (x < 0 || x >= COLS || y < 0 || y >= floor) continue;
    if (y >= BUFFER && game.board[y][x]) boom(x, y, '#7cf4ff');
    game.board[y][x] = null;
  }
  const top = p.y + Math.min(...cells.map(c => c[1]));
  for (let y = Math.max(top, 0); y < floor; y++){
    if (y >= BUFFER && game.board[y][cx]) boom(cx, y, '#7cf4ff');
    game.board[y][cx] = null;
  }
  beams.push({ x: cx, t: 0 });
  while (beams.length > 2) beams.shift();
  staticDirty = true; needsDraw = true;
  shake(true); sfx('tspin', 1.3); buzz([30, 20, 30, 20, 60]);
}

// 重锤：一个方块都不炸，只把落点这几列压实 —— 埋着的洞消失，堆高跟着降。
// 它是三个里唯一「纯修复」的，不改变任何格子的存在，只改位置。
function hammerAt(p){
  const cols = new Set(cellsOf(p.type, p.rot).map(c => p.x + c[0]));
  collapseCols(cols);
  for (const x of cols) if (x >= 0 && x < COLS) boom(x, TOTAL_ROWS - 1, '#c9a6ff');
  shake(false); sfx('drop', .72); buzz(40);
}

// 一颗格子被处理掉时的碎屑。粒子有 110 颗硬上限，这里只给两颗，
// 免得一发激光把整条列的碎屑吃光了预算，把消行粒子挤掉。
function boom(x, y, color){
  for (let i = 0; i < 2; i++)
    particles.push({
      x: (x + .5) * CELL, y: (y - BUFFER + .5) * CELL,
      vx: (rndFx() - .5) * 260, vy: (rndFx() - .5) * 220,
      life: .9, color, size: CELL * .19,
    });
}

// ── 落地压扁 ──
// 锁定那一瞬把方块竖直压一下再弹回来。一局要触发八十多次，是整套反馈里
// 单位成本收益最高的一项。
//
// 做法是「这几格暂时不画进静态层，改由主画布带缩放画」：方块锁定时格子
// 已经写进 game.board 了，drawStatic 会照常画它们，所以必须让 drawStatic
// 跳过这几格，否则压扁的那层会叠在原尺寸的上面。
// 代价是一次锁定多两次全量静态重绘（开始、结束各一次），实测可忽略。
let squash = null;              // { keys:Set, color, t }
const SQUASH_MS = 95;

function startSquash(p){
  const keys = new Set();
  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy;
    if (by >= BUFFER) keys.add(by * COLS + (p.x + cx));
  }
  if (!keys.size) return;
  squash = { keys, color: colorOf(p.type), t: 0 };
  staticDirty = true; needsDraw = true;
}

function stepSquash(dt){
  if (!squash) return;
  squash.t += dt;
  needsDraw = true;
  if (squash.t >= SQUASH_MS){ squash = null; staticDirty = true; }
}

function drawSquash(){
  const k = squash.t / SQUASH_MS;
  const sy = 1 - Math.sin(Math.PI * k) * .17;   // 先压到 .83 再弹回 1
  for (const key of squash.keys){
    const y = (key / COLS) | 0, x = key % COLS;
    const px = x * CELL, py = (y - BUFFER) * CELL;
    ctx.save();
    // 以格子底边为锚点缩放，看着才像「砸实了」而不是「缩小了」
    ctx.translate(px, py + CELL);
    ctx.scale(1, sy);
    ctx.translate(-px, -(py + CELL));
    drawCell(ctx, px, py, CELL, squash.color, {});
    ctx.restore();
  }
}

let beams = [];                 // 激光柱 { x, t }
const BEAM_MS = 260;

// ── 消行余烬 ──
// 消掉的行以前是「一下没了」。留几百毫秒的余烬，那一下才有重量。
// 不走粒子数组（110 颗的预算已经被 burstRow 吃掉一大半），自己一条。
let embers = [];                // { y0, y1, color, t, dots:[[x,y,r]...] }
const EMBER_MS = 820;

function addEmbers(rows, color){
  if (!rows.length || !CELL) return;
  const y0 = Math.max(Math.min(...rows), BUFFER), y1 = Math.max(...rows);
  if (y1 < BUFFER) return;
  const dots = [];
  for (let i = 0; i < 14; i++)
    dots.push([rndFx(), rndFx(), .25 + rndFx() * .5]);   // 归一化坐标，画的时候再乘尺寸
  embers.push({ y0, y1, color, t: 0, dots });
  while (embers.length > 3) embers.shift();
}

function drawEmbers(){
  const W = COLS * CELL;
  for (const e of embers){
    const k = e.t / EMBER_MS, a = (1 - k) * (1 - k);     // 平方衰减，尾巴收得干净
    const top = (e.y0 - BUFFER) * CELL, h = (e.y1 - e.y0 + 1) * CELL;
    ctx.save();
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0,  rgba(e.color, 0));
    g.addColorStop(.5, rgba(e.color, .30 * a));
    g.addColorStop(1,  rgba(e.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, h);
    ctx.globalAlpha = a;
    ctx.fillStyle = e.color;
    for (const [dx, dy, dr] of e.dots){
      const sz = CELL * dr * (1 - k * .6);
      ctx.fillRect(dx * W - sz / 2, top + dy * h - sz / 2 - k * CELL * .7, sz, sz);
    }
    ctx.restore();
  }
}

// ── 屏幕裂纹 ──
// 堆到危险区时棋盘顶上裂开，越危险裂得越深。
// 走向一次性生成，不是每帧随机 —— 每帧重抖会变成噪点，不像裂纹。
// 第一版画成了横贯全盘的长直线，看着像划痕：现在只从顶边往下短促地裂，
// 长度随危险度增长，而且越往下越淡。
const CRACKS = (() => {
  let seed = 0x9e3779b9;
  const r = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 8) & 0xffff) / 0xffff; };
  const out = [];
  for (let i = 0; i < 7; i++){
    const pts = [[.06 + r() * .88, 0]];
    let x = pts[0][0], y = 0;
    for (let k = 0; k < 7; k++){
      x = Math.min(.98, Math.max(.02, x + (r() - .5) * .17));
      y += .09 + r() * .07;
      pts.push([x, y]);
    }
    out.push(pts);
  }
  return out;
})();

// 只给疯狂版。标准版这一版之后的表现要保持不变，纯视觉也不例外。
function drawCracks(){
  // 蹭 syncDanger 已经算好的 dangerLeft，不另外扫一遍盘面 ——
  // topFilledRow 是 220 格的扫描，stepOnce 里那段注释专门写过「不该每帧多跑一次」，
  // 而这里原来做的正是那段注释禁止的事（syncHud 每帧一次 + draw 每帧一次）。
  const left = dangerLeft;                // 离顶还有几行，syncDanger 存的
  if (left >= 99) return;                 // 空盘
  if (left > 6) return;
  const k = Math.min(1, (6 - left) / 6);  // 0 → 1，越危险越开
  const W = COLS * CELL, H = ROWS * CELL;
  const reach = H * (.10 + k * .24);      // 最深也只到三分之一板高
  const n = Math.max(1, Math.round(k * CRACKS.length));
  const line = (pts, upto, alpha, wide) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(.8, CELL * wide);
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, 0);
    for (let j = 1; j <= upto; j++) ctx.lineTo(pts[j][0] * W, pts[j][1] * reach);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff5c6e';
  for (let i = 0; i < n; i++){
    const pts = CRACKS[i];
    line(pts, pts.length - 1, .07 + k * .13, .030);   // 整条，很淡
    line(pts, 3,              .14 + k * .26, .050);   // 近顶那段，浓一点
  }
  ctx.restore();
}

// ═══════════ 第三批：盘面事件 ═══════════
//
// 硬规则：所有捣乱事件必须提前预告。没预告的随机惩罚不是疯狂，是耍赖 ——
// 玩家只会觉得游戏在作弊。三坏一好，必须有天上掉馅饼的时刻。
const EV_WARN   = 3000;         // 预告多久
const EV_FIRST  = 45000;        // 开局多久来第一次
const EV_MIN    = 20000;        // 最密
const EV_TAU    = 240000;       // 加密的时间常数
// 事件池原来 8 个里只有 1 个对玩家有利（压实），占权重 15.8% —— 事件等于
// 纯惩罚，看到预告只会皱眉，没有任何期待感。
// 现在压实权重翻倍、另加「缓流」，有利占比提到 38.5%：预告弹出来时
// 「可能是好事」才成立，事件才从惩罚变成赌头。
//
// 曾经还有个「填实」事件（全盘挑最靠下的洞塞实），实测太强 —— 它不要你
// 做任何事就把盘面救回来，而且是随机白送的，把难度直接抹平了。已删除。
// 同名的**变异块**「灌注」保留：那个要你自己选落点，是工具不是运气。
const EVENTS = [
  { key:'blackout', name:'暗幕',   tip:'方块要隐形了', bad:true,  ms:5000, w:3 },
  { key:'mirror',   name:'镜像',   tip:'左右要对调了', bad:true,  ms:8000, w:3 },
  { key:'quake',    name:'地震',   tip:'整堆要平移了', bad:true,  ms:0,    w:2 },
  // 权重一直是 6，中间短暂提到过 9，又放回来了。记一下那次来回：
  //
  // 加了顺风/重影/拾穗之后池子从 26 涨到 35，压实份额被摊薄到 17.1%
  // （原本 23.1%），于是提到 9 想补回来。但同一次改动里还解开了事件钟的堵塞
  // （限时事件在跑时瞬发事件也能进来），那一下**独自**就让压实多了约 1.24 倍。
  // 两件事叠在一起实测 0.233 → 0.400 次/分钟，直接过头了。
  //
  // 放回 6：份额 17.1%，实际频率约 0.29 次/分钟 —— 仍比摊薄前的 0.233 高
  // 两成多，但那是靠解堵拿到的，不是靠把权重灌大。
  { key:'compact',  name:'压实',   tip:'洞要被填上了', bad:false, ms:0,    w:6 },
  { key:'calm',     name:'缓流',   tip:'灰线要停了',   bad:false, ms:9000, w:4 },
  { key:'freeze',   name:'冰冻',   tip:'有一行要冻住了', bad:true,  ms:0,    w:2 },
  { key:'wind',     name:'狂风',   tip:'方块要被吹偏了', bad:true,  ms:7000, w:2 },
  { key:'wall',     name:'封锁',   tip:'有一列要封了',   bad:true,  ms:9000, w:2 },
  { key:'slam',     name:'瞬落',   tip:'方块要直接砸到底', bad:true,  ms:6000, w:2 },
  // ↓ 2026-10-03 内容扩充。事件是数据驱动的，加一条只要加表项 + 一个钩子。
  { key:'tail',     name:'顺风',   tip:'热度要翻倍了',     bad:false, ms:8000, w:4 },
  { key:'blind',    name:'重影',   tip:'落点虚影要没了',   bad:true,  ms:7000, w:2 },
  { key:'glean',    name:'拾穗',   tip:'手牌要变好了',     bad:false, ms:0,    w:3 },
];
let evTimer = 0, evWarnLeft = 0, evPending = null, evActive = null, evLeft = 0, evBeep = 0;
let wallCol = -1;        // 列封锁：这一列当墙，collides 里直接判撞
let windTimer = 0;       // 狂风：每隔一会儿把下落中的方块吹偏一格

// 列封锁只挑边上那几列。出生区在 3~6 列，封在那儿会让新方块一出来就撞死 ——
// 那不是难度，是判定 bug。
const WALL_COLS = [0, 1, 2, 7, 8, 9];

function doWall(){
  const busy = new Set(game.piece ? cellsOf(game.piece.type, game.piece.rot).map(c => game.piece.x + c[0]) : []);
  const pool = WALL_COLS.filter(x => !busy.has(x));
  if (!pool.length) return false;
  wallCol = pool[(rndFx() * pool.length) | 0];
  needsDraw = true;
  return true;
}

// 冰冻行：把某一行已有的格子冻住。冻住的行凑满时不消，只解冻 ——
// 要消两次才掉。状态直接存在盘面格子里（FROZEN 这个类型），
// 所以塌陷、灰线上顶、地震平移它都会跟着走，不用另维护一张表。
function doFreeze(){
  const rows = [];
  // 死行不能冻。它「有格子」且「不含冰」，两条筛选条件都满足，所以原来会被选中 ——
  // 而冻掉一行死行的后果是连锁的：那行不再是 every(c === ZONE)，zoneFloor() 当场
  // 从死行上沿跳回盘底，**剩下所有死行同时失去保护**（炸弹/激光/地震从此能啃）；
  // zoneEnd 的 filter 也认不出它，行留在盘底而奖金照 zoneRows 全额发。
  // 另外七个动盘面的工具都守了 zoneFloor()，就这个漏了。
  const floor = zoneFloor();
  for (let y = BUFFER; y < floor; y++)
    if (game.board[y].some(Boolean) && !game.board[y].some(c => c === FROZEN)) rows.push(y);
  if (!rows.length) return false;
  const y = rows[(rndFx() * Math.min(rows.length, 6)) | 0];   // 从最上面几行里挑，别冻在深处看不见
  for (let x = 0; x < COLS; x++) if (game.board[y][x]) game.board[y][x] = FROZEN;
  staticDirty = true; needsDraw = true;
  // 原来冻完一声不响，只有通用的事件音 —— 玩家不知道是哪一行被冻了。
  // 给那一行一道霜白扫过，位置就讲清楚了。
  sweepRows([y], '#bfe9ff');
  sfx('lock', 1.6);
  return true;
}

// 解冻：凑满的冰冻行不消，变回普通灰块，下一次凑满才真的掉
function crazyThaw(rows){
  for (const y of rows){
    for (let x = 0; x < COLS; x++) if (game.board[y][x] === FROZEN) game.board[y][x] = GARBAGE;
    burstRow(y);
  }
  staticDirty = true; needsDraw = true;
  // 「行凑满了却不消」是全游戏最容易被当成 bug 的瞬间，解释必须看得见。
  // 原来走 showToast，而 toast 是共享通道 —— 解冻往往和消行同时发生，
  // 那一下正好会被消行的 toast 顶掉，等于没解释。改走 pop。
  if (CELL && rows.length){
    const py = (rows.reduce((a, b) => a + b, 0) / rows.length - BUFFER + .5) * CELL;
    popScore(CELL * COLS / 2, py, '冰裂', '再消一次才掉', 'thaw', 1.05);
  }
  sfx('rotate', .72); buzz([25, 20, 25]);
}

function evPeriod(){
  return EV_MIN + (EV_FIRST - EV_MIN) * Math.exp(-game.elapsed / EV_TAU);
}

// 濒死时排掉的事件。按「会不会直接判死」分，不是按好坏分 ——
// 原来是「濒死只发好事」，但八个事件里只有压实一个是好的，于是濒死 =
// 每次事件必定压实，每二十秒白送一次清洞，保命绳成了免死金牌。
//
// 这四个在濒死时是真的没得救：冰冻要你多消一次、封锁堵掉一列、
// 地震平移整堆、瞬落夺走边落边调整。发它们就是耍赖。
// 暗幕 / 镜像 / 狂风 只是让操作变难，濒死时正该紧张，放回来。
const EV_DEADLY = new Set(['freeze', 'wall', 'quake', 'slam', 'blind']);

function pickEvent(instantOnly){
  const safe = stackTopRow() > DANGER_ROW + 3;
  // instantOnly：已经有限时事件在跑，这一次只能抽瞬发的
  const pool = EVENTS.filter(e => (safe || !EV_DEADLY.has(e.key)) && (!instantOnly || !e.ms));
  if (!pool.length) return null;
  // 狂欢局里坏事件更密。安全时不给好事件加权 —— 压实是填洞的，
  // 加权等于送，那是把难度往下调；只有濒死时才翻倍，当保命绳。
  const wt = (e) => e.w
    * (game.rush && e.bad ? RUSH_BAD : 1)
    * (!safe && !e.bad ? 2 : 1);
  let total = pool.reduce((a, e) => a + wt(e), 0), r = rndFx() * total;
  for (const e of pool){ if ((r -= wt(e)) < 0) return e; }
  return pool[pool.length - 1];
}

function evStepSchedule(dt){
  // ZONE 期间事件钟**整个**停住，包括已经在倒数的预警和正在跑的限时事件。
  // 原来这道门禁写在函数中段，上面两段先跑掉了 —— 于是待发事件的三秒预警
  // 照常倒数并点火，而盘面讲解框明写着「重力 / 灰线 / 事件全停」。
  if (zoneLeft > 0) return;
  if (evPending){
    evWarnLeft -= dt;
    evBeep -= dt;
    if (evBeep <= 0){ evBeep = 1000; sfx('rotate', 1.6); }
    // 同理：压实走 collapseCols → clearFullNow → applyClear，也会重排行号。
    // 预警已经走完就等动画落地，别在 260ms 里动盘面。
    if (evWarnLeft <= 0 && !clearing) evFire();
    return;
  }
  // 限时事件在跑的时候，钟**照走** —— 原来这里直接 return，等于只要有一个
  // 限时事件挂着（暗幕/镜像/狂风…平均 7.5 秒），整个事件钟完全停住，
  // 连瞬发的压实也进不来。限时事件占池子 22/35，这个堵塞很可观。
  //
  // 现在只挡住「限时叠限时」：暗幕 + 镜像 + 狂风 同时上是灾难，而且状态框
  // 只有三槽也显示不了。
  //
  // ⚠ 更正：pickEvent 的 instantOnly 这条路**当前常量下走不到**。
  // evTimer 在排出预告那一刻清零，而预警期间本函数整段早退，所以它是从
  // 「事件点着那一刻」才开始走的；下一次排期最早要 EV_MIN = 20 秒之后，
  // 而最长的限时事件（缓流 / 封锁）只有 9 秒 —— 两者永远不重叠。
  // 压实从 0.233 涨到 0.400 次/分钟，功劳全在「钟不再被限时事件堵住」这一半，
  // 不是「瞬发事件能插进来」。instantOnly 留着是防御性的：
  // 谁把 EV_MIN 调小或把某个事件的 ms 调大过 20 秒，它就会当场生效。
  if (evActive && evLeft > 0){ evLeft -= dt; if (evLeft <= 0) evEnd(); }
  evTimer += dt;
  if (evTimer < evPeriod()) return;
  evTimer = 0;
  evPending = pickEvent(!!evActive);
  if (!evPending) return;              // 过滤之后可能一个都不剩
  evWarnLeft = EV_WARN; evBeep = 0;
  showToast(`${evPending.name}　${evPending.tip}`);
  const b = $('evwarn');
  if (b){ b.textContent = evPending.name; b.dataset.bad = evPending.bad ? '1' : '0'; b.classList.add('on'); }
}

function evFire(){
  const e = evPending; evPending = null;
  const b = $('evwarn'); if (b) b.classList.remove('on');
  if (!e) return;
  if (e.ms <= 0) flashEvent(e);          // 瞬发的没时长，闪一下表示刚发生过
  if (e.key === 'quake')   doQuake();
  if (e.key === 'compact') doCompact();
  if (e.key === 'freeze' && !doFreeze()) return;    // 空盘冻不了，当没发生
  if (e.key === 'wall'   && !doWall())   return;
  if (e.key === 'calm'){ sfx('hold', .7); sweepRows([TOTAL_ROWS - 1], '#5fe0c8'); }
  if (e.key === 'glean') doGlean();
  if (e.ms > 0){
    evActive = e; evLeft = e.ms;
    document.body.dataset.ev = e.key; staticDirty = true; needsDraw = true;
    if (e.key === 'blackout') setMuffle(true);      // 看不见 + 听不清，压迫感翻倍
    if (e.key === 'wind') windTimer = 0;
    if (e.key === 'mirror') clearHeld();
  }
  sfx(e.bad ? 'over' : 'level', 1);
  buzz(e.bad ? [60, 40, 60] : 40);
}

function evEnd(){
  const was = evActive && evActive.key;
  evActive = null; evLeft = 0;
  if (was === 'blackout') setMuffle(false);
  if (was === 'wall') wallCol = -1;
  if (was === 'mirror') clearHeld();
  delete document.body.dataset.ev;
  staticDirty = true; needsDraw = true;
}

// 地震：整堆左右平移一格。推出边界的那一列直接丢掉 ——
// 换成「撞墙不动」的话它就不是灾难了，而灾难正是它存在的意义。
function doQuake(){
  const dir = rndFx() < .5 ? -1 : 1;
  const floor = zoneFloor();
  for (let y = 0; y < floor; y++){             // 死行不跟着震：推出边界会把它打成半截
    const row = game.board[y], out = new Array(COLS).fill(null);
    for (let x = 0; x < COLS; x++){
      const nx = x + dir;
      if (nx >= 0 && nx < COLS) out[nx] = row[x];
    }
    game.board[y] = out;
  }
  staticDirty = true; needsDraw = true; shake(true);
}

// 拾穗：队列最前面几块直接变成变异块。
// 它和别的有利事件不一样 —— 不改盘面也不改规则，改的是**接下来几手的手牌**，
// 所以它的好处要等你自己把牌打出来才兑现，不是白送。
const GLEAN_N = 3;
function doGlean(){
  if (!CRAZY || upNever('mod')) return;              // 孤注这局不出变异块
  const pool = MOD_RATES.map(r => r[0]);
  let n = 0;
  for (let i = 0; i < Math.min(GLEAN_N, game.mods.length); i++){
    if (game.mods[i]) continue;                      // 本来就是变异块就不浪费
    game.mods[i] = pool[(rndFx() * pool.length) | 0];
    n++;
  }
  if (!n) return;
  previewDirty = true; needsDraw = true;
  sfx('level', 1.2); buzz([30, 20, 30]);
}

// 只压最漏的几列，不是全盘。全盘压实等于把所有洞一次填平，一大片行同时凑满、
// 当场全清 —— 实测 18 层的满屏盘面一下压到 9 层、白送 9 行。
// 那不叫「帮你一把」，那是把局面重置了。
const COMPACT_COLS = 3;
function doCompact(){
  const holes = [];
  for (let x = 0; x < COLS; x++){
    let seen = false, h = 0;
    for (let y = 0; y < TOTAL_ROWS; y++){
      if (game.board[y][x]) seen = true; else if (seen) h++;
    }
    if (h > 0) holes.push([x, h]);
  }
  if (!holes.length) return;
  holes.sort((a, b) => b[1] - a[1]);
  collapseCols(new Set(holes.slice(0, COMPACT_COLS).map(v => v[0])));
  shake(false);
  // 原来只有一下震屏，连音都没有 —— 有利事件的表现一直弱于有害事件，
  // 玩家潜意识会学成「事件 = 要倒霉」，哪怕权重已经接近对半。
  sfx('drop', .85); buzz([30, 20, 30]);
}

// 缓流：灰线暂停。不加分不消洞，纯粹给你一段喘息去整理盘面 ——
// 它的价值随你堆得多高而变，堆得越险越值钱，所以不是白送。
const evCalm = () => CRAZY && evActive && evActive.key === 'calm';
const evTail  = () => CRAZY && evActive && evActive.key === 'tail';   // 顺风：消行热度翻倍
const evBlind = () => CRAZY && evActive && evActive.key === 'blind';  // 重影：落点虚影没了
// 缓流原来只有一圈边框换色，太含蓄 —— 它的价值（灰线停了）恰恰体现在
// 那根预警条上，所以表现就该做在预警条上：停住 + 变青 + 一声「停」。

const evBlackout = () => CRAZY && evActive && evActive.key === 'blackout';
// 镜像：左右键对调。挂在 press 上，DAS 连发也跟着换向
const evMirror   = () => CRAZY && evActive && evActive.key === 'mirror';
// 瞬落 = 20G：方块一出生就贴到底。
// 锁定延迟照旧，所以落地之后仍然能左右滑、能转 —— 失去的只是「边落边调整」
// 那一段，你得提前想好落点。做成真正的零控制没意义：六秒等于随机砸三四块，
// 那不是难度，是判定。
const evSlam     = () => CRAZY && evActive && evActive.key === 'slam';
// 瞬落时放宽锁定延迟。20G 本身不难，难的是「贴底之后只剩半秒调整」——
// 那半秒里你既要看清落点又要滑过去，配 500ms 就不是难度是反应力测试。
// 标准的 20G 玩法都会给更长的锁定窗口，这里给 1.8 倍。
function lockDelay(){ return (evSlam() ? LOCK_DELAY * 1.8 : LOCK_DELAY) * upMul('lock'); }

// ═══════════ 彩虹行 ═══════════
//
// 填的是「目标感」这个缺口：除了活下去刷分，盘面上没有任何别的目标。
// 标记一行，消到它时那一次消行得分翻倍，消掉或超时就换一行。
//
// **平均贡献先算过再定倍率**（燃点 v1 和无洞连击链两次翻车都是栽在没算）：
// 按深局堆高 10~15 行、一次消行平均 1.5 行、每 4 秒一次消行模拟，
// ×2 让整局分数平均涨 13%，×3 涨 33%。取 ×2 —— 梯子档间距是 1.5~2 倍，
// 13% 不到五分之一档，不用重标。机制的价值本来也是「有个目标」，
// 不是倍率本身。
const RAIN_MS = 30000;      // 多久没消掉就换一行
const RAIN_MULT = 2;        // 消到它时那一次的得分倍率
// 彩练那张卡加厚的就是这个数。说明书和飘字都读这里，不会和实际脱节。
function rainMult(){ return RAIN_MULT * upMul('rainmult'); }
let rainRow = -1, rainLeft = 0;

// 挑一行来标。要求：在可见区内、有格子、不是整行冰冻（那行消不掉）。
function rainPick(){
  if (!CRAZY || !game.started || game.over){ rainRow = -1; return; }
  const cand = [];
  // 死行区不参与：那几行是 ZONE 的地板，消不掉，标在上面等于这局彩虹行白费
  const floor = zoneFloor();
  for (let y = BUFFER; y < floor; y++){
    const row = game.board[y];
    if (!row.some(Boolean)) continue;
    if (row.every(c => c === FROZEN)) continue;
    cand.push(y);
  }
  rainRow = cand.length ? cand[(rndFx() * cand.length) | 0] : -1;
  rainLeft = RAIN_MS * upMul('rain');
  needsDraw = true;
}

// 彩虹行指示器。不画在 canvas 上 —— 盘面之内不放常驻装饰，这条规矩是撞出来的：
//   v1「整行用 lighter 刷彩色 + 压 75% 白框」：方块被洗白、空格被涂满，
//      看着像渲染故障，第一反应是「这是什么？」
//   v2「上下两道细线夹住那一行」：不盖格子了，但两条横线横穿盘面照样是噪声。
//   v3「画在 canvas 右边缘的三角」：不横穿了，但还是压着最后一列 44%。
//   v4（现在）：DOM 元素挂在棋盘右框**外侧**，一个格子都挡不到。
// 顺带它在 .shaker 外面，所以震屏时不跟着抖 —— 它是边框上的指示器不是盘面元素。
let rainMarkSig = '';
function syncRainMark(){
  const el = $('rainMark');
  if (!el) return;
  const on = CRAZY && rainRow >= BUFFER && CELL > 0 && !game.over;
  const sig = on ? rainRow + '/' + CELL : '';
  if (sig === rainMarkSig) return;               // 只在真的变了的时候写 DOM
  rainMarkSig = sig;
  el.hidden = !on;
  if (!on) return;
  const h = CELL * .25, w = CELL * .27;   // h 是半高，所以三角实际高 2h
  el.style.setProperty('--rm-h', h.toFixed(1) + 'px');
  el.style.setProperty('--rm-w', w.toFixed(1) + 'px');
  el.style.top = ((rainRow - BUFFER) * CELL + CELL / 2 - h).toFixed(1) + 'px';
}

function rainStep(dt){
  if (!CRAZY) return;
  if (rainRow < 0){ rainPick(); return; }
  // 标记的那行可能被灰线顶出去、或被道具炸没了
  if (rainRow < BUFFER || !game.board[rainRow] || !game.board[rainRow].some(Boolean)){ rainPick(); return; }
  if ((rainLeft -= dt) <= 0) rainPick();
}

// 这一次消行有没有消到彩虹行。rows 是即将被清掉的行号。
function rainHit(rows){
  return CRAZY && rainRow >= 0 && rows.includes(rainRow);
}

// 盘面塌陷之后要跟着挪：被清掉的行在标记行**下方**时，标记行的下标会 +1
// （0 是顶、TOTAL_ROWS-1 是底，清掉一行会让它上方的行整体下移一格）。
function rainBoom(){
  if (!CELL) return;
  // 走 pop 不走 toast —— 彩虹行命中几乎必然和消行同时发生，
  // toast 那一下正好会被消行的 toast 顶掉
  const y = (rainRow - BUFFER + .5) * CELL;
  popScore(CELL * COLS / 2, y, '×' + rainMult(), '彩虹行', 'rain', 1.2);
  for (let x = 0; x < COLS; x++) boom(x, rainRow, '#ff6bd6');
  sfx('tetris', 1.42); buzz([35, 20, 35, 20, 60]);
}

function rainShift(rows){
  if (!CRAZY || rainRow < 0) return;
  if (rows.includes(rainRow)){ rainPick(); return; }
  if (zoneLeft > 0){
    // ZONE 下的位移和普通塌陷**方向相反**：地板在涨，所以消行**之上**的堆
    // 原地不动，消行**之下**的堆被抬高。普通塌陷正好反过来（之上的往下落）。
    rainRow -= rows.filter(y => y < rainRow).length;
    if (rainRow < BUFFER || rainRow >= zoneFloor()) rainPick();
    return;
  }
  rainRow += rows.filter(y => y > rainRow).length;
  if (rainRow >= TOTAL_ROWS) rainPick();
}

// ═══════════ 挪列 ═══════════
//
// 补的是一个很硬的缺口：**玩家对已经落地的盘面完全无力**。
// 炸弹 / 激光 / 重锤 / 灌注全都绑在「某一块落下的那一瞬间」，错过就没了，
// 而盘面一旦摆坏，你只能眼睁睁看着它一直坏下去。
//
// 做法是交换相邻两列的全部格子。这个定义有个关键性质：
// **它不可能减少洞，也不可能凑出满行**（每一行里只是两个格子互换，
// 行满不满、每列自己有几个洞，全都不变。2 万次随机盘面验证过）。
// 所以它纯粹是个「重新摆位」的工具，不白送任何东西 ——
// 对数值平衡几乎零风险，不用重标梯子。
//
// 代价比换牌贵不少：换牌只影响当前这一块，挪列改的是整个盘面的结构。
const SWAP_COST = 420;
let swapSel = -1;            // 选中的列，-1 = 没选

function canSwap(){
  return CRAZY && game.started && !game.over && !game.paused && !clearing;
}

// 点盘面：第一下选列，第二下点相邻列就交换。点同一列或不相邻的列＝改选。
function swapTap(col){
  if (!canSwap()) return;
  if (col < 0 || col >= COLS) return;
  if (swapSel < 0){
    if (heat < SWAP_COST){ showToast(`热度不够　挪列要 ${SWAP_COST}`); sfx('lock', .8); return; }
    swapSel = col; needsDraw = true;
    sfx('rotate', .9); buzz(12);
    return;
  }
  if (Math.abs(col - swapSel) !== 1){        // 不相邻：当成改选
    swapSel = (col === swapSel) ? -1 : col;
    needsDraw = true; sfx('rotate', .9); buzz(12);
    return;
  }
  if (heat < SWAP_COST){ showToast(`热度不够　挪列要 ${SWAP_COST}`); swapSel = -1; needsDraw = true; return; }
  doSwap(swapSel, col);
}

function doSwap(a, bcol){
  for (let y = 0; y < TOTAL_ROWS; y++){
    const row = game.board[y];
    const t = row[a]; row[a] = row[bcol]; row[bcol] = t;
  }
  heat -= SWAP_COST;
  swapSel = -1;
  staticDirty = true; needsDraw = true;
  heatQuant = -1; syncHeat(); syncEdge(); syncFx();
  // 交换不会凑出满行（见上面的性质），所以不用走 clearFullNow。
  // 但冰冻行可能被挪到别处，静态层重画即可。
  for (const x of [a, bcol]) boom(x, TOTAL_ROWS - 1, '#9fb4d0');
  shake(false); sfx('drop', .8); buzz([25, 15, 25]);
  showToast(`挪列　−${SWAP_COST} 热度`);
}

// ═══════════ 换牌 ═══════════
//
// 点 NEXT 槽，花热度把当前这块换成下一块。
//
// 热度原来只能攒，是个纯被动的数字。让它同时是货币之后，每隔几秒就多一个
// 真决策：这块 S 我放不下，换不换？换了倍率掉一截，不换就得挖个洞。
// 梭哈十秒才来一次，这个每块都在。
//
// 被换下来的那块塞回队列尾部而不是丢掉 —— 丢掉等于白嫖 7-bag 的保证，
// 而且你还能看见它什么时候回来。
// 15 → 45，跟着热度平台一起 ×3。
// 换牌要是个真决策（「这块 S 我放不下，换不换？换了倍率掉一截」），
// 代价就得是热度的固定比例。15 在旧平台 103 上是 15%、倍率掉 ×0.95，
// 在新平台 309 上只剩 5%、倍率掉 ×0.21 —— 等于白送。
// 45 → 220。真人实测峰值热度约 7400（机器人只有 550，之前全是按机器人标的），
// 45 只占 0.6% —— 换牌本该是个真决策，那个代价等于白送。
const REROLL_COST = 220;

function canReroll(){
  return CRAZY && game.started && !game.over && !game.paused && !clearing && !!game.piece;
}

function rerollPiece(){
  if (!canReroll()) return;
  if (heat < REROLL_COST){ showToast(`热度不够　换牌要 ${REROLL_COST}`); sfx('lock', .8); return; }
  heat -= REROLL_COST;
  const t = game.queue.shift(), m = game.mods.shift();
  game.queue.push(game.piece.type);
  game.mods.push(game.piece.mod || null);
  spawn(t, m);
  fillQueue();
  if (game.run) game.run.rerolls++;
  heatQuant = -1; syncHeat(); syncEdge(); syncReroll();
  showToast(`换牌　−${REROLL_COST} 热度`);
  sfx('hold', 1.22); buzz(18);
}

// 够不够换，让 NEXT 槽自己看得出来
function syncReroll(){
  if (!CRAZY) return;
  const el = $('nextSlot');
  if (el) el.classList.toggle('ready', canReroll() && heat >= REROLL_COST);
}

// ═══════════ 梭哈 ALL-IN ═══════════
//
// 整套机制里唯一「主动选择承担风险」的地方。抽奖给不了这种心跳，
// 因为抽奖不是你的决定。
// 旧版是「赢 = 那一手热度注入 ×2（TETRIS 只多拿 16 点），输 = 热度清零」。
// 这是个陷阱：收益固定而代价随热度暴涨，热度 162 时要赢到 96% 才不亏，
// 正确玩法永远是「不接」—— 整套机制里唯一的主动决策等于是废的。
// 现在两边都跟着热度走，不亏线稳定在 45~53%，是个接近公平的赌。
// 任务也从「消任意一行」提到「消两行以上」—— 前者对会打的人几乎白送，
// 配上公平赔率就变成「永远接」，跟以前一样不是决策，只是反过来。
const BET_MS = 10000;
// 盘面上的提示只停这么久，之后交给右侧状态框。
// 十秒的横幅等于十秒看不见方块；但完全不在盘面上露面又容易整局都没注意到它弹过。
// 三秒是「看得见」和「不碍事」的折中。
// 盘面提示：可点的东西先在盘面上亮这么久，之后只留在右侧状态栏。
// 原来是梭哈专用的（当时定 3 秒），现在 ZONE 和缓期共用 —— 侧栏只有 64px，
// 一个按钮冒出来玩家根本不知道那是什么、要不要点，盘面上这几秒是唯一
// 能把话说完的地方。
const ACT_SHOW = 5000;
const BET_SHOW = ACT_SHOW;    // 旧名字留着，betStep / 导出面还在用
const BET_LOSE = .5;     // 输：热度减半
// 分档给奖励。为什么高档系数要拉得这么开：奖励挂在热度上，而热度倍率过了
// 拐点是开方压的，系数的差会被压扁 —— 照「2行×1.8 / 5行×3.0」那组算，
// 热度 80 时屏幕上只差 20%，拼死多消三行不值。现在 5 行的净收益是 2 行的
// 3.4 倍，档位才读得出来。
const BET_TIERS = [[2, 1.6], [3, 2.0], [4, 2.8], [5, 4.0]];
const BET_NEED = BET_TIERS[0][0];   // 够不到这个就是输
const BET_CAP  = BET_TIERS[BET_TIERS.length - 1][0];
function betMult(lines){
  let m = 0;
  for (const [n, k] of BET_TIERS) if (lines >= n) m = k;
  return m;                          // 0 = 没达标
}
// 弹出的门槛比完成的门槛高：三行或 T-spin 才弹，接了之后两行就算过。
// 放宽到「两行就弹」实测太吵 —— 两行消除本来就常见，加上赢完那一刻
// betMaybeOffer 会在同一次消行里再跑一遍，能连着弹。
const BET_OFFER_NEED = 3;
const BET_COOL = 25000;   // 结算之后冷静这么久，别贴脸连弹
let betLines = 0;         // 接了之后累计消了几行
// 24 → 72，跟着热度平台一起 ×3。24 在新平台上只占 8%，门槛恒为真等于没有。
// 72 → 370。同上，72 占真人峰值热度不到 1%，门槛恒为真等于没有。
// 原来是 370，注释写的理由是「热度太低时赌没意思」—— 这个推理是反的。
// 梭哈赔的是**热度 ×1.6~4**，乘法是免标度的：热度 30 翻四倍和热度 3000
// 翻四倍，比例上一样值钱。把一个「热度倍增器」锁在「先有高热度」后面，
// 恰好堵死了它最该解决的问题 —— 前期热度起不来。
//
// 实测六局：热度跨过 370 的中位行数是 **72 行**（48/65/67/72/76/77）。
// 也就是说七十行以内的局，梭哈从来不可能出现。
//
// 现在只留一个极低的地板，而且理由是纯数学的：热度 0 的时候 ×4 还是 0，
// 梭哈会变成一次空转 —— 玩家接了、赢了、屏幕上什么都没变。
// 30 这个值机器人大约 5 行就到了，玩家感知上等于「没有热度条件」。
const BET_MIN_HEAT = 30;
let betCool = 0;
let betOffer = 0, betLeft = 0, betShow = 0;

// 弹出。原来是盘面正中偏上一条 291×67 的横幅，压住第 1.8~4 行整整十秒 ——
// 那正是方块出生之后你还在左右挪、看形状的那一段，等于十秒看不见自己在放什么。
// 调透明度救不了：背后是彩色方块，前面是金字加亮黄按钮，调到能看见方块的程度
// 文字自己也糊了，而且那个按钮照样吃掉下面的点击。
// 现在盘面上只闪一次飘字（走消行飘字那条通道，不到一秒自己飘走，全程不挡），
// 「接受」挪进右侧状态框 —— 那儿本来就是机制状态区，接了之后的进度条也在那儿。
function betMaybeOffer(n, spin){
  if (!CRAZY || betLeft > 0 || betOffer > 0 || betCool > 0) return;
  if (!(n >= BET_OFFER_NEED || spin) || heat < BET_MIN_HEAT) return;
  betOffer = BET_MS;
  // 梭哈直接亮，不等 actStep 那一帧，也不吃冷却 —— 它十秒就过期，错过就没了
  actLast = 'bet'; actSeen.bet = game.elapsed;
  actFlash('bet');
}

// 盘面提示收掉。接受 / 过期 / 重开都要调，不然它会挂在那儿
// 此刻最该被点的那个动作。优先级和状态框里 act() 的一致 ——
// 两处必须同源，否则会出现「盘面提示 A、侧栏按钮 B」。
// 盘面横幅现在只服务梭哈 —— 它是唯一还要你当场做决定的机制。
// ZONE 和缓期都改成自动触发了，它们有 toast、有音效、有盘面染色，
// 不需要再占一块横幅；而横幅一旦服务「每行灰线都会重来一次」的缓期，
// 五秒的停留会让它几乎一直挂着，从提示变成墙纸。
function actNow(){
  if (!CRAZY || game.over || !game.started) return '';
  if (betOffer > 0) return 'bet';
  // ZONE 讲解期间保持住 —— 不然 actStep 下一帧就把它当「动作没了」收掉，
  // 五秒的停留会缩成一帧
  if (actKind === 'zoneinfo' && betShow > 0) return 'zoneinfo';
  return '';
}

// 每个动作在盘面上怎么自我介绍。档位表之类只有这里讲得下，侧栏塞不进。
function actText(kind){
  if (kind === 'bet')
    return '<b>梭哈</b>' + (BET_MS / 1000) + ' 秒内消 ' + BET_NEED + '~' + BET_CAP + ' 行<br>'
         + BET_TIERS.map(([n, m]) => n + '行 ×' + m).join('　') + '　不足 ' + BET_NEED + ' 行减半'
         + '<br><i>点这里或右侧「接受」</i>';
  if (kind === 'zone')
    return '<b>ZONE</b>' + (ZONE_MS / 1000) + ' 秒内重力 / 灰线 / 事件全停<br>'
         + '消掉的行沉到底部，结束时按行数平方给奖金'
         + '<br><i>点这里或右侧「启动」</i>';
  if (kind === 'zoneinfo')
    // 四行封顶。原来写了六行，最后一句直接撑出框外。
    return '<b>ZONE</b>' + (ZONE_MS / 1000) + ' 秒　重力 / 灰线 / 事件全停<br>'
         + '消掉的行沉到盘底，地板跟着涨（最多 ' + ZONE_MAX + ' 行）<br>'
         + '结束时一次清空，奖金按行数<b>平方</b>算，再乘当时倍率'
         + '<br><i>' + ZONE_EG.map(k => k + '行+' + Math.round(ZONE_UNIT * k * k / ZONE_CURVE)).join('　') + '</i>';
  if (kind === 'delay')
    return '<b>缓期</b>花 ' + delayCost() + ' 热度，把灰线往回推 ' + (DELAY_MS / 1000) + ' 秒<br>'
         + '每行灰线只能缓一次'
         + '<br><i>点这里或右侧「缓期」</i>';
  return '';
}

// 同一类动作多久之内不重复在盘面上亮。
// 不限的话后期会出事：灰线每七秒一行、缓期每行都重新可用，而提示要亮五秒 ——
// 横幅几乎一直挂着，就从「提示」变成「墙纸」了。
// 梭哈本来就有 25 秒冷却、ZONE 要攒二十行，所以这条实际只约束缓期。
const ACT_COOL = 30000;
let actKind = '';     // 盘面提示正在介绍哪个动作
let actLast = '';     // 上一帧的 actNow()，用来做边沿检测
const actSeen = {};   // 每类动作上次在盘面上亮的时刻

function actFlash(kind){
  const tx = $('betFlashTxt'), el = $('betFlash');
  if (!tx || !el) return;
  // info 类（ZONE）是纯讲解，不是号召点击 —— 点它不该有任何反应
  el.classList.toggle('info', kind === 'zoneinfo');
  actKind = kind;
  betShow = ACT_SHOW;
  tx.innerHTML = actText(kind);
  el.dataset.act = kind;
  el.classList.add('on');
  el.setAttribute('aria-hidden', 'false');
  // toast 默认在盘面 14% 处，正好落在横幅（5%~31%）中间。横幅亮着时把它推下去。
  document.body.classList.add('flashing');
  sfx('hold', 1.3); buzz([25, 40, 25]);
  syncFx();
}

// 每帧看一眼「该点的动作」变了没有。只在**变成另一个动作**时才亮，
// 不然缓期每行灰线都会重新弹一次。
function actStep(dt){
  if (!CRAZY) return;
  const now = actNow();
  if (now !== actLast){
    actLast = now;
    if (!now){ betFlashHide(); return; }
    const last = actSeen[now];
    if (last == null || game.elapsed - last >= ACT_COOL){
      actSeen[now] = game.elapsed;
      actFlash(now);
    } else {
      // 冷却里就只留侧栏那行，盘面不打扰
      syncFx();
    }
  }
}

function betFlashHide(){
  actKind = '';
  document.body.classList.remove('flashing');
  betShow = 0;
  const el = $('betFlash');
  if (el){ el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }
}

// 梭哈结算。两条消行路径都要走这里 —— 原来只有正常锁定那条调，
// 道具和压实清出来的行（clearFullNow）根本不算数，实测一局接了 34 次只赢 2 次。
// 消行时只累加，不当场结算 —— 结算放到窗口结束，这样十秒里你会一直想
// 再多挤一行。唯一的例外是消满上限，那就没必要干等了，直接封顶收。
function betResolve(lines){
  if (!CRAZY || betLeft <= 0 || lines <= 0) return;
  betLines += lines;
  if (betLines >= BET_CAP) betSettle();
}

// 赢了给**分数**，不给热度。
//
// 原来是 heat *= m —— 乘在热度**存量**上，而热度的衰减时间常数是 135 秒、
// 梭哈一个周期只有 35 秒（10 秒窗口 + 25 秒冷却）。一轮的净增益是
// m × exp(-35/135)，四个档位分别是 1.23 / 1.54 / 2.16 / 3.09 —— **全部大于 1**，
// 也就是说只要胜率够高，热度是几何发散的，没有任何上界兜住。
//
// 而胜率可以做到接近 1：ZONE 期间重力、灰线、事件全停，十秒摆满 5 行几乎必成，
// 且 ZONE 里的消行照算 betLines（实测 1014 → 4152，×4.09）。ZONE 每 20 行自动开、
// 梭哈冷却 35 秒，两者频率天然咬合。于是最优解只剩「ZONE 一开就接梭哈消满」一条。
//
// 整套机制里别的加成都是有界的（FEVER/燃点/金块已改成相加、ZONE 有封顶、
// 深局线性、levelMult 是 L^0.75），唯独这一个乘在存量上。
//
// 调参数救不了：要让顶档净增益 ≤ 1，冷却得拉到 187 秒（机制就废了），
// 或者把顶档压到 ×1.3（赌的意义没了）。只能改结构。
//
// 现在的形状：**押的是热度，赢的是分数**。分数不会反过来喂自己，闭环断掉；
// 「大起大落」的手感保留（输了照样热度减半）；而且奖金乘的是你当时的总倍率，
// 所以热度攒得高、赌赢了拿得多 —— 热度仍然是它的燃料，只是不再自我复制。
const BET_UNIT = 120;        // 每行的奖金基数，和消行 base(100~800) 同量级
function betSettle(){
  const m = betMult(betLines);
  betLeft = 0; betCool = BET_COOL; betHide();
  if (m > 0){
    const gain = Math.round(BET_UNIT * betLines * m * levelMult(game.level) * crazyScoreMult());
    game.score += gain;
    if (game.run){
      game.run.betWins++;
      if (gain > game.run.bestHit) game.run.bestHit = gain;
    }
    syncHud();
    // 不能只靠 toast —— 它是共享通道，赢完紧接着可能触发 FEVER，
    // 后来的 toast 会把「梭哈成功」顶掉，看起来就像没结算。
    betPop(betLines + ' 行　×' + m, '梭哈成功 +' + fmtScore(gain), 'win');
    showToast(`梭哈成功　${betLines} 行　+${fmtScore(gain)}`);
    sfx('tetris', 1.3); buzz([30, 20, 30, 20, 80]);
  } else {
    heat *= BET_LOSE;
    betPop('热度 ÷2', `梭哈失败　只有 ${betLines} 行`, 'lose');
    showToast('赌输了　热度减半');
    sfx('over', .8); buzz([90, 60, 90]);
  }
  heatQuant = -1; syncHeat(); syncEdge();
}

// 梭哈的结算走飘字，摆在盘面中间偏上，跟消行飘字错开
function betPop(label, text, kind){
  if (!CELL) return;
  popScore(CELL * COLS / 2, CELL * ROWS * .34, text, label, 'bet ' + kind, 1.05);
}

// 状态框里的按钮现在有三种，统一在这里分发
// 状态框和盘面横幅上的按钮点下去走这里。
// ZONE 和缓期改成自动触发之后就不再有按钮了（actNow 只会返回 'bet' / 'zoneinfo' / ''，
// fxRows 里唯一带 go 的是 betoffer），所以那两个分支已经到不了，删掉。
// 留着 zoneinfo 这条：横幅在讲解 ZONE 时是可点的，点下去应当什么都不做。
function fxAct(act){
  if (act === 'zoneinfo') return;     // 纯讲解，点它不该有任何反应
  betAccept();
}

function betAccept(){
  if (!CRAZY || betOffer <= 0) return;
  betOffer = 0; betLeft = BET_MS; betLines = 0;
  if (game.run) game.run.bets++;
  betHide();
  showToast(`梭哈！十秒内消 ${BET_NEED}~${BET_CAP} 行`);
  sfx('tetris', 1.15); buzz([40, 30, 40]);
}

function betHide(){
  betFlashHide();
  document.body.classList.toggle('betting', betLeft > 0);
  syncFx();
}

function betStep(dt){
  if (betCool > 0) betCool -= dt;
  // ACT_SHOW 一到就把盘面让出来，右侧那行照旧走完十秒
  // （原来写死「三秒」，而这个值 10-03 已经改成 5 秒）
  if (betShow > 0 && (betShow -= dt) <= 0) betFlashHide();
  if (betOffer > 0){
    betOffer -= dt;
    if (betOffer <= 0){ betOffer = 0; betCool = BET_COOL; betHide(); }   // 没理会也冷却
  }
  if (betLeft > 0){
    betLeft -= dt;
    document.body.classList.add('betting');
    if (betLeft <= 0) betSettle();
  }
}

// ───────────────────────── 主循环 ─────────────────────────

// 一步逻辑。不画、不排 rAF —— 这样 harness 能脱离真实时钟高速驱动。
// 返回 'stop' / 'clearing' / 'normal'，由调用方决定怎么画。
function stepOnce(dt){
  if (game.paused || game.over || game.frozen) return 'stop';
  // NES 模式整个接管：它有自己的盘面和逐帧计时，下面这些普通局的东西一样都不跑
  if (nes) return nesStep(dt);
  // 报幕这三秒：不累加 elapsed（否则灰线钟和热度衰减白跑三秒），也不生成方块。
  // 这里绝不能 return 'stop' —— tick 见到 stop 会把 rAF 停掉，三秒后没人拉得起来。
  if (introLeft > 0){
    introLeft -= dt;
    if (introLeft <= 0) endRushIntro();
    return 'normal';
  }
  // 判断放在调用处：普通局每帧连这一次函数调用都不付（实测它是普通局里唯一被采样到的新功能函数）
  if (drill) drillStep(dt);
  if (vs) vsStep(dt);

  stepParticles(dt);
  stepTrails(dt);
  stepFx(dt);
  stepSquash(dt);
  stepHeart(dt);
  // 危险区计时。蹭 syncDanger 已经算好的 dangerOn，不另外扫一遍盘面 ——
  // topFilledRow 是 220 格的扫描，不该每帧多跑一次
  if (game.run){
    if (dangerOn){ game.run.dangerMs += dt; game.run.wasDanger = true; }
    // 险中求生：进过危险区，又清回安全线。这是真本事，值得被看见。
    else if (game.run.wasDanger && dangerLeft >= 10){
      game.run.wasDanger = false;
      game.run.saves++;
      if (CRAZY){ heat += 12; heatQuant = -1; syncHeat(); syncEdge(); tip('活过来了', 3000); }
    }
  }
  crazyStep(dt);
  crazyClocks(dt);
  handleAutoRepeat(dt);

  // 灰线倒计时（消行动画期间不推进，免得叠在一起）
  if (feverLeft > 0){
    feverLeft -= dt;
    if (feverLeft <= 0) feverEnd();
  }
  zoneStep(dt);
  zoneAuto();
  delayAuto();
  actStep(dt);
  upStep();
  if (!clearing && game.piece){
    game.elapsed += dt;
    // FEVER 期间灰线暂停 —— 这比「重力减半」有感知得多（重力本来就不痛）
    // 不涨灰线的时候（练习 / T 旋练习关着灰线）钟也不走：原来照走，T 旋练习中途打开灰线会一下涨好几行
    if (feverLeft <= 0 && !evCalm() && zoneLeft <= 0 && !game.noGarbage) garbageTimer += dt;   // FEVER / 缓流 / ZONE 都冻结灰线钟
    const period = garbagePeriod();
    // 所有事件都有三秒预告，偏偏真正杀你的灰线是无声的。补一道。
    // 看着像削难度，其实是加紧张感 —— 你会盯着它倒数，然后决定这三秒
    // 要不要再赌一块。也只有知道它什么时候来，「压哨」才谈得上抢。
    // 只给疯狂版。这条其实对标准版也是好的（真正杀你的东西本来就该有预告），
    // 但标准版的表现一直承诺不动，要加得单独说。
    syncGarbageWarn(CRAZY && !game.noGarbage && feverLeft <= 0 && !evCalm() && zoneLeft <= 0
                    ? period - garbageTimer : -1);
    if (!game.noGarbage && feverLeft <= 0 && !evCalm() && zoneLeft <= 0 && garbageTimer >= period){
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
      flushInputs();
      saveGame();
    }
    return 'clearing';
  }

  if (game.piece){
    // 瞬落：每帧先把方块推到底。放在重力前面，下面那段自然就空转了。
    // 每帧都做而不是只在出生时做 —— 横移到一个坑上方时它要立刻掉进去，
    // 这才是 20G 的手感。
    if (evSlam()){
      const q = game.piece;
      let d = 0;
      while (!collides(q.type, q.x, q.y + d + 1, q.rot)) d++;
      if (d > 0){ q.y += d; game.lastWasRot = false; needsDraw = true; }
    }
    const g = gravityFor(game.level);
    const speed = softDropping ? g / SOFT_DROP_FACTOR : g;
    // ZONE 期间重力停 —— 手动软降/硬降照常，所以限制你的是摆放速度不是重力。
    // 这是 ZONE 和 FEVER 手感不同的根源：FEVER 是被动吃倍率，ZONE 是主动抢时间。
    if (zoneLeft > 0 || demoRunning) dropTimer = 0; else dropTimer += dt;
    while (zoneLeft <= 0 && dropTimer >= speed){
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
      if (!demoRunning) lockTimer += dt;
      const phase = Math.min(4, (lockTimer / lockDelay() * 5) | 0);
      if (phase !== lockStep){ lockStep = phase; needsDraw = true; }
      if (lockTimer >= lockDelay()) lockPiece();
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

// 真实时钟这一侧夹住补算上限。
//
// **不能夹在 step() 里** —— 那个 600000 是故意的，注释写着「允许一次喂进来
// 一大段，harness 靠这个把一局压到毫秒级」。夹在那里会静默丢数据：局变短、
// 死因分布变形，而所有平衡数字都靠那套 harness 跑。
//
// 夹这一下的理由：rAF 停很久再恢复时 dt 会是几十秒到几分钟，step 会按 100ms
// 切片**全部补算**。实测喂 120 秒：瞬间落 12 块、堆顶到 0、当场判死。
// 现在有 visibilitychange 自动暂停挡着，但那是单点防护。
//
// 250ms = 15 帧，正常卡顿足够补；再长不是卡顿是冻结，宁可丢。
const MAX_CATCHUP = 250;

// 消行动画期间的重绘间隔。平时画面按时间限到 30fps（见 tick 末尾），
// 消行那零点几秒要顺，所以单独放宽 —— 但原来是「每帧都画」，没有上限：
// 60Hz 屏上一秒 60 次，120Hz 屏（iPhone 17 起基础款也是）就变成 120 次，
// 动画看着一样，功耗翻倍。改成按时间封顶到约 60fps：
//   60Hz  帧距 16.7ms ≥ 12 → 每帧照画，行为和原来完全一样
//   120Hz 帧距 8.3ms，隔一帧画一次 → 60fps
// 门槛取 12 而不是 16，是给 60Hz 的帧距抖动留余量（16.4ms 的帧不能被跳掉）。
// 只管画面，逻辑一直按毫秒走 —— 60Hz/120Hz 喂同一套操作，结果逐项一致（实测过）。
const CLEAR_DRAW_MS = 12;

function tick(now){
  rafId = requestAnimationFrame(tick);
  dbg.frames++;
  const dt = Math.min(now - lastFrame, MAX_CATCHUP);
  lastFrame = now;

  const r = step(dt);
  if (r === 'stop'){
    draw();
    needsDraw = false;
    cancelAnimationFrame(rafId);      // 停着就别空转了，恢复时再拉起来
    rafId = 0;
    return;
  }
  if (r === 'clearing'){
    if (now - lastDrawAt >= CLEAR_DRAW_MS){ draw(); lastDrawAt = now; }
    return;
  }

  // 方块匀速往下掉的时候，一秒里其实只有一帧画面变了。
  // 没变就别画——这是手机发烫的主因。
  // 逻辑跑满 60，画面限到 30——这个游戏看不出差别，功耗直接减半
  if ((needsDraw || particles.length || trails.length || clearing) && (drawNow || now - lastDrawAt >= 32)){
    draw();
    lastDrawAt = now;
    needsDraw = false;
    drawNow = false;
  }
}

// 这里曾经有「没事做的时候让循环睡一会儿」（省电）：不按键时循环一秒只醒几次。
// 它前后带出两个手感 bug —— 方块掉落慢了 4~5%、轻点左右滑出去 2~5 格（醒来补算时把
// 「按住多久开始连发」的计时也一起补了）。都修好了，但用户的判断是手感比省那点电重要，
// 整个拿掉，循环回到每帧都跑。别再加回来；要省电先想别的办法。

// ───────────────────────── 输入 ─────────────────────────

const held = { left: false, right: false };
// 按住旋转 / 暂存键的时候下一块正好出来，就让它带着这个动作出场（IRS / IHS）。
// 连着摆块的时候手感顺很多，标准实现都有。只接键盘，屏幕按键不接（见 bindButtons）。
const preHeld = { cw: false, ccw: false, hold: false };
let armPre = false;    // 只有「锁定后自动出的那一块」才吃 IRS/IHS
const repeat = { left: 0, right: 0, started: { left: false, right: false } };

// 两边同时按着：后按的那个方向说了算。原来两边各连发各的，方块在两格之间来回抖、
// 哪边都不走（左手还压着左、右手去按右时就会这样）
let lastDir = 'left';
function handleAutoRepeat(dt){
  for (const dir of ['left', 'right']){
    if (!held[dir]) continue;
    if (held.left && held.right && dir !== lastDir) continue;
    repeat[dir] += dt;
    const thresh = repeat.started[dir] ? ARR : DAS;
    while (repeat[dir] >= thresh){
      repeat[dir] -= thresh;
      repeat.started[dir] = true;
      tryMove(dir === 'left' ? -1 : 1, 0);
    }
  }
}

// 镜像把方向翻过来之后，press 置的是翻转后那一路的 held，
// 而 release 拿到的还是原始按键 —— 直接按原样清就会漏掉真正被置上的那个，
// 于是 DAS 连发一直跑，一点就滑到墙边（实测点一下走四格）。
// 记下这一次按下究竟走的是哪一路，松手按记的那个清。
// 单记一份还不够：按住期间事件可能正好结束，翻不翻转会对不上。
const pressedAs = { left: 'left', right: 'right' };

function press(dir){
  if (nes) return nesPress(dir);
  if (game.over || game.paused) return;
  const d = evMirror() ? (dir === 'left' ? 'right' : 'left') : dir;
  pressedAs[dir] = d;
  held[d] = true;
  repeat[d] = 0;
  repeat.started[d] = false;
  lastDir = d;
  if (!game.piece){ bufferInput(d === 'left' ? 'L' : 'R'); return; }
  tryMove(d === 'left' ? -1 : 1, 0);
}
function release(dir){
  if (nes) return nesRelease(dir);
  const d = pressedAs[dir] || dir;
  pressedAs[dir] = dir;
  held[d] = false;
  repeat[d] = 0;
  repeat.started[d] = false;
  // 另一边还按着：接着往那边走（DAS 重新数）
  const o = d === 'left' ? 'right' : 'left';
  if (held[o]){ lastDir = o; repeat[o] = 0; repeat.started[o] = false; }
}

// 镜像开关的那一刻把两路都松掉。上面记的那份能兜住正常的按下-松手，
// 但手指正按着的时候事件切换，按下和松手分处两种状态，只能在这里一并清干净。
function clearHeld(){
  held.left = held.right = false;
  repeat.left = repeat.right = 0;
  repeat.started.left = repeat.started.right = false;
  pressedAs.left = 'left'; pressedAs.right = 'right';
  inputBuf.length = 0;
}

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft',
  ArrowUp: 'cw', KeyX: 'cw', KeyZ: 'ccw', ControlLeft: 'ccw', ControlRight: 'ccw',
  Space: 'hard', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  KeyP: 'pause', Escape: 'pause', KeyR: 'restart', KeyM: 'mute', KeyF: 'fullscreen',
};

// 面板开着的时候键盘不能穿透到棋盘。原来是穿透的 ——
// 读说明书时按空格会把当前块硬降，按 R 直接重开整局，Esc 更离谱：
// 它映射到 pause，于是背后偷偷暂停，面板还留在原地。
// 手机上没键盘所以一直没撞到，但桌面按 Esc 关弹窗是肌肉记忆。
function topSheet(){
  for (const id of ['leaveSheet', 'midSheet', 'histSheet', 'menuSheet', 'restartSheet', 'nesSheet', 'vsSheet', 'hintSheet', 'drSheet', 'prSheet', 'helpSheet', 'rankSheet', 'styleSheet']){
    const el = $(id);
    if (el && !el.hidden) return el;
  }
  return null;
}

window.addEventListener('keydown', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  e.preventDefault();
  const sheet = topSheet();
  if (sheet){
    // Esc 关掉它，其它键一律吞掉
    if (act === 'pause'){
      if (sheet.id === 'styleSheet') toggleStylePanel(false);
      // 练习弹层把 game.frozen 置上了，直接 hidden 的话方块永远不再掉
      else if (sheet.id === 'prSheet') closePrSheet();
      else if (sheet.id === 'drSheet') closeDrSheet();
      else if (sheet.id === 'hintSheet') closeHintSheet();
      else if (sheet.id === 'nesSheet') closeNesSheet();
      else if (sheet.id === 'restartSheet') closeRestartSheet();
      else if (sheet.id === 'menuSheet') closeMenu();
      else if (sheet.id === 'histSheet') closeHistSheet();
      else if (sheet.id === 'midSheet') closeMidSheet();
      else if (sheet.id === 'leaveSheet') closeLeave(false);
      else if (sheet.id === 'vsSheet') closeVsSheet();
      else { sheet.hidden = true; unfreezeIfIdle(); }   // 玩法说明 / 段位：从菜单进来时这局是冻着的，关了要接着走
    }
    return;
  }
  if (demoRunning) return;
  if (act === 'restart'){ openRestartSheet(); return; }
  if (act === 'pause'){ togglePause(); return; }
  if (act === 'mute'){ toggleMute(); return; }
  if (act === 'fullscreen'){ toggleGameMode(); return; }
  if (!game.started || game.over || game.paused) return;
  if (e.repeat && act !== 'soft') return;
  if (!e.repeat) drillKey(act === 'soft', true);
  kbUsed = true;
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
  // 面板开着也要处理松手：原来直接 return，按住 ← 弹面板、在面板里松手，关掉后方块自己滑到墙边
  const act = KEYMAP[e.code];
  if (!act) return;
  if (act === 'left')  release('left');
  if (act === 'right') release('right');
  if (act === 'soft')  softDropping = false;
  if (act === 'cw')    preHeld.cw = false;
  if (act === 'ccw')   preHeld.ccw = false;
  if (act === 'hold')  preHeld.hold = false;
});

// 顶栏「重开」：各模式重开自己的（每日练习 = 这一段重来；NES = 同一起始等级；对战 = 同一级别）
function modeRestart(){
  if (nes) startNes(nes.start);
  else if (vs) startVs(vs.bot.lv);
  else if (drill) drillRedo();
  else if (mid) startMid(mid.L);
  else restart();
}

// 右上角「重开」先弹这个面板：选了玩法才重开，点关闭就接着打这一局。
// 原来一点就重开 —— 那个键就在暂停旁边，误触一下整局白打。
function restartLabel(){
  if (nes) return '重开 · NES 起始 ' + nes.start + ' 级';
  if (vs) return '再来一局 · 对战 Lv ' + vs.bot.lv;
  if (drill) return '这一段重来';
  if (practice) return '重新开始 · 练习';
  if (tsOn()) return '重新开始 · T 旋练习';
  if (hintMode) return '重新开始 · 提示';
  if (mid) return '重新开始 · 从第 ' + mid.L + ' 行起';
  return '重新开始';
}
function openRestartSheet(){
  const sh = $('restartSheet');
  if (!sh){ modeRestart(); return; }
  const a = $('rsAgain');
  if (a) a.textContent = restartLabel();
  const nb = document.querySelector('#rsModes [data-rs="normal"]');
  if (nb) nb.hidden = !assisted() && !mid;         // 中途开局里也给「普通」：不然回不到从头打的普通局
  sh.hidden = false;
  if (game.started && !game.over) game.frozen = true;
}
function closeRestartSheet(){
  const sh = $('restartSheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  unfreezeIfIdle();
}
// 面板都关了、这局还在：接着走。从重开面板跳去选级别（对战 / NES）再关掉，也落到这里
function unfreezeIfIdle(){
  if (topSheet()) return;
  if (game.started && !game.over && game.frozen){ game.frozen = false; resumeLoop(); }
}
function restartPick(m){
  const sh = $('restartSheet');
  if (sh) sh.hidden = true;
  if (m === 'again') return modeRestart();
  if (m === 'normal'){ if (assisted()) exitPractice(); restart(); return; }   // restart 会清掉 mid
  if (m === 'vs') return openVsSheet();
  if (m === 'nes') return openNesSheet();
  if (m === 'practice'){ startPractice(); openPrSheet(); return; }
  if (m === 'hint') return startHint();
  if (m === 'tspin') return startTspin();
  if (m === 'mid') return openMidSheet();
  if (m === 'drill') return startDrill();
}

// 落底键连点保护：两下落底挨得太近（手抖、屏幕回弹算两次），第二下会把刚出生、
// 还没看清的下一块一起砸下去。只拦屏幕按键，键盘不拦。
const DROP_GUARD_MS = 160;
let lastBtnDrop = -1e9;
function btnHardDrop(){
  // 没东西可落（消行动画中 / NES 等下一块）：这一下不算，也不启动防连点。
  // 原来照样记一次，结果新块出来后真按的那一下落底被当成「连点」吞掉
  const canDrop = nes ? !!(nes.cur && nes.phase === 'fall') : !!game.piece;
  if (!canDrop) return;
  const now = performance.now();
  if (now - lastBtnDrop < DROP_GUARD_MS) return;
  lastBtnDrop = now;
  if (nes){ nesHardDrop(); return; }     // NES 里也是落底，连点保护照样有
  drillKey(false, false);
  hardDrop();
}

// 底部按钮：按住能连发
function bindButtons(){
  const map = [
    ['btnLeft',  () => press('left'),   () => release('left')],
    ['btnRight', () => press('right'),  () => release('right')],
    ['btnSoft',  () => { softDropping = true;  }, () => { softDropping = false; }],
    // 屏幕按键不吃 IRS/IHS：键盘上按住旋转是有意的，触屏上多半是手指还没抬
    // 就去按落底 —— 下一块出生就是转过的，正好落错地方。
    ['btnCw',    () => tryRotate(1),    null],
    ['btnDrop',  () => btnHardDrop(),   null],
    // HOLD 走同一套 touch 处理，不然它比别的键慢半拍（click 要等浏览器确认不是双击/滚动）
    ['holdSlot', () => holdPiece(),     null],
    // 点 NEXT 换牌。标准版里 rerollPiece 开头就 !CRAZY 早退，等于没绑。
    ['nextSlot', () => rerollPiece(), null],
  ];
  for (const [id, down, up] of map){
    const el = $(id);
    if (!el) continue;
    const start = (e) => {
      e.preventDefault();
      // 演示放着的时候手指一碰就会把路径带偏，先挡掉
      if (!game.started || game.over || game.paused || demoRunning) return;
      el.classList.add('active');
          // 每日练习冲刺段数按键（落底在 btnHardDrop 里数，连点被挡掉的那下不算）
      if (id !== 'btnDrop' && id !== 'nextSlot') drillKey(id === 'btnSoft', false);
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
    const s = Math.min(h, w / 7);        // 七种块一排，整套配色一眼看全
    ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].forEach((t, i) => {
      drawCell(c, i * s + (w - s * 7) / 2, (h - s) / 2, s, colorOf(t));
    });
  }
  skin.pal = keep.pal; skin.style = keep.style;
}

function buildStylePanel(){
  const palWrap = $('palOpts'), stWrap = $('styleOpts');
  palWrap.innerHTML = ''; stWrap.innerHTML = '';

  for (const [gname, keys] of PAL_GROUPS){
    const lb = document.createElement('span');
    lb.className = 'pal-grp'; lb.textContent = gname;
    palWrap.appendChild(lb);
    for (const k of keys){
      const b = document.createElement('button');
      b.className = 'seg-btn' + (skin.pal === k ? ' on' : '');
      b.dataset.pal = k;
      b.innerHTML = `<canvas></canvas><span>${PAL_NAMES[k] || k}</span>`;
      b.addEventListener('click', () => { skin.pal = k; applySkin(); });
      palWrap.appendChild(b);
      paintSwatch(b.querySelector('canvas'), k, skin.style, 'row');
    }
  }

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
  endRushIntro();                    // 上一局的报幕没放完就重开，先收干净
  // ── 狂欢局怎么来的 ──
  //
  // 掷骰在**局末**（countRush），结果存进 rush.next.v1；开局只负责**兑现**
  // （takeRush）。掷骰不在开局，是因为开局掷的话没中就重开再掷，30% 等于
  // 想要多少有多少。
  //
  // 但「重开」原来不走局末 —— endGame 根本没跑，所以它只是在反复兑现一个
  // 空标记。打到一半按重开，不管按多少次都掷不出狂欢局。这和玩家的直觉
  // 完全相反：按下重开就是「这局不要了，重新开」，那就该算一局。
  //
  // 现在：重开前，如果这一局已经够得上「有效局」（落够 RUSH_MIN_PIECES 块
  // 或打够 RUSH_MIN_MS），就先补一次局末掷骰，再兑现。
  // 防刷仍然成立 —— 秒开秒重开够不到有效局门槛，掷不了骰。
  if (CRAZY && !FORCE_RUSH && game.started && !game.over && isRealRun()) countRush();
  game.rush = FORCE_RUSH || (CRAZY && takeRush());
  document.body.classList.toggle('rushrun', !!game.rush);
  // 分数格的标签直接写出倍率，跟着 RUSH_MULT 走 —— 写死数字改一次倍率就会过期
  const sl = $('scoreLabel');
  if (sl) sl.textContent = game.rush ? 'SCORE ×' + RUSH_MULT : 'SCORE';
  game.board = newBoard();
  game.bag = [];
  clearTimeout(dieTimer);
  document.body.classList.remove('dying');
  // 这两个都是拿 game.elapsed 比的，而 elapsed 重开会归零 —— 不跟着复位的话，
  // 上一局留下的时刻会变成一个「很久以前」，新一局第一次消行就被判成压哨。
  lastRiseAt = -1e9;
  lastTip = -1e9;
  deepSaid = false;
  gwarnStep = -1;
  game.run = newRun();
  mid = null;                        // 中途开局由 startMid 在 restart 之后再铺
  paceB = midRates().b;
  game.run.aidTs = !!aids.ts && !CRAZY;
  game.queue = [];
  game.mods = [];
  game.holdMod = null;
  game.hold = null;
  game.holdUsed = false;
  game.score = 0;
  game.lines = 0;
  game.level = tsOn() ? tsSpeed : 1;   // T 旋练习重开：停在选的速度（原来掉回 1 级，角标还写着「快」）
  if (tsOn()) tsStats = { tsd: 0, built: 0, miss: 0, filled: 0, waste: 0 };
  game.combo = -1;
  game.b2b = false;
  game.over = false;
  game.paused = false;
  game.frozen = false;
  game.started = true;
  game.garbage = 0;
  game.pieces = 0;
  game.elapsed = 0;
  game.why = '';
  bestBeaten = false;
  // 目标线开局定一次：它依赖 game.rush，而 restart 里 rush 已经定了
  goalNow = CRAZY ? goalScore() : 0;
  goalHit = false;
  dangerOn = false;
  shownScore = 0;
  crazyReset();
  trails.length = 0;
  sweeps.length = 0;
  rings.length = 0;
  squash = null;
  syncEdge();
  garbageTimer = 0;
  staticDirty = true;
  previewDirty = true;
  needsDraw = true;
  particles.length = 0;
  clearing = null;
  softDropping = false;
  held.left = held.right = false;
  inputBuf.length = 0;
  $('overlay').classList.remove('show');
  $('pauseTx').textContent = '暂停';
  // 图标也要复位。原来只改文字不改 path，暂停→重开之后按钮会一直是播放三角
  const pi = $('pauseIc');
  if (pi) pi.setAttribute('d', 'M9.5 6.5v11M14.5 6.5v11');
  fillQueue();
  syncFx();
  if (game.rush) showRushIntro();     // 报幕结束时才 spawnNext
  else spawnNext();
  syncHud();
  // 开局修行仍放在最后：它会发提示、还会 syncHeat/syncEdge/syncFx/syncHud，
  // 得等盘面、队列、报幕都铺好，否则刷的是个半成品
  if (CRAZY) upOffer(UP_FIRST);
  lastFrame = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  sfx('hold');
  syncMusic();
}

function togglePause(){
  if (!game.started || game.over) return;
  // 任何时候都能暂停。原来 FEVER 期间禁暂停，但暂停会把所有计时一起冻住
  // （FEVER 剩余、灰线钟、热度衰减都走 game.elapsed，而 elapsed 在暂停时不涨），
  // 所以拦不住任何便宜，只是在最需要放下手机的时候把人按在座位上。
  game.paused = !game.paused;
  $('pauseTx').textContent = game.paused ? '继续' : '暂停';
  // 暂停时图标换成播放三角，一眼知道再点一下是继续
  $('pauseIc').setAttribute('d', game.paused ? 'M9 6.2 18 12l-9 5.8z' : 'M9.5 6.5v11M14.5 6.5v11');
  const ov = $('overlay');
  if (game.paused){
    ov.dataset.mode = 'pause';
    // 只在够得上有效局之后给「收手」—— 秒开秒收会污染今日局数和狂欢局保底
    const sb = $('stopBtn');
    if (sb) sb.hidden = !(mid ? midPlayed() : isRealRun());   // 中途开局送的那几百块不算
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
  const t = $('muteTx');
  if (t) t.textContent = muted ? '关着 · 点一下打开' : '开着 · 点一下关掉';
}

// 设置面板里的两排三选一
function buildHandlingPanel(){
  const hw = $('handOpts');
  if (!hw) return;
  hw.innerHTML = '';
  for (const k of Object.keys(HANDLING)){
    const b = document.createElement('button');
    b.className = 'seg-btn' + (k === handling ? ' on' : '');
    b.textContent = HANDLING[k].name;
    b.addEventListener('click', () => { setHandling(k); buildHandlingPanel(); });
    hw.appendChild(b);
  }
}
function buildAudioPanel(){
  buildHandlingPanel();
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
    localStorage.removeItem(RECENT_KEY);   // 旧标度的分数留着，线会彻底失真
    localStorage.removeItem(HIST_KEY);     // 历史曲线同理，新旧标度混在一条线上没法看
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

  lockPage();

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

  // 必须包一层：addEventListener 会把 Event 当第一个参数传进去，
  $('startBtn').addEventListener('click', () => restart());
  // ── 顶栏模式切换 ──
  const msw = $('modeSw');
  if (msw){
    msw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      // 点的就是现在这一格：不动（NES / 对战里「普通」亮着，但点它是退回普通局，照旧）
      if (b.classList.contains('on') && !(m === 'practice' && drill) && !(m === 'hint' && tsOn()) && !(m === 'normal' && (nes || vs))) return;
      // 正经局打到一半点「练习 / 提示」：先问一句（这局会存着）。原来一碰就切走，误触一下就离开了
      if ((m === 'practice' || m === 'hint') && liveRun()){ askLeave(m); return; }
      if (m === 'practice' && !practice){ startPractice(); openPrSheet(); }
      else if (m === 'practice' && drill){ startPractice(); openPrSheet(); }
      else if (m === 'hint' && (!hintMode || drill || tsOn())) startHint();
      else if (m === 'normal' && assisted()) exitPractice();
    });
    syncModeSwitch();
  }
  // ── 练习模式接线 ──
  const pb = $('practiceBtn');
  if (pb) pb.addEventListener('click', () => { startPractice(); openPrSheet(); });
  const plv = $('prLevels');
  if (plv){
    plv.innerHTML = [['basic', '基本功'], ['tspin', 'T 旋'], ['combo', '组合']].map(([g, t]) =>
      '<span class="pr-grp">' + t + '</span>' + LEVELS.filter(l => l.group === g).map(l =>
        '<button type="button" data-lv="' + l.k + '">' + l.n + '</button>').join('')).join('');
    plv.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lv]');
      if (!b) return;
      practiceLoad(b.dataset.lv);
      // 先停在弹层里让人把说明读完，点「开始练」再走
      syncPractice();
    });
  }
  const ppc = $('prPieces');
  if (ppc){
    ppc.innerHTML = TYPES.map(t =>
      '<button type="button" data-pc="' + t + '">' + t + '</button>').join('');
    ppc.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pc]');
      if (!b) return;
      closePrSheet();
      practicePick(b.dataset.pc);
    });
  }
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('prMenu',  () => openPrSheet());
  on('prUndo',  () => practiceUndo());
  on('prDemo',  () => { closePrSheet(); practiceDemo(); });
  on('prDone',  () => closePrSheet());
  on('prReset', () => { if (practiceLevel) practiceLoad(practiceLevel.k); closePrSheet(); });
  on('prFree',  () => { startPractice(); closePrSheet(); });
  on('prExit',  () => exitPractice());
  // ── 提示模式：先自己找 / 规则卡 ──
  on('hintHide',  () => toggleHintHide());
  on('hintRules', () => openHintSheet());
  on('hintWhy',   () => openHintSheet());
  on('hintDone',  () => closeHintSheet());
  on('hintHideSw', () => { toggleHintHide(); renderHintSheet(); });
  const hsh = $('hintSheet');
  if (hsh) hsh.addEventListener('click', (e) => { if (e.target === hsh) closeHintSheet(); });
  // ── 经典 NES / 对战 ──
  on('nesBtn', () => openNesSheet());
  on('tsBtn',  () => startTspin());
  on('vsBtn',  () => openVsSheet());
  on('nesGo',  () => startNes(nesPick));
  on('vsGo',   () => startVs(vsPick));
  // 「回普通」：在局里就整个退出，在开局面板上点开的就只是关掉面板
  on('nesExit', () => { if (nes) exitPractice(); else closeNesSheet(); });
  on('vsExit',  () => { if (vs) exitPractice(); else closeVsSheet(); });
  const nlv = $('nesLevels');
  if (nlv) nlv.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nl]'); if (!b) return;
    nesPick = +b.dataset.nl;
    for (const x of nlv.querySelectorAll('[data-nl]')) x.classList.toggle('on', x === b);
    const go = $('nesGo'); if (go) go.textContent = go.textContent.replace(/起始 \d+ 级/, '起始 ' + nesPick + ' 级');
  });
  const vlv = $('vsLevels');
  if (vlv) vlv.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vl]'); if (!b) return;
    vsPick = +b.dataset.vl;
    for (const x of vlv.querySelectorAll('[data-vl]')) x.classList.toggle('on', x === b);
    const go = $('vsGo'); if (go) go.textContent = go.textContent.replace(/Lv \d+/, 'Lv ' + vsPick);
  });
  for (const id of ['nesSheet', 'vsSheet']){
    const sh = $(id);
    if (sh) sh.addEventListener('click', (e) => { if (e.target === sh) (id === 'nesSheet' ? closeNesSheet : closeVsSheet)(); });
  }
  // ── 每日练习 ──
  on('prDaily', () => startDrill());
  on('dailyBtn', () => startDrill());
  on('drGo',    () => drillGo());
  on('drSkip',  () => drillSkip());
  on('drExit',  () => drillExit());
  on('drMenu',  () => openDrSheet());
  on('drRedo',  () => drillRedo());
  const dsh = $('drSheet');
  if (dsh) dsh.addEventListener('click', (e) => { if (e.target === dsh) closeDrSheet(); });
  const psh = $('prSheet');
  if (psh) psh.addEventListener('click', (e) => { if (e.target === psh) closePrSheet(); });
  $('againBtn').addEventListener('click', () => mid ? startMid(mid.L) : restart());
  const openRank = () => openRankSheet();
  $('rankChip').addEventListener('click', openRank);
  const openHelpSheet = () => openHelp();
  $('helpLink').addEventListener('click', openHelpSheet);
  $('helpBtn').addEventListener('click', openHelpSheet);
  // 点状态框开说明书，但点里面的「接受」不算 —— 两个监听器挂在同一个节点上，
  // 按注册顺序跑，接受那条的 stopPropagation 拦不住先注册的这条（它已经执行完了），
  // 所以判断得写在这头。
  $('fxBox').addEventListener('click', (e) => { if (!e.target.closest('.fxgo')) openHelpSheet(); });
  $('fxBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      if (e.target.closest('.fxgo')) fxAct(e.target.closest('.fxgo').dataset.act);
      else openHelpSheet();
    }
  });
  const closeHelp = () => { $('helpSheet').hidden = true; unfreezeIfIdle(); };
  $('helpDone').addEventListener('click', closeHelp);
  $('helpSheet').addEventListener('click', (e) => { if (e.target === $('helpSheet')) closeHelp(); });
  for (const id of ['rankBox', 'careerBox']){
    $(id).addEventListener('click', openRank);
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openRank(); }
    });
  }
  const closeRank = () => { $('rankSheet').hidden = true; unfreezeIfIdle(); };
  $('rankDone').addEventListener('click', closeRank);
  // 点抽屉外面也关掉，免得非得够到底部那个按钮
  $('rankSheet').addEventListener('click', (e) => { if (e.target === $('rankSheet')) closeRank(); });
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  $('restartBtn').addEventListener('click', () => openRestartSheet());
  on('rsAgain', () => restartPick('again'));
  on('rsClose', () => closeRestartSheet());
  const rsm = $('rsModes');
  if (rsm) rsm.addEventListener('click', (e) => { const b = e.target.closest('[data-rs]'); if (b) restartPick(b.dataset.rs); });
  const rsh = $('restartSheet');
  if (rsh) rsh.addEventListener('click', (e) => { if (e.target === rsh) closeRestartSheet(); });
  // 收手：走正常的 endGame 路径，分数全额计入。它不是 buff ——
  // 收手拿到的就是当前分数，继续打只会更高，所以没有刷分动机。
  const sb = $('stopBtn');
  if (sb) sb.addEventListener('click', () => {
    if (!game.started || game.over) return;
    game.paused = false;                 // endGame 之前先解暂停，否则结算页和暂停页会打架
    $('overlay').classList.remove('show');
    endGame('收手');
  });
  $('muteBtn').addEventListener('click', toggleMute);
  bindMenu(); bindHist(); bindMid();
  const lsh = $('leaveSheet');
  if (lsh){
    $('leaveGo').addEventListener('click', () => closeLeave(true));
    $('leaveStay').addEventListener('click', () => closeLeave(false));
    lsh.addEventListener('click', e => { if (e.target === lsh) closeLeave(false); });
  }
  const al = $('aidLineBtn'), at = $('aidTsBtn');
  if (al) al.addEventListener('click', () => setAid('line', !aids.line));
  if (at) at.addEventListener('click', () => setAid('ts', !aids.ts));
  syncAidBtns();
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
  // 挪列：点盘面选列。盘面本来没有任何点击处理，所以不抢任何操作 ——
  // 玩家的手在下面那排键上，点盘面是个明确的意图。
  const bd = $('board');
  if (bd){
    const pick = (e) => {
      if (!canSwap()) return;
      const r = bd.getBoundingClientRect();
      if (!r.width) return;
      const t = (e.touches && e.touches[0]) || e;
      swapTap(Math.floor((t.clientX - r.left) / (r.width / COLS)));
    };
    bd.addEventListener('touchstart', (e) => { e.preventDefault(); pick(e); }, { passive: false });
    bd.addEventListener('click', (e) => { if (!e.detail) return; pick(e); });
  }

  // 接受按钮是 syncFx 用 innerHTML 重建出来的，挂不住监听器，所以走事件委托。
  // 必须 stopPropagation：fxBox 自己是 role=button，冒上去会打开说明书。
  const box = $('fxBox');
  if (box){
    const take = (e) => {
      if (!e.target.closest('.fxgo')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      fxAct(e.target.closest('.fxgo').dataset.act);
    };
    box.addEventListener('touchstart', take, { passive: false });
    box.addEventListener('click', (e) => { if (!e.detail) return; take(e); });
  }
  // 盘面上那三秒的提示也能直接点 —— 画布本身不接受点击，所以不抢任何操作
  const bf = $('betFlash');
  if (bf){
    // 盘面提示现在三个动作共用，按 data-act 分发
    const take = (e) => { e.preventDefault(); fxAct(actKind || 'bet'); };
    bf.addEventListener('touchstart', take, { passive: false });
    bf.addEventListener('click', (e) => { if (!e.detail) return; take(e); });
  }

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

  document.body.classList.toggle('crazy', CRAZY);
  syncRank();
  if (launchedAsApp()) { document.body.classList.add('immersive'); keepAwake(true); }
  syncFsBtn();
  syncMuteBtn();

  // 上次没打完的那局还在，就给个「接着玩」的入口
  syncResume();
  $('resumeSaveBtn').addEventListener('click', () => {
    const save = readSave();
    if (save) restoreGame(save);
  });

  $('overlay').dataset.mode = 'start';
  $('overlay').classList.add('show');
  draw();
}

// 调试出口：在控制台里能看棋盘和当前块，排查手感问题用
window.__tetris = { game, PIECES, TRACKS, SFX_PACKS, CRAZY, NS,
  get heat(){ return heat; }, set heat(v){ heat = v; heatQuant = -1; },
  // 常量全导出：说明书对账脚本靠这个面核对，漏导一个就等于那条审计不到
  HEAT_FLOOR, heatClamp, syncHeat, fxRows, HEAT_DIV, HEAT_KNEE, HEAT_TIERS, HEAT_SOFT, HEAT_TAU, RUSH_MOD, RUSH_BAD, RUSH_FLOOR, FEVER_MULT, FEVER_MS, GOLD_MULT, GOLD_RATE, CHEST_RATE, CHEST_HEAT, PITY_DIV, DANGER_HEAT,
  heatMult, heatMultAt, heatGain, rollMod, burnStep, burnOn, BURN_WIN, BURN_RISE, BURN_RISE_RUSH, BURN_MS, BURN_MS_RUSH, BURN_MULT, BURN_FLOOR,
  get burnLeft(){ return burnLeft; }, collapseCols, FLOW_MULT, FLOW_P,
  BET_TIERS, BET_LOSE, BET_NEED, BET_CAP, betMult, BET_OFFER_NEED, BET_COOL, BET_MIN_HEAT, BET_MS,
  get betCool(){ return betCool; }, get betLines(){ return betLines; }, betMaybeOffer, betStep,
  bombAt, laserAt, hammerAt, fillAt, doQuake, doCompact, betAccept,
  get evActive(){ return evActive && evActive.key; },
  get evPending(){ return evPending && evPending.key; },
  get betOffer(){ return betOffer; }, get betLeft(){ return betLeft; }, get betShow(){ return betShow; }, BET_SHOW, ACT_SHOW, get zoneTold(){ return zoneTold; }, ACT_COOL, actNow, actText, actFlash, actStep, get actKind(){ return actKind; },
  rerollPiece, canReroll, REROLL_COST, topSheet,
  swapTap, doSwap, canSwap, SWAP_COST, get swapSel(){ return swapSel; },
  crazyStep,
  UPS, UP_BY, UP_FIRST, UP_EVERY, UP_JIT, UP_SAY_MS, upRoll, get upNext(){ return upNext; }, upMul, upNever, upPool, upHit, upOffer, upStep, zoneNeed,
  get ups(){ return ups; }, get upRound(){ return upRound; },
  ZONE_EDGE, zoneReady, zoneStart, zoneEnd, zoneStep, zoneFloor, fxAct, applyClear, lockPiece, ZONE_NEED, ZONE_MS, ZONE_MAX, ZONE_UNIT, ZONE_CURVE, ZONE_EG, ZONE,
  get zoneCharge(){ return zoneCharge; }, set zoneCharge(v){ zoneCharge = v; },
  get zoneLeft(){ return zoneLeft; }, get zoneRows(){ return zoneRows; },
  chestRate, modRate, lockDelay, canDelay, doDelay, delayAuto, delayRisk, DELAY_RISK, syncDanger, get dangerOn(){ return dangerOn; }, zoneAuto, delayCost, garbagePeriod, riseGarbage,
  get garbageTimer(){ return garbageTimer; }, set garbageTimer(v){ garbageTimer = v; },
 DELAY_MS, DELAY_FRAC, DELAY_GATE, DELAY_WIN, get delayUsed(){ return delayUsed; },
  syncRainMark, rainPick, rainStep, BUFFER, get CELL(){ return CELL; }, rainHit, rainShift, RAIN_MS, RAIN_MULT, rainMult, get rainRow(){ return rainRow; },
  crazyOnClear, evTail, evBlind, doGlean, GLEAN_N, forkAt, dyeAt, MOD_TINT,
  EV_WARN, EV_MIN, EV_FIRST, evFire, pickEvent, MOD_RATES, EVENTS, EV_DEADLY, stackTopRow, DANGER_ROW,
  // 调试用：直接点燃指定事件。evFire 读的是 evPending，从外面没法塞，
  // 只能靠真实调度随机等 —— 排查和截图时不可用。
  evForce: (key) => { const e = EVENTS.find(x => x.key === key); if (!e) return false;
                      evPending = e; evFire(); return true; }, doFreeze, doWall, setMuffle, syncTempo, spawnNext,
  perfectFx, recordFx,
  redraw: () => { staticDirty = true; previewDirty = true; needsDraw = true; },
  runTitle, newRun, rankOf, careerOf, RANKS, CAREER, MILESTONES, readTotal, readDaily, bjDay, crazyScoreMult,
  syncRank, openRankSheet, syncFx, fxRows, openHelp, helpSections, FORCE_RUSH,
  deepMult, deepAt, DEEP_SOFT, deepCrossLines, DEEP_PER, DEEP_EG, SNIPE_MS, SNIPE_HEAT, CHEST_P, RUSH_EXTRA, DEEP_FROM, DEEP_STEP, DEEP_STEP_RUSH, DEEP_BASE, DEEP_BASE_RUSH,
  get clearing(){ return clearing; }, doFreeze, saveGame, restoreGame,  readSave, SAVE_KEY, RUSH_EVERY, RUSH_MULT, RUSH_NAME, RUSH_INTRO, rushEvery,
  readRushCount, countRush, takeRush, isRealRun, isStopRun, STOP_MIN_LINES, STOP_MIN_MS, RUSH_RATE, readRushNext, writeRushNext, RUSH_NEXT_KEY, endRushIntro, RUSH_MIN_PIECES, RUSH_MIN_MS, RUSH_GARBAGE,
  RUSH_KEY, DAILY_KEY, writeDaily, get introLeft(){ return introLeft; }, endGame, readBest, STORE_KEY, TOTAL_KEY,
  showToast, syncStreak, fmtScore, setStat, syncGoal, goalCheck, get goalNow(){ return goalNow; }, get goalHit(){ return goalHit; }, readRecent, pushRecent, goalScore, RECENT_N, GOAL_RANK, RECENT_KEY,
  get wallCol(){ return wallCol; }, FROZEN, GARBAGE,
  get fever(){ return feverLeft; }, get feverPity(){ return feverPity; },
  feverStart, feverEnd, FEVER_COOL, get feverCool(){ return feverCool; }, switchTrack, setPack, setTempo,
  get trackIdx(){ return trackIdx; }, get sfxPack(){ return sfxPack; }, cellsOf, collides, restart, riseGarbage, clearStyle, popScore, garbagePeriod, garbageClock, gravityFor, levelMult, edgeColor, syncEdge, MAX_LEVEL,
  step, stepOnce, setSeed, hardDrop, tryRotate, holdPiece, tryMove, lockPiece, LINES_PER_LEVEL, COLS, ROWS, BUFFER, TOTAL_ROWS,
  CLEAR_DRAW_MS, DROP_GUARD_MS,
  startDrill, drillBegin, drillGo, drillSkip, drillExit, drillRedo, drillGenPuzzle, simReach, finesseMin,
  drillReadAll, drillSave, fmtMs, DRILL_KEY, DRILL_WARM_N, DRILL_STACK_N, DRILL_SPRINT_LINES, tspinKind,
  get drill(){ return drill; }, DRILL_DIG_ROWS, drillDigLeft,
  get inputBuf(){ return inputBuf; },
  tsdSlots, tsBestSlot, tsPathText, TS_W, tsEval, tsReadyCount, startTspin, tsOn, setTsSpeed, setTsGarbage, get tsGarbage(){ return tsGarbage; }, canScroll, reviewTips, histRead, histPush, coachRec, judgeCore, COACH_TSD100, get shadow(){ return shadow; }, HIST_KEY, openHistSheet, closeHistSheet, openMenu, closeMenu, histChartSVG, startMid, openMidSheet, setAid, liveRun, askLeave, closeLeave, PALETTES, PAL_GROUPS, STYLES, skin, get aids(){ return aids; }, get aidSlots(){ return aidSlots; }, syncPace, AID_KEY, midPlan, midRates, MID_TIERS, get mid(){ return mid; }, get histView(){ return histView; }, get tsSpeed(){ return tsSpeed; }, TS_SPEED_KEY, get tsRec(){ return tsRec; }, get tsStats(){ return tsStats; },
  get hintKind(){ return hintKind; },
  hitPower, hitColor, get lastHit(){ return lastHit; }, get glows(){ return glows; },

  openRestartSheet, closeRestartSheet, restartPick,
  HANDLING, setHandling, get handling(){ return handling; }, get DAS(){ return DAS; }, get ARR(){ return ARR; },
  NES_PIECES, NES_GRAVITY, NES_LINE_SCORE, NES_FRAME, NES_DAS, NES_ARR, NES_KEY, nesGravity, nesFirstLevelUp, nesTier,
  startNes, nesEnd, nesFrame, nesHardDrop, nesRoll, nesLock, nesFits, nesAre, nesStep, nesRotate, nesPress, nesRelease, nesRecords, openNesSheet, get nes(){ return nes; },
  VS_LEVELS, VS_KEY, vsAttack, vsSimMatch, startVs, vsEnd, vsStep, vsOnLock, vsRecords, openVsSheet, vsBotMove,
  get vs(){ return vs; }, modeRestart, layout,
  hintEval, fitGaps, pieceFits, bottomPattern, pieceHintText, HINT_TOL, HINT_RULES, toggleHintHide, hintHidden,
  openHintSheet, closeHintSheet, get hintReveal(){ return hintReveal; },
  set hintHide(v){ hintHide = !!v; },
  LEVELS, LEVEL_BY, startPractice, exitPractice, practiceLoad, practicePick, practiceUndo, practiceCheck, detectTSpin,
  get practice(){ return practice; }, get practiceDone(){ return practiceDone; },
  get practiceLevel(){ return practiceLevel; }, get practiceStep(){ return practiceStep; },
  get demoRunning(){ return demoRunning; }, get undoDepth(){ return undoStack.length; },
  get practiceReps(){ return practiceReps; },
  get hintMode(){ return hintMode; }, get hintMove(){ return hintMove; }, get hintStats(){ return hintStats; },
  startHint, hintCompute, hintBest, drawPreview, simBoard, simDrops, simPlace, simFeatures, simScore, assisted, HW,
  syncResume, syncModeSwitch,
  practiceSolve, practiceDemo, parseActs, doAct, goalName,
  dbg, peek: () => ({ clearing, grounded, lockTimer, lockResets, dropTimer, frames: dbg.frames, layouts: dbg.layouts, needsDraw, staticDirty, previewDirty, parts: particles.length, sweeps: sweeps.length, rings: rings.length, embers: embers.length, beams: beams.length, squash: !!squash }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
