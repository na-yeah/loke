'use strict';

/* ================== 配置 ================== */
const ROWS = 8;
const COLS = 8;
const TYPE_COUNT = 6;
const TOTAL_LEVELS = 30;
const BOMB_H = TYPE_COUNT;        // 横向炸弹
const BOMB_V = TYPE_COUNT + 1;    // 竖向炸弹
const BOMB_B = TYPE_COUNT + 2;    // 范围炸弹
const EMOJIS = ['🍓', '🍌', '🍋', '🍇', '🍉', '🫐', '🧨', '💣', '💥'];
const TILE_BG = ['#ffe4ee', '#f1f7c5', '#fff3c9', '#e6e3ff', '#d9f6e4', '#dcf0ff', '#ffe0b2', '#cfe8ff', '#e8d9ff'];
const BOMB_CLASS = { [BOMB_H]: 'bomb-h', [BOMB_V]: 'bomb-v', [BOMB_B]: 'bomb-b' };
const GAP = 6;
const SWAP_MS = 160;
const CLEAR_MS = 260;
const FALL_MS = 240;
const HINT_AFTER = 8000;
const HINT_SHOW = 2000;
const SHUFFLE_COST = 50;

/* ================== 状态 ================== */
let grid = [];
let tileAt = [];
let tiles = new Map();
let nextId = 1;
let tilePx = 48;
let score = 0;
let level = 1;
let movesLeft = levelMoves(1);
let target = levelTarget(1);
let busy = false;
let over = false;
let selected = null;
let cascade = 0;
let hintTimer = null;
let hintCells = null;
let toastTimer = null;
let audioCtx = null;
let soundOn = localStorage.getItem('candy-sound') !== 'off';
let lastLevel = Math.min(Math.max(Number(localStorage.getItem('candy-last-level') || 1), 1), TOTAL_LEVELS);

/* ================== DOM ================== */
const elBoard = document.getElementById('board');
const elBoardArea = document.getElementById('boardArea');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elMoves = document.getElementById('moves');
const elTarget = document.getElementById('target');
const elBar = document.getElementById('progressBar');
const elBest = document.getElementById('best');
const elToast = document.getElementById('toast');
const elToastPts = document.getElementById('toastPts');
const elToastCombo = document.getElementById('toastCombo');
const elModal = document.getElementById('modal');
const elModalTitle = document.getElementById('modalTitle');
const elModalText = document.getElementById('modalText');
const elModalPrimaryBtn = document.getElementById('modalPrimaryBtn');
const elModalSecondaryBtn = document.getElementById('modalSecondaryBtn');
const elHintBtn = document.getElementById('hintBtn');
const elShuffleBtn = document.getElementById('shuffleBtn');
const elRestartBtn = document.getElementById('restartBtn');
const elSoundBtn = document.getElementById('soundBtn');
const elBackBtn = document.getElementById('backBtn');

const elMenuModal = document.getElementById('menuModal');
const elMenuProgress = document.getElementById('menuProgress');
const elPlayBtn = document.getElementById('playBtn');
const elSelectLevelBtn = document.getElementById('selectLevelBtn');
const elLangBtnMenu = document.getElementById('langBtnMenu');

const elLevelModal = document.getElementById('levelModal');
const elLevelGrid = document.getElementById('levelGrid');
const elUnlockTip = document.getElementById('unlockTip');
const elLevelBackBtn = document.getElementById('levelBackBtn');

const elLangModal = document.getElementById('langModal');
const elLangGrid = document.getElementById('langGrid');
const elLangCloseBtn = document.getElementById('langCloseBtn');

/* ================== 工具函数 ================== */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const raf = window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : fn => setTimeout(fn, 16);

// 按帧对齐等待：动画真正完成后才继续，避免 setTimeout 提前唤醒造成跳变
const waitMs = ms => new Promise(resolve => {
  const start = Date.now();
  const tick = () => (Date.now() - start >= ms ? resolve() : raf(tick));
  raf(tick);
});

