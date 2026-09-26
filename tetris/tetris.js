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
function colorOf(type){
  if (type === GARBAGE) return '#93a4c4';
  if (type === FROZEN)  return '#8fd8ff';
  if (type === CHEST)   return '#ffd23f';
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
const FALL_END = 400;    // level 20：满屏 8 秒（标准版到此为止）

// 疯狂版不封顶：指数逼近 200ms，永远在收紧、永远到不了。
//   间隔 = 200 + 800 · e^(-(lvl-1)/16)
// 中段和标准版几乎重合，20 级附近反而松一口气（444 vs 400），
// 之后一路往下磨。要的就是「缓一点，但没有水平段」——
// 标准版 20 级之后重力是条直线，高手会明确感到「不会更难了」。
const CRAZY_FALL_FLOOR = 200;
const CRAZY_FALL_K = 16;
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
// 开局 45 秒一行，之后一路平滑压向 15 秒封顶，全程 3 倍落差。
// 两头都得留够距离：只提封顶不提开局的话曲线会压扁成「每 27 秒恒定来一行」，
// 难度爬升就没了；只提开局不收尾段的话后期躺平，一局能拖到十分钟以上。
// 不会出现「刚好卡在升级线上突然难一截」的断层。
//
// G_LINE_BONUS 曾经是 1200（每消一行给难度钟多推 1.2 秒），现在设 0。
// 模拟发现它专门惩罚打得好的人：熟练档一局消 150 行，等于白送难度钟 180 秒，
// 越会玩、灰线来得越凶。去掉之后难度钟就是纯已玩时长，对谁都一样。
const GARBAGE = 'X';
const FROZEN  = 'F';   // 冰冻格：整行要消两次才掉
const CHEST   = 'C';   // 灰线里的宝箱：消掉那一行就开
// 疯狂版灰线更凶：FEVER 的「灰线暂停」和行雨的「清灰线」都得有东西可对抗，
// 取消灰线这两个机制就空转了
// 疯狂版比标准版凶得多。灰线钟走的是绝对时间、跟手速无关，所以它是唯一
// 真正决定一局多长的旋钮 —— 摊平那一版各档手速全被钉在 9~19 分钟，太久。
const G_MAX = CRAZY ? 24000 : 45000;     // 开局周期
const G_MIN = CRAZY ?  7000 : 15000;     // 压到这里就不再往下
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
// 狂欢局灰线涨得快四分之一 —— 它有 ×1.2 的分数，就得有对应的代价，
// 否则刷到一局就是白赚。挑灰线钟而不是 level：level 快了 levelMult 跟着涨，
// 分数反而更高，越平衡越失衡。灰线是纯加压，不直接给分。
const RUSH_GARBAGE = .55;      // 灰线周期，越小涨得越快
function garbagePeriod(){
  let p = G_MIN + (G_MAX - G_MIN) * Math.exp(-garbageClock() / G_TAU);
  const over = game.level - G_OVER_FROM;
  if (over > 0) p *= Math.pow(G_OVER_RATE, over);
  if (game.rush) p *= RUSH_GARBAGE;
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
const WIPE_TOKENS = { tetris: '2026-09-23-level20', crazy: '2026-09-24-heat' };
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
function readTotal(){
  try { return parseInt(localStorage.getItem(TOTAL_KEY) || '0', 10) || 0; }
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
// 最强 · 看单局最高分。门槛按真实分数定：普通局 10 万、最好 100 万，
// 所以 10 万摆在第三档（常驻位），100 万落在第七档，上面还留三格看得见。
// 火焰这条隐喻和游戏的核心机制是同一件事 —— 一局就是一次燃烧：
// 热度起来、烧到顶、然后熄灭。
const RANKS = [
  [30000,    '微光'],
  [60000,    '星火'],
  [100000,   '流焰'],
  [180000,   '赤霄'],
  [300000,   '烈阳'],
  [500000,   '熔金'],
  [800000,   '炽天'],
  [1200000,  '紫微'],
  [2000000,  '曜极'],
  [3000000,  '太一'],
  // 太一在道家里已经是本源，再往上只能往「天地未开」那头走：
  // 无极生太极 —— 鸿蒙是未分之气，无极是没有边界，都排在太一之前/之上。
  [4000000,  '鸿蒙'],
  [5000000,  '无极'],
];
// 段位 · 看累计总分。前七档是按「一局 10 万」铺的，实测一局能打三百万，
// 所以王者二十局就到顶了。已有的阈值不动 —— 往上调等于把已经爬到的人降级，
// 比早期爬得快更难受。坡度加在顶上：王者之上还有荣耀王者、传奇王者。
const CAREER = [
  [1000000,   '青铜'],
  [4000000,   '白银'],
  [9000000,   '黄金'],
  [18000000,  '铂金'],
  [30000000,  '钻石'],
  [43000000,  '星耀'],
  [60000000,  '王者'],
  [100000000, '荣耀王者'],
  [250000000, '传奇王者'],
];
function tierOf(table, v){
  let hit = null;
  for (const t of table){ if (v >= t[0]) hit = t; else break; }
  return hit;
}
const rankOf   = (v) => tierOf(RANKS, v);
// ── 狂欢局 ──
// 开局给的一次机会：整局分数 ×1.2，而且有利的机制密集得多。
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
const RUSH_MULT  = 2.4;        // 分数倍率
const RUSH_MOD   = 2;          // 重锤/炸弹/激光概率翻倍（金块不翻，它只是纯加分）
const RUSH_BAD   = 1.5;        // 坏事件权重
const RUSH_KEY   = nsKey('rush.v1');
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

function readRushCount(){
  try { return parseInt(localStorage.getItem(RUSH_KEY) || '0', 10) || 0; }
  catch { return 0; }
}
// 局末调：有效局才推进一格
function countRush(){
  try { localStorage.setItem(RUSH_KEY, String(readRushCount() + 1)); } catch { /* 忽略 */ }
}
// 开局调：够了就消耗掉并返回 true。
// 阈值用 rushEvery() 本身而不是减一 —— 计数是在局末推进的，减一会让实际间隔
// 比标称少一格（「每 10 局」跑出来是 8~9 局一次）。
function takeRush(){
  if (readRushCount() < rushEvery()) return false;
  try { localStorage.setItem(RUSH_KEY, '0'); } catch { /* 忽略 */ }
  return true;
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
  game.run = newRun();
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
  document.body.classList.toggle('rushrun', !!game.rush);
  const sl = $('scoreLabel');
  if (sl) sl.textContent = game.rush ? 'SCORE ×' + RUSH_MULT : 'SCORE';
  heat = CRAZY ? (+d.heat || 0) : 0;
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

  // IHS 优先于 IRS：按住暂存键就先换块，否则按住旋转键就先转好
  if (!armPre) return;
  armPre = false;
  if (preHeld.hold && !game.holdUsed){ holdPiece(); return; }
  if (preHeld.cw) tryRotate(1);
  else if (preHeld.ccw) tryRotate(-1);
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
  const cur = game.piece.type, curMod = game.piece.mod || null;
  if (game.hold){
    const h = game.hold, hm = game.holdMod || null;
    game.hold = cur; game.holdMod = curMod;
    spawn(h, hm);
  } else {
    game.hold = cur; game.holdMod = curMod;
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
  game.pieces++;
  crazyOnLock(p);
  const spin = detectTSpin();

  // 这一下造了几个洞。countHoles 是 220 格扫描，只在锁定时跑两次 ——
  // 一局八十几次，不进每帧循环。
  const holesBefore = CRAZY ? countHoles() : 0;
  const stalled = lockResets;

  for (const [cx, cy] of cellsOf(p.type, p.rot)){
    const by = p.y + cy, bx = p.x + cx;
    if (by >= 0 && by < TOTAL_ROWS) game.board[by][bx] = p.type;
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
  crazyOnClear(full.length, spin, perfect);

  if (full.length){
    // 同理：先响，再去铺几十颗粒子和改 DOM
    // 连击 0~5 逐级升半音（2^(1/12) ≈ 1.0595）
    const pitch = Math.pow(1.0595, Math.min(6, Math.max(0, game.combo)));
    sfx(spin ? 'tspin' : (full.length === 4 ? 'tetris' : 'clear'), pitch);
    buzz(full.length >= 4 ? [30, 40, 70] : 18 + full.length * 8);
    if (full.length === 4 || perfect) musicDuck(170);
    clearing = { rows: full, t: 0, dur: 260 };
    for (const y of full) burstRow(y);
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
  return v.toLocaleString();
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
      ['gold', 'hammer', 'bomb', 'laser'].map(k => ({
        mod: k, name: MOD_HELP.name[k], meta: fmtRate(rate[k]), text: MOD_HELP.mod[k] }))],
    ['事件　开局 ' + (EV_FIRST / 1000) + ' 秒第一次，最密 ' + (EV_MIN / 1000) + ' 秒一次，提前 ' + (EV_WARN / 1000) + ' 秒预告',
      evOn.concat(evNow).map(evLine).concat([{ dot: '◈', name: '堆到高处时', meta: '',
        text: EVENTS.filter(e => EV_DEADLY.has(e.key)).map(e => e.name).join(' / ')
              + ' 不再出现，压实概率翻倍 —— 但暗幕 / 镜像 / 狂风 照旧' }])],
    ['热度　消行注入，停手 ' + (HEAT_TAU / 1000) + ' 秒掉到三分之一', [
      { dot: '◈', name: '注入', meta: '', text: '一行 2 · 两行 5 · 三行 9 · 四行 16 · T-spin 6~26 · 全消 40' },
      { dot: '◈', name: '倍率', meta: '不封顶', text: '热度 24 → ×3　48 → ×5　100 → ×7　160 → ×8.5' },
      { dot: '◈', name: '险区', meta: '×' + DANGER_HEAT, text: '堆顶进危险区时消行，热度注入翻倍' },
      { dot: '◈', name: '压哨', meta: '+8', text: '灰线刚顶上来一秒内消掉，额外补 8 点' },
      { dot: '◈', name: '深局加成', meta: DEEP_FROM + ' 行起 ×' + DEEP_BASE,
        text: '只在普通局生效（狂欢局已经有 ×' + RUSH_MULT + '）。过 ' + DEEP_FROM
              + ' 行后每行 ×' + DEEP_BASE + '，之后每 100 行再 +' + DEEP_STEP
              + ' —— 200 行 ×' + (DEEP_BASE + 1.2 * DEEP_STEP).toFixed(1)
              + '，400 行 ×' + (DEEP_BASE + 3.2 * DEEP_STEP).toFixed(1) },
    ]],
    ['宝箱与梭哈', [
      { dot: '▣', name: '宝箱', meta: Math.round(CHEST_RATE * 100) + '%',
        text: '每条灰线有这么大概率带宝箱，消掉那一行才算开。34% FEVER / 36% 热度 +30 / 30% 下一块是炸弹' },
      { dot: '✦', name: 'FEVER', meta: (FEVER_MS / 1000) + ' 秒 ×' + FEVER_MULT,
        text: '消行累加保底，中了这段时间得分 ×' + FEVER_MULT + '，且热度不衰减' },
      { dot: '⚄', name: '梭哈', meta: BET_MS / 1000 + ' 秒',
        text: '消 ' + BET_OFFER_NEED + ' 行以上或打出 T-spin，且热度 ≥' + BET_MIN_HEAT + ' 时弹出。'
              + '接了之后这十秒里累计消行，窗口结束按档结算：'
              + BET_TIERS.map(([n, m]) => n + '行 ×' + m).join(' · ')
              + '；不足 ' + BET_NEED + ' 行热度减半。消满 ' + BET_CAP + ' 行直接封顶。'
              + '结算后冷却 ' + (BET_COOL / 1000) + ' 秒' },
      { dot: '⟳', name: '换牌', meta: REROLL_COST + ' 热度', text: '点 NEXT 框，花热度把当前这块换掉' },
    ]],
    ['狂欢局　' + RUSH_EVERY + ' 局攒一次，今天打得多门槛会降', [
      { dot: '★', name: '分数', meta: '×' + RUSH_MULT, text: '整局有效，不计时' },
      { dot: '★', name: '道具', meta: '×' + RUSH_MOD, text: '重锤 / 炸弹 / 激光概率翻倍，金块不翻' },
      { dot: '▲', name: '灰线', meta: '快 ' + Math.round((1 / RUSH_GARBAGE - 1) * 100) + '%', text: '这是它的代价' },
      { dot: '▲', name: '坏事件', meta: '×' + RUSH_BAD, text: '权重提高，好事件相对更少' },
      { dot: '◈', name: '有效局', meta: RUSH_MIN_PIECES + ' 块 / ' + (RUSH_MIN_MS / 1000) + ' 秒',
        text: '一局要落够方块或打够时间才算一格，秒死重开刷不出来' },
    ]],
  ];
}

const MOD_HELP = {
  name: { gold: '金块', hammer: '重锤', bomb: '炸弹', laser: '激光' },
  mod: {
    gold:   '用它消行时，那一次得分 ×' + 3,
    hammer: '锁定后，它占到的每一列整列向下塌实，洞被挤掉',
    bomb:   '炸掉自身周围一圈，然后受影响的列塌实',
    laser:  '整块汽化，再从落点往下打穿中心那一列 —— 开出来的井正好是打四行的形状',
  },
  ev: {
    blackout: '方块只画轮廓，看不见填充，音效也变闷',
    mirror:   '左右键对调，连发也跟着换向',
    wind:     '每隔不到一秒，把下落中的方块随机吹偏一格',
    wall:     '随机封死一列当墙，不封出生区',
    slam:     '方块一出生就贴到底。落地后还能左右滑和转，失去的是边落边调整',
    quake:    '整个盘面左右平移一格，推出边界的格子直接消失',
    compact:  '挑洞最多的三列塌实 —— 八个事件里唯一对你有利的',
    freeze:   '冻住上方某一行。冻住的行凑满时不消，只解冻，要消两次才掉',
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
}

function openRankSheet(){
  if (!CRAZY) return;
  const best = Math.max(game.best, readBest()), total = readTotal();
  fillLadder($('rankList'), RANKS, best);
  fillLadder($('careerList'), CAREER, total);
  $('rankFoot').textContent = `最强 ${fmtScore(best)}　累计 ${fmtScore(total)}`;
  $('rankSheet').hidden = false;
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
  const mods = [['金', r.gold], ['锤', r.hammer], ['弹', r.bomb], ['激', r.laser]]
    .filter(v => v[1] > 0).map(v => v[0] + v[1]).join(' ');
  if (mods) add('变异块', mods, true);
  if (r.chests) add('宝箱', r.chests + ' 个');
  if (r.tetris) add('四行', r.tetris + ' 次');
  if (r.tspin) add('T-SPIN', r.tspin + ' 次');
  if (r.perfect) add('全消', r.perfect + ' 次');
  if (game.rush) add(RUSH_NAME, '分数 ×' + RUSH_MULT, true);
  if (r.bets) add('梭哈', `${r.betWins}/${r.bets}`);
  if (r.rerolls) add('换牌', r.rerolls + ' 次');
  // 写成 4:47 而不是「4 分 47 秒」—— 后者在 320px 宽的屏上会被截掉尾巴
  add('这局用了', Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0'));

  $('runStats').innerHTML = rows.join('');
  box.hidden = false;
}

// 分数关口播报。一局能撞三四个，是频率最高的一条，顺带给「一局之内没有
// 阶段感」补一个节点 —— 分数原来只是个一直涨的数字。
// 关口密一点，一局能多撞几次。大部分只报个数，整数关口才给一句话 ——
// 每个都配文案的话，说得太满反而不值钱了。
const MILE_W = [1, 3, 5, 10, 15, 20, 25, 30, 50, 80, 100, 150, 200, 300];
const MILE_SAY = {
  1: '一万',
  10: '十万，有点东西',
  30: '三十万',
  50: '五十万，你认真的?',
  100: '一百万',
  200: '两百万，离谱',
  300: '三百万。没话说了',
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
  return { peak: 1, dangerMs: 0, gold: 0, bomb: 0, laser: 0, hammer: 0,
           bets: 0, betWins: 0, rerolls: 0, bestHit: 0, tspin: 0, tetris: 0, perfect: 0,
           mile: 0, wasDanger: false, saves: 0, chests: 0 };
}

// 按打法给个称号。从最有辨识度的往下判，第一个命中的就是它 ——
// 同时满足好几条的时候，「赖皮」比「稳」更值得说。
function runTitle(r, secs){
  const dangerPct = secs > 0 ? r.dangerMs / (secs * 1000) : 0;
  if (dangerPct > .25)        return ['赖皮', '四分之一的时间泡在危险区'];
  if (r.betWins >= 3)         return ['赌徒', `梭哈赢了 ${r.betWins} 次`];
  if (r.tspin >= 3)           return ['花活', `${r.tspin} 次 T-SPIN`];
  if (r.rerolls >= 5)         return ['挑食', `换掉了 ${r.rerolls} 块`];
  if (r.tetris >= 8)          return ['板砖工', `${r.tetris} 次四行`];
  if (r.peak >= 10)           return ['上头', `峰值 ×${r.peak.toFixed(1)}`];
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

  const gain = Math.round(base * mult * crazyScoreMult());
  game.score += gain;
  if (game.run){
    if (gain > game.run.bestHit) game.run.bestHit = gain;
    if (n === 4) game.run.tetris++;
    if (spin === 'tspin') game.run.tspin++;
    if (perfect) game.run.perfect++;
  }

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
  // 里程碑放在 label 的 toast 之后。放前面会被它当场盖掉 —— 而里程碑偏偏
  // 总是和大消除同时发生，等于永远看不见。两者冲突时让里程碑赢，它更少见。
  checkMilestone();
  if (game.score > game.best){
    if (game.best > 0 && !bestBeaten){ bestBeaten = true; showToast('破纪录！'); }
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
  if (game.board[0].some(Boolean)){ endGame('灰线顶出'); return; }
  game.board.shift();
  const row = new Array(COLS).fill(GARBAGE);
  const gap = (rndGame() * COLS) | 0;
  row[gap] = null;                                      // 留个缺口，不然没法消
  // 宝箱：灰线现在只有坏处，这给了它第二个身份 —— 一个看得见、够得到的目标。
  // 状态存在盘面格子里（和冰冻行同一套），塌陷、上顶、地震都会跟着走。
  if (CRAZY && rndFx() < CHEST_RATE){
    let x = (rndFx() * COLS) | 0;
    if (x === gap) x = (x + 1) % COLS;
    row[x] = CHEST;
  }
  game.board.push(row);
  game.garbage++;
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
};
let dieTimer = 0;

function endGame(why){
  game.over = true;
  // FEVER 的视觉不能留到结算页 —— crazyReset 要等重开才跑，中间这段
  // 背景条纹会一直在动
  if (CRAZY && feverLeft > 0) feverEnd();
  game.why = why || '?';
  game.piece = null;
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
  if (game.score > game.best){ game.best = game.score; writeBest(game.best); }
  // 记账放在这里：累计分只增，今日最佳按「这一局结束的时刻」归日
  if (CRAZY) addTotal(game.score);
  if (CRAZY){
    // 有效局才推进狂欢局的计数、才算今日一局 —— 秒死重开刷不出狂欢局，
    // 也压不低门槛。最佳分不设门槛：打出来了就是打出来了。
    const real = isRealRun();
    if (real && !FORCE_RUSH) countRush();   // 测试模式不推进保底计数
    const d = readDaily();          // readDaily 自己会判断是不是还是同一天
    if (real) d.plays++;
    if (game.score > d.best) d.best = game.score;
    writeDaily(d);
  }
  $('overScore').textContent = game.score.toLocaleString();
  $('overLines').textContent = game.lines;
  $('overLevel').textContent = game.level;
  $('overBest').textContent = game.best.toLocaleString();
  // 清过档的话把旧规则下的纪录也摆出来 —— 个人小游戏里最高分就是全部的意义，
  // 光写进 localStorage 没人看得见等于没留
  const lg = readLegacy();
  $('legacyCell').hidden = !lg;
  if (lg) $('overLegacy').textContent = lg.toLocaleString();
  fillRunLog();
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
const HEAT_EDGE = '#ff6a3c';     // 热度把边框往这个色推
function syncEdge(){
  const L = game.level;
  const t = clamp((Math.min(L, MAX_LEVEL) - 1) / (MAX_LEVEL - 1), 0, 1);
  // 等级定底色，热度定烈度，两者叠在同一组变量上。
  // 注意这里写的是内联样式 —— CSS 里再写一套 body[data-heat] #board 是压不过的，
  // 所以热度必须折进这个函数，不能单独走样式表。
  const h = CRAZY ? clamp((heatMult() - 1) / 12, 0, 1) : 0;
  const c = h > 0 ? mix(edgeColor(L), HEAT_EDGE, h) : edgeColor(L);
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
      drawCell(bgCtx, x * CELL, (y - BUFFER) * CELL, CELL, colorOf(t),
               evBlackout() ? { ghost: true } : { garbage: t === GARBAGE });
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
  if (sweeps.length || rings.length) drawFx();
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
  if (game.queue[0]) drawMini(nextCtx, game.queue[0], 0, 0, nw, topH, 1, game.mods[0]);
  if (game.queue[1]) drawMini(nextCtx, game.queue[1], 0, topH, nw / 2, botH, .62, game.mods[1]);
  if (game.queue[2]) drawMini(nextCtx, game.queue[2], nw / 2, topH, nw / 2, botH, .62, game.mods[2]);

  // hold
  const hw = holdCv.clientWidth, hh = holdCv.clientHeight;
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
  setStat($('lines'), String(game.lines));
  setStat($('level'), String(game.level));
  setStat($('best'), fmtScore(game.best));
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
  // 梭哈排第一：它是唯一有硬时限、且要你当场做事的东西
  if (betLeft > 0){
    const m = betMult(betLines);
    out.push({ n: '梭哈 ' + betLines + '行', v: (betLeft / 1000).toFixed(1) + 's ' + (m ? '×' + m : '—'),
               k: 'betrow', p: betLeft / BET_MS });
  }
  if (evActive) out.push({ n: evActive.name, v: (evLeft / 1000).toFixed(1) + 's',
                           k: evActive.bad ? 'bad' : 'good', p: evLeft / evActive.ms });
  else if (flashLeft > 0 && flashFx) out.push({ n: flashFx.name, v: '已发生',
                           k: flashFx.bad ? 'bad' : 'good', p: flashLeft / FX_FLASH });
  if (feverLeft > 0) out.push({ n: 'FEVER', v: '×' + FEVER_MULT, k: 'fev', p: feverLeft / FEVER_MS });
  if (game.rush) out.push({ n: '狂欢', v: '×' + RUSH_MULT, k: 'rush' });
  out.push({ n: '热度', v: '×' + heatMult().toFixed(1), k: 'heat' });
  return out.slice(0, 3);
}

function syncFx(){
  if (!CRAZY) return;
  const box = $('fxBox');
  if (!box) return;
  box.hidden = false;
  const rows = fxRows();
  const sig = rows.map(r => r.n + r.v + r.k).join('|');
  if (sig !== fxSig){
    fxSig = sig;
    for (let i = 0; i < 3; i++){
      const el = $('fxs' + i), r = rows[i];
      if (!el) continue;
      el.className = 'fxs' + (r ? ' ' + r.k : '');
      el.innerHTML = r
        ? `<div class="fxl"><b class="fxn">${r.n}</b><b class="fxv">${r.v}</b></div>`
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

function syncHeat(){
  if (!CRAZY) return;
  const el = $('badgeHeat');
  if (!el) return;
  const m = heatMult();
  if (game.run && m > game.run.peak) game.run.peak = m;
  const on = m >= 1.15 && !game.over;
  el.classList.toggle('on', on);
  if (on) el.textContent = '×' + m.toFixed(1);
  // 分档改 data 属性，不逐帧写样式 —— 档位没变就什么都不做
  const t = !on ? 0 : m < 3 ? 1 : m < 6 ? 2 : m < 10 ? 3 : 4;
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
  document.body.classList.toggle('hotcombo', game.combo >= 5 && !game.over);
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
function fmtScore(v){
  v = Math.round(v);
  if (v < 10000) return v.toLocaleString();
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
  el.textContent = text;
  el.style.setProperty('--fit', STAT_FIT[Math.min(9, text.length)] || 1);
}

function rollScore(snap){
  const el = $('score');
  if (!el) return;
  if (snap){ shownScore = game.score; setStat(el, fmtScore(shownScore)); return; }
  if (rollId) return;
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
const GOLD_RATE = 1 / 38;        // 黄金方块出现概率（见 MOD_RATES 的浓度说明）
const GOLD_MULT = 3;
const FEVER_MS = 20000;          // 一次 FEVER 多长（走 game.elapsed，不是墙钟）
const FEVER_MULT = 4;
const PITY_DIV = 55;             // 保底斜率：越小触发越勤
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
const HEAT_TAU = 45000;   // 衰减时间常数：停手 45 秒掉到三分之一
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
const HEAT_KNEE = 48;     // 拐点
const HEAT_SOFT = 6;      // 软化半径：越大尾巴抬得越高
const HEAT_B = 2 * Math.sqrt(HEAT_SOFT) / HEAT_DIV;
const HEAT_A = 1 + HEAT_KNEE / HEAT_DIV - 2 * HEAT_SOFT / HEAT_DIV;
let heat = 0;

function heatMult(){
  if (!CRAZY) return 1;
  // 夹一下负数。现在没有能让 heat 变负的路径（衰减是乘 exp 且低于 .05 归零、
  // 换牌有余额判、赌输是减半），但公式本身没护栏 —— 真漏进来会算出负倍率，
  // 分数直接变负，排查起来毫无线索。
  const h = heat > 0 ? heat : 0;
  if (h <= HEAT_KNEE) return 1 + h / HEAT_DIV;
  return HEAT_A + HEAT_B * Math.sqrt(h - HEAT_KNEE + HEAT_SOFT);
}

// 注入量按含金量给，不按行数摊：一次 TETRIS 给 16，拆成四次单行只给 8。
// 想把倍率烧上去就得打大的。
function heatGain(n, spin, perfect){
  if (perfect) return 40;
  if (spin === 'tspin') return [6, 10, 18, 26][n] ?? 26;
  if (spin === 'mini')  return [3, 4, 7][n] ?? 7;
  // 压实可能一次凑满四行以上，表只到 4，超出的按每行 +4 续
  if (n > 4) return 16 + (n - 4) * 4;
  return [0, 2, 5, 9, 16][n] || 0;
}

const DANGER_HEAT = 2;           // 危险区里消行的热度倍数
// 每条灰线带宝箱的概率。注意这是「生成」的概率，不是「开出来」的 ——
// 宝箱只有在你把那一行消掉时才算开，大量灰线是被顶出去的。
// 实测开出来的数（机器人，一局六七分钟）：普通局中位 3 个，
// 狂欢局灰线快 82%、所以中位 8 个。
const CHEST_RATE = 1 / 4;
let lastRiseAt = -1e9;           // 上一次灰线上顶的时刻，给「压哨」用

// 消掉带宝箱的行就开箱。三选一，都是当场能感觉到的东西。
function claimChests(rows){
  if (!CRAZY) return;
  let n = 0;
  for (const y of rows) for (let x = 0; x < COLS; x++) if (game.board[y][x] === CHEST) n++;
  if (!n) return;
  if (game.run) game.run.chests += n;
  for (let i = 0; i < n; i++){
    const r = rndFx();
    if (r < .34 && feverLeft <= 0){ tip('开箱　FEVER！', 0); feverStart(); }
    else if (r < .70){ heat += 30; heatQuant = -1; syncHeat(); syncEdge(); tip('开箱　热度 +30', 0); }
    else { game.mods[0] = 'bomb'; previewDirty = true; tip('开箱　下一块是炸弹', 0); }
  }
  sfx('tetris', 1.34); buzz([30, 20, 30, 20, 60]);
}

// 钩子⑥：每帧衰减
function crazyStep(dt){
  if (!CRAZY || heat <= 0) return;
  // FEVER 期间不衰减 —— 那二十秒变成「把热度冻住往上堆」的黄金窗口，
  // 而不只是个 ×4
  if (feverLeft > 0) return;
  heat *= Math.exp(-dt / HEAT_TAU);
  if (heat < .05) heat = 0;
}

// 事件和赌局的钟要一直走，热度是 0 也得走 —— 上面那个函数会提前 return
function crazyClocks(dt){
  if (!CRAZY) return;
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
  feverLeft = 0; feverPity = 0; goldPending = false;
  heat = 0; heatTier = -1; heatQuant = -1;
  evTimer = 0; evWarnLeft = 0; evPending = null; evActive = null; evLeft = 0;
  flashFx = null; flashLeft = 0; fxSig = '';
  wallCol = -1; windTimer = 0; setMuffle(false); embers.length = 0;
  betOffer = 0; betLeft = 0; betCool = 0; betLines = 0; beams.length = 0;
  delete document.body.dataset.ev;
  document.body.classList.remove('betting');
  const ew = $('evwarn'); if (ew) ew.classList.remove('on');
  betHide();
  activePal = null;
  document.body.classList.remove('fever');
  if (CRAZY) setTempo(baseBpm);
}


// 钩子②：锁定时记下这块是不是金的（scoreFor 里 game.piece 已经是 null 了）
function crazyOnLock(p){
  if (!CRAZY) return;
  goldPending = p.mod === 'gold';
}

// 钩子③：算分时的倍数。金块 ×2、FEVER ×3，两者相乘。
// 整体手感微调。想让全局分数涨/跌就只动这一个数 —— 其余旋钮（HEAT_DIV、
// GOLD_MULT、FEVER_MULT、levelMult）都不均匀：有的只在热度高时生效，有的只
// 覆盖一小撮消行，调它们等于顺手改了平衡。
// 现在是 1：道具/压实消行给分那条已经把整体抬了约 18%（狂欢局 33%），
// 再乘就过头了。
const CRAZY_TUNE = 1;

// ── 深局加成（只给普通局）──
// 狂欢局比普通局值多少，是三个常数乘出来的：热度 1.97 倍（梭哈连赢 + 道具
// 翻倍带来的额外注入）× 分数 2.4 倍 × 行数 0.69 倍（灰线快 82%，活不长）。
// 乘起来约 2.1，而且跟行数无关 —— 所以补偿也得是个接近常数的量，
// 拿「行数越多越值」那种缓坡补不动：实测 100 行就差 2.16 倍、550 行还差 2.08 倍。
//
// 第一版让两边共吃这个加成，等于白给狂欢局也加，方向错了。现在只给普通局：
// 狂欢局已经有 ×2.4 和道具翻倍。
//
// 用两局真实对局校准（普通 137 行 82.5 万 / 狂欢 265 行 1331 万），
// 普通/狂欢 在各水平上的比值：
//   150行 0.76   200行 0.86   250行 0.95   300行 1.02   383行 1.13
const DEEP_FROM = 80;
const DEEP_BASE = 1.8;
const DEEP_STEP = .4;
let deepSaid = false;
function deepMult(){
  if (!CRAZY || game.rush || game.lines < DEEP_FROM) return 1;
  return DEEP_BASE + (game.lines - DEEP_FROM) / 100 * DEEP_STEP;
}

function crazyScoreMult(){
  if (!CRAZY) return 1;
  let m = heatMult() * CRAZY_TUNE * deepMult();
  if (game.rush) m *= RUSH_MULT;
  if (goldPending) m *= GOLD_MULT;
  if (feverLeft > 0) m *= FEVER_MULT;
  return m;
}

// 钩子④：每"次"消行掷一次骰（不是每行）。没中时按消行数加权 +n%，
// 这样打单行和打 TETRIS 的触发频率都不吃亏。线性保底，期望约 12 次消行一次。
function crazyOnClear(lines, spin, perfect){
  if (!CRAZY) return;
  if (lines <= 0 && !spin) return;
  goldPending = false;
  // 空转的 T-spin 也给热度：它是实打实的技术动作，只是没消到行
  let gain = heatGain(lines, spin, perfect);
  // 险区加成：危险区原来只有坏处，所以最优解永远是「尽快清下去」，没有选择。
  // 在里面消行热度翻倍之后，才谈得上「敢不敢赖在高处多赚一点」。
  if (lines > 0 && dangerOn){
    gain *= DANGER_HEAT;
    tip('险中取栗　热度 ×' + DANGER_HEAT, 4000);
  }
  // 压哨：灰线刚顶上来就立刻消掉一行
  if (lines > 0 && game.elapsed - lastRiseAt < 1000){
    gain += 8;
    tip('压哨', 3000);
  }
  // 越过深局门槛报一次。1.0 → 1.8 是个台阶，不说一声会像数值跳变
  if (!game.rush && !deepSaid && game.lines >= DEEP_FROM){
    deepSaid = true;
    tip('深局　每行 ×' + DEEP_BASE, 0);
  }
  heat += gain;
  betResolve(lines);
  syncHeat();
  betMaybeOffer(lines, spin);     // 立刻刷新：消行动画期间 stepOnce 在 syncHud 之前就 return 了
  if (lines <= 0) return;                 // 但不推 FEVER 保底
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
  syncTempo();
}
function feverEnd(){
  feverLeft = 0;
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
// 重调到总量 5.4%（一局六百块 ≈ 33 个），顺带把四种拉平：
//   一局六百块下 ≈ 金 16 / 锤 6.7 / 弹 5.5 / 激 4.6
const MOD_RATES = [
  ['laser',  1 / 130],
  ['bomb',   1 / 110],
  ['hammer', 1 / 90],
  ['gold',   GOLD_RATE],   // 1/38
];
const MOD_TINT = { gold:'#ffd23f', bomb:'#ff4d4d', laser:'#7cf4ff', hammer:'#c9a6ff' };

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
  } else if (mod === 'hammer'){              // ▼ 下三角
    c.moveTo(cx - r * .88, cy - r * .62); c.lineTo(cx + r * .88, cy - r * .62);
    c.lineTo(cx, cy + r * .82); c.closePath();
  } else if (mod === 'bomb'){                // ● 圆 + 短引线
    c.arc(cx, cy + r * .14, r * .74, 0, Math.PI * 2);
    c.closePath();
    c.moveTo(cx + r * .3, cy - r * .5); c.lineTo(cx + r * .72, cy - r * .95);
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

function rollMod(){
  // 狂欢局里三种「干活的」变异翻倍，金块不翻 —— 它只是纯加分，翻了加分不加戏
  const k2 = game.rush ? RUSH_MOD : 1;
  let r = rndFx();
  for (const [k, rate] of MOD_RATES){
    const p = k === 'gold' ? rate : rate * k2;
    if (r < p) return k;
    r -= p;
  }
  return null;
}

// 三种效果刻意分成「减堆 / 挖井 / 修洞」，各解决一类困境，不互相重复
function crazyApplyMod(p){
  if (!CRAZY || !p.mod || p.mod === 'gold') return;
  if (p.mod === 'bomb')   bombAt(p);
  if (p.mod === 'laser')  laserAt(p);
  if (p.mod === 'hammer') hammerAt(p);
}

// 让这几列里的格子落下去填掉下方的空洞。
// 俄罗斯方块本身没有这种重力，所以它只能是特效，必须有明确的视觉来源。
function collapseCols(cols){
  for (const x of cols){
    if (x < 0 || x >= COLS) continue;
    let w = TOTAL_ROWS - 1;
    for (let y = TOTAL_ROWS - 1; y >= 0; y--){
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
  const gain = Math.round(base * levelMult(game.level) * crazyScoreMult());
  const py = (full.reduce((a, b) => a + b, 0) / n - BUFFER + .5) * CELL;
  applyClear(full);
  game.score += gain;
  // 刻意不推 combo / b2b / run.tetris：那三个是奖励「连续的、亲手打出来的消除」，
  // 让道具清出来的行去推它们，等于白送下一次真消除的加成。
  if (game.run && gain > game.run.bestHit) game.run.bestHit = gain;
  popScore(CELL * COLS / 2, py, '+' + gain.toLocaleString(), n >= 2 ? n + ' 行' : '', 'tool');
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
  for (const k of kill){
    const y = (k / COLS) | 0, x = k % COLS;
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
  for (const [dx, dy] of cells){
    const x = p.x + dx, y = p.y + dy;
    if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) continue;
    if (y >= BUFFER && game.board[y][x]) boom(x, y, '#7cf4ff');
    game.board[y][x] = null;
  }
  const top = p.y + Math.min(...cells.map(c => c[1]));
  for (let y = Math.max(top, 0); y < TOTAL_ROWS; y++){
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
  const top = topFilledRow();
  if (top < 0) return;
  const left = top - BUFFER;              // 离顶还有几行
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
const EVENTS = [
  { key:'blackout', name:'暗幕',   tip:'方块要隐形了', bad:true,  ms:5000, w:3 },
  { key:'mirror',   name:'镜像',   tip:'左右要对调了', bad:true,  ms:8000, w:3 },
  { key:'quake',    name:'地震',   tip:'整堆要平移了', bad:true,  ms:0,    w:2 },
  { key:'compact',  name:'压实',   tip:'洞要被填上了', bad:false, ms:0,    w:3 },
  { key:'freeze',   name:'冰冻',   tip:'有一行要冻住了', bad:true,  ms:0,    w:2 },
  { key:'wind',     name:'狂风',   tip:'方块要被吹偏了', bad:true,  ms:7000, w:2 },
  { key:'wall',     name:'封锁',   tip:'有一列要封了',   bad:true,  ms:9000, w:2 },
  { key:'slam',     name:'瞬落',   tip:'方块要直接砸到底', bad:true,  ms:6000, w:2 },
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
  for (let y = BUFFER; y < TOTAL_ROWS; y++)
    if (game.board[y].some(Boolean) && !game.board[y].some(c => c === FROZEN)) rows.push(y);
  if (!rows.length) return false;
  const y = rows[(rndFx() * Math.min(rows.length, 6)) | 0];   // 从最上面几行里挑，别冻在深处看不见
  for (let x = 0; x < COLS; x++) if (game.board[y][x]) game.board[y][x] = FROZEN;
  staticDirty = true; needsDraw = true;
  return true;
}

// 解冻：凑满的冰冻行不消，变回普通灰块，下一次凑满才真的掉
function crazyThaw(rows){
  for (const y of rows){
    for (let x = 0; x < COLS; x++) if (game.board[y][x] === FROZEN) game.board[y][x] = GARBAGE;
    burstRow(y);
  }
  staticDirty = true; needsDraw = true;
  showToast('冰裂！再消一次才掉');
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
const EV_DEADLY = new Set(['freeze', 'wall', 'quake', 'slam']);

function pickEvent(){
  const safe = stackTopRow() > DANGER_ROW + 3;
  const pool = EVENTS.filter(e => safe || !EV_DEADLY.has(e.key));
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
  if (evPending){
    evWarnLeft -= dt;
    evBeep -= dt;
    if (evBeep <= 0){ evBeep = 1000; sfx('rotate', 1.6); }
    if (evWarnLeft <= 0) evFire();
    return;
  }
  if (evActive){
    if (evLeft > 0){ evLeft -= dt; if (evLeft <= 0) evEnd(); }
    return;
  }
  evTimer += dt;
  if (evTimer < evPeriod()) return;
  evTimer = 0;
  evPending = pickEvent();
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
  for (let y = 0; y < TOTAL_ROWS; y++){
    const row = game.board[y], out = new Array(COLS).fill(null);
    for (let x = 0; x < COLS; x++){
      const nx = x + dir;
      if (nx >= 0 && nx < COLS) out[nx] = row[x];
    }
    game.board[y] = out;
  }
  staticDirty = true; needsDraw = true; shake(true);
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
}

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
function lockDelay(){ return evSlam() ? LOCK_DELAY * 1.8 : LOCK_DELAY; }

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
const REROLL_COST = 15;

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
const BET_MIN_HEAT = 24;  // 热度太低时赌没意思
let betCool = 0;
let betOffer = 0, betLeft = 0;

function betMaybeOffer(n, spin){
  if (!CRAZY || betLeft > 0 || betOffer > 0 || betCool > 0) return;
  if (!(n >= BET_OFFER_NEED || spin) || heat < BET_MIN_HEAT) return;
  betOffer = BET_MS;
  // 文案从档位表现算，改数值不用回来改字
  const tx = $('allinTxt');
  if (tx) tx.innerHTML = '<b>梭哈</b>十秒内消 ' + BET_NEED + '~' + BET_CAP + ' 行<br>'
    + BET_TIERS.map(([n, m]) => n + '行 ×' + m).join('　') + '　不足 ' + BET_NEED + ' 行减半';
  const el = $('allin');
  if (el){ el.classList.add('on'); el.setAttribute('aria-hidden', 'false'); }
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

function betSettle(){
  const m = betMult(betLines);
  betLeft = 0; betCool = BET_COOL; betHide();
  if (m > 0){
    heat *= m;
    if (game.run) game.run.betWins++;
    // 不能只靠 toast —— 它是共享通道，赢完紧接着可能触发 FEVER，
    // 后来的 toast 会把「梭哈成功」顶掉，看起来就像没结算。
    betPop(betLines + ' 行　热度 ×' + m, '梭哈成功', 'win');
    showToast(`梭哈成功　${betLines} 行　热度 ×${m}`);
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

function betAccept(){
  if (!CRAZY || betOffer <= 0) return;
  betOffer = 0; betLeft = BET_MS; betLines = 0;
  if (game.run) game.run.bets++;
  betHide();
  showToast(`梭哈！十秒内消 ${BET_NEED}~${BET_CAP} 行`);
  sfx('tetris', 1.15); buzz([40, 30, 40]);
}

function betHide(){
  const el = $('allin');
  if (el){ el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }
  document.body.classList.toggle('betting', betLeft > 0);
}

function betStep(dt){
  if (betCool > 0) betCool -= dt;
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
  // 报幕这三秒：不累加 elapsed（否则灰线钟和热度衰减白跑三秒），也不生成方块。
  // 这里绝不能 return 'stop' —— tick 见到 stop 会把 rAF 停掉，三秒后没人拉得起来。
  if (introLeft > 0){
    introLeft -= dt;
    if (introLeft <= 0) endRushIntro();
    return 'normal';
  }

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
      if (CRAZY){ heat += 12; heatQuant = -1; syncHeat(); tip('活过来了', 3000); }
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
  if (!clearing && game.piece){
    game.elapsed += dt;
    // FEVER 期间灰线暂停 —— 这比「重力减半」有感知得多（重力本来就不痛）
    if (feverLeft <= 0) garbageTimer += dt;
    const period = garbagePeriod();
    // 所有事件都有三秒预告，偏偏真正杀你的灰线是无声的。补一道。
    // 看着像削难度，其实是加紧张感 —— 你会盯着它倒数，然后决定这三秒
    // 要不要再赌一块。也只有知道它什么时候来，「压哨」才谈得上抢。
    // 只给疯狂版。这条其实对标准版也是好的（真正杀你的东西本来就该有预告），
    // 但标准版的表现一直承诺不动，要加得单独说。
    syncGarbageWarn(CRAZY && !game.noGarbage && feverLeft <= 0 ? period - garbageTimer : -1);
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

// 镜像把方向翻过来之后，press 置的是翻转后那一路的 held，
// 而 release 拿到的还是原始按键 —— 直接按原样清就会漏掉真正被置上的那个，
// 于是 DAS 连发一直跑，一点就滑到墙边（实测点一下走四格）。
// 记下这一次按下究竟走的是哪一路，松手按记的那个清。
// 单记一份还不够：按住期间事件可能正好结束，翻不翻转会对不上。
const pressedAs = { left: 'left', right: 'right' };

function press(dir){
  if (game.over || game.paused) return;
  const d = evMirror() ? (dir === 'left' ? 'right' : 'left') : dir;
  pressedAs[dir] = d;
  held[d] = true;
  repeat[d] = 0;
  repeat.started[d] = false;
  tryMove(d === 'left' ? -1 : 1, 0);
}
function release(dir){
  const d = pressedAs[dir] || dir;
  pressedAs[dir] = dir;
  held[d] = false;
  repeat[d] = 0;
  repeat.started[d] = false;
}

// 镜像开关的那一刻把两路都松掉。上面记的那份能兜住正常的按下-松手，
// 但手指正按着的时候事件切换，按下和松手分处两种状态，只能在这里一并清干净。
function clearHeld(){
  held.left = held.right = false;
  repeat.left = repeat.right = 0;
  repeat.started.left = repeat.started.right = false;
  pressedAs.left = 'left'; pressedAs.right = 'right';
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
  if (act === 'restart'){ restart(true); return; }
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
    ['btnDrop',  () => hardDrop(),      null],
    // HOLD 走同一套 touch 处理，不然它比别的键慢半拍（click 要等浏览器确认不是双击/滚动）
    ['holdSlot', () => { preHeld.hold = true; holdPiece(); }, () => { preHeld.hold = false; }],
    // 点 NEXT 换牌。标准版里 rerollPiece 开头就 !CRAZY 早退，等于没绑。
    ['nextSlot', () => rerollPiece(), null],
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

function restart(keepRush){
  clearSave();
  endRushIntro();                    // 上一局的报幕没放完就重开，先收干净
  // 狂欢局由保底计数决定，不是玩家选的。keepRush 只给「重开当前这局」用，
  // 免得手滑按重开把已经拿到的机会冲掉。
  game.rush = FORCE_RUSH || (CRAZY && (keepRush ? game.rush : takeRush()));
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
  game.queue = [];
  game.mods = [];
  game.holdMod = null;
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
  game.pieces = 0;
  game.elapsed = 0;
  game.why = '';
  bestBeaten = false;
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
  $('overlay').classList.remove('show');
  $('pauseTx').textContent = '暂停';
  fillQueue();
  syncFx();
  if (game.rush) showRushIntro();     // 报幕结束时才 spawnNext
  else spawnNext();
  syncHud();
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

  // 必须包一层：addEventListener 会把 Event 当第一个参数传进去，
  // restart(event) 的 !!event 是 true，每次普通重开都会变成每日挑战
  $('startBtn').addEventListener('click', () => restart(false));
  $('againBtn').addEventListener('click', () => restart(false));
  const openRank = () => openRankSheet();
  $('rankChip').addEventListener('click', openRank);
  const openHelpSheet = () => openHelp();
  $('helpLink').addEventListener('click', openHelpSheet);
  $('helpBtn').addEventListener('click', openHelpSheet);
  $('fxBox').addEventListener('click', openHelpSheet);
  $('fxBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openHelpSheet(); }
  });
  const closeHelp = () => { $('helpSheet').hidden = true; };
  $('helpDone').addEventListener('click', closeHelp);
  $('helpSheet').addEventListener('click', (e) => { if (e.target === $('helpSheet')) closeHelp(); });
  for (const id of ['rankBox', 'careerBox']){
    $(id).addEventListener('click', openRank);
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openRank(); }
    });
  }
  const closeRank = () => { $('rankSheet').hidden = true; };
  $('rankDone').addEventListener('click', closeRank);
  // 点抽屉外面也关掉，免得非得够到底部那个按钮
  $('rankSheet').addEventListener('click', (e) => { if (e.target === $('rankSheet')) closeRank(); });
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  $('restartBtn').addEventListener('click', () => restart(true));
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
  const ag = $('allinGo');
  if (ag){
    const take = (e) => { e.preventDefault(); betAccept(); };
    ag.addEventListener('touchstart', take, { passive: false });
    ag.addEventListener('click', (e) => { if (!e.detail) return; take(e); });
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
  get heat(){ return heat; }, set heat(v){ heat = v; heatQuant = -1; },
  heatMult, heatGain, rollMod, collapseCols,
  BET_TIERS, BET_LOSE, BET_NEED, BET_CAP, betMult, BET_OFFER_NEED, BET_COOL, BET_MIN_HEAT, BET_MS,
  get betCool(){ return betCool; }, get betLines(){ return betLines; }, betMaybeOffer, betStep,
  bombAt, laserAt, hammerAt, doQuake, doCompact, betAccept,
  get evActive(){ return evActive && evActive.key; },
  get evPending(){ return evPending && evPending.key; },
  get betOffer(){ return betOffer; }, get betLeft(){ return betLeft; },
  rerollPiece, canReroll, REROLL_COST,
  evFire, pickEvent, MOD_RATES, EVENTS, EV_DEADLY, stackTopRow, DANGER_ROW,
  // 调试用：直接点燃指定事件。evFire 读的是 evPending，从外面没法塞，
  // 只能靠真实调度随机等 —— 排查和截图时不可用。
  evForce: (key) => { const e = EVENTS.find(x => x.key === key); if (!e) return false;
                      evPending = e; evFire(); return true; }, doFreeze, doWall, setMuffle, syncTempo, spawnNext,
  redraw: () => { staticDirty = true; previewDirty = true; needsDraw = true; },
  rankOf, careerOf, RANKS, CAREER, MILESTONES, readTotal, readDaily, bjDay, crazyScoreMult,
  syncRank, openRankSheet, syncFx, fxRows, openHelp, helpSections, FORCE_RUSH,
  deepMult, DEEP_FROM, DEEP_STEP,
  saveGame, restoreGame, readSave, SAVE_KEY, RUSH_EVERY, RUSH_MULT, RUSH_NAME, RUSH_INTRO, rushEvery,
  readRushCount, countRush, takeRush, isRealRun, endRushIntro, RUSH_MIN_PIECES, RUSH_MIN_MS, RUSH_GARBAGE,
  RUSH_KEY, DAILY_KEY, writeDaily, get introLeft(){ return introLeft; }, endGame, readBest, STORE_KEY, TOTAL_KEY,
  fmtScore, setStat,
  get wallCol(){ return wallCol; }, FROZEN, GARBAGE,
  get fever(){ return feverLeft; }, get feverPity(){ return feverPity; },
  feverStart, switchTrack, setPack, setTempo,
  get trackIdx(){ return trackIdx; }, get sfxPack(){ return sfxPack; }, cellsOf, collides, restart, riseGarbage, clearStyle, popScore, garbagePeriod, garbageClock, gravityFor, levelMult, edgeColor, syncEdge, MAX_LEVEL,
  step, stepOnce, setSeed, hardDrop, tryRotate, holdPiece, tryMove, lockPiece, LINES_PER_LEVEL, COLS, ROWS, BUFFER, TOTAL_ROWS,
  dbg, peek: () => ({ clearing, grounded, lockTimer, dropTimer, frames: dbg.frames, layouts: dbg.layouts, needsDraw, staticDirty, previewDirty, parts: particles.length, sweeps: sweeps.length, rings: rings.length, embers: embers.length, beams: beams.length, squash: !!squash }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
