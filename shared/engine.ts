/**
 * Stomple — движок правил.
 *
 * Чистые функции без DOM, таймеров и случайности (кроме shuffleBoard,
 * куда можно передать свой RNG). Один и тот же код работает на клиенте
 * (подсветка ходов, анимации) и на сервере (валидация).
 *
 * Поле: 7×7, индексы 0..48, idx = row*7 + col.
 * Цвета: 0..5 — игровые (красный, оранжевый, жёлтый, зелёный, фиолетовый, чёрный),
 *        6 — белый, нейтральный. Белый никогда не является цветом игрока.
 */

export const SIZE = 7;
export const CELLS = SIZE * SIZE;
export const WHITE = 6;
export const PLAYER_COLORS = [0, 1, 2, 3, 4, 5] as const;
export const COLOR_NAMES = ['Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Фиолетовый', 'Чёрный', 'Белый'];

export type Color = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PlayerColor = 0 | 1 | 2 | 3 | 4 | 5;

/** Ячейка: цвет шарика или null, если лунка пуста. */
export type Board = (Color | null)[];

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  score: number;
  /** Жив ли в текущем раунде. */
  alive: boolean;
  /** Позиция стомпера; null — ещё не сделал первый ход. */
  pos: number | null;
}

export type Phase = 'play' | 'roundEnd' | 'gameEnd';

export interface Move {
  /** step — шаг/цепочка от текущей позиции; teleport — прыжок на свой шарик. */
  type: 'step' | 'teleport';
  /** Продавленные лунки по порядку. Последняя — где останется стомпер. */
  path: number[];
}

export interface RoundResult {
  winnerId: string;
  base: number;
  whites: number;
  own: number;
  total: number;
}

export interface GameState {
  phase: Phase;
  board: Board;
  players: Player[];
  /** Индекс игрока в players, чей сейчас ход. */
  turn: number;
  round: number;
  /** Сколько очков нужно набрать (или превысить), чтобы выиграть игру. */
  targetScore: number;
  /** Последний применённый ход — для анимации на клиенте. */
  lastMove: (Move & { playerId: string }) | null;
  /** Игроки, выбывшие при последнем продвижении хода (для тостов). */
  eliminated: string[];
  roundResult: RoundResult | null;
}

// ───────────────────────── геометрия ─────────────────────────

export const row = (i: number) => Math.floor(i / SIZE);
export const col = (i: number) => i % SIZE;
export const idx = (r: number, c: number) => r * SIZE + c;
export const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export const isPerimeter = (i: number) => {
  const r = row(i), c = col(i);
  return r === 0 || r === SIZE - 1 || c === 0 || c === SIZE - 1;
};

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function neighbors(i: number): number[] {
  const r = row(i), c = col(i), out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) out.push(idx(nr, nc));
  }
  return out;
}

// ───────────────────────── легальные ходы ─────────────────────────
//
// Быстрые проверки (O(длины пути)) — для клиента и сервера.
// Полный перебор legalMoves нужен только для тестов и ботов.

/** Лунки, на которые игрок может встать ПЕРВЫМ шагом хода данного типа. */
export function startCells(state: GameState, playerIdx: number, type: Move['type']): number[] {
  const p = state.players[playerIdx];
  if (!p || !p.alive || state.phase !== 'play') return [];
  const { board } = state;
  if (p.pos === null) {
    if (type !== 'step') return [];
    const out: number[] = [];
    for (let i = 0; i < CELLS; i++) if (board[i] !== null && isPerimeter(i) && board[i] !== p.color) out.push(i);
    return out;
  }
  if (type === 'step') return neighbors(p.pos).filter(n => board[n] !== null);
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === p.color) out.push(i);
  return out;
}

/**
 * Проверка пути: первый шаг допустим, каждый следующий — соседний шарик
 * того же цвета, лунки не повторяются.
 */
export function validatePath(state: GameState, move: Move, playerIdx: number = state.turn): string | null {
  const p = state.players[playerIdx];
  if (!p) return 'Нет игрока';
  if (!p.alive) return 'Игрок выбыл';
  if (state.phase !== 'play') return 'Раунд не идёт';
  if (!move.path.length) return 'Пустой ход';
  const { board } = state;
  if (!startCells(state, playerIdx, move.type).includes(move.path[0])) {
    if (p.pos === null) return 'Первый ход — любой шарик с края, кроме своего цвета';
    if (move.type === 'teleport') return 'Прыжок только на шарик своего цвета';
    return 'Можно наступить только на соседний шарик';
  }
  if (p.pos === null && move.path.length > 1) return 'Первый ход — только один шарик';
  const color = board[move.path[0]];
  const used = new Set<number>([move.path[0]]);
  for (let k = 1; k < move.path.length; k++) {
    const prev = move.path[k - 1], cur = move.path[k];
    if (used.has(cur)) return 'Дважды в одну лунку нельзя';
    if (!neighbors(prev).includes(cur)) return 'Цепочка идёт только по соседним шарикам';
    if (board[cur] !== color) return 'Цепочка идёт только по шарикам одного цвета';
    used.add(cur);
  }
  return null;
}

