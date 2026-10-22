// The soundtrack: 8-bit pieces synthesized live like an old console's
// sound chip (two pulse-wave voices, a triangle bass, a noise channel for
// drums), with no audio files. The menus play the main theme; in the manor
// every room has its own piece, and walking through a door crossfades to it.
//
// Each song below is a short description: its chords (one per bar), and
// how the arpeggio, bass, chords, melody and drums play over them. Melodies
// are written as "note:length" with lengths in sixteenth notes, "-" for a
// rest and "|" between bars.

import { audioContext, musicBus } from "./sfx";

type Wave = number | "triangle"; // a number is a pulse wave's duty cycle

interface Drums {
  from?: number; // first bar these drums play (they stay until the next set)
  kick?: number[]; // steps within the bar
  snare?: number[];
  hat?: number[];
  clank?: number[]; // a pot lid's ring
  tick?: boolean; // a clock's tick-tock on every beat
  rain?: boolean; // drops against glass
  drip?: boolean; // water dripping in the dark
  bell?: string; // a bell on the first beat of every other bar
}

interface SongDef {
  name: string;
  bpm: number;
  beats: number; // beats per bar: 4, or 3 for a waltz
  bars: number; // the loop's length
  chords: [string, string][]; // [chord notes, bass note], one per bar, cycling
  arp?: { pattern: number[]; wave: Wave; vol: number }; // -1 rests
  pad?: { wave: Wave; vol: number }; // the chord held through the bar
  stabs?: { steps: number[]; wave: Wave; vol: number; len: number };
  bass: { hits: number[]; len: number; vol: number; riff?: number[]; walk?: boolean };
  melody?: { from: number; bars: string; wave: Wave; vol: number; vibrato?: boolean; pluck?: boolean };
  drums?: Drums[];
}

