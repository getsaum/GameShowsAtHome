export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/ws$/i);

    if (match) {
      const code = match[1].toUpperCase();
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();
    this.game = null;
    this.state.blockConcurrencyWhile(async () => {
      this.game = (await this.state.storage.get("game")) || null;
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.accept(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  accept(ws) {
    ws.accept();
    this.sessions.add(ws);

    if (this.game) {
      try { ws.send(JSON.stringify({ type: "state", game: this.game })); } catch (e) {}
    }
    this.broadcastPresence();

    ws.addEventListener("message", (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.type === "state" && msg.game) {
        this.game = msg.game;
        this.state.storage.put("game", this.game);
        this.broadcast({ type: "state", game: this.game }, ws);
      }
    });

    const close = () => { this.sessions.delete(ws); this.broadcastPresence(); };
    ws.addEventListener("close", close);
    ws.addEventListener("error", close);
  }

  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const ws of this.sessions) {
      if (ws === except) continue;
      try { ws.send(data); } catch (e) { this.sessions.delete(ws); }
    }
  }

  broadcastPresence() {
    const data = JSON.stringify({ type: "presence", count: this.sessions.size });
    for (const ws of this.sessions) {
      try { ws.send(data); } catch (e) {}
    }
  }
}
