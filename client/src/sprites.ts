// Procedural pixel-art characters. Every guest is painted pixel by pixel at
// runtime, so the game ships without image assets. Each player colour maps to
// one costume from the cast (the Colonel, the Widow, …) and the coat takes the
// player's colour, so silhouettes and colours both identify people.

export const FRAME_W = 18; // 16 px of art + 1 px outline on each side
export const FRAME_H = 24; // 20 px of art, 2 px of headroom for tall hats, outline

export type Dir = "down" | "up" | "side";
export const DIRS: Dir[] = ["down", "up", "side"];
export const IDLE_FRAMES = 2;
export const WALK_FRAMES = 4;
// Fidget frames, played after standing still a while: glance left, glance
// right, blink, shift weight.
export const FIDGET_FRAMES = 4;
export const FRAMES_PER_DIR = IDLE_FRAMES + WALK_FRAMES + FIDGET_FRAMES;

// Same order as the server's palette in server/internal/server/room.go.
const PALETTE = ["#e04848", "#3f7fe0", "#3fae5a", "#e0c33f", "#9b5de5", "#f08a2c", "#e8e4dc", "#f06fb0", "#2fb8b0", "#9a6a3a"];

// The characters players choose from, by colour (the server's botNames).
export const CHARACTERS = [
  ["The Colonel", "Home from the colonies with a cap, a moustache and a great many stories."],
  ["The Gentleman", "Top hat, gloves and a fortune nobody can quite account for."],
  ["The Widow", "Behind the black lace veil, she has buried two husbands already."],
  ["The Poet", "Wild hair, a long scarf, and verses about death he reads to anyone."],
  ["The Physician", "Spectacles, a bowler and a bag of remedies, some of them poisons."],
  ["The Governess", "Prim collar, tight bun, and she knows every secret of the nursery."],
  ["The Clergyman", "A wide hat, a white collar, and a prayer for every occasion."],
  ["The Heiress", "Under the bonnet, the one the will would make very rich indeed."],
  ["The Inventor", "Goggles up, pockets full of springs and half-finished machines."],
  ["The Gambler", "Flat cap, quick hands, and he has wagered on how the night ends."],
].map(([name, blurb], i) => ({ color: PALETTE[i], name, blurb }));

type Costume = "colonel" | "tophat" | "widow" | "poet" | "physician" | "governess" | "clergyman" | "heiress" | "inventor" | "gambler";
const COSTUMES: Costume[] = ["colonel", "tophat", "widow", "poet", "physician", "governess", "clergyman", "heiress", "inventor", "gambler"];
const SKIN = ["#e8b48f", "#f1c7a3", "#d9a07a", "#c58b62", "#f3d0b0", "#e0a982", "#a8704c", "#f5d6bd", "#cf9a73", "#8d5b3d"];
const HAIR = ["#d8d4cc", "#2b1d14", "#1a1414", "#c8742c", "#4a3020", "#5a3a22", "#2a2420", "#e6c27a", "#9a9a9a", "#3a2618"];

const OUTLINE = "#140d0a";
const TROUSERS = "#2b2420";
const BOOTS = "#1a120c";
const SHIRT = "#ece4d2";
const EYE = "#1a1210";

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