const SONGS: Record<string, SongDef> = {
  // The menus: "Ravenscroft", in D harmonic minor.
  menu: {
    name: "Ravenscroft",
    bpm: 84,
    beats: 4,
    bars: 16,
    chords: [["D4 F4 A4 D5", "D2"], ["Bb3 D4 F4 Bb4", "Bb1"], ["G3 Bb3 D4 G4", "G1"], ["A3 C#4 E4 A4", "A1"]],
    arp: { pattern: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 2, 1], wave: 0.125, vol: 0.07 },
    bass: { hits: [0, 3, 6, 8, 11, 14], len: 2, vol: 0.42 },
    melody: {
      from: 8,
      bars:
        "A4:4 D5:4 F5:4 E5:2 D5:2 | F5:8 D5:4 Bb4:4 | G4:4 Bb4:4 D5:4 C5:2 Bb4:2 | A4:12 C#5:4 |" +
        "D5:4 F5:4 A5:4 G5:2 F5:2 | D5:4 F5:2 E5:2 D5:8 | Bb4:4 D5:4 G5:4 F5:2 E5:2 | E5:8 C#5:4 A4:2 -:2",
      wave: 0.25,
      vol: 0.11,
      vibrato: true,
    },
    drums: [
      { from: 4, kick: [0, 10], hat: [4, 12] },
      { from: 8, kick: [0, 10], hat: [0, 2, 4, 6, 10, 12, 14], snare: [8] },
    ],
  },

  // The role card, for the Host: a slow pact with the house, a heartbeat
  // and a tolling bell over D Phrygian.
  pact: {
    name: "The Pact",
    bpm: 66,
    beats: 4,
    bars: 8,
    chords: [["D3 F3 A3", "D1"], ["Eb3 G3 Bb3", "Eb1"], ["D3 F3 A3", "D1"], ["C#3 E3 G3 Bb3", "A1"]],
    pad: { wave: 0.125, vol: 0.03 },
    bass: { hits: [0, 8], len: 6, vol: 0.36 },
    melody: { from: 4, bars: "D5:6 Eb5:2 D5:8 | -:4 A4:4 Bb4:4 A4:4 | D5:4 F5:4 Eb5:4 D5:4 | C#5:12 -:4", wave: 0.125, vol: 0.07, vibrato: true },
    drums: [{ kick: [0, 3], bell: "A4" }],
  },

  // The role card, for a Guest: a bright welcome to the party, before the
  // night shows what it is.
  welcome: {
    name: "Welcome to Ravenscroft",
    bpm: 124,
    beats: 4,
    bars: 8,
    chords: [["C4 E4 G4 C5", "C2"], ["A3 C4 E4 A4", "A1"], ["F3 A3 C4 F4", "F1"], ["G3 B3 D4 G4", "G1"]],
    arp: { pattern: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 2, 1], wave: 0.25, vol: 0.05 },
    bass: { hits: [0, 4, 8, 12], len: 2, vol: 0.38 },
    melody: {
      from: 0,
      bars:
        "E5:4 G5:4 E5:2 D5:2 C5:4 | A4:4 C5:4 E5:8 | F5:4 E5:2 D5:2 C5:4 A4:4 | B4:4 D5:4 G5:8 |" +
        "G5:4 E5:2 G5:2 C6:8 | A5:4 G5:2 E5:2 C5:8 | F5:2 G5:2 A5:4 G5:4 F5:4 | D5:4 B4:4 G4:4 -:4",
      wave: 0.5,
      vol: 0.1,
    },
    drums: [{ kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] }],
  },

  // A music box among the shelves, slow and dusty.
  library: {
    name: "Dust and Ink",
    bpm: 70,
    beats: 4,
    bars: 8,
    chords: [["A4 C5 E5 A5", "A1"], ["F4 A4 C5 F5", "F1"], ["E4 G4 C5 E5", "C2"], ["E4 G#4 B4 E5", "E1"]],
    arp: { pattern: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1], wave: 0.25, vol: 0.05 },
    bass: { hits: [0], len: 14, vol: 0.3 },
    melody: { from: 4, bars: "E5:6 D5:2 C5:4 B4:4 | A4:8 C5:4 F5:4 | E5:6 D5:2 C5:4 E5:4 | B4:12 -:4", wave: 0.5, vol: 0.07, vibrato: true },
  },

  // An organ and a chant, under a bell.
  chapel: {
    name: "Vespers",
    bpm: 58,
    beats: 4,
    bars: 16,
    chords: [
      ["E3 G3 B3", "E1"], ["C3 E3 G3", "C2"], ["D3 F#3 A3", "D2"], ["B2 D3 F#3", "B1"],
      ["E3 G3 B3", "E1"], ["A2 C3 E3", "A1"], ["B2 D#3 F#3", "B1"], ["E3 G3 B3", "E1"],
    ],
    pad: { wave: 0.5, vol: 0.035 },
    bass: { hits: [0, 8], len: 8, vol: 0.3 },
    melody: {
      from: 8,
      bars: "B4:8 A4:4 G4:4 | G4:8 E4:8 | F#4:8 A4:4 F#4:4 | D4:16 | E4:4 G4:4 B4:8 | C5:8 A4:8 | B4:8 D#5:8 | E5:16",
      wave: 0.5,
      vol: 0.07,
      vibrato: true,
    },
    drums: [{ bell: "E5" }],
  },

  // A music-box waltz for an empty cradle.
  nursery: {
    name: "Lullaby for No One",
    bpm: 100,
    beats: 3,
    bars: 12,
    chords: [["C5 Eb5 G5", "C2"], ["C5 Eb5 Ab5", "Ab1"], ["C5 F5 Ab5", "F1"], ["B4 D5 G5", "G1"]],
    arp: { pattern: [0, -1, 1, -1, 2, -1, 1, -1, 2, -1, 1, -1], wave: "triangle", vol: 0.1 },
    bass: { hits: [0], len: 4, vol: 0.34 },
    melody: {
      from: 4,
      bars: "G5:8 Eb5:4 | Eb5:8 C5:4 | F5:4 Eb5:4 C5:4 | D5:12 | Eb5:4 G5:4 C6:4 | C6:8 Ab5:4 | Ab5:4 G5:4 F5:4 | D5:6 B4:6",
      wave: "triangle",
      vol: 0.2,
      vibrato: true,
    },
  },

  // A walking bass and a clock that never stops.
  study: {
    name: "Ticking",
    bpm: 90,
    beats: 4,
    bars: 16,
    chords: [["G3 Bb3 D4", "G1"], ["Eb3 G3 Bb3", "Eb2"], ["C3 Eb3 G3", "C2"], ["D3 F#3 A3", "D2"]],
    pad: { wave: 0.125, vol: 0.02 },
    bass: { hits: [0, 4, 8, 12], len: 3, vol: 0.34, walk: true },
    melody: {
      from: 8,
      bars:
        "D5:2 -:2 Bb4:2 -:2 G4:4 A4:2 Bb4:2 | G5:6 F5:2 Eb5:4 D5:4 | C5:2 -:2 Eb5:2 -:2 G5:4 F5:2 Eb5:2 | D5:4 F#5:4 A5:4 -:4",
      wave: 0.25,
      vol: 0.09,
    },
    drums: [{ tick: true }],
  },

  // A stately minuet for the last supper.
  dining: {
    name: "The Last Supper",
    bpm: 108,
    beats: 3,
    bars: 16,
    chords: [["F3 Ab3 C4", "F1"], ["F3 Ab3 Db4", "Db2"], ["F3 Bb3 Db4", "Bb1"], ["E3 G3 C4", "C2"]],
    stabs: { steps: [4, 8], wave: 0.25, vol: 0.04, len: 2 },
    bass: { hits: [0], len: 4, vol: 0.32 },
    melody: {
      from: 4,
      bars: "C5:4 F5:4 Ab5:4 | Ab5:6 F5:2 Db5:4 | Db5:4 F5:4 Bb5:4 | G5:8 E5:4 | F5:4 Ab5:4 C6:4 | Db6:6 C6:2 Ab5:4 | Bb5:4 Ab5:4 F5:4 | E5:8 C5:4",
      wave: 0.5,
      vol: 0.12,
      pluck: true,
    },
    drums: [{ from: 4, kick: [0] }],
  },

  // The dead still dance here: a waltz, oom-pah-pah.
  ballroom: {
    name: "Danse Macabre",
    bpm: 132,
    beats: 3,
    bars: 16,
    chords: [
      ["E4 G4 B4", "E2"], ["E4 A4 C5", "A1"], ["D#4 F#4 A4", "B1"], ["E4 G4 B4", "E2"],
      ["E4 G4 B4", "E2"], ["E4 G4 C5", "C2"], ["D#4 F#4 A4", "B1"], ["E4 G4 B4", "E2"],
    ],
    stabs: { steps: [4, 8], wave: 0.25, vol: 0.035, len: 2 },
    bass: { hits: [0], len: 3, vol: 0.35 },
    melody: {
      from: 0,
      bars: "B4:4 E5:4 G5:4 | A5:8 E5:4 | F#5:4 A5:4 D#5:4 | E5:12 | B4:4 E5:4 G5:4 | C6:8 G5:4 | F#5:4 D#5:4 B4:4 | E5:8 -:4",
      wave: 0.25,
      vol: 0.12,
      vibrato: true,
    },
    drums: [{ from: 8, kick: [0], hat: [4, 8] }],
  },

  // Rolling arpeggios and rain on the glass roof.
  conservatory: {
    name: "Rain on Glass",
    bpm: 76,
    beats: 4,
    bars: 16,
    chords: [["F#4 A4 C#5 G#5", "F#1"], ["D4 F#4 A4 C#5", "D2"], ["A3 C#4 E4 B4", "A1"], ["E4 G#4 B4 D5", "E2"]],
    arp: { pattern: [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 1, 2, 3, 2], wave: 0.125, vol: 0.06 },
    bass: { hits: [0, 10], len: 6, vol: 0.32 },
    melody: {
      from: 8,
      bars: "C#5:8 B4:4 A4:4 | F#5:12 E5:4 | E5:8 C#5:8 | B4:16 | C#5:4 E5:4 G#5:8 | F#5:8 A5:8 | E5:12 B4:4 | D5:16",
      wave: "triangle",
      vol: 0.16,
      vibrato: true,
    },
    drums: [{ rain: true }],
  },

  // A slow march into the hall.
  entrance: {
    name: "Arrival",
    bpm: 88,
    beats: 4,
    bars: 16,
    chords: [
      ["C4 Eb4 G4", "C2"], ["B3 D4 G4", "G1"], ["C4 Eb4 Ab4", "Ab1"], ["C4 F4 Ab4", "F1"],
      ["C4 Eb4 G4", "C2"], ["C4 F4 Ab4", "F1"], ["B3 D4 G4", "G1"], ["B3 D4 G4", "G1"],
    ],
    stabs: { steps: [2, 6, 10, 14], wave: 0.25, vol: 0.025, len: 1 },
    bass: { hits: [0, 4, 8, 12], len: 2, vol: 0.32 },
    melody: {
      from: 8,
      bars:
        "G4:6 G4:2 C5:4 Eb5:4 | D5:8 B4:4 G4:4 | Ab4:6 C5:2 Eb5:4 Ab5:4 | F5:12 -:4 |" +
        "Eb5:6 D5:2 C5:4 G4:4 | F4:4 Ab4:4 C5:4 F5:4 | D5:6 C5:2 B4:4 D5:4 | G5:12 -:4",
      wave: 0.25,
      vol: 0.1,
    },
    drums: [{ kick: [0, 8], snare: [4, 12] }, { from: 8, kick: [0, 8], snare: [4, 12, 14, 15] }],
  },

  // Something bubbling: a creeping chromatic bass and clanking pots.
  kitchen: {
    name: "Simmer",
    bpm: 112,
    beats: 4,
    bars: 16,
    chords: [["A3 C4 E4", "A1"], ["Bb3 D4 F4", "Bb1"], ["A3 C4 E4", "A1"], ["G#3 B3 E4", "E1"]],
    bass: { hits: [0, 2, 4, 6, 8, 10, 12, 14], len: 1.5, vol: 0.32, riff: [0, 0, 12, 0, 1, 0, 12, -1] },
    melody: {
      from: 8,
      bars:
        "E5:2 -:2 E5:2 F5:2 E5:2 -:2 C5:2 A4:2 | D5:2 -:2 D5:2 F5:2 Bb5:4 A5:2 F5:2 | E5:2 -:2 E5:2 F5:2 E5:2 C5:2 A4:4 | G#4:4 B4:4 D5:2 F5:2 E5:4",
      wave: 0.125,
      vol: 0.1,
    },
    drums: [{ kick: [0, 8], clank: [6, 14] }],
  },

  // Under the house: a drone, a heartbeat, water dripping.
  cellar: {
    name: "Below",
    bpm: 56,
    beats: 4,
    bars: 8,
    chords: [["D3 F3 A3", "D1"], ["Eb3 G3 Bb3", "D1"], ["D3 F3 A3", "D1"], ["Bb2 D3 F#3", "D1"]],
    pad: { wave: 0.125, vol: 0.018 },
    bass: { hits: [0], len: 16, vol: 0.3 },
    melody: { from: 4, bars: "A5:12 -:4 | Bb5:8 -:8 | A5:4 F5:4 D5:8 | G#5:16", wave: 0.125, vol: 0.05, vibrato: true },
    drums: [{ kick: [0, 3], drip: true }],
  },
};