function levelMoves(lv) {
  return 30 + (lv - 1) * 2;
}

function levelTarget(lv) {
  return 1000 * lv;
}

function xOf(c) {
  return c * (tilePx + GAP);
}

function yOf(r) {
  return r * (tilePx + GAP);
}

function randomType() {
  return Math.floor(Math.random() * TYPE_COUNT);
}

function randomTypeAt(r, c, g) {
  let t;
  do {
    t = randomType();
  } while (
    (c >= 2 && g[r][c - 1] === t && g[r][c - 2] === t) ||
    (r >= 2 && g[r - 1][c] === t && g[r - 2][c] === t)
  );
  return t;
}

function randomTypeSafe(g, r, c) {
  let t;
  do {
    t = randomType();
  } while (
    (c >= 2 && g[r][c - 1] === t && g[r][c - 2] === t) ||
    (r <= ROWS - 3 && g[r + 1][c] === t && g[r + 2][c] === t)
  );
  return t;
}

function makeTile(type, container = elBoard) {
  const id = nextId++;
  const el = document.createElement('div');
  el.className = 'tile';
  el.textContent = EMOJIS[type];
  el.style.background = TILE_BG[type];
  if (type >= TYPE_COUNT) el.classList.add('bomb', BOMB_CLASS[type]);
  el.dataset.id = id;
  el.addEventListener('pointerdown', onTilePointerDown);
  el.addEventListener('contextmenu', e => e.preventDefault());
  tiles.set(id, { el, type });
  container.appendChild(el);
  return id;
}

function setBase(el, x, y) {
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.dataset.px = String(x);
  el.dataset.py = String(y);
}

function placeTile(el, r, c, instant = false) {
  const x = xOf(c);
  const y = yOf(r);
  // 位置未变化的格子直接跳过，避免无意义的样式写入
  if (!instant && el.dataset.px === String(x) && el.dataset.py === String(y)) return;
  setBase(el, x, y);
  el.style.transform = '';
}

function render(instant = false) {
  if (!tileAt.length) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = tileAt[r][c];
      if (id == null) continue;
      const rec = tiles.get(id);
      if (rec.el.textContent !== EMOJIS[rec.type]) rec.el.textContent = EMOJIS[rec.type];
      if (rec.el.dataset.bg !== TILE_BG[rec.type]) {
        rec.el.style.background = TILE_BG[rec.type];
        rec.el.dataset.bg = TILE_BG[rec.type];
      }
      placeTile(rec.el, r, c, instant);
    }
  }
}

function rebuildBoard() {
  tiles.forEach(rec => rec.el.remove());
  tiles.clear();
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  tileAt = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const frag = document.createDocumentFragment();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = randomTypeAt(r, c, grid);
      tileAt[r][c] = makeTile(grid[r][c], frag);
    }
  }
  elBoard.appendChild(frag);
  render(true);
}

/* ================== 消除判定 ================== */
function isPlainType(v) {
  return v !== null && v < TYPE_COUNT;
}

function findMatches() {
  const rowCells = new Set();
  const colCells = new Set();
  const shapes = [];

  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      if (c < COLS && isPlainType(grid[r][c]) && grid[r][c] === grid[r][c - 1]) {
        run++;
        continue;
      }
      if (run >= 3) {
        const cells = [];
        for (let k = c - run; k < c; k++) {
          rowCells.add(r * COLS + k);
          cells.push([r, k]);
        }
        shapes.push({ len: run, cells, horizontal: true });
      }
      run = 1;
    }
  }

  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      if (r < ROWS && isPlainType(grid[r][c]) && grid[r][c] === grid[r - 1][c]) {
        run++;
        continue;
      }
      if (run >= 3) {
        const cells = [];
        for (let k = r - run; k < r; k++) {
          colCells.add(k * COLS + c);
          cells.push([k, c]);
        }
        shapes.push({ len: run, cells, horizontal: false });
      }
      run = 1;
    }
  }

  const all = new Set([...rowCells, ...colCells]);
  const hasT = [...rowCells].some(key => colCells.has(key));
  return { cells: all, shapes, isT: hasT };
}

