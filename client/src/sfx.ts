// Small synthesized sounds, so the prototype needs no audio assets.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Volumes from the settings page, each 0 to 1, remembered per browser.
export interface Volumes {
  master: number;
  music: number;
  effects: number;
}

let volumes: Volumes = { master: 0.8, music: 0.7, effects: 1 };
try {
  volumes = { ...volumes, ...JSON.parse(localStorage.getItem("lastcandle:volumes") ?? "{}") };
} catch {
  // Keep the defaults if storage is unavailable or holds something odd.
}

// Every sound goes through a channel (effects or music) into the master.
let buses: { master: GainNode; music: GainNode; effects: GainNode } | null = null;

function bus(a: AudioContext) {
  if (!buses) {
    buses = { master: a.createGain(), music: a.createGain(), effects: a.createGain() };
    buses.master.connect(a.destination);
    buses.music.connect(buses.master);
    buses.effects.connect(buses.master);
    applyVolumes();
  }
  return buses;
}

function applyVolumes() {
  if (!buses) return;
  // Squared, so the sliders feel even to the ear.
  buses.master.gain.value = volumes.master ** 2;
  buses.music.gain.value = volumes.music ** 2;
  buses.effects.gain.value = volumes.effects ** 2;
}

export function getVolumes(): Volumes {
  return { ...volumes };
}

export function setVolumes(v: Partial<Volumes>) {
  volumes = { ...volumes, ...v };
  try {
    localStorage.setItem("lastcandle:volumes", JSON.stringify(volumes));
  } catch {
    // Not remembered, but still applied.
  }
  applyVolumes();
}

// The effects channel, for voice.ts.
export function effectsBus(a: AudioContext) {
  return bus(a).effects;
}

// The music channel, for music.ts.
export function musicBus(a: AudioContext) {
  return bus(a).music;
}

// The page's one AudioContext, shared with the music (music.ts).
export function audioContext() {
  return audio();
}

function noiseBuffer(a: AudioContext, seconds: number) {
  const buf = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // Brown noise: soft and rain-like.
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function out(a: AudioContext, pan: number, gain: number) {
  const g = a.createGain();
  g.gain.value = gain;
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(bus(a).effects);
  return g;
}

export function knock(pan: number, volume: number) {
  const a = audio();
  if (!a) return;
  for (const delay of [0, 0.22, 0.44]) {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, a.currentTime + delay);
    o.frequency.exponentialRampToValueAtTime(50, a.currentTime + delay + 0.12);
    const g = out(a, pan, 0);
    g.gain.setValueAtTime(0.6 * volume, a.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + delay + 0.15);
    o.connect(g);
    o.start(a.currentTime + delay);
    o.stop(a.currentTime + delay + 0.2);
  }
}

export function bell() {
  const a = audio();
  if (!a) return;
  for (const [f, v] of [[660, 0.25], [990, 0.12], [1320, 0.06]]) {
    const o = a.createOscillator();
    o.frequency.value = f;
    const g = out(a, 0, 0);
    g.gain.setValueAtTime(v, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 2.5);
    o.connect(g);
    o.start();
    o.stop(a.currentTime + 2.6);
  }
}

export function thud() {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.frequency.setValueAtTime(90, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, a.currentTime + 0.4);
  const g = out(a, 0, 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5);
  o.connect(g);
  o.start();
  o.stop(a.currentTime + 0.5);
}

export function wind() {
  const a = audio();
  if (!a) return;
  const s = a.createBufferSource();
  s.buffer = noiseBuffer(a, 2);
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(300, a.currentTime);
  f.frequency.linearRampToValueAtTime(900, a.currentTime + 1);
  f.frequency.linearRampToValueAtTime(250, a.currentTime + 2);
  const g = out(a, 0, 0.0001);
  g.gain.exponentialRampToValueAtTime(0.5, a.currentTime + 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 2);
  s.connect(f).connect(g);
  s.start();
}

// Thunder for the landing storm. It only plays once the page already has
// sound (after the first click), so it never starts audio on its own.
export function thunder(volume: number) {
  if (!ctx || ctx.state !== "running") return;
  const a = ctx;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, 3);
  const low = a.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 160;
  const g = out(a, Math.random() * 1.2 - 0.6, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
  src.connect(low).connect(g);
  src.start(t);
  src.stop(t + 3);
}

