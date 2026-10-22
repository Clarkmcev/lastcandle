# Last Candle: Go game server + TypeScript/Phaser web client.

.PHONY: install dev-server dev-client build test run docker docker-run docker-dev launch secrets rooms-dev rooms-prod deploy

install:
	cd client && npm install

# Development: run these two in separate terminals, then open http://localhost:5173
# Settings come from .env.dev (short nights, no limits); edit it to change them.
# The server takes the next free port if PORT is busy, and the dev client
# finds it through server/.lastcandle-port.
PORT ?= 8080
dev-server:
	set -a && . ./.env.dev && set +a && cd server && go run ./cmd/lastcandle -dev -addr :$(PORT) -portfile .lastcandle-port

dev-client:
	cd client && npm run dev

test:
	cd server && go vet ./... && go test ./...
	cd client && npm run typecheck

build:
	cd client && npm run build
	cd server && go build -o lastcandle ./cmd/lastcandle

# Production-style: one binary serves the built client and the game on $(PORT).
run: build
	cd server && ./lastcandle -addr :$(PORT)

# The production image (see DEPLOY.md), and a local run of it on :8080 with
# .env.prod's settings when that file exists.
docker:
	docker build -t lastcandle .

docker-run: docker
	docker run --rm -p $(PORT):8080 $(if $(wildcard .env.prod),--env-file .env.prod) lastcandle

# The same image in developer mode (sandbox matches, /rooms) with .env.dev.
docker-dev: docker
	docker run --rm -p $(PORT):8080 --env-file .env.dev lastcandle -dev

FLY ?= $(shell command -v fly 2>/dev/null || echo $(HOME)/.fly/bin/fly)
FLY_APP ?= lastcandle
FLY_REGION ?= cdg

# Create the app on Fly.io once, from the fly.toml in this repo, without
# deploying yet.
launch:
	$(FLY) launch --no-deploy --copy-config --ha=false --name $(FLY_APP) --region $(FLY_REGION)

# Deploy to Fly.io on one machine (lobbies live in memory).
deploy:
	$(FLY) deploy --ha=false

# Send .env.prod to Fly.io as secrets (the app restarts with them).
secrets:
	grep -v '^#' .env.prod | grep . | $(FLY) secrets import

# List every open room: on the local dev server on $(PORT), or on Fly.io
# with .env.prod's token.
rooms-dev:
	@curl -sSf localhost:$(PORT)/rooms | python3 -m json.tool

rooms-prod:
	@set -a && . ./.env.prod && set +a && curl -sSf -H "Authorization: Bearer $$LASTCANDLE_ADMIN_TOKEN" https://$(FLY_APP).fly.dev/rooms | python3 -m json.tool
