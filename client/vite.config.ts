import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// In development the Go server writes the port it actually got (it moves up
// when 8080 is busy) to server/.lastcandle-port. The proxy reads it on every
// connection, so starting or restarting the server needs no client restart.
const portFile = new URL("../server/.lastcandle-port", import.meta.url);

function serverTarget() {
  try {
    return `ws://localhost:${readFileSync(portFile, "utf8").trim()}`;
  } catch {
    return "ws://localhost:8080";
  }
}

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
        configure(proxy) {
          const ws = proxy.ws.bind(proxy);
          // http-proxy reads its trailing arguments by type, so never pass an
          // undefined callback.
          proxy.ws = (req, socket, head, options, ...callback) => ws(req, socket, head, { ...options, target: serverTarget() }, ...callback);
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
