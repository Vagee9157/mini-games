/* 泡泡龙 —— 关卡制。
   六边形交错网格、瞄准发射、同色三连消、悬空整串掉落；
   在这之上是关卡布局、石头/冰冻障碍、救援目标、三种道具、连击倍数。
   渲染沿用俄罗斯方块那套：固定的泡泡画进离屏层，每帧只画飞行的那颗和准星。 */
(() => {
'use strict';

const COLS = 8;            // 偶数行的列数，奇数行少一列（往右错半格）
const ROWS = 13;           // 逻辑总行数
const DEAD_ROW = 11;       // 压到这行就输
const SPEED = 1050;        // 泡泡飞行速度 px/秒
const SQ3 = Math.sqrt(3);

const COLORS = ['#22d3ee', '#fbbf24', '#a855f7', '#f43f5e', '#4ade80'];
const PROG_KEY = 'bubble.prog.v2';
const BEST_KEY = 'bubble.best.v2';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// 每关一张手工布局 + 一个目标。地图用字符画，一行一个字符串：
//   .  空       a~e  普通泡（颜色 0~4）      A~E  冰冻泡（要震两次才化）
//   #  石头泡（打不消，只能靠断开掉下去）     *  目标物（救出去才算数）
// 偶数行 8 格、奇数行 7 格，解析时会自己对齐，不用数得很准。
//
// colors  这关用几种颜色（发射器只会发盘面上还存在的颜色）
// shots   发射次数预算，剩得越多星越高
// push    每几发整体压下来一行，0 = 不压
// goal    'clear' 清空所有能消的 / 'rescue' 把目标物全救下来
const LEVELS = [
  // 排布的铁律：同色要成块。盘面上没有成对的同色，玩家就永远补不出第三颗，
  // 那种交替色的棋盘格看着规整，实际是死局。
  // 冰冻泡只要震裂一次就化开（hp 1），所以每片冰下面都得压着能消的普通泡。

  // ── 1-4 入门：三色，纯消除 ──
  { name:'开场', colors:3, shots:19, push:0, goal:'clear', rows:[
    'aaabbccc','aabbbcc','aaabbccc' ]},
  { name:'三带', colors:3, shots:19, push:0, goal:'clear', rows:[
    'aaaabbbb','cccaabb','bbbccaaa','..bbcc.' ]},
  { name:'阶梯', colors:3, shots:19, push:0, goal:'clear', rows:[
    'aaaabbbb','.aabbcc','..bbcc.','...cc..' ]},
  { name:'蜂巢', colors:3, shots:29, push:0, goal:'clear', rows:[
    'aabbccaa','aabbcca','bbccaabb','bbccaab','ccaabbcc' ]},

  // ── 5-8 石头登场：打不消，只能靠断开让它掉 ──
  { name:'石门', colors:3, shots:19, push:0, goal:'clear', rows:[
    '##aabb##','#aabbc#','aabbccaa','.bbcca.' ]},
  // 石头别横着连成一整排 —— 那样上半部分永远够不着，是死锁。
  // 留口子要留「空格」，填成泡泡那行照样是满的，打不上去。
  { name:'夹心', colors:3, shots:29, push:0, goal:'clear', rows:[
    'aaabbbcc','#.bbb.#','ccbbbaaa','..bbcc.' ]},
  { name:'立柱', colors:3, shots:27, push:0, goal:'clear', rows:[
    'aa##bb##','aaabbbc','##cc##aa','.cccaa.' ]},
  { name:'碉堡', colors:4, shots:35, push:0, goal:'clear', rows:[
    '#aabbcc#','#aabbc#','##ccdd##','.ccdd..' ]},

  // ── 9-12 冰冻登场：震一次就化，化完还得再消掉 ──
  { name:'初霜', colors:3, shots:33, push:0, goal:'clear', rows:[
    'AAABBCcc','aabbbcc','aaabbccc' ]},
  { name:'冰层', colors:3, shots:25, push:0, goal:'clear', rows:[
    'AAABBCCC','aabbbcc','AAABBCCC','.bbcc..' ]},
  { name:'寒潮', colors:4, shots:31, push:0, goal:'clear', rows:[
    'AAABBBcc','aabbbcc','ccddaabb','.ccdda.' ]},
  { name:'冰封', colors:4, shots:35, push:0, goal:'clear', rows:[
    'AABBCCDD','aabbccd','AABBCCDD','aabbccd','..bbcc.' ]},

  // ── 13-16 救援：把星星下面掏空，让它掉下来 ──
  { name:'吊笼', colors:3, shots:19, push:0, goal:'rescue', rows:[
    'aaabbccc','aabbbcc','a.*..*.a','.aabbc.' ]},
  { name:'鸟巢', colors:3, shots:21, push:0, goal:'rescue', rows:[
    '#aabbcc#','aabbbcc','a.*.*.a','.aabbc.','...*...' ]},
  // 星星别用石头夹着：石头只要还连着上面就不掉，星星等于被钉死在那儿
  { name:'深井', colors:4, shots:33, push:0, goal:'rescue', rows:[
    'aabbccdd','aabbccd','aa*bb*dd','.aabbc.','...*...' ]},
  { name:'冰窟', colors:4, shots:31, push:0, goal:'rescue', rows:[
    'AABBCCDD','aabbccd','a.*..*.a','.aabbc.','..*.*..' ]},

  // ── 17-20 收官：五色、混合障碍、开始压行 ──
  { name:'万花筒', colors:5, shots:41, push:0, goal:'clear', rows:[
    'aabbccdd','eeaabbc','ccddeeaa','.bbccd.' ]},
  { name:'迷宫', colors:4, shots:29, push:14, goal:'clear', rows:[
    '#aabb#cc','#aabbc#','dd##aabb','.ddaab.' ]},
  { name:'囚笼', colors:4, shots:37, push:0, goal:'rescue', rows:[
    '##aabb##','aabbccd','a.*bb*.d','.aabbc.','...*...' ]},
  { name:'终局', colors:5, shots:43, push:0, goal:'clear', rows:[
    'AAABBBcc','aabbbcc','ccddeeaa','.ccdde.' ]},
];

// ── 格子 ──
// null 或 { t, c, hp }
//   t 'n' 普通 / 's' 石头 / 'i' 冰冻 / 'g' 目标物
//   c 颜色下标（石头和目标物是 -1）
const isPop  = (b) => !!b && b.t === 'n';          // 能参与同色消除的
const isHard = (b) => !!b && (b.t === 's' || b.t === 'g');

function parseChar(ch){
  if (ch === '.' || ch === ' ') return null;
  if (ch === '#') return { t:'s', c:-1 };
  if (ch === '*') return { t:'g', c:-1 };
  const lo = 'abcde'.indexOf(ch);
  if (lo >= 0) return { t:'n', c:lo };
  const hi = 'ABCDE'.indexOf(ch);
  if (hi >= 0) return { t:'i', c:hi, hp:1 };   // 震一次就化，两次的话预算算不过来
  return null;
}

// ── 状态 ──
let grid = [];
let R = 24, W = 0, H = 0;
let MODE = 'arcade';                // 'arcade' 竞技无尽 / 'levels' 闯关
let lvIdx = 0, lv = null;
let best = 0, wave = 0;             // 竞技模式：历史最高分 / 已经压下来几行
let cur = null, next = null;        // { c } 或 { power:'bomb'|'rainbow'|'laser' }
let shot = null;
let aim = -Math.PI / 2, aiming = false;
let score = 0, shotsLeft = 0, fired = 0, combo = 0, rescued = 0, needRescue = 0;
let powers = [];                    // 手上的道具，最多 3 个
let over = false, won = false, started = false;
let pops = [], floats = [];         // 消除动画 / 飘字
let staticDirty = true, needsDraw = true;
let aimPath = [];
let rafId = 0, lastT = 0;
let prog = { unlocked: 1, stars: {} };

const canvas = $('board');
const ctx = canvas.getContext('2d');
const bg = document.createElement('canvas');
const bgCtx = bg.getContext('2d');

function muzzleY(){ return H - R * 3.55; }

// ── 网格坐标（沿用原来那套，已经验过是精确贴合的）──
const colsIn = (r) => r % 2 ? COLS - 1 : COLS;
function cellX(r, c){ return R + c * R * 2 + (r % 2 ? R : 0); }
function cellY(r){ return R + r * R * SQ3; }

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

// 以某格为中心、半径 n 圈内的所有格（炸弹用）
function ring(r0, c0, n){
  const seen = new Set([r0 + ',' + c0]);
  let front = [[r0, c0]];
  for (let i = 0; i < n; i++){
    const nxt = [];
    for (const [r, c] of front)
      for (const [nr, nc] of neighbours(r, c)){
        const k = nr + ',' + nc;
        if (seen.has(k)) continue;
        seen.add(k); nxt.push([nr, nc]);
      }
    front = nxt;
  }
  return [...seen].map(k => k.split(',').map(Number));
}

// ── 进度存档 ──
function readProg(){
  try {
    const d = JSON.parse(localStorage.getItem(PROG_KEY) || 'null');
    if (d && typeof d.unlocked === 'number') return { unlocked: d.unlocked, stars: d.stars || {} };
  } catch { /* 坏数据就从头来 */ }
  return { unlocked: 1, stars: {} };
}
function writeProg(){
  try { localStorage.setItem(PROG_KEY, JSON.stringify(prog)); } catch { /* 忽略 */ }
}
const starsOf = (i) => prog.stars[i] || 0;
const totalStars = () => LEVELS.reduce((s, _, i) => s + starsOf(i), 0);

// ── 装关卡 ──
function loadLevel(i){
  MODE = 'levels';
  lvIdx = clamp(i, 0, LEVELS.length - 1);
  lv = LEVELS[lvIdx];
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(colsIn(r)).fill(null));
  needRescue = 0;
  lv.rows.forEach((line, r) => {
    if (r >= ROWS) return;
    for (let c = 0; c < colsIn(r); c++){
      const b = parseChar(line[c] || '.');
      if (!b) continue;
      if (b.c >= lv.colors) b.c = b.c % lv.colors;   // 布局里写超色号就绕回来
      grid[r][c] = b;
      if (b.t === 'g') needRescue++;
    }
  });
  score = 0; fired = 0; combo = 0; rescued = 0;
  shotsLeft = lv.shots;
  powers = [];
  over = false; won = false; started = true;
  shot = null; pops = []; floats = [];
  cur = { c: pickColor() }; next = { c: pickColor() };
  $('overlay').classList.remove('show');
  staticDirty = true; needsDraw = true;
  traceAim(); syncHud();
  lastT = performance.now();
  if (!rafId) rafId = requestAnimationFrame(tick);
}

// 竞技模式：没有终点，活多久算多久。
// 难度三条线一起爬 —— 颜色变多、压行变勤、新行开始掺障碍。
// 数值挂在「已发射数」上：打得越久越难，跟闯关那套关卡预算完全分开。
const ARC_PUSH0 = 8;        // 开局每 8 发压一行
const ARC_PUSH_MIN = 3;     // 间隔压到 3 发就不再缩
function arcadeTune(){
  const f = fired;
  lv.colors = f < 25 ? 3 : f < 70 ? 4 : 5;
  lv.push = Math.max(ARC_PUSH_MIN, ARC_PUSH0 - Math.floor(f / 26));
  // 障碍从第 35 发开始掺进新压下来的行里，越往后越多
  lv.stone = f < 35 ? 0 : Math.min(.26, (f - 35) * .0022);
  lv.ice   = f < 50 ? 0 : Math.min(.30, (f - 50) * .0028);
  // 上面三条都有天花板，到 180 发左右难度就成了水平线，
  // 够强的人可以无限打下去（bot 实测 400 发不死）。
  // 所以再加一条没有上限的：过了 170 发开始一次压两行，之后每 70 发再多一行。
  lv.pushRows = 1 + Math.max(0, Math.floor((f - 170) / 70) + (f >= 170 ? 1 : 0));
}

// 竞技模式新压一行时按当前难度掺障碍
function arcadeCell(){
  if (MODE === 'arcade'){
    if (Math.random() < lv.stone) return { t:'s', c:-1 };
    if (Math.random() < lv.ice)   return { t:'i', c: pickColor(), hp:1 };
  }
  return { t:'n', c: pickColor() };
}

function loadArcade(){
  MODE = 'arcade';
  lv = { name:'竞技', colors:3, shots:Infinity, push:ARC_PUSH0, goal:'arcade', stone:0, ice:0 };
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(colsIn(r)).fill(null));
  score = 0; fired = 0; combo = 0; rescued = 0; needRescue = 0; wave = 0;
  shotsLeft = Infinity;
  powers = [];
  over = false; won = false; started = true;
  shot = null; pops = []; floats = [];
  // 开局铺四行
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < colsIn(r); c++)
      grid[r][c] = { t:'n', c: (Math.random() * 3) | 0 };
  cur = { c: pickColor() }; next = { c: pickColor() };
  $('overlay').classList.remove('show');
  $('lvSheet').hidden = true;
  staticDirty = true; needsDraw = true;
  arcadeTune(); traceAim(); syncHud();
  lastT = performance.now();
  if (!rafId) rafId = requestAnimationFrame(tick);
}

