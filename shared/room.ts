/**
 * Логика комнаты — чистый класс без сети. PartyKit-обёртка (party/server.ts)
 * только передаёт сообщения и рассылает снимок.
 */
import {
  newGame, applyMove, startRound, advanceTurn, defaultTargetScore, validatePath,
  type GameState, type PlayerColor, type Move,
} from './engine';
import { REACTIONS, REACTION_COOLDOWN_MS, type ClientMsg, type Member, type RoomSnapshot, type MusicState } from './protocol';

export class RoomError extends Error {}

export class Room {
  code: string;
  phase: RoomSnapshot['phase'] = 'lobby';
  members: Member[] = [];
  targetScore: number | null = null;
  game: GameState | null = null;
  waitingSince: number | null = null;
  music: MusicState | null = null;
  now: () => number;

  constructor(code: string, now: () => number = Date.now) {
    this.code = code;
    this.now = now;
  }

  snapshot(): RoomSnapshot {
    return { code: this.code, phase: this.phase, members: this.members, targetScore: this.targetScore, game: this.game, waitingSince: this.waitingSince, music: this.music };
  }

  static fromSnapshot(s: RoomSnapshot, now?: () => number): Room {
    const r = new Room(s.code, now);
    r.phase = s.phase; r.members = s.members; r.targetScore = s.targetScore; r.game = s.game; r.waitingSince = s.waitingSince; r.music = s.music ?? null;
    return r;
  }

  // ───────── участники ─────────

  member(id: string) { return this.members.find(m => m.id === id); }
  host() { return this.members.find(m => m.host); }

  /** Активные участники: не вышли (в игре — только те, кто есть в партии). */
  active() { return this.members.filter(m => !m.left); }

  connect(id: string, name: string): Member {
    let m = this.member(id);
    if (!m) {
      if (this.phase === 'game') throw new RoomError('Игра уже идёт — подождите, пока хозяин вернёт всех в лобби');
      if (this.active().length >= 6) throw new RoomError('В комнате уже 6 игроков');
      m = { id, name: name.trim().slice(0, 12) || 'Игрок', color: null, online: true, host: this.members.length === 0, left: false, voice: false };
      this.members.push(m);
    } else {
      m.online = true;
      if (name.trim()) m.name = name.trim().slice(0, 12);
    }
    this.ensureHost();
    this.refreshWaiting();
    return m;
  }

  disconnect(id: string) {
    const m = this.member(id); if (!m) return;
    m.online = false; m.voice = false;
    // В лобби ушедший освобождает место сразу.
    if (this.phase === 'lobby') this.members = this.members.filter(x => x.id !== id);
    this.ensureHost();
    this.refreshWaiting();
  }

  /** Хозяин — всегда кто-то живой и на связи, если такой есть. */
  private ensureHost() {
    if (this.members.some(m => m.host && !m.left && m.online)) return;
    const next = this.members.find(m => !m.left && m.online) ?? this.members.find(m => !m.left);
    if (!next) return;
    this.members.forEach(m => (m.host = false));
    next.host = true;
  }

  private requireHost(id: string) {
    if (!this.member(id)?.host) throw new RoomError('Это может сделать только хозяин комнаты');
  }

  // ───────── ожидание отсутствующего ─────────

  private refreshWaiting() {
    if (this.phase !== 'game' || !this.game || this.game.phase !== 'play') { this.waitingSince = null; return; }
    const cur = this.game.players[this.game.turn];
    const m = this.member(cur.id);
    const absent = !m || !m.online || m.left;
    if (absent && this.waitingSince === null) this.waitingSince = this.now();
    if (!absent) this.waitingSince = null;
  }

  // ───────── обработка сообщений ─────────

  handle(id: string, msg: ClientMsg): void {
    const m = this.member(id);
    if (!m) throw new RoomError('Вы не в комнате');
    switch (msg.t) {
      case 'join': return; // уже обработано в connect
      case 'name': m.name = msg.name.trim().slice(0, 12) || m.name; return;
      case 'color': {
        if (this.phase !== 'lobby') throw new RoomError('Цвет можно менять только в лобби');
        if (msg.color !== null && this.members.some(x => x.id !== id && x.color === msg.color)) throw new RoomError('Этот цвет уже занят');
        m.color = msg.color; return;
      }
      case 'target': {
        this.requireHost(id);
        if (msg.targetScore !== null && (msg.targetScore < 5 || msg.targetScore > 100)) throw new RoomError('Порог от 5 до 100');
        this.targetScore = msg.targetScore; return;
      }
      case 'start': return this.start(id);
      case 'move': return this.move(id, msg.move);
      case 'nextRound': return this.nextRound(id);
      case 'again': return this.again(id);
      case 'toLobby': return this.toLobby(id);
      case 'skip': return this.skip(id);
      case 'leave': return this.leave(id);
      case 'voice': m.voice = msg.on; return;
      case 'react': return this.react(id, msg.id);
      case 'rtc': return; // ретранслируется адаптером, стейт не меняет
      case 'music': {
        this.requireHost(id);
        if (!Number.isInteger(msg.track) || msg.track < 0 || msg.track > 999) throw new RoomError('Нет такого трека');
        this.music = { track: msg.track, playing: !!msg.playing, position: Math.max(0, Number(msg.position) || 0), at: this.now() };
        return;
      }
    }
  }

