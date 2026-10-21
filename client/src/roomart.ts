// Pixel-art interiors for the manor, painted in code like the characters.
// Every room has its own floor, wallpaper on its north wall (the one wall
// face a top-down view shows) and its own furniture and wall decorations.
//
// The art is 16 pixels per tile and the scene shows it at 2×, the same
// scale as the characters. Decoration is only paint: what blocks movement
// and light is still the tile grid the server sends. Furniture is placed
// relative to each room's walls, so it fits any configured room size, and
// it keeps clear of doors, hearths, mirrors, the table and the altar.

import type { MapView, Rect, Room } from "./protocol";

export const ART = 16; // art pixels per tile

type RGB = [number, number, number];
type Paint = (x: number, y: number) => RGB;

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
// f > 0 lightens towards white, f < 0 darkens towards black.
const shade = (c: RGB, f: number): RGB => c.map((v) => (f >= 0 ? v + (255 - v) * f : v * (1 + f))) as RGB;

// A repeatable 0..1 value for each (x, y, salt), so the art is the same on
// every machine and every match.
function hash(x: number, y: number, salt = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const WOOD = { dark: "#2a170c", mid: "#4a2c16", light: "#6e4424", hi: "#8a5a30" };
const GOLD = { dark: "#6a4e1a", mid: "#a8802e", hi: "#e0c060" };
const IRON = { dark: "#16151a", mid: "#2c2b33", hi: "#55545e" };
const STONE = { dark: "#3a3632", mid: "#5e5850", hi: "#8a8478" };
const CANDLE = "#e8dcc0";
const FLAME = "#ffb347";
const BOOKS = ["#7a2a2a", "#2a4a6a", "#2f5a34", "#6a5a2a", "#4a2a5a", "#8a6a3a", "#5a2a1a", "#3a3a4a"];

// ------------------------------------------------------------ surfaces

// Floorboards four pixels wide with staggered joints.
function planks(base: string, len = 24): Paint {
  const c = rgb(base);
  return (x, y) => {
    const row = y >> 2;
    const off = (row * 7) % len;
    const seg = Math.floor((x + off) / len);
    let f = (hash(row, seg, 1) - 0.5) * 0.18 + (hash(x >> 1, y, 2) - 0.5) * 0.05;
    if ((y & 3) === 3) f -= 0.35;
    else if ((x + off) % len === 0) f -= 0.3;
    else if ((y & 3) === 0) f += 0.05;
    return shade(c, f);
  };
}

// Stone or tile laid in rows (staggered unless `grid`), with mortar lines.
function stones(base: string, w: number, h: number, vary = 0.14, grid = false, mortar = -0.45): Paint {
  const c = rgb(base);
  return (x, y) => {
    const row = Math.floor(y / h);
    const off = !grid && row & 1 ? w >> 1 : 0;
    const col = Math.floor((x + off) / w);
    if (y % h === 0 || (x + off) % w === 0) return shade(c, mortar);
    let f = (hash(row, col, 3) - 0.5) * vary * 2 + (hash(x, y, 4) - 0.5) * 0.06;
    if (y % h === 1 || (x + off) % w === 1) f += 0.07;
    return shade(c, f);
  };
}

// Polished squares with faint veins.
function checker(a: string, b: string, size: number): Paint {
  const ca = rgb(a);
  const cb = rgb(b);
  return (x, y) => {
    const c = (Math.floor(x / size) + Math.floor(y / size)) & 1 ? ca : cb;
    let f = (hash(x, y, 5) - 0.5) * 0.05;
    if (x % size === 0 || y % size === 0) f -= 0.15;
    if (hash(x >> 1, (y + x) >> 1, 6) < 0.035) f += 0.12;
    return shade(c, f);
  };
}

// Basket-weave parquet: 8-pixel blocks of planks turning each way.
function weave(base: string): Paint {
  const c = rgb(base);
  return (x, y) => {
    const bx = x >> 3;
    const by = y >> 3;
    const across = ((bx + by) & 1) === 0;
    const along = across ? y : x;
    let f = (hash(bx * 2 + (across ? 0 : 1), along >> 2, 7) - 0.5) * 0.16 + (hash(x, y, 8) - 0.5) * 0.05;
    if ((along & 3) === 3) f -= 0.28;
    if ((x & 7) === 0 || (y & 7) === 0) f -= 0.12;
    return shade(c, f);
  };
}

function mossy(inner: Paint, moss: string): Paint {
  const m = rgb(moss);
  return (x, y) => (hash(x >> 1, y >> 1, 9) < 0.07 ? shade(m, (hash(x, y, 10) - 0.5) * 0.2) : inner(x, y));
}

// Wood panelling: framed vertical panels.
function panels(base: string): Paint {
  const c = rgb(base);
  return (x, y) => {
    const u = x % 8;
    let f = (hash(x >> 3, 0, 11) - 0.5) * 0.08 + (hash(x, y, 12) - 0.5) * 0.04;
    if (u === 0) f -= 0.35;
    else if (u === 1) f += 0.12;
    else if (u === 7) f -= 0.15;
    return shade(c, f);
  };
}

function stripes(base: string, accent: string): Paint {
  const c = rgb(base);
  const a = rgb(accent);
  return (x, y) => shade(x % 6 < 2 ? a : c, (hash(x, y, 13) - 0.5) * 0.06);
}

function damask(base: string, accent: string): Paint {
  const c = rgb(base);
  const a = rgb(accent);
  return (x, y) => {
    const d = Math.abs((x % 8) - 4) + Math.abs(((y + ((x >> 3) & 1) * 4) % 8) - 4);
    return shade(d === 3 || d === 0 ? a : c, (hash(x, y, 14) - 0.5) * 0.05);
  };
}

function stars(base: string, accent: string): Paint {
  const c = rgb(base);
  const a = rgb(accent);
  return (x, y) => {
    const u = x % 8;
    const v = (y + ((x >> 3) & 1) * 4) % 8;
    const star = (u === 3 && v >= 2 && v <= 4) || (v === 3 && u >= 2 && u <= 4);
    return shade(star ? a : c, (hash(x, y, 15) - 0.5) * 0.05);
  };
}

// The conservatory's north wall is all glass: night outside, rain running.
function glass(): Paint {
  const frame = rgb("#3a4a3a");
  return (x, y) => {
    if (x % 8 === 0 || y % 6 === 0) return frame;
    const top = rgb("#0c1626");
    const rain = hash(x, y >> 1, 16) < 0.05;
    return rain ? rgb("#4a6a8a") : shade(top, (y % 16) / 40 + (hash(x, y, 17) - 0.5) * 0.05);
  };
}

// Wood wainscot below, wallpaper above.
function wainscot(upper: Paint, lower: string): Paint {
  const wood = panels(lower);
  return (x, y) => ((y & 15) >= 8 ? ((y & 15) === 8 ? rgb(WOOD.hi) : wood(x, y)) : upper(x, y));
}

interface Style {
  floor: Paint;
  wall: Paint;
  web?: boolean; // cobwebs in the corners
}

const STYLES: Record<string, Style> = {
  library: { floor: planks("#4a3423"), wall: panels("#3b2616"), web: true },
  chapel: { floor: stones("#4a4c56", 8, 6), wall: stones("#5a5a62", 8, 4), web: true },
  nursery: { floor: planks("#7a5e44", 20), wall: stars("#6e4f5c", "#a88596"), web: true },
  study: { floor: weave("#5a3e26"), wall: stripes("#23382c", "#2d4636") },
  dining: { floor: weave("#4a2e1c"), wall: damask("#4e1a1e", "#7a3a2c") },
  ballroom: { floor: checker("#b9ad8c", "#2c2a2e", 8), wall: panels("#6e5a32") },
  conservatory: { floor: mossy(stones("#4c5a50", 8, 8, 0.1, true), "#3d5a2c"), wall: glass() },
  entrance: { floor: checker("#8a7e6a", "#3c342c", 16), wall: wainscot(damask("#3e1a22", "#5a2a30"), "#3b2616") },
  kitchen: { floor: stones("#7a4a30", 8, 8, 0.1, true), wall: stones("#a8a090", 4, 3, 0.05, false, -0.2) },
  cellar: { floor: stones("#3a3632", 6, 5, 0.2), wall: stones("#3c3833", 7, 4, 0.18), web: true },
};
const HALL: Style = { floor: planks("#3a2c20"), wall: panels("#3b2616") };

// ------------------------------------------------------------ painter

export function paintManor(view: MapView): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = view.w * ART;
  canvas.height = view.h * ART;
  new Painter(view, canvas.getContext("2d")!).paint();
  return canvas;
}

class Painter {
  private roomOf: Int16Array;
  private used: Uint8Array; // tiles furniture must not cover
  private faceUsed = new Set<number>();

