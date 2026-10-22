import Phaser from "phaser";
import type { Session } from "./session";
import type { Vec } from "./protocol";
import { ART, paintManor } from "./roomart";
import * as sfx from "./sfx";
import { dist } from "./world";
import { DIRS, FRAMES_PER_DIR, FRAME_H, FRAME_W, IDLE_FRAMES, WALK_FRAMES, frameIndex, sheet } from "./sprites";

export const TS = 32; // pixels per tile
// The camera's zoom. Art pixels are 2 world pixels, so 1.5 makes each one
// exactly 3 screen pixels and the pixel art stays crisp.
const ZOOM = 1.5;

const RAYS = 120;
const HOLD_MS = 180; // a press longer than this steers toward the cursor

// Footsteps: one every STRIDE tiles walked, heard up to HEAR_STEPS tiles
// away. Rooms with stone, tile or marble floors sound sharper than wood.
const STRIDE = 1.1;
const HEAR_STEPS = 10;
const STONE_FLOORS = new Set(["chapel", "ballroom", "conservatory", "entrance", "kitchen", "cellar"]);
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

type Facing = "down" | "up" | "left" | "right";

// Where the candle sits relative to a character's feet, in screen pixels,
// for each way they can face.
const CANDLE_AT: Record<Facing, [number, number]> = { down: [8, -2], up: [-8, -2], right: [5, -2], left: [-5, -2] };

// A kill heard nearby: the sword, then blood that sprays, lands and pools.
const GORE_MS = 12000;
const GRAVITY = 900; // screen px/s²

interface Drop {
  vx: number;
  vy: number;
  delay: number; // s after the kill: three spurts, each weaker
  ground: number; // px below the chest where it lands
  land: number; // s in the air
  size: number;
}

interface Motion {
  x: number;
  y: number;
  face: Facing;
  movingUntil: number;
}

interface Light {
  x: number;
  y: number;
  r: number;
  rays: Float32Array;
  warm: boolean;
}

export class GameScene extends Phaser.Scene {
  private session!: Session;
  private mapImg?: Phaser.GameObjects.Image;
  private dynG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private bodies = new Map<string, Phaser.GameObjects.Sprite>();
  private motion = new Map<string, Motion>();
  private steps = new Map<string, { x: number; y: number; walked: number; left: boolean }>();
  private myInput: [number, number] = [0, 0];
  // Mouse movement: hold the left button to walk toward the cursor, or click
  // to walk to a spot (along a path through doors). Keys take over at once.
  private mouseDown = false;
  private mouseDownAt = 0;
  private walk: { path: Vec[]; last: Vec; still: number } | null = null;
  private markG!: Phaser.GameObjects.Graphics;
  private goreG!: Phaser.GameObjects.Graphics;
  private gore = new WeakMap<object, { drops: Drop[]; shook: boolean }>();
  private mark: { x: number; y: number; at: number } | null = null;
  private glowG!: Phaser.GameObjects.Graphics;
  private eraser!: Phaser.GameObjects.Graphics;
  private dark!: Phaser.GameObjects.RenderTexture;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private hearthRays = new Map<number, Float32Array>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private lastNow = 0;
  private builtFor?: object;

  constructor() {
    super("game");
  }

  init(data: { session: Session }) {
    this.session = data.session;
  }

