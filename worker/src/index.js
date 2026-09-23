// Kisses App — realtime pairing sync.
// One Durable Object instance per room (a "couple"), holding the two
// kiss counters. Role 'a' is whoever created the room; role 'b' is
// whoever opened the invite link. Each browser talks to its room over
// a WebSocket; the DO persists state and rebroadcasts on every change.

export class KissRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = { kissesFromA: 0, kissesFromB: 0 };
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get('state');
      if (stored) this.state = stored;
    });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'b' ? 'b' : 'a';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role });

    server.send(JSON.stringify({ type: 'state', ...this.state, ...this.peerInfo() }));
    this.broadcastPeers();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    if (msg.type === 'kiss') {
      const { role } = ws.deserializeAttachment() || {};
      if (role === 'b') this.state.kissesFromB++;
      else this.state.kissesFromA++;
      await this.ctx.storage.put('state', this.state);
      this.broadcast({ type: 'state', ...this.state });
    } else if (msg.type === 'reset') {
      this.state = { kissesFromA: 0, kissesFromB: 0 };
      await this.ctx.storage.put('state', this.state);
      this.broadcast({ type: 'state', ...this.state });
    }
  }

  webSocketClose(ws, code, reason) {
    ws.close(code, reason);
    this.broadcastPeers();
  }

  webSocketError() {
    this.broadcastPeers();
  }

  peerInfo() {
    let aOnline = false;
    let bOnline = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att?.role === 'a') aOnline = true;
      if (att?.role === 'b') bOnline = true;
    }
    return { aOnline, bOnline };
  }

  broadcastPeers() {
    this.broadcast({ type: 'peers', ...this.peerInfo() });
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket gone; hibernation API will clean it up
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{3,64})$/);

    if (!match) {
      return new Response('Kisses sync worker is running.', { status: 200 });
    }

    const id = env.KISS_ROOM.idFromName(match[1]);
    const stub = env.KISS_ROOM.get(id);
    return stub.fetch(request);
  },
};
