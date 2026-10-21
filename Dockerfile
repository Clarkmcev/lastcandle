# syntax=docker/dockerfile:1
# Last Candle in one small image: the built web client and the Go game
# server that serves it. See DEPLOY.md.

# 1. Build the web client (TypeScript + Phaser, bundled by Vite).
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# 2. Build the game server as one static binary.
FROM golang:1.24-alpine AS server
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /lastcandle ./cmd/lastcandle

# 3. Run: nothing but the binary, the client and the game config.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /lastcandle /app/lastcandle
COPY --from=client /app/client/dist /app/client/dist
COPY server/lastcandle.json /app/lastcandle.json
EXPOSE 8080
ENTRYPOINT ["/app/lastcandle", "-addr", ":8080", "-static", "/app/client/dist", "-config", "/app/lastcandle.json"]
