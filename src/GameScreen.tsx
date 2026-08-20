import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  continuations, targetCells, validatePath, startCells, row, col,
  type GameState, type Move,
} from '../shared/engine';
import { COLORS, UNB, card, ballBg, Logo, Toast, btnPrimary, btnSoft } from './theme';
import type { Sfx } from './audio';
import { REACTIONS, type ReactionId } from '../shared/protocol';
import type { VoicePeer } from './voice';

export interface ReactionEvent { key: number; from: string; id: ReactionId }
export interface Social {
  reactions: ReactionEvent[];
  onReact: (id: ReactionId) => void;
  voice: { on: boolean; toggle: () => void; peers: Record<string, VoicePeer>; mySpeaking: boolean; error: string | null; members: Record<string, boolean> };
}

export interface GameScreenProps {
  game: GameState;
  /** id игрока на этом устройстве; null — хот-сит, ходят все по очереди */
  me: string | null;
  isHost: boolean;
  onMove: (move: Move) => void;
  onNextRound: () => void;
  onAgain: () => void;
  onToLobby: () => void;
  sfx: (k: Sfx) => void;
  /** Доп. состояние участников (онлайн): не в сети / вышел */
  presence?: Record<string, { online: boolean; left: boolean }>;
  waitingSince?: number | null;
  onSkip?: () => void;
  onLeave?: () => void;
  headerRight?: React.ReactNode;
  /** Ошибка от сервера — показать тостом */
  externalToast?: { id: number; text: string } | null;
  /** Реакции и голос (только онлайн) */
  social?: Social;
}

const moveKey = (g: GameState) => g.lastMove ? `${g.round}:${g.lastMove.playerId}:${g.lastMove.path.join(',')}` : `${g.round}:-`;