  create() {
    this.glowG = this.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    this.dynG = this.add.graphics().setDepth(4);
    this.fxG = this.add.graphics().setDepth(4.9);
    this.eraser = this.make.graphics({}, false);
    this.dark = this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setScrollFactor(0).setDepth(10);
    this.scale.on("resize", (size: Phaser.Structs.Size) => this.dark.resize(size.width, size.height));

    const kb = this.input.keyboard!;
    const k = (code: string) => kb.addKey(code, false);
    this.keys = {
      up: k("W"), down: k("S"), left: k("A"), right: k("D"),
      up2: k("UP"), down2: k("DOWN"), left2: k("LEFT"), right2: k("RIGHT"),
    };
    this.cameras.main.setBackgroundColor("#030204").setZoom(ZOOM);

    this.markG = this.add.graphics().setDepth(10.4);
    this.goreG = this.add.graphics().setDepth(10.45);
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      this.mouseDown = true;
      this.mouseDownAt = performance.now();
      this.walk = null;
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (!this.mouseDown) return;
      this.mouseDown = false;
      // A quick click walks to the spot; a long hold already walked there.
      if (performance.now() - this.mouseDownAt < HOLD_MS) this.walkTo(this.pointerTile(p));
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", () => (this.mouseDown = false));
    this.input.on("gameout", () => (this.mouseDown = false));
    // Any movement key cancels a clicked walk, even a tap too quick for the
    // next movement tick to see.
    const moveKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    kb.on("keydown", (e: KeyboardEvent) => {
      if (moveKeys.has(e.key.toLowerCase())) this.walk = null;
    });
  }

  private buildMap() {
    const s = this.session;
    const world = s.world!;
    const view = world.view;
    this.builtFor = s.start;
    this.hearthRays.clear();
    for (const l of this.labels.values()) l.destroy();
    this.labels.clear();
    for (const sp of [...this.sprites.values(), ...this.bodies.values()]) sp.destroy();
    this.sprites.clear();
    this.bodies.clear();
    this.motion.clear();
    this.steps.clear();
    this.children.list.filter((o) => o.getData("roomLabel")).forEach((o) => o.destroy());

    // The static map is painted once, as pixel art (roomart.ts).
    this.mapImg?.destroy();
    if (this.textures.exists("manor")) this.textures.remove("manor");
    this.textures.addCanvas("manor", paintManor(view))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.mapImg = this.add.image(0, 0, "manor").setOrigin(0).setScale(TS / ART).setDepth(0);
    s.mapBuilt = true;

    for (const r of view.rooms) {
      const label = this.add
        .text(r.x0 * TS + 6, r.y0 * TS + 4, r.name.toUpperCase(), { fontFamily: "Pixelify Sans, monospace", fontSize: "13px", color: "#c9b48a", resolution: 2 })
        .setAlpha(0.55)
        .setDepth(1);
      label.setData("roomLabel", true);
    }
  }

  update(time: number, delta: number) {
    const s = this.session;
    if (!s.world || !s.start) return;
    if (this.builtFor !== s.start) this.buildMap();

    // Fixed 20 Hz input steps, matching the server tick. Wall-clock time
    // keeps the pace right even when frames are slow.
    const tickMs = s.start.config.tick * 1000;
    const now = performance.now();
    this.acc += Math.min(now - (this.lastNow || now), 250);
    this.lastNow = now;
    while (this.acc >= tickMs) {
      this.acc -= tickMs;
      const [dx, dy] = this.inputDir();
      this.myInput = s.canMove() ? [dx, dy] : [0, 0];
      s.step(dx, dy, time);
    }

    const me = s.renderPos(time);
    const cam = this.cameras.main;
    cam.centerOn(me.x * TS, me.y * TS);

    const k = Math.min(1, (delta / 1000) * 12);
    for (const r of s.remotes.values()) {
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
    }
    this.drawDynamic(time, me);
    this.drawKills(performance.now(), me);
    this.drawMark(performance.now());
    this.drawLights(time, me);
  }

