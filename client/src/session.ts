import { Net } from "./net";
import type {
  ChatMsg,
  EndMsg,
  EventMsg,
  LobbyMsg,
  PlayerView,
  RosterEntry,
  Snapshot,
  StartMsg,
  Vec,
} from "./protocol";
import { inputStep, World } from "./world";

export interface Remote {
  x: number;
  y: number;
  tx: number;
  ty: number;
  view: PlayerView;
}

type Listener = () => void;

// Session holds everything the client knows about the current room and
// match, and owns movement prediction.
export class Session {
  net: Net;
  me = "";
  code = "";
  lobby?: LobbyMsg;
  start?: StartMsg;
  world?: World;
  roster = new Map<string, RosterEntry>();
  snap?: Snapshot;
  end?: EndMsg;
  remotes = new Map<string, Remote>();

  // Predicted position of our own character, and where it was one step ago.
  pos: Vec = { x: 0, y: 0 };
  prev: Vec = { x: 0, y: 0 };
  lastStep = 0;
  private seq = 0;
  private pending: { seq: number; dx: number; dy: number }[] = [];

  private listeners = new Map<string, Listener[]>();
  onEvent: (e: EventMsg) => void = () => {};
  onChat: (c: ChatMsg) => void = () => {};
  onError: (text: string) => void = () => {};

  constructor(room: string, name: string) {
    const token = sessionStorage.getItem(`lastcandle:${room.toUpperCase()}`) ?? "";
    this.net = new Net(room, name, token);
    this.net.on("welcome", (m) => {
      this.me = m.id;
      this.code = m.code;
      sessionStorage.setItem(`lastcandle:${m.code}`, m.token);
      history.replaceState(null, "", `#${m.code}`);
    });
    this.net.on("lobby", (m) => {
      this.lobby = m;
      if (m.state === "lobby") {
        this.start = undefined;
        this.snap = undefined;
        this.end = undefined;
      }
      this.emit("lobby");
    });
    this.net.on("start", (m) => {
      this.start = m;
      this.world = new World(m.map);
      this.roster = new Map(m.roster.map((r) => [r.id, r]));
      this.snap = undefined;
      this.end = undefined;
      this.remotes.clear();
      this.pending = [];
      this.emit("start");
    });
    this.net.on("snap", (m) => this.onSnap(m));
    this.net.on("end", (m) => {
      this.end = m;
      this.emit("end");
    });
    this.net.on("event", (m) => this.onEvent(m));
    this.net.on("chat", (m) => this.onChat(m));
    this.net.on("error", (m) => this.onError(m.text));
  }

  on(name: "lobby" | "start" | "snap" | "end", fn: Listener) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  private emit(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }

  get isOwner() {
    return this.lobby?.owner === this.me;
  }

  get isHost() {
    return this.start?.role === "host";
  }

  name(id: string) {
    return this.roster.get(id)?.name ?? this.lobby?.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  color(id: string) {
    return this.roster.get(id)?.color ?? "#888";
  }

  canMove() {
    const s = this.snap;
    return !!s && s.phase === "play" && (s.you.alive || s.you.ghost);
  }

  // step advances our own character by one server tick and tells the server.
  step(dx: number, dy: number, now: number) {
    this.prev = this.pos;
    this.lastStep = now;
    if (!this.world || !this.start || !this.snap || !this.canMove() || (dx === 0 && dy === 0)) return;
    const seq = ++this.seq;
    this.net.send({ t: "cmd", seq, dx, dy });
    this.pending.push({ seq, dx, dy });
    this.pos = this.applyCmd(this.pos, dx, dy);
  }

  private applyCmd(p: Vec, dx: number, dy: number) {
    const cfg = this.start!.config;
    const ghost = this.snap!.you.ghost;
    const [mx, my] = inputStep(dx, dy, ghost ? cfg.ghostSpeed : cfg.speed, cfg.tick);
    return this.world!.move(p, mx, my, ghost);
  }

  private onSnap(s: Snapshot) {
    const first = !this.snap;
    this.snap = s;
    // Reconcile: start from the server's position and replay inputs it has
    // not processed yet.
    this.pending = this.pending.filter((c) => c.seq > s.ack);
    let p: Vec = { x: s.you.x, y: s.you.y };
    if (s.phase === "play") for (const c of this.pending) p = this.applyCmd(p, c.dx, c.dy);
    else this.pending = [];
    if (first || Math.hypot(p.x - this.pos.x, p.y - this.pos.y) > 2) this.prev = p;
    this.pos = p;

    const seen = new Set<string>();
    for (const v of s.players) {
      seen.add(v.id);
      const r = this.remotes.get(v.id);
      if (!r || Math.hypot(r.tx - v.x, r.ty - v.y) > 3) this.remotes.set(v.id, { x: v.x, y: v.y, tx: v.x, ty: v.y, view: v });
      else Object.assign(r, { tx: v.x, ty: v.y, view: v });
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);
    this.emit("snap");
  }

  // renderPos smooths our 20 Hz steps over each 60 Hz frame.
  renderPos(now: number): Vec {
    const t = Math.min(1, (now - this.lastStep) / (this.start!.config.tick * 1000));
    return { x: this.prev.x + (this.pos.x - this.prev.x) * t, y: this.prev.y + (this.pos.y - this.prev.y) * t };
  }
}