// ------------------------------------------------------------ parsing

const NOTE: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

// "C#5" → a MIDI note number.
function midi(name: string) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return NOTE[m[1]] + (Number(m[2]) + 1) * 12;
}

const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface Song extends SongDef {
  id: string;
  steps: number; // sixteenths per bar
  step: number; // seconds per sixteenth
  parsedChords: { notes: number[]; bass: number }[];
  parsedMelody: [number | null, number][][];
}

function parse(id: string, d: SongDef): Song {
  return {
    ...d,
    id,
    steps: d.beats * 4,
    step: 60 / d.bpm / 4,
    parsedChords: d.chords.map(([notes, bass]) => ({ notes: notes.split(" ").map(midi), bass: midi(bass) })),
    parsedMelody: (d.melody?.bars ?? "").split("|").filter((b) => b.trim()).map((bar) =>
      bar.trim().split(/\s+/).map((tok) => {
        const [n, len] = tok.split(":");
        return [n === "-" ? null : midi(n), Number(len)] as [number | null, number];
      }),
    ),
  };
}

const songs = new Map(Object.entries(SONGS).map(([id, d]) => [id, parse(id, d)]));

// Every melody bar must fill exactly one bar, or the tune drifts off the chords.
for (const song of songs.values()) {
  song.parsedMelody.forEach((bar, i) => {
    const len = bar.reduce((sum, [, l]) => sum + l, 0);
    if (len !== song.steps) console.warn(`music: ${song.id} melody bar ${i + 1} is ${len} sixteenths, not ${song.steps}`);
  });
}