// 只发盘面上还有的颜色，免得给一颗根本凑不出三连的死球
function pickColor(){
  const live = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < colsIn(r); c++){
    const b = grid[r][c];
    if (b && (b.t === 'n' || b.t === 'i')) live.add(b.c);
  }
  const pool = live.size ? [...live] : Array.from({ length: lv.colors }, (_, i) => i);
  return pool[(Math.random() * pool.length) | 0];
}

// ── 发射 ──
function fire(){
  if (over || shot || !started || shotsLeft <= 0) return;
  const a = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
  shot = { x: W / 2, y: muzzleY(), vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED,
           c: cur.c, power: cur.power || null };
  cur = next; next = { c: pickColor() };
  if (MODE === 'levels') shotsLeft--;
  fired++;
  sfx(shot.power ? 'power' : 'shoot');
  syncHud();
  needsDraw = true;
}

function swap(){
  if (over || shot || !started) return;
  const t = cur; cur = next; next = t;
  traceAim(); sfx('swap'); syncHud(); needsDraw = true;
}

// 点道具栏：把道具装到手上（原来手里那颗退回去当下一颗）
function armPower(i){
  if (over || shot || !started) return;
  const p = powers[i];
  if (!p) return;
  powers.splice(i, 1);
  if (!cur.power) next = cur;
  cur = { c: -1, power: p };
  traceAim(); sfx('swap'); syncHud(); needsDraw = true;
}

