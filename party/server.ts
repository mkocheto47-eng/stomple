import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver';
import { Room, RoomError } from '../shared/room';
import type { ClientMsg, ServerMsg, RoomSnapshot } from '../shared/protocol';

/**
 * Одна комната = один Durable Object. this.name — код комнаты.
 * Стейт держим в памяти и дублируем в storage: переживает перезапуск,
 * комната доступна по ссылке сутки после ухода последнего.
 */
export class Stomple extends Server {
  static options = { hibernate: false };
  room!: Room;
  /** connection.id → id игрока */
  who = new Map<string, string>();
  /** id игрока → число открытых соединений (две вкладки — один игрок) */
  conns = new Map<string, number>();

  async onStart() {
    const saved = await this.ctx.storage.get<RoomSnapshot>('room');
    this.room = saved ? Room.fromSnapshot(saved) : new Room(this.name.toUpperCase());
    this.room.members.forEach(m => (m.online = false));
  }

  async onConnect(conn: Connection) {
    this.send(conn, { t: 'state', room: this.room.snapshot() });
  }

  async onMessage(conn: Connection, raw: WSMessage) {
    let msg: ClientMsg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    try {
      if (msg.t === 'join') {
        this.room.connect(msg.id, msg.name);
        this.who.set(conn.id, msg.id);
        this.conns.set(msg.id, (this.conns.get(msg.id) ?? 0) + 1);
      } else {
        const id = this.who.get(conn.id);
        if (!id) throw new RoomError('Сначала войдите в комнату');
        this.room.handle(id, msg);
        // Эфемерные сообщения: не меняют снимок, не сохраняются.
        if (msg.t === 'react') { this.broadcast(JSON.stringify({ t: 'reaction', from: id, id: msg.id, at: Date.now() } satisfies ServerMsg)); return; }
        if (msg.t === 'rtc') {
          const payload = JSON.stringify({ t: 'rtc', from: id, data: msg.data } satisfies ServerMsg);
          for (const [cid, pid] of this.who) if (pid === msg.to) this.getConnection(cid)?.send(payload);
          return;
        }
      }
      await this.publish();
    } catch (e) {
      this.send(conn, { t: 'error', message: e instanceof RoomError ? e.message : 'Ошибка: ' + (e as Error).message });
    }
  }

  async onClose(conn: Connection) {
    const id = this.who.get(conn.id);
    this.who.delete(conn.id);
    if (!id) return;
    const n = (this.conns.get(id) ?? 1) - 1;
    if (n > 0) { this.conns.set(id, n); return; }
    this.conns.delete(id);
    this.room.disconnect(id);
    await this.publish();
    if (this.conns.size === 0) await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }

  async onAlarm() {
    if (this.conns.size === 0) await this.ctx.storage.deleteAll();
  }

  private async publish() {
    const snap = this.room.snapshot();
    await this.ctx.storage.put('room', snap);
    this.broadcast(JSON.stringify({ t: 'state', room: snap } satisfies ServerMsg));
  }

  private send(conn: Connection, msg: ServerMsg) {
    conn.send(JSON.stringify(msg));
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('stomple ok');
    return (await routePartykitRequest(request, env)) || new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
