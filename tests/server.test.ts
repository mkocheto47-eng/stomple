import { describe, it, expect, vi } from 'vitest';

/* Вне Cloudflare нет 'cloudflare:workers' — подменяем базовый класс Server минимальной реализацией. */
vi.mock('partyserver', () => {
  class Server {
    static options = {};
    ctx: any; env: any; _conns = new Map<string, any>();
    constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; }
    get name() { return this.ctx.id.name; }
    broadcast(s: string) { this._conns.forEach((c: any) => c.send(s)); }
    getConnection(id: string) { return this._conns.get(id); }
  }
  return { Server, routePartykitRequest: async () => null };
});

import { Stomple } from '../party/server';
import type { ServerMsg, ClientMsg } from '../shared/protocol';
import { targetCells } from '../shared/engine';

/** Имитация DurableObjectState: storage в Map, одно хранилище на «комнату». */
function fakeCtx(name: string) {
  const store = new Map<string, unknown>();
  return {
    id: { name },
    storage: {
      get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); },
      deleteAll: async () => store.clear(), setAlarm: async () => {},
    },
    _store: store,
  };
}

async function boot(id = 'abcd') {
  const party = fakeCtx(id);
  const srv: any = new Stomple(party as any, {} as any);
  await srv.onStart();
  const client = async (cid: string, pid: string, name: string) => {
    const c = { id: cid, inbox: [] as ServerMsg[], send: (s: string) => { c.inbox.push(JSON.parse(s)); } };
    srv._conns.set(cid, c);
    await srv.onConnect(c as any);
    await srv.onMessage(c as any, JSON.stringify({ t: 'join', id: pid, name } satisfies ClientMsg));
    return {
      send: (m: ClientMsg) => srv.onMessage(c as any, JSON.stringify(m)),
      close: async () => { srv._conns.delete(cid); await srv.onClose(c as any, 1000, '', true); },
      last: () => [...c.inbox].reverse().find(m => m.t === 'state') as Extract<ServerMsg, { t: 'state' }>,
      errors: () => c.inbox.filter(m => m.t === 'error') as Extract<ServerMsg, { t: 'error' }>[],
      inbox: () => c.inbox,
    };
  };
  return { party, srv, client };
}

describe('PartyKit-адаптер', () => {
  it('полный цикл: вход, цвета, старт, ход, рассылка всем, сохранение в storage', async () => {
    const { party, client } = await boot();
    const a = await client('c1', 'a', 'Аня');
    const b = await client('c2', 'b', 'Боря');
    expect(a.last().room.members.map(m => m.name)).toEqual(['Аня', 'Боря']);
    expect(a.last().room.members[0].host).toBe(true);
    await a.send({ t: 'color', color: 0 }); await b.send({ t: 'color', color: 3 });
    await b.send({ t: 'start' });
    expect(b.errors().at(-1)?.message).toMatch(/хозяин/);
    await a.send({ t: 'start' });
    const room = b.last().room;
    expect(room.phase).toBe('game');
    expect(room.game?.targetScore).toBe(40);
    const curId = room.game!.players[room.game!.turn].id;
    const mover = curId === 'a' ? a : b, other = curId === 'a' ? b : a;
    const move = [...targetCells(room.game!).values()][0];
    await other.send({ t: 'move', move });
    expect(other.errors().at(-1)?.message).toMatch(/не ваш ход/);
    await mover.send({ t: 'move', move });
    expect(a.last().room.game?.lastMove?.path).toEqual(move.path);
    expect(b.last().room.game?.lastMove?.path).toEqual(move.path);
    expect((party._store.get('room') as any).game.lastMove.path).toEqual(move.path);
  });

  it('обрыв и возврат: вторая вкладка не выкидывает; после рестарта воркера комната восстанавливается', async () => {
    const { party, client } = await boot();
    const a = await client('c1', 'a', 'Аня');
    const b = await client('c2', 'b', 'Боря');
    await a.send({ t: 'color', color: 0 }); await b.send({ t: 'color', color: 3 }); await a.send({ t: 'start' });
    const b2 = await client('c3', 'b', 'Боря');
    await b.close();
    expect(a.last().room.members.find(m => m.id === 'b')?.online).toBe(true);
    await b2.close();
    expect(a.last().room.members.find(m => m.id === 'b')?.online).toBe(false);
    const srv2: any = new Stomple(party as any, {} as any);
    await srv2.onStart();
    expect(srv2.room.phase).toBe('game');
    expect(srv2.room.members.every((m: any) => !m.online)).toBe(true);
  });

  it('реакции идут всем и не попадают в снимок; rtc — только адресату', async () => {
    const { party, client } = await boot();
    const a = await client('c1', 'a', 'Аня');
    const b = await client('c2', 'b', 'Боря');
    const c = await client('c3', 'c', 'Вера');
    await a.send({ t: 'react', id: 'love' });
    const got = (x: any) => x.inbox().filter((m: any) => m.t === 'reaction');
    expect(got(b)).toHaveLength(1); expect(got(c)).toHaveLength(1); expect(got(a)[0]).toMatchObject({ from: 'a', id: 'love' });
    expect(JSON.stringify(party._store.get('room'))).not.toContain('love');
    await a.send({ t: 'react', id: 'cool' });
    expect(a.errors().at(-1)?.message).toMatch(/часто/);
    await a.send({ t: 'rtc', to: 'b', data: { sdp: 'offer' } });
    expect(b.inbox().filter((m: any) => m.t === 'rtc')).toEqual([{ t: 'rtc', from: 'a', data: { sdp: 'offer' } }]);
    expect(c.inbox().filter((m: any) => m.t === 'rtc')).toHaveLength(0);
    await b.send({ t: 'voice', on: true });
    expect(a.last().room.members.find(m => m.id === 'b')?.voice).toBe(true);
  });

  it('в лобби ушедший освобождает место, хозяйство переходит', async () => {
    const { client } = await boot();
    const a = await client('c1', 'a', 'Аня');
    const b = await client('c2', 'b', 'Боря');
    await a.close();
    const room = b.last().room;
    expect(room.members.map(m => m.id)).toEqual(['b']);
    expect(room.members[0].host).toBe(true);
  });
});
