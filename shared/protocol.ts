/**
 * Протокол обмена клиент ↔ комната. Общий для обеих сторон.
 */
import type { GameState, Move, PlayerColor } from './engine';

export const CODE_LENGTH = 4;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // без I и O — путаются с 1 и 0

/** Участник комнаты (в лобби и в игре). */
export interface Member {
  id: string;        // стабильный токен игрока, хранится в localStorage
  name: string;
  color: PlayerColor | null;
  online: boolean;
  host: boolean;
  /** Нажал «Выйти»: больше не участвует, но очки сохранены в GameState. */
  left: boolean;
  /** Микрофон включён (участвует в голосовом чате). */
  voice: boolean;
}

/** Стикеры-реакции: id → файл в /reactions/. */
export const REACTIONS = ['love', 'cool', 'devil', 'angel', 'shock', 'side-eye', 'sweat', 'cry', 'frozen'] as const;
export type ReactionId = typeof REACTIONS[number];
export const REACTION_COOLDOWN_MS = 1200;

export type RoomPhase = 'lobby' | 'game';

/** Состояние общего плеера — задаёт хозяин, слушают все. */
export interface MusicState {
  track: number;
  playing: boolean;
  /** Позиция (сек) в момент `at` (серверное время, ms). */
  position: number;
  at: number;
}

/** Снимок комнаты, который получают все клиенты. */
export interface RoomSnapshot {
  music: MusicState | null;
  code: string;
  phase: RoomPhase;
  members: Member[];
  targetScore: number | null;   // null — автоматически по числу игроков
  game: GameState | null;
  /** С какого момента (ms) ждём отсутствующего игрока, чей сейчас ход. */
  waitingSince: number | null;
}

// ───────── клиент → сервер ─────────
export type ClientMsg =
  | { t: 'join'; id: string; name: string }
  | { t: 'name'; name: string }
  | { t: 'color'; color: PlayerColor | null }
  | { t: 'target'; targetScore: number | null }  // хозяин
  | { t: 'start' }                               // хозяин
  | { t: 'move'; move: Move }
  | { t: 'nextRound' }                           // хозяин
  | { t: 'again' }                               // хозяин: ещё партию
  | { t: 'toLobby' }                             // хозяин
  | { t: 'skip' }                                // хозяин: пропустить ход отсутствующего
  | { t: 'leave' }                               // выйти из игры
  | { t: 'react'; id: ReactionId }               // стикер всем (не хранится)
  | { t: 'voice'; on: boolean }                  // микрофон вкл/выкл
  | { t: 'rtc'; to: string; data: unknown }      // WebRTC-сигналинг конкретному игроку
  | { t: 'music'; track: number; playing: boolean; position: number }; // хозяин: плеер

// ───────── сервер → клиент ─────────
export type ServerMsg =
  | { t: 'state'; room: RoomSnapshot }
  | { t: 'error'; message: string }
  | { t: 'toast'; message: string }
  | { t: 'reaction'; from: string; id: ReactionId; at: number }
  | { t: 'rtc'; from: string; data: unknown };

export const SKIP_AFTER_MS = 90_000;