// ------------------------------------------------------------ voices

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const pulses = new Map<number, PeriodicWave>();
let noise: AudioBuffer | null = null;

function pulse(a: AudioContext, duty: number) {
  let w = pulses.get(duty);
  if (!w) {
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    w = a.createPeriodicWave(real, imag);
    pulses.set(duty, w);
  }
  return w;
}

function envelope(a: AudioContext, out: AudioNode, t: number, length: number, volume: number, pluck = false) {
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.005);
  // A plucked note (a harpsichord) dies away; others hold.
  g.gain.setTargetAtTime(volume * (pluck ? 0.15 : 0.55), t + 0.02, pluck ? 0.08 : 0.12);
  g.gain.setTargetAtTime(0, t + Math.max(0.02, length - 0.03), 0.015);
  g.connect(out);
  return g;
}

function tone(a: AudioContext, out: AudioNode, t: number, length: number, note: number, volume: number, wave: Wave, vibrato = false, pluck = false) {
  const osc = a.createOscillator();
  if (wave === "triangle") osc.type = "triangle";
  else osc.setPeriodicWave(pulse(a, wave));
  osc.frequency.value = hz(note);
  if (vibrato && length > 0.3) {
    // Vibrato creeps in after the attack, as on old soundtracks.
    const lfo = a.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = a.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(18, t + 0.25);
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + length + 0.1);
  }
  osc.connect(envelope(a, out, t, length, volume, pluck));
  osc.start(t);
  osc.stop(t + length + 0.1);
}

