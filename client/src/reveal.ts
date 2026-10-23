// The role presentation at the start of each night: your character in
// pixel art, framed for the part you will play.
//
// A Guest stands in a dark room holding a candle, rain on the window. The
// Host is lit red from below, and on the wall behind looms a huge shadow of
// them with glowing eyes.

import { dither } from "./pixel";
import { FRAME_H, FRAME_W, frameIndex, sheet } from "./sprites";

const W = 160; // art pixels, shown at 3×
const H = 112;
const FLOOR = 88; // where the floor begins
const SCALE = 3; // the character is drawn at 3× within the art

// A warm (or red) light: three stacked, brightening discs, added on top.
function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  g.globalCompositeOperation = "lighter";
  for (const [k, a] of [[1, 0.35], [0.7, 0.5], [0.42, 0.8]] as const) {
    g.fillStyle = `rgba(${rgb}, ${alpha * a})`;
    const rr = Math.round(r * k);
    for (let dy = -rr; dy <= rr; dy++) {
      const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
      g.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
  }
  g.globalCompositeOperation = "source-over";
}

// One frame of the character, facing you, as its own canvas.
function portrait(color: string) {
  const c = document.createElement("canvas");
  c.width = FRAME_W;
  c.height = FRAME_H;
  c.getContext("2d")!.drawImage(sheet(color), frameIndex("down", false, 0) * FRAME_W, 0, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  return c;
}

// The same frame filled with one colour: a silhouette.
function silhouette(src: HTMLCanvasElement, color: string) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export class RevealArt {
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private drops = Array.from({ length: 8 }, (_, i) => ({ x: (i * 7) % 26, y: (i * 11) % 30 }));

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.g = canvas.getContext("2d")!;
  }

  show(color: string, host: boolean) {
    cancelAnimationFrame(this.raf);
    const me = portrait(color);
    const shadow = silhouette(me, "#0a0204");
    const redLit = silhouette(me, "#ff2a1a");
    const room = this.room(host);
    const start = performance.now();
    let last = start;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (host) this.drawHost(room, me, shadow, redLit, t);
      else this.drawGuest(room, me, t, dt);
      if (!this.reduced) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  // The room: wallpaper, a wainscot, floorboards. The Host's is redder.
  private room(host: boolean) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    const [paper, motif] = host ? ["#2a0c10", "#300e12"] : ["#1e2a1e", "#222f22"];
    px(0, 0, W, FLOOR, paper);
    for (let y = 2; y < FLOOR - 24; y += 8) {
      for (let x = ((y / 8) % 2) * 4; x < W; x += 8) {
        px(x + 1, y, 1, 3, motif);
        px(x, y + 1, 3, 1, motif);
      }
    }
    px(0, FLOOR - 24, W, 2, "#4a2c16");
    for (let x = 0; x < W; x += 10) px(x, FLOOR - 22, 1, 22, "#22140a");
    px(0, FLOOR - 22, W, 22, "#2e1a0e");
    for (let x = 0; x < W; x += 10) px(x + 1, FLOOR - 20, 8, 18, "#341e10");
    px(0, FLOOR - 2, W, 2, "#4a2c16");
    for (let y = FLOOR; y < H; y++) {
      const row = Math.floor((y - FLOOR) / 4);
      for (let x = 0; x < W; x++) {
        const seam = (y - FLOOR) % 4 === 3 || (x + row * 13) % 30 === 0;
        px(x, y, 1, 1, seam ? "#1a0e06" : host ? "#3a1a10" : "#3a2414");
      }
    }
    if (!host) {
      // A window on the right, the storm outside.
      px(118, 14, 30, 34, "#3a2414");
      px(120, 16, 26, 30, "#0e1424");
      px(132, 16, 2, 30, "#3a2414");
      px(120, 30, 26, 2, "#3a2414");
      px(138, 18, 4, 4, "#d8d0b0");
      px(117, 46, 32, 3, "#5a3a20");
    }
    return c;
  }

  // Darken towards the edges in dithered steps.
  private vignette(cx: number, cy: number, radius: number, tint: string) {
    const g = this.g;
    g.fillStyle = tint;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - cx) / radius, (y - cy) / (radius * 0.8));
        if (d > 1 + dither(x, y) * 0.5) g.fillRect(x, y, 1, 1);
        else if (d > 0.75 + dither(x, y) * 0.5 && (x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
      }
    }
  }

  private flame(x: number, y: number, t: number, big = 1) {
    const g = this.g;
    const tall = Math.round((3 + (this.reduced ? 0 : 0.5 * Math.sin(t * 6))) * big);
    g.fillStyle = "#ff7a1a";
    g.fillRect(x - 1, y - tall - 1, 3, tall + 1);
    g.fillRect(x, y - tall - 2, 1, 1);
    g.fillStyle = "#ffd27a";
    g.fillRect(x, y - tall, 1, tall);
  }

  private drawGuest(room: HTMLCanvasElement, me: HTMLCanvasElement, t: number, dt: number) {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.drawImage(room, 0, 0);
    // Rain on the window.
    g.fillStyle = "#4a6a90";
    for (const d of this.drops) {
      if (!this.reduced) d.y = (d.y + dt * 30) % 30;
      g.fillRect(120 + d.x, 16 + Math.floor(d.y), 1, 2);
    }
    // You, with a candle in your right hand.
    const cw = FRAME_W * SCALE;
    const ch = FRAME_H * SCALE;
    const x = Math.round(W / 2 - cw / 2) - 6;
    const y = FLOOR + 14 - ch;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(x + 10, FLOOR + 12, cw - 20, 3);
    g.drawImage(me, x, y, cw, ch);
    const hx = x + cw - 8;
    const hy = y + Math.round(ch * 0.55);
    g.fillStyle = "#e8dcc0";
    g.fillRect(hx - 1, hy - 8, 3, 9);
    g.fillStyle = "#c8a040";
    g.fillRect(hx - 3, hy, 7, 2);
    const flick = this.reduced ? 1 : 0.97 + 0.03 * Math.sin(t * 3);
    glow(this.g, hx, hy - 11, 40 * flick, "255, 160, 70", 0.12);
    this.flame(hx, hy - 9, t);
    this.vignette(hx - 4, hy, 78, "rgba(5, 3, 7, 0.85)");
  }

  private drawHost(room: HTMLCanvasElement, me: HTMLCanvasElement, shadow: HTMLCanvasElement, redLit: HTMLCanvasElement, t: number) {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.drawImage(room, 0, 0);
    const cw = FRAME_W * SCALE;
    const ch = FRAME_H * SCALE;
    const x = Math.round(W / 2 - cw / 2);
    const y = FLOOR + 14 - ch;
    // The shadow on the wall: you, larger than life, breathing slowly.
    const breathe = this.reduced ? 0 : Math.round(Math.sin(t * 1.6) * 2);
    const sw = FRAME_W * 5;
    const sh = FRAME_H * 5 + breathe;
    const sx = Math.round(W / 2 - sw / 2) + 4;
    const sy = FLOOR + 6 - sh;
    g.globalAlpha = 0.9;
    g.drawImage(shadow, sx, sy, sw, sh);
    g.globalAlpha = 1;
    // Its eyes, where your eyes would be (about 40% down a frame), burning.
    const blink = !this.reduced && t % 4.3 > 4.15;
    if (!blink) {
      const ey = sy + Math.round(sh * 0.4);
      for (const ex of [sx + sw * 0.36, sx + sw * 0.64]) {
        glow(this.g, Math.round(ex), ey, 6, "255, 40, 20", 0.35);
        g.fillStyle = "#ff3a1a";
        g.fillRect(Math.round(ex) - 2, ey, 4, 2);
        g.fillStyle = "#ffd0a0";
        g.fillRect(Math.round(ex) - 1, ey, 1, 1);
      }
    }
    // Snuffed candles on the floor, smoke curling up from each.
    for (const [i, cx] of [22, 46, 118, 140].entries()) {
      g.fillStyle = "#d8cca8";
      g.fillRect(cx - 1, FLOOR + 4 - (i % 2) * 2, 3, 8 + (i % 2) * 2);
      g.fillStyle = "#2a1a10";
      g.fillRect(cx, FLOOR + 2 - (i % 2) * 2, 1, 2);
      for (let k = 0; k < 6; k++) {
        const age = this.reduced ? k / 6 : ((t * 0.5 + k / 6 + i * 0.3) % 1);
        g.fillStyle = `rgba(150, 140, 160, ${(0.5 * (1 - age)).toFixed(2)})`;
        g.fillRect(Math.round(cx + Math.sin(age * 6 + i) * 3), Math.round(FLOOR - age * 30) - (i % 2) * 2, 2, 2);
      }
    }
    // You, lit red from below the waist.
    g.drawImage(me, x, y, cw, ch);
    const sy0 = Math.floor(FRAME_H * 0.6);
    g.globalAlpha = 0.2;
    g.drawImage(redLit, 0, sy0, FRAME_W, FRAME_H - sy0, x, y + sy0 * SCALE, cw, ch - sy0 * SCALE);
    g.globalAlpha = 1;
    glow(this.g, W / 2, FLOOR + 10, 34, "255, 40, 20", 0.12);
    this.vignette(W / 2, FLOOR - 20, 84, "rgba(10, 0, 2, 0.88)");
  }
}

