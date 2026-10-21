// Character voices: no words, just babble, the way old games gave their
// characters a voice. Each character has its own pitch, waveform, pace,
// melodic range, vowel colour and wobble. A line of chat becomes a run of
// syllables (the same text always babbles the same way); "?" rises at the
// end and "!" comes out louder and higher.

import { audioContext, effectsBus } from "./sfx";

interface Voice {
  pitch: number; // Hz, the middle of the voice
  wave: OscillatorType | number; // a number is a pulse wave's duty cycle
  pace: number; // syllables per second
  range: number; // semitones the pitch wanders
  vowel: number; // centre of the vowel filter, Hz
  vibrato: number; // cents
  growl?: boolean; // a rough tremolo
  glide?: number; // semitones each syllable slides (+ up, - down)
}

// By colour, in the palette's order (sprites.ts CHARACTERS).
const VOICES: Record<string, Voice> = {
  "#e04848": { pitch: 105, wave: 0.5, pace: 7, range: 4, vowel: 650, vibrato: 0, growl: true }, // the Colonel
  "#3f7fe0": { pitch: 135, wave: 0.25, pace: 8, range: 5, vowel: 800, vibrato: 10, glide: 1 }, // the Gentleman
  "#3fae5a": { pitch: 230, wave: "triangle", pace: 6, range: 5, vowel: 900, vibrato: 45 }, // the Widow
  "#e0c33f": { pitch: 180, wave: 0.33, pace: 8, range: 11, vowel: 1000, vibrato: 20, glide: 3 }, // the Poet
  "#9b5de5": { pitch: 150, wave: 0.125, pace: 11, range: 4, vowel: 1300, vibrato: 0 }, // the Physician
  "#f08a2c": { pitch: 265, wave: 0.5, pace: 11, range: 3, vowel: 1100, vibrato: 0 }, // the Governess
  "#e8e4dc": { pitch: 112, wave: "triangle", pace: 5, range: 3, vowel: 600, vibrato: 15 }, // the Clergyman
  "#f06fb0": { pitch: 320, wave: 0.25, pace: 11, range: 6, vowel: 1200, vibrato: 10, glide: 2 }, // the Heiress
  "#2fb8b0": { pitch: 205, wave: 0.125, pace: 14, range: 9, vowel: 1500, vibrato: 0 }, // the Inventor
  "#9a6a3a": { pitch: 160, wave: 0.5, pace: 12, range: 5, vowel: 850, vibrato: 0, glide: -2 }, // the Gambler
};

const pulses = new Map<number, PeriodicWave>();
function pulse(a: AudioContext, duty: number) {
  let w = pulses.get(duty);
  if (!w) {
    const n = 48;
    const real = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    w = a.createPeriodicWave(real, new Float32Array(n));
    pulses.set(duty, w);
  }
  return w;
}

let noise: AudioBuffer | null = null;

// A small hash, so a given text always babbles the same.
function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export interface SayOptions {
  pan?: number; // -1 left to 1 right
  volume?: number; // 0 to 1
  ghost?: boolean; // hollow and echoing
  syllables?: number; // instead of counting from the text
}

// say babbles a line in a character's voice.
export function say(color: string, text: string, opts: SayOptions = {}) {
  const a = audioContext();
  const v = VOICES[color.toLowerCase()];
  if (!a || !v) return;
  const r = seeded(color + text);
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
  const count = opts.syllables ?? Math.max(2, Math.min(16, Math.round(letters / 2.5)));
  const ask = text.trim().endsWith("?");
  const shout = text.trim().endsWith("!");
  const vol = (opts.volume ?? 1) * (shout ? 1.3 : 1) * 0.11;

  // Everything goes through one gain and panner; ghosts also get an echo.
  const out = a.createGain();
  out.gain.value = vol;
  const pan = a.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
  out.connect(pan).connect(effectsBus(a));
  if (opts.ghost) {
    const echo = a.createDelay(1);
    echo.delayTime.value = 0.18;
    const fb = a.createGain();
    fb.gain.value = 0.45;
    const wet = a.createBiquadFilter();
    wet.type = "lowpass";
    wet.frequency.value = 1400;
    out.connect(echo).connect(wet).connect(fb).connect(echo);
    wet.connect(pan);
  }

  const step = 1 / v.pace;
  let t = a.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // A word gap now and then.
    if (i > 0 && r() < 0.18) t += step * 0.6;
    let semis = (r() - 0.5) * v.range;
    if (last && ask) semis += 5;
    if (last && !ask) semis -= 2;
    if (shout) semis += 3;
    const f = v.pitch * 2 ** (semis / 12) * (opts.ghost ? 1.12 : 1);
    const len = step * (0.65 + r() * 0.3) * (last ? 1.5 : 1);
    syllable(a, out, v, t, len, f, r, !!opts.ghost);
    t += step;
  }
}

function syllable(a: AudioContext, out: AudioNode, v: Voice, t: number, len: number, f: number, r: () => number, ghost: boolean) {
  const o = a.createOscillator();
  if (typeof v.wave === "number") o.setPeriodicWave(pulse(a, v.wave));
  else o.type = v.wave;
  o.frequency.setValueAtTime(f, t);
  if (v.glide) o.frequency.linearRampToValueAtTime(f * 2 ** (v.glide / 12), t + len);
  if (v.vibrato || ghost) {
    const lfo = a.createOscillator();
    lfo.frequency.value = ghost ? 4 : 6.5;
    const depth = a.createGain();
    depth.gain.value = ghost ? 40 : v.vibrato;
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
  }
  // The vowel: a band of the tone, moved a little each syllable.
  const vowel = a.createBiquadFilter();
  vowel.type = "bandpass";
  vowel.frequency.value = v.vowel * (0.7 + r() * 0.7);
  vowel.Q.value = 1.6;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 0.012);
  g.gain.setTargetAtTime(0.0001, t + len * 0.6, len * 0.25);
  if (v.growl) {
    const trem = a.createOscillator();
    trem.frequency.value = 28;
    const tg = a.createGain();
    tg.gain.value = 0.35;
    trem.connect(tg).connect(g.gain);
    trem.start(t);
    trem.stop(t + len + 0.05);
  }
  o.connect(vowel).connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.1);

  // Some syllables start with a consonant: a tiny tick of noise.
  if (r() < 0.55) {
    if (!noise) {
      noise = a.createBuffer(1, a.sampleRate / 4, a.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = a.createBufferSource();
    n.buffer = noise;
    const hp = a.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500 + r() * 3000;
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    n.connect(hp).connect(ng).connect(out);
    n.start(t, r() * 0.2);
    n.stop(t + 0.04);
  }
}