function kick(a: AudioContext, out: AudioNode, t: number, volume = 0.5) {
  const osc = a.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  osc.connect(envelope(a, out, t, 0.16, volume));
  osc.start(t);
  osc.stop(t + 0.25);
}

function hiss(a: AudioContext, out: AudioNode, t: number, length: number, volume: number, type: BiquadFilterType, freq: number) {
  if (!noise) {
    noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noise;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + length);
  src.connect(filter).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.05);
}

// ------------------------------------------------------------ playing

// Plays one sixteenth of a song.
function schedule(a: AudioContext, out: AudioNode, song: Song, s: number, t: number) {
  const bar = Math.floor(s / song.steps);
  const i = s % song.steps;
  const chords = song.parsedChords;
  const chord = chords[bar % chords.length];
  const melodyOn = !!song.melody && bar >= song.melody.from;

  if (song.arp) {
    const k = song.arp.pattern[i % song.arp.pattern.length];
    if (k >= 0) tone(a, out, t, song.step * 0.9, chord.notes[k % chord.notes.length], song.arp.vol * (melodyOn ? 0.75 : 1), song.arp.wave);
  }
  if (song.pad && i === 0) {
    for (const n of chord.notes) tone(a, out, t, song.step * song.steps, n, song.pad.vol, song.pad.wave);
  }
  if (song.stabs?.steps.includes(i)) {
    for (const n of chord.notes) tone(a, out, t, song.step * song.stabs.len, n, song.stabs.vol, song.stabs.wave);
  }

  const b = song.bass;
  const hit = b.hits.indexOf(i);
  if (hit >= 0) {
    let n = chord.bass;
    if (b.riff) n += b.riff[hit % b.riff.length];
    if (b.walk) {
      // Root, third, fifth, then a half step into the next chord's root.
      const third = chord.notes[1] - chord.notes[0];
      const fifth = chord.notes[2] - chord.notes[0];
      const next = chords[(bar + 1) % chords.length].bass;
      n = [chord.bass, chord.bass + third, chord.bass + fifth, next - 1][hit % 4];
    }
    tone(a, out, t, song.step * b.len, n, b.vol, "triangle");
  }

  if (melodyOn) {
    const m = song.melody!;
    const notes = song.parsedMelody[(bar - m.from) % song.parsedMelody.length];
    let at = 0;
    for (const [n, len] of notes) {
      if (at === i && n !== null) tone(a, out, t, song.step * len, n, m.vol, m.wave, m.vibrato, m.pluck);
      at += len;
    }
  }

  // The drums of the latest section that has started.
  const d = song.drums?.filter((x) => (x.from ?? 0) <= bar).pop();
  if (!d) return;
  if (d.kick?.includes(i)) kick(a, out, t, i === 3 && d.drip ? 0.3 : 0.5);
  if (d.snare?.includes(i)) hiss(a, out, t, 0.14, 0.12, "bandpass", 1800);
  if (d.hat?.includes(i)) hiss(a, out, t, 0.03, 0.04, "highpass", 7500);
  if (d.clank?.includes(i)) hiss(a, out, t, 0.09, 0.09, "bandpass", 3200);
  if (d.tick && i % 4 === 0) hiss(a, out, t, 0.02, 0.07, "bandpass", i % 8 === 0 ? 5200 : 3400);
  if (d.rain && Math.random() < 0.35) hiss(a, out, t + Math.random() * song.step, 0.02, 0.012 + Math.random() * 0.015, "highpass", 6000);
  if (d.drip && Math.random() < 0.04) tone(a, out, t, 0.08, midi("A6") + Math.floor(Math.random() * 5), 0.04, "triangle");
  if (d.bell && i === 0 && bar % 2 === 0) tone(a, out, t, song.step * song.steps * 1.5, midi(d.bell), 0.05, "triangle");
}

