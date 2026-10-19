// Messages exchanged with the Go server. These mirror
// server/internal/game/views.go and server/internal/server/room.go.

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Room extends Rect {
  id: string;
  name: string;
}

export interface MapView {
  w: number;
  h: number;
  rows: string[];
  rooms: Room[];
  hearths: Vec[];
  mirrors: Vec[];
  spots: Vec[];
  passages?: [Vec, Vec][];
  altar: Rect;
  table: Rect;
}

export type Team = "guests" | "manor";
export type Role = "guest" | "host";

export interface RosterEntry {
  id: string;
  name: string;
  color: string;
}

export interface ClientConfig {
  tick: number;
  speed: number;
  ghostSpeed: number;
  hearthRadius: number;
  snuffTime: number;
  searchTime: number;
  readTime: number;
  relight: number;
  startWax: number;
}

export interface StartMsg {
  t: "start";
  map: MapView;
  role: Role;
  team: Team;
  roster: RosterEntry[];
  words: string[];
  config: ClientConfig;
}

export interface PlayerView {
  id: string;
  x: number;
  y: number;
  lit?: boolean;
  r: number;
  ghost?: boolean;
}

export interface YouView {
  x: number;
  y: number;
  alive: boolean;
  ghost: boolean;
  lit: boolean;
  wax: number;
  r: number;
  pages: number;
  team: Team;
  snuffCD: number;
  killCD: number;
  sabCD: number;
  ecto: number;
  seance: boolean;
  shaken?: boolean;
  hold?: "refill" | "hearth" | "search" | "read";
  holdP?: number;
  snuffP?: number;
  room: string;
  mirror: number;
}

export interface MeetingView {
  reason: "dinner" | "body" | "seance";
  caller?: string;
  body?: string;
  stage: "gather" | "discuss" | "vote" | "result";
  t: number;
  voted: string[];
  you?: string;
  tally?: Record<string, number>;
  locked?: string;
  text?: string;
}

export interface Snapshot {
  t: "snap";
  ack: number;
  phase: "play" | "meeting" | "ended";
  hour: number;
  minute: number;
  grace: boolean;
  you: YouView;
  players: PlayerView[];
  bodies: { id: string; x: number; y: number }[];
  smoke: { x: number; y: number; dx: number; dy: number; a: number }[];
  drips: { x: number; y: number; c: string; a: number }[];
  hearths: { lit: boolean; p?: number }[];
  spots: { i: number; s?: boolean }[];
  loose: Vec[];
  altarPages: number;
  read: number;
  mirror?: { i: number; room: number; refl: PlayerView[]; word?: string };
  meeting?: MeetingView;
  allies?: string[];
}

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  bot?: boolean;
  online: boolean;
}

export interface LobbyMsg {
  t: "lobby";
  code: string;
  owner: string;
  state: "lobby" | "playing" | "ended";
  players: LobbyPlayer[];
  min: number;
  max: number;
}

export interface EndMsg {
  t: "end";
  winner: Team;
  reason: string;
  roles: { id: string; name: string; color: string; role: Role; restless?: boolean; alive: boolean }[];
}

export interface EventMsg {
  t: "event";
  kind: "toast" | "knock" | "draft" | "snuffed" | "killed" | "locked" | "restless";
  text?: string;
  x?: number;
  y?: number;
}

export interface ChatMsg {
  t: "chat";
  from: string;
  name: string;
  color: string;
  text: string;
  ghost?: boolean;
}

export interface WelcomeMsg {
  t: "welcome";
  id: string;
  token: string;
  code: string;
}

export interface ErrorMsg {
  t: "error";
  text: string;
}

export type ServerMsg = WelcomeMsg | LobbyMsg | StartMsg | Snapshot | EndMsg | EventMsg | ChatMsg | ErrorMsg;