function swapGrid(r1, c1, r2, c2) {
  const t = grid[r1][c1];
  grid[r1][c1] = grid[r2][c2];
  grid[r2][c2] = t;
  const i = tileAt[r1][c1];
  tileAt[r1][c1] = tileAt[r2][c2];
  tileAt[r2][c2] = i;
}

function wouldMatch(r1, c1, r2, c2) {
  const t = grid[r1][c1];
  grid[r1][c1] = grid[r2][c2];
  grid[r2][c2] = t;
  const m = findMatches();
  grid[r2][c2] = grid[r1][c1];
  grid[r1][c1] = t;
  return m.cells.size > 0;
}

function hasValidMove() {
  // 只要棋盘上有炸弹，就一定有可交换的相邻格子
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] >= TYPE_COUNT) return true;
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && grid[r][c] !== null && grid[r][c + 1] !== null &&
          wouldMatch(r, c, r, c + 1)) return true;
      if (r + 1 < ROWS && grid[r][c] !== null && grid[r + 1][c] !== null &&
          wouldMatch(r, c, r + 1, c)) return true;
    }
  }
  return false;
}

function neighborOf(r, c) {
  if (r > 0) return [r - 1, c];
  if (r < ROWS - 1) return [r + 1, c];
  if (c > 0) return [r, c - 1];
  return [r, c + 1];
}

function findHint() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] >= TYPE_COUNT) {
        const n = neighborOf(r, c);
        if (n) return [[r, c], n];
      }
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && wouldMatch(r, c, r, c + 1)) return [[r, c], [r, c + 1]];
      if (r + 1 < ROWS && wouldMatch(r, c, r + 1, c)) return [[r, c], [r + 1, c]];
    }
  }
  return null;
}

/* ================== 消除流程 ================== */
function pickSpot(cells, swapPos) {
  if (swapPos) {
    for (const [r, c] of cells) {
      if (r === swapPos[0] && c === swapPos[1]) return swapPos;
    }
  }
  return cells[Math.floor(cells.length / 2)];
}

function convertToBomb(r, c, type) {
  const rec = tiles.get(tileAt[r][c]);
  grid[r][c] = type;
  rec.type = type;
  rec.el.textContent = EMOJIS[type];
  rec.el.style.background = TILE_BG[type];
  rec.el.classList.add('bomb', BOMB_CLASS[type]);
}

async function resolveMatches(m, swapPos) {
  // 决定是否生成炸弹：横/竖 4+ 连生成横向/竖向炸弹，横竖交叉生成范围炸弹
  let bombSpec = null;
  const longRuns = m.shapes.filter(s => s.len >= 4);
  if (m.isT) {
    const cells = [...m.cells].map(key => [Math.floor(key / COLS), key % COLS]);
    const spot = pickSpot(cells, swapPos);
    bombSpec = { r: spot[0], c: spot[1], type: BOMB_B };
  } else if (longRuns.length > 0) {
    const run = longRuns[0];
    const spot = pickSpot(run.cells, swapPos);
    bombSpec = { r: spot[0], c: spot[1], type: run.horizontal ? BOMB_H : BOMB_V };
  }

  const base = m.cells.size * 10 * cascade;
  const bonus = longRuns.length * 50 + (m.isT ? 50 : 0);
  const gained = base + bonus;
  score += gained;
  updateHud();
  showToast(gained, cascade);
  playClear(cascade);

  const ids = [];
  for (const key of m.cells) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    if (bombSpec && bombSpec.r === r && bombSpec.c === c) continue; // 该格保留，变成炸弹
    const id = tileAt[r][c];
    if (id == null) continue;
    tiles.get(id).el.classList.add('pop');
    ids.push([r, c, id]);
  }
  await waitMs(CLEAR_MS);
  for (const [r, c, id] of ids) {
    const rec = tiles.get(id);
    if (rec) {
      rec.el.remove();
      tiles.delete(id);
    }
    grid[r][c] = null;
    tileAt[r][c] = null;
  }
  if (bombSpec) convertToBomb(bombSpec.r, bombSpec.c, bombSpec.type);
}

