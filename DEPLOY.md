# Deploying Last Candle to Fly.io

One small Docker image (about 10 MB) holds everything: the Go game server,
the built web client it serves, and the game config. Fly.io runs it on one
machine with HTTPS and WebSockets, at your own domain.

The files are already in the repo:

| File | What it does |
| --- | --- |
| `Dockerfile` | Builds the client (Node 22), the server (Go 1.24) and a minimal runtime image |
| `.dockerignore` | Keeps `node_modules`, builds and logs out of the image |
| `fly.toml` | The Fly.io app: port 8080, HTTPS, health check on `/healthz`, sleeps when idle |
| `Makefile` | `make docker`, `make docker-run` (test locally), `make launch`, `make deploy` |

## The one rule

Lobbies and matches live in the server's memory, so the game must run on
**exactly one machine**. Always deploy with `--ha=false` (what `make deploy`
does), and never scale above 1. With two machines, players could land on
different machines and fail to find each other's room.

## 1. Before you start (once)

1. Create an account at <https://fly.io> and add a payment card (needed even
   for the free allowance; a game this size costs little or nothing).
2. Install the command-line tool and log in:
   ```sh
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```
3. Choose your defaults in `server/lastcandle.json`. Every new lobby starts
   from it (lobby owners can still change rules on the rules page). It
   currently sets speed 7, ghost speed 9 and 20×10 rooms, your playtest
   values; trim it to `{}` for the built-in defaults.

## 2. Test the production image locally

```sh
make docker-run          # builds the image and serves it on http://localhost:8080
```

Open <http://localhost:8080>, host a party, join from a private window with
the invite link and start a night. Stop it with Ctrl+C.

## 3. Create the app

```sh
make launch                                   # app "lastcandle" in Paris (cdg)
make launch FLY_APP=lastcandle-clark FLY_REGION=ams   # or choose your own
```

This runs `fly launch --no-deploy --copy-config --ha=false --name … --region …`.

- `--name`: the app's name must be unique on Fly.io. If `lastcandle` is taken,
  pick another (for example `lastcandle-clark`); it also becomes the free
  address `https://<name>.fly.dev`, and `fly launch` writes it into `fly.toml`.
- `--region`: `cdg` is Paris. Pick the region closest to your players
  (`fly platform regions` lists them); latency matters for movement.
- `--copy-config` keeps the `fly.toml` in the repo; answer **no** if asked to
  add a Postgres or Redis database (the game needs none).

## 4. Deploy

```sh
make deploy              # same as: fly deploy --ha=false
```

Fly builds the Dockerfile remotely and starts one machine. Then check it:

```sh
fly status               # one machine, "started", health check "passing"
fly logs                 # "Last Candle listening on http://localhost:8080"
fly open                 # opens https://<name>.fly.dev
```

Play a night at `https://<name>.fly.dev` with a friend or two browser windows.

When pushing to master, a deploy is automatically triggered.

## 5. Your own domain

For `lastcandle.yourdomain.com`:

1. Ask Fly for a certificate:
   ```sh
   fly certs add lastcandle.yourdomain.com
   ```
2. At your DNS provider, add the record it prints. Usually that is a `CNAME`
   from `lastcandle` to `<name>.fly.dev`. For a bare domain (`yourdomain.com`),
   use the `A` and `AAAA` records from `fly ips list` instead.
3. Wait for the certificate (a few minutes once DNS has spread):
   ```sh
   fly certs check lastcandle.yourdomain.com
   ```

Players then use `https://lastcandle.yourdomain.com`, and lobby invite links
come out on that address. No server settings change: the game accepts
connections from the address the page was loaded on.

## Updating

Change code, then `make deploy` again. Fly builds the new image and swaps
the machine. Matches in progress at that moment end, so deploy when nobody
is playing (`fly logs` shows rooms joining and starting).

## Good to know

- **Sleeping.** With nobody connected, the machine stops after a few minutes
  and starts again on the next visit, which takes a few seconds. An open game
  keeps it awake. To keep it always on, set `min_machines_running = 1` in
  `fly.toml` (costs a little more).
- **Size.** 256 MB of memory and a shared CPU are plenty for several
  parties at once. `fly scale memory 512` if you ever need more; never
  `fly scale count` above 1.
- **Settings.** `.env.prod` (gitignored) holds the production settings and
  the admin token. `make secrets` sends it to Fly as secrets, which restarts
  the app; `make docker-run` runs the image locally with it.
- **Game limits.** One server keeps at most 60 rooms open and 20 matches
  running at once, so a rush of games cannot max out the CPU. Past that,
  new rooms are refused and Start asks the owner to wait. Change
  `LASTCANDLE_MAX_ROOMS` and `LASTCANDLE_MAX_MATCHES` in `.env.prod` (0 means
  no limit), then `make secrets`. `/healthz` shows how many are in use, e.g.
  `ok rooms=3 matches=1`.
- **Room list.** `LASTCANDLE_ADMIN_TOKEN` in `.env.prod` is a long random
  token (`openssl rand -hex 32` makes a new one; `make secrets` sends it).
  Fly will not show it again, so `.env.prod` is your copy. Then
  `curl -H "Authorization: Bearer $TOKEN" https://<your-app>.fly.dev/rooms`
  lists every open room with its code. Without the secret, `/rooms` does not
  exist.
- **No developer mode.** The image starts the server without `-dev`, so
  `?dev` sandbox matches are refused in production.
- **Rolling back.** `fly releases` lists deploys; `fly deploy --image <ref>`
  with an earlier image puts it back.
- **Logs and health.** `fly logs` streams the server log; Fly checks
  `/healthz` every 30 seconds and restarts the machine if it stops answering.

## Checklist

- [ ] `fly auth login` works
- [ ] `server/lastcandle.json` holds the defaults you want
- [ ] `make docker-run` plays a full night locally
- [ ] `make launch` created the app
- [ ] `make deploy` succeeded; `fly status` shows one healthy machine
- [ ] A night played at `https://<name>.fly.dev`
- [ ] `fly certs add` and the DNS record for your domain
- [ ] `fly certs check` reports the certificate issued
