import { describe, it, expect } from 'vitest';
import {
  newGame, applyMove, legalMoves, isLegal, continuations, targetCells, validatePath, defaultTargetScore, scoreRound, startRound, advanceTurn,
  isPerimeter, WHITE, CELLS, idx, type GameState, type Board, type Move,
} from '../shared/engine';

const seeded = (seed: number) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

const two = (rng = seeded(42)) => newGame({
  players: [{ id: 'a', name: 'Аня', color: 0 }, { id: 'b', name: 'Боря', color: 3 }],
  rng,
});

/** Собрать состояние с заданной доской и позициями. */
function custom(board: Board, players: { id: string; color: 0|1|2|3|4|5; pos: number | null; alive?: boolean; score?: number }[], turn = 0): GameState {
  return {
    phase: 'play', board, turn, round: 1, targetScore: 7, lastMove: null, eliminated: [], roundResult: null,
    players: players.map(p => ({ id: p.id, name: p.id, color: p.color, pos: p.pos, alive: p.alive ?? true, score: p.score ?? 0 })),
  };
}
const empty = (): Board => Array(CELLS).fill(null);

describe('подготовка', () => {
  it('49 шариков: по 7 каждого из 7 цветов, белые в том числе', () => {
    const g = two();
    const counts = new Map<number, number>();
    g.board.forEach(c => counts.set(c!, (counts.get(c!) ?? 0) + 1));
    expect([...counts.values()]).toEqual([7, 7, 7, 7, 7, 7, 7]);
    expect(counts.get(WHITE)).toBe(7);
  });
  it('белый нельзя выбрать цветом игрока (типы) и цвета уникальны', () => {
    expect(() => newGame({ players: [{ id: 'a', name: 'a', color: 0 }, { id: 'b', name: 'b', color: 0 }] })).toThrow();
  });
  it('порог очков зависит от числа игроков: 2 → 40, 3 → 20, 4+ → 15', () => {
    expect(two().targetScore).toBe(40);
    expect(defaultTargetScore(3)).toBe(20);
    expect(defaultTargetScore(4)).toBe(15);
    expect(defaultTargetScore(6)).toBe(15);
  });
});

describe('первый ход', () => {
  it('только внешнее кольцо и не свой цвет', () => {
    const g = two();
    const moves = legalMoves(g);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.type).toBe('step');
      expect(m.path).toHaveLength(1);
      expect(isPerimeter(m.path[0])).toBe(true);
      expect(g.board[m.path[0]]).not.toBe(g.players[0].color);
    }
    // в центр нельзя
    expect(isLegal(g, { type: 'step', path: [idx(3, 3)] })).toBe(false);
  });
  it('телепорт до первого хода недоступен', () => {
    expect(legalMoves(two()).some(m => m.type === 'teleport')).toBe(false);
  });
});

describe('шаг и цепочка', () => {
  it('шаг на соседа; цепочку можно продавить частично или целиком', () => {
    const b = empty();
    // стомпер на (3,3); справа линия жёлтых (2) на (3,4),(3,5),(3,6); белый на (2,3)
    b[idx(3, 4)] = 2; b[idx(3, 5)] = 2; b[idx(3, 6)] = 2; b[idx(2, 3)] = WHITE;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: null }]);
    const moves = legalMoves(s).filter(m => m.type === 'step');
    expect(moves).toContainEqual({ type: 'step', path: [idx(3, 4)] });
    expect(moves).toContainEqual({ type: 'step', path: [idx(3, 4), idx(3, 5), idx(3, 6)] });
    expect(moves).toContainEqual({ type: 'step', path: [idx(2, 3)] });
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(3, 5)] })).toBe(true);
    // продолжения считаются от текущего пути
    expect(continuations(s, { type: 'step', path: [idx(3, 4)] })).toEqual([idx(3, 5)]);
    expect(continuations(s, { type: 'step', path: [idx(3, 4), idx(3, 5), idx(3, 6)] })).toEqual([]);
    // пропустить шарик в линии нельзя
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(3, 6)] })).toBe(false);
  });
  it('цепочка может поворачивать по соседям одного цвета, но не прыгать через разрыв', () => {
    const b = empty();
    b[idx(3, 4)] = 2; b[idx(2, 5)] = 2; b[idx(1, 5)] = 2; b[idx(0, 0)] = 2;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: null }]);
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(2, 5)] })).toBe(true);
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(2, 5), idx(1, 5)] })).toBe(true);
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(1, 5)] })).toBe(false);
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(0, 0)] })).toBe(false);
    // дважды в одну лунку нельзя
    expect(isLegal(s, { type: 'step', path: [idx(3, 4), idx(2, 5), idx(3, 4)] })).toBe(false);
    // targetCells даёт кратчайший путь до лунки и фильтрует продолжения
    const t = targetCells(s, { type: 'step' });
    expect(t.get(idx(1, 5))?.path).toEqual([idx(3, 4), idx(2, 5), idx(1, 5)]);
    const t2 = targetCells(s, { partial: { type: 'step', path: [idx(3, 4)] } });
    expect([...t2.keys()].sort()).toEqual([idx(2, 5), idx(1, 5)].sort());
  });
  it('на пустую лунку и на чужой стомпер наступать нельзя', () => {
    const b = empty();
    b[idx(0, 0)] = 1; // единственный шарик, далеко
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: idx(3, 4) }]);
    expect(legalMoves(s).filter(m => m.type === 'step')).toHaveLength(0);
  });
  it('после хода шарики исчезают, стомпер в конце пути, ход переходит', () => {
    const b = empty();
    b[idx(3, 4)] = 2; b[idx(3, 5)] = 2; b[idx(0, 0)] = 1; b[idx(0, 1)] = 1;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: idx(1, 1) }]);
    const n = applyMove(s, { type: 'step', path: [idx(3, 4), idx(3, 5)] }, 'a');
    expect(n.board[idx(3, 4)]).toBeNull();
    expect(n.board[idx(3, 5)]).toBeNull();
    expect(n.players[0].pos).toBe(idx(3, 5));
    expect(n.turn).toBe(1);
    expect(n.lastMove?.playerId).toBe('a');
    expect(s.board[idx(3, 4)]).toBe(2); // исходник не тронут
  });
  it('чужой игрок ходить не может', () => {
    const g = two();
    const m = legalMoves(g)[0];
    expect(() => applyMove(g, m, 'b')).toThrow();
    expect(() => applyMove(g, m, 'a')).not.toThrow();
  });
});

