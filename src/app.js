import { computeAccuracy, generateExample } from './core.js';
import { createAnswerSoundPlayer } from './sounds.js';

const SESSION_KEY = 'umnozhayka.sessions.v1';
const LEGACY_PROGRESS_KEY = 'umnozhayka.progress.v1';
const $ = (selector) => document.querySelector(selector);

const elements = {
  login: $('#login-screen'), welcome: $('#welcome-screen'), trainer: $('#trainer-screen'),
  appActions: $('#app-actions'), home: $('#home-button'), switchPlayer: $('#switch-player'),
  headerPlayer: $('#header-player'), playerForm: $('#player-form'), playerName: $('#player-name'),
  playerSubmit: $('#player-submit'), nameFeedback: $('#name-feedback'), nameSuggestions: $('#name-suggestions'),
  legacyOption: $('#legacy-progress-option'), claimLegacy: $('#claim-legacy-progress'),
  knownPlayers: $('#known-players'), knownPlayerButtons: $('#known-player-buttons'),
  start: $('#start-button'), progressButton: $('#progress-button'), progressDialog: $('#progress-dialog'),
  closeProgress: $('#close-progress'), form: $('#answer-form'), input: $('#answer-input'),
  feedback: $('#feedback'), check: $('#check-button'), card: $('#practice-card'),
  factorA: $('#factor-a'), factorB: $('#factor-b'), answerResult: $('#answer-result'),
  backToWelcome: $('#back-to-welcome'),
  celebration: $('#celebration'), celebrationText: $('#celebration-text'),
  resetProgress: $('#reset-progress'), confirmDialog: $('#confirm-dialog'),
  cancelReset: $('#cancel-reset'), confirmReset: $('#confirm-reset'),
  roundDialog: $('#round-dialog'), nextRound: $('#next-round'),
  rewardsButton: $('#rewards-button'), rewardsDialog: $('#rewards-dialog'),
  closeRewards: $('#close-rewards'), badgesGrid: $('#badges-grid'),
  leaderboardList: $('#leaderboard-list'), myRankRow: $('#my-rank-row'),
};

let sessions = loadSessions();
let activeToken = sessions.activeToken;
let profile = null;
let progress = null;
let problem = null;
let answered = false;
let submitting = false;
let pendingRound = null;
let celebrationTimer = null;
let leaderboard = null;
const answerSounds = createAnswerSoundPlayer(window.AudioContext || window.webkitAudioContext);

class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || 'request_failed');
    this.status = status;
    this.payload = payload || {};
  }
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    const saved = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const valid = saved.filter((item) => item && typeof item.name === 'string' && typeof item.token === 'string');
    return {
      activeToken: typeof parsed.activeToken === 'string' ? parsed.activeToken : null,
      sessions: valid.slice(0, 20),
    };
  } catch {
    return { activeToken: null, sessions: [] };
  }
}

function saveSessions() {
  sessions.activeToken = activeToken;
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
}

