/* 扫雷 —— 首点必安全、空白自动展开、数字和弦、长按插旗。
   格子用 DOM 不用 canvas：只在点击时更新，没有逐帧动画，DOM 更省事也更好点。 */
(() => {
'use strict';

const LEVELS = {
  easy:   { name: '轻松', cols: 9,  rows: 9,  mines: 10 },
  normal: { name: '普通', cols: 12, rows: 12, mines: 22 },
  hard:   { name: '硬核', cols: 15, rows: 15, mines: 40 },
};
const BEST_KEY = 'mine.best.v1';
const LV_KEY   = 'mine.level.v1';

const $ = (id) => document.getElementById(id);

let lv = 'easy';
let cols, rows, mines;
let cells = [];          // { mine, near, open, flag, el }
let placed = false;      // 第一次点开之前不布雷
let over = false, won = false;
let flags = 0, opened = 0;
let t0 = 0, timer = 0, elapsed = 0;
let flagMode = false;

// ── 存档 ──
function readBest(){
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; }
  catch { return {}; }
}
function writeBest(o){
  try { localStorage.setItem(BEST_KEY, JSON.stringify(o)); } catch { /* 忽略 */ }
}
function bestOf(k){ const b = readBest()[k]; return typeof b === 'number' ? b : null; }

// ── 建盘 ──
function idx(x, y){ return y * cols + x; }
function inside(x, y){ return x >= 0 && x < cols && y >= 0 && y < rows; }

function neighbours(x, y){
  const out = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++){
      if (!dx && !dy) continue;
      if (inside(x + dx, y + dy)) out.push(cells[idx(x + dx, y + dy)]);
    }
  return out;
}

function build(){
  const def = LEVELS[lv];
  cols = def.cols; rows = def.rows; mines = def.mines;
  cells = [];
  placed = false; over = false; won = false;
  flags = 0; opened = 0; elapsed = 0;
  clearInterval(timer); timer = 0;

  const board = $('board');
  board.style.setProperty('--cols', cols);
  board.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let y = 0; y < rows; y++){
    for (let x = 0; x < cols; x++){
      const el = document.createElement('button');
      el.className = 'sq';
      el.type = 'button';
      el.dataset.x = x; el.dataset.y = y;
      el.setAttribute('aria-label', `第 ${y + 1} 行第 ${x + 1} 列`);
      frag.appendChild(el);
      cells.push({ mine: false, near: 0, open: false, flag: false, el, x, y });
    }
  }
  board.appendChild(frag);
  $('overlay').classList.remove('show');
  syncHud();
  fitBoard();
}

// 第一次点开之后才布雷，保证首点那一片一定是安全的
function placeMines(sx, sy){
  const safe = new Set([idx(sx, sy)]);
  neighbours(sx, sy).forEach(c => safe.add(idx(c.x, c.y)));
  const pool = [];
  for (let i = 0; i < cells.length; i++) if (!safe.has(i)) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.slice(0, mines).forEach(i => { cells[i].mine = true; });
  for (const c of cells) c.near = c.mine ? 0 : neighbours(c.x, c.y).filter(n => n.mine).length;
  placed = true;
  t0 = Date.now();
  timer = setInterval(() => {
    if (over) return;
    elapsed = Math.min(999, Math.floor((Date.now() - t0) / 1000));
    $('time').textContent = elapsed;
  }, 250);
}

// ── 翻开 ──
function reveal(c){
  if (c.open || c.flag) return;
  c.open = true; opened++;
  c.el.classList.add('open');
  if (c.mine){ c.el.classList.add('boom'); return; }
  if (c.near){
    c.el.textContent = c.near;
    c.el.dataset.n = c.near;
  }
}

// 点到空白就顺着摊开，用队列不用递归，免得大盘子爆栈
function flood(start){
  const q = [start];
  while (q.length){
    const c = q.pop();
    if (c.open || c.flag) continue;
    reveal(c);
    if (c.near === 0 && !c.mine){
      for (const n of neighbours(c.x, c.y)) if (!n.open && !n.flag) q.push(n);
    }
  }
}

function dig(c){
  if (over || c.open || c.flag) return;
  if (!placed) placeMines(c.x, c.y);
  if (c.mine){ boom(c); return; }
  flood(c);
  sfx('dig');
  checkWin();
  syncHud();
}

