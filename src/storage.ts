/** Стабильный идентификатор игрока и имя — чтобы возвращаться в комнату на своё место. */
export function playerId(): string {
  let id = localStorage.getItem('stomple.id');
  if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('stomple.id', id); }
  return id;
}
export const getName = () => localStorage.getItem('stomple.name') ?? '';
export const setName = (n: string) => localStorage.setItem('stomple.name', n);
export const getPref = (k: string, d: boolean) => { const v = localStorage.getItem('stomple.' + k); return v === null ? d : v === '1'; };
export const setPref = (k: string, v: boolean) => localStorage.setItem('stomple.' + k, v ? '1' : '0');