function legacyProgress() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) || 'null');
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (options.auth !== false && activeToken) headers.Authorization = `Bearer ${activeToken}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError(0, { message: 'Нет связи с сервером. Попробуй ещё раз.' });
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* empty or invalid response */ }
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value);
}

function showScreen(name) {
  elements.login.hidden = name !== 'login';
  elements.welcome.hidden = name !== 'welcome';
  elements.trainer.hidden = name !== 'trainer';
  elements.appActions.hidden = name === 'login';
}

function renderKnownPlayers() {
  elements.knownPlayerButtons.replaceChildren();
  elements.knownPlayers.hidden = sessions.sessions.length === 0;
  for (const saved of sessions.sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'known-player-button';
    button.textContent = saved.name;
    button.addEventListener('click', () => activateSession(saved.token));
    elements.knownPlayerButtons.append(button);
  }
}

function setNameFeedback(message, isError = false) {
  elements.nameFeedback.textContent = message;
  elements.nameFeedback.className = `name-feedback${isError ? ' error' : ''}`;
}

function showSuggestions(names = []) {
  elements.nameSuggestions.replaceChildren();
  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      elements.playerName.value = name;
      elements.playerName.focus();
      setNameFeedback('Этот вариант свободен');
      showSuggestions();
    });
    elements.nameSuggestions.append(button);
  }
}

function rememberSession(name, token) {
  const nameKey = name.toLocaleLowerCase('ru');
  sessions.sessions = sessions.sessions.filter(
    (item) => item.token !== token && item.name.toLocaleLowerCase('ru') !== nameKey,
  );
  sessions.sessions.unshift({ name, token });
  activeToken = token;
  saveSessions();
}

function removeSession(token) {
  sessions.sessions = sessions.sessions.filter((item) => item.token !== token);
  if (activeToken === token) activeToken = null;
  saveSessions();
}

function renderProgress() {
  if (!profile || !progress) return;
  const accuracy = Math.round((progress.accuracy ?? computeAccuracy(progress.totalSolved, progress.totalCorrect)) * 100);
  setText('#header-player', profile.name);
  setText('#welcome-name', profile.name);
  setText('#welcome-round', progress.currentRound.number);
  setText('#welcome-level', progress.level);
  setText('#welcome-stars', progress.stars);
  setText('#level-value', progress.level);
  setText('#stars-value', progress.stars);
  setText('#streak-value', progress.currentStreak);
  setText('#round-number', progress.currentRound.number);
  setText('#round-count', `${progress.currentRound.answered} из 10`);
  $('#round-progress').style.width = `${progress.currentRound.answered * 10}%`;
  setText('#progress-player', profile.name);
  setText('#progress-level', progress.level);
  setText('#progress-stars', progress.stars);
  setText('#progress-best', progress.bestStreak);
  setText('#progress-accuracy', `${accuracy}%`);
  setText('#progress-solved', progress.totalSolved);
  setText('#progress-rounds', progress.completedRounds);
  const grade = progress.rewards?.grade;
  if (grade) {
    setText('#grade-icon', grade.icon);
    setText('#grade-name', grade.name);
    setText('#rewards-grade-icon', grade.icon);
    setText('#rewards-grade-name', grade.name);
    setText('#round-reward', `Статус: ${grade.name}`);
    setText('#grade-next', grade.nextName
      ? `До статуса «${grade.nextName}» — ${grade.starsToNext} звёзд`
      : 'Высший статус уже получен!');
    renderBadges(progress.rewards.badges);
  }
}

function renderBadges(badges = []) {
  elements.badgesGrid.replaceChildren();
  for (const badge of badges) {
    const card = document.createElement('div');
    card.className = `badge-card${badge.unlocked ? '' : ' locked'}`;
    const symbol = document.createElement('span');
    symbol.className = 'badge-symbol';
    symbol.textContent = badge.unlocked ? badge.icon : '?';
    const name = document.createElement('strong');
    name.textContent = badge.name;
    const description = document.createElement('small');
    description.textContent = badge.description;
    card.append(symbol, name, description);
    elements.badgesGrid.append(card);
  }
  setText('#badges-count', `${badges.filter((badge) => badge.unlocked).length} из ${badges.length}`);
}

function leaderboardRow(entry, isMe = false) {
  const row = document.createElement('li');
  row.className = `leaderboard-row${isMe ? ' is-me' : ''}`;
  const position = document.createElement('span');
  position.className = 'leaderboard-position';
  position.textContent = `#${entry.position}`;
  const player = document.createElement('span');
  player.className = 'leaderboard-player';
  const name = document.createElement('strong');
  name.textContent = isMe ? `${entry.name} — это ты` : entry.name;
  const details = document.createElement('small');
  details.textContent = `${entry.grade.icon} ${entry.grade.name} · точность ${entry.accuracy}%`;
  player.append(name, details);
  const stars = document.createElement('span');
  stars.className = 'leaderboard-stars';
  stars.textContent = `${entry.stars} ★`;
  row.append(position, player, stars);
  return row;
}

