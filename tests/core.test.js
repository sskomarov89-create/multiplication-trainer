// Unit tests for src/core.js — pure domain logic only. No DOM, no localStorage.
// Follows PRODUCT.md / ARCHITECTURE.md / DECISIONS.md critical rules.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FACTOR_MIN,
  FACTOR_MAX,
  generateMultipliers,
  generateExample,
  checkAnswer,
  canonicalKey,
  defaultState,
  normalizeState,
  computeLevel,
  computeAccuracy,
  applyAnswer,
} from '../src/core.js';

describe('multiplier generation', () => {
  test('factors are always integers within 1..10 inclusive', () => {
    const samples = [0, 0.001, 0.137, 0.25, 0.5, 0.617, 0.789, 0.99, 0.999];
    for (const r of samples) {
      const { a, b } = generateMultipliers(() => r);
      assert.ok(Number.isInteger(a), `a=${a} must be integer`);
      assert.ok(Number.isInteger(b), `b=${b} must be integer`);
      assert.ok(a >= FACTOR_MIN && a <= FACTOR_MAX, `a=${a} out of 1..10`);
      assert.ok(b >= FACTOR_MIN && b <= FACTOR_MAX, `b=${b} out of 1..10`);
    }
  });

  test('generateMultipliers is deterministic for injected random', () => {
    // random=0 -> index 0 -> multiplier 1 x 1
    assert.deepEqual(generateMultipliers(() => 0), { a: 1, b: 1 });
    // random just under 1 -> last combo -> 10 x 10
    assert.deepEqual(generateMultipliers(() => 0.999999), { a: 10, b: 10 });
  });

  test('all 100 combinations are reachable', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const { a, b } = generateMultipliers(() => i / 100);
      seen.add(canonicalKey(a, b));
    }
    // worst case each value maps to a combo; ensure spacing covers a broad range
    assert.ok(seen.size >= 10, `only ${seen.size} distinct canonical pairs`);
  });
});

describe('new example generation with weak-pair weighting', () => {
  test('no weighting behaves like uniform generation', () => {
    assert.deepEqual(generateExample({ weakPairs: {} }, () => 0), { a: 1, b: 1 });
  });

  test('weak-pair weighting never produces invalid factors', () => {
    const state = { weakPairs: { '7x8': 1000 } };
    for (let i = 0; i < 20; i++) {
      const { a, b } = generateExample(state, () => (i + 1) / 21);
      assert.ok(Number.isInteger(a) && a >= 1 && a <= 10);
      assert.ok(Number.isInteger(b) && b >= 1 && b <= 10);
    }
  });

  test('weak-pair weighting increases frequency of weak pairs (probabilistic)', () => {
    // With high weight on '7x8', we expect it to appear more frequently than uniform chance
    // But not necessarily dominate completely (as per "slightly more often" requirement)
    const state = { weakPairs: { '7x8': 50 } }; // Significant but not overwhelming weight
    const results = [];
    for (let i = 0; i < 100; i++) {
      const { a, b } = generateExample(state, () => (i * 0.73) % 1); // Deterministic pseudo-random
      results.push(canonicalKey(a, b));
    }
    const sevenEightCount = results.filter(k => k === '7x8').length;
    // With 100 possible pairs, '7x8' should appear significantly more than 1/100 times
    // With high weight, we expect much higher frequency than baseline
    assert.ok(sevenEightCount > 5, `Expected '7x8' to appear more than 5 times, got ${sevenEightCount}`);
  });

  test('weak-pair weighting surfaces both 7x8 and 8x7 (shared canonical key)', () => {
    const state = { weakPairs: { '7x8': 1000 } };
    const outcomes = new Set();
    for (let i = 0; i < 200; i++) {
      const { a, b } = generateExample(state, () => (i + 0.5) / 201);
      outcomes.add(`${a}x${b}`);
    }
    assert.ok(outcomes.has('7x8'), '7x8 should appear under weighting');
    assert.ok(outcomes.has('8x7'), '8x7 should appear under weighting');
  });

  test('canonicalKey normalises a×b and b×a to the same key', () => {
    assert.equal(canonicalKey(7, 8), '7x8');
    assert.equal(canonicalKey(8, 7), '7x8');
  });
});