function grantPower(){
  if (powers.length >= 3) return;
  const pool = ['bomb', 'rainbow', 'laser'];
  powers.push(pool[(Math.random() * pool.length) | 0]);
  sfx('grant');
  syncHud();
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

  if (shot.x < R){ shot.x = R; shot.vx = Math.abs(shot.vx); }
  if (shot.x > W - R){ shot.x = W - R; shot.vx = -Math.abs(shot.vx); }

  // 激光：不落地，一路穿过去，碰到什么消什么
  if (shot.power === 'laser'){
    const rr = (R * 1.55) ** 2;
    let hit = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < colsIn(r); c++){
        if (!grid[r][c]) continue;
        const dx = shot.x - cellX(r, c), dy = shot.y - cellY(r);
        if (dx * dx + dy * dy < rr){ killCell(r, c); hit++; }
      }
    if (hit){ score += hit * 15; staticDirty = true; }
    if (shot.y <= R){ shot = null; afterShot(hit, 0); }
    return;
  }

  if (shot.y <= R){ land(); return; }

  const rr = (R * 1.86) ** 2;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < colsIn(r); c++){
      if (!grid[r][c]) continue;
      const dx = shot.x - cellX(r, c), dy = shot.y - cellY(r);
      if (dx * dx + dy * dy < rr){ land(); return; }
    }
  }
}

function killCell(r, c, fall){
  const b = grid[r][c];
  if (!b) return;
  addPop(r, c, colorOf(b), fall, b.t);
  if (b.t === 'g'){ rescued++; score += 300; addFloat(r, c, '救出!'); }
  grid[r][c] = null;
}
const colorOf = (b) => b.t === 's' ? '#8a97ad' : b.t === 'g' ? '#facc15' : COLORS[b.c];

// 落到最近的空格（必须挨着已有泡泡或在第一行，不然会浮着）
function land(){
  const b = { r: -1, c: -1, d: Infinity };
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < colsIn(r); c++){
      if (grid[r][c]) continue;
      if (r > 0 && !neighbours(r, c).some(([nr, nc]) => grid[nr][nc])) continue;
      const dx = cellX(r, c) - shot.x, dy = cellY(r) - shot.y;
      const d = dx * dx + dy * dy;
      if (d < b.d){ b.d = d; b.r = r; b.c = c; }
    }
  }
  const sh = shot;
  shot = null;
  if (b.r < 0){ afterShot(0, 0); return; }

  // 炸弹：不留在盘上，直接把周围两圈端掉
  if (sh.power === 'bomb'){
    let n = 0;
    for (const [r, c] of ring(b.r, b.c, 2)) if (grid[r][c]){ killCell(r, c); n++; }
    score += n * 20;
    staticDirty = true;
    sfx('boom');
    const loose = dropFloating();
    afterShot(n, loose);
    return;
  }

  // 彩虹：落点周围哪种颜色多就变成哪种
  let color = sh.c;
  if (sh.power === 'rainbow'){
    const cnt = {};
    for (const [nr, nc] of neighbours(b.r, b.c)){
      const nb = grid[nr][nc];
      if (nb && nb.t === 'n') cnt[nb.c] = (cnt[nb.c] || 0) + 1;
    }
    const keys = Object.keys(cnt);
    color = keys.length ? +keys.sort((x, y) => cnt[y] - cnt[x])[0] : pickColor();
  }

  grid[b.r][b.c] = { t:'n', c: color };
  staticDirty = true;

  const same = sameGroup(b.r, b.c);
  let popped = 0, loose = 0;
  if (same.length >= 3){
    crackAround(same);                       // 先震裂贴着的冰
    same.forEach(([r, c]) => killCell(r, c));
    popped = same.length;
    loose = dropFloating();
    sfx(popped >= 5 ? 'big' : 'pop');
  } else {
    sfx('stick');
  }
  afterShot(popped, loose);
}

