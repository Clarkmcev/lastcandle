import Phaser from "phaser";
import type { Session } from "./session";
import type { Vec } from "./protocol";
import { DIRS, FRAMES_PER_DIR, FRAME_H, FRAME_W, IDLE_FRAMES, WALK_FRAMES, frameIndex, sheet } from "./sprites";

export const TS = 32; // pixels per tile

// Each room keeps a signature tint under the sepia (see the design doc).
const ROOM_FLOOR: Record<string, number> = {
  library: 0x2c3a28,
  chapel: 0x252e3d,
  nursery: 0x3d2a32,
  study: 0x3a2e22,
  dining: 0x3f2c20,
  ballroom: 0x463b20,
  conservatory: 0x2a3a33,
  entrance: 0x382f27,
  kitchen: 0x3a3026,
  cellar: 0x1d1b19,
};

const RAYS = 120;
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

type Facing = "down" | "up" | "left" | "right";

// Where the candle sits relative to a character's feet, in screen pixels,
// for each way they can face.
const CANDLE_AT: Record<Facing, [number, number]> = { down: [8, -2], up: [-8, -2], right: [5, -2], left: [-5, -2] };

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
  private mapG!: Phaser.GameObjects.Graphics;
  private mapImg?: Phaser.GameObjects.Image;
  private dynG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private bodies = new Map<string, Phaser.GameObjects.Sprite>();
  private motion = new Map<string, Motion>();
  private myInput: [number, number] = [0, 0];
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
    // The static map is drawn once and baked into a texture.
    this.mapG = this.make.graphics({}, false);
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
    this.cameras.main.setBackgroundColor("#030204");
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
    this.children.list.filter((o) => o.getData("roomLabel")).forEach((o) => o.destroy());

    const g = this.mapG.clear();
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const t = world.tile(x, y);
        const px = x * TS, py = y * TS;
        if (t === "#") {
          const nearFloor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => world.tile(x + dx, y + dy) !== "#");
          g.fillStyle(nearFloor ? 0x2a1d14 : 0x0b0806).fillRect(px, py, TS, TS);
          if (nearFloor) g.fillStyle(0x3d2b1d).fillRect(px, py + TS - 6, TS, 6);
          continue;
        }
        const room = world.roomAt(x + 0.5, y + 0.5);
        const base = room >= 0 ? ROOM_FLOOR[view.rooms[room].id] ?? 0x3a2e24 : 0x2b2119;
        const c = Phaser.Display.Color.IntegerToColor(base);
        if ((x + y) % 2) c.lighten(4);
        g.fillStyle(c.color).fillRect(px, py, TS, TS);
        g.lineStyle(1, 0x000000, 0.15).strokeRect(px, py, TS, TS);
      }
    }
    // Furniture.
    const rect = (r: { x0: number; y0: number; x1: number; y1: number }, fill: number, line: number) => {
      g.fillStyle(fill).fillRoundedRect(r.x0 * TS + 2, r.y0 * TS + 2, (r.x1 - r.x0 + 1) * TS - 4, (r.y1 - r.y0 + 1) * TS - 4, 6);
      g.lineStyle(2, line).strokeRoundedRect(r.x0 * TS + 2, r.y0 * TS + 2, (r.x1 - r.x0 + 1) * TS - 4, (r.y1 - r.y0 + 1) * TS - 4, 6);
    };
    rect(view.table, 0x4a2c18, 0x7a4e2a);
    for (let i = 0; i < 6; i++) g.fillStyle(0xd8c9a0).fillCircle((view.table.x0 + 0.5 + i) * TS, (view.table.y0 + 2) * TS, 3);
    rect(view.altar, 0x8d8576, 0xc9c0ad);
    for (const m of view.mirrors) {
      g.fillStyle(0x6e5a2e).fillRect(m.x * TS - 13, m.y * TS - 13, 26, 26);
      g.fillStyle(0x9fb4c4).fillRect(m.x * TS - 9, m.y * TS - 9, 18, 18);
      g.fillStyle(0xe6f0f5, 0.5).fillTriangle(m.x * TS - 9, m.y * TS - 9, m.x * TS + 2, m.y * TS - 9, m.x * TS - 9, m.y * TS + 2);
    }
    for (const pair of view.passages ?? []) {
      for (const p of pair) {
        g.lineStyle(2, 0x9b5de5, 0.9).strokeRect(p.x * TS - 14, p.y * TS - 14, 28, 28);
        g.fillStyle(0x9b5de5, 0.2).fillRect(p.x * TS - 14, p.y * TS - 14, 28, 28);
      }
    }
    this.mapImg?.destroy();
    if (this.textures.exists("manor")) this.textures.remove("manor");
    g.generateTexture("manor", world.w * TS, world.h * TS);
    g.clear();
    this.mapImg = this.add.image(0, 0, "manor").setOrigin(0).setDepth(0);

    for (const r of view.rooms) {
      const label = this.add
        .text(r.x0 * TS + 6, r.y0 * TS + 4, r.name.toUpperCase(), { fontFamily: "IM Fell English, Georgia, serif", fontSize: "13px", color: "#c9b48a" })
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
    this.drawLights(time, me);
  }

  private inputDir(): [number, number] {
    if (document.activeElement instanceof HTMLInputElement) return [0, 0];
    const k = this.keys;
    const dx = (k.right.isDown || k.right2.isDown ? 1 : 0) - (k.left.isDown || k.left2.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.down2.isDown ? 1 : 0) - (k.up.isDown || k.up2.isDown ? 1 : 0);
    return [dx, dy];
  }

  private drawDynamic(time: number, me: Vec) {
    const s = this.session;
    const snap = s.snap;
    const view = s.world!.view;
    const g = this.dynG.clear();
    if (!snap) return;

    // Hearths: lit ones flicker; cold ones show relight progress.
    snap.hearths.forEach((h, i) => {
      const p = view.hearths[i];
      const x = p.x * TS, y = p.y * TS;
      g.fillStyle(0x3b2a20).fillRect(x - 15, y - 15, 30, 30);
      g.fillStyle(0x140c08).fillRect(x - 10, y - 8, 20, 18);
      if (h.lit) {
        const f = 1 + 0.15 * Math.sin(time * 0.013 + i);
        g.fillStyle(0xff8a2a).fillTriangle(x - 8, y + 8, x + 8, y + 8, x, y - 10 * f);
        g.fillStyle(0xffd27a).fillTriangle(x - 4, y + 8, x + 4, y + 8, x, y - 3 * f);
      } else {
        g.fillStyle(0x555049).fillRect(x - 7, y + 4, 14, 4);
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

      if (lit) {
        const [cx, cy] = CANDLE_AT[face];
        const hx = Math.round(px + cx), hy = Math.round(footY + cy - 10);
        const f = Math.sin(time * 0.02 + px) > 0.2 ? 2 : 0;
        fx.fillStyle(0xe8dcc0).fillRect(hx - 2, hy, 4, 8);
        fx.fillStyle(0xff7a1a).fillRect(hx - 2, hy - 6 - f, 4, 6 + f);
        fx.fillStyle(0xffd27a).fillRect(hx - 1, hy - 4, 2, 4);
      }

      let label = this.labels.get(id);
      if (!label) {
        label = this.add
          .text(0, 0, s.name(id), { fontFamily: "IM Fell English, Georgia, serif", fontSize: "13px", color: "#efe3c8", stroke: "#000", strokeThickness: 3 })
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
          pts.push(new Phaser.Math.Vector2((l.x + Math.cos(a) * d) * TS - view.x, (l.y + Math.sin(a) * d) * TS - view.y));
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