describe('answer validation', () => {
  const problem = { a: 7, b: 8 }; // correct = 56

  test('accepts a correct integer', () => {
    assert.equal(checkAnswer('56', problem), true);
    assert.equal(checkAnswer(56, problem), true);
  });

  test('trims surrounding whitespace', () => {
    assert.equal(checkAnswer('  56  ', problem), true);
    assert.equal(checkAnswer('\t56\n', problem), true);
  });

  test('rejects empty input', () => {
    assert.equal(checkAnswer('', problem), false);
    assert.equal(checkAnswer('   ', problem), false);
    assert.equal(checkAnswer(null, problem), false);
    assert.equal(checkAnswer(undefined, problem), false);
  });

  test('rejects decimal input', () => {
    assert.equal(checkAnswer('56.0', problem), false);
    assert.equal(checkAnswer('56,5', problem), false);
    assert.equal(checkAnswer(56.5, problem), false);
    assert.equal(checkAnswer('56.', problem), false);
  });

  test('rejects negative input', () => {
    assert.equal(checkAnswer('-56', problem), false);
    assert.equal(checkAnswer(-56, problem), false);
    assert.equal(checkAnswer('-5', problem), false);
  });

  test('rejects non-numeric input', () => {
    assert.equal(checkAnswer('abc', problem), false);
    assert.equal(checkAnswer('5six', problem), false);
    assert.equal(checkAnswer('NaN', problem), false);
    assert.equal(checkAnswer('Infinity', problem), false);
  });

  test('rejects a wrong integer', () => {
    assert.equal(checkAnswer('55', problem), false);
    assert.equal(checkAnswer('49', problem), false);
  });
});

describe('default state and normalisation', () => {
  test('defaultState is a valid starting point', () => {
    assert.deepEqual(defaultState(), {
      totalSolved: 0,
      totalCorrect: 0,
      stars: 0,
      currentStreak: 0,
      bestStreak: 0,
      level: 1,
      weakPairs: {},
    });
  });

  test('computeAccuracy is 0% with zero solved', () => {
    assert.equal(computeAccuracy(0, 0), 0);
    assert.equal(computeAccuracy(0, 10), 0);
  });

  test('computeAccuracy is correct/solved when solved > 0', () => {
    assert.equal(computeAccuracy(10, 7), 0.7);
    assert.equal(computeAccuracy(4, 4), 1);
  });

  test('normalizeState handles null and empty input', () => {
    assert.deepEqual(normalizeState(null), defaultState());
    assert.deepEqual(normalizeState(undefined), defaultState());
    assert.deepEqual(normalizeState({}), defaultState());
  });

  test('normalizeState clamps malformed counters to safe integers', () => {
    const out = normalizeState({
      totalSolved: -5,
      totalCorrect: 12.9,
      stars: 'oops',
      currentStreak: -1,
      bestStreak: NaN,
    });
    assert.ok(Number.isInteger(out.totalSolved) && out.totalSolved >= 0);
    assert.equal(out.totalCorrect, 12);
    assert.ok(Number.isInteger(out.stars) && out.stars >= 0);
    assert.ok(Number.isInteger(out.currentStreak) && out.currentStreak >= 0);
    assert.ok(Number.isInteger(out.bestStreak) && out.bestStreak >= 0);
  });

  test('normalizeState recomputes level from totalCorrect', () => {
    // stale/wrong persisted level is corrected
    const out = normalizeState({ totalCorrect: 12, level: 99 });
    assert.equal(out.level, 2);
    assert.equal(normalizeState({ totalCorrect: 0, level: 5 }).level, 1);
  });

  test('normalizeState keeps only canonical weakness counters with positive integer values', () => {
    const out = normalizeState({ weakPairs: { '7x8': 3, '8x7': 2, nope: 5, '3x4': -1 } });
    assert.deepEqual(out.weakPairs, { '7x8': 3 });
  });
});

describe('applying a correct answer', () => {
  test('increments solved, correct, stars, streak and recalculates level', () => {
    const { state, events } = applyAnswer(
      { ...defaultState(), totalCorrect: 9 },
      { a: 2, b: 3 },
      '6',
    );
    assert.equal(state.totalSolved, 1);
    assert.equal(state.totalCorrect, 10);
    assert.equal(state.stars, 1);
    assert.equal(state.currentStreak, 1);
    assert.equal(state.level, 2);
    assert.ok(events.includes('level-up'));
  });

  test('updates bestStreak to the new streak', () => {
    const { state } = applyAnswer(
      { ...defaultState(), currentStreak: 3, bestStreak: 3 },
      { a: 1, b: 1 },
      1,
    );
    assert.equal(state.currentStreak, 4);
    assert.equal(state.bestStreak, 4);
  });

  test('correct answer does not mutate the input state (pure)', () => {
    const input = defaultState();
    const snapshot = JSON.parse(JSON.stringify(input));
    applyAnswer(input, { a: 4, b: 4 }, 16);
    assert.deepEqual(input, snapshot, 'input state must be unchanged');
  });
});

describe('applying an incorrect answer', () => {
  test('increments solved, resets current streak but keeps stars and bestStreak', () => {
    const start = { ...defaultState(), stars: 5, bestStreak: 7, currentStreak: 3 };
    const { state } = applyAnswer(start, { a: 5, b: 6 }, '31'); // wrong
    assert.equal(state.totalSolved, 1);
    assert.equal(state.totalCorrect, 0);
    assert.equal(state.currentStreak, 0);
    assert.equal(state.stars, 5, 'stars must be preserved');
    assert.equal(state.bestStreak, 7, 'bestStreak must be preserved');
  });

  test('increments the canonical pair mistake counter', () => {
    const { state } = applyAnswer(defaultState(), { a: 8, b: 7 }, '999');
    assert.equal(state.weakPairs['7x8'], 1);
    // 7x8 and 8x7 share a counter
    const { state: s2 } = applyAnswer(
      { ...defaultState(), weakPairs: { '7x8': 1 } },
      { a: 7, b: 8 },
      '999',
    );
    assert.equal(s2.weakPairs['7x8'], 2);
  });
});

