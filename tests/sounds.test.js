import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ANSWER_SOUND_PATTERNS, createAnswerSoundPlayer } from '../src/sounds.js';

class FakeAudioParam {
  constructor() { this.events = []; }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.currentTime = 1;
    this.state = 'running';
    this.destination = {};
    this.oscillators = [];
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = {
      frequency: new FakeAudioParam(),
      type: '',
      connect() {},
      startTime: null,
      stopTime: null,
      start(time) { this.startTime = time; },
      stop(time) { this.stopTime = time; },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return { gain: new FakeAudioParam(), connect() {} };
  }
}

describe('answer feedback sounds', () => {
  test('correct answer uses a short ascending bell pattern', () => {
    const pattern = ANSWER_SOUND_PATTERNS.correct;
    assert.equal(pattern.length, 3);
    assert.ok(pattern[0].frequency < pattern[1].frequency);
    assert.ok(pattern[1].frequency < pattern[2].frequency);
    assert.ok(pattern.every((tone) => tone.type === 'sine' && tone.duration <= 0.4));
  });

  test('incorrect answer uses a brief descending warning pattern', () => {
    const pattern = ANSWER_SOUND_PATTERNS.incorrect;
    assert.equal(pattern.length, 2);
    assert.ok(pattern[0].frequency > pattern[1].frequency);
    assert.ok(pattern.every((tone) => tone.duration <= 0.25));
  });

  test('player schedules the selected pattern and reuses one audio context', () => {
    FakeAudioContext.instances = [];
    const player = createAnswerSoundPlayer(FakeAudioContext);

    player.prepare();
    player.play('correct');
    player.play('incorrect');

    assert.equal(FakeAudioContext.instances.length, 1);
    assert.equal(
      FakeAudioContext.instances[0].oscillators.length,
      ANSWER_SOUND_PATTERNS.correct.length + ANSWER_SOUND_PATTERNS.incorrect.length,
    );
  });

  test('player is silent rather than failing when Web Audio is unavailable', () => {
    const player = createAnswerSoundPlayer(undefined);
    assert.doesNotThrow(() => {
      player.prepare();
      player.play('correct');
    });
  });
});