// The song now playing, and where each song was left so a room's piece
// carries on when you come back to it.
let current: { song: Song; out: GainNode; step: number; nextAt: number } | null = null;
let wanted = "menu";
const leftAt = new Map<string, number>();
let timer = 0;
let stopAt = 0;

function tick() {
  const a = ctx!;
  if (current) {
    const c = current;
    // Catch up rather than burst after the tab was in the background.
    if (c.nextAt < a.currentTime) c.nextAt = a.currentTime + 0.05;
    while (c.nextAt < a.currentTime + 0.2) {
      schedule(a, c.out, c.song, c.step, c.nextAt);
      c.step = (c.step + 1) % (c.song.steps * c.song.bars);
      c.nextAt += c.song.step;
    }
  }
  if (stopAt && a.currentTime > stopAt) {
    clearInterval(timer);
    timer = stopAt = 0;
  }
}

// Crossfade from the song playing to another.
function switchTo(id: string) {
  const a = ctx!;
  const song = songs.get(id) ?? songs.get("menu")!;
  const now = a.currentTime;
  if (current) {
    leftAt.set(current.song.id, current.step);
    const old = current.out;
    old.gain.setTargetAtTime(0, now, 0.4);
    setTimeout(() => old.disconnect(), 3000);
  }
  const out = a.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.setTargetAtTime(1, now + 0.1, 0.5);
  out.connect(master!);
  // Pick a song back up from the start of the bar it was left in.
  const was = leftAt.get(song.id) ?? 0;
  current = { song, out, step: was - (was % song.steps), nextAt: now + 0.1 };
}

// Choose the piece to play: "menu", or a room's id. Unknown ids keep the
// current piece (a doorway belongs to no room).
export function playSong(id: string) {
  if (!songs.has(id)) return;
  wanted = id;
  if (ctx && master && current?.song.id !== id) switchTo(id);
}

// The name of the piece playing, for the settings page.
export function songName() {
  return songs.get(current?.song.id ?? wanted)!.name;
}

// Fade the music to a volume (0 stops it). Call this from a click or key
// press the first time, because browsers keep sound off until then.
export function setMusic(volume: number) {
  if (!ctx) {
    if (volume <= 0) return;
    ctx = audioContext();
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(musicBus(ctx));
  }
  const now = ctx.currentTime;
  master!.gain.cancelScheduledValues(now);
  master!.gain.setValueAtTime(master!.gain.value, now);
  master!.gain.linearRampToValueAtTime(volume * 0.5, now + 1.5);
  if (volume <= 0) {
    if (timer) stopAt = now + 1.6;
    return;
  }
  stopAt = 0;
  if (!current || current.song.id !== wanted) switchTo(wanted);
  if (!timer) {
    current!.nextAt = now + 0.1;
    timer = window.setInterval(tick, 25);
  }
}
