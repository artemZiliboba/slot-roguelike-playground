const SYMBOLS = {
  cherry:  { name: 'Cherry',  icon: '🍒', base: 5,  weight: 10, tags: ['fruit'] },
  lemon:   { name: 'Lemon',   icon: '🍋', base: 8,  weight: 10, tags: ['fruit'] },
  bell:    { name: 'Bell',    icon: '🔔', base: 12, weight: 8,  tags: [] },
  diamond: { name: 'Diamond', icon: '💎', base: 10, weight: 3,  tags: ['gem'] },
  bomb:    { name: 'Bomb',    icon: '💣', base: 0,  weight: 5,  tags: ['destruction'] },
  wild:    { name: 'Wild',    icon: '★',  base: 0,  weight: 2,  tags: ['wild'] }
};

const MODIFIERS = {
  fruitBasket:   { name: 'Fruit Basket', description: 'Fruit +4 base value' },
  doubleGlass:   { name: 'Double Glass', description: 'Center scoring cell retriggers' },
  gemPolish:     { name: 'Gem Polish', description: 'Diamond match gets ×1.5' },
  scrapCollector:{ name: 'Scrap Collector', description: 'Activated Bomb gets +2 bonus' },
  echoChamber:   { name: 'Echo Chamber', description: 'First bonus trigger repeats' }
};

const initialPool = () => ({ cherry: 3, lemon: 2, bell: 2, diamond: 1, wild: 1, bomb: 0 });

let state;
let forcedGrid = null;

function makeState(seed) {
  return {
    seed: normalizeSeed(seed),
    rngState: normalizeSeed(seed),
    pool: initialPool(),
    modifiers: new Set(),
    score: 0,
    target: 120,
    spins: 8,
    coins: 20,
    lastScore: 0,
    lastHits: new Set(),
    events: []
  };
}

function normalizeSeed(value) {
  const n = Number(value);
  return Number.isFinite(n) ? (Math.abs(Math.floor(n)) >>> 0) || 1 : 1;
}

function random() {
  state.rngState = (state.rngState + 0x6D2B79F5) >>> 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function weightedPick() {
  const entries = Object.entries(state.pool)
    .filter(([id, count]) => count > 0)
    .map(([id, count]) => ({ id, weight: SYMBOLS[id].weight * count }));
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.id;
  }
  return entries.at(-1).id;
}

function makeGrid() {
  if (forcedGrid) {
    const grid = forcedGrid;
    forcedGrid = null;
    return grid;
  }
  return Array.from({ length: 9 }, () => weightedPick());
}

function symbolBase(id) {
  let value = SYMBOLS[id].base;
  if (state.modifiers.has('fruitBasket') && SYMBOLS[id].tags.includes('fruit')) value += 4;
  return value;
}

function resolveLine(grid, indexes, rowNumber) {
  const ids = indexes.map(i => grid[i]);
  const nonWild = ids.filter(id => id !== 'wild');
  const counts = {};
  nonWild.forEach(id => counts[id] = (counts[id] || 0) + 1);

  let candidate = null;
  let bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { candidate = id; bestCount = count; }
  }

  const wildCount = ids.filter(id => id === 'wild').length;
  if (!candidate || bestCount + wildCount < 2) return null;

  const matchedPositions = indexes.filter((index, local) => ids[local] === candidate || ids[local] === 'wild');
  const matchCount = Math.min(3, bestCount + wildCount);
  let base = ids.reduce((sum, id) => sum + (id === candidate ? symbolBase(id) : 0), 0);
  let multiplier = matchCount === 3 ? 2 : 1;

  const events = [`LINE_MATCHED row=${rowNumber} ${SYMBOLS[candidate].name} x${matchCount}: base ${base} × ${multiplier}`];

  if (candidate === 'bell' && bestCount >= 2) {
    base += 16;
    events.push('Bell pair bonus: +16 base');
  }

  if (candidate === 'diamond' && state.modifiers.has('gemPolish')) {
    multiplier *= 1.5;
    events.push('Gem Polish: Diamond line ×1.5');
  }

  let score = Math.floor(base * multiplier);
  const bonuses = [];

  if (candidate === 'bomb') {
    const bombs = bestCount;
    let bombBonus = bombs * 15;
    if (state.modifiers.has('scrapCollector')) bombBonus += bombs * 2;
    bonuses.push({ name: `Bomb activation ×${bombs}`, amount: bombBonus });
  }

  if (state.modifiers.has('doubleGlass') && matchedPositions.includes(4) && grid[4] !== 'wild') {
    bonuses.push({ name: 'Double Glass center retrigger', amount: symbolBase(grid[4]) });
  }

  if (state.modifiers.has('echoChamber') && bonuses.length) {
    bonuses.push({ name: `Echo Chamber repeats ${bonuses[0].name}`, amount: bonuses[0].amount });
  }

  for (const bonus of bonuses) {
    score += bonus.amount;
    events.push(`${bonus.name}: +${bonus.amount}`);
  }

  events.push(`SCORE_ADDED row=${rowNumber}: +${score}`);
  return { score, matchedPositions, events };
}

