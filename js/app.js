'use strict';

requireAuth();

// ─── Runtime state ────────────────────────────────────────────────────────────
let ALL_PREDICTIONS = [];
let AVAILABLE_DATES = new Set();
let ALL_MATCHES     = [];
let balance         = 1000.00;
let currentBet      = null;
let currentFilter   = 'all';
let betOnlyMode     = false;
let selectedDate    = '';

// ─── Load predictions from JSON file ─────────────────────────────────────────
async function loadPredictions() {
  const res = await fetch('./data/predictions.json');
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not load predictions.json`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function leagueLabel(betType) {
  const map = {
    nba_totals:    'NBA · Totals',
    nba_spreads:   'NBA · Spreads',
    mlb_totals:    'MLB · Totals',
    mlb_moneyline: 'MLB · Moneyline',
    mlb_runline:   'MLB · Run Line',
  };
  return map[betType] || betType;
}

function signedStr(n) { return n >= 0 ? '+' + n : String(n); }
function fmtOdds(n)   { return n >= 0 ? '+' + n : String(n); }

// American odds total return (stake + profit)
function calcReturn(stake, odds) {
  if (odds > 0) return stake + stake * (odds / 100);
  return stake + stake * (100 / Math.abs(odds));
}

function fmt(n)   { return '$' + Number(n).toFixed(2); }
function genRef() { return 'BET-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase(); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast ' + type + ' show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function fmtDisplayDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Build options from market_odds ──────────────────────────────────────────
function buildOptions(p) {
  const away = p.away_team;
  const home = p.home_team;
  const mo   = p.market_odds;
  const bt   = p.bet_type;
  const sel  = p.selection;

  if (bt === 'nba_totals' || bt === 'mlb_totals') {
    return [
      { key: 'over',  label: 'OVER',  sublabel: 'O ' + mo.line, team: 'OVER',  odds: mo.over,      isRec: sel === 'OVER'  },
      { key: 'under', label: 'UNDER', sublabel: 'U ' + mo.line, team: 'UNDER', odds: mo.under,     isRec: sel === 'UNDER' },
    ];
  }
  if (bt === 'nba_spreads' || bt === 'mlb_runline') {
    return [
      { key: 'away', label: away, sublabel: signedStr(mo.away_line), team: away, odds: mo.away_odds, isRec: sel === away },
      { key: 'home', label: home, sublabel: signedStr(mo.home_line), team: home, odds: mo.home_odds, isRec: sel === home },
    ];
  }
  return [
    { key: 'away', label: away, sublabel: '', team: away, odds: mo.away_odds, isRec: sel === away },
    { key: 'home', label: home, sublabel: '', team: home, odds: mo.home_odds, isRec: sel === home },
  ];
}

function buildMatchesForDate(date) {
  return ALL_PREDICTIONS
    .filter(p => p.date === date)
    .map((p, i) => ({
      id:           `pred-${date.replace(/-/g,'')}-${i}`,
      sport:        p.sport,
      dataset:      p.bet_type,
      league:       leagueLabel(p.bet_type),
      away:         p.away_team,
      home:         p.home_team,
      matchTitle:   p.match,
      options:      buildOptions(p),
      selection:    p.selection,
      odds:         p.suggested_odds,
      betRec:       p.bet_rec,          // "BET" or "PASS" from JSON
      defaultStake: p.stake,
    }));
}

// ─── Stats bar ────────────────────────────────────────────────────────────────
function updateStats(matches) {
  const bet  = matches.filter(m => m.betRec === 'BET').length;
  const pass = matches.filter(m => m.betRec === 'PASS').length;
  document.getElementById('statTotal').textContent = matches.length;
  document.getElementById('statBet').textContent   = bet;
  document.getElementById('statPass').textContent  = pass;
  document.getElementById('statDate').textContent  = selectedDate
    ? fmtDisplayDate(selectedDate).replace(/^\w+, /, '')
    : '—';
}

// ─── Render cards ─────────────────────────────────────────────────────────────
function renderMatch(match) {
  const card  = document.createElement('article');
  const emoji = match.sport === 'nba' ? '🏀' : '⚾';
  const isBet = match.betRec === 'BET';

  card.className = ['match-card', match.sport + '-card', isBet ? 'bet-pick' : ''].filter(Boolean).join(' ');
  card.setAttribute('data-testid',   `match-card-${match.id}`);
  card.setAttribute('data-match-id', match.id);
  card.setAttribute('data-dataset',  match.dataset);
  card.setAttribute('data-sport',    match.sport);

  card.innerHTML = `
    <div class="card-strip"></div>
    <div class="card-inner">
      <span class="sr-only" data-testid="match-title-${match.id}">${match.away} vs ${match.home}</span>

      <div class="card-head">
        <span class="card-league-badge">${emoji} ${match.league}</span>
        <span class="card-bet-pill ${isBet ? 'pill-bet' : 'pill-pass'}" data-testid="bet-rec-${match.id}">${match.betRec}</span>
      </div>

      <div class="card-matchup">
        <div class="team-row">
          <span class="team-tag">AWY</span>
          <span class="team-nm" data-testid="team-away-${match.id}">${match.away}</span>
        </div>
        <div class="vs-row">
          <div class="vs-line"></div>
          <span class="vs-at">@</span>
          <div class="vs-line"></div>
        </div>
        <div class="team-row">
          <span class="team-tag">HME</span>
          <span class="team-nm" data-testid="team-home-${match.id}">${match.home}</span>
        </div>
      </div>

      <div class="odds-grid" data-testid="odds-row-${match.id}">
        ${match.options.map(opt => `
          <button
            class="odds-btn${opt.isRec ? ' rec-btn' : ''}"
            data-testid="odds-${opt.key}-${match.id}"
            data-match-id="${match.id}"
            data-team="${opt.team}"
            data-side="${opt.key}"
            data-odds="${opt.odds}"
            aria-label="Bet on ${opt.team} at ${fmtOdds(opt.odds)}"
          >
            ${opt.isRec && isBet ? '<span class="rec-indicator">★ BET</span>' : ''}
            <span class="odds-type">${opt.label}</span>
            ${opt.sublabel ? `<span class="odds-line">${opt.sublabel}</span>` : ''}
            <span class="odds-val" data-testid="odds-value-${opt.key}-${match.id}">${fmtOdds(opt.odds)}</span>
          </button>
        `).join('')}
      </div>

      <div class="model-strip" data-testid="model-info-${match.id}">
        <div class="model-left">
          <span class="model-emoji">🤖</span>
          <span class="model-call-text">
            Pick: <strong data-testid="model-call-${match.id}">${match.selection}</strong>
          </span>
        </div>
        <div class="model-right">
          <span class="tag tag-edge">${fmtOdds(match.odds)}</span>
        </div>
      </div>
    </div>
  `;
  return card;
}

function renderMatches(matches) {
  const container = document.getElementById('matchesContainer');
  container.innerHTML = '';
  matches.forEach(m => container.appendChild(renderMatch(m)));
  updateStats(matches);
}

// ─── Filter ───────────────────────────────────────────────────────────────────
function filterByDataset(filter) {
  currentFilter = filter;
  let filtered;
  if      (filter === 'all')                      filtered = ALL_MATCHES;
  else if (filter === 'nba' || filter === 'mlb')  filtered = ALL_MATCHES.filter(m => m.sport === filter);
  else                                             filtered = ALL_MATCHES.filter(m => m.dataset === filter);

  if (betOnlyMode) filtered = filtered.filter(m => m.betRec === 'BET');
  renderMatches(filtered);
}

// ─── Date ─────────────────────────────────────────────────────────────────────
function setDate(iso) {
  selectedDate = iso;
  document.getElementById('dateValue').textContent = fmtDisplayDate(iso);
  document.getElementById('datePicker').value      = iso;

  const hasData = AVAILABLE_DATES.has(iso);
  const dot     = document.getElementById('dateDot');
  dot.className = 'date-dot' + (hasData ? '' : ' no-data');
  dot.title     = hasData ? 'Data available' : 'No data for this date';

  if (hasData) {
    ALL_MATCHES = buildMatchesForDate(iso);
    document.getElementById('matchesContainer').style.display = '';
    document.getElementById('emptyState').style.display       = 'none';
    filterByDataset(currentFilter);
  } else {
    ALL_MATCHES = [];
    document.getElementById('matchesContainer').style.display = 'none';
    document.getElementById('emptyState').style.display       = '';
    updateStats([]);
  }
}

// ─── Bet Slip ─────────────────────────────────────────────────────────────────
function updateBetSlip(matchTitle, selection, odds) {
  currentBet = { match: matchTitle, selection, odds };
  document.getElementById('betSlipEmpty').style.display   = 'none';
  document.getElementById('betSlipContent').style.display = 'block';
  document.getElementById('slipMatch').textContent        = matchTitle;
  document.getElementById('slipSelection').textContent    = selection;
  document.getElementById('slipOdds').textContent         = fmtOdds(odds);
  document.getElementById('slipBadge').textContent        = '1';
  updateSlipPayout();
}

function clearBetSlip() {
  currentBet = null;
  document.getElementById('betSlipEmpty').style.display   = '';
  document.getElementById('betSlipContent').style.display = 'none';
  document.getElementById('slipStake').value              = '';
  document.getElementById('slipBadge').textContent        = '0';
  document.querySelectorAll('.odds-btn.selected').forEach(b => b.classList.remove('selected'));
}

function updateSlipPayout() {
  const stake = parseFloat(document.getElementById('slipStake').value) || 0;
  document.getElementById('slipReturn').textContent =
    fmt(currentBet && stake > 0 ? calcReturn(stake, currentBet.odds) : 0);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(matchTitle, selection, odds) {
  showModalState('normal');
  document.getElementById('modalMatch').textContent     = matchTitle;
  document.getElementById('modalSelection').textContent = selection;
  document.getElementById('modalOdds').textContent      = fmtOdds(odds);
  document.getElementById('modalBetAmount').value       = '';
  document.getElementById('modalPayout').textContent    = '$0.00';
  document.getElementById('confirmBtn').disabled        = true;
  document.getElementById('modalOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('modalBetAmount').focus(), 100);
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

function showModalState(state) {
  document.getElementById('modalNormal').style.display     = state === 'normal'     ? '' : 'none';
  document.getElementById('processingState').style.display = state === 'processing' ? '' : 'none';
  document.getElementById('successState').style.display    = state === 'success'    ? '' : 'none';
  document.getElementById('errorState').style.display      = state === 'error'      ? '' : 'none';
  document.getElementById('modalClose').style.display      = state === 'processing' ? 'none' : '';
}

function updateModalPayout() {
  const stake = parseFloat(document.getElementById('modalBetAmount').value) || 0;
  const odds  = parseFloat(document.getElementById('modalOdds').textContent);
  document.getElementById('modalPayout').textContent =
    stake > 0 && odds ? fmt(calcReturn(stake, odds)) : '$0.00';
  document.getElementById('confirmBtn').disabled = stake <= 0;
}

function placeBet() {
  const matchTitle = document.getElementById('modalMatch').textContent;
  const selection  = document.getElementById('modalSelection').textContent;
  const odds       = parseFloat(document.getElementById('modalOdds').textContent);
  const stake      = parseFloat(document.getElementById('modalBetAmount').value);

  if (!stake || stake <= 0) { showToast('Enter a valid stake amount', 'error'); return; }
  if (stake > balance)      { showError('Insufficient balance.'); return; }

  showModalState('processing');
  setTimeout(() => {
    if (Math.random() < 0.95) {
      showSuccess(matchTitle, selection, stake, odds);
    } else {
      showError('Bet was rejected by the trading desk. Please try again.');
    }
  }, 800 + Math.random() * 500);
}

function showSuccess(matchTitle, selection, stake, odds) {
  const ref    = genRef();
  const payout = calcReturn(stake, odds);
  balance -= stake;
  document.getElementById('balance').textContent = fmt(balance);

  document.getElementById('successMatch').textContent     = matchTitle;
  document.getElementById('successSelection').textContent = selection;
  document.getElementById('successStake').textContent     = fmt(stake);
  document.getElementById('successReturn').textContent    = fmt(payout);
  document.getElementById('betRef').textContent           = ref;

  const TWO_MIN_MS = 2 * 60 * 1000;
  const isDuplicate = getBetHistory().some(b =>
    b.match === matchTitle && b.selection === selection && b.odds === odds &&
    (Date.now() - new Date(b.date).getTime()) < TWO_MIN_MS
  );
  if (!isDuplicate) {
    saveBetToHistory({ id: ref, match: matchTitle, selection, odds, stake, ret: payout, date: new Date().toLocaleString() });
  }
  showModalState('success');
  showToast('Bet placed! Ref: ' + ref, 'success');
}

function showError(msg) {
  document.getElementById('errorMessage').textContent = msg;
  showModalState('error');
}

// ─── Bet History ──────────────────────────────────────────────────────────────
function openHistory()  { renderHistory(); document.getElementById('historyOverlay').style.display = 'flex'; }
function closeHistory() { document.getElementById('historyOverlay').style.display = 'none'; }

function renderHistory() {
  const history = getBetHistory();
  const empty   = document.getElementById('historyEmpty');
  const table   = document.getElementById('historyTable');
  const tbody   = document.getElementById('historyTableBody');
  const count   = document.getElementById('historyCount');

  count.textContent = history.length + ' bet' + (history.length !== 1 ? 's' : '');

  if (history.length === 0) {
    empty.style.display = ''; table.style.display = 'none'; return;
  }
  empty.style.display = 'none'; table.style.display = '';

  tbody.innerHTML = history.map(b => `
    <tr data-testid="history-row-${b.id}">
      <td class="bet-id-cell" data-testid="history-bet-id">${b.id}</td>
      <td data-testid="history-match">${b.match}</td>
      <td><span class="selection-badge" data-testid="history-selection">${b.selection}</span></td>
      <td><span class="odds-badge-sm"   data-testid="history-odds">${fmtOdds(b.odds)}</span></td>
      <td data-testid="history-stake">${fmt(b.stake)}</td>
      <td class="return-cell" data-testid="history-return">${fmt(b.ret)}</td>
      <td class="date-cell"   data-testid="history-date">${b.date}</td>
    </tr>
  `).join('');
}

// ─── Error screen ─────────────────────────────────────────────────────────────
function showLoadError(msg) {
  document.getElementById('loadingSpinner').innerHTML = `
    <div style="text-align:center;padding:60px 20px">
      <div style="font-size:40px;margin-bottom:14px">⚠️</div>
      <h3 style="color:#f87171;margin-bottom:8px">Failed to load predictions</h3>
      <p style="color:#8fa3bb;font-size:13px;max-width:340px;margin:0 auto;line-height:1.7">${msg}</p>
      <p style="color:#4a6480;font-size:12px;margin-top:14px">
        Serve the site via a local HTTP server:<br>
        <code style="background:#162036;padding:4px 8px;border-radius:4px;color:#34d399">python -m http.server 8080</code>
      </p>
    </div>
  `;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Auth
  document.getElementById('headerUsername').textContent = getUsername();
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // My Bets nav
  document.getElementById('navMyBets').addEventListener('click', e => { e.preventDefault(); openHistory(); });

  // History modal
  document.getElementById('historyClose').addEventListener('click', closeHistory);
  document.getElementById('historyOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('historyOverlay')) closeHistory();
  });
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Clear all bet history?')) { clearBetHistory(); renderHistory(); }
  });

  // Date controls
  document.getElementById('datePicker').addEventListener('change', e => setDate(e.target.value));
  document.getElementById('prevDay').addEventListener('click',  () => setDate(addDays(selectedDate, -1)));
  document.getElementById('nextDay').addEventListener('click',  () => setDate(addDays(selectedDate, +1)));
  document.getElementById('todayBtn').addEventListener('click', () => setDate(new Date().toISOString().slice(0, 10)));
  document.getElementById('gotoDataBtn').addEventListener('click', () => {
    const first = [...AVAILABLE_DATES].sort()[0];
    if (first) setDate(first);
  });

  // BET-only toggle — filters to show only BET-recommended picks
  document.getElementById('betOnlyBtn').addEventListener('click', () => {
    betOnlyMode = !betOnlyMode;
    document.getElementById('betOnlyBtn').classList.toggle('active', betOnlyMode);
    filterByDataset(currentFilter);
  });

  // Tabs
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab[data-filter]');
    if (tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterByDataset(tab.dataset.filter);
    }
  });

  // Odds button → modal
  document.addEventListener('click', e => {
    const btn = e.target.closest('.odds-btn');
    if (!btn) return;
    const card = btn.closest('.match-card');
    card.querySelectorAll('.odds-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const matchId    = btn.dataset.matchId;
    const match      = ALL_MATCHES.find(m => m.id === matchId);
    const matchTitle = match ? match.matchTitle : matchId;
    const team       = btn.dataset.team;
    const odds       = parseInt(btn.dataset.odds, 10);

    updateBetSlip(matchTitle, team, odds);
    openModal(matchTitle, team, odds);
  });

  // Modal inputs
  document.getElementById('modalBetAmount').addEventListener('input', updateModalPayout);
  document.addEventListener('click', e => {
    const qBtn = e.target.closest('.quick-btn');
    if (qBtn) {
      document.getElementById('modalBetAmount').value = qBtn.dataset.amount;
      updateModalPayout();
    }
  });

  // Modal actions
  document.getElementById('confirmBtn').addEventListener('click', placeBet);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('doneBtn').addEventListener('click', () => { closeModal(); clearBetSlip(); });
  document.getElementById('errorClose').addEventListener('click', closeModal);
  document.getElementById('retryBtn').addEventListener('click', () => showModalState('normal'));
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });

  // Bet slip
  document.getElementById('slipClose').addEventListener('click', clearBetSlip);
  document.getElementById('slipStake').addEventListener('input', updateSlipPayout);
  document.getElementById('slipPlaceBtn').addEventListener('click', () => {
    if (!currentBet) return;
    const stake = parseFloat(document.getElementById('slipStake').value);
    if (!stake || stake <= 0) { showToast('Enter a valid stake', 'error'); return; }
    openModal(currentBet.match, currentBet.selection, currentBet.odds);
    document.getElementById('modalBetAmount').value = stake;
    updateModalPayout();
  });

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeHistory(); }
  });

  // ── Fetch & initialise ──
  try {
    const data      = await loadPredictions();
    ALL_PREDICTIONS = data;
    AVAILABLE_DATES = new Set(data.map(p => p.date));

    const sortedDates = [...AVAILABLE_DATES].sort();
    const startDate   = sortedDates[0] || new Date().toISOString().slice(0, 10);

    document.getElementById('loadingSpinner').style.display = 'none';
    setDate(startDate);

  } catch (err) {
    console.error(err);
    showLoadError(err.message);
  }
});