function renderLeaderboard() {
  if (!leaderboard) return;
  elements.leaderboardList.replaceChildren();
  for (const entry of leaderboard.leaders) {
    elements.leaderboardList.append(leaderboardRow(entry, entry.name === profile.name));
  }
  setText('#personal-rank', `#${leaderboard.me.position}`);
  setText('#total-players', `игроков: ${leaderboard.totalPlayers}`);
  const inTop = leaderboard.leaders.some((entry) => entry.name === profile.name);
  elements.myRankRow.hidden = inTop;
  if (!inTop) {
    const myRow = leaderboardRow(leaderboard.me, true);
    elements.myRankRow.replaceChildren(...myRow.childNodes);
  }
}

async function loadLeaderboard() {
  try {
    leaderboard = await api('/api/leaderboard');
    renderLeaderboard();
  } catch {
    setText('#personal-rank', '—');
    setText('#total-players', 'рейтинг недоступен');
  }
}

async function activateSession(token) {
  activeToken = token;
  saveSessions();
  setNameFeedback('Загружаю прогресс…');
  try {
    const payload = await api('/api/me');
    profile = payload.profile;
    progress = payload.progress;
    rememberSession(profile.name, activeToken);
    renderProgress();
    showScreen('welcome');
    await loadLeaderboard();
  } catch (error) {
    if (error.status === 401) {
      removeSession(token);
      renderKnownPlayers();
      setNameFeedback('Этот игрок больше недоступен. Введи новое имя.', true);
    } else {
      setNameFeedback(error.message, true);
    }
    showScreen('login');
  }
}

function resetProblemUi() {
  answered = false;
  submitting = false;
  pendingRound = null;
  elements.input.disabled = false;
  elements.input.value = '';
  elements.answerResult.textContent = '?';
  elements.input.removeAttribute('aria-invalid');
  elements.feedback.className = 'feedback';
  elements.feedback.textContent = 'Введи число';
  elements.check.disabled = false;
  elements.check.textContent = 'Проверить';
  elements.card.classList.remove('is-correct', 'is-incorrect', 'level-up');
}

function nextProblem({ focus = true } = {}) {
  problem = generateExample(progress);
  elements.factorA.textContent = problem.a;
  elements.factorB.textContent = problem.b;
  resetProblemUi();
  if (focus) requestAnimationFrame(() => elements.input.focus({ preventScroll: true }));
}

function startTraining() {
  showScreen('trainer');
  renderProgress();
  nextProblem();
}

function showCelebration(message, levelUp = false) {
  clearTimeout(celebrationTimer);
  elements.celebrationText.textContent = message;
  elements.celebration.hidden = false;
  if (levelUp) elements.card.classList.add('level-up');
  celebrationTimer = setTimeout(() => {
    elements.celebration.hidden = true;
    elements.card.classList.remove('level-up');
  }, 2600);
}

function openRoundResult(round) {
  setText('#round-title', `Раунд ${round.number} завершён!`);
  setText('#round-score', `${round.correct} из ${round.total}`);
  const message = round.correct === 10
    ? 'Без единой ошибки — великолепно!'
    : round.correct >= 7
      ? 'Очень хороший результат!'
      : 'Ты закончил раунд — продолжай тренироваться!';
  setText('#round-message', message);
  setText('#round-reward', `Статус: ${progress.rewards.grade.name} · ${progress.rankingStars} рейтинговых звёзд`);
  if (!elements.roundDialog.open) elements.roundDialog.showModal();
}

function submissionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function submitAnswer() {
  if (submitting) return;
  if (answered) {
    if (pendingRound) openRoundResult(pendingRound);
    else nextProblem();
    return;
  }

  const value = elements.input.value.trim();
  if (!value) {
    elements.input.setAttribute('aria-invalid', 'true');
    elements.feedback.className = 'feedback validation';
    elements.feedback.textContent = 'Сначала напиши ответ';
    elements.input.focus();
    return;
  }
  if (!/^\d+$/.test(value)) {
    elements.input.setAttribute('aria-invalid', 'true');
    elements.feedback.className = 'feedback validation';
    elements.feedback.textContent = 'Здесь нужны только цифры';
    elements.input.focus();
    return;
  }

  submitting = true;
  answerSounds.prepare();
  elements.input.disabled = true;
  elements.check.disabled = true;
  elements.check.textContent = 'Проверяю…';
  try {
    const result = await api('/api/answers', {
      method: 'POST',
      body: JSON.stringify({ ...problem, answer: value, submissionId: submissionId() }),
    });
    profile = result.profile;
    progress = result.progress;
    pendingRound = result.roundCompleted;
    answered = true;
    submitting = false;
    elements.check.disabled = false;
    elements.check.textContent = pendingRound ? 'Итоги раунда →' : 'Дальше →';
    elements.input.removeAttribute('aria-invalid');
    elements.answerResult.textContent = String(result.correctAnswer);
    answerSounds.play(result.isCorrect ? 'correct' : 'incorrect');

    if (result.isCorrect) {
      elements.card.classList.add('is-correct');
      elements.feedback.className = 'feedback correct';
      const record = result.events.includes('new-record') && progress.bestStreak > 1
        ? ` Новый рекорд — ${progress.bestStreak} подряд!` : '';
      elements.feedback.textContent = `Верно! +1 звезда ★${record}`;
      const messages = [];
      if (result.events.includes('level-up')) messages.push(`Уровень ${progress.level}!`);
      if (result.events.includes('grade-up')) messages.push(`Новый статус: ${progress.rewards.grade.name}!`);
      const newBadgeId = result.events.find((event) => event.startsWith('badge:'))?.slice(6);
      const newBadge = progress.rewards.badges.find((badge) => badge.id === newBadgeId);
      if (newBadge) messages.push(`Новый значок: ${newBadge.name}!`);
      if (result.events.includes('streak-10')) messages.push('10 верных подряд!');
      else if (result.events.includes('streak-5')) messages.push('5 верных подряд!');
      if (messages.length) showCelebration(messages.join(' '), result.events.includes('level-up') || result.events.includes('grade-up'));
    } else {
      elements.card.classList.add('is-incorrect');
      elements.feedback.className = 'feedback incorrect';
      elements.feedback.textContent = `Почти! Правильный ответ: ${result.correctAnswer}`;
    }
    renderProgress();
    if (result.isCorrect) loadLeaderboard();
    if (pendingRound) {
      setText('#round-number', pendingRound.number);
      setText('#round-count', '10 из 10');
      $('#round-progress').style.width = '100%';
    }
    elements.check.focus({ preventScroll: true });
  } catch (error) {
    submitting = false;
    elements.input.disabled = false;
    elements.check.disabled = false;
    elements.check.textContent = 'Попробовать снова';
    elements.feedback.className = 'feedback validation';
    elements.feedback.textContent = error.message;
    if (error.status === 401) {
      removeSession(activeToken);
      renderKnownPlayers();
      showScreen('login');
    }
  }
}

