// Airband's relay on Cloudflare: it serves the phone app and passes locked messages between a
// computer and its linked phones. It cannot read them: the key lives only on the two devices.
// Each pair has a room (a Durable Object). Idle connections sleep (hibernation), so a quiet room
// costs nothing.
import { DurableObject } from "cloudflare:workers";
import { LIMITS, RoomLogic, type Role, type RoomSocket } from "./room";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const ROUTE = /^\/r\/([A-Za-z0-9_-]{22})\/(ws|send|forget|check)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const m = ROUTE.exec(new URL(req.url).pathname);
    if (!m) return env.ASSETS.fetch(req);
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
} satisfies ExportedHandler<Env>;

// One wrapper per connection, so the room can tell connections apart (a new wrapper on every call
// made each new computer connection look like "another" one, and close itself).
const wrappers = new WeakMap<WebSocket, RoomSocket>();
const wrap = (ws: WebSocket): RoomSocket => {
  let w = wrappers.get(ws);
  if (!w) wrappers.set(ws, (w = wrapNew(ws)));
  return w;
};

const wrapNew = (ws: WebSocket): RoomSocket => ({
  role: (ws.deserializeAttachment() as { role: Role }).role,
  send: (t) => {
    try {
      ws.send(t);
    } catch {
      // Closing: nothing to send to.
    }
  },
  close: (code, reason) => {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  },
});

export class Room extends DurableObject<Env> {
  private sockets(except?: WebSocket): RoomSocket[] {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN).map(wrap);
  }

  private logic(except?: WebSocket): RoomLogic {
    const storage = this.ctx.storage;
    return new RoomLogic(
      { get: (k) => storage.get<string>(k), put: (k, v) => storage.put(k, v), deleteAll: () => storage.deleteAll() },
      () => this.sockets(except),
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const what = ROUTE.exec(url.pathname)?.[2];
    if (what === "ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("A WebSocket only.", { status: 426 });
      const role: Role = url.searchParams.get("role") === "mac" ? "mac" : "phone";
      const verdict = await this.logic().admit(role, url.searchParams.get("token"));
      if (verdict !== "ok") return new Response(verdict === "full" ? "Too many phones." : "Not this room.", { status: verdict === "full" ? 429 : 403 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role });
      // A keep-alive answered without waking the room.
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
      await this.logic().joined(wrap(server));
      await this.ctx.storage.setAlarm(Date.now() + LIMITS.idleMs);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (req.method !== "POST") return new Response("Not here.", { status: 405 });
    const token = req.headers.get("x-room-token");
    if (what === "forget") return new Response(null, { status: await this.logic().forget(token) });
    if (what === "check") return new Response(null, { status: await this.logic().check(token) });
    const body = (await req.json().catch(() => ({}))) as { d?: unknown };
    return new Response(null, { status: await this.logic().post(token, body.d) });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return ws.close(4003, "text only");
    await this.logic().message(wrap(ws), message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.logic(ws).left(wrap(ws));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.logic(ws).left(wrap(ws));
  }

  async alarm(): Promise<void> {
    if (await this.logic().stale()) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.now() + LIMITS.idleMs);
  }
}