export default function GameScreen(p: GameScreenProps) {
  const { game, me, sfx } = p;
  const [view, setView] = useState<GameState>(game);
  const [falling, setFalling] = useState<Set<number>>(new Set());
  const [hopping, setHopping] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [teleMode, setTeleMode] = useState(false);
  const [pending, setPending] = useState<Move | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [turnKey, setTurnKey] = useState(0);
  const [picker, setPicker] = useState(false);
  const [confetti, setConfetti] = useState<{ left: number; hex: string; dur: string; delay: string }[]>([]);
  const toastT = useRef<number>(0);
  const animatedKey = useRef<string>('');
  const localPrefix = useRef<number[]>([]); // лунки, уже утопленные локально (начатая цепочка)
  const roundRef = useRef<number>(0);

  const showToast = useCallback((msg: string, ms = 1500) => { setToast(msg); clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(null), ms); }, []);
  useEffect(() => { if (p.externalToast) { showToast(p.externalToast.text, 1800); sfx('error'); } }, [p.externalToast]); // eslint-disable-line
  useEffect(() => { if (p.social?.voice.error) showToast(p.social.voice.error, 2500); }, [p.social?.voice.error]); // eslint-disable-line

  /* Утопить лунки по одной */
  const animatePath = useCallback((cells: number[], playerIdx: number, firstIsPlop: boolean, done: () => void) => {
    if (!cells.length) { done(); return; }
    const step = (k: number) => {
      const cell = cells[k];
      setFalling(s => new Set(s).add(cell)); setHopping(playerIdx);
      setView(v => ({ ...v, players: v.players.map((q, i) => i === playerIdx ? { ...q, pos: cell } : q) }));
      window.setTimeout(() => {
        sfx(k === 0 && firstIsPlop ? 'plop' : 'chain'); setHopping(null);
        setView(v => { const b = v.board.slice(); b[cell] = null; return { ...v, board: b }; });
        setFalling(s => { const n = new Set(s); n.delete(cell); return n; });
        if (k + 1 < cells.length) window.setTimeout(() => step(k + 1), 300); else window.setTimeout(done, 250);
      }, 400);
    };
    step(0);
  }, [sfx]);

  /* Реакция на новое состояние от движка/сервера */
  useEffect(() => {
    const key = moveKey(game);
    if (key === animatedKey.current) return;
    animatedKey.current = key;

    // Новый раунд (или первый показ)
    if (!game.lastMove || game.round !== roundRef.current) {
      roundRef.current = game.round;
      localPrefix.current = []; setPending(null); setTeleMode(false);
      setView(game); setBusy(true); setShake(true); setBanner('Раунд ' + game.round);
      window.setTimeout(() => setShake(false), 900);
      window.setTimeout(() => { setBanner(null); setBusy(false); setTurnKey(k => k + 1); sfx('turn'); }, 1300);
      return;
    }

    // Ход: анимируем ещё не показанную часть пути
    const lm = game.lastMove;
    const prefix = localPrefix.current;
    const already = prefix.length && prefix.every((c, i) => lm.path[i] === c) ? prefix.length : 0;
    localPrefix.current = []; setPending(null); setTeleMode(false); setBusy(true);
    const mover = view.players.findIndex(q => q.id === lm.playerId);
    animatePath(lm.path.slice(already), mover, already === 0, () => {
      const elim = game.eliminated;
      const showElim = (j: number) => {
        if (j < elim.length) {
          const q = game.players.find(x => x.id === elim[j])!; sfx('elim');
          showToast(q.name + ' заблокирован и выбывает', 1500);
          setView(v => ({ ...v, players: v.players.map(x => x.id === q.id ? { ...x, alive: false, pos: null } : x) }));
          window.setTimeout(() => showElim(j + 1), 1200); return;
        }
        setView(game);
        if (game.phase === 'play') { sfx('turn'); setTurnKey(k => k + 1); setBusy(false); }
        else { sfx('fanfare'); if (game.phase === 'gameEnd') setConfetti(Array.from({ length: 50 }, (_, i) => ({ left: Math.round(Math.random() * 100), hex: COLORS[i % 7].hex, dur: (2.4 + Math.random() * 2).toFixed(2), delay: (Math.random() * 2.5).toFixed(2) }))); }
      };
      showElim(0);
    });
  }, [game]); // eslint-disable-line

  const cur = view.players[view.turn];
  const myTurn = me === null || (cur && cur.id === me);
  const canAct = !busy && view.phase === 'play' && myTurn;

  const targets = useMemo(() => {
    if (!canAct) return new Map<number, Move>();
    return targetCells(game, pending ? { partial: pending } : { type: teleMode ? 'teleport' : 'step' });
  }, [canAct, game, pending, teleMode]);

  const stomp = (m: Move) => {
    const already = pending ? pending.path.length : 0;
    const cells = m.path.slice(already);
    setBusy(true); setTeleMode(false); sfx('tap');
    animatePath(cells, game.turn, already === 0, () => {
      if (continuations(game, m).length) { localPrefix.current = m.path; setPending(m); setBusy(false); }
      else { localPrefix.current = m.path; setPending(null); p.onMove(m); }
    });
  };

  const onCell = (i: number) => {
    if (busy || view.phase !== 'play') return;
    if (!myTurn) { showToast(`Сейчас ходит ${cur.name}`, 1200); return; }
    const m = targets.get(i);
    if (m) { stomp(m); return; }
    sfx('error');
    if (pending) { showToast('Дальше — только соседний шарик того же цвета', 1400); return; }
    if (game.board[i] === null) { showToast('Лунка пуста', 900); return; }
    showToast(validatePath(game, { type: teleMode ? 'teleport' : 'step', path: [i] }) || 'Сюда нельзя', 1600);
  };
  const finishPending = () => { if (!pending || busy) return; sfx('tap'); const m = pending; setPending(null); p.onMove(m); };
  const canTele = canAct && !pending && cur.pos !== null && startCells(game, game.turn, 'teleport').length > 0;
  const teleToggle = () => {
    if (!canAct || pending) return;
    if (cur.pos === null) { showToast('Сначала первый ход с края', 1300); return; }
    if (!canTele) { showToast('Ваших шариков на поле не осталось', 1300); return; }
    setTeleMode(t => !t);
  };

  const absent = (id: string) => p.presence && (!p.presence[id]?.online || p.presence[id]?.left);
  const waitingFor = view.phase === 'play' && cur && absent(cur.id) ? cur : null;
  const [, tick] = useState(0);
  useEffect(() => { if (!waitingFor) return; const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, [waitingFor]);
  const waitedSec = p.waitingSince ? Math.floor((Date.now() - p.waitingSince) / 1000) : 0;

  const ov = view.phase !== 'play' && !busy ? view.roundResult : null;
  const winner = ov && view.players.find(q => q.id === ov.winnerId);
  const sorted = view.players.slice().sort((a, b) => b.score - a.score);
  const status = pending ? 'Цепочка — можно дальше' : cur?.pos === null ? 'Первый ход — с края' : teleMode ? 'Прыжок на свой цвет' : myTurn ? 'Ваш ход' : 'Ждём ход…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Logo size={17} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {p.headerRight}
          <div style={{ background: '#fff', borderRadius: 999, padding: '6px 12px', fontWeight: 900, fontSize: 13, color: '#7c7666', boxShadow: '0 2px 8px rgba(60,50,20,.08)', whiteSpace: 'nowrap' }}>Раунд {view.round} · до {view.targetScore}</div>
        </div>
      </div>

      {/* Игроки */}
      <div style={{ display: 'flex', gap: 6 }}>
        {view.players.map((q, i) => {
          const on = i === view.turn && q.alive && view.phase === 'play';
          const off = absent(q.id);
          const v = p.social?.voice;
          const micOn = v && (q.id === me ? v.on : v.members[q.id]);
          const speaking = v && (q.id === me ? v.mySpeaking : v.peers[q.id]?.speaking);
          const react = p.social?.reactions.filter(r => r.from === q.id).at(-1);
          return <div key={q.id + (on ? turnKey : '')} style={{ outline: speaking ? `3px solid ${COLORS[q.color].hex}` : '3px solid transparent', outlineOffset: 1, ['--c' as any]: COLORS[q.color].hex + '99', flex: 1, background: on ? '#fff' : '#fbf9f3', border: `2px solid ${on ? COLORS[q.color].hex : '#eee8d9'}`, borderRadius: 14, padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: q.alive ? 1 : .38, boxShadow: on ? '0 4px 12px rgba(60,50,20,.15)' : 'none', minWidth: 0, transform: on ? 'translateY(-3px)' : 'none', transition: 'transform .3s, border-color .3s, background .3s, outline-color .15s', animation: on ? 'chipPulse .9s ease-out 1' : 'none', position: 'relative' }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: COLORS[q.color].hex, boxShadow: 'inset 0 -2px 3px rgba(0,0,0,.25)' }} />
            <div style={{ fontWeight: 900, fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.id === me ? 'Вы' : q.name}</div>
            <div style={{ fontFamily: UNB, fontSize: 13, fontWeight: 800, lineHeight: 1, color: '#55503f' }}>{q.score}</div>
            <div style={{ width: '80%', height: 3, borderRadius: 2, background: '#eee8d9', overflow: 'hidden', marginTop: 2 }}>
              <div style={{ width: Math.min(100, q.score / view.targetScore * 100) + '%', height: '100%', background: COLORS[q.color].hex, transition: 'width .6s ease' }} />
            </div>
            {micOn && <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, lineHeight: 1, opacity: speaking ? 1 : .5 }}>🎙</div>}
            {react && <img key={react.key} src={`/reactions/${react.id}.webp`} alt="" style={{ position: 'absolute', bottom: '100%', left: '50%', width: 56, height: 56, marginLeft: -28, marginBottom: 2, pointerEvents: 'none', zIndex: 12, animation: 'reactPop 2.4s ease forwards', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.25))' }} />}
            {off && <div title={p.presence?.[q.id]?.left ? 'Вышел' : 'Не в сети'} style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: p.presence?.[q.id]?.left ? '#b5ad99' : '#d94436', animation: p.presence?.[q.id]?.left ? 'none' : 'blink 1.2s infinite' }} />}
          </div>;
        })}
      </div>

      {/* Поле */}
      <div style={{ position: 'relative', width: '100%', animation: shake ? 'shakeB .8s ease' : 'none' }}>
        <div style={{ background: 'linear-gradient(180deg,#5b8ec9,#3e6ba6)', borderRadius: 22, padding: 12, boxShadow: 'inset 0 3px 10px rgba(255,255,255,.25), inset 0 -6px 12px rgba(0,20,60,.3), 0 8px 20px rgba(40,60,100,.25)' }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridTemplateRows: 'repeat(7,1fr)' }}>
              {view.board.map((b, i) => (
                <div key={i} onClick={() => onCell(i)} role="button" aria-label={`Лунка ${row(i) + 1}-${col(i) + 1}`} style={{ position: 'relative', cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', inset: '15%', borderRadius: '50%', background: 'radial-gradient(circle at 50% 32%, #16305a 0%, #0f2444 65%, #1a3660 100%)', boxShadow: 'inset 0 6px 9px rgba(0,8,25,.7), inset 0 -1px 2px rgba(120,160,220,.35), 0 1px 1px rgba(255,255,255,.3)' }} />
                  {b !== null && <div style={{ position: 'absolute', inset: '13%', borderRadius: '50%', background: ballBg(b), boxShadow: '0 4px 7px rgba(8,20,45,.55), inset 0 -5px 8px rgba(0,0,0,.28), inset 0 3px 4px rgba(255,255,255,.25)', animation: falling.has(i) ? 'ballDrop .45s ease-in forwards' : 'none', zIndex: 2 }} />}
                </div>
              ))}
            </div>
            {view.players.map((q, i) => q.alive && q.pos !== null && (
              <div key={q.id} style={{ position: 'absolute', left: (col(q.pos) * 14.2857).toFixed(4) + '%', top: (row(q.pos) * 14.2857).toFixed(4) + '%', width: '14.2857%', height: '14.2857%', transition: 'left .35s cubic-bezier(.3,1.5,.5,1), top .35s cubic-bezier(.3,1.5,.5,1)', pointerEvents: 'none', zIndex: 5 }}>
                <div style={{ position: 'absolute', inset: 0, animation: hopping === i ? 'hop .38s ease' : 'none' }}>
                  <div style={{ position: 'absolute', left: '20%', right: '20%', bottom: '6%', height: '16%', borderRadius: '50%', background: 'rgba(10,25,50,.35)', filter: 'blur(2px)' }} />
                  <div style={{ position: 'absolute', left: '29%', width: '42%', bottom: '14%', height: '74%', borderRadius: '46% 46% 24% 24%', background: 'linear-gradient(100deg,#ffffff,#e6e3da 70%,#cfcabb)', boxShadow: `0 2px 4px rgba(10,25,50,.35), ${i === view.turn && view.phase === 'play' ? `0 0 12px 3px ${COLORS[q.color].hex}88` : '0 0 0 rgba(0,0,0,0)'}` }} />
                  <div style={{ position: 'absolute', left: '22%', width: '56%', bottom: '10%', height: '20%', borderRadius: '50%', background: COLORS[q.color].hex, boxShadow: 'inset 0 -3px 4px rgba(0,0,0,.35), inset 0 2px 3px rgba(255,255,255,.4)' }} />
                </div>
              </div>
            ))}
            {banner && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8, pointerEvents: 'none' }}>
              <div style={{ background: 'rgba(255,255,255,.95)', borderRadius: 20, padding: '14px 30px', fontFamily: UNB, fontSize: 23, fontWeight: 800, color: '#2b5ea7', boxShadow: '0 10px 30px rgba(20,40,80,.3)', animation: 'fadeBanner 1.4s ease forwards' }}>{banner}</div>
            </div>}
          </div>
        </div>
      </div>

      {/* Панель хода */}
      {cur && <div key={turnKey} style={{ ...card, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `6px solid ${COLORS[cur.color].hex}`, animation: 'turnIn .35s ease' }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: COLORS[cur.color].hex, boxShadow: 'inset 0 -4px 6px rgba(0,0,0,.28), inset 0 3px 5px rgba(255,255,255,.5)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{myTurn && me !== null ? 'Ваш ход' : `Ход: ${cur.name}`}</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#8a8371' }}>{waitingFor ? `${waitingFor.name} не в сети · ${waitedSec}с` : status}</div>
        </div>
        {waitingFor && p.isHost && p.onSkip
          ? <button onClick={p.onSkip} style={{ border: 'none', borderRadius: 14, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#d94436', color: '#fff', boxShadow: '0 3px 0 #9e2c21', flex: 'none' }}>Пропустить</button>
          : pending && !busy
            ? <button onClick={finishPending} style={{ border: 'none', borderRadius: 14, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(180deg,#4f9d45,#3e8236)', color: '#fff', boxShadow: '0 3px 0 #2d6127', flex: 'none' }}>Готово</button>
            : myTurn && <button onClick={teleToggle} style={{ border: 'none', borderRadius: 14, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: canTele ? 'pointer' : 'default', background: teleMode ? '#ffd84d' : canTele ? '#2b5ea7' : '#e8e2d3', color: teleMode ? '#5a4200' : canTele ? '#fff' : '#a49c88', boxShadow: `0 3px 0 ${teleMode ? '#cfa723' : canTele ? '#1d4276' : '#d3ccba'}`, flex: 'none' }}>Прыжок</button>}
      </div>}

      {p.social && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={p.social.voice.toggle} aria-pressed={p.social.voice.on} style={{ flex: 1, border: 'none', borderRadius: 14, padding: '11px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: p.social.voice.on ? 'linear-gradient(180deg,#4f9d45,#3e8236)' : '#fff', color: p.social.voice.on ? '#fff' : '#55503f', boxShadow: p.social.voice.on ? '0 3px 0 #2d6127' : '0 3px 0 #e3ddcd, 0 2px 8px rgba(60,50,20,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, animation: p.social.voice.on && p.social.voice.mySpeaking ? 'blink .6s infinite' : 'none' }}>{p.social.voice.on ? '🎙' : '🎤'}</span>
          {p.social.voice.on ? `Микрофон включён${Object.keys(p.social.voice.peers).length ? ` · ${Object.values(p.social.voice.peers).filter(x => x.connected).length}/${Object.keys(p.social.voice.peers).length} на связи` : ''}` : 'Голосовой чат'}
        </button>
        <button onClick={() => setPicker(x => !x)} aria-label="Реакции" style={{ border: 'none', borderRadius: 14, width: 46, height: 42, cursor: 'pointer', background: picker ? '#ffd84d' : '#fff', boxShadow: picker ? '0 3px 0 #cfa723' : '0 3px 0 #e3ddcd, 0 2px 8px rgba(60,50,20,.08)', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>😄</button>
        {p.onLeave && <button onClick={p.onLeave} aria-label="Выйти из игры" title="Выйти из игры" style={{ border: 'none', borderRadius: 14, width: 42, height: 42, cursor: 'pointer', background: '#fff', boxShadow: '0 3px 0 #e3ddcd, 0 2px 8px rgba(60,50,20,.08)', fontSize: 16, color: '#9a927e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⏏</button>}
      </div>}
      {p.social && picker && <div style={{ ...card, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 4, animation: 'popIn .25s ease' }}>
        {REACTIONS.map(id => <button key={id} onClick={() => { p.social!.onReact(id); setPicker(false); sfx('tap'); }} aria-label={id} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', aspectRatio: '1' }}>
          <img src={`/reactions/${id}.webp`} alt={id} style={{ width: '100%', height: '100%', display: 'block' }} />
        </button>)}
      </div>}
      {!p.social && p.onLeave && <button onClick={p.onLeave} style={{ alignSelf: 'center', border: 'none', background: 'none', color: '#9a927e', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 6 }}>Выйти из игры</button>}

      {/* Итоги раунда */}
      {ov && winner && view.phase === 'roundEnd' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,28,20,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 24, padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center', animation: 'popIn .4s cubic-bezier(.3,1.4,.5,1) forwards', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: UNB, fontSize: 19, fontWeight: 800, color: '#2b5ea7' }}>Раунд {view.round} окончен!</div>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: COLORS[winner.color].hex, margin: '0 auto', boxShadow: 'inset 0 -5px 8px rgba(0,0,0,.28), inset 0 4px 6px rgba(255,255,255,.5)' }} />
            <div style={{ fontWeight: 900, fontSize: 19 }}>{winner.id === me ? 'Вы остались последним!' : `${winner.name} остался последним!`}</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#7c7666' }}>+{ov.total} очков<div style={{ fontWeight: 700, fontSize: 13, color: '#9a927e', marginTop: 4 }}>3 за победу · {ov.whites} за белые · {ov.own} за свои</div></div>
            <Standings players={sorted} target={view.targetScore} me={me} />
            {p.isHost
              ? <button onClick={p.onNextRound} style={{ ...btnPrimary, marginTop: 6, padding: 14, fontSize: 16 }}>Следующий раунд</button>
              : <div style={{ fontWeight: 700, fontSize: 13, color: '#9a927e', marginTop: 6 }}>Ждём, пока хозяин начнёт следующий раунд…</div>}
          </div>
        </div>
      )}

      {/* Итоги игры */}
      {ov && view.phase === 'gameEnd' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,28,20,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, padding: 24, overflow: 'hidden' }}>
          {confetti.map((c, i) => <div key={i} style={{ position: 'absolute', top: -20, left: c.left + '%', width: 10, height: 15, borderRadius: 3, background: c.hex, animation: `confettiFall ${c.dur}s linear ${c.delay}s infinite` }} />)}
          <div style={{ background: '#fff', borderRadius: 24, padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center', animation: 'popIn .45s cubic-bezier(.3,1.4,.5,1) forwards', display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', zIndex: 2 }}>
            <div style={{ fontSize: 44, lineHeight: 1 }}>🏆</div>
            <div style={{ fontFamily: UNB, fontSize: 20, fontWeight: 800, color: '#2b5ea7', lineHeight: 1.3 }}>{sorted[0].id === me ? 'Вы победили!' : `Победа: ${sorted[0].name}!`}</div>
            <Standings players={sorted} target={view.targetScore} me={me} big />
            {p.isHost ? <>
              <button onClick={p.onAgain} style={{ ...btnPrimary, padding: 14, fontSize: 16 }}>Ещё партию</button>
              <button onClick={p.onToLobby} style={btnSoft}>{me === null ? 'Новые игроки' : 'В лобби'}</button>
            </> : <div style={{ fontWeight: 700, fontSize: 13, color: '#9a927e' }}>Ждём, что решит хозяин…</div>}
          </div>
        </div>
      )}

      <Toast text={toast} />
    </div>
  );
}

function Standings({ players, target, me, big }: { players: GameState['players']; target: number; me: string | null; big?: boolean }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: big ? 8 : 6, marginTop: 4 }}>
    {players.map((q, i) => <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: big ? 15 : 13, fontWeight: 800, background: big ? (i === 0 ? '#fdf3d0' : '#f6f2e8') : 'none', borderRadius: 12, padding: big ? '8px 12px' : 0 }}>
      <div style={{ width: big ? 20 : 12, height: big ? 20 : 12, borderRadius: '50%', background: COLORS[q.color].hex, flex: 'none', boxShadow: 'inset 0 -2px 3px rgba(0,0,0,.25)' }} />
      <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.id === me ? 'Вы' : q.name}</div>
      {!big && <div style={{ flex: 2, height: 6, borderRadius: 3, background: '#eee8d9', overflow: 'hidden' }}><div style={{ width: Math.min(100, q.score / target * 100) + '%', height: '100%', background: COLORS[q.color].hex }} /></div>}
      <div style={{ fontFamily: UNB, width: big ? 'auto' : 44, textAlign: 'right' }}>{q.score}{!big && `/${target}`}</div>
    </div>)}
  </div>;
}
