# Last Candle

A social deduction game for 3 to 10 players in a haunted Victorian manor. Guests must survive one night while a hidden Host, in a pact with the house, snuffs out candles and kills in the dark. Light is your vision, your safety and your clock.

The full design is in the [game design document](https://claude.ai/code/artifact/ab99f74c-7c9f-4218-a9ec-378cfde4b832). This repository is the first playable prototype.

## Run it

Requirements: Go 1.24+ and Node 20+.

```sh
make install          # client dependencies
make run              # builds everything and serves the game on http://localhost:8080
```

Friends on your network can join at `http://<your-ip>:8080`.

For development, run the server and the Vite dev server in two terminals and open http://localhost:5173:

```sh
make dev-server       # Go server on :8080, 20-second in-game hours
make dev-client       # Vite on :5173, proxies /ws to the server
```

If port 8080 is already in use, the server moves to the next free port (8081, 8082, …) and logs the one it took. In development the Vite proxy follows it automatically. To start from a different port, use `make dev-server PORT=9000` or `make run PORT=9000`.

Playing alone? Add bots in the lobby. At least 3 players (or bots) are needed.

### Deploying

To host it on the internet (Fly.io, one machine, your own domain), see [DEPLOY.md](DEPLOY.md). `make docker-run` runs the production image locally first; `make docker-dev` runs it in developer mode.

### Developer mode

`make dev-server` starts the server with `-dev`. Open the client with `?dev` and it skips the lobby and drops you into an empty sandbox match:

| URL | What you get |
| --- | --- |
| `http://localhost:5173/?dev` | You alone, as a guest |
| `http://localhost:5173/?dev=host` | You alone, as the Host, with no kill cooldown |
| `http://localhost:5173/?dev=host&bots=3` | You as the Host, plus 3 bot guests to snuff and kill |

A sandbox match has no grace period and never ends. When a real match would end (dawn, the will read, a win), a `[dev]` toast says so and play carries on; at dawn the night starts over. Bots are always guests, so nothing hunts you. A server started without `-dev` refuses sandbox matches.

`make test` runs the Go tests (rules, a full bot match, a WebSocket lobby-to-match test) and the TypeScript type check.

### Settings page

**⚙ Settings** (top right on the home screen and in the lobby; **Esc** or the ⚙ under your role during a match) holds the sound, which is yours and remembered in your browser: master, music and effects volume, and the music on or off (**M** switches it anywhere). During a match it also has **◀ Leave the game** (back to the main menu) and, for whoever runs the lobby, **■ Stop the game** (click twice: it ends the night and brings everyone back to the lobby).

**Rules of the night** open from the lobby's **Change the rules…** link (**All the rules…** for other players, who can read them but not change them). Only the player who runs the lobby changes them, before the night begins: hour length, grace period, length of the night, the Witching Hour, when dinner is served (first dinner, how often, how many), discussion and voting time, walking and ghost speed, room size, wax burn, candlelight reach, how long lamps stay on, snuff time, snuff and kill cooldowns, and how far snuffs and kills are heard. **Back to the defaults** restores the server's config.

Every new lobby starts from the server's config (`server/lastcandle.json`); the rules page never writes to that file.

### Server options

Environment variables live in `.env.dev` (committed, loaded by `make dev-server` and `make docker-dev`) and `.env.prod` (gitignored because it holds the admin token; loaded by `make docker-run` and sent to Fly.io by `make secrets`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `-addr` | `:8080` | Listen address; if the port is taken, the next free one is used |
| `-dev` | off | Allow sandbox matches from `?dev` URLs (on in `make dev-server`) |
| `-portfile` | none | Write the port in use to this file (used by `make dev-server`) |
| `-static` | `../client/dist` | Built client to serve (skipped if missing) |
| `-origins` | `localhost:*,127.0.0.1:*` | Extra WebSocket origins allowed (same-host is always allowed) |
| `LASTCANDLE_HOUR_SECONDS` | `60` | Real seconds per in-game hour |
| `LASTCANDLE_DISCUSS_SECONDS` | `30` | Meeting discussion time |
| `LASTCANDLE_ADMIN_TOKEN` | none | Serve `/rooms` to requests with `Authorization: Bearer <token>` |

### Endpoints

| Path | What it serves |
| --- | --- |
| `/ws?room=CODE&name=NAME` | The game's WebSocket; no `room` opens a new room |
| `/healthz` | `ok rooms=3 matches=1`: rooms open and matches running |
| `/rooms` | JSON list of every open room: `code`, `state` (`lobby`, `playing`, `ended`), `players` (bots included), `online` (humans connected) and `created`. Only with `-dev`, or with `LASTCANDLE_ADMIN_TOKEN` set; otherwise 404 |
| `/` | The built web client, when `-static` points at one |

A room code is all it takes to join a lobby, so `/rooms` is for whoever runs the server, never for players:

```sh
curl -s localhost:8080/rooms | jq                                                     # -dev, no token set
curl -s -H "Authorization: Bearer $TOKEN" https://lastcandle.fly.dev/rooms | jq   # production (see DEPLOY.md)
```

## How to play

The night runs from 10 PM to 6 AM. Dinner is served at midnight, 2 AM and 4 AM, and after each dinner a hearth goes cold.

**Guests win** if 2+ guests see dawn, if the four pages of the will are read at the Chapel altar, or if every Host is locked in the cellar.
**The Host wins** by matching the guests in number, or if every hearth goes cold.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Hold the left button to walk toward the cursor, or click to walk to a spot (finds the way through doors; a movement key cancels) |
| E (hold) | Refill wax at a hearth, relight your candle, switch a room's lamps on or off, search for pages, lay pages on the altar, read the will, relight a cold hearth (needs two) |
| R | Report a body |
| G | Call a séance at the dining table (costs 60 wax, once per game) |
| Enter | Chat (meetings, or ghost chat when dead) |
| M | Music on or off (also the button at the top right of the menus; remembered) |
| **Host:** Q (hold) | Snuff the candle of the guest beside you |
| **Host:** Space | Kill a guest whose candle is out and who stands in no one else's light |
| **Host:** 1 / 2 | Sabotage: draft (room's candles lose wax) / turn the nearest hearth cold |
| **Host:** E | Slip through a servant passage (purple squares) |
| **Ghost:** K | Knock (living players hear it, with direction) |
| **Ghost:** E at a mirror | Write a word on the glass |

Choose your character in the lobby; a character another player holds is taken, picking a bot's swaps with it, and your last pick is offered again at the next party. Each player colour comes with its own pixel-art character: the Colonel, the Gentleman, the Widow, the Poet, the Physician, the Governess, the Clergyman, the Heiress, the Inventor and the Gambler. Bots are named after the character they are dressed as.

The Chapel, the Nursery and the Entrance Hall have a lamp switch (a brass plate on the top wall). **E** lights the whole room for 40 seconds (`lampTime`), and nobody can be killed in a lit room; anyone, the Host included, can switch it off again.

Clues to watch for: coloured wax drips show recent paths, smoke drifts away from where a snuffer stood, and in a mirror the Host's reflection lags half a second behind. Every character has a voice of their own (babble, not words): it speaks their chat lines, greets you when you pick them, and cries out when they call a meeting or lose their candle. Listen too: you hear the footsteps of everyone you can see (wood and stone floors sound different), and a candle being snuffed or a struggle in the dark carries through walls to anyone within 9 tiles (`hearRange` in the config).

## How it is built

```
server/                      Go module
  cmd/lastcandle/            HTTP entry point
  internal/game/             All rules: map, movement, light, snuff/kill, meetings, bots, per-player views
  internal/server/           Rooms with join codes, one goroutine per room, WebSocket clients
client/                      TypeScript + Phaser 3, bundled with Vite
  src/world.ts               Map lookups and the movement rule (mirrors server/internal/game/geom.go)
  src/session.ts             Connection state, client-side prediction and reconciliation
  src/scene.ts               Rendering: baked map, darkness render texture, raycast candlelight, character sprites
  src/sprites.ts             Procedural pixel-art characters: 10 costumes, idle and walk cycles in 3 directions
  src/roomart.ts             Pixel-art interiors: per-room floors, wallpaper, wall decor and furniture (decoration only)
  src/music.ts               The 8-bit theme, synthesized live: two pulse voices, triangle bass, noise drums
  src/voice.ts               Character voices: wordless 8-bit babble, a different voice for each character
  src/landing.ts             Pixel-art storm behind the menus: the manor on its hill, mountains, parallax layers, fog, rain, lightning
  src/loading.ts             The loading screen before each night: the manor door in the rain, your character on the steps
  src/reveal.ts              Story art: the Guest or Host card at nightfall, and the verdict (cellar or table) after each meeting
  src/pixel.ts               Shared helpers for the painted art: ordered dither, seeded random
  src/ui.ts                  HTML screens: lobby, HUD, meetings, mirror view, end screen
```

- The server is authoritative and ticks at 20 Hz. Each player is sent only what their character can perceive (players in their light or carrying a visible candle, clues within their light), so roles and hidden positions never reach a client that shouldn't have them.
- Clients send numbered movement commands, predict their own movement, and replay unacknowledged commands on each snapshot. The movement code in `world.ts` must stay in step with `geom.go`.
- Messages are JSON over WebSocket for now; the design doc's MessagePack is a later optimisation.

`window.lastcandle` in the browser console exposes the Phaser game and the session for debugging.

## Not in this prototype yet

From the design doc: optional roles (Medium, Butler, Physician, Doppelgänger, Widow), portraits and the guestbook, the locked-wing and whispers sabotages, proximity voice, accounts and progression, replays, and mobile controls.

## Roadmap

- Configurable Setting
- Settings
- Art design
- Extend with a outdoor area like a light house