class Pixels {
  grid: (string | null)[][] = Array.from({ length: FRAME_H }, () => Array(FRAME_W).fill(null));
  // Art coordinates are 16x20 (hats may reach y = -2); the frame adds room
  // above for hats and a 1 px border for the outline.
  set(x: number, y: number, c: string) {
    const gx = x + 1, gy = y + 3;
    if (gx >= 0 && gy >= 0 && gx < FRAME_W && gy < FRAME_H) this.grid[gy][gx] = c;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  outline() {
    const g = this.grid;
    const add: [number, number][] = [];
    for (let y = 0; y < FRAME_H; y++)
      for (let x = 0; x < FRAME_W; x++)
        if (!g[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== OUTLINE)) add.push([x, y]);
    for (const [x, y] of add) g[y][x] = OUTLINE;
  }
}

interface Look {
  costume: Costume;
  coat: string;
  coatDark: string;
  coatLight: string;
  skin: string;
  hair: string;
}

export function lookFor(color: string): Look {
  let i = PALETTE.indexOf(color.toLowerCase());
  if (i < 0) i = [...color].reduce((a, c) => a + c.charCodeAt(0), 0) % COSTUMES.length;
  return { costume: COSTUMES[i], coat: color, coatDark: shade(color, -0.35), coatLight: shade(color, 0.25), skin: SKIN[i], hair: HAIR[i] };
}

// paint draws one frame. kind/frame pick the pose: idle breathes, walk
// steps, fidget glances, blinks and shifts its weight.
function paint(look: Look, dir: Dir, kind: "idle" | "walk" | "fidget", frame: number): Pixels {
  const p = new Pixels();
  const walk = kind === "walk";
  const fidget = kind === "fidget" ? frame : -1;
  const step = walk ? [0, 1, 0, -1][frame] : fidget === 3 && dir !== "side" ? 1 : 0; // which leg is forward
  // Up as the legs pass each other, down as a foot lands.
  const bob = walk ? (frame % 2 === 0 ? -1 : 0) : frame === 1 && kind === "idle" ? 1 : 0;
  const side = dir === "side";
  const front = dir === "down";

  // Legs and boots stay planted; the upper body bobs.
  if (side) {
    if (step === 0) {
      p.rect(7, 16, 8, 18, TROUSERS);
      p.rect(7, 19, 9, 19, BOOTS);
    } else {
      p.rect(5, 16, 6, 17, TROUSERS);
      p.rect(9, 16, 10, 17, TROUSERS);
      p.rect(4, 18, 5, 18, TROUSERS);
      p.rect(10, 18, 11, 18, TROUSERS);
      p.rect(3, 19, 5, 19, BOOTS);
      p.rect(10, 19, 12, 19, BOOTS);
    }
  } else {
    const l = step === 1 ? -1 : 0, r = step === -1 ? -1 : 0;
    p.rect(5, 16, 6, 18 + l, TROUSERS);
    p.rect(9, 16, 10, 18 + r, TROUSERS);
    p.rect(5, 19 + l, 6, 19 + l, BOOTS);
    p.rect(9, 19 + r, 10, 19 + r, BOOTS);
  }

  const y = (v: number) => v + bob;
  // Torso.
  const tx0 = side ? 5 : 4, tx1 = side ? 10 : 11;
  p.rect(tx0, y(10), tx1, y(15), look.coat);
  p.rect(tx1, y(10), tx1, y(15), look.coatDark);
  p.rect(tx0, y(10), tx0, y(10), look.coatLight);
  p.rect(tx0, y(15), tx1, y(15), look.coatDark);
  if (front) {
    p.rect(7, y(10), 8, y(12), SHIRT);
    p.set(7, y(13), look.coatDark);
    p.set(8, y(14), look.coatDark);
  }
  // Arms swing opposite to the legs.
  if (side) {
    const s = walk ? step : 0;
    p.rect(7 + s, y(11), 8 + s, y(14), look.coatDark);
    p.rect(7 + s, y(15), 8 + s, y(15), look.skin);
  } else {
    const la = walk ? step : 0;
    p.rect(3, y(11) + la, 3, y(14) + la, look.coatDark);
    p.rect(12, y(11) - la, 12, y(14) - la, look.coatDark);
    p.set(3, y(15) + la, look.skin);
    p.set(12, y(15) - la, look.skin);
  }

  // Head.
  const hx0 = side ? 6 : 5, hx1 = side ? 10 : 10;
  p.rect(hx0 + 1, y(3), hx1 - 1, y(3), look.skin);
  p.rect(hx0, y(4), hx1, y(8), look.skin);
  p.rect(hx0 + 1, y(9), hx1 - 1, y(9), look.skin);
  // Hair: a fringe in front, a full back of the head, a side sweep.
  if (dir === "up") {
    p.rect(hx0, y(3), hx1, y(8), look.hair);
    p.rect(hx0, y(4), hx0, y(8), shade(look.hair, -0.25));
    p.rect(hx1, y(4), hx1, y(8), shade(look.hair, -0.25));
    p.rect(hx0 + 1, y(8), hx1 - 1, y(8), shade(look.hair, -0.25));
    p.set(hx0 + 2, y(5), shade(look.hair, 0.2));
  }
  else if (side) {
    p.rect(hx0, y(3), hx1, y(3), look.hair);
    p.rect(hx0, y(4), hx0 + 1, y(7), look.hair);
  } else {
    p.rect(hx0, y(3), hx1, y(3), look.hair);
    p.set(hx0, y(4), look.hair);
    p.set(hx1, y(4), look.hair);
  }
  const glance = fidget === 0 ? -1 : fidget === 1 ? 1 : 0;
  const eye = fidget === 2 ? shade(look.skin, -0.35) : EYE; // a blink
  if (front) {
    p.set(6 + glance, y(6), eye);
    p.set(9 + glance, y(6), eye);
    p.set(7, y(8), shade(look.skin, -0.2));
    p.set(8, y(8), shade(look.skin, -0.2));
  } else if (side) {
    p.set(9 + Math.min(0, glance), y(6), eye);
    p.set(10, y(7), shade(look.skin, -0.15));
  }

  costume(p, look, dir, y, hx0, hx1);
  p.outline();
  return p;
}

function costume(p: Pixels, look: Look, dir: Dir, y: (v: number) => number, hx0: number, hx1: number) {
  const front = dir === "down", side = dir === "side";
  const black = "#17120f";
  switch (look.costume) {
    case "colonel": // peaked military cap and a grand moustache
      p.rect(hx0, y(1), hx1, y(3), "#3d4a2a");
      p.rect(hx0, y(1), hx1, y(1), "#4d5c36");
      if (front) {
        p.rect(hx0, y(4), hx1, y(4), black);
        p.set(7, y(2), "#e8c24a");
        p.set(8, y(2), "#e8c24a");
        p.rect(6, y(8), 9, y(8), look.hair);
        p.set(5, y(7), look.hair);
        p.set(10, y(7), look.hair);
      } else if (side) {
        p.rect(hx1, y(4), hx1 + 1, y(4), black);
        p.rect(9, y(8), 10, y(8), look.hair);
      }
      break;
    case "tophat": // tall top hat with a band in the coat colour
      p.rect(hx0 + 1, y(-2), hx1 - 1, y(2), black);
      p.rect(hx0 + 1, y(1), hx1 - 1, y(1), look.coat);
      p.rect(hx0 - 1, y(3), hx1 + 1, y(3), black);
      break;
    case "widow": // wide black hat and a lace veil over the face
      p.rect(hx0 + 1, y(0), hx1 - 1, y(2), black);
      p.rect(hx0 - 2, y(3), hx1 + 2, y(3), black);
      if (dir !== "up")
        for (let yy = 4; yy <= 9; yy++) for (let x = hx0; x <= hx1; x++) if ((x + yy) % 2 === 0) p.set(x, y(yy), "#2a2026");
      if (dir === "up") p.rect(hx0, y(4), hx1, y(10), "#2a2026");
      break;
    case "poet": // wild hair and a long cream scarf
      p.rect(hx0 - 1, y(2), hx1 + 1, y(3), look.hair);
      p.set(hx0, y(1), look.hair);
      p.set(hx0 + 3, y(1), look.hair);
      p.set(hx1 - 1, y(1), look.hair);
      if (!side) {
        p.rect(hx0 - 1, y(4), hx0 - 1, y(8), look.hair);
        p.rect(hx1 + 1, y(4), hx1 + 1, y(8), look.hair);
      }
      p.rect(side ? 5 : 4, y(10), side ? 10 : 11, y(10), "#efe0b8");
      if (front) p.rect(9, y(11), 10, y(13), "#efe0b8");
      if (side) p.rect(4, y(10), 4, y(13), "#efe0b8");
      break;
    case "physician": // bowler hat and round spectacles
      p.rect(hx0 + 1, y(0), hx1 - 1, y(2), black);
      p.rect(hx0, y(1), hx1, y(2), black);
      p.rect(hx0 - 1, y(3), hx1 + 1, y(3), black);
      if (front) {
        p.rect(5, y(5), 7, y(5), "#b8c4cc");
        p.rect(8, y(5), 10, y(5), "#b8c4cc");
        p.set(6, y(6), "#9fd0ff");
        p.set(9, y(6), "#9fd0ff");
      } else if (side) p.rect(8, y(5), 10, y(5), "#b8c4cc");
      break;
    case "governess": // tight bun and a high white collar
      p.rect(hx0, y(2), hx1, y(3), look.hair);
      if (dir === "up") p.rect(6, y(4), 9, y(6), shade(look.hair, 0.15));
      else p.rect(side ? 5 : 6, y(0), side ? 6 : 9, y(1), look.hair);
      if (front) p.rect(6, y(10), 9, y(10), SHIRT);
      break;
    case "clergyman": // flat wide hat and a clerical collar
      p.rect(hx0 + 1, y(1), hx1 - 1, y(2), black);
      p.rect(hx0 - 2, y(3), hx1 + 2, y(3), black);
      if (front) {
        p.rect(6, y(10), 9, y(10), black);
        p.rect(7, y(10), 8, y(10), "#ffffff");
      }
      break;
    case "heiress": // a cream bonnet tied with a ribbon
      p.rect(hx0 - 1, y(1), hx1 + 1, y(3), "#f3e6c8");
      if (front) {
        p.rect(hx0 - 1, y(4), hx0 - 1, y(8), "#f3e6c8");
        p.rect(hx1 + 1, y(4), hx1 + 1, y(8), "#f3e6c8");
        p.set(hx0, y(9), look.coatLight);
        p.set(hx1, y(9), look.coatLight);
      } else if (side) p.rect(hx0 - 1, y(4), hx0, y(7), "#f3e6c8");
      else p.rect(hx0, y(4), hx1, y(5), "#f3e6c8");
      p.rect(hx0, y(1), hx1, y(1), look.coatLight);
      break;
    case "inventor": // grey hair and brass goggles pushed up on the forehead
      p.rect(hx0 - 1, y(2), hx1 + 1, y(3), look.hair);
      p.set(hx0 - 1, y(1), look.hair);
      p.set(hx1 + 1, y(1), look.hair);
      if (!side) p.rect(hx0, y(4), hx1, y(4), "#b0843a");
      if (front) {
        p.rect(6, y(4), 7, y(4), "#7fd6e8");
        p.rect(8, y(4), 9, y(4), "#7fd6e8");
      } else if (side) {
        p.rect(hx0, y(4), hx1, y(4), "#b0843a");
        p.rect(9, y(4), 10, y(4), "#7fd6e8");
      }
      break;
    case "gambler": // a flat cap and a sly grin
      p.rect(hx0, y(1), hx1, y(3), shade(look.coat, -0.5));
      if (front) {
        p.rect(hx0, y(4), hx1, y(4), shade(look.coat, -0.65));
        p.set(9, y(8), "#7a2a20");
      } else if (side) p.rect(hx1 - 1, y(3), hx1 + 2, y(3), shade(look.coat, -0.65));
      break;
  }
}

// sheet paints every frame for one colour into a single strip:
// for each direction, IDLE_FRAMES idle frames, WALK_FRAMES walk frames, then
// FIDGET_FRAMES fidget frames.
export function sheet(color: string): HTMLCanvasElement {
  const look = lookFor(color);
  const cv = document.createElement("canvas");
  cv.width = FRAME_W * FRAMES_PER_DIR * DIRS.length;
  cv.height = FRAME_H;
  const ctx = cv.getContext("2d")!;
  DIRS.forEach((dir, di) => {
    for (let f = 0; f < FRAMES_PER_DIR; f++) {
      const fid = IDLE_FRAMES + WALK_FRAMES;
      const px = f >= fid ? paint(look, dir, "fidget", f - fid) : f >= IDLE_FRAMES ? paint(look, dir, "walk", f - IDLE_FRAMES) : paint(look, dir, "idle", f);
      const ox = (di * FRAMES_PER_DIR + f) * FRAME_W;
      px.grid.forEach((row, yy) =>
        row.forEach((c, xx) => {
          if (!c) return;
          ctx.fillStyle = c;
          ctx.fillRect(ox + xx, yy, 1, 1);
        }),
      );
    }
  });
  return cv;
}

export function frameIndex(dir: Dir, walk: boolean, frame: number) {
  return DIRS.indexOf(dir) * FRAMES_PER_DIR + (walk ? IDLE_FRAMES + frame : frame);
}

export function fidgetIndex(dir: Dir, frame: number) {
  return DIRS.indexOf(dir) * FRAMES_PER_DIR + IDLE_FRAMES + WALK_FRAMES + frame;
}

const walkStrips = new Map<string, string>();

// walkStrip is a data URL of the walking-towards-you frames, scaled up, for
// the HTML screens (animated with a CSS steps() animation).
export function walkStrip(color: string, scale = 3): string {
  const key = `${color}:${scale}`;
  const cached = walkStrips.get(key);
  if (cached) return cached;
  const src = sheet(color);
  const cv = document.createElement("canvas");
  cv.width = FRAME_W * WALK_FRAMES * scale;
  cv.height = FRAME_H * scale;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const sx = frameIndex("down", true, 0) * FRAME_W;
  ctx.drawImage(src, sx, 0, FRAME_W * WALK_FRAMES, FRAME_H, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL();
  walkStrips.set(key, url);
  return url;
}

export type PageKind = "laid" | "carried" | "missing";
const pageIcons = new Map<PageKind, string>();

// A page of the will as a 12×15 pixel icon for the HUD, drawn at 3×:
// sealed with red wax once it is on the altar, bright while carried, a
// faint outline while it is still lost somewhere in the manor.
export function pageIcon(kind: PageKind): string {
  const cached = pageIcons.get(kind);
  if (cached) return cached;
  const W = 12, H = 15, S = 3;
  const c = document.createElement("canvas");
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x * S, y * S, w * S, h * S);
  };
  if (kind === "missing") {
    for (let i = 0; i < W - 3; i += 2) px(i, 0, 1, 1, "#6a5a40");
    for (let i = 0; i < H; i += 2) px(0, i, 1, 1, "#6a5a40");
    for (let i = 4; i < H; i += 2) px(W - 1, i, 1, 1, "#6a5a40");
    for (let i = 1; i < W; i += 2) px(i, H - 1, 1, 1, "#6a5a40");
    px(W - 3, 1, 1, 1, "#6a5a40");
    px(W - 2, 2, 1, 1, "#6a5a40");
  } else {
    const paper = kind === "carried" ? "#f4ead0" : "#e2d4b0";
    px(0, 0, W - 3, H, "#8a7650");
    px(0, 3, W, H - 3, "#8a7650");
    px(1, 1, W - 4, H - 2, paper);
    px(1, 3, W - 2, H - 4, paper);
    // The folded corner.
    px(W - 3, 1, 1, 2, "#c8b48a");
    px(W - 2, 2, 1, 1, "#c8b48a");
    px(W - 3, 0, 1, 1, "#8a7650");
    px(W - 2, 1, 1, 1, "#8a7650");
    px(W - 1, 2, 1, 1, "#8a7650");
    // Lines of handwriting.
    for (const [y, w] of [[4, 7], [6, 8], [8, 6], [10, 7]] as const) px(2, y, w, 1, "#8a7a55");
    px(2, 12, 4, 1, "#5a4a30");
    if (kind === "laid") {
      px(7, 10, 3, 3, "#a82a2a");
      px(6, 11, 5, 1, "#a82a2a");
      px(8, 9, 1, 5, "#a82a2a");
      px(7, 10, 1, 1, "#d85a4a");
    }
  }
  const url = c.toDataURL();
  pageIcons.set(kind, url);
  return url;
}