// White noise for short, crisp sounds, made once.
let white: AudioBuffer | null = null;
function whiteNoise(a: AudioContext) {
  if (!white) {
    white = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return white;
}

// A burst of filtered noise starting `at` seconds from now.
function hiss(a: AudioContext, at: number, length: number, gain: number, pan: number, type: BiquadFilterType, freq: number, toFreq = freq) {
  const t = a.currentTime + at;
  const src = a.createBufferSource();
  src.buffer = whiteNoise(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (toFreq !== freq) f.frequency.exponentialRampToValueAtTime(toFreq, t + length);
  const g = out(a, pan, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, length / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(f).connect(g);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.05);
}

// A low knock that drops in pitch: a heel, a body, a fall.
function thump(a: AudioContext, at: number, from: number, to: number, length: number, gain: number, pan: number) {
  const t = a.currentTime + at;
  const o = a.createOscillator();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + length);
  const g = out(a, pan, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g);
  o.start(t);
  o.stop(t + length + 0.05);
}

export type Surface = "wood" | "stone";

// One footstep: a soft heel thump and a scuff, duller on wood and sharper
// on stone. `left` alternates the feet so a walk doesn't sound mechanical.
export function footstep(pan: number, volume: number, surface: Surface, left: boolean) {
  const a = audio();
  if (!a || volume <= 0.01) return;
  const vary = 0.9 + Math.random() * 0.2;
  thump(a, 0, (surface === "wood" ? 110 : 150) * vary * (left ? 1 : 1.08), 45, 0.07, 0.35 * volume, pan);
  hiss(a, 0, surface === "wood" ? 0.06 : 0.045, 0.12 * volume, pan, "lowpass", (surface === "wood" ? 900 : 2600) * vary);
}

// A candle blown out: a breath, then the wick's hiss.
export function snuff(pan: number, volume: number) {
  const a = audio();
  if (!a) return;
  hiss(a, 0, 0.35, 0.35 * volume, pan, "bandpass", 1400, 500);
  hiss(a, 0.28, 0.25, 0.08 * volume, pan, "highpass", 5000);
}

// A struggle in the dark: a choked gasp, a blow, the body falling.
export function kill(pan: number, volume: number) {
  const a = audio();
  if (!a) return;
  hiss(a, 0, 0.22, 0.25 * volume, pan, "bandpass", 900, 600);
  thump(a, 0.15, 95, 32, 0.4, 0.6 * volume, pan);
  hiss(a, 0.15, 0.12, 0.2 * volume, pan, "lowpass", 500);
  thump(a, 0.55, 70, 28, 0.5, 0.45 * volume, pan);
  hiss(a, 0.55, 0.25, 0.12 * volume, pan, "lowpass", 350);
}

// Paper: a quick crinkle of a sheet being picked up or laid down.
export function page(volume: number) {
  const a = audio();
  if (!a) return;
  for (let i = 0; i < 5; i++) {
    const at = i * 0.045 + Math.random() * 0.02;
    hiss(a, at, 0.04 + Math.random() * 0.04, (0.08 + Math.random() * 0.08) * volume, (Math.random() - 0.5) * 0.3, "bandpass", 2500 + Math.random() * 2500);
  }
  hiss(a, 0.22, 0.12, 0.1 * volume, 0, "lowpass", 900);
}

// A menu blip for button presses, like an old console's: two quick square
// notes. "confirm" rises brighter, "back" falls lower.
export function click(kind: "normal" | "confirm" | "back" = "normal") {
  const a = audio();
  if (!a) return;
  const notes = kind === "confirm" ? [880, 1320] : kind === "back" ? [520, 330] : [660, 990];
  const t = a.currentTime;
  notes.forEach((f, i) => {
    const o = a.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const g = out(a, 0, 0);
    const at = t + i * 0.045;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.06);
  });
}

// The Host's sting: a low, sour chord that swells out of a rumble.
export function sting() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  for (const [f, v] of [[73.4, 0.3], [87.3, 0.22], [103.8, 0.2], [146.8, 0.1]] as const) {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.8);
    lp.frequency.exponentialRampToValueAtTime(150, t + 3);
    const g = out(a, 0, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(lp).connect(g);
    o.start(t);
    o.stop(t + 3.3);
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuffer(a, 2);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  const g = out(a, 0, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
  s.connect(lp).connect(g);
  s.start(t);
}