  private inputDir(): [number, number] {
    if (document.activeElement instanceof HTMLInputElement) return [0, 0];
    const k = this.keys;
    const dx = (k.right.isDown || k.right2.isDown ? 1 : 0) - (k.left.isDown || k.left2.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.down2.isDown ? 1 : 0) - (k.up.isDown || k.up2.isDown ? 1 : 0);
    const s = this.session;
    if (s.loading) {
      this.walk = null;
      return [0, 0];
    }
    if (dx || dy || !s.canMove()) {
      this.walk = null;
      return [dx, dy];
    }
    const me = s.pos;
    if (this.mouseDown && performance.now() - this.mouseDownAt >= HOLD_MS) {
      const t = this.pointerTile(this.input.activePointer);
      const ux = t.x - me.x, uy = t.y - me.y;
      const d = Math.hypot(ux, uy);
      return d < 0.3 ? [0, 0] : [ux / d, uy / d];
    }
    return this.followWalk();
  }

  // The tile position under the pointer, fresh even while the camera moves.
  private pointerTile(p: Phaser.Input.Pointer): Vec {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: w.x / TS, y: w.y / TS };
  }

  private walkTo(to: Vec) {
    const s = this.session;
    if (!s.world || !s.canMove()) return;
    // Ghosts drift through walls, so they go straight there.
    const path = s.snap?.you.ghost ? [to] : s.world.path(s.pos, to);
    if (!path?.length) return;
    this.walk = { path, last: s.pos, still: 0 };
    const end = path[path.length - 1];
    this.mark = { x: end.x, y: end.y, at: performance.now() };
  }

  // One tick along the clicked path. The last step toward each waypoint is
  // shortened so we land on it instead of overshooting.
  private followWalk(): [number, number] {
    const w = this.walk;
    if (!w) return [0, 0];
    const s = this.session;
    const cfg = s.start!.config;
    const step = (s.snap?.you.ghost ? cfg.ghostSpeed : cfg.speed) * cfg.tick;
    const me = s.pos;
    while (w.path.length && dist(me, w.path[0]) < 0.05) w.path.shift();
    // Give up when something (a wall corner, another player) holds us still.
    w.still = dist(me, w.last) < 0.01 ? w.still + cfg.tick : 0;
    w.last = me;
    if (!w.path.length || w.still > 0.5) {
      this.walk = null;
      return [0, 0];
    }
    const wp = w.path[0];
    const d = dist(me, wp);
    const k = Math.min(1, d / step) / d;
    return [(wp.x - me.x) * k, (wp.y - me.y) * k];
  }

  // A ring where a click sent you, drawn above the darkness.
  // A sword cuts the victim down, then blood sprays out in three spurts and
  // pools. Close by (the killer, the victim) it shows through the dark;
  // farther off it stays under the darkness, so it gives away no more than
  // the sound already does.
  private drawKills(now: number, me: Vec) {
    const s = this.session;
    const near = this.goreG.clear();
    s.kills = s.kills.filter((k) => now - k.at < GORE_MS);
    for (const k of s.kills) {
      const close = Math.hypot(k.x - me.x, k.y - me.y) <= 2.5;
      const g = close ? near : this.fxG;
      const t = (now - k.at) / 1000;
      const fade = Math.min(1, (GORE_MS / 1000 - t) / 3);
      const x = k.x * TS, y = k.y * TS - 10; // the chest
      let st = this.gore.get(k);
      if (!st) {
        st = { drops: [], shook: false };
        for (let i = 0; i < 70; i++) {
          const pulse = i % 3;
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8;
          const sp = (130 + Math.random() * 170) * (1 - pulse * 0.25);
          const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
          const ground = 12 + Math.random() * 16;
          const land = (-vy + Math.sqrt(vy * vy + 2 * GRAVITY * ground)) / GRAVITY;
          st.drops.push({ vx, vy, ground, land, delay: 0.18 + pulse * 0.35 + Math.random() * 0.08, size: Math.random() < 0.3 ? 4 : 2 });
        }
        this.gore.set(k, st);
      }
      if (close && !st.shook && t >= 0.18) {
        st.shook = true;
        this.cameras.main.shake(200, 0.008);
      }

      // The pool spreads under the body.
      const pool = Math.min(1, Math.max(0, t - 0.3) / 2.5);
      if (pool > 0) {
        g.fillStyle(0x4a0505, 0.85 * fade).fillEllipse(x, y + 20, 10 + 40 * pool, 4 + 14 * pool);
        g.fillStyle(0x7a0a0a, 0.6 * fade).fillEllipse(x - 3, y + 19, 6 + 22 * pool, 2 + 7 * pool);
      }
      for (const d of st.drops) {
        const tt = t - d.delay;
        if (tt < 0) continue;
        if (tt < d.land) {
          const dx = x + d.vx * tt, dy = y + d.vy * tt + 0.5 * GRAVITY * tt * tt;
          g.fillStyle(0xc0100f).fillRect(Math.round(dx), Math.round(dy), d.size, d.size);
        } else {
          g.fillStyle(0x6e0808, 0.9 * fade).fillEllipse(Math.round(x + d.vx * d.land), Math.round(y + d.ground), d.size * 2, d.size);
        }
      }

      // The blade: one hard swing across the chest, a bright trail behind it.
      if (t < 0.4) {
        const swing = Math.min(1, t / 0.2);
        const ease = 1 - (1 - swing) ** 3;
        const alpha = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.2;
        const px = x - 18, py = y - 26, len = 40;
        const from = -0.6, ang = from + ease * 2.2;
        for (let i = 1; i <= 6; i++) {
          const ta = ang - i * 0.12;
          if (ta < from) break;
          g.lineStyle(4 - i * 0.5, i < 3 ? 0xffffff : 0xff4040, (0.6 - i * 0.09) * alpha);
          g.lineBetween(px + Math.cos(ta) * 14, py + Math.sin(ta) * 14, px + Math.cos(ta) * len, py + Math.sin(ta) * len);
        }
        const tipX = px + Math.cos(ang) * len, tipY = py + Math.sin(ang) * len;
        const baseX = px + Math.cos(ang) * 10, baseY = py + Math.sin(ang) * 10;
        g.lineStyle(4, 0x9aa3b2, alpha).lineBetween(baseX, baseY, tipX, tipY);
        g.lineStyle(1, 0xf2f6ff, alpha).lineBetween(baseX, baseY, tipX, tipY);
        if (t > 0.18) g.lineStyle(2, 0xb00d0d, alpha).lineBetween(baseX + (tipX - baseX) * 0.6, baseY + (tipY - baseY) * 0.6, tipX, tipY); // blood on the edge
        const gx = -Math.sin(ang) * 7, gy = Math.cos(ang) * 7;
        g.lineStyle(3, 0xc99a3a, alpha).lineBetween(baseX - gx, baseY - gy, baseX + gx, baseY + gy); // crossguard
        g.lineStyle(3, 0x3a2414, alpha).lineBetween(px, py, baseX, baseY); // grip
      }
      // The hit: a white flash, then red.
      if (t >= 0.18 && t < 0.34) {
        const h = (t - 0.18) / 0.16;
        g.fillStyle(0xffffff, 0.8 * (1 - h)).fillCircle(x, y, 6 + 10 * h);
        g.fillStyle(0xd01010, 0.7 * (1 - h)).fillCircle(x, y, 3 + 16 * h);
      }
    }
  }

  private drawMark(time: number) {
    const g = this.markG.clear();
    if (!this.mark) return;
    const age = (time - this.mark.at) / 1000;
    const walking = this.walk !== null;
    if (!walking && age > 0.6) {
      this.mark = null;
      return;
    }
    const a = walking ? 0.55 : 0.55 * (1 - age / 0.6);
    const x = this.mark.x * TS, y = this.mark.y * TS;
    const r = 6 + 3 * Math.sin(time * 0.008);
    g.lineStyle(2, 0xffd27a, a).strokeEllipse(x, y + 8, r * 2.4, r);
    g.fillStyle(0xffd27a, a).fillRect(x - 1, y + 7, 2, 2);
  }

  private drawDynamic(time: number, me: Vec) {
    const s = this.session;
    const snap = s.snap;
    const view = s.world!.view;
    const g = this.dynG.clear();
    if (!snap) return;

    // Hearths: pixel flames flicker in the fireplace (painted in roomart.ts);
    // cold ones hold grey ash and show relight progress.
    snap.hearths.forEach((h, i) => {
      const p = view.hearths[i];
      const x = p.x * TS, y = p.y * TS;
      const floor = y + 10;
      if (h.lit) {
        for (let c = -3; c <= 3; c++) {
          const f = 0.75 + 0.35 * Math.sin(time * 0.017 + c * 1.9 + i * 3);
          const tall = Math.max(1, Math.round((4 - Math.abs(c)) * 1.6 * f));
          g.fillStyle(0xd8501a).fillRect(x + c * 2 - 1, floor - tall * 2, 2, tall * 2);
          if (Math.abs(c) <= 1) g.fillStyle(0xffd27a).fillRect(x + c * 2 - 1, floor - Math.round(tall * 0.55) * 2, 2, Math.round(tall * 0.55) * 2);
        }
        g.fillStyle(0x8a2a0a).fillRect(x - 8, floor, 16, 2);
      } else {
        g.fillStyle(0x555049).fillRect(x - 8, floor - 2, 16, 4);
        if (h.p) {
          g.lineStyle(3, 0xffaa55).beginPath();
          g.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * h.p).strokePath();
        }
      }
    });

    for (const d of snap.drips) g.fillStyle(hex(d.c), 0.25 + 0.6 * d.a).fillCircle(d.x * TS, d.y * TS, 2.5);
    for (const sm of snap.smoke) {
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const wob = Math.sin(time * 0.004 + i) * 3;
        g.fillStyle(0xbab3a8, 0.35 * sm.a * (1 - t)).fillCircle((sm.x + sm.dx * t * 1.6) * TS + wob, (sm.y + sm.dy * t * 1.6) * TS - wob, 4 + i * 2);
      }
    }
    for (const sp of snap.spots) {
      const p = view.spots[sp.i];
      if (sp.s) {
        g.lineStyle(1, 0x6d6457, 0.6).strokeRect(p.x * TS - 6, p.y * TS - 6, 12, 12);
      } else {
        const glow = 0.5 + 0.3 * Math.sin(time * 0.005 + sp.i);
        g.fillStyle(0xf0dca0, glow * 0.25).fillCircle(p.x * TS, p.y * TS, 12);
        g.lineStyle(1.5, 0xf0dca0, glow).strokeRect(p.x * TS - 6, p.y * TS - 6, 12, 12);
      }
    }
    for (const l of snap.loose) this.page(g, l.x * TS, l.y * TS);
    const altar = view.altar;
    for (let i = 0; i < snap.altarPages; i++) this.page(g, (altar.x0 + 0.3 + i * 0.45) * TS, (altar.y0 + 0.5) * TS);

    // Bodies lie on their side where they fell.
    const bodiesSeen = new Set<string>();
    for (const b of snap.bodies) {
      bodiesSeen.add(b.id);
      const x = b.x * TS, y = b.y * TS;
      g.fillStyle(0x000000, 0.4).fillEllipse(x, y + 6, 46, 14);
      g.fillStyle(0x5a0f0f, 0.8).fillEllipse(x + 6, y + 8, 18, 6);
      let body = this.bodies.get(b.id);
      if (!body) {
        body = this.add.sprite(x, y, this.character(s.color(b.id)), frameIndex("side", false, 0)).setScale(2).setAngle(-90).setTint(0xb8a898);
        this.bodies.set(b.id, body);
      }
      body.setPosition(x, y).setDepth(4.05).setVisible(true);
    }
    for (const [id, body] of this.bodies) if (!bodiesSeen.has(id)) body.setVisible(false);

    // Characters.
    const fx = this.fxG.clear();
    const seen = new Set<string>();
    const draw = (id: string, x: number, y: number, lit: boolean, ghost: boolean, self: boolean) => {
      seen.add(id);
      const px = x * TS, py = y * TS;
      const { face, moving } = this.motionOf(id, x, y, self, time);
      this.footsteps(id, x, y, ghost, self, me);
      const key = this.character(s.color(id));
      const dir = face === "left" || face === "right" ? "side" : face;
      const anim = `${key}:${dir}:${moving && !ghost ? "walk" : "idle"}`;

      let sprite = this.sprites.get(id);
      if (!sprite) {
        sprite = this.add.sprite(px, py, key).setScale(2).setOrigin(0.5, 1);
        this.sprites.set(id, sprite);
      }
      if (sprite.anims.currentAnim?.key !== anim) sprite.play(anim);
      sprite.setFlipX(face === "left").setVisible(true);
      // Feet sit just below the character's position; deeper rows draw on top.
      let footY = py + 10;
      if (ghost) {
        footY += -6 + Math.sin(time * 0.004 + px * 0.01) * 3;
        sprite.setTint(0xcfe6ff).setAlpha(0.5);
      } else {
        sprite.clearTint().setAlpha(1);
        g.fillStyle(0x000000, 0.35).fillEllipse(px, py + 9, 22, 8);
        if (self) g.lineStyle(1, 0xffffff, 0.35).strokeEllipse(px, py + 9, 28, 11);
      }
      // You always see yourself; everyone else lives under the darkness.
      sprite.setPosition(px, footY).setDepth(self ? 10.5 : 4.1 + py / 1e6);

      // Everyone alive holds a candle; only a lit one has a flame.
      if (!ghost) {
        const [cx, cy] = CANDLE_AT[face];
        // hy is the top of the wax; the base stays at hand height.
        const hx = Math.round(px + cx), hy = Math.round(footY + cy - 16);
        fx.fillStyle(0xb8862e).fillRect(hx - 6, hy + 14, 12, 3); // brass dish
        fx.fillStyle(0xf3d27a).fillRect(hx - 6, hy + 14, 12, 1);
        fx.fillStyle(0xf4ecd8).fillRect(hx - 3, hy, 6, 14); // wax
        fx.fillStyle(0xffffff).fillRect(hx - 2, hy + 1, 1, 12); // its shine
        fx.fillStyle(0xcfc2a4).fillRect(hx + 2, hy, 1, 14);
        fx.fillStyle(0xf4ecd8).fillRect(hx + 3, hy + 2, 1, 4); // a drip
        if (lit) {
          const f = Math.sin(time * 0.02 + px) > 0.2 ? 2 : 0;
          fx.fillStyle(0xffb35c, 0.18).fillCircle(hx, hy - 6, 16 + f); // halo
          fx.fillStyle(0xffd27a, 0.3).fillCircle(hx, hy - 6, 9 + f);
          fx.fillStyle(0xff7a1a).fillRect(hx - 3, hy - 11 - f, 6, 11 + f);
          fx.fillStyle(0xffd27a).fillRect(hx - 2, hy - 8 - f, 4, 7 + f);
          fx.fillStyle(0xfff6d8).fillRect(hx - 1, hy - 5, 2, 4);
        } else fx.fillStyle(0x2a2420).fillRect(hx - 1, hy - 3, 2, 3); // the burnt wick
      }

      let label = this.labels.get(id);
      if (!label) {
        label = this.add
          .text(0, 0, s.name(id), { fontFamily: "Pixelify Sans, monospace", fontSize: "12px", color: "#f2e6c8", stroke: "#000", strokeThickness: 3, resolution: 2 })
          .setOrigin(0.5, 1)
          .setDepth(11);
        this.labels.set(id, label);
      }
      label.setPosition(px, footY - 40).setAlpha(ghost ? 0.6 : 1).setVisible(true);
      if (s.snap?.allies?.includes(id) && s.isHost) label.setColor("#ff7a7a");
    };
    for (const [id, r] of s.remotes) draw(id, r.x, r.y, !!r.view.lit, !!r.view.ghost, false);
    if (snap.you.alive || snap.you.ghost) draw(s.me, me.x, me.y, snap.you.lit, snap.you.ghost, true);
    for (const [id, l] of this.labels) if (!seen.has(id)) l.setVisible(false);
    for (const [id, sp] of this.sprites) if (!seen.has(id)) sp.setVisible(false);

    // Snuff progress ring for the Host.
    if (snap.you.snuffP) {
      g.lineStyle(3, 0xff4d4d).beginPath();
      g.arc(me.x * TS, me.y * TS, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * snap.you.snuffP).strokePath();
    }
  }

  // character makes (once per colour) the pixel-art texture and its animations.
  private character(color: string): string {
    const key = `char:${color}`;
    if (this.textures.exists(key)) return key;
    const tex = this.textures.addCanvas(key, sheet(color))!;
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (let i = 0; i < FRAMES_PER_DIR * DIRS.length; i++) tex.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
    for (const dir of DIRS) {
      const frames = (walk: boolean, n: number) => Array.from({ length: n }, (_, f) => ({ key, frame: frameIndex(dir, walk, f) }));
      this.anims.create({ key: `${key}:${dir}:idle`, frames: frames(false, IDLE_FRAMES), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `${key}:${dir}:walk`, frames: frames(true, WALK_FRAMES), frameRate: 9, repeat: -1 });
    }
    return key;
  }

  // motionOf works out which way a character faces and whether it is walking.
  // Our own character follows the keys; others follow their movement.
  private motionOf(id: string, x: number, y: number, self: boolean, now: number) {
    let m = this.motion.get(id);
    if (!m) {
      m = { x, y, face: "down", movingUntil: 0 };
      this.motion.set(id, m);
    }
    let dx = x - m.x, dy = y - m.y;
    if (self) [dx, dy] = this.myInput;
    if (Math.hypot(dx, dy) > 0.004) {
      m.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      m.movingUntil = now + 150;
    }
    m.x = x;
    m.y = y;
    return { face: m.face, moving: now < m.movingUntil };
  }

  // Plays a footstep each stride a character walks, panned and fading with
  // distance from you. Only characters you can see make them (the server
  // sends no one else), and ghosts float without a sound.
  private footsteps(id: string, x: number, y: number, ghost: boolean, self: boolean, me: Vec) {
    let st = this.steps.get(id);
    if (!st) {
      this.steps.set(id, { x, y, walked: 0, left: false });
      return;
    }
    const d = Math.hypot(x - st.x, y - st.y);
    st.x = x;
    st.y = y;
    // A long jump (a servant passage, someone coming back into view) is not
    // walking; a slow frame can still cover a tile or two.
    if (ghost || d > 4) {
      st.walked = 0;
      return;
    }
    if ((st.walked += d) < STRIDE) return;
    st.walked %= STRIDE;
    st.left = !st.left;
    const dx = x - me.x;
    const volume = self ? 0.5 : 0.5 * (1 - Math.hypot(dx, y - me.y) / HEAR_STEPS);
    if (volume <= 0) return;
    const world = this.session.world!;
    const room = world.roomAt(x, y);
    const surface = room >= 0 && STONE_FLOORS.has(world.view.rooms[room].id) ? "stone" : "wood";
    sfx.footstep(self ? 0 : Math.max(-1, Math.min(1, dx / 8)), volume, surface, st.left);
  }

  private page(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0xf2e6c6).fillRect(x - 6, y - 8, 12, 15);
    g.lineStyle(1, 0x8a7a55).lineBetween(x - 3, y - 4, x + 3, y - 4).lineBetween(x - 3, y, x + 3, y).lineBetween(x - 3, y + 4, x + 2, y + 4);
  }

  private drawLights(time: number, me: Vec) {
    const s = this.session;
    const snap = s.snap;
    const world = s.world!;
    const cam = this.cameras.main;
    this.glowG.clear();
    this.dark.clear();
    if (!snap) {
      this.dark.fill(0x000000, 1);
      return;
    }
    const ghost = snap.you.ghost;
    this.dark.fill(0x050307, ghost ? 0.55 : 0.94);

    const lights: Light[] = [];
    // Candles are held at hand height, so light them from there (unless that
    // point is inside a wall) and faces next to walls stay lit.
    const candleY = (x: number, y: number) => (world.opaqueAt(Math.floor(x), Math.floor(y - 0.35)) ? y : y - 0.35);
    const flick = (seed: number) => 1 + 0.035 * Math.sin(time * 0.011 + seed) + 0.02 * Math.sin(time * 0.037 + seed * 3);
    if (!ghost && snap.you.alive) {
      const r = snap.you.r * (snap.you.lit ? flick(1) : 1);
      const ly = candleY(me.x, me.y);
      lights.push({ x: me.x, y: ly, r, rays: world.rayDistances(me.x, ly, r, RAYS), warm: snap.you.lit });
    }
    for (const [id, rm] of s.remotes) {
      if (!rm.view.lit) continue;
      const r = rm.view.r * flick(id.charCodeAt(0));
      const ly = candleY(rm.x, rm.y);
      lights.push({ x: rm.x, y: ly, r, rays: world.rayDistances(rm.x, ly, r, RAYS), warm: true });
    }
    const hr = s.start!.config.hearthRadius;
    const view = cam.worldView;
    snap.hearths.forEach((h, i) => {
      if (!h.lit) return;
      const p = world.view.hearths[i];
      if (p.x * TS < view.x - hr * TS || p.x * TS > view.right + hr * TS || p.y * TS < view.y - hr * TS || p.y * TS > view.bottom + hr * TS) return;
      let rays = this.hearthRays.get(i);
      if (!rays) {
        rays = world.rayDistances(p.x, p.y, hr, RAYS);
        this.hearthRays.set(i, rays);
      }
      const f = flick(i * 7);
      lights.push({ x: p.x, y: p.y, r: hr * f, rays: rays.map((d) => Math.min(d * f, hr * f)), warm: true });
    });

    // The darkness layer is fixed to the screen and the camera zooms it
    // about the screen centre, so its pixel (x, y) shows world point
    // (scrollX + x, scrollY + y) at any zoom.
    const ox = cam.scrollX;
    const oy = cam.scrollY;
    // Three soft rings per light. Every light's ring goes into one erase
    // pass, so the cost per frame stays at three passes however many
    // candles are in view.
    const rings: [number, number][] = [[1, 0.4], [0.8, 0.45], [0.55, 1]];
    for (const [k, alpha] of rings) {
      this.eraser.clear().fillStyle(0xffffff, alpha);
      for (const l of lights) {
        const pts: Phaser.Math.Vector2[] = [];
        for (let i = 0; i < RAYS; i++) {
          const a = (i / RAYS) * Math.PI * 2;
          const d = Math.min(l.rays[i], l.r * k);
          pts.push(new Phaser.Math.Vector2((l.x + Math.cos(a) * d) * TS - ox, (l.y + Math.sin(a) * d) * TS - oy));
        }
        this.eraser.fillPoints(pts, true);
      }
      this.dark.erase(this.eraser);
    }
    for (const l of lights) {
      if (!l.warm) continue;
      this.glowG.fillStyle(0xff9a3c, 0.05).fillCircle(l.x * TS, l.y * TS, l.r * TS * 0.9);
      this.glowG.fillStyle(0xffb35c, 0.06).fillCircle(l.x * TS, l.y * TS, l.r * TS * 0.45);
    }
  }
}
