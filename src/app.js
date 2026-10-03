import {
  applyAnswer,
  computeAccuracy,
  defaultState,
  generateExample,
  normalizeState,
} from './core.js';

const STORAGE_KEY = 'umnozhayka.progress.v1';
const $ = (selector) => document.querySelector(selector);

const elements = {
  welcome: $('#welcome-screen'),
  trainer: $('#trainer-screen'),
  home: $('#home-button'),
  start: $('#start-button'),
  progressButton: $('#progress-button'),
  progressDialog: $('#progress-dialog'),
  closeProgress: $('#close-progress'),
  form: $('#answer-form'),
  input: $('#answer-input'),
  feedback: $('#feedback'),
  check: $('#check-button'),
  card: $('#practice-card'),
  factorA: $('#factor-a'),
  factorB: $('#factor-b'),
  restart: $('#restart-button'),
  celebration: $('#celebration'),
  celebrationText: $('#celebration-text'),
  resetProgress: $('#reset-progress'),
  confirmDialog: $('#confirm-dialog'),
  cancelReset: $('#cancel-reset'),
  confirmReset: $('#confirm-reset'),
};

let progress = loadProgress();
let problem = null;
let answered = false;
let celebrationTimer = null;

function loadProgress() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizeState(stored ? JSON.parse(stored) : null);
  } catch {
    return defaultState();
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Training remains usable when private storage is unavailable.
  }
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value);
}

function renderProgress() {
  const accuracy = Math.round(computeAccuracy(progress.totalSolved, progress.totalCorrect) * 100);
  setText('#welcome-level', progress.level);
  setText('#welcome-stars', progress.stars);
  setText('#level-value', progress.level);
  setText('#stars-value', progress.stars);
  setText('#streak-value', progress.currentStreak);
  setText('#progress-level', progress.level);
  setText('#progress-stars', progress.stars);
  setText('#progress-best', progress.bestStreak);
  setText('#progress-accuracy', `${accuracy}%`);
  setText('#progress-solved', progress.totalSolved);
}

function showScreen(name) {
  const training = name === 'trainer';
  elements.welcome.hidden = training;
  elements.trainer.hidden = !training;
  if (!training) renderProgress();
}

function resetProblemUi() {
  answered = false;
  elements.input.disabled = false;
  elements.input.value = '';
  elements.input.removeAttribute('aria-invalid');
  elements.feedback.className = 'feedback';
  elements.feedback.textContent = 'Введи число';
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

function celebrationMessage(events) {
  const messages = [];
  if (events.includes('level-up')) messages.push(`Уровень ${progress.level}!`);
  if (events.includes('streak-10')) messages.push('10 верных подряд!');
  else if (events.includes('streak-5')) messages.push('5 верных подряд!');
  return messages.join(' ');
}

function submitAnswer() {
  if (answered) {
    nextProblem();
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

  const result = applyAnswer(progress, problem, value);
  progress = result.state;
  answered = true;
  elements.input.disabled = true;
  elements.check.textContent = 'Дальше →';
  elements.input.removeAttribute('aria-invalid');

  if (result.isCorrect) {
    elements.card.classList.add('is-correct');
    elements.feedback.className = 'feedback correct';
    const record = result.events.includes('new-record') && progress.bestStreak > 1
      ? ` Новый рекорд — ${progress.bestStreak} подряд!`
      : '';
    elements.feedback.textContent = `Верно! +1 звезда ★${record}`;
    const message = celebrationMessage(result.events);
    if (message) showCelebration(message, result.events.includes('level-up'));
  } else {
    elements.card.classList.add('is-incorrect');
    elements.feedback.className = 'feedback incorrect';
    elements.feedback.textContent = `Почти! Правильный ответ: ${problem.a * problem.b}`;
  }

  saveProgress();
  renderProgress();
  elements.check.focus({ preventScroll: true });
}

function openProgress() {
  renderProgress();
  if (!elements.progressDialog.open) elements.progressDialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

elements.start.addEventListener('click', startTraining);
elements.home.addEventListener('click', () => showScreen('welcome'));
elements.progressButton.addEventListener('click', openProgress);
elements.closeProgress.addEventListener('click', () => closeDialog(elements.progressDialog));
elements.progressDialog.addEventListener('click', (event) => {
  if (event.target === elements.progressDialog) closeDialog(elements.progressDialog);
});
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAnswer();
});
elements.input.addEventListener('input', () => {
  elements.input.removeAttribute('aria-invalid');
  if (!answered && elements.feedback.classList.contains('validation')) {
    elements.feedback.className = 'feedback';
    elements.feedback.textContent = 'Введи число';
  }
});
elements.restart.addEventListener('click', () => {
  nextProblem();
  showCelebration('Новая тренировка! Прогресс сохранён.');
});

elements.resetProgress.addEventListener('click', () => {
  closeDialog(elements.progressDialog);
  elements.confirmDialog.showModal();
});
elements.cancelReset.addEventListener('click', () => {
  closeDialog(elements.confirmDialog);
  openProgress();
});
elements.confirmReset.addEventListener('click', () => {
  progress = defaultState();
  saveProgress();
  renderProgress();
  closeDialog(elements.confirmDialog);
  showScreen('welcome');
  showCelebration('Готово. Начнём новое приключение!');
});

elements.confirmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDialog(elements.confirmDialog);
  openProgress();
});

renderProgress();
showScreen('welcome');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
