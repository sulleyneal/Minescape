// Thin WebSocket wrapper. Connects through the Vite dev proxy (/ws) so the
// whole game lives behind one URL. Parses server messages and dispatches by type.

import { ClientMessage, ServerMessage } from "../../shared/protocol";

type Handler = (msg: ServerMessage) => void;

export class Net {
  private socket: WebSocket | null = null;
  private handler: Handler | null = null;
  private queue: ClientMessage[] = [];

  connect(): Promise<void> {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.onopen = () => {
        for (const m of this.queue) this.socket!.send(JSON.stringify(m));
        this.queue = [];
        resolve();
      };
      this.socket.onerror = (e) => reject(e);
      this.socket.onmessage = (ev) => {
        if (!this.handler) return;
        try {
          this.handler(JSON.parse(ev.data) as ServerMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
    });
  }

  onMessage(handler: Handler): void {
    this.handler = handler;
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }
}
