import { describe, it, expect } from 'vitest';
import { Room, RoomError } from '../shared/room';
import { targetCells } from '../shared/engine';

function lobby3() {
  const r = new Room('ABCD', () => 1000);
  r.connect('a', 'Аня'); r.connect('b', 'Боря'); r.connect('c', 'Вера');
  r.handle('a', { t: 'color', color: 0 }); r.handle('b', { t: 'color', color: 3 }); r.handle('c', { t: 'color', color: 5 });
  return r;
}
const play = (r: Room, id: string) => {
  const g = r.game!;
  const m = [...targetCells(g).values()][0];
  r.handle(id, { t: 'move', move: m });
};

describe('лобби', () => {
  it('первый вошедший — хозяин; при его уходе хозяин переходит дальше', () => {
    const r = lobby3();
    expect(r.host()?.id).toBe('a');
    r.disconnect('a');
    expect(r.members.map(m => m.id)).toEqual(['b', 'c']);
    expect(r.host()?.id).toBe('b');
  });
  it('цвет нельзя взять занятый; стартовать может только хозяин и только с цветами', () => {
    const r = lobby3();
    expect(() => r.handle('b', { t: 'color', color: 0 })).toThrow(RoomError);
    expect(() => r.handle('b', { t: 'start' })).toThrow(/хозяин/);
    r.handle('c', { t: 'color', color: null });
    expect(() => r.handle('a', { t: 'start' })).toThrow(/не выбрал цвет/);
    r.handle('c', { t: 'color', color: 5 });
    r.handle('a', { t: 'start' });
    expect(r.phase).toBe('game');
    expect(r.game?.targetScore).toBe(20);
  });
  it('хозяин может задать порог; седьмой не войдёт; в идущую игру новые не входят', () => {
    const r = lobby3();
    r.handle('a', { t: 'target', targetScore: 10 });
    r.handle('a', { t: 'start' });
    expect(r.game?.targetScore).toBe(10);
    expect(() => r.connect('z', 'Зина')).toThrow(/уже идёт/);
  });
});

describe('игра', () => {
  it('ход принимается только от того, чья очередь, и только легальный', () => {
    const r = lobby3(); r.handle('a', { t: 'start' });
    const cur = r.game!.players[r.game!.turn].id;
    const other = r.game!.players.find(p => p.id !== cur)!.id;
    expect(() => play(r, other)).toThrow(/не ваш ход/);
    expect(() => r.handle(cur, { t: 'move', move: { type: 'step', path: [24] } })).toThrow();
    play(r, cur);
    expect(r.game!.turn).not.toBe(r.game!.players.findIndex(p => p.id === cur));
  });
  it('обрыв связи игрока, чей ход — включается ожидание; хозяин может пропустить', () => {
    let t = 1000;
    const r = new Room('ABCD', () => t);
    r.connect('a', 'A'); r.connect('b', 'B');
    r.handle('a', { t: 'color', color: 0 }); r.handle('b', { t: 'color', color: 1 });
    r.handle('a', { t: 'start' });
    const cur = r.game!.players[r.game!.turn].id;
    const other = cur === 'a' ? 'b' : 'a';
    expect(() => r.handle(r.host()!.id, { t: 'skip' })).toThrow(/на связи/);
    r.disconnect(cur);
    expect(r.waitingSince).toBe(1000);
    // хозяин — тот, кто на связи
    expect(r.host()?.id).toBe(other);
    t = 5000;
    r.handle(other, { t: 'skip' });
    // в игре на двоих пропуск = раунд окончен
    expect(r.game!.phase).toBe('roundEnd');
    expect(r.waitingSince).toBeNull();
    // вернулся — на своём месте, с тем же цветом
    r.connect(cur, '');
    expect(r.member(cur)?.online).toBe(true);
    expect(r.game!.players.find(p => p.id === cur)?.color).toBeDefined();
  });
  it('выход из игры: выбывает из раунда, очки замораживаются, порог не меняется', () => {
    const r = lobby3(); r.handle('a', { t: 'start' });
    const g0 = r.game!;
    const cur = g0.players[g0.turn].id;
    const leaver = g0.players.find(p => p.id !== cur)!.id;
    r.handle(leaver, { t: 'leave' });
    expect(r.member(leaver)?.left).toBe(true);
    expect(r.game!.players.find(p => p.id === leaver)?.alive).toBe(false);
    expect(r.game!.targetScore).toBe(20);
    expect(r.phase).toBe('game');
    // ещё один вышел — осталось меньше двух, возвращаемся в лобби
    const another = g0.players.find(p => p.id !== leaver && p.id !== cur)!.id;
    r.handle(another, { t: 'leave' });
    expect(r.phase).toBe('lobby');
    expect(r.members.map(m => m.id)).toEqual([cur]);
  });
  it('nextRound / again / toLobby — только хозяин и только в нужной фазе', () => {
    const r = lobby3(); r.handle('a', { t: 'start' });
    expect(() => r.handle('a', { t: 'nextRound' })).toThrow(/не закончен/);
    expect(() => r.handle('a', { t: 'again' })).toThrow(/не закончена/);
    r.handle('a', { t: 'toLobby' });
    expect(r.phase).toBe('lobby');
    expect(r.members.every(m => m.color !== null)).toBe(true); // цвета сохраняются
  });
  it('снимок восстанавливается без потерь', () => {
    const r = lobby3(); r.handle('a', { t: 'start' });
    const r2 = Room.fromSnapshot(JSON.parse(JSON.stringify(r.snapshot())));
    expect(r2.snapshot()).toEqual(r.snapshot());
  });
});
