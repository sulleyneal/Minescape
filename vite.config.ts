import { defineConfig } from "vite";

// The Vite dev server hosts the browser client. During development it proxies
// WebSocket traffic on /ws to the authoritative game server (see server/index.ts),
// so the whole game runs from a single origin / single URL friends can open.
export default defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
