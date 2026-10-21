// The backdrop behind the home and lobby screens: Ravenscroft Manor on its
// hill in a thunderstorm. Like the characters, it is pixel art painted in
// code. Each layer is painted once per window size, then the layers slide at
// different speeds with the pointer (parallax) while fog drifts, rain falls
// and lightning strikes behind the hill.

import * as sfx from "./sfx";

// The art is about 190 pixels tall in landscape and 200 wide in portrait.
const ART_ROWS = 190;
const ART_COLS = 200;

// 4×4 ordered dither, so gradients break into crisp pixel patterns.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const threshold = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

const SKY = ["#06050c", "#0b0915", "#110e1f", "#18132a", "#211a36", "#2b2243", "#372b50", "#463860"];
const MOON = { body: "#e9e1c6", limb: "#c9bf9f", crater: "#d3c9a9" };

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layer(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, g: canvas.getContext("2d")! };
}

// A filled ellipse made of whole pixels (canvas ellipses are anti-aliased).
function ellipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.floor(rx * Math.sqrt(1 - (dy / ry) ** 2));
    g.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
  }
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    g.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size);
  }
}

// Light the edges of a silhouette from above and from the moon side.
function rimLight(g: CanvasRenderingContext2D, top: string, side: string) {
  const { width: w, height: h } = g.canvas;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const [tr, tg, tb] = rgb(top);
  const [sr, sg, sb] = rgb(side);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const marks: [number, RGB][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) marks.push([(y * w + x) * 4, [tr, tg, tb]]);
      else if (!solid(x + 1, y)) marks.push([(y * w + x) * 4, [sr, sg, sb]]);
    }
  }
  for (const [i, c] of marks) [d[i], d[i + 1], d[i + 2]] = c;
  g.putImageData(img, 0, 0);
}

// Sum of sines that repeats exactly every `period` pixels, for layers that wrap.
function wave(period: number, seed: number) {
  const r = rng(seed);
  const parts = [1, 2, 3, 5, 8].map((k) => ({ k, a: r() / k, p: r() * Math.PI * 2 }));
  const total = parts.reduce((s, q) => s + q.a, 0);
  return (x: number) => parts.reduce((s, q) => s + q.a * Math.sin((2 * Math.PI * q.k * x) / period + q.p), 0) / total;
}

type Layer = { canvas: HTMLCanvasElement; depth: number; drift: number; wraps: boolean };
type Window = { x: number; y: number; w: number; h: number; phase: number };
type Drop = { x: number; y: number };
type Strike = { at: number; bolt: [number, number][][] };