// ------------------------------------------------------------ goal icons

export type IconKind = "candle" | "page" | "key" | "dawn" | "snuff" | "dagger" | "cold" | "door";
const icons = new Map<IconKind, string>();

// A 12×12 pixel icon for a goal, drawn at 3×.
export function goalIcon(kind: IconKind): string {
  const cached = icons.get(kind);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 36;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x * 3, y * 3, w * 3, h * 3);
  };
  switch (kind) {
    case "candle":
      px(4, 5, 4, 7, "#f4ead2");
      px(4, 5, 1, 7, "#c8b48a");
      px(5, 1, 2, 3, "#ff8a2a");
      px(5, 2, 1, 2, "#ffd27a");
      px(3, 11, 6, 1, "#c8a040");
      break;
    case "page":
      px(2, 1, 7, 10, "#e8dcb8");
      px(8, 1, 2, 2, "#8a7650");
      for (const y of [3, 5, 7]) px(3, y, 5, 1, "#8a7a55");
      px(6, 8, 3, 3, "#a82a2a");
      break;
    case "key":
      px(1, 3, 4, 4, "#c8a040");
      px(2, 4, 2, 2, "#1a1414");
      px(5, 4, 6, 2, "#c8a040");
      px(8, 6, 1, 2, "#c8a040");
      px(10, 6, 1, 2, "#c8a040");
      break;
    case "dawn":
      px(3, 6, 6, 3, "#ffd27a");
      px(4, 5, 4, 1, "#ffd27a");
      for (const [x, y] of [[1, 4], [5, 2], [10, 4], [0, 8], [11, 8]]) px(x, y, 1, 1, "#ffa640");
      px(0, 9, 12, 2, "#4a3a5a");
      break;
    case "snuff":
      px(4, 6, 4, 6, "#d8cca8");
      px(5, 5, 1, 1, "#2a1a10");
      for (const [x, y] of [[5, 3], [6, 2], [5, 1], [6, 0]]) px(x, y, 1, 1, "#9a92a8");
      break;
    case "dagger":
      px(5, 0, 2, 7, "#d8d8e0");
      px(5, 0, 1, 7, "#ffffff");
      px(3, 7, 6, 1, "#c8a040");
      px(5, 8, 2, 3, "#5a2a1a");
      px(4, 11, 4, 1, "#c8a040");
      break;
    case "cold":
      px(1, 2, 10, 9, "#5e5850");
      px(3, 5, 6, 6, "#140c08");
      px(0, 1, 12, 2, "#2a170c");
      for (const [x, y] of [[5, 6], [6, 7], [5, 8], [4, 7], [6, 6], [4, 8]]) px(x, y, 1, 1, "#bfe0ff");
      break;
    case "door":
      px(2, 1, 8, 11, "#3a2414");
      px(3, 2, 6, 10, "#5a3a20");
      px(7, 7, 1, 1, "#c8a040");
      px(1, 0, 10, 1, "#9b5de5");
      px(1, 0, 1, 12, "#9b5de5");
      px(10, 0, 1, 12, "#9b5de5");
      break;
  }
  const url = c.toDataURL();
  icons.set(kind, url);
  return url;
}