export function isLegal(state: GameState, move: Move, playerIdx: number = state.turn): boolean {
  return validatePath(state, move, playerIdx) === null;
}

/** Продолжения начатой цепочки: соседние шарики того же цвета, ещё не продавленные. */
export function continuations(state: GameState, partial: Move): number[] {
  const { board } = state;
  if (state.players[state.turn]?.pos === null) return [];
  const last = partial.path[partial.path.length - 1];
  const color = board[partial.path[0]];
  if (color === null || color === undefined) return [];
  const used = new Set(partial.path);
  return neighbors(last).filter(n => board[n] === color && !used.has(n));
}

/**
 * Цели для тапа: лунка → кратчайший ход (BFS), который на ней заканчивается.
 * С `partial` (начатая цепочка) — только её продолжения, включая дальние.
 */
export function targetCells(state: GameState, opts: { type?: Move['type']; partial?: Move } = {}): Map<number, Move> {
  const map = new Map<number, Move>();
  const { board } = state;
  const bfs = (type: Move['type'], seedPath: number[]) => {
    const color = board[seedPath[0]];
    const queue: number[][] = [seedPath];
    const seen = new Set<number>(seedPath);
    while (queue.length) {
      const path = queue.shift()!;
      const last = path[path.length - 1];
      if (path.length > seedPath.length || !opts.partial) {
        const prev = map.get(last);
        if (!prev || path.length < prev.path.length) map.set(last, { type, path });
      }
      for (const n of neighbors(last)) {
        if (board[n] === color && !seen.has(n)) { seen.add(n); queue.push([...path, n]); }
      }
    }
  };
  if (opts.partial) { bfs(opts.partial.type, opts.partial.path); return map; }
  const types: Move['type'][] = opts.type ? [opts.type] : ['step', 'teleport'];
  const first = state.players[state.turn]?.pos === null;
  for (const type of types) for (const s of startCells(state, state.turn, type)) {
    if (first) { map.set(s, { type, path: [s] }); continue; }
    const color = board[s];
    const queue: number[][] = [[s]]; const seen = new Set<number>([s]);
    while (queue.length) {
      const path = queue.shift()!; const last = path[path.length - 1];
      const prev = map.get(last);
      if (!prev || path.length < prev.path.length) map.set(last, { type, path });
      for (const n of neighbors(last)) if (board[n] === color && !seen.has(n)) { seen.add(n); queue.push([...path, n]); }
    }
  }
  return map;
}

export function canMove(state: GameState, playerIdx: number): boolean {
  const s = { ...state, phase: 'play' as Phase };
  return startCells(s, playerIdx, 'step').length > 0 || startCells(s, playerIdx, 'teleport').length > 0;
}

/**
 * Все простые пути по шарикам одного цвета от `start` (для тестов/ботов).
 */
export function chainPaths(board: Board, start: number): number[][] {
  const color = board[start];
  if (color === null || color === undefined) return [];
  const out: number[][] = [];
  const walk = (path: number[], used: Set<number>) => {
    out.push(path);
    for (const n of neighbors(path[path.length - 1])) {
      if (board[n] === color && !used.has(n)) { used.add(n); walk([...path, n], used); used.delete(n); }
    }
  };
  walk([start], new Set([start]));
  return out;
}

/** Полный перебор легальных ходов (медленно на больших кластерах — для тестов). */
export function legalMoves(state: GameState, playerIdx: number = state.turn): Move[] {
  const moves: Move[] = [];
  for (const type of ['step', 'teleport'] as const) {
    for (const s of startCells(state, playerIdx, type)) {
      if (state.players[playerIdx].pos === null) { moves.push({ type, path: [s] }); continue; }
      for (const path of chainPaths(state.board, s)) moves.push({ type, path });
    }
  }
  return moves;
}

export const sameMove = (a: Move, b: Move) =>
  a.type === b.type && a.path.length === b.path.length && a.path.every((v, i) => v === b.path[i]);

// ───────────────────────── подсчёт ─────────────────────────

export function scoreRound(board: Board, winner: Player): RoundResult {
  const whites = board.filter(b => b === WHITE).length;
  const own = board.filter(b => b === winner.color).length;
  return { winnerId: winner.id, base: 3, whites, own, total: 3 + whites + own };
}

