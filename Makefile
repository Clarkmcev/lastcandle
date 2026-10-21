# Last Candle: Go game server + TypeScript/Phaser web client.

.PHONY: install dev-server dev-client build test run docker docker-run launch deploy

install:
	cd client && npm install

# Development: run these two in separate terminals, then open http://localhost:5173
# Short nights make testing quicker; override with HOUR=60 for the real pace.
# The server takes the next free port if PORT is busy, and the dev client
# finds it through server/.lastcandle-port.
HOUR ?= 20
PORT ?= 8080
dev-server:
	cd server && LASTCANDLE_HOUR_SECONDS=$(HOUR) go run ./cmd/lastcandle -dev -addr :$(PORT) -portfile .lastcandle-port

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

# The production image (see DEPLOY.md), and a local run of it on :8080.
docker:
	docker build -t lastcandle .

docker-run: docker
	docker run --rm -p $(PORT):8080 lastcandle

# Fly.io (see DEPLOY.md). `fly` is found on the PATH, or where its
# installer puts it. Override the app name or region, e.g.
#   make launch FLY_APP=lastcandle-clark FLY_REGION=ams
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
