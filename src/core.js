export const FACTOR_MIN = 1;
export const FACTOR_MAX = 10;

const FACTOR_COUNT = FACTOR_MAX - FACTOR_MIN + 1;
const MAX_WEAK_BONUS = 4;

const safeCounter = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const clampRandom = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(number, 1 - Number.EPSILON);
};

export function canonicalKey(a, b) {
  const first = Math.min(a, b);
  const second = Math.max(a, b);
  return `${first}x${second}`;
}

export function generateMultipliers(random = Math.random) {
  const index = Math.floor(clampRandom(random()) * FACTOR_COUNT * FACTOR_COUNT);
  return {
    a: FACTOR_MIN + Math.floor(index / FACTOR_COUNT),
    b: FACTOR_MIN + (index % FACTOR_COUNT),
  };
}

export function generateExample(state = {}, random = Math.random) {
  const weakPairs = state?.weakPairs && typeof state.weakPairs === 'object' ? state.weakPairs : {};
  const candidates = [];
  let totalWeight = 0;

  for (let a = FACTOR_MIN; a <= FACTOR_MAX; a += 1) {
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b += 1) {
      const bonus = Math.min(MAX_WEAK_BONUS, safeCounter(weakPairs[canonicalKey(a, b)]));
      const weight = 1 + bonus;
      totalWeight += weight;
      candidates.push({ a, b, weight });
    }
  }

  let target = clampRandom(random()) * totalWeight;
  for (const candidate of candidates) {
    target -= candidate.weight;
    if (target < 0) return { a: candidate.a, b: candidate.b };
  }

  return { a: FACTOR_MAX, b: FACTOR_MAX };
}

export function checkAnswer(answer, problem) {
  if (!problem || !Number.isInteger(problem.a) || !Number.isInteger(problem.b)) return false;

  if (typeof answer === 'number') {
    return Number.isInteger(answer) && answer >= 0 && answer === problem.a * problem.b;
  }

  if (typeof answer !== 'string') return false;
  const trimmed = answer.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed) === problem.a * problem.b;
}

export function computeLevel(totalCorrect) {
  return 1 + Math.floor(safeCounter(totalCorrect) / 10);
}

export function computeAccuracy(totalSolved, totalCorrect) {
  const solved = safeCounter(totalSolved);
  if (solved === 0) return 0;
  return Math.min(1, safeCounter(totalCorrect) / solved);
}

export function defaultState() {
  return {
    totalSolved: 0,
    totalCorrect: 0,
    stars: 0,
    currentStreak: 0,
    bestStreak: 0,
    level: 1,
    weakPairs: {},
  };
}

function normalizeWeakPairs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};

  for (const [key, rawCount] of Object.entries(value)) {
    const match = /^(10|[1-9])x(10|[1-9])$/.exec(key);
    if (!match) continue;
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a > b || canonicalKey(a, b) !== key) continue;
    const count = safeCounter(rawCount);
    if (count > 0) result[key] = count;
  }

  return result;
}

export function normalizeState(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const totalCorrect = safeCounter(input.totalCorrect);
  const totalSolved = safeCounter(input.totalSolved);
  const currentStreak = safeCounter(input.currentStreak);
  const bestStreak = Math.max(safeCounter(input.bestStreak), currentStreak);

  return {
    totalSolved,
    totalCorrect,
    stars: safeCounter(input.stars),
    currentStreak,
    bestStreak,
    level: computeLevel(totalCorrect),
    weakPairs: normalizeWeakPairs(input.weakPairs),
  };
}

export function applyAnswer(previousState, problem, answer) {
  const state = normalizeState(previousState);
  const events = [];
  const isCorrect = checkAnswer(answer, problem);
  const next = {
    ...state,
    weakPairs: { ...state.weakPairs },
    totalSolved: state.totalSolved + 1,
  };

  if (!isCorrect) {
    next.currentStreak = 0;
    const key = canonicalKey(problem.a, problem.b);
    next.weakPairs[key] = (next.weakPairs[key] ?? 0) + 1;
    return { state: next, isCorrect, events };
  }

  const oldLevel = state.level;
  next.totalCorrect += 1;
  next.stars += 1;
  next.currentStreak += 1;
  next.level = computeLevel(next.totalCorrect);

  if (next.currentStreak > state.bestStreak) {
    next.bestStreak = next.currentStreak;
    events.push('new-record');
  }
  if (next.currentStreak === 5) events.push('streak-5');
  if (next.currentStreak === 10) events.push('streak-10');
  if (next.level > oldLevel) events.push('level-up');

  return { state: next, isCorrect, events };
}
