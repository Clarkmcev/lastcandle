# Last Candle: Go game server + TypeScript/Phaser web client.

.PHONY: install dev-server dev-client build test run

install:
	cd client && npm install

# Development: run these two in separate terminals, then open http://localhost:5173
# Short nights make testing quicker; override with HOUR=60 for the real pace.
# The server takes the next free port if PORT is busy, and the dev client
# finds it through server/.lastcandle-port.
HOUR ?= 20
PORT ?= 8080
dev-server:
	cd server && LASTCANDLE_HOUR_SECONDS=$(HOUR) go run ./cmd/lastcandle -addr :$(PORT) -portfile .lastcandle-port

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