// 消除会震裂紧挨着的冰冻泡，两次就化开
function crackAround(group){
  const seen = new Set();
  for (const [r, c] of group)
    for (const [nr, nc] of neighbours(r, c)){
      const k = nr + ',' + nc;
      if (seen.has(k)) continue;
      seen.add(k);
      const b = grid[nr][nc];
      if (!b || b.t !== 'i') continue;
      b.hp--;
      if (b.hp <= 0) grid[nr][nc] = { t:'n', c: b.c };
      staticDirty = true;
    }
}

// 一杆打完的结算：连击、计分、压行、胜负
function afterShot(popped, loose){
  if (popped > 0){
    combo++;
    const mul = Math.min(5, combo);
    const gain = (popped * 10 + loose * 25) * mul;
    score += gain;
    if (popped >= 5) grantPower();
    if (combo >= 2) toast(`${combo} 连击 ×${mul}`);
    else if (loose >= 3) toast(`掉了 ${loose} 颗！`);
  } else {
    combo = 0;
  }
  if (MODE === 'arcade') arcadeTune();
  if (lv.push && fired % lv.push === 0) pushDown();
  checkEnd();
  traceAim(); syncHud();
}

// 同色连通块（只算普通泡，石头/冰/目标不参与）
function sameGroup(r0, c0){
  const base = grid[r0][c0];
  if (!isPop(base)) return [];
  const seen = new Set([r0 + ',' + c0]);
  const out = [[r0, c0]], q = [[r0, c0]];
  while (q.length){
    const [r, c] = q.pop();
    for (const [nr, nc] of neighbours(r, c)){
      const k = nr + ',' + nc;
      const nb = grid[nr][nc];
      if (seen.has(k) || !isPop(nb) || nb.c !== base.c) continue;
      seen.add(k); out.push([nr, nc]); q.push([nr, nc]);
    }
  }
  return out;
}

// 从顶行灌一遍，灌不到的就是悬空的，整串掉下来
function dropFloating(){
  const safe = new Set(), q = [];
  for (let c = 0; c < colsIn(0); c++) if (grid[0][c]){ safe.add('0,' + c); q.push([0, c]); }
  while (q.length){
    const [r, c] = q.pop();
    for (const [nr, nc] of neighbours(r, c)){
      const k = nr + ',' + nc;
      if (safe.has(k) || !grid[nr][nc]) continue;
      safe.add(k); q.push([nr, nc]);
    }
  }
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] && !safe.has(r + ',' + c)){ killCell(r, c, true); n++; }
  if (n) staticDirty = true;
  return n;
}

// 整体往下压一行。
// 奇偶行列数不一样（8 / 7），下移时最右那颗装不下会被丢掉，
// 原本挂在它下面的可能就断了 —— 所以压完必须再跑一次悬空检查。
function pushDown(){
  const times = MODE === 'arcade' ? (lv.pushRows || 1) : 1;
  for (let i = 0; i < times; i++) pushOneRow();
  dropFloating();
  staticDirty = true;
  toast(times > 1 ? `压下来 ${times} 行！` : '压下来一行');
}

function pushOneRow(){
  for (let r = ROWS - 1; r > 0; r--){
    const src = grid[r - 1], dst = grid[r];
    for (let c = 0; c < dst.length; c++) dst[c] = c < src.length ? src[c] : null;
  }
  grid[0] = new Array(colsIn(0)).fill(null);
  for (let c = 0; c < colsIn(0); c++) grid[0][c] = arcadeCell();
  wave++;
}

// ── 胜负 ──
function checkEnd(){
  if (over) return;
  let anyPop = false, deep = false;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++){
      const b = grid[r][c];
      if (!b) continue;
      if (b.t === 'n' || b.t === 'i') anyPop = true;
      if (r >= DEAD_ROW) deep = true;
    }
  if (MODE === 'arcade'){
    // 竞技模式没有赢，只有活多久；盘面清空了就再铺两行接着来
    if (!anyPop && !deep){ refillArcade(); return; }
    if (deep){ finish(false, '压到底线了'); return; }
    return;
  }
  if (lv.goal === 'rescue'){
    if (rescued >= needRescue){ finish(true); return; }
  } else if (!anyPop){ finish(true); return; }
  if (deep){ finish(false, '压到底线了'); return; }
  if (shotsLeft <= 0 && !shot){ finish(false, '泡泡用完了'); return; }
}

// 全清了给一笔奖励再续上，别让人因为打得太好反而没得打
function refillArcade(){
  score += 500;
  toast('全清 +500');
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < colsIn(r); c++) grid[r][c] = arcadeCell();
  staticDirty = true; needsDraw = true;
  syncHud();
}

function starsFor(){
  const keep = shotsLeft / lv.shots;
  return keep >= .45 ? 3 : keep >= .2 ? 2 : 1;
}

function finish(win, why){
  over = true; won = win;
  if (MODE === 'arcade'){
    if (score > best){ best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* 忽略 */ } }
    $('overlay').dataset.mode = 'arc';
    $('arcScore').textContent = score.toLocaleString();
    $('arcBest').textContent = best.toLocaleString();
    $('arcShots').textContent = fired;
    $('arcWave').textContent = wave;
    $('overlay').classList.add('show');
    sfx('over'); syncHud(); needsDraw = true;
    return;
  }
  let st = 0;
  if (win){
    st = starsFor();
    if (st > starsOf(lvIdx)) prog.stars[lvIdx] = st;
    if (lvIdx + 1 >= prog.unlocked) prog.unlocked = Math.min(LEVELS.length, lvIdx + 2);
    writeProg();
  }
  $('overlay').dataset.mode = win ? 'win' : 'lose';
  $('endLv').textContent = `第 ${lvIdx + 1} 关 · ${lv.name}`;
  $('endScore').textContent = score.toLocaleString();
  $('endWhy').textContent = why || '';
  renderStars($('endStars'), st);
  $('nextBtn').hidden = !win || lvIdx + 1 >= LEVELS.length;
  $('overlay').classList.add('show');
  sfx(win ? 'win' : 'over');
  syncHud(); needsDraw = true;
}

function renderStars(el, n){
  el.innerHTML = '';
  for (let i = 0; i < 3; i++){
    const s = document.createElement('span');
    s.className = 'star' + (i < n ? ' on' : '');
    s.textContent = '★';
    el.appendChild(s);
  }
}