function bombCells(r, c, type) {
  if (type === BOMB_H) {
    return Array.from({ length: COLS }, (_, i) => [r, i]);
  }
  if (type === BOMB_V) {
    return Array.from({ length: ROWS }, (_, i) => [i, c]);
  }
  // 范围炸弹：清除目标位置周围一格（3×3）
  const cells = [];
  for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++) {
    for (let cc = Math.max(0, c - 1); cc <= Math.min(COLS - 1, c + 1); cc++) {
      cells.push([rr, cc]);
    }
  }
  return cells;
}

async function explodeBomb(br, bc) {
  cascade++;
  const targets = new Set();
  const processed = new Set();
  const queue = [[br, bc]];
  while (queue.length) {
    const [rr, cc] = queue.shift();
    const key = rr * COLS + cc;
    if (processed.has(key)) continue;
    processed.add(key);
    const t = grid[rr][cc];
    if (t == null) continue;
    targets.add(key);
    for (const [r2, c2] of bombCells(rr, cc, t)) {
      const k = r2 * COLS + c2;
      if (targets.has(k)) continue;
      if (grid[r2][c2] == null) continue;
      targets.add(k);
      if (grid[r2][c2] >= TYPE_COUNT) queue.push([r2, c2]); // 连锁引爆
    }
  }

  const gained = targets.size * 10 * cascade;
  score += gained;
  updateHud();
  showToast(gained, cascade);
  playExplosion(cascade);

  for (const key of targets) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    const rec = tiles.get(tileAt[r][c]);
    if (rec) rec.el.classList.add('pop');
  }
  await waitMs(CLEAR_MS);
  for (const key of targets) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    const id = tileAt[r][c];
    if (id == null) continue;
    const rec = tiles.get(id);
    if (rec) {
      rec.el.remove();
      tiles.delete(id);
    }
    grid[r][c] = null;
    tileAt[r][c] = null;
  }
}

async function continueMatches(swapPos) {
  // 无论是否还有匹配，先让棋盘下落补位（爆炸可能留下空洞）
  await applyGravity();
  let m = findMatches();
  while (m.cells.size > 0) {
    cascade++;
    await resolveMatches(m, swapPos);
    swapPos = null;
    await applyGravity();
    m = findMatches();
  }
}

function finishMove() {
  busy = false;
  movesLeft--;
  updateHud();
  if (score >= target) {
    winLevel();
    return;
  }
  if (movesLeft <= 0) {
    loseGame();
    return;
  }
  if (!hasValidMove()) {
    autoShuffle(false);
  }
  startHintTimer();
}

async function applyGravity() {
  const ng = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const nt = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const falling = [];
  const spawning = [];
  const frag = document.createDocumentFragment();

  for (let c = 0; c < COLS; c++) {
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const id = tileAt[r][c];
      if (id != null) {
        const rec = tiles.get(id);
        ng[w][c] = rec.type;
        nt[w][c] = id;
        if (w !== r) falling.push({ id, fromR: r, toR: w, c });
        w--;
      }
    }
    const newCount = w + 1;
    for (let r = w; r >= 0; r--) {
      const type = randomTypeSafe(ng, r, c);
      const id = makeTile(type, frag);
      ng[r][c] = type;
      nt[r][c] = id;
      spawning.push({ id, fromR: r - newCount, toR: r, c });
    }
  }

  grid = ng;
  tileAt = nt;
  elBoard.appendChild(frag);

  for (const mv of falling) {
    const el = tiles.get(mv.id).el;
    setBase(el, xOf(mv.c), yOf(mv.toR));
    el.style.transform = 'translate(0px,' + (yOf(mv.fromR) - yOf(mv.toR)) + 'px)';
  }
  for (const sp of spawning) {
    const el = tiles.get(sp.id).el;
    setBase(el, xOf(sp.c), yOf(sp.toR));
    el.style.transform = 'translate(0px,' + (yOf(sp.fromR) - yOf(sp.toR)) + 'px)';
  }
  // 所有移动/新糖果的起始位置一次性生效（一次强制布局）
  void elBoard.offsetWidth;
  for (const mv of falling) tiles.get(mv.id).el.style.transform = '';
  for (const sp of spawning) tiles.get(sp.id).el.style.transform = '';
  await waitMs(FALL_MS);
}

