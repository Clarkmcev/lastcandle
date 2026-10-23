// The loading screen's art: the front door of Ravenscroft Manor on the
// night of the party, painted in code like the rest of the pixel art. Two
// lanterns flicker either side of the door, warm light spills from the
// crack where it stands ajar, and the rain keeps falling. The arriving
// character walks up the steps in front of it (an HTML sprite, see ui.ts).

import { dither, rng } from "./pixel";

const W = 128; // art pixels; the canvas is scaled up crisply with CSS
const H = 96;

// Where things stand, in art pixels.
const DOOR = { x: 46, y: 26, w: 36, h: 50 }; // the doorway, arch included
const STEPS_Y = 76;
const LANTERNS = [30, 97]; // lantern centres
const LANTERN_Y = 40;

export class LoadingArt {
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private drops: { x: number; y: number; v: number }[] = [];
  private raf = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.g = canvas.getContext("2d")!;
    this.base = this.paint();
    const r = rng(5);
    this.drops = Array.from({ length: 24 }, () => ({ x: r() * W, y: r() * H, v: 40 + r() * 40 }));
  }

  start() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.draw(now / 1000, dt);
      if (!this.reduced) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private paint() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };

    // Night sky above the porch roof, dithered towards the horizon.
    const sky = ["#07060d", "#0e0b18", "#161226", "#1f1932"];
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < W; x++) {
        const v = (y / 18) * (sky.length - 1);
        px(x, y, 1, 1, sky[Math.min(sky.length - 1, Math.floor(v) + (v % 1 > dither(x, y) ? 1 : 0))]);
      }
    }
    // The porch roof: dark slates with a lit edge.
    for (let y = 12; y < 20; y++) {
      const inset = (19 - y) * 2;
      px(inset - 8, y, W - inset * 2 + 16, 1, y % 2 ? "#1a1420" : "#221a2a");
    }
    px(0, 19, W, 1, "#3a2e44");
    // Stone wall: staggered blocks with lit tops.
    for (let y = 20; y < STEPS_Y; y++) {
      for (let x = 0; x < W; x++) {
        const row = Math.floor((y - 20) / 5);
        const off = row % 2 ? 4 : 0;
        const col = Math.floor((x + off) / 8);
        const mortar = (y - 20) % 5 === 0 || (x + off) % 8 === 0;
        px(x, y, 1, 1, mortar ? "#1e1a22" : (row + col) % 2 ? "#2c2630" : "#2f2934");
      }
    }
    // The doorway: a stone arch, then the dark wood doors, one ajar.
    const { x: dx, y: dy, w: dw, h: dh } = DOOR;
    const arch = (inset: number, col: string) => {
      const rad = (dw - inset * 2) / 2;
      for (let y = 0; y < dh - inset; y++) {
        const yy = dy + inset + y;
        let half = rad;
        if (y < rad) half = Math.sqrt(rad * rad - (rad - y) ** 2);
        px(Math.round(dx + dw / 2 - half), yy, Math.round(half * 2), 1, col);
      }
    };
    arch(-3, "#4a4250");
    arch(-2, "#5e5664");
    arch(0, "#120c08");
    arch(2, "#3a2414");
    // Planks and iron bands on both leaves.
    for (let x = dx + 2; x < dx + dw - 2; x += 4) px(x, dy + 6, 1, dh - 8, "#2a170c");
    for (const by of [dy + 16, dy + 36]) px(dx + 2, by, dw - 4, 2, "#1a1414");
    // Ring knockers.
    for (const kx of [dx + dw / 2 - 6, dx + dw / 2 + 5]) {
      px(kx - 1, dy + 26, 3, 1, "#c8a040");
      px(kx - 2, dy + 27, 1, 3, "#c8a040");
      px(kx + 2, dy + 27, 1, 3, "#c8a040");
      px(kx - 1, dy + 30, 3, 1, "#c8a040");
    }
    // The keystone and a carved R.
    px(dx + dw / 2 - 3, dy - 3, 6, 5, "#6e6674");
    px(dx + dw / 2 - 1, dy - 2, 1, 3, "#2a2430");
    px(dx + dw / 2, dy - 2, 1, 1, "#2a2430");
    px(dx + dw / 2 + 1, dy, 1, 1, "#2a2430");
    // The steps.
    for (let i = 0; i < 3; i++) {
      const y = STEPS_Y + i * 6;
      const inset = 24 - i * 10;
      px(DOOR.x - inset, y, DOOR.w + inset * 2, 6, ["#4a4250", "#3e3644", "#332c38"][i]);
      px(DOOR.x - inset, y, DOOR.w + inset * 2, 1, "#6a6270");
    }
    px(0, STEPS_Y + 18, W, H, "#141018");
    // Lantern brackets.
    for (const lx of LANTERNS) {
      px(lx - 1, LANTERN_Y - 9, 3, 2, "#1a1414");
      px(lx - 4, LANTERN_Y - 7, 9, 2, "#1a1414");
      px(lx - 3, LANTERN_Y - 5, 7, 11, "#1a1414");
      px(lx - 4, LANTERN_Y + 6, 9, 2, "#1a1414");
      px(lx, LANTERN_Y + 8, 1, 3, "#1a1414");
    }
    return c;
  }

  private draw(t: number, dt: number) {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0);
    const still = this.reduced;

    // Light through the door left ajar, flickering like a fire inside.
    const f = still ? 1 : 0.95 + 0.05 * Math.sin(t * 3);
    const cx = DOOR.x + DOOR.w / 2;
    g.fillStyle = "#ffb347";
    g.fillRect(cx, DOOR.y + 4, 1, DOOR.h - 4);
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(255, 150, 60, ${(0.12 - i * 0.025) * f})`;
      g.fillRect(cx - 1 - i * 3, STEPS_Y + i * 2, 3 + i * 6, 18 - i * 2);
    }
    // The lanterns and the pools of light they throw.
    for (const [i, lx] of LANTERNS.entries()) {
      const lf = still ? 1 : 0.95 + 0.05 * Math.sin(t * 2 + i * 2);
      for (const [rad, a] of [[22, 0.05], [15, 0.07], [9, 0.1]] as const) {
        g.fillStyle = `rgba(255, 170, 80, ${a * lf})`;
        for (let dy = -rad; dy <= rad; dy++) {
          const half = Math.floor(Math.sqrt(rad * rad - dy * dy));
          g.fillRect(lx - half, LANTERN_Y + dy, half * 2 + 1, 1);
        }
      }
    }
    g.globalCompositeOperation = "source-over";
    for (const lx of LANTERNS) {
      const tall = 4;
      g.fillStyle = "#ffd27a";
      g.fillRect(lx - 2, LANTERN_Y - 3, 5, 8);
      g.fillStyle = "#ff8a2a";
      g.fillRect(lx - 1, LANTERN_Y + 5 - tall - 2, 3, tall + 1);
      g.fillStyle = "#fff3c4";
      g.fillRect(lx, LANTERN_Y + 1, 1, 2);
      g.fillStyle = "#1a1414";
      g.fillRect(lx, LANTERN_Y - 3, 1, 8); // the frame's middle bar
    }
    // Rain, slanting past the porch.
    g.fillStyle = "rgba(160, 175, 220, 0.22)";
    for (const d of this.drops) {
      if (!still) {
        d.y += d.v * dt;
        d.x -= d.v * dt * 0.2;
        if (d.y > H) {
          d.y -= H + 4;
          d.x = Math.random() * (W + 20);
        }
      }
      g.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
    }
  }
}