describe('телепортация', () => {
  it('только на свой цвет; одиночный шарик — просто прыжок', () => {
    const b = empty();
    b[idx(0, 0)] = 0; b[idx(6, 6)] = 3; b[idx(5, 0)] = WHITE;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: null }]);
    const tele = legalMoves(s).filter(m => m.type === 'teleport');
    expect(tele).toEqual([{ type: 'teleport', path: [idx(0, 0)] }]);
  });
  it('на белый прыгать нельзя', () => {
    const b = empty();
    b[idx(0, 0)] = WHITE;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: null }]);
    expect(legalMoves(s).filter(m => m.type === 'teleport')).toHaveLength(0);
  });
  it('с шарика в своей цепочке можно продолжить по линии в любую сторону', () => {
    const b = empty();
    b[idx(0, 0)] = 0; b[idx(0, 1)] = 0; b[idx(0, 2)] = 0;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(3, 3) }, { id: 'b', color: 3, pos: null }]);
    const tele = legalMoves(s).filter(m => m.type === 'teleport');
    expect(tele).toContainEqual({ type: 'teleport', path: [idx(0, 0), idx(0, 1), idx(0, 2)] });
    expect(tele).toContainEqual({ type: 'teleport', path: [idx(0, 2), idx(0, 1), idx(0, 0)] });
    // из середины — в обе стороны, но по одному направлению за ход
    expect(tele).toContainEqual({ type: 'teleport', path: [idx(0, 1), idx(0, 2)] });
    expect(tele).toContainEqual({ type: 'teleport', path: [idx(0, 1), idx(0, 0)] });
    expect(isLegal(s, { type: 'teleport', path: [idx(0, 0)] })).toBe(true);
    expect(continuations(s, { type: 'teleport', path: [idx(0, 1)] }).sort()).toEqual([idx(0, 0), idx(0, 2)].sort());
  });
});