  constructor(
    private view: MapView,
    private g: CanvasRenderingContext2D,
  ) {
    const { w, h } = view;
    this.roomOf = new Int16Array(w * h).fill(-1);
    view.rooms.forEach((r, i) => {
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) this.roomOf[y * w + x] = i;
    });
    this.used = new Uint8Array(w * h);
    const keep = (x: number, y: number, pad: number) => {
      for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) this.mark(x + dx, y + dy);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = this.tile(x, y);
        if (t !== ".") this.mark(x, y);
        if (t === "." && this.room(x, y) < 0) keep(x, y, 1); // doorways
      }
    }
    for (const p of [...view.hearths, ...view.mirrors, ...(view.passages ?? []).flat()]) keep(Math.floor(p.x), Math.floor(p.y), 1);
    for (const r of [view.table, view.altar]) {
      for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) this.mark(x, y);
    }
  }

  private tile(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.view.w && y < this.view.h ? this.view.rows[y][x] : "#";
  }

  private room(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.view.w && y < this.view.h ? this.roomOf[y * this.view.w + x] : -1;
  }

  private mark(x: number, y: number) {
    if (x >= 0 && y >= 0 && x < this.view.w && y < this.view.h) this.used[y * this.view.w + x] = 1;
  }

  private styleAt(x: number, y: number) {
    const r = this.room(x, y);
    return r >= 0 ? STYLES[this.view.rooms[r].id] ?? HALL : HALL;
  }

  // A wall tile is a wall face when a room lies just south of it.
  private isFace(x: number, y: number) {
    return this.tile(x, y) === "#" && this.room(x, y + 1) >= 0;
  }

  paint() {
    this.surfaces();
    this.shadows();
    this.view.rooms.forEach((r) => this.decorate(r));
    this.fixtures();
  }

  private surfaces() {
    const { w, h } = this.view;
    const W = w * ART;
    const img = this.g.createImageData(W, h * ART);
    const put = (ax: number, ay: number, c: RGB) => img.data.set([c[0], c[1], c[2], 255], (ay * W + ax) * 4);
    const top = rgb("#241810");
    const edge = rgb("#3a281a");
    const voidC = rgb("#0b0806");
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const t = this.tile(tx, ty);
        const x0 = tx * ART;
        const y0 = ty * ART;
        if (t !== "#") {
          const floor = this.styleAt(tx, ty).floor;
          for (let y = y0; y < y0 + ART; y++) for (let x = x0; x < x0 + ART; x++) put(x, y, floor(x, y));
          continue;
        }
        if (this.isFace(tx, ty)) {
          // Moulding, wallpaper, skirting board.
          const wall = this.styleAt(tx, ty + 1).wall;
          for (let y = y0; y < y0 + ART; y++) {
            const v = y - y0;
            for (let x = x0; x < x0 + ART; x++) {
              let c: RGB;
              if (v === 0) c = rgb(WOOD.dark);
              else if (v === 1) c = rgb(WOOD.light);
              else if (v === 13) c = rgb(WOOD.hi);
              else if (v >= 14) c = shade(rgb(WOOD.mid), v === 15 ? -0.3 : 0);
              else c = wall(x, y);
              put(x, y, c);
            }
          }
          continue;
        }
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.tile(tx + dx, ty + dy) !== "#");
        const nearAny = near.length > 0 || [[1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => this.tile(tx + dx, ty + dy) !== "#");
        for (let y = y0; y < y0 + ART; y++) {
          for (let x = x0; x < x0 + ART; x++) {
            if (!nearAny) {
              put(x, y, shade(voidC, (hash(x, y, 18) - 0.5) * 0.3));
              continue;
            }
            const u = x - x0;
            const v = y - y0;
            const rim = near.some(([dx, dy]) => (dx === 1 && u >= 14) || (dx === -1 && u <= 1) || (dy === 1 && v >= 13) || (dy === -1 && v <= 1));
            const stone = (hash(x >> 2, y >> 2, 19) - 0.5) * 0.2 + (hash(x, y, 20) - 0.5) * 0.08;
            put(x, y, rim ? shade(edge, stone * 0.5) : shade(top, stone));
          }
        }
      }
    }
    this.g.putImageData(img, 0, 0);
  }

  // Walls cast a little shadow onto the floor below and beside them.
  private shadows() {
    for (let ty = 0; ty < this.view.h; ty++) {
      for (let tx = 0; tx < this.view.w; tx++) {
        if (this.tile(tx, ty) === "#") continue;
        const x = tx * ART;
        const y = ty * ART;
        if (this.tile(tx, ty - 1) === "#") {
          [0.4, 0.25, 0.12].forEach((a, i) => this.rect(x, y + i, ART, 1, `rgba(0,0,0,${a})`));
        }
        if (this.tile(tx - 1, ty) === "#") [0.25, 0.1].forEach((a, i) => this.rect(x + i, y, 1, ART, `rgba(0,0,0,${a})`));
      }
    }
  }

  // ------------------------------------------------------------ helpers

  private rect(x: number, y: number, w: number, h: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private px(x: number, y: number, c: string) {
    this.rect(x, y, 1, 1, c);
  }

  private ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.g.fillStyle = c;
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)) + 0.25);
      this.g.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }

  private free(x: number, y: number, w: number, h: number, r: Room) {
    if (x < r.x0 || y < r.y0 || x + w - 1 > r.x1 || y + h - 1 > r.y1) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.used[yy * this.view.w + xx]) return false;
    return true;
  }

  // Find room for a w×h piece near a spot given as fractions of the room
  // (0,0 is the north-west corner, 1,1 the south-east), and claim it.
  // Returns the art position of its top-left corner, or null if nothing
  // fits within a few tiles of the spot.
  private put(r: Room, w: number, h: number, fx: number, fy: number, reach = 3): [number, number] | null {
    const tx = r.x0 + Math.round(fx * (r.x1 - r.x0 + 1 - w));
    const ty = r.y0 + Math.round(fy * (r.y1 - r.y0 + 1 - h));
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = r.y0; y <= r.y1 - h + 1; y++) {
      for (let x = r.x0; x <= r.x1 - w + 1; x++) {
        const d = Math.abs(x - tx) + Math.abs(y - ty) * 1.01;
        if (d < bestD && d <= reach && this.free(x, y, w, h, r)) [best, bestD] = [[x, y], d];
      }
    }
    if (!best) return null;
    for (let y = best[1]; y < best[1] + h; y++) for (let x = best[0]; x < best[0] + w; x++) this.used[y * this.view.w + x] = 1;
    return [best[0] * ART, best[1] * ART];
  }

  // Claim w columns of a room's north wall face near fraction fx along it.
  private onFace(r: Room, w: number, fx: number): [number, number] | null {
    const y = r.y0 - 1;
    const target = r.x0 + Math.round(fx * (r.x1 - r.x0 + 1 - w));
    let best = -1;
    for (let x = r.x0; x <= r.x1 - w + 1; x++) {
      let ok = true;
      for (let i = 0; i < w; i++) if (!this.isFace(x + i, y) || this.faceUsed.has(y * this.view.w + x + i)) ok = false;
      if (ok && (best < 0 || Math.abs(x - target) < Math.abs(best - target))) best = x;
    }
    if (best < 0) return null;
    for (let i = 0; i < w; i++) this.faceUsed.add(y * this.view.w + best + i);
    return [best * ART, y * ART];
  }

  // Runs of free wall face, for things that line the whole wall.
  private faceRuns(r: Room) {
    const y = r.y0 - 1;
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = r.x0; x <= r.x1 + 1; x++) {
      const ok = x <= r.x1 && this.isFace(x, y) && !this.faceUsed.has(y * this.view.w + x);
      if (ok && start < 0) start = x;
      if (!ok && start >= 0) {
        runs.push([start, x - 1]);
        start = -1;
      }
    }
    for (const [a, b] of runs) for (let x = a; x <= b; x++) this.faceUsed.add(y * this.view.w + x);
    return runs.map(([a, b]) => [a * ART, y * ART, (b - a + 1) * ART] as const);
  }

  // ------------------------------------------------------------ rooms

  private decorate(r: Room) {
    const rw = r.x1 - r.x0 + 1;
    const rh = r.y1 - r.y0 + 1;
    const each = (n: number, f: (i: number, fx: number) => void) => {
      for (let i = 0; i < n; i++) f(i, n === 1 ? 0.5 : i / (n - 1));
    };
    const at = (p: [number, number] | null, draw: (x: number, y: number) => void) => p && draw(p[0], p[1]);
    const centreRug = (field: string, border: string, accent: string, inset = 2) =>
      this.rug({ x0: r.x0 + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: r.y1 - inset }, field, border, accent);

    switch (r.id) {
      case "library": {
        centreRug("#2c4a32", "#5a1e1e", "#b89a50", 3);
        for (const [x, y, w] of this.faceRuns(r)) this.bookshelf(x, y, w);
        at(this.put(r, 1, 1, 0.15, 0.55), (x, y) => this.armchair(x, y, "#2f5a34"));
        at(this.put(r, 1, 1, 0.15, 0.75), (x, y) => this.sideTable(x, y));
        at(this.put(r, 1, 1, 0.15, 0.95), (x, y) => this.armchair(x, y, "#2f5a34"));
        at(this.put(r, 1, 1, 0.9, 0.85), (x, y) => this.globe(x, y));
        at(this.put(r, 2, 1, 0.65, 0.95), (x, y) => this.lowShelf(x, y, 2));
        at(this.put(r, 2, 1, 0.4, 0.95), (x, y) => this.lowShelf(x, y, 2));
        at(this.put(r, 1, 1, 0.97, 0.3), (x, y) => this.bookPile(x, y));
        break;
      }
      case "chapel": {
        const a = this.view.altar;
        this.rug({ x0: a.x0, y0: a.y1 + 1, x1: a.x1, y1: r.y1 }, "#6a1a1e", "#3a0e10", "#b89a50", true);
        each(Math.max(2, Math.floor(rw / 3)), (_, fx) => at(this.onFace(r, 1, fx), (x, y) => this.stainedGlass(x, y)));
        for (let y = a.y1 + 3; y <= r.y1 - 1; y += 2) {
          for (const [x0, x1] of [[r.x0 + 1, a.x0 - 2], [a.x1 + 2, r.x1 - 1]]) this.pews(r, x0, x1, y);
        }
        at(this.put(r, 1, 1, (a.x0 - 1 - r.x0) / Math.max(1, rw - 1), 0, 1), (x, y) => this.candelabra(x, y));
        at(this.put(r, 1, 1, (a.x1 + 1 - r.x0) / Math.max(1, rw - 1), 0, 1), (x, y) => this.candelabra(x, y));
        break;
      }
      case "nursery": {
        this.rug({ x0: r.x0 + 4, y0: r.y0 + 3, x1: r.x1 - 4, y1: r.y1 - 3 }, "#5a6a8a", "#8a6a9a", "#d8c8a0");
        at(this.onFace(r, 1, 0.3), (x, y) => this.painting(x, y, 1, "horse"));
        at(this.onFace(r, 2, 0.65), (x, y) => this.window(x, y, 2, "#7a5a7a"));
        at(this.onFace(r, 1, 0.9), (x, y) => this.toyShelf(x, y));
        at(this.put(r, 2, 1, 0.1, 0), (x, y) => this.crib(x, y));
        at(this.put(r, 1, 1, 0.5, 0.6), (x, y) => this.rockingHorse(x, y));
        at(this.put(r, 1, 1, 0.35, 0.8), (x, y) => this.blocks(x, y));
        at(this.put(r, 1, 1, 0.75, 0.45), (x, y) => this.teddy(x, y));
        at(this.put(r, 1, 1, 0.95, 0.95), (x, y) => this.dollhouse(x, y));
        at(this.put(r, 1, 1, 0.05, 0.95), (x, y) => this.toyChest(x, y));
        break;
      }
      case "study": {
        centreRug("#5a2a1a", "#2a1a10", "#b89a50", 3);
        at(this.onFace(r, 3, 0.15), (x, y) => this.bookshelf(x, y, 3 * ART));
        at(this.onFace(r, 2, 0.6), (x, y) => this.painting(x, y, 2, "landscape"));
        at(this.onFace(r, 1, 0.85), (x, y) => this.sconce(x + 8, y));
        at(this.put(r, 2, 2, 0.5, 0.3), (x, y) => this.desk(x, y));
        at(this.put(r, 1, 1, 0.9, 0.6), (x, y) => this.armchair(x, y, "#6a2a1e"));
        at(this.put(r, 1, 1, 0.1, 0.9), (x, y) => this.globe(x, y));
        at(this.put(r, 1, 1, 0.9, 0.95), (x, y) => this.clock(x, y));
        at(this.put(r, 1, 1, 0.5, 1), (x, y) => this.trunk(x, y));
        break;
      }
      case "dining": {
        const t = this.view.table;
        this.rug({ x0: Math.max(r.x0, t.x0 - 2), y0: Math.max(r.y0 + 1, t.y0 - 2), x1: Math.min(r.x1, t.x1 + 2), y1: Math.min(r.y1, t.y1 + 2) }, "#4a1a1e", "#2a0e10", "#b89a50");
        each(Math.max(2, Math.floor(rw / 4)), (i, fx) =>
          at(this.onFace(r, 1, fx), (x, y) => (i % 2 ? this.sconce(x + 8, y) : this.painting(x, y, 1, "portrait"))),
        );
        for (const [x, y, w] of this.faceRuns(r)) for (let i = 0; i < w; i += ART * 3) this.sconce(x + i + 8, y);
        at(this.put(r, 3, 1, 0.5, 0, 4), (x, y) => this.sideboard(x, y, 3));
        at(this.put(r, 1, 1, 0, 1), (x, y) => this.plant(x, y, "palm"));
        at(this.put(r, 1, 1, 1, 1), (x, y) => this.plant(x, y, "palm"));
        at(this.put(r, 1, 1, 0, 0.3), (x, y) => this.clock(x, y));
        break;
      }
      case "ballroom": {
        each(Math.max(2, Math.floor(rw / 4)), (_, fx) => at(this.onFace(r, 2, fx), (x, y) => this.window(x, y, 2, "#5a1a2a")));
        for (const [x, y, w] of this.faceRuns(r)) for (let i = 0; i < w; i += ART) this.sconce(x + i + 8, y);
        at(this.put(r, 2, 2, 1, 0.1), (x, y) => this.piano(x, y));
        at(this.put(r, 1, 1, 0, 0), (x, y) => this.plant(x, y, "palm"));
        at(this.put(r, 1, 1, 0, 1), (x, y) => this.plant(x, y, "palm"));
        at(this.put(r, 1, 1, 1, 1), (x, y) => this.plant(x, y, "palm"));
        at(this.put(r, 1, 1, 0.5, 1), (x, y) => this.bust(x, y));
        this.chandelierRing(r);
        break;
      }
      case "conservatory": {
        for (const [x, y, w] of this.faceRuns(r)) for (let i = ART; i < w - 8; i += ART * 3) this.hangingBasket(x + i, y);
        at(this.put(r, 3, 3, 0.5, 0.5, 4), (x, y) => this.fountain(x, y));
        const plants = ["fern", "palm", "flowers"] as const;
        let k = 0;
        for (let i = 0; i <= 1; i += 1 / Math.max(1, Math.floor(rw / 3))) {
          at(this.put(r, 1, 1, i, 0, 1), (x, y) => this.plant(x, y, plants[k++ % 3]));
          at(this.put(r, 1, 1, i, 1, 1), (x, y) => this.plant(x, y, plants[k++ % 3]));
        }
        for (let i = 0.25; i < 1; i += 0.25) {
          at(this.put(r, 1, 1, 0, i, 1), (x, y) => this.plant(x, y, plants[k++ % 3]));
          at(this.put(r, 1, 1, 1, i, 1), (x, y) => this.plant(x, y, plants[k++ % 3]));
        }
        at(this.put(r, 1, 1, 0.25, 0.75), (x, y) => this.wickerChair(x, y));
        at(this.put(r, 1, 1, 0.75, 0.25), (x, y) => this.wickerChair(x, y));
        break;
      }
      case "entrance": {
        this.roundRug(r);
        at(this.onFace(r, 2, 0.5), (x, y) => this.painting(x, y, 2, "portrait"));
        at(this.onFace(r, 1, 0.3), (x, y) => this.sconce(x + 8, y));
        at(this.onFace(r, 1, 0.7), (x, y) => this.sconce(x + 8, y));
        at(this.put(r, 1, 1, 0.35, 0, 2), (x, y) => this.armor(x, y));
        at(this.put(r, 1, 1, 0.65, 0, 2), (x, y) => this.armor(x, y));
        at(this.put(r, 1, 1, 0.05, 0), (x, y) => this.clock(x, y));
        at(this.put(r, 1, 1, 0.97, 0), (x, y) => this.coatStand(x, y));
        at(this.put(r, 2, 1, 0.9, 1), (x, y) => this.consoleTable(x, y));
        at(this.put(r, 1, 1, 0.05, 1), (x, y) => this.umbrellaStand(x, y));
        break;
      }
      case "kitchen": {
        at(this.onFace(r, 2, 0.75), (x, y) => this.window(x, y, 2, null));
        at(this.onFace(r, 3, 0.15), (x, y) => this.potShelf(x, y, 3));
        for (const [x, y, w] of this.faceRuns(r)) this.herbs(x, y, w);
        at(this.put(r, 2, 1, 0.45, 0, 2), (x, y) => this.stove(x, y));
        at(this.put(r, 3, 2, 0.5, 0.55), (x, y) => this.worktable(x, y, 3, 2));
        at(this.put(r, 1, 1, 0, 1), (x, y) => this.barrel(x, y));
        at(this.put(r, 1, 1, 0.1, 1), (x, y) => this.barrel(x, y));
        at(this.put(r, 1, 1, 1, 1), (x, y) => this.sacks(x, y));
        at(this.put(r, 1, 1, 0.9, 1), (x, y) => this.crate(x, y));
        at(this.put(r, 1, 2, 0, 0.4), (x, y) => this.counter(x, y));
        break;
      }
      case "cellar": {
        for (const [x, y, w] of this.faceRuns(r)) this.wineRack(x, y, w);
        for (const [fx, fy] of [[0, 0.4], [0, 0.6], [0.1, 0.5], [1, 1], [0.9, 1], [1, 0.85], [0.5, 1], [0.6, 1]]) {
          at(this.put(r, 1, 1, fx, fy, 2), (x, y) => (hash(x, y, 30) < 0.7 ? this.barrel(x, y) : this.crate(x, y)));
        }
        for (const [fx, fy] of [[0.35, 0.45], [0.7, 0.3], [0.25, 0.8]]) at(this.put(r, 1, 1, fx, fy, 2), (x, y) => this.puddle(x, y));
        at(this.put(r, 1, 1, 0.95, 0.3, 2), (x, y) => this.crate(x, y));
        break;
      }
    }
    this.extras(r);
    if (STYLES[r.id]?.web) {
      this.cobweb(r.x0 * ART, r.y0 * ART, 1);
      if (rh > 0) this.cobweb((r.x1 + 1) * ART, r.y0 * ART, -1);
    }
  }

  // A second pass that fills bigger rooms: more pieces the more floor
  // there is, scattered over repeatable spots so every match looks the same.
  private extras(r: Room) {
    const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    const at = (p: [number, number] | null, draw: (x: number, y: number) => void) => p && draw(p[0], p[1]);
    const scatter = (n: number, w: number, h: number, salt: number, draw: (x: number, y: number, i: number) => void, inset = 0.15) => {
      for (let i = 0; i < n; i++) {
        const fx = inset + hash(i, salt, 40) * (1 - inset * 2);
        const fy = inset + hash(i, salt, 41) * (1 - inset * 2);
        at(this.put(r, w, h, fx, fy, 2), (x, y) => draw(x, y, i));
      }
    };
    const for2 = (list: [number, number][], w: number, h: number, draw: (x: number, y: number) => void) => {
      for (const [fx, fy] of list) at(this.put(r, w, h, fx, fy, 2), draw);
    };
    switch (r.id) {
      case "library":
        for2([[0.75, 0.3], [0.75, 0.6]], 3, 1, (x, y) => this.bottleShelf(x, y, 3, true));
        scatter(Math.floor(area / 70), 2, 2, 1, (x, y) => this.readingTable(x, y));
        scatter(Math.floor(area / 50), 1, 1, 2, (x, y) => this.bookPile(x, y));
        break;
      case "chapel":
        for2([[0, 0.2], [1, 0.2]], 1, 1, (x, y) => this.candleRack(x, y));
        for2([[0, 1], [1, 1]], 1, 1, (x, y) => this.bust(x, y));
        for (const [x, y, w] of this.faceRuns(r)) for (let i = 8; i < w; i += ART * 2) this.sconce(x + i, y);
        break;
      case "nursery":
        for2([[0.85, 0.2]], 1, 2, (x, y) => this.pram(x, y));
        for2([[0.3, 0.35]], 1, 1, (x, y) => this.teaTable(x, y));
        scatter(Math.floor(area / 25), 1, 1, 3, (x, y, i) => (i % 3 === 0 ? this.ball(x, y) : i % 3 === 1 ? this.blocks(x, y) : this.soldiers(x, y)));
        break;
      case "study":
        for2([[0.2, 1], [0.8, 1]], 2, 1, (x, y) => this.lowShelf(x, y, 2));
        for2([[0.25, 0.55]], 2, 1, (x, y) => this.mapTable(x, y));
        for2([[0.75, 0.3]], 1, 1, (x, y) => this.chess(x, y));
        scatter(Math.floor(area / 60), 1, 1, 4, (x, y) => this.bookPile(x, y));
        break;
      case "dining":
        for2([[0.5, 1]], 3, 1, (x, y) => this.sideboard(x, y, 3));
        for2([[0, 0], [1, 0]], 1, 1, (x, y) => this.plant(x, y, "fern"));
        for2([[0.9, 0.5]], 1, 1, (x, y) => this.servingCart(x, y));
        break;
      case "ballroom":
        scatter(Math.max(2, Math.floor(area / 45)), 2, 2, 5, (x, y) => this.roundTable(x, y), 0.08);
        for2([[0.8, 0.1]], 1, 1, (x, y) => this.harp(x, y));
        break;
      case "conservatory":
        for2([[0.5, 0.15], [0.5, 0.85]], 2, 1, (x, y) => this.bench(x, y, 2));
        for2([[0.15, 0.5], [0.85, 0.5]], 1, 1, (x, y) => this.birdcage(x, y));
        scatter(Math.floor(area / 30), 1, 1, 6, (x, y, i) => this.plant(x, y, (["fern", "flowers", "palm"] as const)[i % 3]));
        break;
      case "entrance":
        for2([[0, 0.5], [1, 0.5]], 1, 2, (x, y) => this.benchSide(x, y));
        for2([[0.2, 1], [0.8, 1], [0.2, 0], [0.8, 0]], 1, 1, (x, y) => this.plant(x, y, "palm"));
        for2([[0.1, 0.25], [0.9, 0.25]], 1, 1, (x, y) => this.bust(x, y));
        break;
      case "kitchen":
        for2([[0.75, 0.6]], 2, 1, (x, y) => this.worktable(x, y, 2, 1));
        for2([[0.25, 0.85]], 1, 1, (x, y) => this.chopBlock(x, y));
        for2([[0.4, 1], [0.6, 1]], 2, 1, (x, y) => this.bottleShelf(x, y, 2, false));
        for2([[0.85, 0.3]], 1, 1, (x, y) => this.bucket(x, y));
        for2([[0.6, 0.25]], 1, 1, (x, y) => this.cat(x, y));
        scatter(Math.floor(area / 60), 1, 1, 7, (x, y, i) => (i % 2 ? this.sacks(x, y) : this.crate(x, y)), 0.05);
        break;
      case "cellar":
        for2([[0.3, 0.3], [0.3, 0.7], [0.65, 0.5]], 2, 1, (x, y) => this.bottleShelf(x, y, 2, false));
        scatter(Math.floor(area / 25), 1, 1, 8, (x, y, i) => (i % 4 === 3 ? this.crate(x, y) : this.barrel(x, y)), 0.05);
        for2([[0.5, 0.2]], 1, 1, (x, y) => this.brokenChair(x, y));
        for2([[0.8, 0.6]], 1, 1, (x, y) => this.rat(x, y));
        for (const [x, y, w] of this.faceRuns(r)) for (let i = 8; i < w; i += ART * 3) this.chains(x + i, y);
        break;
    }
  }

  private pews(r: Room, x0: number, x1: number, y: number) {
    let start = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const ok = x <= x1 && this.free(x, y, 1, 1, r);
      if (ok && start < 0) start = x;
      if (!ok && start >= 0) {
        if (x - start >= 2) {
          for (let i = start; i < x; i++) this.used[y * this.view.w + i] = 1;
          this.pew(start * ART, y * ART, (x - start) * ART);
        }
        start = -1;
      }
    }
  }

  // ------------------------------------------------------------ fixtures

  private fixtures() {
    const v = this.view;
    this.diningTable(v.table);
    this.altar(v.altar);
    for (const m of v.mirrors) this.mirror(Math.floor(m.x) * ART, Math.floor(m.y) * ART);
    for (const h of v.hearths) this.fireplace(Math.floor(h.x) * ART, Math.floor(h.y) * ART);
    for (const pair of v.passages ?? []) {
      for (const p of pair) {
        const x = Math.floor(p.x) * ART;
        const y = Math.floor(p.y) * ART;
        this.rect(x + 1, y + 1, 14, 14, "rgba(155, 93, 229, 0.18)");
        this.g.strokeStyle = "#9b5de5";
        this.g.lineWidth = 1;
        this.g.strokeRect(x + 1.5, y + 1.5, 13, 13);
        this.rect(x + 7, y + 6, 2, 2, "#9b5de5");
        this.rect(x + 7, y + 8, 2, 3, "#5a2e8a");
      }
    }
  }

  private diningTable(t: Rect) {
    const x = t.x0 * ART;
    const y = t.y0 * ART;
    const w = (t.x1 - t.x0 + 1) * ART;
    const h = (t.y1 - t.y0 + 1) * ART;
    // Chairs at every seat, backs away from the table.
    for (let tx = t.x0; tx <= t.x1; tx++) {
      this.chair(tx * ART, (t.y0 - 1) * ART, "#5a1a1e", "up");
      this.chair(tx * ART, (t.y1 + 1) * ART, "#5a1a1e", "down");
    }
    this.rect(x + 2, y + 3, w - 2, h - 2, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 1, w - 2, h - 2, WOOD.dark);
    this.rect(x + 2, y + 1, w - 4, h - 3, WOOD.mid);
    this.rect(x + 3, y + 2, w - 6, h - 6, "#d8cfb8");
    this.rect(x + 3, y + h - 5, w - 6, 2, "#bfb49a");
    for (let i = x + 3; i < x + w - 3; i += 2) {
      this.px(i, y + h - 3, "#efe6cf");
      this.px(i + 1, y + 2, "#efe6cf");
    }
    const cy = y + Math.floor(h / 2);
    this.rect(x + 3, cy - 3, w - 6, 5, "#6a1a1e");
    this.rect(x + 3, cy - 3, w - 6, 1, GOLD.mid);
    this.rect(x + 3, cy + 1, w - 6, 1, GOLD.mid);
    for (let tx = 0; tx < w / ART; tx++) {
      const px = x + tx * ART + 8;
      for (const py of [y + 6, y + h - 8]) {
        this.ellipse(px, py, 2, 1, "#b8b0a0");
        this.px(px, py, "#efe8dc");
        this.px(px - 4, py, "#c8c8d0");
        this.px(px + 4, py, "#c8c8d0");
        this.px(px + 3, py - 2, "#7a1a2a");
      }
    }
    for (const f of [0.2, 0.8]) this.candelabraTop(x + Math.round(w * f), cy - 1);
    this.ellipse(x + w / 2, cy - 1, 5, 2, "#a8a8b0");
    this.ellipse(x + w / 2, cy - 2, 3, 2, "#8a4a1a");
    this.px(x + w / 2 - 1, cy - 3, "#c8783a");
  }

  private altar(a: Rect) {
    const x = a.x0 * ART;
    const y = a.y0 * ART;
    const w = (a.x1 - a.x0 + 1) * ART;
    this.rect(x + 1, y + 4, w - 2, 12, STONE.mid);
    this.rect(x + 1, y + 3, w - 2, 3, STONE.hi);
    this.rect(x + 1, y + 15, w - 2, 1, STONE.dark);
    for (let i = x + 4; i < x + w - 4; i += 6) this.rect(i, y + 8, 3, 5, STONE.dark);
    this.rect(x + w / 2 - 5, y + 3, 10, 10, "#4a2a5a");
    this.rect(x + w / 2 - 5, y + 12, 10, 1, GOLD.mid);
    this.rect(x + w / 2 - 1, y + 6, 2, 5, GOLD.hi);
    this.rect(x + w / 2 - 2, y + 7, 4, 1, GOLD.hi);
    for (const cx of [x + 3, x + w - 4]) {
      this.rect(cx, y - 2, 2, 6, CANDLE);
      this.px(cx, y - 3, FLAME);
    }
  }

  private mirror(x: number, y: number) {
    this.ellipse(x + 8, y + 8, 6, 7, GOLD.dark);
    this.ellipse(x + 8, y + 8, 5, 6, GOLD.mid);
    this.ellipse(x + 8, y + 8, 4, 5, "#7f94a4");
    this.ellipse(x + 7, y + 7, 2, 3, "#9fb4c4");
    this.line(x + 5, y + 6, x + 7, y + 4, "#d8e4ec");
    this.px(x + 8, y, GOLD.hi);
    this.rect(x + 7, y + 1, 3, 1, GOLD.hi);
  }

  // The stone surround; the scene draws the flames inside it.
  private fireplace(x: number, y: number) {
    this.rect(x + 1, y + 2, 14, 13, STONE.mid);
    this.rect(x + 1, y + 2, 14, 1, STONE.hi);
    this.rect(x + 1, y + 2, 1, 13, STONE.hi);
    this.rect(x, y + 1, 16, 3, WOOD.dark);
    this.rect(x, y + 1, 16, 1, WOOD.hi);
    this.rect(x + 4, y + 5, 8, 9, "#140c08");
    for (let yy = y + 6; yy < y + 13; yy += 2) for (let xx = x + 4 + ((yy >> 1) & 1); xx < x + 12; xx += 3) this.px(xx, yy, "#2a140c");
    this.rect(x + 2, y + 14, 12, 2, STONE.dark);
    this.rect(x + 5, y + 12, 1, 2, IRON.hi);
    this.rect(x + 10, y + 12, 1, 2, IRON.hi);
  }

  // ------------------------------------------------------------ pieces

  private rug(t: Rect, field: string, border: string, accent: string, runner = false) {
    if (t.x1 < t.x0 || t.y1 < t.y0) return;
    const x = t.x0 * ART + (runner ? 1 : 3);
    const y = t.y0 * ART + (runner ? 0 : 3);
    const w = (t.x1 - t.x0 + 1) * ART - (runner ? 2 : 6);
    const h = (t.y1 - t.y0 + 1) * ART - (runner ? 0 : 6);
    if (w < 8 || h < 8) return;
    this.rect(x, y, w, h, border);
    this.rect(x + 2, y + 2, w - 4, h - 4, accent);
    this.rect(x + 3, y + 3, w - 6, h - 6, field);
    for (let i = x + 5; i < x + w - 5; i += 3) {
      this.px(i, y + 5, accent);
      this.px(i, y + h - 6, accent);
    }
    for (let i = y + 5; i < y + h - 5; i += 3) {
      this.px(x + 5, i, accent);
      this.px(x + w - 6, i, accent);
    }
    if (!runner) {
      const cx = x + Math.floor(w / 2);
      const cy = y + Math.floor(h / 2);
      const rd = Math.max(3, Math.floor(Math.min(w, h) / 4));
      for (const [k, c] of [[0, border], [2, accent], [4, field]] as const) {
        for (let dy = -(rd - k); dy <= rd - k; dy++) {
          const half = rd - k - Math.abs(dy);
          this.rect(cx - half, cy + dy, half * 2 + 1, 1, c);
        }
      }
      for (let i = y + 1; i < y + h - 1; i += 2) {
        this.px(x - 1, i, "#cfc0a0");
        this.px(x + w, i, "#cfc0a0");
      }
    }
  }

  private roundRug(r: Room) {
    const cx = ((r.x0 + r.x1 + 1) / 2) * ART;
    const cy = ((r.y0 + r.y1 + 1) / 2) * ART;
    const rad = Math.min(r.x1 - r.x0, r.y1 - r.y0) * 4;
    this.ellipse(cx, cy, rad, rad, "#3a0e14");
    this.ellipse(cx, cy, rad - 2, rad - 2, "#b89a50");
    this.ellipse(cx, cy, rad - 3, rad - 3, "#5a1a22");
    this.ellipse(cx, cy, rad - 9, rad - 9, "#3a0e14");
    this.ellipse(cx, cy, rad - 10, rad - 10, "#6a2a2a");
    // A compass rose.
    const k = rad - 12;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      for (let i = 0; i < k; i++) {
        const half = Math.floor((k - i) / 4);
        if (dx === 0) this.rect(cx - half, cy + dy * i, half * 2 + 1, 1, i % 2 ? "#d8c080" : "#b89a50");
        else this.rect(cx + dx * i, cy - half, 1, half * 2 + 1, i % 2 ? "#d8c080" : "#b89a50");
      }
    }
    this.ellipse(cx, cy, 2, 2, "#e8d8a0");
  }

  private bookshelf(x: number, y: number, w: number) {
    this.rect(x, y + 1, w, 14, WOOD.dark);
    this.rect(x, y + 1, w, 1, WOOD.light);
    for (const by of [y + 5, y + 9, y + 13]) this.rect(x, by, w, 1, WOOD.mid);
    for (let s = 0; s < 3; s++) {
      const bottom = y + 4 + s * 4;
      let bx = x + 1;
      while (bx < x + w - 1) {
        const r = hash(bx, bottom, 21);
        const bw = r < 0.3 ? 2 : 1;
        if (r > 0.93) {
          bx += 2;
          continue;
        }
        const bh = r < 0.55 ? 3 : 2;
        this.rect(bx, bottom - bh + 1, Math.min(bw, x + w - 1 - bx), bh, BOOKS[Math.floor(hash(bx, s, 22) * BOOKS.length)]);
        if (bh === 3) this.px(bx, bottom - 1, "#c8a050");
        bx += bw;
      }
    }
    for (let i = x; i < x + w; i += ART * 2) this.rect(i, y + 1, 1, 14, WOOD.mid);
    this.rect(x + w - 1, y + 1, 1, 14, WOOD.mid);
  }

  private lowShelf(x: number, y: number, tiles: number) {
    const w = tiles * ART;
    this.rect(x + 1, y + 6, w - 2, 9, WOOD.dark);
    this.rect(x + 1, y + 5, w - 2, 2, WOOD.light);
    let bx = x + 2;
    while (bx < x + w - 3) {
      const r = hash(bx, y, 23);
      this.rect(bx, y + 8 + (r < 0.4 ? 1 : 0), r < 0.3 ? 2 : 1, 6 - (r < 0.4 ? 1 : 0), BOOKS[Math.floor(r * BOOKS.length)]);
      bx += r < 0.3 ? 2 : 1;
    }
  }

  private bookPile(x: number, y: number) {
    for (let i = 0; i < 4; i++) this.rect(x + 4 + (i % 2), y + 12 - i * 2, 8, 2, BOOKS[i * 2]);
    this.rect(x + 3, y + 5, 3, 1, "#d8d0bc");
  }

  private window(x: number, y: number, tiles: number, curtain: string | null) {
    const w = tiles * ART;
    this.rect(x + 2, y + 1, w - 4, 13, WOOD.dark);
    for (let r = 0; r < 10; r++) {
      const c = shade(rgb("#0c1426"), r / 30);
      this.rect(x + 3, y + 2 + r, w - 6, 1, `rgb(${c.map(Math.round).join(",")})`);
    }
    this.px(x + 3, y + 2, WOOD.dark);
    this.px(x + w - 4, y + 2, WOOD.dark);
    for (let i = 0; i < tiles; i++) this.rect(x + i * ART + 8, y + 2, 1, 10, WOOD.mid);
    this.rect(x + 3, y + 7, w - 6, 1, WOOD.mid);
    for (let i = 0; i < w; i += 2) if (hash(x + i, y, 24) < 0.4) this.rect(x + 3 + (i % (w - 6)), y + 3 + Math.floor(hash(i, y, 25) * 7), 1, 2, "#4a6a90");
    this.rect(x + 1, y + 12, w - 2, 2, WOOD.light);
    if (curtain) {
      const dark = `rgb(${shade(rgb(curtain), -0.35).map(Math.round).join(",")})`;
      this.rect(x + 1, y + 1, w - 2, 2, curtain);
      for (const cx of [x + 1, x + w - 5]) {
        this.rect(cx, y + 1, 4, 13, curtain);
        this.rect(cx + 1, y + 3, 1, 10, dark);
        this.rect(cx + 3, y + 3, 1, 10, dark);
        this.rect(cx, y + 8, 4, 1, GOLD.mid);
      }
    }
  }

  private stainedGlass(x: number, y: number) {
    const panes = ["#8a2a2a", "#2a4a8a", "#c8a040", "#2a6a4a", "#6a2a7a"];
    this.rect(x + 3, y + 2, 10, 12, STONE.hi);
    for (let r = 0; r < 11; r++) {
      const half = r === 0 ? 1 : r === 1 ? 2 : r === 2 ? 3 : 4;
      for (let dx = -half; dx < half; dx++) {
        const px = x + 8 + dx;
        const py = y + 3 + r;
        const lead = r % 3 === 2 || (dx + 8) % 3 === 0;
        this.px(px, py, lead ? "#1a1410" : panes[Math.floor(hash(Math.floor((dx + 8) / 3), Math.floor(r / 3), 26) * panes.length)]);
      }
    }
    this.rect(x + 3, y + 14, 10, 1, STONE.dark);
  }

  private painting(x: number, y: number, tiles: number, kind: "portrait" | "landscape" | "horse") {
    const fw = tiles === 1 ? 12 : 26;
    const fh = tiles === 1 ? 11 : 11;
    const fx = x + Math.floor((tiles * ART - fw) / 2);
    const fy = y + 2;
    this.rect(fx, fy, fw, fh, GOLD.mid);
    this.rect(fx, fy, fw, 1, GOLD.hi);
    this.rect(fx, fy, 1, fh, GOLD.hi);
    this.rect(fx + fw - 1, fy, 1, fh, GOLD.dark);
    this.rect(fx, fy + fh - 1, fw, 1, GOLD.dark);
    const ix = fx + 2;
    const iy = fy + 2;
    const iw = fw - 4;
    const ih = fh - 4;
    if (kind === "portrait") {
      this.rect(ix, iy, iw, ih, "#2a2218");
      const cx = ix + Math.floor(iw / 2);
      this.rect(cx - 3, iy + ih - 2, 7, 2, "#1a1414");
      this.rect(cx - 1, iy + 1, 3, 4, "#b89070");
      this.rect(cx - 1, iy, 3, 1, "#3a2a1a");
      this.px(cx - 1, iy + 2, "#2a1a10");
      this.px(cx + 1, iy + 2, "#2a1a10");
    } else if (kind === "landscape") {
      this.rect(ix, iy, iw, ih, "#3a4a5a");
      this.rect(ix, iy + 4, iw, ih - 4, "#2a3a24");
      for (let i = 0; i < iw; i++) this.px(ix + i, iy + 3 + Math.round(Math.sin(i / 3)), "#3a4a2c");
      this.px(ix + iw - 4, iy + 1, "#e8e0c0");
    } else {
      this.rect(ix, iy, iw, ih, "#4a3a5a");
      this.rect(ix + 2, iy + 3, 5, 2, "#d8c8a8");
      this.rect(ix + 6, iy + 2, 1, 2, "#d8c8a8");
      this.px(ix + 2, iy + 5, "#d8c8a8");
      this.px(ix + 6, iy + 5, "#d8c8a8");
    }
  }

  private sconce(x: number, y: number) {
    this.rect(x - 1, y + 9, 3, 1, GOLD.mid);
    this.rect(x, y + 9, 1, 3, GOLD.dark);
    this.rect(x, y + 6, 1, 3, CANDLE);
    this.px(x, y + 5, FLAME);
    this.px(x, y + 4, "#ffd27a");
  }

  private armchair(x: number, y: number, color: string) {
    const c = rgb(color);
    const dark = `rgb(${shade(c, -0.35).map(Math.round).join(",")})`;
    const hi = `rgb(${shade(c, 0.2).map(Math.round).join(",")})`;
    this.rect(x + 3, y + 14, 10, 1, "rgba(0,0,0,0.35)");
    this.rect(x + 3, y + 1, 10, 5, dark);
    this.rect(x + 4, y + 2, 8, 1, hi);
    this.rect(x + 2, y + 4, 3, 10, dark);
    this.rect(x + 11, y + 4, 3, 10, dark);
    this.rect(x + 5, y + 6, 6, 7, color);
    this.rect(x + 5, y + 6, 6, 1, hi);
    this.px(x + 2, y + 14, WOOD.dark);
    this.px(x + 13, y + 14, WOOD.dark);
  }

  private wickerChair(x: number, y: number) {
    this.ellipse(x + 8, y + 7, 6, 6, "#8a6a3a");
    this.ellipse(x + 8, y + 8, 4, 4, "#a8844a");
    for (let i = -5; i <= 5; i += 2) this.px(x + 8 + i, y + 3, "#6a4a22");
    this.ellipse(x + 8, y + 9, 2, 2, "#c8a870");
  }

  private chair(x: number, y: number, color: string, back: "up" | "down") {
    this.rect(x + 4, y + 5, 8, 7, color);
    this.rect(x + 4, y + 5, 8, 1, "#7a2a2e");
    this.rect(x + 4, back === "up" ? y + 2 : y + 12, 8, 3, WOOD.dark);
    this.rect(x + 5, back === "up" ? y + 2 : y + 13, 6, 1, WOOD.light);
  }

  private sideTable(x: number, y: number) {
    this.ellipse(x + 8, y + 10, 5, 3, "rgba(0,0,0,0.3)");
    this.ellipse(x + 8, y + 8, 5, 4, WOOD.mid);
    this.ellipse(x + 7, y + 7, 3, 2, WOOD.light);
    this.rect(x + 7, y + 3, 2, 4, "#2a5a3a");
    this.rect(x + 6, y + 2, 4, 1, "#3a7a4a");
    this.px(x + 8, y + 1, "#ffd27a");
    this.rect(x + 3, y + 8, 3, 2, "#d8d0bc");
  }

  private globe(x: number, y: number) {
    this.rect(x + 5, y + 14, 6, 1, WOOD.dark);
    this.rect(x + 7, y + 10, 2, 4, WOOD.mid);
    this.ellipse(x + 8, y + 6, 4, 4, "#2a4a6a");
    this.rect(x + 6, y + 4, 2, 2, "#4a6a3a");
    this.rect(x + 9, y + 6, 2, 3, "#4a6a3a");
    this.px(x + 6, y + 8, "#4a6a3a");
    this.line(x + 3, y + 3, x + 3, y + 9, GOLD.mid);
    this.line(x + 4, y + 1, x + 12, y + 1, GOLD.mid);
    this.px(x + 6, y + 3, "#6a8aaa");
  }

  private desk(x: number, y: number) {
    this.rect(x + 2, y + 14, 28, 2, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 3, 30, 11, WOOD.mid);
    this.rect(x + 1, y + 3, 30, 1, WOOD.hi);
    this.rect(x + 1, y + 12, 30, 2, WOOD.dark);
    this.rect(x + 4, y + 5, 6, 5, "#d8d0bc");
    for (let i = 0; i < 3; i++) this.rect(x + 5, y + 6 + i, 4, 1, i === 1 ? "#8a8070" : "#b8b0a0");
    this.rect(x + 12, y + 6, 5, 4, "#5a2a1a");
    this.rect(x + 12, y + 6, 5, 1, "#7a3a24");
    this.rect(x + 20, y + 7, 2, 2, "#101018");
    this.line(x + 22, y + 8, x + 24, y + 5, "#e8e0d0");
    this.rect(x + 27, y + 4, 2, 5, CANDLE);
    this.px(x + 27, y + 3, FLAME);
    this.chair(x + 8, y + 14, "#2a3a2a", "down");
  }

  private trunk(x: number, y: number) {
    this.rect(x + 2, y + 5, 12, 9, WOOD.mid);
    this.rect(x + 2, y + 5, 12, 3, WOOD.light);
    this.rect(x + 2, y + 8, 12, 1, IRON.hi);
    this.rect(x + 4, y + 5, 1, 9, IRON.mid);
    this.rect(x + 11, y + 5, 1, 9, IRON.mid);
    this.rect(x + 7, y + 8, 2, 2, GOLD.mid);
  }

  private clock(x: number, y: number) {
    // A grandfather clock standing against the wall, taller than a tile.
    this.rect(x + 3, y - 13, 10, 3, WOOD.dark);
    this.rect(x + 4, y - 11, 8, 24, WOOD.mid);
    this.rect(x + 4, y - 11, 1, 24, WOOD.hi);
    this.ellipse(x + 8, y - 7, 3, 3, "#e8dcc0");
    this.line(x + 8, y - 7, x + 8, y - 9, "#1a1410");
    this.line(x + 8, y - 7, x + 10, y - 7, "#1a1410");
    this.rect(x + 6, y - 2, 4, 10, WOOD.dark);
    this.rect(x + 8, y - 2, 1, 7, GOLD.mid);
    this.ellipse(x + 8, y + 5, 1, 1, GOLD.hi);
    this.rect(x + 3, y + 12, 10, 3, WOOD.dark);
  }

  private armor(x: number, y: number) {
    this.rect(x + 3, y + 13, 10, 2, STONE.mid);
    this.rect(x + 5, y + 5, 2, 8, IRON.hi);
    this.rect(x + 9, y + 5, 2, 8, IRON.hi);
    this.rect(x + 4, y - 4, 8, 10, IRON.hi);
    this.rect(x + 4, y - 4, 2, 10, "#7a7984");
    this.rect(x + 2, y - 3, 2, 7, IRON.mid);
    this.rect(x + 12, y - 3, 2, 7, IRON.mid);
    this.rect(x + 5, y - 10, 6, 6, "#7a7984");
    this.rect(x + 5, y - 7, 6, 1, IRON.dark);
    this.rect(x + 7, y - 12, 2, 2, "#8a1a1a");
    this.line(x + 14, y - 14, x + 14, y + 13, WOOD.light);
    this.rect(x + 13, y - 16, 3, 2, "#b8b8c0");
  }

  private coatStand(x: number, y: number) {
    this.rect(x + 7, y - 8, 2, 21, WOOD.dark);
    this.rect(x + 4, y + 13, 8, 2, WOOD.dark);
    this.rect(x + 4, y - 7, 8, 1, WOOD.mid);
    this.rect(x + 3, y - 6, 4, 10, "#2a3a2a");
    this.rect(x + 3, y - 6, 1, 10, "#3a4a3a");
    this.rect(x + 9, y - 10, 5, 2, "#1a1414");
    this.rect(x + 10, y - 12, 3, 2, "#1a1414");
  }

  private umbrellaStand(x: number, y: number) {
    this.rect(x + 5, y + 6, 6, 8, "#3a4a5a");
    this.rect(x + 5, y + 6, 6, 1, "#5a6a7a");
    this.line(x + 6, y + 6, x + 4, y, "#1a1a1a");
    this.line(x + 9, y + 6, x + 11, y + 1, "#5a1a1a");
    this.px(x + 4, y, "#8a6a3a");
  }

  private consoleTable(x: number, y: number) {
    this.rect(x + 2, y + 3, 28, 5, WOOD.mid);
    this.rect(x + 2, y + 3, 28, 1, WOOD.hi);
    this.rect(x + 3, y + 8, 1, 6, WOOD.dark);
    this.rect(x + 28, y + 8, 1, 6, WOOD.dark);
    this.ellipse(x + 10, y + 3, 2, 3, "#2a4a7a");
    this.px(x + 10, y + 2, "#e8e0d0");
    for (const [dx, c] of [[-2, "#a82a3a"], [0, "#e8c040"], [2, "#a82a3a"]] as const) this.px(x + 10 + dx, y - 1, c);
    this.rect(x + 20, y + 4, 4, 2, "#d8d0bc");
  }

  private sideboard(x: number, y: number, tiles: number) {
    const w = tiles * ART;
    this.rect(x + 1, y + 2, w - 2, 12, WOOD.mid);
    this.rect(x + 1, y + 2, w - 2, 3, WOOD.light);
    for (let i = x + 3; i < x + w - 6; i += 9) {
      this.rect(i, y + 6, 8, 7, WOOD.dark);
      this.px(i + 6, y + 9, GOLD.hi);
    }
    this.candelabraTop(x + 6, y + 3);
    this.candelabraTop(x + w - 7, y + 3);
    this.ellipse(x + w / 2, y + 3, 3, 1, "#a8a8b0");
    this.rect(x + w / 2 - 2, y + 1, 5, 2, "#c8c8d0");
  }

  private candelabraTop(x: number, y: number) {
    this.rect(x - 1, y, 3, 1, GOLD.mid);
    this.rect(x - 3, y - 2, 7, 1, GOLD.mid);
    this.rect(x, y - 2, 1, 2, GOLD.mid);
    for (const dx of [-3, 0, 3]) {
      this.rect(x + dx, y - 5, 1, 3, CANDLE);
      this.px(x + dx, y - 6, FLAME);
    }
  }

  private candelabra(x: number, y: number) {
    this.rect(x + 6, y + 13, 5, 2, GOLD.dark);
    this.rect(x + 8, y + 4, 1, 9, GOLD.mid);
    this.candelabraTop(x + 8, y + 4);
  }

  private pew(x: number, y: number, w: number) {
    this.rect(x + 1, y + 13, w - 2, 1, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 3, w - 2, 3, WOOD.dark);
    this.rect(x + 1, y + 3, w - 2, 1, WOOD.light);
    this.rect(x + 1, y + 6, w - 2, 6, WOOD.mid);
    this.rect(x + 1, y + 6, w - 2, 1, WOOD.hi);
    this.rect(x, y + 2, 2, 11, WOOD.dark);
    this.rect(x + w - 2, y + 2, 2, 11, WOOD.dark);
    for (let i = x + 6; i < x + w - 4; i += 9) this.rect(i, y + 8, 3, 2, "#4a2a5a");
  }

  private crib(x: number, y: number) {
    this.rect(x + 2, y + 2, 28, 12, WOOD.light);
    this.rect(x + 4, y + 4, 24, 8, "#d8d0e0");
    this.rect(x + 5, y + 5, 5, 6, "#efe8f0");
    for (let i = 12; i < 28; i++) for (let j = 4; j < 12; j++) this.px(x + i, y + j, (i + j) % 4 < 2 ? "#8a6a9a" : "#a88aba");
    for (let i = x + 3; i < x + 30; i += 2) {
      this.px(i, y + 2, WOOD.hi);
      this.px(i, y + 13, WOOD.dark);
    }
  }

  private rockingHorse(x: number, y: number) {
    this.rect(x + 2, y + 14, 12, 1, WOOD.dark);
    this.px(x + 1, y + 13, WOOD.dark);
    this.px(x + 14, y + 13, WOOD.dark);
    this.rect(x + 4, y + 9, 1, 5, WOOD.mid);
    this.rect(x + 11, y + 9, 1, 5, WOOD.mid);
    this.rect(x + 4, y + 6, 8, 4, "#d8c8a8");
    this.rect(x + 11, y + 2, 3, 5, "#d8c8a8");
    this.rect(x + 10, y + 2, 1, 4, "#5a3a1a");
    this.px(x + 13, y + 3, "#1a1010");
    this.rect(x + 6, y + 6, 3, 2, "#8a2a2a");
    this.px(x + 5, y + 8, "#b8a888");
    this.px(x + 8, y + 9, "#b8a888");
    this.rect(x + 2, y + 6, 2, 3, "#5a3a1a");
  }

  private blocks(x: number, y: number) {
    for (const [dx, dy, c] of [[2, 8, "#a82a2a"], [8, 9, "#2a5aa8"], [5, 3, "#d8b030"]] as const) {
      this.rect(x + dx, y + dy, 5, 5, c);
      this.rect(x + dx, y + dy, 5, 1, `rgb(${shade(rgb(c), 0.3).map(Math.round).join(",")})`);
      this.px(x + dx + 2, y + dy + 2, "#efe8dc");
    }
  }

  private teddy(x: number, y: number) {
    this.ellipse(x + 8, y + 10, 4, 4, "#8a5a2a");
    this.ellipse(x + 8, y + 5, 3, 3, "#8a5a2a");
    this.px(x + 5, y + 2, "#8a5a2a");
    this.px(x + 11, y + 2, "#8a5a2a");
    this.ellipse(x + 8, y + 10, 2, 2, "#b8864a");
    this.px(x + 7, y + 4, "#1a1010");
    this.px(x + 9, y + 4, "#1a1010");
    this.px(x + 8, y + 6, "#3a2010");
    this.rect(x + 7, y + 7, 3, 1, "#a82a3a");
  }

  private dollhouse(x: number, y: number) {
    this.rect(x + 2, y + 6, 12, 9, "#a87a8a");
    for (let i = 0; i < 6; i++) this.rect(x + 2 + i, y + 6 - i, 12 - i * 2, 1, "#5a2a2a");
    this.rect(x + 4, y + 8, 2, 2, "#e8c060");
    this.rect(x + 10, y + 8, 2, 2, "#e8c060");
    this.rect(x + 7, y + 11, 2, 4, "#5a3a2a");
  }

  private toyChest(x: number, y: number) {
    this.rect(x + 2, y + 5, 12, 9, "#5a6a8a");
    this.rect(x + 2, y + 5, 12, 2, "#7a8aaa");
    this.rect(x + 7, y + 8, 2, 2, GOLD.hi);
    this.rect(x + 4, y + 3, 2, 3, "#a82a2a");
    this.px(x + 11, y + 4, "#e8c060");
  }

  private toyShelf(x: number, y: number) {
    this.rect(x + 1, y + 7, 14, 1, WOOD.light);
    this.rect(x + 2, y + 4, 3, 3, "#a82a2a");
    this.rect(x + 7, y + 3, 2, 4, "#d8c8a8");
    this.px(x + 7, y + 2, "#3a2a1a");
    this.ellipse(x + 12, y + 5, 1, 1, "#2a5aa8");
  }

  private piano(x: number, y: number) {
    this.rect(x + 4, y + 28, 24, 2, "rgba(0,0,0,0.35)");
    for (let r = 0; r < 26; r++) {
      const w = r < 9 ? 26 : 26 - Math.round(((r - 9) / 17) ** 2 * 15);
      this.rect(x + 3, y + 3 + r, w, 1, "#121014");
    }
    this.line(x + 8, y + 10, x + 20, y + 22, "#3a3842");
    this.line(x + 9, y + 10, x + 21, y + 22, "#24222a");
    this.rect(x + 3, y + 3, 26, 3, "#e8e0d0");
    for (let i = x + 4; i < x + 28; i += 2) if (i % 7 !== 0) this.px(i, y + 3, "#121014");
    this.rect(x + 10, y + 30, 10, 2, WOOD.dark);
  }

  private plant(x: number, y: number, kind: "palm" | "fern" | "flowers") {
    this.rect(x + 5, y + 10, 6, 5, "#8a4a2a");
    this.rect(x + 4, y + 10, 8, 1, "#a85a32");
    this.rect(x + 5, y + 14, 6, 1, "#5a2a14");
    const cx = x + 8;
    const cy = y + 9;
    if (kind === "flowers") {
      this.ellipse(cx, cy - 2, 4, 3, "#2f5a2c");
      for (const [dx, dy, c] of [[-2, -3, "#c83a4a"], [2, -4, "#e8c040"], [0, -1, "#c83a4a"], [3, -1, "#d878a8"], [-3, 0, "#e8e0f0"]] as const) {
        this.px(cx + dx, cy + dy, c);
      }
      return;
    }
    const n = kind === "palm" ? 7 : 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.05 + (i / (n - 1)) * 0.9);
      const len = kind === "palm" ? 7 : 5;
      this.line(cx, cy, cx + Math.round(Math.cos(a) * len), cy + Math.round(Math.sin(a) * len), i % 2 ? "#3a6a34" : "#4f8a44");
    }
  }

  private hangingBasket(x: number, y: number) {
    this.line(x + 8, y + 1, x + 5, y + 7, "#5a4a3a");
    this.line(x + 8, y + 1, x + 11, y + 7, "#5a4a3a");
    this.ellipse(x + 8, y + 8, 4, 2, "#6a4a2a");
    for (const dx of [-4, -2, 1, 3, 5]) this.rect(x + 8 + dx, y + 9, 1, 2 + (dx & 3), "#3a6a34");
    this.px(x + 6, y + 7, "#c83a4a");
  }

  private fountain(x: number, y: number) {
    const cx = x + 24;
    const cy = y + 24;
    this.ellipse(cx, cy + 2, 19, 15, "rgba(0,0,0,0.3)");
    this.ellipse(cx, cy, 19, 15, STONE.hi);
    this.ellipse(cx, cy, 17, 13, STONE.mid);
    this.ellipse(cx, cy, 15, 11, "#1e3a52");
    this.ellipse(cx, cy, 11, 8, "#2a4a6a");
    this.ellipse(cx, cy, 7, 5, "#1e3a52");
    this.ellipse(cx, cy, 3, 3, STONE.hi);
    this.ellipse(cx, cy - 4, 4, 2, STONE.mid);
    for (const [dx, dy] of [[-3, -8], [3, -8], [-6, -5], [6, -5], [0, -10]]) this.px(cx + dx, cy + dy, "#a8c8e8");
    this.px(cx - 9, cy - 4, "#5a7a9a");
    this.px(cx + 8, cy + 3, "#5a7a9a");
  }

  private stove(x: number, y: number) {
    this.rect(x + 22, y - 14, 3, 16, IRON.dark);
    this.rect(x + 21, y - 14, 5, 1, IRON.mid);
    this.rect(x + 1, y + 1, 30, 14, IRON.mid);
    this.rect(x + 1, y + 1, 30, 4, IRON.hi);
    for (const bx of [x + 6, x + 14]) this.ellipse(bx, y + 3, 3, 1, IRON.dark);
    this.rect(x + 3, y + 7, 9, 7, IRON.dark);
    this.rect(x + 20, y + 7, 9, 7, IRON.dark);
    this.rect(x + 4, y + 8, 7, 1, "#8a8a92");
    this.rect(x + 13, y + 10, 6, 3, "#c84a1a");
    this.px(x + 15, y + 11, "#ffb347");
    this.px(x + 17, y + 11, "#ffd27a");
    this.rect(x + 12, y - 1, 6, 4, "#b8642a");
    this.rect(x + 12, y - 1, 6, 1, "#d8844a");
  }

  private worktable(x: number, y: number, w: number, h: number) {
    const W = w * ART;
    const H = h * ART;
    this.rect(x + 3, y + 5, W - 4, H - 7, "rgba(0,0,0,0.3)");
    this.rect(x + 2, y + 3, W - 4, H - 8, WOOD.light);
    for (let i = y + 6; i < y + H - 5; i += 4) this.rect(x + 2, i, W - 4, 1, WOOD.mid);
    this.rect(x + 2, y + H - 5, W - 4, 2, WOOD.dark);
    this.ellipse(x + 10, y + 10, 4, 2, "#c8904a");
    this.line(x + 7, y + 9, x + 12, y + 9, "#e8b070");
    this.rect(x + 18, y + 8, 9, 6, "#a8784a");
    this.line(x + 19, y + 11, x + 25, y + 11, "#d8d8e0");
    this.ellipse(x + 34, y + 12, 3, 3, "#4a8a3a");
    this.ellipse(x + 34, y + 12, 1, 1, "#6aaa4a");
    this.ellipse(x + 40, y + 19, 4, 3, "#d8cfb8");
  }

  private counter(x: number, y: number) {
    this.rect(x + 2, y + 1, 12, 30, WOOD.mid);
    this.rect(x + 2, y + 1, 12, 2, WOOD.hi);
    this.rect(x + 4, y + 6, 8, 7, "#8a8a92");
    this.rect(x + 5, y + 7, 6, 5, "#3a4a5a");
    this.rect(x + 7, y + 5, 2, 2, "#b8b8c0");
    for (let i = 0; i < 3; i++) this.ellipse(x + 8, y + 18 + i * 3, 3, 1, i % 2 ? "#d8d0c0" : "#efe8dc");
  }

  private barrel(x: number, y: number) {
    this.rect(x + 3, y + 14, 10, 1, "rgba(0,0,0,0.35)");
    this.rect(x + 3, y + 4, 10, 10, "#5a3a1e");
    for (let i = x + 4; i < x + 13; i += 2) this.rect(i, y + 5, 1, 9, "#4a2e16");
    this.rect(x + 3, y + 6, 10, 1, IRON.mid);
    this.rect(x + 3, y + 11, 10, 1, IRON.mid);
    this.ellipse(x + 8, y + 4, 5, 2, "#7a5432");
    this.ellipse(x + 8, y + 4, 3, 1, "#4a2e16");
  }

  private crate(x: number, y: number) {
    this.rect(x + 2, y + 3, 12, 11, "#6a4a2a");
    this.rect(x + 2, y + 3, 12, 1, "#8a6a3a");
    this.line(x + 3, y + 4, x + 12, y + 13, "#4a3018");
    this.line(x + 12, y + 4, x + 3, y + 13, "#4a3018");
    this.g.strokeStyle = "#3a2410";
    this.g.strokeRect(x + 2.5, y + 3.5, 11, 10);
  }

  private sacks(x: number, y: number) {
    for (const [dx, dy] of [[1, 6], [7, 4]]) {
      this.ellipse(x + dx + 4, y + dy + 5, 4, 5, "#a8946a");
      this.rect(x + dx + 3, y + dy, 3, 1, "#6a5a3a");
      this.px(x + dx + 2, y + dy + 4, "#c8b48a");
    }
  }

  private puddle(x: number, y: number) {
    this.ellipse(x + 8, y + 9, 6, 3, "#141c26");
    this.ellipse(x + 7, y + 8, 3, 1, "#24303e");
    this.px(x + 5, y + 8, "#5a6a7a");
  }

  private potShelf(x: number, y: number, tiles: number) {
    const w = tiles * ART;
    this.rect(x, y + 7, w, 1, WOOD.light);
    this.rect(x, y + 12, w, 1, WOOD.light);
    for (let i = x + 2; i < x + w - 4; i += 6) {
      if (hash(i, y, 27) < 0.5) {
        this.rect(i, y + 4, 4, 3, "#b8642a");
        this.rect(i, y + 4, 4, 1, "#d8844a");
        this.px(i + 4, y + 5, "#8a4a1a");
      } else {
        this.rect(i, y + 3, 3, 4, "#d8cfb8");
        this.rect(i, y + 2, 3, 1, WOOD.mid);
      }
      this.ellipse(i + 2, y + 10, 2, 1, "#efe8dc");
    }
  }

  private herbs(x: number, y: number, w: number) {
    this.rect(x, y + 2, w, 1, "#6a5a3a");
    for (let i = x + 3; i < x + w - 2; i += 5) {
      const c = hash(i, y, 28) < 0.5 ? "#4a6a34" : "#7a6a3a";
      this.rect(i, y + 3, 1, 2, "#6a5a3a");
      this.rect(i - 1, y + 5, 3, 4, c);
      this.px(i, y + 9, c);
    }
  }

  private wineRack(x: number, y: number, w: number) {
    this.rect(x, y + 1, w, 13, WOOD.dark);
    for (let cy = y + 3; cy < y + 13; cy += 3) {
      for (let cx = x + 2; cx < x + w - 1; cx += 3) {
        if (hash(cx, cy, 29) < 0.15) continue;
        this.rect(cx, cy, 2, 2, "#0e120e");
        this.px(cx, cy, hash(cx, cy, 31) < 0.5 ? "#2a5a2a" : "#6a1a2a");
      }
    }
    for (let i = x; i < x + w; i += ART) this.rect(i, y + 1, 1, 13, WOOD.mid);
  }

  private bust(x: number, y: number) {
    this.rect(x + 4, y + 7, 8, 8, STONE.hi);
    this.rect(x + 4, y + 7, 8, 1, "#b8b2a6");
    this.ellipse(x + 8, y + 4, 3, 3, "#d8d0c0");
    this.rect(x + 5, y + 6, 6, 2, "#c8c0b0");
  }

  private bottleShelf(x: number, y: number, tiles: number, books: boolean) {
    const w = tiles * ART;
    this.rect(x + 1, y + 14, w - 2, 1, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 1, w - 2, 13, WOOD.dark);
    this.rect(x + 1, y + 1, w - 2, 1, WOOD.light);
    for (const sy of [y + 6, y + 11]) {
      this.rect(x + 1, sy + 1, w - 2, 1, WOOD.mid);
      for (let i = x + 2; i < x + w - 2; i += books ? 1 : 2) {
        const r = hash(i, sy, 42);
        if (books) this.rect(i, sy - 2 - (r < 0.4 ? 1 : 0), 1, 3 + (r < 0.4 ? 1 : 0), BOOKS[Math.floor(r * BOOKS.length)]);
        else if (r > 0.15) {
          this.rect(i, sy - 3, 1, 4, r < 0.5 ? "#1e3a1e" : "#3a1a22");
          this.px(i, sy - 4, "#1a1410");
        }
      }
    }
  }

  private readingTable(x: number, y: number) {
    this.chair(x + 8, y - 4, "#2f5a34", "up");
    this.rect(x + 2, y + 9, 28, 2, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 6, 30, 5, WOOD.mid);
    this.rect(x + 1, y + 6, 30, 1, WOOD.hi);
    this.rect(x + 6, y + 6, 4, 3, "#e8e0d0");
    this.rect(x + 10, y + 6, 4, 3, "#d8d0bc");
    this.px(x + 10, y + 7, "#8a7a6a");
    this.rect(x + 22, y + 4, 1, 3, CANDLE);
    this.px(x + 22, y + 3, FLAME);
    this.chair(x + 8, y + 11, "#2f5a34", "down");
    this.chair(x + 18, y + 11, "#2f5a34", "down");
  }

  private candleRack(x: number, y: number) {
    this.rect(x + 2, y + 9, 12, 2, IRON.mid);
    this.rect(x + 3, y + 11, 1, 4, IRON.dark);
    this.rect(x + 12, y + 11, 1, 4, IRON.dark);
    for (let i = 0; i < 5; i++) {
      for (const row of [0, 1]) {
        if (hash(i, row, 43) < 0.25) continue;
        const cx = x + 3 + i * 2 + row;
        const cy = y + 6 + row * 3 - 3;
        this.rect(cx, cy + 1, 1, 2, CANDLE);
        this.px(cx, cy, FLAME);
      }
    }
  }

  private pram(x: number, y: number) {
    this.ellipse(x + 8, y + 12, 6, 6, "#1a1a2a");
    this.ellipse(x + 8, y + 8, 6, 4, "#2a2a3e");
    this.ellipse(x + 8, y + 15, 4, 3, "#d8d0e0");
    for (const [dx, dy] of [[-6, 6], [6, 6], [-6, 19], [6, 19]]) this.ellipse(x + 8 + dx, y + dy, 1, 1, IRON.hi);
    this.line(x + 8, y + 19, x + 8, y + 24, IRON.hi);
  }

  private teaTable(x: number, y: number) {
    this.ellipse(x + 8, y + 9, 6, 4, "#e8e0e8");
    this.ellipse(x + 8, y + 8, 5, 3, "#f4eef4");
    this.ellipse(x + 8, y + 7, 2, 2, "#8a6a9a");
    this.px(x + 11, y + 7, "#8a6a9a");
    this.px(x + 4, y + 9, "#efe8dc");
    this.px(x + 12, y + 10, "#efe8dc");
  }

  private ball(x: number, y: number) {
    this.ellipse(x + 8, y + 9, 3, 3, "#c83a3a");
    this.rect(x + 5, y + 9, 7, 1, "#e8d8b0");
    this.px(x + 7, y + 7, "#e88a8a");
  }

  private soldiers(x: number, y: number) {
    for (const dx of [3, 7, 11]) {
      this.rect(x + dx, y + 6, 2, 3, "#a82a2a");
      this.rect(x + dx, y + 9, 2, 3, "#1a1a3a");
      this.rect(x + dx, y + 4, 2, 2, "#1a1414");
    }
  }

  private mapTable(x: number, y: number) {
    this.rect(x + 2, y + 13, 28, 2, "rgba(0,0,0,0.35)");
    this.rect(x + 1, y + 3, 30, 10, WOOD.mid);
    this.rect(x + 1, y + 3, 30, 1, WOOD.hi);
    this.rect(x + 4, y + 4, 22, 8, "#c8b48a");
    this.line(x + 6, y + 9, x + 12, y + 6, "#6a5a3a");
    this.line(x + 12, y + 6, x + 20, y + 8, "#6a5a3a");
    this.ellipse(x + 18, y + 7, 2, 1, "#4a6a8a");
    this.px(x + 22, y + 5, "#a82a2a");
    this.rect(x + 3, y + 4, 1, 8, "#a8946a");
    this.rect(x + 26, y + 4, 1, 8, "#a8946a");
  }

  private chess(x: number, y: number) {
    this.ellipse(x + 8, y + 9, 6, 5, WOOD.mid);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) this.px(x + 5 + i, y + 6 + j, (i + j) & 1 ? "#1a1410" : "#d8d0bc");
    this.px(x + 6, y + 5, "#efe8dc");
    this.px(x + 9, y + 11, "#1a1414");
  }

  private servingCart(x: number, y: number) {
    this.rect(x + 3, y + 5, 10, 8, "#a8a8b0");
    this.rect(x + 3, y + 5, 10, 1, "#d8d8e0");
    this.ellipse(x + 8, y + 7, 3, 1, "#c8c8d0");
    this.rect(x + 7, y + 5, 2, 1, "#8a8a92");
    for (const dx of [3, 12]) this.px(x + dx, y + 14, IRON.dark);
  }

  private roundTable(x: number, y: number) {
    for (const [dx, dy] of [[16, 3], [16, 29], [3, 16], [29, 16]]) {
      this.ellipse(x + dx, y + dy, 2, 2, "#5a1a2a");
      this.px(x + dx, y + dy - 1, "#7a2a3a");
    }
    this.ellipse(x + 16, y + 18, 8, 7, "rgba(0,0,0,0.3)");
    this.ellipse(x + 16, y + 16, 8, 7, "#d8cfb8");
    this.ellipse(x + 16, y + 16, 6, 5, "#e8e0cc");
    this.rect(x + 16, y + 12, 1, 3, CANDLE);
    this.px(x + 16, y + 11, FLAME);
    this.px(x + 13, y + 17, "#7a1a2a");
    this.px(x + 19, y + 16, "#7a1a2a");
  }

  private harp(x: number, y: number) {
    this.line(x + 4, y + 14, x + 4, y + 2, GOLD.mid);
    this.line(x + 4, y + 2, x + 12, y + 6, GOLD.hi);
    this.line(x + 4, y + 14, x + 12, y + 6, GOLD.dark);
    for (let i = 5; i < 12; i += 2) this.line(x + i, y + 3 + Math.round((i - 4) / 2), x + i, y + 14 - (i - 4), "#d8d0bc");
    this.rect(x + 3, y + 14, 6, 1, GOLD.dark);
  }

  private bench(x: number, y: number, tiles: number) {
    const w = tiles * ART;
    this.rect(x + 2, y + 12, w - 4, 1, "rgba(0,0,0,0.35)");
    this.rect(x + 2, y + 6, w - 4, 5, "#6a5a4a");
    this.rect(x + 2, y + 6, w - 4, 1, "#8a7a6a");
    for (let i = x + 4; i < x + w - 4; i += 4) this.px(i, y + 8, "#5a4a3a");
    this.rect(x + 3, y + 11, 2, 3, IRON.mid);
    this.rect(x + w - 5, y + 11, 2, 3, IRON.mid);
  }

  private benchSide(x: number, y: number) {
    this.rect(x + 5, y + 2, 7, 28, "rgba(0,0,0,0.3)");
    this.rect(x + 4, y + 1, 7, 28, WOOD.mid);
    this.rect(x + 4, y + 1, 2, 28, "#5a1a22");
    this.rect(x + 4, y + 1, 7, 1, WOOD.hi);
  }

  private birdcage(x: number, y: number) {
    this.rect(x + 7, y + 10, 2, 5, GOLD.dark);
    this.rect(x + 5, y + 14, 6, 1, GOLD.dark);
    this.ellipse(x + 8, y + 5, 4, 4, "rgba(0,0,0,0)");
    for (let i = -4; i <= 4; i += 2) this.line(x + 8 + i, y + 9, x + 8 + Math.round(i / 2), y + 1, GOLD.mid);
    this.rect(x + 4, y + 9, 9, 1, GOLD.mid);
    this.px(x + 8, y, GOLD.hi);
    this.rect(x + 7, y + 5, 2, 2, "#e8c040");
    this.px(x + 9, y + 5, "#c86a1a");
  }

  private chopBlock(x: number, y: number) {
    this.ellipse(x + 8, y + 10, 5, 4, "#5a3a1e");
    this.ellipse(x + 8, y + 8, 5, 3, "#a8845a");
    this.ellipse(x + 8, y + 8, 3, 2, "#8a6a42");
    this.rect(x + 9, y + 4, 4, 3, "#c8c8d0");
    this.rect(x + 7, y + 6, 3, 1, WOOD.dark);
  }

  private bucket(x: number, y: number) {
    this.rect(x + 5, y + 7, 7, 7, "#6a6a72");
    this.ellipse(x + 8, y + 7, 3, 1, "#3a5a7a");
    this.rect(x + 5, y + 10, 7, 1, IRON.dark);
    this.line(x + 5, y + 7, x + 8, y + 3, IRON.hi);
    this.line(x + 11, y + 7, x + 8, y + 3, IRON.hi);
  }

  // A black cat, curled up by the stove.
  private cat(x: number, y: number) {
    this.ellipse(x + 8, y + 10, 5, 3, "#121014");
    this.ellipse(x + 11, y + 8, 2, 2, "#121014");
    this.px(x + 10, y + 5, "#121014");
    this.px(x + 13, y + 5, "#121014");
    this.px(x + 10, y + 8, "#d8c040");
    this.px(x + 12, y + 8, "#d8c040");
    this.line(x + 3, y + 10, x + 4, y + 13, "#121014");
    this.line(x + 4, y + 13, x + 9, y + 13, "#121014");
  }

  private rat(x: number, y: number) {
    this.ellipse(x + 8, y + 10, 3, 2, "#5a5650");
    this.px(x + 11, y + 9, "#5a5650");
    this.px(x + 12, y + 9, "#d8a0a0");
    this.px(x + 10, y + 9, "#1a1010");
    this.line(x + 5, y + 10, x + 2, y + 12, "#a87a7a");
  }

  private brokenChair(x: number, y: number) {
    this.rect(x + 3, y + 8, 7, 5, WOOD.mid);
    this.line(x + 9, y + 4, x + 13, y + 9, WOOD.dark);
    this.line(x + 2, y + 13, x + 5, y + 15, WOOD.dark);
    this.rect(x + 11, y + 12, 3, 1, WOOD.light);
  }

  private chains(x: number, y: number) {
    for (let i = 0; i < 9; i += 2) this.px(x, y + 2 + i, IRON.hi);
    for (let i = 1; i < 9; i += 2) this.px(x + 1, y + 2 + i, IRON.mid);
    this.rect(x - 1, y + 11, 4, 2, IRON.hi);
  }

  // A faint ring on the floor under where the chandelier hangs.
  private chandelierRing(r: Room) {
    const cx = ((r.x0 + r.x1 + 1) / 2) * ART;
    const cy = ((r.y0 + r.y1 + 1) / 2) * ART;
    const rad = Math.min(r.x1 - r.x0, r.y1 - r.y0) * 4;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      this.px(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad * 0.8, a % 2 ? "rgba(232,192,96,0.35)" : "rgba(232,192,96,0.15)");
    }
  }

  private cobweb(x: number, y: number, dir: 1 | -1) {
    const c = "rgba(210, 210, 220, 0.45)";
    for (let i = 0; i < 9; i++) this.px(x + dir * i, y + i, c);
    for (let i = 0; i < 10; i++) this.px(x + dir * i, y, c);
    for (let i = 0; i < 10; i++) this.px(x, y + i, c);
    for (const k of [3, 6]) {
      for (let i = 0; i <= k; i++) this.px(x + dir * i, y + k - i + Math.round(Math.sin((i / k) * Math.PI)), c);
    }
  }
}
