// The opening's sound (scripts/create_intro_sound.py), started with its first
// frame. If decoding takes a moment, playback starts that far into the sound
// so it stays in step with the picture. Without audio the opening stays silent.
const source = "/onboarding/intro/atom-intro.m4a";

let context: AudioContext | undefined;
let decoded: Promise<AudioBuffer | null> | undefined;
let playing: { node: AudioBufferSourceNode; gain: GainNode } | undefined;
let generation = 0;

const load = (audio: AudioContext) =>
  (decoded ??= fetch(source)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((data) => audio.decodeAudioData(data))
    .catch(() => null));

export const introSound = {
  play() {
    introSound.stop(0);
    const token = ++generation;
    const requested = performance.now();
    try {
      context ??= new AudioContext();
    } catch {
      return;
    }
    const audio = context;
    void load(audio).then(async (buffer) => {
      if (!buffer || token !== generation) return;
      await audio.resume().catch(() => undefined);
      const offset = (performance.now() - requested) / 1000;
      if (token !== generation || offset >= buffer.duration) return;
      const gain = audio.createGain();
      const node = audio.createBufferSource();
      node.buffer = buffer;
      node.connect(gain).connect(audio.destination);
      node.start(0, offset);
      playing = { node, gain };
    });
  },
  /** Fades the sound out so a skip never cuts it off abruptly. */
  stop(fade = 0.25) {
    generation += 1;
    if (!playing || !context) return;
    const { node, gain } = playing;
    playing = undefined;
    const now = context.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
    node.stop(now + fade + 0.02);
  },
};