describe('выбывание и конец раунда', () => {
  it('игрок без ходов выбывает, ход идёт дальше', () => {
    const b = empty();
    b[idx(0, 0)] = 1; b[idx(0, 1)] = 1; // рядом с a (на (1,1)), далеко от b и c
    const s = custom(b, [
      { id: 'a', color: 0, pos: idx(1, 1) },
      { id: 'b', color: 3, pos: idx(6, 6) },
      { id: 'c', color: 4, pos: idx(1, 2) },
    ]);
    const n = applyMove(s, { type: 'step', path: [idx(0, 0)] });
    expect(n.eliminated).toEqual(['b']);
    expect(n.players[1].alive).toBe(false);
    expect(n.turn).toBe(2);
    expect(n.phase).toBe('play');
  });
  it('когда остался один — раунд окончен, очки: 3 + белые + свои', () => {
    const b = empty();
    b[idx(0, 0)] = 1; b[idx(5, 5)] = WHITE; b[idx(6, 0)] = WHITE; b[idx(6, 1)] = 0; // свой цвет a
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(1, 1) }, { id: 'b', color: 3, pos: idx(3, 3) }]);
    const n = applyMove(s, { type: 'step', path: [idx(0, 0)] });
    expect(n.phase).toBe('roundEnd');
    expect(n.roundResult).toEqual({ winnerId: 'a', base: 3, whites: 2, own: 1, total: 6 });
    expect(n.players[0].score).toBe(6);
    expect(n.players[1].score).toBe(0);
  });
  it('игра идёт до порога: ниже порога → roundEnd, достиг или превысил → gameEnd', () => {
    const b = empty();
    b[idx(0, 0)] = 1;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(1, 1) }, { id: 'b', color: 3, pos: idx(3, 3) }]);
    const r1 = applyMove(s, { type: 'step', path: [idx(0, 0)] });
    expect(r1.phase).toBe('roundEnd');
    const r2 = startRound(r1, seeded(7));
    expect(r2.round).toBe(2);
    expect(r2.turn).toBe(1); // второй раунд начинает второй игрок
    expect(r2.board.filter(c => c !== null)).toHaveLength(CELLS);
    expect(r2.players.every(p => p.alive && p.pos === null)).toBe(true);
    expect(r2.players[0].score).toBe(3); // очки сохраняются между раундами
    // порог 7: у a уже 4, победа в раунде даёт ещё 3 → 7 → gameEnd
    const bb = empty(); bb[idx(0, 0)] = 1;
    const last = { ...custom(bb, [{ id: 'a', color: 0, pos: idx(1, 1), score: 4 }, { id: 'b', color: 3, pos: idx(3, 3) }]), round: 2 };
    expect(applyMove(last, { type: 'step', path: [idx(0, 0)] }).phase).toBe('gameEnd');
    // превышение тоже завершает: 5 + 3 = 8 ≥ 7
    const over = { ...custom(bb, [{ id: 'a', color: 0, pos: idx(1, 1), score: 5 }, { id: 'b', color: 3, pos: idx(3, 3) }]), round: 2 };
    expect(applyMove(over, { type: 'step', path: [idx(0, 0)] }).phase).toBe('gameEnd');
  });
  it('ходить после конца раунда нельзя', () => {
    const b = empty(); b[idx(0, 0)] = 1;
    const s = custom(b, [{ id: 'a', color: 0, pos: idx(1, 1) }, { id: 'b', color: 3, pos: idx(3, 3) }]);
    const n = applyMove(s, { type: 'step', path: [idx(0, 0)] });
    expect(() => applyMove(n, { type: 'step', path: [idx(0, 1)] })).toThrow();
  });
});

describe('быстрые проверки согласованы с перебором', () => {
  it('isLegal/targetCells/continuations совпадают с legalMoves на случайных позициях', () => {
    const rng = seeded(99);
    for (let t = 0; t < 40; t++) {
      let g = newGame({ players: [0, 1, 2].map(c => ({ id: 'p' + c, name: 'P' + c, color: c as 0 })), rng });
      for (let k = 0; k < 6 && g.phase === 'play'; k++) {
        const moves = legalMoves(g);
        for (const m of moves) expect(isLegal(g, m)).toBe(true);
        const tc = targetCells(g);
        const ends = new Set(moves.map(m => m.path[m.path.length - 1]));
        expect(new Set(tc.keys())).toEqual(ends);
        for (const [cell, m] of tc) {
          expect(m.path[m.path.length - 1]).toBe(cell);
          const shortest = Math.min(...moves.filter(x => x.path[x.path.length - 1] === cell).map(x => x.path.length));
          expect(m.path.length).toBe(shortest);
        }
        const m0 = moves[Math.floor(rng() * moves.length)];
        const cont = continuations(g, m0);
        const viaEnum = new Set(moves.filter(x => x.type === m0.type && x.path.length === m0.path.length + 1 && m0.path.every((v, i) => v === x.path[i])).map(x => x.path[m0.path.length]));
        expect(new Set(cont)).toEqual(viaEnum);
        g = applyMove(g, m0);
      }
    }
  });
  it('validatePath объясняет отказ', () => {
    const g = two();
    expect(validatePath(g, { type: 'step', path: [idx(3, 3)] })).toMatch(/с края/);
    expect(validatePath(g, { type: 'teleport', path: [0] })).toBeTruthy();
  });
});

describe('случайная партия', () => {
  it('6 игроков, случайные ходы — всегда доигрывается до конца без ошибок', () => {
    const rng = seeded(2024);
    let g = newGame({
      players: [0, 1, 2, 3, 4, 5].map(c => ({ id: 'p' + c, name: 'P' + c, color: c as 0 })),
      rng,
    });
    let guard = 0;
    while (g.phase !== 'gameEnd' && guard++ < 5000) {
      if (g.phase === 'roundEnd') { g = startRound(g, rng); continue; }
      const moves = legalMoves(g);
      expect(moves.length).toBeGreaterThan(0);
      g = applyMove(g, moves[Math.floor(rng() * moves.length)]);
    }
    expect(g.phase).toBe('gameEnd');
    expect(Math.max(...g.players.map(p => p.score))).toBeGreaterThanOrEqual(15);
    expect(g.players.filter(p => p.score >= 15)).toHaveLength(1);
  });
});