// ───────────────────────── состояние ─────────────────────────

export type Rng = () => number;

export function shuffleBoard(rng: Rng = Math.random): Board {
  const arr: Color[] = [];
  for (let c = 0; c < 7; c++) for (let k = 0; k < 7; k++) arr.push(c as Color);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Порог очков по числу игроков: 2 — 40, 3 — 20, 4 и больше — 15. */
export function defaultTargetScore(numPlayers: number): number {
  if (numPlayers <= 2) return 40;
  if (numPlayers === 3) return 20;
  return 15;
}

export interface NewGameOptions {
  players: { id: string; name: string; color: PlayerColor }[];
  /** Порог очков; по умолчанию defaultTargetScore(число игроков). */
  targetScore?: number;
  rng?: Rng;
}

export function newGame(opts: NewGameOptions): GameState {
  const colors = new Set(opts.players.map(p => p.color));
  if (colors.size !== opts.players.length) throw new Error('Цвета игроков должны быть уникальны');
  if (opts.players.length < 2 || opts.players.length > 6) throw new Error('Игроков должно быть от 2 до 6');
  const players: Player[] = opts.players.map(p => ({ ...p, score: 0, alive: true, pos: null }));
  const base: GameState = {
    phase: 'play',
    board: [],
    players,
    turn: 0,
    round: 0,
    targetScore: opts.targetScore ?? defaultTargetScore(players.length),
    lastMove: null,
    eliminated: [],
    roundResult: null,
  };
  return startRound(base, opts.rng);
}

/** Начать следующий раунд (после roundEnd) или первый (round = 0). */
export function startRound(state: GameState, rng: Rng = Math.random): GameState {
  const round = state.round + 1;
  const players = state.players.map(p => ({ ...p, alive: true, pos: null }));
  const next: GameState = {
    ...state,
    phase: 'play',
    board: shuffleBoard(rng),
    players,
    round,
    turn: (round - 1) % players.length,
    lastMove: null,
    eliminated: [],
    roundResult: null,
  };
  // На всякий случай: если первому ходить нечем — продвигаем.
  return canMove(next, next.turn) ? next : advanceTurn(next);
}

/**
 * Применить ход текущего игрока. Бросает ошибку, если ход нелегален.
 * Возвращает новое состояние (вход не мутируется).
 */
export function applyMove(state: GameState, move: Move, playerId?: string): GameState {
  if (state.phase !== 'play') throw new Error('Раунд не идёт');
  const p = state.players[state.turn];
  if (playerId !== undefined && p.id !== playerId) throw new Error('Сейчас не ваш ход');
  const err = validatePath(state, move);
  if (err) throw new Error(err);

  const board = state.board.slice();
  for (const cell of move.path) board[cell] = null;
  const last = move.path[move.path.length - 1];
  const players = state.players.map((q, i) => (i === state.turn ? { ...q, pos: last } : q));

  return advanceTurn({
    ...state,
    board,
    players,
    lastMove: { ...move, playerId: p.id },
    eliminated: [],
  });
}

/**
 * Передать ход следующему живому игроку. Те, кому ходить нечем,
 * выбывают. Если остался один — раунд окончен и очки начислены.
 */
export function advanceTurn(state: GameState): GameState {
  let players = state.players.map(p => ({ ...p }));
  const eliminated: string[] = [...state.eliminated];
  const n = players.length;
  let i = state.turn;

  for (let tries = 0; tries < n; tries++) {
    i = (i + 1) % n;
    const p = players[i];
    if (!p.alive) continue;
    const alive = players.filter(q => q.alive);
    if (alive.length <= 1) break;
    if (canMove({ ...state, players }, i)) {
      return { ...state, players, turn: i, eliminated };
    }
    players[i] = { ...p, alive: false, pos: null };
    eliminated.push(p.id);
  }

  // Сюда попадаем, когда жив ≤ 1 игрок.
  const survivors = players.filter(p => p.alive);
  const winner = survivors[0] ?? players[state.turn];
  const result = scoreRound(state.board, winner);
  players = players.map(p => (p.id === winner.id ? { ...p, score: p.score + result.total } : p));
  const reached = players.some(p => p.score >= state.targetScore);
  return {
    ...state,
    players,
    eliminated,
    roundResult: result,
    phase: reached ? 'gameEnd' : 'roundEnd',
  };
}

/** Таблица результатов, отсортированная по убыванию очков. */
export function standings(state: GameState): Player[] {
  return state.players.slice().sort((a, b) => b.score - a.score);
}
