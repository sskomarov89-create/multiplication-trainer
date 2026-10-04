export const ANSWER_SOUND_PATTERNS = Object.freeze({
  correct: Object.freeze([
    { frequency: 659.25, start: 0, duration: 0.22, gain: 0.055, type: 'sine' },
    { frequency: 783.99, start: 0.13, duration: 0.28, gain: 0.06, type: 'sine' },
    { frequency: 1046.5, start: 0.27, duration: 0.38, gain: 0.065, type: 'sine' },
  ]),
  incorrect: Object.freeze([
    { frequency: 329.63, start: 0, duration: 0.16, gain: 0.045, type: 'triangle' },
    { frequency: 246.94, start: 0.17, duration: 0.2, gain: 0.04, type: 'triangle' },
  ]),
});

export function createAnswerSoundPlayer(AudioContextClass) {
  let context = null;

  function prepare() {
    if (!AudioContextClass) return null;
    try {
      context ??= new AudioContextClass();
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    } catch {
      return null;
    }
  }

  function play(kind) {
    const audioContext = prepare();
    const pattern = ANSWER_SOUND_PATTERNS[kind];
    if (!audioContext || !pattern) return;

    const baseTime = audioContext.currentTime + 0.01;
    for (const tone of pattern) {
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const startsAt = baseTime + tone.start;
      const endsAt = startsAt + tone.duration;

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
      volume.gain.setValueAtTime(tone.gain, startsAt);
      volume.gain.exponentialRampToValueAtTime(0.001, endsAt);
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.02);
    }
  }

  return { prepare, play };
}
