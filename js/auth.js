'use strict';

const SESSION_KEY = 'betsim_logged_in';
const USER_KEY    = 'betsim_user';
const USERS_KEY   = 'betsim_users';

// Hardcoded demo admin account
const DEMO_CREDENTIALS = { username: 'admin', password: 'password' };

function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === 'true';
}

function getUsername() {
  return sessionStorage.getItem(USER_KEY) || 'User';
}

function getRegisteredUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}

function signup(username, email, password) {
  if (username === DEMO_CREDENTIALS.username) {
    return { ok: false, error: 'Username already taken.' };
  }
  const users = getRegisteredUsers();
  if (users.some(function(u) { return u.username === username; })) {
    return { ok: false, error: 'Username already taken.' };
  }
  if (users.some(function(u) { return u.email === email; })) {
    return { ok: false, error: 'Email already registered.' };
  }
  users.push({ username: username, email: email, password: password });
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  return { ok: true };
}

function login(username, password) {
  if (username === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password) {
    sessionStorage.setItem(SESSION_KEY, 'true');
    sessionStorage.setItem(USER_KEY, username);
    return true;
  }
  const users = getRegisteredUsers();
  const found = users.find(function(u) { return u.username === username && u.password === password; });
  if (found) {
    sessionStorage.setItem(SESSION_KEY, 'true');
    sessionStorage.setItem(USER_KEY, username);
    return true;
  }
  return false;
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(USER_KEY);
  window.location.href = '/';
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

// ── Bet History (persisted across sessions) ──────────────────────────────────
const HISTORY_KEY = 'betsim_bet_history';

function getBetHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveBetToHistory(bet) {
  const history = getBetHistory();
  history.unshift(bet); // newest first
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function clearBetHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