// 点已翻开的数字：旗子数对得上就把周围一次性摊开
function chord(c){
  if (over || !c.open || !c.near) return;
  const ns = neighbours(c.x, c.y);
  if (ns.filter(n => n.flag).length !== c.near) return;
  const hit = ns.filter(n => !n.open && !n.flag);
  if (!hit.length) return;
  const bomb = hit.find(n => n.mine);
  if (bomb){ boom(bomb); return; }
  hit.forEach(flood);
  sfx('dig');
  checkWin();
  syncHud();
}

function toggleFlag(c){
  if (over || c.open) return;
  c.flag = !c.flag;
  flags += c.flag ? 1 : -1;
  c.el.classList.toggle('flag', c.flag);
  c.el.innerHTML = c.flag ? FLAG_SVG : '';
  sfx('flag');
  syncHud();
}

// ── 胜负 ──
function boom(c){
  over = true;
  clearInterval(timer);
  c.open = true;
  c.el.classList.add('open', 'boom');
  c.el.innerHTML = MINE_SVG;
  // 把剩下的雷亮出来，插错的地方打叉
  for (const o of cells){
    if (o.mine && !o.flag && o !== c){ o.el.classList.add('open', 'mine'); o.el.innerHTML = MINE_SVG; }
    if (!o.mine && o.flag){ o.el.classList.add('wrong'); }
  }
  sfx('boom');
  showEnd(false);
}

function checkWin(){
  if (over) return;
  if (opened < cols * rows - mines) return;
  over = true; won = true;
  clearInterval(timer);
  // 赢了就把没插的雷自动插上
  for (const c of cells) if (c.mine && !c.flag){ c.flag = true; flags++; c.el.classList.add('flag'); c.el.innerHTML = FLAG_SVG; }
  const b = readBest();
  const prev = b[lv];
  if (typeof prev !== 'number' || elapsed < prev){ b[lv] = elapsed; writeBest(b); }
  sfx('win');
  showEnd(true, typeof prev !== 'number' || elapsed < prev);
  syncHud();
}

function showEnd(win, isBest){
  const ov = $('overlay');
  ov.dataset.mode = win ? 'win' : 'lose';
  $('endTime').textContent = elapsed + ' 秒';
  $('endBest').textContent = bestOf(lv) == null ? '—' : bestOf(lv) + ' 秒';
  $('newBest').hidden = !(win && isBest);
  ov.classList.add('show');
}

function syncHud(){
  $('left').textContent = Math.max(0, mines - flags);
  $('time').textContent = elapsed;
  const b = bestOf(lv);
  $('best').textContent = b == null ? '—' : b;
}

// ── 图标 ──
const FLAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4.5h9.5l-2 3.5 2 3.5H6z" fill="currentColor" stroke="none"/><path d="M6 4.5h9.5l-2 3.5 2 3.5H6"/></svg>';
const MINE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>';

// ── 输入：点=挖，长按=插旗，也可以用底部按钮切模式 ──
function bindBoard(){
  const board = $('board');
  let pressTimer = 0, longFired = false, startCell = null;

  const cellOf = (e) => {
    const el = e.target.closest('.sq');
    if (!el) return null;
    return cells[idx(+el.dataset.x, +el.dataset.y)];
  };

  const press = (c) => {
    longFired = false;
    startCell = c;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longFired = true; toggleFlag(c); }, 420);
  };
  const release = (c) => {
    clearTimeout(pressTimer);
    if (longFired || !c || c !== startCell) return;
    if (flagMode) toggleFlag(c);
    else if (c.open) chord(c);
    else dig(c);
  };

  board.addEventListener('touchstart', (e) => {
    const c = cellOf(e); if (!c) return;
    press(c);
  }, { passive: true });
  board.addEventListener('touchend', (e) => {
    const c = cellOf(e); release(c);
  }, { passive: true });
  board.addEventListener('touchmove', () => { clearTimeout(pressTimer); startCell = null; }, { passive: true });

  let mouseDown = false;
  board.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    const c = cellOf(e); if (!c) return;
    mouseDown = true; press(c);
  });
  board.addEventListener('mouseup', (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    release(cellOf(e));
  });
  board.addEventListener('mouseleave', () => { clearTimeout(pressTimer); mouseDown = false; });
  // 右键插旗
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const c = cellOf(e);
    if (c) toggleFlag(c);
  });
}

