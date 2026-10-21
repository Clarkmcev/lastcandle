<<<<<<< Updated upstream
import type { ChatMsg, EventMsg, Snapshot } from "./protocol";
=======
import type { ChatMsg, EventMsg, MeetingView, Snapshot } from "./protocol";
import { Landing } from "./landing";
import { LoadingArt } from "./loading";
import { type IconKind, ResultArt, RevealArt, goalIcon } from "./reveal";
import { playSong, setMusic, songName } from "./music";
>>>>>>> Stashed changes
import type { Session } from "./session";
import * as sfx from "./sfx";
import { walkStrip } from "./sprites";
import { dist, distToRect } from "./world";

// avatar is a character's walk cycle as an animated HTML element.
const avatar = (color: string, still = false, small = false) =>
  `<span class="avatar ${still ? "still" : ""} ${small ? "small" : ""}" style="background-image:url(${walkStrip(color, 2)})"></span>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function show(id: string, on: boolean) {
  $(id).classList.toggle("hidden", !on);
}

// UI drives every HTML screen on top of the Phaser canvas.
export class UI {
  private session?: Session;
  private meetingKey = "";
  private lastMeeting = "";
  private lastPhase = "";
  private held = new Set<string>();

<<<<<<< Updated upstream
  constructor(private connect: (room: string, name: string) => Session) {
=======
  private landing = new Landing($<HTMLCanvasElement>("landing"));
  private loadingArt = new LoadingArt($<HTMLCanvasElement>("loadingCanvas"));
  private loadingTimer = 0;
  private revealArt?: RevealArt;
  private resultArt?: ResultArt;
  private resultShown = "";
  private where: "home" | "lobby" | "game" = "home";
  private musicOn = localStorage.getItem("lastcandle:music") !== "off";
  private soundAllowed = false; // browsers allow sound after the first click or key

  // The character to ask for when joining: the last one picked in a lobby.
  private character = (() => {
    const saved = localStorage.getItem("lastcandle:color");
    return CHARACTERS.some((c) => c.color === saved) ? saved! : CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].color;
  })();

  constructor(private connect: (room: string, name: string, color: string) => Session) {
    this.landing.setActive(true);
    this.updateMusic();
    const allowSound = () => {
      this.soundAllowed = true;
      this.updateMusic();
    };
    document.addEventListener("pointerdown", allowSound, { once: true });
    document.addEventListener("keydown", allowSound, { once: true });
    $("leaveLobby").onclick = () => this.leave();
    $("leaveGame").onclick = () => this.leave();
    $("stopGame").onclick = () => this.stopGame();
    $("menuSettings").onclick = () => this.openSettings();
    $("gameSettings").onclick = () => this.openSettings();
    $("settingsClose").onclick = () => this.closeSettings();
    // Clicking the dark backdrop closes it. (No value is returned: an onclick
    // that returns false would cancel clicks inside, such as on a checkbox.)
    $("settings").onclick = (e) => {
      if (e.target === $("settings")) this.closeSettings();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (this.settingsOpen()) this.closeSettings();
      else if (e.target instanceof HTMLInputElement) return;
      else if (this.where === "game" && $("words").classList.contains("hidden")) this.openSettings();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "m" && !e.repeat && !(e.target instanceof HTMLInputElement)) this.toggleMusic();
    });
>>>>>>> Stashed changes
    const name = $<HTMLInputElement>("name");
    name.value = localStorage.getItem("lastcandle:name") ?? "";
    const code = location.hash.slice(1).toUpperCase();
    if (code) $<HTMLInputElement>("code").value = code;

    const go = (room: string) => {
      const n = name.value.trim();
      if (!n) {
        this.homeError("Write your name on the guest list first.");
        name.focus();
        return;
      }
      localStorage.setItem("lastcandle:name", n);
      sfx.startRain();
      this.bind(this.connect(room, n));
    };
    $("create").onclick = () => go("");
    $("join").onclick = () => {
      const c = $<HTMLInputElement>("code").value.trim().toUpperCase();
      if (c.length !== 4) return this.homeError("Room codes have four letters.");
      go(c);
    };
    $<HTMLInputElement>("code").onkeydown = (e) => e.key === "Enter" && $("join").click();

    document.addEventListener("keydown", (e) => this.onKey(e, true));
    document.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => this.releaseAll());
  }

  private homeError(text: string) {
    $("homeError").textContent = text;
  }

  private bind(s: Session) {
    this.session = s;
    s.onError = (text) => {
      this.homeError(text);
      this.screen("home");
    };
    s.net.onClose = (reason) => {
      if (reason) this.homeError(reason);
      else this.homeError("Lost the connection to the manor. Rejoin with the same code to continue.");
      this.screen("home");
    };
    s.on("lobby", () => this.renderLobby());
    s.on("start", () => this.onStart());
    s.on("snap", () => this.onSnap());
    s.on("end", () => this.renderEnd());
    s.onEvent = (e) => this.onEvent(e);
    s.onChat = (c) => this.onChat(c);
  }

  private screen(name: "home" | "lobby" | "game") {
    show("home", name === "home");
    show("lobby", name === "lobby");
    show("hud", name === "game");
    if (name !== "game") {
      show("meeting", false);
      show("end", false);
      show("words", false);
    }
  }

  // ------------------------------------------------------------- lobby

  private renderLobby() {
    const s = this.session!;
    const l = s.lobby!;
    if (l.state !== "lobby") return;
    this.screen("lobby");
    $("lobbyCode").textContent = l.code;
    const link = `${location.origin}${location.pathname}#${l.code}`;
    $("lobbyLink").textContent = link;
    $("lobbyLink").onclick = () => navigator.clipboard?.writeText(link);
    $("lobbyPlayers").innerHTML = l.players
      .map(
        (p) => `<li>
          ${avatar(p.color)}
          <span class="pname">${esc(p.name)}</span>
          ${p.id === l.owner ? '<span class="tag">host of the lobby</span>' : ""}
          ${p.bot ? '<span class="tag">bot</span>' : ""}
          ${p.id === s.me ? '<span class="tag">you</span>' : ""}
          ${p.bot && s.isOwner ? `<button class="x" data-bot="${p.id}" title="Remove bot">✕</button>` : ""}
        </li>`,
      )
      .join("");
    $("lobbyPlayers").querySelectorAll<HTMLButtonElement>("[data-bot]").forEach((b) => {
      b.onclick = () => s.net.send({ t: "removeBot", target: b.dataset.bot });
    });
    show("ownerControls", s.isOwner);
    show("guestWait", !s.isOwner);
    $("addBot").onclick = () => s.net.send({ t: "addBot" });
    $<HTMLButtonElement>("addBot").disabled = l.players.length >= l.max;
    $("start").onclick = () => s.net.send({ t: "start" });
    $<HTMLButtonElement>("start").disabled = l.players.length < l.min;
    $("lobbyNote").textContent =
      l.players.length < l.min
        ? `At least ${l.min} guests are needed. Add bots to test alone.`
        : l.players.length < 5
          ? "Playable now; the manor is best with 5 to 10 guests."
          : `${l.players.length} guests are waiting in the hall.`;
  }

  // -------------------------------------------------------------- match

  private onStart() {
    const s = this.session!;
    this.screen("game");
    this.lastMeeting = "";
    this.lastPhase = "";
    $("chatLog").innerHTML = "";
    $("ghostLog").innerHTML = "";
<<<<<<< Updated upstream
=======
    this.showLoading(() => this.reveal());
  }

  // The role card shown once the night has loaded: your character in
  // pixel art, framed for the part you play (reveal.ts), with your goals.
  private reveal() {
    const s = this.session!;
>>>>>>> Stashed changes
    const host = s.isHost;
    const me = s.roster.get(s.me);
    const color = me?.color ?? CHARACTERS[0].color;
    const who = CHARACTERS.find((c) => c.color === color);
    const goals: [IconKind, string][] = host
      ? [
          ["snuff", "Hold <b>Q</b> beside a guest to blow out their candle"],
          ["dagger", "<b>Space</b> kills a guest left alone in the dark"],
          ["cold", "<b>1</b> a cold draft · <b>2</b> put a hearth out"],
          ["door", "<b>E</b> on a purple panel: a servant passage"],
        ]
      : [
          ["candle", "Keep your candle fed at the hearths"],
          ["page", "Find the four pages of the will and read it at the altar"],
          ["key", "Vote the Host into the cellar"],
          ["dawn", "Or simply survive until dawn"],
        ];
    $("reveal").innerHTML = `<div class="revealWrap"><div class="revealCard ${host ? "host" : "guest"}">
        <canvas class="revealArt"></canvas>
        <div class="revealText">
          <div class="small">${esc(who?.name ?? "")} · ${esc(me?.name ?? "")}</div>
          <h1 class="${host ? "red" : ""}">${host ? "You are the Host" : "You are a Guest"}</h1>
          <p class="revealLine">${
            host
              ? "You made a pact with the manor. Tonight, its hunger is yours. Let no one see you do it."
              : "A dinner party, a storm, and one guest at the table who is not what they seem."
          }</p>
          <ul class="goals">${goals.map(([k, t]) => `<li><img src="${goalIcon(k)}" alt=""><span>${t}</span></li>`).join("")}</ul>
          <p class="small">${host ? "<b>WASD</b> or the mouse to move · <b>R</b> report · <b>Esc</b> settings" : "<b>WASD</b> or the mouse to move · <b>E</b> interact (hold) · <b>R</b> report a body · <b>G</b> séance"}</p>
        </div>
      </div>
      <p class="revealGo">Click or press a key to begin</p></div>`;
    this.revealArt?.stop();
    this.revealArt = new RevealArt($("reveal").querySelector("canvas")!);
    this.revealArt.show(color, host);
    show("reveal", true);
    const close = () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", close);
      this.revealArt?.stop();
      show("reveal", false);
    };
    const timer = setTimeout(close, 12000);
    $("reveal").onclick = close;
    setTimeout(() => document.addEventListener("keydown", close, { once: true }), 400);
    $("roleCard").innerHTML = host ? '<span class="red">Host</span>' : "Guest";
    if (host) sfx.sting();
    else sfx.bell();
  }

  private onSnap() {
    const s = this.session!;
    const snap = s.snap!;
    if (snap.phase !== this.lastPhase) {
      if (snap.phase === "meeting") sfx.bell();
      this.lastPhase = snap.phase;
    }
    const h12 = snap.hour % 12 === 0 ? 12 : snap.hour % 12;
    const ampm = snap.hour >= 12 && snap.hour < 24 && snap.hour !== 0 ? "PM" : "AM";
    $("clock").textContent = `${h12}:${String(snap.minute).padStart(2, "0")} ${ampm}`;
    $("clock").classList.toggle("witching", snap.hour === 3);

    const you = snap.you;
    if (you.team === "manor" && !s.isHost) $("roleCard").innerHTML = '<span class="red">Restless Spirit</span>';
    else if (you.ghost) $("roleCard").innerHTML = s.isHost ? '<span class="red">Host (ghost)</span>' : "Ghost";

    const lit = snap.hearths.filter((h) => h.lit).length;
    $("status").innerHTML = `Hearths lit <b>${lit}/${snap.hearths.length}</b> · Pages on the altar <b>${snap.altarPages}/4</b>${
      you.pages ? ` · Carrying <b>${you.pages}</b>` : ""
    }${snap.grace ? " · <i>The guests are arriving…</i>" : ""}`;

    const wax = Math.max(0, Math.min(100, you.wax));
    $("wax").style.height = `${wax}%`;
    $("flame").style.opacity = you.lit ? "1" : "0";
    $("waxText").textContent = you.ghost ? `Ectoplasm ${you.ecto}` : `${Math.round(wax)} wax`;
    show("candle", !you.ghost);
    show("ecto", you.ghost);
    $("ecto").textContent = `Ectoplasm ${you.ecto}`;

    const label: Record<string, string> = {
      refill: "Refilling wax",
      hearth: "Relighting the hearth (needs two)",
      search: "Searching",
      read: "Reading the will (needs two guests)",
    };
    if (you.hold && you.holdP !== undefined) {
      show("progress", true);
      ($("progress").firstElementChild as HTMLElement).style.width = `${Math.min(1, you.holdP) * 100}%`;
      $("progressText").textContent = label[you.hold];
    } else if (snap.read > 0) {
      show("progress", true);
      ($("progress").firstElementChild as HTMLElement).style.width = `${snap.read * 100}%`;
      $("progressText").textContent = "The will is being read…";
    } else show("progress", false);

    $("hints").innerHTML = this.hints(snap).map((h) => `<div>${h}</div>`).join("");
    this.renderMirror(snap);
    show("ghostChat", you.ghost && snap.phase === "play");
    this.renderMeeting(snap);
  }

  private hints(snap: Snapshot): string[] {
    const s = this.session!;
    const w = s.world!;
    const you = snap.you;
    const me = s.pos;
    const out: string[] = [];
    if (snap.phase !== "play") return out;
    if (you.ghost) {
      out.push(`<b>K</b> knock (${you.ecto} ectoplasm)`);
      if (you.mirror >= 0) out.push("<b>E</b> write a word on this mirror");
      out.push("<b>Enter</b> talk with other ghosts");
      return out;
    }
    if (!you.alive) return out;
    if (you.shaken) return ["Your hands are shaking…"];
    snap.hearths.forEach((h, i) => {
      if (dist(w.view.hearths[i], me) > 1.6) return;
      if (!h.lit) out.push("Hold <b>E</b> with another guest to relight this hearth");
      else if (!you.lit && you.wax > 0) out.push("<b>E</b> relight your candle");
      else if (you.lit && you.wax < 100) out.push("Hold <b>E</b> to refill your wax");
    });
    if (!you.lit && you.wax > 0 && [...s.remotes.values()].some((r) => r.view.lit && dist(r, me) <= 1.5)) {
      out.push("<b>E</b> relight from their candle");
    }
    if (!you.lit && you.wax <= 0) out.push("Your candle is spent. Find a lit hearth and hold <b>E</b>.");
    if (snap.spots.some((sp) => !sp.s && dist(w.view.spots[sp.i], me) <= 1.2)) out.push("Hold <b>E</b> to search for pages of the will");
    if (snap.loose.some((l) => dist(l, me) <= 1.6)) out.push("<b>E</b> pick up the page");
    const atAltar = distToRect(w.view.altar, me);
    if (you.pages > 0 && atAltar <= 1.6 && !s.isHost) out.push("<b>E</b> lay your pages on the altar");
    if (snap.altarPages >= 4 && atAltar <= 2) out.push("Hold <b>E</b> with another guest to read the will");
    if (snap.bodies.some((b) => dist(b, me) <= 1.5)) out.push("<b>R</b> report the body");
    if (distToRect(w.view.table, me) <= 1.5 && !you.seance) out.push("<b>G</b> call a séance (60 wax)");
    if (s.isHost) {
      const cd = (v: number) => (v > 0 || snap.grace ? ` <i>${snap.grace ? "soon" : `${v}s`}</i>` : "");
      out.push(`Hold <b>Q</b> snuff${cd(you.snuffCD)} · <b>Space</b> kill${cd(you.killCD)}`);
      out.push(`<b>1</b> draft · <b>2</b> cold hearth${cd(you.sabCD)}`);
      if (w.view.passages?.some((pair) => pair.some((p) => dist(p, me) <= 0.9))) out.push("<b>E</b> slip through the servant passage");
    }
    return out;
  }

  private renderMirror(snap: Snapshot) {
    const m = snap.mirror;
    show("mirrorBox", !!m && !snap.you.ghost);
    if (!m || snap.you.ghost) return;
    const s = this.session!;
    const room = s.world!.view.rooms[m.room];
    const cv = $<HTMLCanvasElement>("mirror");
    const ctx = cv.getContext("2d")!;
    const w = room.x1 - room.x0 + 1, h = room.y1 - room.y0 + 1;
    const k = Math.min((cv.width - 20) / w, (cv.height - 20) / h);
    const ox = (cv.width - w * k) / 2, oy = (cv.height - h * k) / 2;
    ctx.fillStyle = "#1b2026";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#33404a";
    ctx.fillRect(ox, oy, w * k, h * k);
    for (let y = room.y0; y <= room.y1; y++)
      for (let x = room.x0; x <= room.x1; x++)
        if (s.world!.solidAt(x, y)) {
          ctx.fillStyle = "#536472";
          ctx.fillRect(ox + (x - room.x0) * k, oy + (y - room.y0) * k, k, k);
        }
    for (const r of m.refl) {
      const x = ox + (r.x - room.x0) * k, y = oy + (r.y - room.y0) * k;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, k * 0.35), 0, Math.PI * 2);
      if (r.ghost) {
        ctx.strokeStyle = "rgba(220,240,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = s.color(r.id);
        ctx.fill();
      }
    }
    // Silvering and fog over the glass.
    const grad = ctx.createLinearGradient(0, 0, cv.width, cv.height);
    grad.addColorStop(0, "rgba(255,255,255,0.12)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cv.width, cv.height);
    $("mirrorWord").textContent = m.word ?? "";
  }

  // ----------------------------------------------------------- meetings

  // At the end of a meeting: a picture of what the vote did (reveal.ts).
  private renderVerdict(mt: MeetingView, living: string[], id: string) {
    const result = mt.stage === "result";
    show("meetingResult", result);
    document.querySelector<HTMLElement>(".meetingBody")!.classList.toggle("hidden", result);
    if (!result || this.resultShown === id) return;
    this.resultShown = id;
    const s = this.session!;
    this.resultArt?.stop();
    this.resultArt = new ResultArt(document.querySelector<HTMLCanvasElement>(".resultArt")!);
    const locked = mt.locked ? s.color(mt.locked) : null;
    // The table shows everyone still alive except the one taken away.
    this.resultArt.show(locked, living.filter((p) => p !== mt.locked).map((p) => s.color(p)));
    $("resultCaption").textContent = mt.locked
      ? mt.locked === s.me
        ? "You are dragged down to the cellar. The door locks behind you."
        : `${s.name(mt.locked)} is dragged down to the cellar. The door locks behind them.`
      : "No one is locked in the cellar. Suspicion lingers over the table.";
    $("resultAfter").textContent =
      mt.reason === "dinner" ? "As the plates are cleared, somewhere in the manor a hearth goes cold." : mt.locked ? "Was it the Host? The cellar keeps its secrets." : "";
  }

  private renderMeeting(snap: Snapshot) {
    const s = this.session!;
    const mt = snap.meeting;
    show("meeting", !!mt);
    if (!mt) {
      this.lastMeeting = "";
      this.resultArt?.stop();
      return;
    }
    const id = `${mt.reason}:${mt.caller}:${mt.body}`;
    if (id !== this.lastMeeting) {
      this.lastMeeting = id;
      $("chatLog").innerHTML = "";
    }
    const title: Record<string, string> = {
      dinner: "Dinner is served",
      body: `${esc(s.name(mt.caller ?? ""))} found the body of ${esc(s.name(mt.body ?? ""))}`,
      seance: `${esc(s.name(mt.caller ?? ""))} called a séance`,
    };
    $("meetingTitle").innerHTML = title[mt.reason];
    const stage: Record<string, string> = {
      gather: "The guests take their seats…",
      discuss: "Discuss what you saw",
      vote: "Vote: who goes to the cellar?",
      result: mt.text ?? "",
    };
    $("meetingStage").textContent = stage[mt.stage];
    $("meetingTimer").textContent = mt.stage === "result" ? "" : `${mt.t}s`;

    const living = [...snap.players.filter((p) => !p.ghost).map((p) => p.id), ...(snap.you.alive ? [s.me] : [])];
    this.renderVerdict(mt, living, id);
    const canVote = mt.stage === "vote" && snap.you.alive && !mt.you;
    const key = [mt.stage, mt.voted.join(), mt.you, living.join(), JSON.stringify(mt.tally ?? {})].join("|");
    if (key !== this.meetingKey) {
      this.meetingKey = key;
      const votes = (id: string) => (mt.tally?.[id] ? `<span class="tally">${"●".repeat(mt.tally[id])}</span>` : "");
      $("voteList").innerHTML =
        living
          .map(
            (id) => `<button class="vote ${mt.you === id ? "chosen" : ""} ${mt.locked === id ? "locked" : ""}" data-id="${id}" ${canVote && id !== s.me ? "" : "disabled"}>
              ${avatar(s.color(id), true, true)}${esc(s.name(id))}${id === s.me ? " (you)" : ""}
              ${mt.voted.includes(id) ? '<span class="voted">voted</span>' : ""}${votes(id)}
            </button>`,
          )
          .join("") +
        `<button class="vote skip ${mt.you === "skip" ? "chosen" : ""}" data-id="" ${canVote ? "" : "disabled"}>Skip vote ${votes("")}</button>`;
      $("voteList").querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
        b.onclick = () => s.net.send({ t: "vote", target: b.dataset.id });
      });
    }
    const chatOpen = mt.stage !== "gather" && (snap.you.alive || snap.you.ghost);
    $<HTMLInputElement>("chatInput").disabled = !chatOpen;
    $<HTMLInputElement>("chatInput").placeholder = snap.you.ghost
      ? "Only other ghosts can hear you…"
      : chatOpen
        ? "Speak to the table (Enter to send)"
        : "";
  }

  private onChat(c: ChatMsg) {
    const line = `<div class="${c.ghost ? "ghostline" : ""}"><b style="color:${c.color}">${esc(c.name)}</b> ${esc(c.text)}</div>`;
    for (const id of c.ghost && this.session?.snap?.phase === "play" ? ["ghostLog"] : ["chatLog"]) {
      const log = $(id);
      log.insertAdjacentHTML("beforeend", line);
      log.scrollTop = log.scrollHeight;
    }
  }

  // -------------------------------------------------------------- events

  private onEvent(e: EventMsg) {
    switch (e.kind) {
      case "knock":
        this.knock(e.x!, e.y!);
        return;
      case "draft":
        sfx.wind();
        $("hud").classList.add("draft");
        setTimeout(() => $("hud").classList.remove("draft"), 1200);
        break;
      case "snuffed":
        sfx.puff();
        break;
      case "killed":
      case "locked":
        sfx.thud();
        break;
    }
    if (e.text) this.toast(e.text, e.kind === "killed" || e.kind === "restless" || e.kind === "snuffed");
  }

  private toast(text: string, urgent = false) {
    const el = document.createElement("div");
    el.className = `toast ${urgent ? "urgent" : ""}`;
    el.textContent = text;
    $("toasts").appendChild(el);
    setTimeout(() => el.classList.add("fade"), 4500);
    setTimeout(() => el.remove(), 5500);
  }

  private knock(x: number, y: number) {
    const s = this.session!;
    const dx = x - s.pos.x, dy = y - s.pos.y;
    const d = Math.hypot(dx, dy);
    sfx.knock(dx / 8, Math.max(0.2, 1 - d / 16));
    const arrow = $("knockArrow");
    arrow.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad) translateX(140px)`;
    arrow.classList.remove("hidden");
    clearTimeout((arrow as any).timer);
    (arrow as any).timer = setTimeout(() => arrow.classList.add("hidden"), 2500);
    if (!s.snap?.you.ghost) this.toast("Knock, knock, knock…");
  }

  // ----------------------------------------------------------------- end

  private renderEnd() {
    const s = this.session!;
    const e = s.end!;
    show("meeting", false);
    show("end", true);
    const youWon = e.roles.some((r) => r.id === s.me && (r.role === "host" || r.restless ? "manor" : "guests") === e.winner);
    $("endTitle").textContent = e.winner === "guests" ? "The guests survive" : "The manor wins";
    $("endTitle").className = e.winner === "guests" ? "" : "red";
    $("endReason").textContent = `${e.reason} ${youWon ? "You won." : "You lost."}`;
    $("endRoles").innerHTML = e.roles
      .map(
        (r) => `<li>${avatar(r.color, !r.alive)}${esc(r.name)}
          <span class="${r.role === "host" || r.restless ? "red" : ""}">${r.role === "host" ? "Host" : r.restless ? "Restless Spirit" : "Guest"}</span>
          <span class="small">${r.alive ? "alive" : "dead"}</span></li>`,
      )
      .join("");
    show("endOwner", s.isOwner);
    show("endWait", !s.isOwner);
    $("backToLobby").onclick = () => s.net.send({ t: "lobby" });
  }

  // ------------------------------------------------------------- keyboard

  private releaseAll() {
    for (const action of this.held) this.session?.net.send({ t: "hold", action, on: false });
    this.held.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const s = this.session;
    if (!s?.snap || s.end) return;
    const typing = e.target instanceof HTMLInputElement;
    if (typing) {
      if (down && e.key === "Enter") this.sendChat(e.target as HTMLInputElement);
      if (down && e.key === "Escape") (e.target as HTMLInputElement).blur();
      return;
    }
    const snap = s.snap;
    const key = e.key.toLowerCase();
    if (down && key === "enter") {
      const input = snap.phase === "meeting" ? $<HTMLInputElement>("chatInput") : snap.you.ghost ? $<HTMLInputElement>("ghostInput") : null;
      if (input && !input.disabled) {
        e.preventDefault();
        input.focus();
      }
      return;
    }
    if (snap.phase !== "play") return;
    const hold = (action: string) => {
      if (down === this.held.has(action)) return;
      if (down) this.held.add(action);
      else this.held.delete(action);
      s.net.send({ t: "hold", action, on: down });
    };
    const press = (action: string) => down && !e.repeat && s.net.send({ t: "press", action });
    switch (key) {
      case "e":
        if (snap.you.ghost) {
          if (down && !e.repeat && snap.you.mirror >= 0) this.openWords();
        } else hold("interact");
        break;
      case "q":
        hold("snuff");
        break;
      case " ":
        e.preventDefault();
        press("kill");
        break;
      case "r":
        press("report");
        break;
      case "g":
        press("seance");
        break;
      case "1":
        press("sab_draft");
        break;
      case "2":
        press("sab_hearth");
        break;
      case "k":
        press("knock");
        break;
      case "escape":
        show("words", false);
        break;
    }
  }

  private sendChat(input: HTMLInputElement) {
    const text = input.value.trim();
    if (text) this.session!.net.send({ t: "chat", text });
    input.value = "";
    if (input.id === "ghostInput") input.blur();
  }

  private openWords() {
    const s = this.session!;
    const box = $("words");
    box.innerHTML =
      `<h2>Write on the fogged glass</h2><p class="small">Costs 2 ectoplasm. The living see it for 30 seconds.</p><div class="wordgrid">` +
      s.start!.words.map((w) => `<button data-w="${w}">${w}</button>`).join("") +
      `</div>`;
    box.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => {
        s.net.send({ t: "write", word: b.dataset.w });
        show("words", false);
      };
    });
    show("words", true);
  }
}
