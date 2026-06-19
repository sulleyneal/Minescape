// Entry point. Runs an HTTP server that (in production) serves the built client
// from dist/, with the game WebSocket mounted on the same origin at /ws. One
// port => one public URL, which is what hosting platforms expect.
//
// In development the client is served by Vite on :5173 and proxies /ws here,
// so this still just needs to accept WebSocket upgrades on /ws.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { GameServer } from "./gameServer";
import { FileStorage, PostgresStorage, Storage } from "./storage";

const PORT = Number(process.env.PORT ?? 8080);
const SEED = Number(process.env.SEED ?? Math.floor(Math.random() * 1_000_000));
const SAVE_PATH = process.env.SAVE_PATH ?? resolve(process.cwd(), "world-save.json");
const DIST = resolve(process.cwd(), "dist");
const hasClient = existsSync(join(DIST, "index.html"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// Use the Postgres database when one is configured (durable on cloud hosts),
// otherwise fall back to a local JSON file.
const storage: Storage = process.env.DATABASE_URL
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new FileStorage(SAVE_PATH);
await storage.init();
const game = new GameServer(await storage.load(), storage, SEED);

const httpServer = createServer(async (req, res) => {
  if (!hasClient) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Minescape server running. Run `npm run dev` for the client, or `npm run build` then `npm start`.\n");
    return;
  }
  // Serve a static asset, falling back to index.html for unknown routes.
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let filePath = normalize(join(DIST, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    const html = await readFile(join(DIST, "index.html")).catch(() => null);
    if (html) {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

// WebSocket on the same origin, path /ws (matches the dev Vite proxy).
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
wss.on("connection", (socket) => game.handleConnection(socket));

httpServer.listen(PORT, () => {
  console.log(`[minescape] listening on http://localhost:${PORT}  (ws at /ws)`);
  if (hasClient) console.log(`[minescape] serving client from ${DIST}`);
});

async function shutdown(): Promise<void> {
  console.log("\n[minescape] saving and shutting down");
  await game.saveNow();
  httpServer.close(() => process.exit(0));
  // Failsafe in case sockets keep the server open.
  setTimeout(() => process.exit(0), 2000).unref();
}
// Hosts send SIGTERM on redeploy/restart; save first so progress survives.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