export class Landing {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private margin = 0; // extra width each side of a layer, used up by parallax
  private sky!: HTMLCanvasElement;
  private moon!: { canvas: HTMLCanvasElement; x: number; y: number };
  private back: Layer[] = []; // clouds, behind the lightning
  private far!: Layer; // mountains, silhouetted by the lightning
  private middle: Layer[] = []; // hills and the manor, in front of the bolt
  private manor!: Layer;
  private fogMid!: Layer;
  private front!: Layer;
  private fogNear!: Layer;
  // The candle in the very front: its painted body, where it stands, and
  // where its wick is (the flame and its glow are drawn every frame).
  private candle!: { canvas: HTMLCanvasElement; x: number; y: number; wickX: number; wickY: number; size: number };
  private manorX = 0;
  private manorY = 0;
  private windows: Window[] = [];
  private chimney = { x: 0, y: 0 };
  private rainFar: Drop[] = [];
  private rainNear: Drop[] = [];
  private strike: Strike | null = null;
  private nextStrike = 0;
  private pointer = 0; // -1 (left) to 1 (right)
  private pointerSeen = false;
  private parallax = 0;
  private last = 0;
  private raf = 0;
  private active = false;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
    let pending = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.build());
    });
    window.addEventListener("pointermove", (e) => {
      this.pointer = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerSeen = true;
    });
    this.reduced.addEventListener("change", () => this.setActive(this.active));
    this.build();
  }

  setActive(on: boolean) {
    this.active = on;
    this.canvas.classList.toggle("hidden", !on);
    cancelAnimationFrame(this.raf);
    if (!on) return;
    this.last = performance.now();
    this.nextStrike = this.last + 1500;
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ painting

  private build() {
    const px = Math.max(1, Math.round(Math.min(window.innerHeight / ART_ROWS, window.innerWidth / ART_COLS)));
    const w = (this.w = Math.ceil(window.innerWidth / px));
    const h = (this.h = Math.ceil(window.innerHeight / px));
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w * px}px`;
    this.canvas.style.height = `${h * px}px`;
    this.margin = Math.ceil(w * 0.05) + 4;
    // On wide screens the manor stands to the right of the menu card; on
    // tall ones it stands above it.
    this.manorX = w / h > 1.3 ? Math.round(w * 0.7) : Math.round(w / 2);
    this.manorY = Math.round(h * (w / h < 0.8 ? 0.32 : 0.5));

    const wide = w + this.margin * 2;
    this.sky = this.paintSky();
    this.moon = this.paintMoon();
    this.back = [
      { canvas: this.paintClouds(wide, 0.04, 0.3, "#19132a", "#2e2645", 11), depth: 0.05, drift: 2, wraps: true },
      { canvas: this.paintClouds(wide, 0, 0.09, "#0e0a18", "#211a33", 23), depth: 0.1, drift: 5, wraps: true },
    ];
    this.far = { canvas: this.paintMountains(wide), depth: 0.07, drift: 0, wraps: false };
    this.middle = [{ canvas: this.paintHills(wide), depth: 0.15, drift: 0, wraps: false }];
    this.manor = { canvas: this.paintManor(wide), depth: 0.3, drift: 0, wraps: false };
    this.fogMid = { canvas: this.paintFog(wide, this.manorY + 38, 13, 0.3, 5), depth: 0.45, drift: 4, wraps: true };
    this.front = { canvas: this.paintForeground(wide), depth: 0.8, drift: 0, wraps: false };
    this.fogNear = { canvas: this.paintFog(wide, h - 4, 14, 0.24, 9), depth: 1, drift: 11, wraps: true };
    this.candle = this.paintCandle();

    const r = rng(7);
    const drops = (n: number) => Array.from({ length: Math.round(n) }, () => ({ x: r() * w, y: r() * h }));
    this.rainFar = drops((w * h) / 260);
    this.rainNear = drops((w * h) / 900);
    if (this.active) this.draw(this.last / 1000);
  }

  private paintSky() {
    const { w, h } = this;
    const { canvas, g } = layer(w, h);
    const img = g.createImageData(w, h);
    const pal = SKY.map(rgb);
    const [mx, my] = this.moonAt();
    const glowR = Math.min(w, h) * 0.2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const glow = Math.exp(-Math.hypot(x - mx, (y - my) * 1.3) / glowR) * 0.55;
        const v = Math.min(1, (y / h) * 0.7 + glow) * (pal.length - 1);
        const i = Math.min(pal.length - 1, Math.floor(v) + (v % 1 > threshold(x, y) ? 1 : 0));
        img.data.set([...pal[i], 255], (y * w + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  private moonRadius() {
    return Math.max(6, Math.round(Math.min(this.w, this.h) * 0.055));
  }

  private moonAt(): [number, number] {
    return [Math.min(this.w - 16, this.manorX + 46), Math.max(this.moonRadius() + 6, this.manorY - 62)];
  }

  // The moon sits between the far and near clouds, so storm clouds pass
  // in front of it.
  private paintMoon() {
    const R = this.moonRadius();
    const { canvas, g } = layer(R * 2 + 3, R * 2 + 3);
    const c = R + 1;
    g.fillStyle = MOON.limb;
    ellipse(g, c, c, R, R);
    g.fillStyle = MOON.body;
    ellipse(g, c + 1, c - 1, R - 1, R - 1);
    g.fillStyle = MOON.crater;
    ellipse(g, c - R / 3, c - R / 4, Math.ceil(R / 4), Math.ceil(R / 4));
    ellipse(g, c + R / 3, c - R / 2, Math.ceil(R / 6), Math.ceil(R / 6));
    ellipse(g, c + R / 4, c + R / 3, Math.ceil(R / 6), Math.ceil(R / 6));
    const [x, y] = this.moonAt();
    return { canvas, x: x - c, y: y - c };
  }

  // A strip of storm clouds lit along their tops; it wraps around.
  private paintClouds(width: number, top: number, bottom: number, body: string, rim: string, seed: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    const r = rng(seed);
    const blobs = Array.from({ length: Math.round(width / 9) }, () => ({
      x: r() * width,
      y: h * (top + r() * (bottom - top)),
      rx: 8 + r() * 22,
      ry: 3 + r() * 6,
    }));
    for (const [color, lift] of [[rim, 1], [body, 0]] as const) {
      g.fillStyle = color;
      for (const b of blobs) {
        for (const dx of [-width, 0, width]) ellipse(g, b.x + dx, b.y - lift, Math.round(b.rx), Math.round(b.ry));
      }
    }
    return canvas;
  }

  private paintHills(width: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    for (const [below, amp, color, seed] of [
      [19, 11, "#1d1630", 3],
      [34, 8, "#130e1f", 4],
    ] as const) {
      const ridge = wave(width, seed);
      g.fillStyle = color;
      for (let x = 0; x < width; x++) {
        const y = Math.round(this.manorY + below + ridge(x) * amp);
        g.fillRect(x, y, 1, h - y);
      }
    }
    return canvas;
  }

  // Ridges of jagged mountains far behind the manor, each peak lit on the
  // side that faces the moon, the tallest with a little snow.
  private paintMountains(width: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    const moonX = this.moonAt()[0] + this.margin;
    for (const range of [
      { base: 20, low: 34, high: 72, body: "#231b36", lit: "#2f2647", snow: "#4a4264", rim: "#3a3055", seed: 5, every: 34 },
      { base: 26, low: 18, high: 40, body: "#18122a", lit: "#211a37", snow: "", rim: "#2a2140", seed: 8, every: 26 },
    ]) {
      const r = rng(range.seed);
      const one = layer(width, h);
      const peaks: { x: number; top: number; slope: number }[] = [];
      for (let x = -range.every; x < width + range.every; x += range.every * (0.6 + r() * 0.8)) {
        peaks.push({ x: Math.round(x), top: this.manorY + range.base - (range.low + r() * (range.high - range.low)), slope: 0.7 + r() * 0.7 });
      }
      let jag = 0;
      for (let x = 0; x < width; x++) {
        let best = peaks[0];
        let ridge = Infinity;
        for (const p of peaks) {
          const y = p.top + Math.abs(x - p.x) * p.slope;
          if (y < ridge) [ridge, best] = [y, p];
        }
        jag = Math.max(-2, Math.min(2, jag + Math.round((r() - 0.5) * 2)));
        const y = Math.round(Math.min(ridge, this.manorY + range.base) + jag);
        one.g.fillStyle = range.body;
        one.g.fillRect(x, y, 1, h - y);
        // The face toward the moon catches light, deeper further from the peak.
        if ((x - best.x) * (moonX - best.x) > 0) {
          one.g.fillStyle = range.lit;
          one.g.fillRect(x, y, 1, Math.min(14, Math.round(Math.abs(x - best.x) * 0.45)) + 1);
        }
        if (range.snow && y - best.top < 4 && best.top < this.manorY + range.base - range.high * 0.8) {
          one.g.fillStyle = range.snow;
          one.g.fillRect(x, y, 1, 2);
        }
      }
      rimLight(one.g, range.rim, range.lit);
      g.drawImage(one.canvas, 0, 0);
    }
    return canvas;
  }

  private paintManor(width: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    const r = rng(42);
    const ox = this.manorX + this.margin;
    const oy = this.manorY;

    // The hill: flat on top where the manor stands, then falling away.
    const crest = 49;
    const hw = Math.min(width * 0.4, 150);
    const bumps = wave(width, 12);
    g.fillStyle = "#0b0812";
    for (let x = 0; x < width; x++) {
      const d = Math.max(0, Math.abs(x - ox) - crest);
      const t = Math.min(1.6, d / hw);
      const y = Math.round(oy + 1 + t ** 1.4 * 53 + bumps(x) * 3 * Math.min(1, d / 12));
      g.fillRect(x, y, 1, h - y);
    }
    // Rocks at the edges of the crest.
    ellipse(g, ox - crest, oy + 2, 4, 2);
    ellipse(g, ox + crest - 1, oy + 2, 5, 2);
    ellipse(g, ox - crest + 9, oy + 1, 3, 1);

    // The manor, in art pixels from the middle of its base, heights going up.
    const fill = (x0: number, x1: number, h0: number, h1: number) => g.fillRect(ox + x0, oy - h1 + 1, x1 - x0 + 1, h1 - h0);
    // A pointed roof whose bottom row is at height `at`.
    const roof = (x0: number, x1: number, at: number, tall: number) => {
      const mid = (x0 + x1) / 2;
      for (let i = 0; i < tall; i++) {
        const half = ((x1 - x0) / 2) * (1 - i / tall);
        g.fillRect(ox + Math.round(mid - half), oy - at - i, Math.round(mid + half) - Math.round(mid - half) + 1, 1);
      }
    };
    // West wing with a steep gable and a chimney.
    fill(-46, -31, 0, 18);
    roof(-47, -30, 19, 10);
    fill(-43, -41, 22, 32);
    fill(-44, -40, 32, 33);
    // The house, under a mansard roof crowned with iron cresting.
    fill(-30, 30, 0, 26);
    [-1, 0, 1, 1, 2, 2, 3, 3, 6, 9].forEach((inset, i) => fill(-30 + inset, 30 - inset, 27 + i, 27 + i));
    for (let x = -20; x <= 20; x += 2) fill(x, x, 37, 37);
    fill(-27, -24, 26, 43); // chimneys
    fill(-28, -23, 43, 44);
    // Dormers in the mansard.
    for (const x of [-22, -14, 11]) {
      fill(x, x + 3, 27, 32);
      roof(x - 1, x + 4, 33, 3);
    }
    // The front gable over the door, with a porch roof.
    fill(-7, 7, 0, 30);
    roof(-9, 9, 31, 13);
    fill(-10, 10, 9, 10);
    // The turret, under a flared witch's-hat roof.
    fill(22, 32, 0, 44);
    fill(21, 33, 45, 45);
    roof(21, 33, 46, 18);
    fill(27, 27, 64, 67);
    // The conservatory on the east side.
    fill(33, 44, 0, 14);
    for (let i = 0; i < 5; i++) fill(33 + i, 44 - i, 15 + i, 15 + i);

    rimLight(g, "#2b2340", "#221b33");

    // The drive winding up to the door.
    g.fillStyle = "#1b1526";
    const path: [number, number][] = [
      [ox + 26, h + 1],
      [ox - 30, oy + 60],
      [ox + 22, oy + 34],
      [ox - 10, oy + 13],
      [ox, oy + 1],
    ];
    for (let i = 1; i < path.length; i++) line(g, ...path[i - 1], ...path[i]);
    // Firelight through the front door.
    g.fillStyle = "#3a1c0a";
    g.fillRect(ox - 2, oy - 6, 4, 7);
    g.fillRect(ox - 1, oy - 7, 2, 1);

    // Windows: [x, height of the top row, width, rows].
    const slots: [number, number, number, number][] = [
      [-42, 8, 2, 3], [-36, 8, 2, 3], [-42, 15, 2, 3], [-36, 15, 2, 3], [-39, 24, 2, 2],
      [-26, 8, 2, 3], [-20, 8, 2, 3], [-14, 8, 2, 3], [13, 8, 2, 3], [18, 8, 2, 3],
      [-26, 20, 2, 3], [-20, 20, 2, 3], [-14, 20, 2, 3], [13, 20, 2, 3], [18, 20, 2, 3],
      [-1, 21, 3, 4], [-1, 36, 2, 2], [-21, 31, 2, 3], [-13, 31, 2, 3], [12, 31, 2, 3],
      [26, 9, 2, 3], [26, 20, 2, 3], [26, 31, 2, 3], [26, 41, 2, 2],
      [35, 10, 2, 5], [39, 10, 2, 5],
    ];
    this.windows = slots.map(([x, y, ww, wh]) => ({ x: ox + x, y: oy - y + 1, w: ww, h: wh, phase: r() * 100 }));
    this.chimney = { x: ox - 26, y: oy - 45 };
    return canvas;
  }

  // A wrapping band of fog, dithered into three pixel densities.
  private paintFog(width: number, centre: number, thick: number, alpha: number, seed: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    const img = g.createImageData(width, h);
    const sway = wave(width, seed);
    const puff = wave(width, seed + 1);
    for (let x = 0; x < width; x++) {
      const yc = centre + sway(x) * thick * 0.8;
      const density = 0.65 + 0.35 * puff(x);
      for (let y = Math.max(0, Math.floor(yc - thick * 2.5)); y < Math.min(h, yc + thick * 2.5); y++) {
        const d = (y - yc) / thick;
        const v = Math.exp(-d * d) * density * 3;
        const level = Math.min(3, Math.floor(v) + (v % 1 > threshold(x, y) ? 1 : 0));
        if (level) img.data.set([150, 148, 190, Math.round((level / 3) * alpha * 255)], (y * width + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  private paintForeground(width: number) {
    const { h } = this;
    const { canvas, g } = layer(width, h);
    const r = rng(99);
    const ground = (x: number) => Math.round(h * 0.9 + Math.sin(x * 0.05) * 2 + Math.sin(x * 0.13 + 1) * 1);
    g.fillStyle = "#040306";
    for (let x = 0; x < width; x++) g.fillRect(x, ground(x), 1, h);

    // A dead tree, branching and twisting.
    const branch = (x: number, y: number, angle: number, length: number, size: number, depth: number) => {
      let cx = x;
      let cy = y;
      for (let i = 0; i < 3; i++) {
        angle += (r() - 0.5) * 0.5;
        const nx = cx + (Math.cos(angle) * length) / 3;
        const ny = cy + (Math.sin(angle) * length) / 3;
        line(g, cx, cy, nx, ny, size);
        cx = nx;
        cy = ny;
      }
      if (depth >= 5 || length < 4) return;
      const kids = 2 + (r() < 0.3 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const spread = (k / (kids - 1) - 0.5) * 1.4 + (r() - 0.5) * 0.4;
        branch(cx, cy, angle + spread, length * (0.62 + r() * 0.15), Math.max(1, size - 1), depth + 1);
      }
    };
    // The tree frames the manor from the right edge.
    const tx = this.margin + Math.round(this.w * 0.97);
    branch(tx, ground(tx), -Math.PI / 2, Math.min(h, this.w) * 0.16, 3, 0);
    line(g, tx - 4, ground(tx), tx - 7, ground(tx) + 2, 2); // roots
    line(g, tx + 3, ground(tx), tx + 7, ground(tx) + 1, 2);

    // Gravestones and crosses.
    for (let i = 0; i < width / 34; i++) {
      const x = Math.round(r() * width);
      if (Math.abs(x - tx) < 14) continue;
      const y = ground(x) + 1;
      const sh = 5 + Math.floor(r() * 7);
      if (r() < 0.35) {
        g.fillRect(x, y - sh, 2, sh);
        g.fillRect(x - 2, y - sh + 2, 6, 2);
      } else {
        const sw = 4 + Math.floor(r() * 3);
        g.fillRect(x, y - sh, sw, sh);
        g.clearRect(x, y - sh, 1, 1);
        g.clearRect(x + sw - 1, y - sh, 1, 1);
      }
    }

    // A stretch of broken iron fence.
    const f0 = Math.round(width * 0.36);
    for (let x = f0; x < width * 0.62; x += 4) {
      if (r() < 0.12) continue;
      const y = ground(x);
      g.fillRect(x, y - 11, 1, 11);
      g.fillRect(x - 1, y - 11, 3, 1);
      g.fillRect(x, y - 13, 1, 2);
      g.fillRect(x - 3, y - 9, 4, 1);
      g.fillRect(x - 3, y - 3, 4, 1);
    }
    rimLight(g, "#17111f", "#0e0a15");
    return canvas;
  }

  // ------------------------------------------------------------ animation

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const still = this.reduced.matches;
    if (!still) {
      // The view sways gently until the pointer moves, then follows it.
      const target = this.pointerSeen ? this.pointer : Math.sin(now / 9000) * 0.4;
      this.parallax += (target - this.parallax) * Math.min(1, dt * 2.5);
      this.fall(this.rainFar, 150 * dt);
      this.fall(this.rainNear, 280 * dt);
      if (now >= this.nextStrike) this.lightning(now);
    }
    this.draw(now / 1000);
    // With reduced motion the scene is drawn once and stays still.
    if (!still) this.raf = requestAnimationFrame(this.frame);
  };

  private fall(drops: Drop[], dy: number) {
    for (const d of drops) {
      d.y += dy;
      d.x -= dy * 0.25;
      if (d.y > this.h) {
        d.y -= this.h + 6;
        d.x = Math.random() * (this.w + this.h * 0.25);
      }
    }
  }

  private lightning(now: number) {
    const { w, h } = this;
    const fork = (x: number, y: number, until: number): [number, number][] => {
      const pts: [number, number][] = [[x, y]];
      while (y < until) {
        x += Math.round((Math.random() - 0.5) * 8);
        y += 3 + Math.round(Math.random() * 4);
        pts.push([x, y]);
      }
      return pts;
    };
    const main = fork(Math.round(w * (0.15 + Math.random() * 0.8)), Math.round(h * 0.08), this.manorY + Math.random() * 30);
    const bolt = [main];
    for (let i = 0; i < 2; i++) {
      const [x, y] = main[2 + Math.floor(Math.random() * (main.length - 4))] ?? main[0];
      bolt.push(fork(x, y, y + 15));
    }
    this.strike = { at: now, bolt };
    this.nextStrike = now + 4000 + Math.random() * 7000;
    const near = Math.random();
    setTimeout(() => sfx.thunder(0.15 + near * 0.35), 300 + (1 - near) * 1500);
  }

  // How bright the sky is: two quick flickers, then a fade.
  private flash(now: number) {
    if (!this.strike) return 0;
    const t = (now - this.strike.at) / 1000;
    if (t < 0.08) return 1;
    if (t < 0.16) return 0.25;
    if (t < 0.26) return 0.85;
    return Math.max(0, 0.85 * (1 - (t - 0.26) / 0.6));
  }

  private place(l: Layer, t: number) {
    const shift = Math.round(-this.parallax * this.margin * l.depth - (this.reduced.matches ? 0 : l.drift * t));
    const g = this.g;
    if (!l.wraps) {
      g.drawImage(l.canvas, shift - this.margin, 0);
      return shift - this.margin;
    }
    const tw = l.canvas.width;
    const x0 = (((shift - this.margin) % tw) + tw) % tw - tw;
    g.drawImage(l.canvas, x0, 0);
    g.drawImage(l.canvas, x0 + tw, 0);
    return 0;
  }

  private draw(t: number) {
    const g = this.g;
    const now = t * 1000;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.sky, 0, 0);
    this.place(this.back[0], t);
    const m = this.moon;
    g.drawImage(m.canvas, m.x + Math.round(-this.parallax * this.margin * 0.02), m.y);
    this.place(this.back[1], t);

    const flash = this.flash(now);
    if (flash > 0) {
      g.globalCompositeOperation = "screen";
      g.fillStyle = `rgba(150, 140, 255, ${flash * 0.55})`;
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = "source-over";
    }
    this.place(this.far, t);
    if (this.strike && flash > 0.5) {
      for (const [color, size] of [["#7d74d8", 3], ["#f4f1ff", 1]] as const) {
        g.fillStyle = color;
        for (const f of this.strike.bolt) {
          for (let i = 1; i < f.length; i++) line(g, ...f[i - 1], ...f[i], f === this.strike.bolt[0] ? size : Math.max(1, size - 1));
        }
      }
    }

    for (const l of this.middle) this.place(l, t);
    const cx = this.place(this.manor, t);
    for (const win of this.windows) {
      // Most windows flicker like candlelight; now and then one goes dark.
      if (Math.sin(t * 0.21 + win.phase * 7) < -0.85) continue;
      const v = Math.sin(t * 9 + win.phase) + Math.sin(t * 13.7 + win.phase * 3);
      g.fillStyle = v > 0.6 ? "#ffd27a" : v > -0.8 ? "#ffa640" : "#c8641e";
      g.fillRect(win.x + cx, win.y, win.w, win.h);
    }
    this.smoke(t, cx);
    this.bats(t, cx);

    this.rain(this.rainFar, 3, "rgba(150, 160, 205, 0.28)");
    this.place(this.fogMid, t);
    this.place(this.front, t);
    this.rain(this.rainNear, 6, "rgba(175, 185, 225, 0.45)");
    this.place(this.fogNear, t);
    this.drawCandle(t);

    if (flash > 0) {
      g.fillStyle = `rgba(200, 200, 255, ${flash * 0.12})`;
      g.fillRect(0, 0, this.w, this.h);
    }
  }

  // Smoke curling from the chimney and blowing away with the storm.
  private smoke(t: number, cx: number) {
    if (this.reduced.matches) return;
    const g = this.g;
    for (let i = 0; i < 7; i++) {
      const age = (t * 0.35 + i / 7) % 1;
      g.fillStyle = `rgba(120, 112, 140, ${(0.35 * (1 - age)).toFixed(2)})`;
      const size = 2 + Math.round(age * 2);
      g.fillRect(Math.round(this.chimney.x + cx - age * 18 + Math.sin(t * 2 + i) * 1.5), Math.round(this.chimney.y - age * 14), size, size);
    }
  }

  // A tall candle in a brass holder, nearest of all: cream wax with a lit
  // and a shaded side, a melted cup at the top and drips down the sides.
  private paintCandle() {
    const { w, h } = this;
    const ch = Math.max(30, Math.round(Math.min(h, w * 1.2) * 0.26)); // wax height
    const cw = Math.max(8, Math.round(ch * 0.22)); // wax width
    const dw = cw * 3; // the dish
    const W = dw + 12;
    const H = ch + 9;
    const { canvas, g } = layer(W, H);
    const r = rng(77);
    const px = (x: number, y: number, ww: number, hh: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, ww, hh);
    };
    const cx = Math.floor(dw / 2) + 1; // the candle's middle
    const x0 = cx - Math.floor(cw / 2);
    // The brass dish, with a ring handle on the right.
    const dishY = H - 6;
    for (let i = 0; i < 5; i++) {
      const half = Math.round(dw / 2 - (i === 0 ? 2 : i === 4 ? 3 : 0));
      px(cx - half, dishY + i, half * 2, 1, i === 0 ? "#e0b050" : i === 1 ? "#a8782a" : i < 4 ? "#8a5a1c" : "#5a3a10");
    }
    for (const [dx, dy] of [[1, 0], [2, 0], [3, 1], [3, 2], [3, 3], [2, 4], [1, 4], [0, 3], [0, 1], [0, 2]]) px(cx + dw / 2 + 1 + dx, dishY - 3 + dy, 1, 1, "#a8782a");
    px(cx - 2, dishY - 1, 5, 1, "#c89a3a"); // the cup the candle stands in
    // Wax: lit left edge, cream middle, shaded right.
    const top = 2;
    for (let x = x0; x < x0 + cw; x++) {
      const u = x - x0;
      const c = u === 0 ? "#b0a078" : u < 3 ? "#f6eedc" : u >= cw - 2 ? "#c8b890" : u === cw - 3 ? "#d8cca8" : "#e8dcc0";
      px(x, top + 1, 1, dishY - top - 2, c);
    }
    px(x0 + 1, top, cw - 2, 1, "#d8c8a0");
    px(x0 + 2, top + 1, cw - 4, 1, "#c8b48a"); // the melted pool
    // Drips down the sides and one pooled on the dish.
    for (let i = 0; i < 3; i++) {
      const dx = i === 0 ? x0 : i === 1 ? x0 + cw - 1 : x0 + 2 + Math.floor(r() * (cw - 4));
      const len = 4 + Math.floor(r() * ch * 0.35);
      px(dx, top + 1, i === 2 ? 2 : 1, len, "#f2e8d0");
      px(dx - (i === 0 ? 1 : 0), top + len, 2, 2, "#f2e8d0");
    }
    px(x0 - 2, dishY - 1, 4, 1, "#efe4c8");
    // The wick.
    px(cx, 0, 1, top + 1, "#2a1a10");
    const x = Math.round(w * 0.84) - cx;
    return { canvas, x, y: h - H + 1, wickX: cx, wickY: 0, size: ch };
  }

  // The candle's flame flickers and lights the scene around it.
  private drawCandle(t: number) {
    const g = this.g;
    const c = this.candle;
    const shift = Math.round(-this.parallax * this.margin * 1.2);
    const still = this.reduced.matches;
    const f = still ? 1 : 0.9 + 0.12 * Math.sin(t * 9) + 0.06 * Math.sin(t * 23 + 1);
    const fx = c.x + shift + c.wickX;
    const fy = c.y + c.wickY;
    // Warm light in hard rings, added onto the scene.
    g.globalCompositeOperation = "lighter";
    const R = c.size * 1.5 * f;
    for (const [k, a] of [[1, 0.05], [0.7, 0.06], [0.45, 0.08], [0.25, 0.1]]) {
      g.fillStyle = `rgba(255, 160, 70, ${a})`;
      for (let dy = -Math.round(R * k); dy <= Math.round(R * k); dy++) {
        const half = Math.floor(Math.sqrt((R * k) ** 2 - dy * dy));
        g.fillRect(fx - half, fy + dy, half * 2 + 1, 1);
      }
    }
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(0, 0, 0, 0.45)";
    g.fillRect(c.x + shift + 2, c.y + c.canvas.height - 2, c.canvas.width - 10, 2);
    g.drawImage(c.canvas, c.x + shift, c.y);
    // The flame: pixel rows, widest low down, swaying at the tip.
    const fh = Math.max(6, Math.round(c.size * 0.24 * f));
    const fw = Math.max(4, Math.round(c.size * 0.12));
    for (let r = 0; r < fh; r++) {
      const v = r / fh; // 0 at the tip, 1 at the base
      const half = Math.max(0, Math.round((fw / 2) * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.1)) ** 0.7));
      const sway = still ? 0 : Math.round(Math.sin(t * 5 + r * 0.5) * (1 - v) * 1.5);
      const y = fy - fh + r;
      g.fillStyle = "#ff7a1a";
      g.fillRect(fx - half + sway, y, half * 2 + 1, 1);
      if (v > 0.3 && half > 0) {
        g.fillStyle = "#ffd27a";
        g.fillRect(fx - half + 1 + sway, y, Math.max(1, half * 2 - 1), 1);
      }
      if (v > 0.6 && half > 1) {
        g.fillStyle = "#fff3c4";
        g.fillRect(fx - half + 2 + sway, y, Math.max(1, half * 2 - 3), 1);
      }
    }
    g.fillStyle = "#6a8aff";
    g.fillRect(fx, fy - 1, 1, 1);
  }

  private bats(t: number, cx: number) {
    if (this.reduced.matches) return;
    const g = this.g;
    g.fillStyle = "#050308";
    for (let i = 0; i < 3; i++) {
      const a = t * (0.35 + i * 0.07) + i * 2.1;
      const x = Math.round(this.manorX + this.margin + cx + Math.cos(a) * (40 + i * 12));
      const y = Math.round(this.manorY - 62 + Math.sin(a * 1.7) * 10 + i * 6);
      const up = Math.floor(t * 8 + i) % 2 === 0;
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x - 2, y + (up ? -1 : 1), 1, 1);
      g.fillRect(x + 2, y + (up ? -1 : 1), 1, 1);
    }
  }

  private rain(drops: Drop[], length: number, color: string) {
    const g = this.g;
    g.fillStyle = color;
    for (const d of drops) {
      for (let i = 0; i < length; i++) g.fillRect(Math.round(d.x + i * 0.25), Math.round(d.y - i), 1, 1);
    }
  }
}
