import type { MapView, Rect, Vec } from "./protocol";

// World is the client's copy of the manor with fast tile lookups. The
// movement rule must match server/internal/game/geom.go step for step, or
// client prediction will drift from the server.

export const BODY_RADIUS = 0.3;

export class World {
  readonly w: number;
  readonly h: number;
  private solid: Uint8Array;
  private opaque: Uint8Array;
  private roomIndex: Int16Array;

  constructor(readonly view: MapView) {
    this.w = view.w;
    this.h = view.h;
    this.solid = new Uint8Array(this.w * this.h);
    this.opaque = new Uint8Array(this.w * this.h);
    this.roomIndex = new Int16Array(this.w * this.h).fill(-1);
    view.rows.forEach((row, y) => {
      for (let x = 0; x < this.w; x++) {
        const c = row[x];
        this.solid[y * this.w + x] = c === "." ? 0 : 1;
        this.opaque[y * this.w + x] = c === "#" ? 1 : 0;
      }
    });
    view.rooms.forEach((r, i) => {
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) this.roomIndex[y * this.w + x] = i;
    });
  }

  private inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  solidAt(x: number, y: number) {
    return !this.inside(x, y) || this.solid[y * this.w + x] === 1;
  }

  opaqueAt(x: number, y: number) {
    return !this.inside(x, y) || this.opaque[y * this.w + x] === 1;
  }

  tile(x: number, y: number) {
    return this.inside(x, y) ? this.view.rows[y][x] : "#";
  }

  roomAt(x: number, y: number) {
    const tx = Math.floor(x), ty = Math.floor(y);
    return this.inside(tx, ty) ? this.roomIndex[ty * this.w + tx] : -1;
  }

  private blocked(x: number, y: number) {
    const x0 = Math.floor(x - BODY_RADIUS), x1 = Math.floor(x + BODY_RADIUS);
    const y0 = Math.floor(y - BODY_RADIUS), y1 = Math.floor(y + BODY_RADIUS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) return true;
    return false;
  }

  move(p: Vec, dx: number, dy: number, ghost: boolean): Vec {
    let { x, y } = p;
    const nx = x + dx;
    if (ghost || !this.blocked(nx, y)) x = nx;
    const ny = y + dy;
    if (ghost || !this.blocked(x, ny)) y = ny;
    x = Math.min(Math.max(x, 0.5), this.w - 0.5);
    y = Math.min(Math.max(y, 0.5), this.h - 0.5);
    return { x, y };
  }

  // rayDistances casts rays from (x, y) and returns how far each travels
  // before a wall, up to maxR. These shape the candlelight.
  rayDistances(x: number, y: number, maxR: number, rays: number): Float32Array {
    const out = new Float32Array(rays);
    const step = 0.06;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      let d = 0;
      while (d < maxR) {
        d += step;
        if (this.opaqueAt(Math.floor(x + cx * d), Math.floor(y + cy * d))) break;
      }
      // Let light touch the face of the wall it hit.
      out[i] = Math.min(d + 0.15, maxR);
    }
    return out;
  }
}

export function inputStep(dx: number, dy: number, speed: number, dt: number): [number, number] {
  let l = Math.sqrt(dx * dx + dy * dy);
  if (l === 0) return [0, 0];
  if (l > 1) {
    dx = dx / l;
    dy = dy / l;
  }
  return [dx * speed * dt, dy * speed * dt];
}

export function distToRect(r: Rect, p: Vec) {
  const cx = Math.max(r.x0, Math.min(p.x, r.x1 + 1));
  const cy = Math.max(r.y0, Math.min(p.y, r.y1 + 1));
  return Math.hypot(p.x - cx, p.y - cy);
}

export function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