function openProgress() {
  renderProgress();
  if (!elements.progressDialog.open) elements.progressDialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

async function createPlayer(event) {
  event.preventDefault();
  const name = elements.playerName.value.trim();
  const local = sessions.sessions.find((item) => item.name.localeCompare(name, 'ru', { sensitivity: 'accent' }) === 0);
  if (local) {
    await activateSession(local.token);
    return;
  }
  elements.playerSubmit.disabled = true;
  elements.playerSubmit.textContent = 'Ищу игрока…';
  showSuggestions();
  try {
    let payload;
    let claimedLegacy = null;
    try {
      payload = await api('/api/sessions', {
        method: 'POST', auth: false,
        body: JSON.stringify({ name }),
      });
    } catch (error) {
      if (error.status !== 404 || error.payload?.error !== 'player_not_found') throw error;
      elements.playerSubmit.textContent = 'Создаю игрока…';
      claimedLegacy = elements.claimLegacy.checked ? legacyProgress() : null;
      payload = await api('/api/profiles', {
        method: 'POST', auth: false,
        body: JSON.stringify({ name, existingProgress: claimedLegacy }),
      });
    }
    activeToken = payload.sessionToken;
    profile = payload.profile;
    progress = payload.progress;
    rememberSession(profile.name, activeToken);
    if (claimedLegacy) {
      localStorage.removeItem(LEGACY_PROGRESS_KEY);
      elements.legacyOption.hidden = true;
      elements.claimLegacy.checked = false;
    }
    elements.playerName.value = '';
    renderProgress();
    showScreen('welcome');
    await loadLeaderboard();
  } catch (error) {
    setNameFeedback(error.message, true);
    if (error.payload?.suggestions) showSuggestions(error.payload.suggestions);
    elements.playerName.focus();
  } finally {
    elements.playerSubmit.disabled = false;
    elements.playerSubmit.textContent = 'Продолжить →';
  }
}

elements.playerForm.addEventListener('submit', createPlayer);
elements.playerName.addEventListener('input', () => { setNameFeedback('Новое имя создаст игрока, знакомое — откроет прогресс'); showSuggestions(); });
elements.start.addEventListener('click', startTraining);
elements.home.addEventListener('click', () => { if (profile) showScreen('welcome'); });
elements.switchPlayer.addEventListener('click', () => {
  closeDialog(elements.progressDialog);
  closeDialog(elements.rewardsDialog);
  leaderboard = null;
  renderKnownPlayers();
  showScreen('login');
});
elements.progressButton.addEventListener('click', openProgress);
elements.rewardsButton.addEventListener('click', async () => {
  setText('#total-players', 'загружаю…');
  if (!elements.rewardsDialog.open) elements.rewardsDialog.showModal();
  await loadLeaderboard();
});
elements.closeRewards.addEventListener('click', () => closeDialog(elements.rewardsDialog));
elements.rewardsDialog.addEventListener('click', (event) => {
  if (event.target === elements.rewardsDialog) closeDialog(elements.rewardsDialog);
});
elements.closeProgress.addEventListener('click', () => closeDialog(elements.progressDialog));
elements.progressDialog.addEventListener('click', (event) => { if (event.target === elements.progressDialog) closeDialog(elements.progressDialog); });
elements.form.addEventListener('submit', (event) => { event.preventDefault(); submitAnswer(); });
elements.input.addEventListener('input', () => {
  elements.input.removeAttribute('aria-invalid');
  if (!answered && elements.feedback.classList.contains('validation')) {
    elements.feedback.className = 'feedback';
    elements.feedback.textContent = 'Введи число';
  }
});
elements.backToWelcome.addEventListener('click', () => showScreen('welcome'));
elements.nextRound.addEventListener('click', () => {
  closeDialog(elements.roundDialog);
  pendingRound = null;
  showScreen('trainer');
  renderProgress();
  nextProblem();
});
elements.roundDialog.addEventListener('cancel', (event) => event.preventDefault());

elements.resetProgress.addEventListener('click', () => { closeDialog(elements.progressDialog); elements.confirmDialog.showModal(); });
elements.cancelReset.addEventListener('click', () => { closeDialog(elements.confirmDialog); openProgress(); });
elements.confirmReset.addEventListener('click', async () => {
  elements.confirmReset.disabled = true;
  try {
    const payload = await api('/api/progress/reset', { method: 'POST', body: '{}' });
    profile = payload.profile;
    progress = payload.progress;
    renderProgress();
    await loadLeaderboard();
    closeDialog(elements.confirmDialog);
    showScreen('welcome');
    showCelebration('Готово. Начнём новое приключение!');
  } catch (error) {
    closeDialog(elements.confirmDialog);
    showCelebration(error.message);
  } finally {
    elements.confirmReset.disabled = false;
  }
});
elements.confirmDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(elements.confirmDialog); openProgress(); });

async function init() {
  renderKnownPlayers();
  elements.legacyOption.hidden = !legacyProgress();
  if (activeToken) await activateSession(activeToken);
  else showScreen('login');
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
