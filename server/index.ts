// Entry point: stands up the WebSocket server that hosts the game world.
// In development Vite proxies browser /ws connections here (see vite.config.ts).

import { WebSocketServer } from "ws";
import { GameServer } from "./gameServer";

const PORT = Number(process.env.PORT ?? 8080);
const SEED = Number(process.env.SEED ?? Math.floor(Math.random() * 1_000_000));

const game = new GameServer(SEED);
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  game.handleConnection(socket);
});

wss.on("listening", () => {
  console.log(`[minescape] listening on ws://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  console.log("\n[minescape] shutting down");
  wss.close(() => process.exit(0));
});
