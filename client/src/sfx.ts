// Small synthesized sounds, so the prototype needs no audio assets.

let ctx: AudioContext | null = null;
let rain: AudioBufferSourceNode | null = null;

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
  g.connect(p).connect(a.destination);
  return g;
}

export function startRain() {
  const a = audio();
  if (!a || rain) return;
  rain = a.createBufferSource();
  rain.buffer = noiseBuffer(a, 4);
  rain.loop = true;
  rain.connect(out(a, 0, 0.05));
  rain.start();
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

export function puff() {
  const a = audio();
  if (!a) return;
  const s = a.createBufferSource();
  s.buffer = noiseBuffer(a, 0.4);
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 800;
  const g = out(a, 0, 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.35);
  s.connect(f).connect(g);
  s.start();
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
