import { useState } from 'react';
import { newGame, startRound, defaultTargetScore, type GameState, type PlayerColor, applyMove } from '../shared/engine';
import GameScreen from './GameScreen';
import { COLORS, UNB, RUB, card, ballBg, Logo, btnPrimary, btnSoft } from './theme';
import type { Sfx } from './audio';

export default function Hotseat({ sfx, onHome, headerRight }: { sfx: (k: Sfx) => void; onHome: () => void; headerRight: React.ReactNode }) {
  const [numPlayers, setNumPlayers] = useState(2);
  const [names, setNames] = useState(['', '', '', '', '', '']);
  const [picks, setPicks] = useState<PlayerColor[]>([0, 3, 1, 4, 2, 5]);
  const [game, setGame] = useState<GameState | null>(null);

  const start = () => {
    const players = Array.from({ length: numPlayers }, (_, i) => ({ id: 'p' + i, name: names[i].trim() || 'Игрок ' + (i + 1), color: picks[i] }));
    setGame(newGame({ players }));
  };

  if (game) return <GameScreen
    game={game} me={null} isHost sfx={sfx} headerRight={headerRight}
    onMove={m => setGame(g => applyMove(g!, m))}
    onNextRound={() => setGame(g => startRound(g!))}
    onAgain={() => setGame(g => newGame({ players: g!.players.map(p => ({ id: p.id, name: p.name, color: p.color })) }))}
    onToLobby={() => setGame(null)}
  />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onHome} style={{ ...btnSoft, padding: '8px 12px', fontSize: 13 }}>← Назад</button>
        {headerRight}
      </div>
      <div style={{ textAlign: 'center' }}>
        <Logo size={36} />
        <div style={{ fontWeight: 700, color: '#7c7666', marginTop: 2 }}>На одном телефоне, по очереди</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 900, fontSize: 14, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c7666' }}>Сколько игроков?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[2, 3, 4, 5, 6].map(n => {
            const on = n === numPlayers;
            return <button key={n} onClick={() => setNumPlayers(n)} style={{ flex: 1, padding: '12px 0', border: `2px solid ${on ? '#2b5ea7' : '#ece6d6'}`, borderRadius: 14, background: on ? '#2b5ea7' : '#fff', color: on ? '#fff' : '#55503f', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}>{n}</button>;
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: numPlayers }, (_, i) => (
          <div key={i} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: COLORS[picks[i]].hex, boxShadow: 'inset 0 -4px 6px rgba(0,0,0,.25), inset 0 3px 5px rgba(255,255,255,.5)', flex: 'none' }} />
              <input value={names[i]} placeholder={'Игрок ' + (i + 1)} maxLength={12} onChange={e => { const n = names.slice(); n[i] = e.target.value; setNames(n); }}
                style={{ flex: 1, border: '2px solid #ece6d6', borderRadius: 12, padding: '10px 12px', fontFamily: RUB, fontSize: 16, fontWeight: 800, background: '#fbf9f3', minWidth: 0 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              {([0, 1, 2, 3, 4, 5] as PlayerColor[]).map(ci => {
                const taken = picks.slice(0, numPlayers).some((pk, pi) => pi !== i && pk === ci);
                return <div key={ci} role="button" aria-label={COLORS[ci].name} onClick={() => { if (taken) return; const p = picks.slice(); p[i] = ci; setPicks(p); }}
                  style={{ width: 40, height: 40, borderRadius: '50%', background: ballBg(ci), border: ci === picks[i] ? '3px solid #2b2b33' : '3px solid transparent', opacity: taken ? .22 : 1, cursor: taken ? 'default' : 'pointer', flex: 'none' }} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <button onClick={start} style={{ ...btnPrimary, fontFamily: UNB }}>Играть до {defaultTargetScore(numPlayers)} очков</button>
    </div>
  );
}