function spin() {
  if (state.spins <= 0 || state.score >= state.target) return;
  state.events = ['SPIN_STARTED'];
  state.lastHits = new Set();
  const grid = makeGrid();
  state.events.push(`GRID_CREATED rngState=${state.rngState}`);

  let total = 0;
  [[0,1,2],[3,4,5],[6,7,8]].forEach((line, row) => {
    const result = resolveLine(grid, line, row + 1);
    if (!result) return;
    total += result.score;
    result.matchedPositions.forEach(i => state.lastHits.add(i));
    state.events.push(...result.events);
  });

  state.spins -= 1;
  state.lastScore = total;
  state.score += total;
  state.events.push(`SPIN_FINISHED total=${total}`);
  state.grid = grid;

  if (state.score >= state.target) {
    const reward = 6 + state.spins * 2;
    state.coins += reward;
    state.events.push(`ENCOUNTER_WON reward=${reward} coins`);
  } else if (state.spins === 0) {
    state.events.push('ENCOUNTER_LOST');
  }
  render();
}

function addSymbol(id) {
  state.pool[id] = (state.pool[id] || 0) + 1;
  logStandalone(`DEV: added ${SYMBOLS[id].name} to pool`);
  render();
}

function toggleModifier(id) {
  if (state.modifiers.has(id)) state.modifiers.delete(id); else state.modifiers.add(id);
  logStandalone(`DEV: ${state.modifiers.has(id) ? 'enabled' : 'disabled'} ${MODIFIERS[id].name}`);
  render();
}

function logStandalone(message) {
  state.events.push(message);
  if (state.events.length > 50) state.events.shift();
}

function renderGrid() {
  const el = document.querySelector('#grid');
  const grid = state.grid || Array(9).fill(null);
  el.innerHTML = grid.map((id, i) => id
    ? `<div class="cell ${state.lastHits.has(i) ? 'hit' : ''}"><div class="icon">${SYMBOLS[id].icon}</div><div class="name">${SYMBOLS[id].name}</div></div>`
    : `<div class="cell"><div class="icon">?</div><div class="name">empty</div></div>`
  ).join('');
}

function render() {
  renderGrid();
  document.querySelector('#targetText').textContent = `${state.score} / ${state.target}`;
  document.querySelector('#spinsText').textContent = state.spins;
  document.querySelector('#coinsText').textContent = state.coins;
  document.querySelector('#lastScoreText').textContent = state.lastScore;
  document.querySelector('#seedInput').value = state.seed;
  document.querySelector('#spinBtn').disabled = state.spins <= 0 || state.score >= state.target;

  document.querySelector('#resultText').textContent = state.score >= state.target
    ? 'Encounter won — restart/reset для нового теста'
    : state.spins === 0
      ? 'Encounter lost — попробуй другой build'
      : `Последний Spin: ${state.lastScore}`;

  document.querySelector('#poolList').innerHTML = Object.entries(state.pool)
    .filter(([,count]) => count > 0)
    .map(([id,count]) => `<div class="pool-row"><span>${SYMBOLS[id].icon} ${SYMBOLS[id].name}</span><strong>×${count}</strong></div>`)
    .join('');

  document.querySelector('#modifierList').innerHTML = state.modifiers.size
    ? [...state.modifiers].map(id => `<span class="tag" title="${MODIFIERS[id].description}">${MODIFIERS[id].name}</span>`).join('')
    : '<span class="muted">No modifiers</span>';

  document.querySelector('#eventLog').innerHTML = state.events.slice().reverse().map(e => `<li>${escapeHtml(e)}</li>`).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function boot(seed = 12345) {
  state = makeState(seed);
  document.querySelector('#symbolButtons').innerHTML = Object.keys(SYMBOLS)
    .map(id => `<button data-symbol="${id}">+ ${SYMBOLS[id].icon} ${SYMBOLS[id].name}</button>`).join('');
  document.querySelector('#modifierButtons').innerHTML = Object.keys(MODIFIERS)
    .map(id => `<button data-modifier="${id}">${MODIFIERS[id].name}</button>`).join('');
  render();
}

document.querySelector('#spinBtn').addEventListener('click', spin);
document.querySelector('#restartSeedBtn').addEventListener('click', () => boot(document.querySelector('#seedInput').value));
document.querySelector('#newSeedBtn').addEventListener('click', () => boot(Date.now() >>> 0));
document.querySelector('#resetRunBtn').addEventListener('click', () => boot(state.seed));
document.querySelector('#addCoinsBtn').addEventListener('click', () => { state.coins += 20; logStandalone('DEV: +20 Coins'); render(); });
document.querySelector('#clearLogBtn').addEventListener('click', () => { state.events = []; render(); });
document.querySelector('#forceJackpotBtn').addEventListener('click', () => {
  forcedGrid = ['cherry','cherry','wild','diamond','diamond','wild','bomb','bomb','wild'];
  logStandalone('DEV: next Spin uses forced test grid');
  render();
});
document.querySelector('#symbolButtons').addEventListener('click', e => {
  const id = e.target.dataset.symbol;
  if (id) addSymbol(id);
});
document.querySelector('#modifierButtons').addEventListener('click', e => {
  const id = e.target.dataset.modifier;
  if (id) toggleModifier(id);
});

boot();