// 交换动画：基准位置瞬间更新，transform 从旧位置过渡到基准
function animateSwap(r1, c1, r2, c2) {
  const elA = tiles.get(tileAt[r2][c2]).el;
  const elB = tiles.get(tileAt[r1][c1]).el;
  const aX = xOf(c2), aY = yOf(r2);
  const bX = xOf(c1), bY = yOf(r1);
  setBase(elA, aX, aY);
  setBase(elB, bX, bY);
  elA.style.transform = 'translate(' + (bX - aX) + 'px,' + (bY - aY) + 'px)';
  elB.style.transform = 'translate(' + (aX - bX) + 'px,' + (aY - bY) + 'px)';
  void elBoard.offsetWidth;
  elA.style.transform = '';
  elB.style.transform = '';
}

async function handleSwap(r1, c1, r2, c2) {
  if (busy || over) return;
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;

  busy = true;
  clearHint();
  const bombInvolved = grid[r1][c1] >= TYPE_COUNT || grid[r2][c2] >= TYPE_COUNT;
  swapGrid(r1, c1, r2, c2);
  animateSwap(r1, c1, r2, c2);
  playSwap();
  await waitMs(SWAP_MS);

  if (bombInvolved) {
    let br, bc;
    if (grid[r1][c1] >= TYPE_COUNT) {
      br = r1;
      bc = c1;
    } else {
      br = r2;
      bc = c2;
    }
    cascade = 0;
    await explodeBomb(br, bc);
    await continueMatches(null);
    finishMove();
    return;
  }

  let m = findMatches();
  if (m.cells.size === 0) {
    swapGrid(r1, c1, r2, c2);
    animateSwap(r1, c1, r2, c2);
    playSwapBack();
    await waitMs(SWAP_MS);
    busy = false;
    return;
  }

  cascade = 0;
  await continueMatches([r1, c1]);
  finishMove();
}

/* ================== 提示 / 洗牌 ================== */
function startHintTimer() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(showHint, HINT_AFTER);
}

function clearHint() {
  if (hintCells) {
    for (const [r, c] of hintCells) {
      const rec = tiles.get(tileAt[r][c]);
      if (rec) rec.el.classList.remove('hint');
    }
    hintCells = null;
  }
}

function showHint() {
  if (busy || over) return;
  clearHint();
  const h = findHint();
  if (!h) {
    showToastMsg(t('toastNoMove'));
    return;
  }
  hintCells = h;
  for (const [r, c] of h) {
    const rec = tiles.get(tileAt[r][c]);
    if (rec) rec.el.classList.add('hint');
  }
  setTimeout(() => {
    clearHint();
    startHintTimer();
  }, HINT_SHOW);
}

function autoShuffle(silent) {
  rebuildBoard();
  let guard = 0;
  while (!hasValidMove() && guard++ < 200) rebuildBoard();
  if (!silent) {
    elBoard.classList.add('shake');
    setTimeout(() => elBoard.classList.remove('shake'), 460);
    showToastMsg(t('toastShuffled'));
  }
}

/* ================== 进度存储 ================== */
function getBest(lv) {
  return Number(localStorage.getItem('candy-best-' + lv) || 0);
}

function saveBest(lv, sc) {
  if (sc > getBest(lv)) {
    localStorage.setItem('candy-best-' + lv, sc);
  }
}