  /** Последняя реакция каждого игрока — для кулдауна. Не входит в снимок. */
  private lastReact = new Map<string, number>();
  private react(id: string, reaction: string) {
    if (!(REACTIONS as readonly string[]).includes(reaction)) throw new RoomError('Неизвестная реакция');
    const now = this.now();
    if (now - (this.lastReact.get(id) ?? 0) < REACTION_COOLDOWN_MS) throw new RoomError('Не так часто');
    this.lastReact.set(id, now);
  }

  private start(id: string) {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new RoomError('Игра уже идёт');
    const players = this.members.filter(m => !m.left && m.online);
    if (players.length < 2) throw new RoomError('Нужно хотя бы 2 игрока');
    if (players.length > 6) throw new RoomError('Максимум 6 игроков');
    const noColor = players.find(p => p.color === null);
    if (noColor) throw new RoomError(`${noColor.name} ещё не выбрал цвет`);
    this.members = players; // зрители без места в партии не поддерживаются
    this.game = newGame({
      players: players.map(p => ({ id: p.id, name: p.name, color: p.color as PlayerColor })),
      targetScore: this.targetScore ?? undefined,
    });
    this.phase = 'game';
    this.refreshWaiting();
  }

  private move(id: string, move: Move) {
    if (this.phase !== 'game' || !this.game) throw new RoomError('Игра не идёт');
    const pi = this.game.players.findIndex(p => p.id === id);
    if (pi !== this.game.turn) throw new RoomError('Сейчас не ваш ход');
    const err = validatePath(this.game, move, pi);
    if (err) throw new RoomError(err);
    this.game = applyMove(this.game, move, id);
    this.refreshWaiting();
  }

  private nextRound(id: string) {
    this.requireHost(id);
    if (!this.game || this.game.phase !== 'roundEnd') throw new RoomError('Раунд ещё не закончен');
    this.game = startRound(this.game);
    this.refreshWaiting();
  }

  private again(id: string) {
    this.requireHost(id);
    if (!this.game || this.game.phase !== 'gameEnd') throw new RoomError('Партия ещё не закончена');
    const players = this.game.players.filter(p => !this.member(p.id)?.left);
    if (players.length < 2) { this.toLobby(id); return; }
    this.game = newGame({ players: players.map(p => ({ id: p.id, name: p.name, color: p.color })), targetScore: this.targetScore ?? undefined });
    this.refreshWaiting();
  }

  private toLobby(id: string) {
    this.requireHost(id);
    this.phase = 'lobby';
    this.game = null;
    this.waitingSince = null;
    this.members = this.members.filter(m => !m.left && m.online);
    this.ensureHost();
  }

  /** Хозяин пропускает ход отсутствующего: тот считается выбывшим из раунда. */
  private skip(id: string) {
    this.requireHost(id);
    if (!this.game || this.game.phase !== 'play') throw new RoomError('Сейчас нечего пропускать');
    const cur = this.game.players[this.game.turn];
    const m = this.member(cur.id);
    if (m && m.online && !m.left) throw new RoomError(`${cur.name} на связи — пусть ходит`);
    this.game = this.eliminateCurrent(this.game);
    this.refreshWaiting();
  }

  private leave(id: string) {
    const m = this.member(id)!;
    if (this.phase === 'lobby') { this.members = this.members.filter(x => x.id !== id); this.ensureHost(); return; }
    m.left = true;
    if (this.game && this.game.phase === 'play') {
      const pi = this.game.players.findIndex(p => p.id === id);
      if (pi >= 0 && this.game.players[pi].alive) {
        if (pi === this.game.turn) this.game = this.eliminateCurrent(this.game);
        else {
          const players = this.game.players.map((p, i) => (i === pi ? { ...p, alive: false, pos: null } : p));
          this.game = { ...this.game, players };
          // если остался один — закрываем раунд
          if (players.filter(p => p.alive).length <= 1) this.game = advanceTurn({ ...this.game, turn: this.game.turn });
        }
      }
    }
    this.ensureHost();
    // Меньше двух активных — партия сворачивается в лобби.
    if (this.active().length < 2) { this.phase = 'lobby'; this.game = null; this.waitingSince = null; this.members = this.members.filter(x => !x.left); }
    this.refreshWaiting();
  }

  private eliminateCurrent(g: GameState): GameState {
    const players = g.players.map((p, i) => (i === g.turn ? { ...p, alive: false, pos: null } : p));
    return advanceTurn({ ...g, players, eliminated: [g.players[g.turn].id] });
  }
}

export function randomCode(alphabet: string, len: number, rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

export { defaultTargetScore };