// ------------------------------------------------------------ the verdict

// What the vote did, shown at the end of a meeting. Either the guest the
// table chose stands behind the cellar's bars while the last candle down
// there gutters out, or nobody is taken and everyone still alive stands
// round the dining table, eyeing one another.
export class ResultArt {
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.g = canvas.getContext("2d")!;
  }

  // locked: the colour of the guest taken to the cellar, or null.
  // table: the colours of everyone still alive.
  show(locked: string | null, table: string[]) {
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    const art = locked ? portrait(locked) : null;
    const guests = table.map(portrait);
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      if (art) this.drawCellar(art, t);
      else this.drawTable(guests, t);
      if (!this.reduced) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private px(x: number, y: number, w: number, h: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private darken(cx: number, cy: number, radius: number) {
    const g = this.g;
    g.fillStyle = "rgba(4, 2, 6, 0.9)";
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - cx) / radius, (y - cy) / (radius * 0.8));
        if (d > 1 + dither(x, y) * 0.4) g.fillRect(x, y, 1, 1);
        else if (d > 0.78 + dither(x, y) * 0.4 && (x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
      }
    }
  }

  private drawCellar(who: HTMLCanvasElement, t: number) {
    const px = this.px.bind(this);
    this.g.imageSmoothingEnabled = false;
    // Rough cellar stone.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const row = Math.floor(y / 6);
        const col = Math.floor((x + (row % 2) * 5) / 10);
        const mortar = y % 6 === 0 || (x + (row % 2) * 5) % 10 === 0;
        px(x, y, 1, 1, mortar ? "#1a1618" : (row + col) % 2 ? "#2a2428" : "#2c262a");
      }
    }
    // Stairs coming down from the left, the way they brought you.
    for (let i = 0; i < 6; i++) px(0, 18 + i * 12, 40 - i * 6, 12, i % 2 ? "#3a3236" : "#443c40");
    // The cell: a dark recess, you inside it, then the iron bars.
    const dx = 62;
    px(dx, 18, 64, 76, "#0c0a0c");
    const cw = FRAME_W * SCALE;
    const ch = FRAME_H * SCALE;
    this.g.drawImage(who, dx + 32 - cw / 2, 94 - ch, cw, ch);
    px(dx - 4, 14, 72, 5, "#4a4248");
    for (let x = dx; x <= dx + 64; x += 8) {
      px(x, 18, 3, 76, "#3a3a44");
      px(x, 18, 1, 76, "#6a6a78");
    }
    px(dx, 50, 66, 3, "#3a3a44");
    px(dx + 48, 46, 6, 10, "#5a5a68"); // the lock
    px(dx + 50, 50, 2, 3, "#0c0a0c");
    // The last candle down here, guttering out as the scene darkens.
    const fade = this.reduced ? 1 : Math.max(0, 1 - t / 7);
    const cx = 150;
    px(cx - 1, 68, 3, 6, "#d8cca8");
    px(cx - 4, 74, 9, 2, "#5a5a68");
    if (fade > 0.05) {
      const tall = Math.max(1, Math.round((2 + Math.sin(t * 13) + Math.sin(t * 5.7)) * fade));
      px(cx - 1, 67 - tall, 3, tall, "#ff7a1a");
      px(cx, 67 - tall + 1, 1, Math.max(1, tall - 1), "#ffd27a");
      glow(this.g, cx, 64, 40 * fade, "255, 150, 60", 0.14);
    } else {
      const age = (t % 1.5) / 1.5;
      px(cx + Math.sin(age * 6) * 2, 64 - age * 16, 2, 2, `rgba(150, 140, 160, ${(0.5 * (1 - age)).toFixed(2)})`);
    }
    this.darken(dx + 32, 60, 70 + 20 * fade);
  }

  private drawTable(guests: HTMLCanvasElement[], t: number) {
    const px = this.px.bind(this);
    this.g.imageSmoothingEnabled = false;
    // Red damask wall, wainscot, a portrait.
    px(0, 0, W, H, "#3a1216");
    for (let y = 3; y < 56; y += 8) for (let x = ((y / 8) % 2) * 4; x < W; x += 8) px(x + 1, y, 1, 3, "#3e1418");
    px(0, 56, W, 3, "#4a2c16");
    px(0, 59, W, 20, "#2e1a0e");
    px(66, 8, 28, 22, "#a8802e");
    px(68, 10, 24, 18, "#2a2218");
    px(77, 13, 6, 6, "#b89070");
    px(74, 20, 12, 8, "#1a1414");
    // Everyone still alive, standing behind the table.
    const n = guests.length;
    const space = Math.min(22, (W - 20) / Math.max(1, n));
    const left = W / 2 - (space * (n - 1)) / 2;
    guests.forEach((g, i) => {
      this.g.drawImage(g, Math.round(left + i * space - FRAME_W), 40, FRAME_W * 2, FRAME_H * 2);
    });
    // The table across the front: cloth, plates, candelabras.
    px(6, 74, W - 12, 4, "#efe6cf");
    px(6, 78, W - 12, 14, "#d8cfb8");
    for (let x = 8; x < W - 8; x += 3) px(x, 91, 2, 2, "#efe6cf");
    px(6, 92, W - 12, 20, "#4a2c16");
    for (let x = 18; x < W - 12; x += 22) {
      px(x - 3, 75, 7, 2, "#b8b0a0");
      px(x - 1, 75, 3, 1, "#efe8dc");
    }
    for (const cx of [34, W - 34]) {
      px(cx - 1, 66, 3, 9, "#a8802e");
      px(cx - 5, 66, 11, 2, "#a8802e");
      for (const dx of [-5, 0, 5]) {
        px(cx + dx, 60, 1, 6, "#e8dcc0");
        const tall = this.reduced ? 2 : 2 + Math.round(0.5 * Math.sin(t * 4 + dx + cx));
        px(cx + dx, 60 - tall, 1, tall, "#ffb347");
      }
      glow(this.g, cx, 58, 30, "255, 160, 70", 0.12);
    }
    this.darken(W / 2, 60, 90);
  }
}