/* ================== 界面更新 ================== */
function updateHud() {
  setText(elScore, score);
  setText(elLevel, level);
  setText(elMoves, movesLeft);
  elMoves.classList.toggle('low', movesLeft <= 5);
  setText(elTarget, target);
  elBar.style.width = Math.min(100, (score / target) * 100) + '%';
  setText(elBest, getBest(level));
  elHintBtn.disabled = busy || over;
  elShuffleBtn.disabled = busy || over || score < SHUFFLE_COST;
}

function setText(el, v) {
  const s = String(v);
  if (el.textContent !== s) el.textContent = s;
}

function showToast(pts, combo) {
  elToastPts.textContent = '+' + pts;
  elToastCombo.textContent = combo > 1 ? t('toastCombo', { n: combo }) : '';
  popToast();
}

function showToastMsg(msg) {
  elToastPts.textContent = msg;
  elToastCombo.textContent = '';
  popToast();
}

function popToast() {
  elToast.classList.remove('show');
  void elToast.offsetWidth;
  elToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), 900);
}

function showEndModal(title, text, primaryText, primaryCb, secondaryText, secondaryCb) {
  elModalTitle.textContent = title;
  elModalText.textContent = text;
  elModalPrimaryBtn.textContent = primaryText;
  elModalPrimaryBtn.onclick = primaryCb;
  elModalSecondaryBtn.textContent = secondaryText;
  elModalSecondaryBtn.onclick = secondaryCb;
  elModal.classList.remove('hidden');
}

function hideModal() {
  elModal.classList.add('hidden');
}

function confetti() {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#ffe066'];
  for (let i = 0; i < 60; i++) {
    const d = document.createElement('div');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDelay = Math.random() * 0.5 + 's';
    d.style.animationDuration = 1.8 + Math.random() * 1.5 + 's';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }
}

/* ================== 菜单与选关 ================== */
function renderMenu() {
  elMenuProgress.textContent = t('menuProgress', { n: TOTAL_LEVELS });
}

function renderLevelSelect() {
  elLevelGrid.innerHTML = '';
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'level-cell';

    const num = document.createElement('span');
    num.className = 'level-num';
    num.textContent = i;
    d.appendChild(num);

    const info = document.createElement('span');
    info.className = 'level-score';
    const b = getBest(i);
    info.textContent = b > 0 ? t('scoreShort', { score: b }) : '\u00A0';
    d.appendChild(info);

    d.addEventListener('click', () => startLevel(i));
    elLevelGrid.appendChild(d);
  }
  elUnlockTip.textContent = t('menuProgress', { n: TOTAL_LEVELS });
}

function renderLangGrid() {
  elLangGrid.innerHTML = '';
  for (const code of LANG_ORDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-btn' + (code === currentLang ? ' active' : '');
    btn.textContent = LANG_META[code].name;
    btn.addEventListener('click', () => {
      setLang(code);
      applyLangUI();
      hideLang();
    });
    elLangGrid.appendChild(btn);
  }
}

function showMenu() {
  over = true;
  clearHint();
  renderMenu();
  elMenuModal.classList.remove('hidden');
  elLevelModal.classList.add('hidden');
  elLangModal.classList.add('hidden');
  elModal.classList.add('hidden');
}

function showLevelSelect() {
  over = true;
  clearHint();
  renderLevelSelect();
  elLevelModal.classList.remove('hidden');
  elMenuModal.classList.add('hidden');
  elLangModal.classList.add('hidden');
  elModal.classList.add('hidden');
}

function showLang() {
  renderLangGrid();
  elLangModal.classList.remove('hidden');
}

function hideMenu() {
  elMenuModal.classList.add('hidden');
}

function hideLevelSelect() {
  elLevelModal.classList.add('hidden');
}

function hideLang() {
  elLangModal.classList.add('hidden');
}