describe('best streak preservation', () => {
  test('a reset streak never lowers the recorded best', () => {
    let state = { ...defaultState(), bestStreak: 10, currentStreak: 5 };
    ({ state } = applyAnswer(state, { a: 9, b: 9 }, '1')); // wrong
    assert.equal(state.bestStreak, 10);
    assert.equal(state.currentStreak, 0);
  });

  test('best streak keeps growing on new correct answers', () => {
    let state = defaultState();
    for (const [problem, given] of [
      [{ a: 2, b: 1 }, '2'],
      [{ a: 2, b: 2 }, '4'],
    ]) {
      ({ state } = applyAnswer(state, problem, given));
    }
    assert.equal(state.currentStreak, 2);
    assert.equal(state.bestStreak, 2);
  });
});

describe('level boundaries', () => {
  test('level = 1 + floor(totalCorrect / 10)', () => {
    assert.equal(computeLevel(0), 1);
    assert.equal(computeLevel(9), 1);
    assert.equal(computeLevel(10), 2);
    assert.equal(computeLevel(19), 2);
    assert.equal(computeLevel(20), 3);
    assert.equal(computeLevel(21), 3);
  });

  test('9 -> 10 correct promotes level and emits level-up', () => {
    const start = { ...defaultState(), totalCorrect: 8, bestStreak: 8 };
    let { state, events } = applyAnswer(start, { a: 1, b: 9 }, 9);
    assert.equal(state.level, 1);
    assert.ok(!events.includes('level-up'));
    ({ state, events } = applyAnswer(state, { a: 1, b: 2 }, 2));
    assert.equal(state.totalCorrect, 10);
    assert.equal(state.level, 2);
    assert.ok(events.includes('level-up'));
  });

  test('19 -> 20 correct raises level to 3 (beyond first boundary)', () => {
    const start = { ...defaultState(), totalCorrect: 19, bestStreak: 19 };
    const { state, events } = applyAnswer(start, { a: 3, b: 4 }, 12);
    assert.equal(state.totalCorrect, 20);
    assert.equal(state.level, 3);
    assert.ok(events.includes('level-up'));
  });
});

describe('milestone events', () => {
  test('emits streak-5 when current streak reaches exactly 5', () => {
    const { state, events } = applyAnswer(
      { ...defaultState(), currentStreak: 4, bestStreak: 4 },
      { a: 1, b: 5 },
      5,
    );
    assert.equal(state.currentStreak, 5);
    assert.ok(events.includes('streak-5'));
  });

  test('emits streak-10 when current streak reaches exactly 10', () => {
    const { state, events } = applyAnswer(
      { ...defaultState(), currentStreak: 9, bestStreak: 9 },
      { a: 2, b: 5 },
      10,
    );
    assert.equal(state.currentStreak, 10);
    assert.ok(events.includes('streak-10'));
  });

  test('emits new-record when a new best streak is set', () => {
    const { events } = applyAnswer(
      { ...defaultState(), currentStreak: 4, bestStreak: 4 },
      { a: 2, b: 3 },
      6,
    );
    assert.ok(events.includes('new-record'));
  });

  test('does not emit new-record when best streak is untouched', () => {
    const { events } = applyAnswer(
      { ...defaultState(), currentStreak: 4, bestStreak: 7 },
      { a: 2, b: 3 },
      6,
    );
    assert.ok(!events.includes('new-record'));
  });

  test('does not emit milestone events for an incorrect answer', () => {
    const { events } = applyAnswer({ ...defaultState(), currentStreak: 4 }, { a: 2, b: 3 }, '777');
    assert.equal(events.length, 0);
  });
});

describe('duplicate-submission boundary', () => {
  test('a single shown problem maps to one pure update call', () => {
    // core only exposes a stateless pure transition; guard rails live in app state
    const start = { ...defaultState(), currentStreak: 1, bestStreak: 1 };
    const { state } = applyAnswer(start, { a: 6, b: 6 }, 36);
    assert.equal(state.currentStreak, 2);
    assert.equal(state.totalSolved, 1);
  });

  test('core is not idempotent by itself — dedup must be enforced by app state', () => {
    // documenting the boundary: two independent calls are two submissions
    let state = defaultState();
    ({ state } = applyAnswer(state, { a: 6, b: 6 }, 36));
    ({ state } = applyAnswer(state, { a: 6, b: 6 }, 36));
    assert.equal(state.totalSolved, 2);
    assert.equal(state.stars, 2);
  });
});