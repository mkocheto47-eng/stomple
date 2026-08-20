// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
afterEach(cleanup);
import GameScreen from '../src/GameScreen';
import { newGame, applyMove, startCells, type GameState } from '../shared/engine';

vi.useFakeTimers();
const seeded = (seed: number) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

describe('GameScreen', () => {
  it('хот-сит: после заставки тап по краевому шарику отправляет ход и анимирует его', async () => {
    let game: GameState = newGame({ players: [{ id: 'a', name: 'A', color: 0 }, { id: 'b', name: 'B', color: 3 }], rng: seeded(5) });
    const onMove = vi.fn((m) => { game = applyMove(game, m); rerender(ui()); });
    const ui = () => <GameScreen game={game} me={null} isHost sfx={() => {}} onMove={onMove} onNextRound={() => {}} onAgain={() => {}} onToLobby={() => {}} />;
    const { rerender, getAllByRole, getByText } = render(ui());
    expect(getByText('Раунд 1')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1500); });
    const cell = startCells(game, game.turn, 'step')[0];
    const cells = getAllByRole('button', { name: /Лунка/ });
    await act(async () => { fireEvent.click(cells[cell]); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].path).toEqual([cell]);
    expect(game.players[0].pos).toBe(cell);
    // чужой (не текущий) игрок онлайн не может ходить
  });
  it('онлайн: не мой ход — тап даёт подсказку, onMove не зовётся', async () => {
    const game = newGame({ players: [{ id: 'a', name: 'Аня', color: 0 }, { id: 'b', name: 'B', color: 3 }], rng: seeded(5) });
    const onMove = vi.fn();
    const { getAllByRole, getByText } = render(<GameScreen game={game} me="b" isHost={false} sfx={() => {}} onMove={onMove} onNextRound={() => {}} onAgain={() => {}} onToLobby={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    const cell = startCells(game, game.turn, 'step')[0];
    await act(async () => { fireEvent.click(getAllByRole('button', { name: /Лунка/ })[cell]); });
    expect(onMove).not.toHaveBeenCalled();
    expect(getByText('Сейчас ходит Аня')).toBeTruthy();
  });
});