function startLevel(lv) {
  clearHint();
  hideMenu();
  hideLevelSelect();
  hideLang();
  hideModal();
  level = lv;
  score = 0;
  movesLeft = levelMoves(lv);
  target = levelTarget(lv);
  localStorage.setItem('candy-last-level', lv);
  over = false;
  busy = false;
  selected = null;
  rebuildBoard();
  let guard = 0;
  while (!hasValidMove() && guard++ < 200) rebuildBoard();
  updateHud();
  startHintTimer();
  ensureAudio();
  play(330, 0.06, 'sine', 0.1);
}

/* ================== 胜负 ================== */
function winLevel() {
  over = true;
  clearHint();
  playWin();
  confetti();
  saveBest(level, score);
  const allDone = level >= TOTAL_LEVELS;
  const text = allDone
    ? t('allDone', { n: TOTAL_LEVELS })
    : t('winText', { score, target: levelTarget(level + 1) });
  showEndModal(
    t('winTitle'),
    text,
    allDone ? t('btnPlay') : t('nextLevelBtn'),
    () => { allDone ? showMenu() : startLevel(level + 1); },
    t('backToSelectBtn'),
    () => showLevelSelect()
  );
}

function loseGame() {
  over = true;
  clearHint();
  playLose();
  showEndModal(
    t('loseTitle'),
    t('loseText', { diff: Math.max(0, target - score) }),
    t('retryBtn'),
    () => startLevel(level),
    t('backToSelectBtn'),
    () => showLevelSelect()
  );
}

/* ================== 音效 ================== */
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function play(freq, dur = 0.08, type = 'sine', vol = 0.16, when = 0) {
  if (!soundOn || !audioCtx) return;
  const t = audioCtx.currentTime + when;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function playClear(combo) {
  const base = 500 + Math.min(combo, 6) * 60;
  play(base, 0.09, 'triangle', 0.15);
  play(base * 1.25, 0.09, 'triangle', 0.15, 0.06);
  play(base * 1.5, 0.12, 'triangle', 0.15, 0.12);
}

function playSwap() {
  play(320, 0.07, 'triangle', 0.13);
}

function playSwapBack() {
  play(180, 0.09, 'sine', 0.1);
}

function playWin() {
  [523, 659, 784, 1047].forEach((f, i) => play(f, 0.18, 'triangle', 0.17, i * 0.12));
}

function playLose() {
  [392, 330, 262].forEach((f, i) => play(f, 0.2, 'sine', 0.14, i * 0.14));
}

function playExplosion(combo) {
  const pitch = 100 + Math.min(combo, 5) * 30;
  play(pitch, 0.22, 'sawtooth', 0.16);
  play(pitch * 0.6, 0.3, 'square', 0.1, 0.08);
}

/* ================== 交互 ================== */
function setSelected(pos) {
  if (pos && Array.isArray(pos)) pos = { r: pos[0], c: pos[1] };
  if (selected) {
    const rec = tiles.get(tileAt[selected.r][selected.c]);
    if (rec) rec.el.classList.remove('sel');
  }
  selected = pos;
  if (pos) {
    const rec = tiles.get(tileAt[pos.r][pos.c]);
    if (rec) rec.el.classList.add('sel');
  }
}

function onTilePointerDown(e) {
  if (busy || over) return;
  e.preventDefault();
  startHintTimer();

  const id = Number(e.currentTarget.dataset.id);
  const el = e.currentTarget;
  let pos = null;
  for (let r = 0; r < ROWS && !pos; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tileAt[r][c] === id) {
        pos = [r, c];
        break;
      }
    }
  }
  if (!pos) return;
  const [r, c] = pos;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragged = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  const resetDrag = () => {
    el.classList.remove('dragging');
    el.style.transform = '';
  };

  const onMove = ev => {
    if (busy || over) {
      cleanup();
      resetDrag();
      return;
    }
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragged) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      dragged = true;
      setSelected([r, c]);
      el.classList.add('dragging');
    }
    // 糖果跟随手指，但限制在约 1.2 格范围内
    const maxD = tilePx * 1.2;
    const cx = Math.max(-maxD, Math.min(maxD, dx));
    const cy = Math.max(-maxD, Math.min(maxD, dy));
    el.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
  };

  const onUp = ev => {
    cleanup();
    resetDrag();
    if (busy || over) return;

    if (!dragged) {
      // 单击：选中 / 取消选中 / 交换相邻
      if (selected && selected.r === r && selected.c === c) {
        setSelected(null);
      } else if (selected && Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1) {
        const s = selected;
        setSelected(null);
        handleSwap(s.r, s.c, r, c);
      } else {
        setSelected([r, c]);
      }
      return;
    }

    setSelected(null);
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const th = tilePx * 0.4;
    let dr = 0;
    let dc = 0;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > th) dr = Math.sign(dy);
    else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > th) dc = Math.sign(dx);
    const nr = r + dr;
    const nc = c + dc;
    if ((dr || dc) && nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      handleSwap(r, c, nr, nc);
    }
  };

  const onCancel = () => {
    cleanup();
    resetDrag();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/* ================== 语言 ================== */
function applyLangUI() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = LANG_META[currentLang].dir;
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  renderMenu();
  renderLevelSelect();
  renderLangGrid();
  updateHud();
}