// ── 飘字 / 消除动画 ──
let toastT = 0;
function toast(text){
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1000);
}
function addFloat(r, c, text){
  floats.push({ x: cellX(r, c), y: cellY(r), text, t: 0 });
}
function addPop(r, c, color, fall, type){
  pops.push({
    x: cellX(r, c), y: cellY(r), color, t: 0, fall: !!fall, type,
    vx: fall ? (Math.random() - .5) * 120 : 0,
    vy: fall ? 40 + Math.random() * 80 : 0,
  });
}
function stepPops(dt){
  const s = dt / 1000;
  for (let i = pops.length - 1; i >= 0; i--){
    const p = pops[i];
    p.t += dt;
    if (p.fall){
      p.vy += 1500 * s;
      p.x += p.vx * s; p.y += p.vy * s;
      // 撞到边就弹回来，比直上直下的掉落有质感
      if (p.x < R){ p.x = R; p.vx = Math.abs(p.vx) * .7; }
      if (p.x > W - R){ p.x = W - R; p.vx = -Math.abs(p.vx) * .7; }
    }
    if (p.t > (p.fall ? 1100 : 260) || p.y > H + R) pops.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--){
    const f = floats[i];
    f.t += dt; f.y -= 34 * s;
    if (f.t > 900) floats.splice(i, 1);
  }
  if (pops.length || floats.length) needsDraw = true;
}

