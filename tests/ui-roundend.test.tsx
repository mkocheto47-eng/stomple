// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import GameScreen from '../src/GameScreen';
import { applyMove, idx, type GameState, type Board, CELLS } from '../shared/engine';
afterEach(cleanup);
vi.useFakeTimers();

describe('конец раунда', () => {
  it('после анимации последнего хода показывается экран итогов с очками и кнопкой хозяина', async () => {
    const b: Board = Array(CELLS).fill(null); b[idx(0, 0)] = 1; b[idx(5, 5)] = 6; b[idx(6, 1)] = 0;
    let g: GameState = { phase: 'play', board: b, turn: 0, round: 1, targetScore: 40, lastMove: null, eliminated: [], roundResult: null,
      players: [{ id: 'a', name: 'Аня', color: 0, pos: idx(1, 1), alive: true, score: 0 }, { id: 'b', name: 'Боря', color: 3, pos: idx(3, 3), alive: true, score: 0 }] };
    const ui = () => <GameScreen game={g} me="a" isHost sfx={() => {}} onMove={() => {}} onNextRound={() => {}} onAgain={() => {}} onToLobby={() => {}} />;
    const { rerender, queryByText, getByText } = render(ui());
    await act(async () => { vi.advanceTimersByTime(1500); });
    g = applyMove(g, { type: 'step', path: [idx(0, 0)] });
    expect(g.phase).toBe('roundEnd');
    rerender(ui());
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(queryByText(/Раунд 1 окончен/)).toBeTruthy();
    expect(getByText(/\+5 очков/)).toBeTruthy(); // 3 + 1 белый + 1 свой
    expect(getByText('Следующий раунд')).toBeTruthy();
  });
});