/* ================== 布局 ================== */
function layout() {
  const apply = () => {
    const rect = elBoardArea.getBoundingClientRect
      ? elBoardArea.getBoundingClientRect()
      : { width: elBoardArea.clientWidth || 460, height: elBoardArea.clientHeight || 460 };
    let w = Math.min(rect.width - 8, rect.height - 8);
    w = Math.max(w, 200);
    if (elBoard.style.width !== w + 'px') {
      elBoard.style.width = w + 'px';
      elBoard.style.height = w + 'px';
    }
    const cw = elBoard.clientWidth;
    const tp = Math.floor((cw - (COLS - 1) * GAP) / COLS);
    if (tp !== tilePx) {
      tilePx = tp;
      document.documentElement.style.setProperty('--tile', tilePx + 'px');
      render();
    }
  };
  apply();
  raf(apply);
}

/* ================== 初始化 ================== */
function init() {
  elSoundBtn.textContent = soundOn ? '🔊' : '🔇';
  applyLangUI();
  rebuildBoard();
  let guard = 0;
  while (!hasValidMove() && guard++ < 200) rebuildBoard();
  layout();
  updateHud();
  startHintTimer();
  showMenu();
}

/* ================== 事件绑定 ================== */
elHintBtn.addEventListener('click', () => {
  ensureAudio();
  play(420, 0.05, 'sine', 0.1);
  showHint();
});

elShuffleBtn.addEventListener('click', () => {
  ensureAudio();
  if (busy || over) return;
  if (score < SHUFFLE_COST) {
    showToastMsg(t('toastNeedPoints', { n: SHUFFLE_COST }));
    return;
  }
  score -= SHUFFLE_COST;
  updateHud();
  autoShuffle(false);
});

elRestartBtn.addEventListener('click', () => {
  if (busy || over) return;
  startLevel(level);
});

elBackBtn.addEventListener('click', () => {
  if (busy) return;
  showLevelSelect();
});

elSoundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('candy-sound', soundOn ? 'on' : 'off');
  elSoundBtn.textContent = soundOn ? '🔊' : '🔇';
  ensureAudio();
  play(500, 0.08, 'triangle', 0.15);
});

elPlayBtn.addEventListener('click', () => {
  ensureAudio();
  startLevel(lastLevel);
});

elSelectLevelBtn.addEventListener('click', () => {
  showLevelSelect();
});

elLangBtnMenu.addEventListener('click', () => {
  showLang();
});

elLevelBackBtn.addEventListener('click', () => {
  showMenu();
});

elLangCloseBtn.addEventListener('click', () => {
  hideLang();
  showMenu();
});

window.addEventListener('resize', layout);

init();
