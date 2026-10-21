import type { ServerMsg } from "./protocol";

type Handler = (msg: any) => void;

// Net wraps the game WebSocket. Handlers are registered per message type.
export class Net {
  private ws: WebSocket;
  private handlers = new Map<string, Handler[]>();
  onClose: (reason: string) => void = () => {};

  constructor(room: string, name: string, token: string, color: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ room, name, token, color });
    this.ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      for (const h of this.handlers.get(msg.t) ?? []) h(msg);
    };
    this.ws.onclose = (e) => this.onClose(e.reason);
  }

  on<T extends ServerMsg["t"]>(type: T, fn: (msg: Extract<ServerMsg, { t: T }>) => void) {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as Handler);
    this.handlers.set(type, list);
  }

  send(msg: Record<string, unknown>) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }
}