// ── 棋盘按可用空间等比缩放 ──
function fitBoard(){
  const wrap = $('boardWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  const gap = cols > 12 ? 2 : 3;
  const size = Math.floor(Math.min((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows));
  const board = $('board');
  board.style.setProperty('--size', Math.max(14, size) + 'px');
  board.style.setProperty('--gap', gap + 'px');
}

// ── 音效：跟俄罗斯方块一个路子，单振荡器，克制 ──
let actx = null, muted = false;
const SPECS = {
  dig:  { f: 420, to: 520, d: .04, v: .022, type: 'sine' },
  flag: { f: 300, to: 380, d: .05, v: .026, type: 'triangle' },
  boom: { f: 180, to: 46,  d: .55, v: .07,  type: 'triangle' },
  win:  { f: 520, to: 1040,d: .32, v: .055, type: 'sine' },
};
function sfx(kind){
  if (muted) return;
  const s = SPECS[kind]; if (!s) return;
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
function syncMute(){
  $('muteBtn').classList.toggle('muted', muted);
  $('muteBtn').setAttribute('aria-label', muted ? '音效已关' : '音效已开');
}

// ── 模式与难度 ──
function setFlagMode(on){
  flagMode = on;
  $('modeBtn').classList.toggle('hot', on);
  $('modeText').textContent = on ? '插旗' : '挖开';
  $('modeIcon').innerHTML = on ? FLAG_SVG : DIG_SVG;
}
const DIG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 3.5 6 6"/><path d="M17.5 6.5 9 15l-4.5 4.5L3 21l1.5-1.5L9 15"/><path d="M12.8 11.2 6 4.4a2 2 0 0 1 2.8-2.8l6.8 6.8"/></svg>';

function buildLevelPanel(){
  const wrap = $('lvOpts');
  wrap.innerHTML = '';
  Object.keys(LEVELS).forEach(k => {
    const d = LEVELS[k];
    const b = document.createElement('button');
    b.className = 'seg-btn' + (lv === k ? ' on' : '');
    b.innerHTML = `${d.name}<em>${d.cols}×${d.rows} · ${d.mines} 雷</em>`;
    b.addEventListener('click', () => {
      lv = k;
      try { localStorage.setItem(LV_KEY, k); } catch { /* 忽略 */ }
      buildLevelPanel();
      build();
      $('lvSheet').hidden = true;
    });
    wrap.appendChild(b);
  });
}

// ── 启动 ──
function init(){
  try {
    const saved = localStorage.getItem(LV_KEY);
    if (saved && LEVELS[saved]) lv = saved;
    muted = localStorage.getItem('mine.muted.v1') === '1';
  } catch { /* 忽略 */ }

  build();
  bindBoard();
  buildLevelPanel();
  setFlagMode(false);
  syncMute();

  $('modeBtn').addEventListener('click', () => setFlagMode(!flagMode));
  $('againBtn').addEventListener('click', build);
  $('restartBtn').addEventListener('click', build);
  $('lvBtn').addEventListener('click', () => { buildLevelPanel(); $('lvSheet').hidden = false; });
  $('lvDone').addEventListener('click', () => { $('lvSheet').hidden = true; });
  $('lvSheet').addEventListener('click', (e) => { if (e.target.id === 'lvSheet') $('lvSheet').hidden = true; });
  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('mine.muted.v1', muted ? '1' : '0'); } catch { /* 忽略 */ }
    syncMute();
  });

  window.addEventListener('resize', fitBoard);
  window.addEventListener('orientationchange', () => { setTimeout(fitBoard, 120); setTimeout(fitBoard, 450); });
  if (window.ResizeObserver) new ResizeObserver(fitBoard).observe($('boardWrap'));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF'){ setFlagMode(!flagMode); }
    if (e.code === 'KeyR'){ build(); }
  });
}

window.__mine = { get cells(){ return cells; }, get state(){ return { over, won, flags, opened, mines, cols, rows, placed, elapsed, lv }; },
                  build, dig, toggleFlag, chord, setLevel: (k) => { lv = k; build(); } };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