// 瞄准线走一遍，撞墙折回来，碰到泡泡或顶就停。只在角度变了时算，不是每帧。
function traceAim(){
  const a = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
  const pts = [{ x: W / 2, y: muzzleY() }];
  let x = W / 2, y = muzzleY();
  let vx = Math.cos(a), vy = Math.sin(a);
  const stepLen = R * .55, hitR2 = (R * 1.86) ** 2;
  let bounces = 0;
  for (let i = 0; i < 260; i++){
    x += vx * stepLen; y += vy * stepLen;
    if (x < R){ x = R; vx = -vx; pts.push({ x, y }); if (++bounces > 2) break; }
    else if (x > W - R){ x = W - R; vx = -vx; pts.push({ x, y }); if (++bounces > 2) break; }
    if (y <= R){ pts.push({ x, y }); break; }
    let hit = false;
    for (let r = 0; r < ROWS && !hit; r++)
      for (let c = 0; c < grid[r].length; c++){
        if (!grid[r][c]) continue;
        const dx = x - cellX(r, c), dy = y - cellY(r);
        if (dx * dx + dy * dy < hitR2){ hit = true; break; }
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
  let r = availW / (COLS * 2);
  const needH = (rr) => rr + (DEAD_ROW + 0.6) * rr * SQ3 + rr * 4.0;
  if (needH(r) > availH) r *= availH / needH(r);
  R = Math.floor(r);
  W = R * COLS * 2;
  H = Math.round(needH(R));
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

// 石头：灰麻面 + 几道裂纹，一眼看出打不动
function stoneBall(c, x, y, scale = 1, alpha = 1){
  const rr = R * scale;
  c.save();
  c.globalAlpha = alpha;
  const g = c.createRadialGradient(x - rr * .3, y - rr * .35, rr * .1, x, y, rr);
  g.addColorStop(0, '#9aa7bd'); g.addColorStop(.6, '#67738a'); g.addColorStop(1, '#3b4557');
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, rr * .94, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(20,26,38,.7)'; c.lineWidth = Math.max(1, rr * .08); c.stroke();
  c.strokeStyle = 'rgba(30,38,54,.55)'; c.lineWidth = Math.max(1, rr * .09);
  c.beginPath();
  c.moveTo(x - rr * .5, y - rr * .12); c.lineTo(x - rr * .06, y + rr * .16); c.lineTo(x + rr * .42, y - rr * .3);
  c.stroke();
  c.restore();
}

// 冰冻：底下那颗颜色透出来，外面罩一层带棱的冰壳；裂了一次的冰壳更薄
function iceBall(c, x, y, color, hp, scale = 1, alpha = 1){
  ball(c, x, y, color, scale, alpha * (hp >= 2 ? .5 : .75));
  const rr = R * scale;
  c.save();
  c.globalAlpha = alpha * (hp >= 2 ? .92 : .6);
  const g = c.createRadialGradient(x - rr * .3, y - rr * .4, rr * .1, x, y, rr);
  g.addColorStop(0, 'rgba(235,250,255,.85)');
  g.addColorStop(.6, 'rgba(150,215,240,.45)');
  g.addColorStop(1, 'rgba(90,150,190,.55)');
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, rr * .94, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(225,248,255,.9)'; c.lineWidth = Math.max(1, rr * .09); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = Math.max(1, rr * .07);
  c.beginPath();
  if (hp >= 2){ c.moveTo(x - rr * .45, y - rr * .2); c.lineTo(x + rr * .1, y + rr * .45); }
  c.moveTo(x + rr * .12, y - rr * .5); c.lineTo(x - rr * .2, y + rr * .1); c.lineTo(x + rr * .45, y + rr * .35);
  c.stroke();
  c.restore();
}

// 目标物：一颗要救出去的星星
function goalBall(c, x, y, scale = 1, alpha = 1){
  const rr = R * scale;
  c.save();
  c.globalAlpha = alpha;
  const g = c.createRadialGradient(x - rr * .3, y - rr * .35, rr * .1, x, y, rr);
  g.addColorStop(0, '#fff6cc'); g.addColorStop(.6, '#facc15'); g.addColorStop(1, '#b45309');
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, rr * .94, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(120,70,10,.7)'; c.lineWidth = Math.max(1, rr * .08); c.stroke();
  c.fillStyle = '#7c4a03';
  c.beginPath();
  for (let i = 0; i < 10; i++){
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const k = i % 2 ? rr * .26 : rr * .58;
    const px = x + Math.cos(a) * k, py = y + Math.sin(a) * k;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath(); c.fill();
  c.restore();
}

function drawCell(c, r, col, b, scale = 1, alpha = 1){
  const x = cellX(r, col), y = cellY(r);
  if (b.t === 's') stoneBall(c, x, y, scale, alpha);
  else if (b.t === 'i') iceBall(c, x, y, COLORS[b.c], b.hp, scale, alpha);
  else if (b.t === 'g') goalBall(c, x, y, scale, alpha);
  else ball(c, x, y, COLORS[b.c], scale, alpha);
}

// 泡泡龙的发射器本来就是只小恐龙（Bub），把它画出来：
// 身子跟着瞄准方向轻轻侧一下，眼珠子也跟着看过去。
function drawDino(c, cx, cy, a){
  const s = R * .90;
  const lean = (a + Math.PI / 2) * .30;          // 正上方是 0，越偏侧得越多
  const look = clamp((a + Math.PI / 2) * .5, -.9, .9);

  c.save();
  c.translate(cx, cy + R * 2.36);   // 头顶刚好托住嘴上那颗泡泡
  c.rotate(lean * .5);

  const green = '#4ade80', deep = '#1c8b4e';

  // 尾巴
  c.fillStyle = deep;
  c.beginPath();
  c.moveTo(-s * .2, s * .35);
  c.quadraticCurveTo(-s * 1.5, s * .5, -s * 1.25, -s * .25);
  c.quadraticCurveTo(-s * .95, s * .1, -s * .2, s * .05);
  c.closePath(); c.fill();

  // 两只脚
  c.fillStyle = deep;
  for (const dx of [-s * .52, s * .52]){
    c.beginPath(); c.ellipse(dx, s * .92, s * .34, s * .2, 0, 0, Math.PI * 2); c.fill();
  }

  // 身子
  const g = c.createRadialGradient(-s * .3, -s * .35, s * .1, 0, 0, s * 1.25);
  g.addColorStop(0, '#86efac');
  g.addColorStop(.6, green);
  g.addColorStop(1, deep);
  c.fillStyle = g;
  c.beginPath(); c.ellipse(0, 0, s * 1.02, s * .95, 0, 0, Math.PI * 2); c.fill();

  // 肚皮
  c.fillStyle = 'rgba(255,255,230,.85)';
  c.beginPath(); c.ellipse(0, s * .24, s * .55, s * .48, 0, 0, Math.PI * 2); c.fill();

  // 背上三根小刺
  c.fillStyle = '#facc15';
  for (const [bx, by, sz] of [[-s * .82, -s * .46, .26], [-s * .95, -s * .02, .22], [-s * .86, s * .38, .18]]){
    c.beginPath();
    c.moveTo(bx, by - s * sz);
    c.lineTo(bx - s * sz * 1.1, by);
    c.lineTo(bx, by + s * sz);
    c.closePath(); c.fill();
  }

  // 头
  c.fillStyle = g;
  c.beginPath(); c.arc(s * .12, -s * .92, s * .74, 0, Math.PI * 2); c.fill();

  // 眼睛：白眼球 + 跟着瞄准方向挪的黑眼珠
  for (const ex of [-s * .16, s * .42]){
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(ex, -s * 1.1, s * .22, s * .26, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0b1120';
    c.beginPath(); c.arc(ex + look * s * .11, -s * 1.08, s * .12, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.beginPath(); c.arc(ex + look * s * .11 - s * .04, -s * 1.13, s * .045, 0, Math.PI * 2); c.fill();
  }

  // 嘴：一个小小的 O，泡泡就是从这儿吐出去的
  c.fillStyle = '#7f1d3a';
  c.beginPath(); c.ellipse(s * .12, -s * .48, s * .2, s * .16, 0, 0, Math.PI * 2); c.fill();

  // 腮红
  c.fillStyle = 'rgba(244,114,182,.5)';
  c.beginPath(); c.ellipse(-s * .48, -s * .66, s * .16, s * .1, 0, 0, Math.PI * 2); c.fill();

  c.restore();
}

function drawStatic(){
  bgCtx.clearRect(0, 0, W, H);
  const near = DEAD_ROW - topRow();
  const hot = near <= 2;
  const dy = cellY(DEAD_ROW) - R * .9;
  bgCtx.save();
  bgCtx.strokeStyle = hot ? 'rgba(244,63,94,.85)' : 'rgba(244,63,94,.34)';
  bgCtx.lineWidth = hot ? 2.5 : 1.5;
  bgCtx.setLineDash([6, 6]);
  bgCtx.beginPath(); bgCtx.moveTo(0, dy); bgCtx.lineTo(W, dy); bgCtx.stroke();
  if (hot){
    const grd = bgCtx.createLinearGradient(0, dy - R * 2.2, 0, dy);
    grd.addColorStop(0, 'rgba(244,63,94,0)');
    grd.addColorStop(1, 'rgba(244,63,94,.16)');
    bgCtx.fillStyle = grd;
    bgCtx.fillRect(0, dy - R * 2.2, W, R * 2.2);
  }
  bgCtx.restore();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c]) drawCell(bgCtx, r, c, grid[r][c]);
  staticDirty = false;
}

// 手里/下一颗的画法：道具有自己的样子
function handBall(c, x, y, item, rr){
  const keep = R; R = rr;
  if (item && item.power) powerBall(c, x, y, item.power, 1);
  else ball(c, x, y, COLORS[item && item.c >= 0 ? item.c : 0]);
  R = keep;
}
function powerBall(c, x, y, kind, scale = 1){
  const rr = R * scale;
  const tint = kind === 'bomb' ? '#f97316' : kind === 'laser' ? '#38bdf8' : '#e879f9';
  ball(c, x, y, tint, scale);
  c.save();
  c.translate(x, y);
  c.strokeStyle = '#fff'; c.fillStyle = '#fff';
  c.lineWidth = Math.max(1.5, rr * .12);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (kind === 'bomb'){
    c.beginPath(); c.arc(0, rr * .1, rr * .36, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(rr * .2, -rr * .26); c.quadraticCurveTo(rr * .55, -rr * .6, rr * .3, -rr * .72); c.stroke();
  } else if (kind === 'laser'){
    c.beginPath(); c.moveTo(0, -rr * .55); c.lineTo(0, rr * .55); c.stroke();
    c.beginPath(); c.moveTo(-rr * .28, -rr * .2); c.lineTo(0, -rr * .55); c.lineTo(rr * .28, -rr * .2); c.stroke();
  } else {
    for (let i = 0; i < 3; i++){
      c.globalAlpha = .55 + i * .15;
      c.beginPath(); c.arc(0, rr * .35, rr * (.28 + i * .17), Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    }
  }
  c.restore();
}

function draw(){
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  if (staticDirty) drawStatic();
  ctx.drawImage(bg, 0, 0, W, H);

  for (const p of pops){
    const a = p.fall ? Math.max(0, 1 - p.t / 1100) : Math.max(0, 1 - p.t / 260);
    const sc = p.fall ? 1 : 1 + (p.t / 260) * .5;
    const keep = R;
    ctx.save(); ctx.globalAlpha = a;
    if (p.type === 's') stoneBall(ctx, p.x, p.y, sc, 1);
    else if (p.type === 'g') goalBall(ctx, p.x, p.y, sc, 1);
    else ball(ctx, p.x, p.y, p.color, sc, 1);
    ctx.restore();
    R = keep;
  }

  for (const f of floats){
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - f.t / 900);
    ctx.fillStyle = '#facc15';
    ctx.font = `600 ${Math.round(R * .78)}px "Noto Sans SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }

  if (!over && !shot && started && aimPath.length > 1){
    ctx.save();
    ctx.strokeStyle = 'rgba(190,220,255,.32)';
    ctx.lineWidth = 2; ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(aimPath[0].x, aimPath[0].y);
    for (let i = 1; i < aimPath.length; i++) ctx.lineTo(aimPath[i].x, aimPath[i].y);
    ctx.stroke(); ctx.setLineDash([]);
    const e = aimPath[aimPath.length - 1];
    ctx.globalAlpha = .5;
    ctx.strokeStyle = cur.power ? '#e879f9' : COLORS[cur.c];
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, R * .9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  if (shot){
    if (shot.power === 'laser'){
      ctx.save();
      ctx.strokeStyle = 'rgba(120,210,255,.75)';
      ctx.lineWidth = R * .5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(shot.x, shot.y); ctx.lineTo(shot.x - shot.vx * .05, shot.y - shot.vy * .05);
      ctx.stroke(); ctx.restore();
    }
    if (shot.power) powerBall(ctx, shot.x, shot.y, shot.power);
    else ball(ctx, shot.x, shot.y, COLORS[shot.c]);
  }

  if (!over){
    drawDino(ctx, W / 2, muzzleY(), clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06));
    if (!shot) handBall(ctx, W / 2, muzzleY(), cur, R);
    const n = nextSpot();
    ctx.save();
    ctx.globalAlpha = .9;
    ctx.strokeStyle = 'rgba(150,180,230,.30)';
    ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.35, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    handBall(ctx, n.x, n.y, next, n.r);
  }
}

function nextSpot(){ return { x: W / 2 + R * 2.6, y: muzzleY() + R * 2.1, r: R * .62 }; }

function mix(a, b, t){
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function hex(h){
  return h.length === 4 ? h.slice(1).split('').map(x => parseInt(x + x, 16))
                        : [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}
function topRow(){
  for (let r = ROWS - 1; r >= 0; r--)
    for (let c = 0; c < colsIn(r); c++) if (grid[r][c]) return r;
  return 0;
}

// ── HUD / 选关 ──
function syncHud(){
  $('score').textContent = score.toLocaleString();
  const lvCell = $('lvCell'), goalCell = $('goalCell'), shotsCell = $('shotsCell');
  if (MODE === 'arcade'){
    // 竞技模式看的是：最高分、离底线还有几行、连击
    lvCell.querySelector('span').textContent = '最高';
    $('lvName').textContent = best.toLocaleString();
    goalCell.querySelector('span').textContent = '连击';
    $('goal').textContent = combo > 0 ? `×${Math.min(5, combo)}` : '—';
    shotsCell.querySelector('span').textContent = '离底线';
    const left = Math.max(0, DEAD_ROW - topRow());
    $('shots').textContent = left;
    shotsCell.classList.toggle('warn', left <= 2);
  } else {
    lvCell.querySelector('span').textContent = '关卡';
    $('lvName').textContent = `${lvIdx + 1} · ${lv ? lv.name : ''}`;
    shotsCell.querySelector('span').textContent = '剩余';
    $('shots').textContent = shotsLeft;
    shotsCell.classList.toggle('warn', shotsLeft <= 5);
    if (lv && lv.goal === 'rescue'){
      goalCell.querySelector('span').textContent = '救出';
      $('goal').textContent = `${rescued}/${needRescue}`;
    } else {
      goalCell.querySelector('span').textContent = '目标';
      $('goal').textContent = '清空';
    }
  }
  renderPowers();
  drawNextMini();
}

function renderPowers(){
  const bar = $('powerBar');
  bar.innerHTML = '';
  for (let i = 0; i < 3; i++){
    const b = document.createElement('button');
    b.className = 'pw' + (powers[i] ? ' has' : '');
    b.disabled = !powers[i];
    b.setAttribute('aria-label', powers[i] ? '使用道具' : '空道具位');
    if (powers[i]){
      const cv = document.createElement('canvas');
      const d = 34, dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = d * dpr; cv.height = d * dpr;
      cv.style.width = cv.style.height = d + 'px';
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const keep = R; R = d * .44;
      powerBall(c, d / 2, d / 2, powers[i]);
      R = keep;
      b.appendChild(cv);
      b.addEventListener('click', () => armPower(i));
    }
    bar.appendChild(b);
  }
}

function drawNextMini(){
  const cv = $('nextCv'), c = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h || !next) return;
  cv.width = w * dpr; cv.height = h * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  handBall(c, w / 2, h / 2, next, Math.min(w, h) * .42);
}

function openLevels(){
  const box = $('lvGrid');
  box.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i + 1 > prog.unlocked;
    const b = document.createElement('button');
    b.className = 'lv' + (locked ? ' locked' : '') + (i === lvIdx ? ' cur' : '');
    b.disabled = locked;
    b.innerHTML = `<b>${i + 1}</b><i>${L.name}</i><u>${'★'.repeat(starsOf(i))}${'☆'.repeat(3 - starsOf(i))}</u>`;
    if (!locked) b.addEventListener('click', () => { $('lvSheet').hidden = true; loadLevel(i); });
    box.appendChild(b);
  });
  $('lvStars').textContent = `${totalStars()} / ${LEVELS.length * 3}`;
  $('lvSheet').hidden = false;
}

// ── 主循环 ──
function tick(now){
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(now - lastT, 60);
  lastT = now;
  if (over){ if (needsDraw){ draw(); needsDraw = false; } return; }
  if (shot) step(dt);
  if (pops.length || floats.length) stepPops(dt);
  if (needsDraw || shot || pops.length || floats.length){ draw(); needsDraw = false; }
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
    const dx = p.x - W / 2, dy = p.y - muzzleY();
    if (dy > -R * .4) return;
    aim = Math.atan2(dy, dx);
    traceAim(); needsDraw = true;
  };
  const start = (e) => {
    if (over || shot) return;
    const p = point(e), n = nextSpot();
    if (Math.hypot(p.x - n.x, p.y - n.y) < n.r * 1.9){ swap(); return; }
    aiming = true; setAim(p);
  };
  const move = (e) => { if (!aiming) return; setAim(point(e)); };
  const end = () => { if (!aiming) return; aiming = false; fire(); };

  wrap.addEventListener('touchstart', start, { passive: true });
  wrap.addEventListener('touchmove', move, { passive: true });
  wrap.addEventListener('touchend', end, { passive: true });
  wrap.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft'){ aim -= .06; needsDraw = true; }
    if (e.code === 'ArrowRight'){ aim += .06; needsDraw = true; }
    if (e.code === 'Space'){ e.preventDefault(); fire(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowDown'){ e.preventDefault(); swap(); }
    if (e.code === 'KeyR') MODE === 'arcade' ? loadArcade() : loadLevel(lvIdx);
    if (e.code === 'Digit1') armPower(0);
    if (e.code === 'Digit2') armPower(1);
    if (e.code === 'Digit3') armPower(2);
    aim = clamp(aim, -Math.PI * 0.94, -Math.PI * 0.06);
    traceAim();
  });
}

// ── 音效 ──
let actx = null, muted = false;

// new AudioContext() 要起音频线程，实测 240ms。懒到「第一次出声时」才建，
// 那一下就是肉眼可见的卡顿，所以挪到加载后的空闲期建好，手势里只做 resume()。
function primeAudio(){
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC({ latencyHint: 'interactive' });
  } catch { /* 不给就算了 */ }
}
if (window.requestIdleCallback) requestIdleCallback(primeAudio, { timeout: 2500 });
else setTimeout(primeAudio, 700);

function unlockAudio(){
  try {
    primeAudio();
    if (actx && actx.state === 'suspended') actx.resume();
  } catch { /* 不给就算了 */ }
}
for (const ev of ['pointerdown', 'touchstart', 'keydown']){
  window.addEventListener(ev, unlockAudio, { passive: true });
}

const SPECS = {
  shoot: { f: 520, to: 700,  d: .05, v: .024, type: 'sine' },
  swap:  { f: 400, to: 560,  d: .06, v: .026, type: 'triangle' },
  stick: { f: 300, to: 240,  d: .05, v: .022, type: 'triangle' },
  pop:   { f: 620, to: 900,  d: .12, v: .04,  type: 'sine' },
  big:   { f: 520, to: 1180, d: .26, v: .055, type: 'triangle' },
  boom:  { f: 220, to: 70,   d: .32, v: .07,  type: 'triangle' },
  power: { f: 760, to: 1500, d: .18, v: .05,  type: 'square' },
  grant: { f: 880, to: 1320, d: .16, v: .045, type: 'sine' },
  win:   { f: 560, to: 1120, d: .34, v: .055, type: 'sine' },
  over:  { f: 280, to: 62,   d: .55, v: .06,  type: 'triangle' },
};
function sfx(k){
  if (muted) return;
  const s = SPECS[k]; if (!s) return;
  try {
    unlockAudio();
    if (!actx || actx.state === 'closed') return;
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

// ── 启动 ──
function init(){
  prog = readProg();
  try {
    muted = localStorage.getItem('bubble.muted.v1') === '1';
    best = +localStorage.getItem(BEST_KEY) || 0;
  } catch { /* 忽略 */ }
  lv = LEVELS[0];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(colsIn(r)).fill(null));
  layout();
  bindAim();
  syncMute();

  $('startBtn').addEventListener('click', () => { $('overlay').classList.remove('show'); loadArcade(); });
  $('arcAgain').addEventListener('click', loadArcade);
  $('arcPick').addEventListener('click', () => { $('overlay').classList.remove('show'); openLevels(); });
  $('againBtn').addEventListener('click', () => loadLevel(lvIdx));
  $('nextBtn').addEventListener('click', () => loadLevel(lvIdx + 1));
  $('restartBtn').addEventListener('click', () => { if (!started) return; MODE === 'arcade' ? loadArcade() : loadLevel(lvIdx); });
  $('lvBtn').addEventListener('click', openLevels);
  $('lvClose').addEventListener('click', () => { $('lvSheet').hidden = true; });
  $('lvSheet').addEventListener('click', (e) => { if (e.target.id === 'lvSheet') $('lvSheet').hidden = true; });
  $('pickBtn').addEventListener('click', () => { $('overlay').classList.remove('show'); openLevels(); });
  $('arcBtn').addEventListener('click', loadArcade);
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

  lv = { name:'竞技', colors:3, shots:Infinity, push:ARC_PUSH0, goal:'arcade', stone:0, ice:0 };
  $('overlay').dataset.mode = 'start';
  $('startBest').textContent = best.toLocaleString();
  $('startLv').textContent = `${Math.min(prog.unlocked, LEVELS.length)} / ${LEVELS.length}`;
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
  get state(){ return { MODE, best, wave, lvIdx, name: lv && lv.name, goal: lv && lv.goal, score, shotsLeft, fired,
                        combo, rescued, needRescue, powers: powers.slice(), over, won, started,
                        R, W, H, cur, next, shot: !!shot, unlocked: prog.unlocked, stars: { ...prog.stars } }; },
  LEVELS, loadArcade, loadLevel, arcadeTune, fire, swap, armPower,
  get lv(){ return lv; }, set fired(v){ fired = v; }, grantPower, dropFloating, checkEnd,
  land: () => land(), pushDown,
  setAim: (a) => { aim = a; traceAim(); needsDraw = true; },
  give: (p) => { powers.push(p); syncHud(); },
  colsIn, neighbours, cellX, cellY, muzzleY, sameGroup, COLORS, DEAD_ROW, ROWS, COLS,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
