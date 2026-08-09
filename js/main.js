'use strict';

/* ================== 配置 ================== */
const ROWS = 8;
const COLS = 8;
const TYPE_COUNT = 6;
const TOTAL_LEVELS = 30;
const EMOJIS = ['🍓', '🍌', '🍋', '🍇', '🍉', '🫐'];
const TILE_BG = ['#ffe4ee', '#f1f7c5', '#fff3c9', '#e6e3ff', '#d9f6e4', '#dcf0ff'];
const GAP = 6;
const SWAP_MS = 180;
const CLEAR_MS = 300;
const FALL_MS = 340;
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
const elAdSlotRight = document.getElementById('adSlotRight');
const elAdSlotMobile = document.getElementById('adSlotMobile');

/* ================== 工具函数 ================== */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function makeTile(type) {
  const id = nextId++;
  const el = document.createElement('div');
  el.className = 'tile';
  el.textContent = EMOJIS[type];
  el.style.background = TILE_BG[type];
  el.dataset.id = id;
  el.addEventListener('pointerdown', onTilePointerDown);
  el.addEventListener('contextmenu', e => e.preventDefault());
  tiles.set(id, { el, type });
  elBoard.appendChild(el);
  return id;
}

function placeTile(el, r, c, instant = false) {
  if (instant) el.classList.add('no-anim');
  el.style.setProperty('--tx', xOf(c) + 'px');
  el.style.setProperty('--ty', yOf(r) + 'px');
  if (instant) {
    void el.offsetWidth;
    el.classList.remove('no-anim');
  }
}

function render(instant = false) {
  if (!tileAt.length) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = tileAt[r][c];
      if (id == null) continue;
      const rec = tiles.get(id);
      if (rec.el.textContent !== EMOJIS[rec.type]) rec.el.textContent = EMOJIS[rec.type];
      if (rec.el.style.background !== TILE_BG[rec.type]) rec.el.style.background = TILE_BG[rec.type];
      placeTile(rec.el, r, c, instant);
    }
  }
}

function rebuildBoard() {
  tiles.forEach(rec => rec.el.remove());
  tiles.clear();
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  tileAt = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = randomTypeAt(r, c, grid);
      tileAt[r][c] = makeTile(grid[r][c]);
    }
  }
  render(true);
}

/* ================== 消除判定 ================== */
function findMatches() {
  const rowCells = new Set();
  const colCells = new Set();
  const shapes = [];

  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      if (c < COLS && grid[r][c] !== null && grid[r][c] === grid[r][c - 1]) {
        run++;
        continue;
      }
      if (run >= 3) {
        const cells = [];
        for (let k = c - run; k < c; k++) {
          rowCells.add(r * COLS + k);
          cells.push([r, k]);
        }
        shapes.push({ len: run, cells });
      }
      run = 1;
    }
  }

  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      if (r < ROWS && grid[r][c] !== null && grid[r][c] === grid[r - 1][c]) {
        run++;
        continue;
      }
      if (run >= 3) {
        const cells = [];
        for (let k = r - run; k < r; k++) {
          colCells.add(k * COLS + c);
          cells.push([k, c]);
        }
        shapes.push({ len: run, cells });
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

function findHint() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && wouldMatch(r, c, r, c + 1)) return [[r, c], [r, c + 1]];
      if (r + 1 < ROWS && wouldMatch(r, c, r + 1, c)) return [[r, c], [r + 1, c]];
    }
  }
  return null;
}

/* ================== 消除流程 ================== */
async function resolveMatches(m) {
  const base = m.cells.size * 10 * cascade;
  const bonus = m.shapes.filter(s => s.len >= 4).length * 50 + (m.isT ? 50 : 0);
  const gained = base + bonus;
  score += gained;
  updateHud();
  showToast(gained, cascade);
  playClear(cascade);

  const ids = [];
  for (const key of m.cells) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    const id = tileAt[r][c];
    if (id == null) continue;
    tiles.get(id).el.classList.add('pop');
    ids.push([r, c, id]);
  }
  await sleep(CLEAR_MS);
  for (const [r, c, id] of ids) {
    const rec = tiles.get(id);
    if (rec) {
      rec.el.remove();
      tiles.delete(id);
    }
    grid[r][c] = null;
    tileAt[r][c] = null;
  }
}

async function applyGravity() {
  const ng = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const nt = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const falling = [];
  const spawning = [];

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
      const id = makeTile(type);
      ng[r][c] = type;
      nt[r][c] = id;
      spawning.push({ id, fromR: r - newCount, toR: r, c });
    }
  }

  grid = ng;
  tileAt = nt;

  for (const mv of falling) {
    placeTile(tiles.get(mv.id).el, mv.toR, mv.c);
  }
  for (const sp of spawning) {
    placeTile(tiles.get(sp.id).el, sp.fromR, sp.c, true);
  }
  await sleep(30);
  for (const sp of spawning) {
    placeTile(tiles.get(sp.id).el, sp.toR, sp.c);
  }
  await sleep(FALL_MS);
}

async function handleSwap(r1, c1, r2, c2) {
  if (busy || over) return;
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;

  busy = true;
  clearHint();
  swapGrid(r1, c1, r2, c2);
  render();
  playSwap();
  await sleep(SWAP_MS);

  let m = findMatches();
  if (m.cells.size === 0) {
    swapGrid(r1, c1, r2, c2);
    render();
    playSwapBack();
    await sleep(SWAP_MS);
    busy = false;
    return;
  }

  cascade = 0;
  while (m.cells.size > 0) {
    cascade++;
    await resolveMatches(m);
    await applyGravity();
    m = findMatches();
  }

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
  elScore.textContent = score;
  elLevel.textContent = level;
  elMoves.textContent = movesLeft;
  elMoves.classList.toggle('low', movesLeft <= 5);
  elTarget.textContent = target;
  elBar.style.width = Math.min(100, (score / target) * 100) + '%';
  elBest.textContent = getBest(level);
  elHintBtn.disabled = busy || over;
  elShuffleBtn.disabled = busy || over || score < SHUFFLE_COST;
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

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  const onMove = ev => {
    if (busy || over) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
    cleanup();
    setSelected(null);
    const dr = Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0;
    const dc = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      handleSwap(r, c, nr, nc);
    }
  };

  const onUp = () => cleanup();

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  if (selected && selected.r === r && selected.c === c) {
    cleanup();
    setSelected(null);
    return;
  }
  if (selected && Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1) {
    cleanup();
    const s = selected;
    setSelected(null);
    handleSwap(s.r, s.c, r, c);
    return;
  }
  setSelected([r, c]);
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
const raf = window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : fn => setTimeout(fn, 16);

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

/* 广告位：占位阶段拦截点击，避免误触 */
[elAdSlotRight, elAdSlotMobile].forEach(slot => {
  slot.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  slot.addEventListener('pointerdown', e => e.stopPropagation());
  slot.addEventListener('contextmenu', e => e.preventDefault());
});

init();
