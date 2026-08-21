import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import PartySocket from 'partysocket';
import type { ClientMsg, ServerMsg, RoomSnapshot } from '../shared/protocol';
import { defaultTargetScore, type Move, type PlayerColor } from '../shared/engine';
import GameScreen, { type ReactionEvent } from './GameScreen';
import { useVoice } from './voice';
import type { ReactionId } from '../shared/protocol';
import { COLORS, UNB, RUB, card, ballBg, Logo, btnPrimary, btnSoft, btnDisabled, Toast } from './theme';
import { playerId, getName, setName as saveName } from './storage';
import type { Sfx } from './audio';

const HOST = import.meta.env.VITE_PARTY_HOST || 'localhost:1999';

export default function Online({ code, sfx, onHome, headerRight, onVoice }: { code: string; sfx: (k: Sfx) => void; onHome: () => void; headerRight: React.ReactNode; onVoice?: (on: boolean) => void }) {
  const me = useMemo(playerId, []);
  const [name, setNameState] = useState(getName());
  const [joined, setJoined] = useState(!!getName());
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [conn, setConn] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [err, setErr] = useState<{ id: number; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sock = useRef<PartySocket | null>(null);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const rtcSubs = useRef(new Set<(from: string, data: any) => void>());

  useEffect(() => {
    if (!joined) return;
    const s = new PartySocket({ host: HOST, party: 'stomple', room: code.toLowerCase() });
    sock.current = s;
    s.addEventListener('open', () => { setConn('open'); s.send(JSON.stringify({ t: 'join', id: me, name } satisfies ClientMsg)); });
    s.addEventListener('close', () => setConn('closed'));
    s.addEventListener('message', e => {
      const m: ServerMsg = JSON.parse(e.data);
      if (m.t === 'state') setRoom(m.room);
      if (m.t === 'error') setErr({ id: Date.now(), text: m.message });
      if (m.t === 'toast') { setToast(m.message); setTimeout(() => setToast(null), 1800); }
      if (m.t === 'reaction') { const key = m.at + Math.random(); setReactions(r => [...r.slice(-20), { key, from: m.from, id: m.id }]); setTimeout(() => setReactions(r => r.filter(x => x.key !== key)), 2500); }
      if (m.t === 'rtc') rtcSubs.current.forEach(cb => cb(m.from, m.data));
    });
    return () => { s.close(); sock.current = null; };
  }, [joined, code]); // eslint-disable-line

  const send = useCallback((m: ClientMsg) => { sock.current?.send(JSON.stringify(m)); }, []);
  const onRtc = useCallback((cb: (from: string, data: any) => void) => { rtcSubs.current.add(cb); return () => { rtcSubs.current.delete(cb); }; }, []);
  const voiceOthers = useMemo(() => (room?.members ?? []).filter(m => m.id !== me && m.online && !m.left).map(m => m.id), [room, me]);
  // Канал поднимаем после первого касания (иначе браузер не даст проиграть звук собеседников)
  const [touched, setTouched] = useState(false);
  useEffect(() => { const f = () => setTouched(true); const evs = ['pointerdown', 'touchstart', 'keydown']; evs.forEach(e => window.addEventListener(e, f, { once: true, passive: true })); return () => evs.forEach(e => window.removeEventListener(e, f)); }, []);
  const voice = useVoice({ me, others: voiceOthers, enabled: !!room && conn === 'open' && touched, send, onRtc });
  useEffect(() => { onVoice?.(voice.mic); }, [voice.mic]); // eslint-disable-line
  const mine = room?.members.find(m => m.id === me);
  const isHost = !!mine?.host;

  const link = `${location.origin}${location.pathname}#/r/${code}`;
  const share = async () => {
    const text = `Заходи в Stomple, комната ${code}: ${link}`;
    try { if (navigator.share) { await navigator.share({ title: 'Stomple', text, url: link }); return; } } catch { /* отменили */ }
    try { await navigator.clipboard.writeText(link); setToast('Ссылка скопирована'); setTimeout(() => setToast(null), 1500); } catch { setToast(link); setTimeout(() => setToast(null), 4000); }
  };

  // ───── имя ─────
  if (!joined) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
      <button onClick={onHome} style={{ ...btnSoft, alignSelf: 'flex-start', padding: '8px 12px', fontSize: 13 }}>← Назад</button>
      <div style={{ textAlign: 'center' }}><Logo size={36} /><div style={{ fontWeight: 700, color: '#7c7666', marginTop: 2 }}>Комната {code}</div></div>
      <div style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 14, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c7666' }}>Как вас зовут?</div>
        <input autoFocus value={name} maxLength={12} placeholder="Имя" onChange={e => setNameState(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { saveName(name.trim()); setJoined(true); } }}
          style={{ border: '2px solid #ece6d6', borderRadius: 12, padding: '12px 14px', fontFamily: RUB, fontSize: 17, fontWeight: 800, background: '#fbf9f3' }} />
      </div>
      <button disabled={!name.trim()} onClick={() => { saveName(name.trim()); setJoined(true); }} style={{ ...btnPrimary, ...(name.trim() ? {} : btnDisabled) }}>Войти в комнату</button>
    </div>
  );

  // ───── соединение ─────
  if (!room) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center' }}>
      <Logo size={36} />
      <div style={{ fontWeight: 800, color: '#7c7666' }}>{conn === 'closed' ? 'Нет связи с сервером. Переподключаемся…' : 'Подключаемся к комнате ' + code + '…'}</div>
      <button onClick={onHome} style={btnSoft}>На главную</button>
    </div>
  );

  const presence = Object.fromEntries(room.members.map(m => [m.id, { online: m.online, left: m.left }]));
  const connBadge = conn !== 'open' && <div style={{ background: '#d94436', color: '#fff', borderRadius: 999, padding: '6px 10px', fontWeight: 800, fontSize: 12, animation: 'blink 1.2s infinite' }}>нет связи</div>;

  // ───── игра ─────
  if (room.phase === 'game' && room.game) {
    const inGame = room.game.players.some(p => p.id === me) && !mine?.left;
    return <>
      <GameScreen
        game={room.game} me={inGame ? me : '__spectator__'} isHost={isHost} sfx={sfx} presence={presence} waitingSince={room.waitingSince}
        headerRight={<>{connBadge}{headerRight}</>}
        externalToast={err}
        social={{
          reactions,
          onReact: (id: ReactionId) => send({ t: 'react', id }),
          voice: { on: voice.mic, toggle: voice.toggle, peers: voice.peers, mySpeaking: voice.mySpeaking, error: voice.error, members: Object.fromEntries(room.members.map(m => [m.id, m.voice])), debug: voice.debug },
        }}
        onMove={(m: Move) => send({ t: 'move', move: m })}
        onNextRound={() => send({ t: 'nextRound' })}
        onAgain={() => send({ t: 'again' })}
        onToLobby={() => send({ t: 'toLobby' })}
        onSkip={() => send({ t: 'skip' })}
        onLeave={inGame ? () => { if (confirm('Выйти из партии? Вернуться в неё будет нельзя.')) { voice.leave(); send({ t: 'leave' }); onHome(); } } : undefined}
      />
      <Toast text={toast} />
    </>;
  }

  // ───── лобби ─────
  const active = room.members.filter(m => !m.left);
  const target = room.targetScore ?? defaultTargetScore(Math.max(2, active.length));
  const canStart = isHost && active.length >= 2 && active.every(m => m.color !== null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => { voice.leave(); send({ t: 'leave' }); onHome(); }} style={{ ...btnSoft, padding: '8px 12px', fontSize: 13 }}>← Выйти</button>
        <div style={{ display: 'flex', gap: 6 }}>{connBadge}{headerRight}</div>
      </div>
      <div style={{ textAlign: 'center' }}><Logo size={32} /></div>

      <div style={{ ...card, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: '#9a927e' }}>Код комнаты</div>
          <div style={{ fontFamily: UNB, fontSize: 34, fontWeight: 900, letterSpacing: '.12em', color: '#2b5ea7', lineHeight: 1.1 }}>{code}</div>
        </div>
        <button onClick={share} style={{ ...btnPrimary, padding: '12px 16px', fontSize: 14, background: 'linear-gradient(180deg,#2b5ea7,#1f4b8b)', boxShadow: '0 4px 0 #163a6e' }}>Позвать друзей</button>
      </div>

      <div style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: mine?.color !== null && mine?.color !== undefined ? COLORS[mine.color].hex : '#e8e2d3', boxShadow: 'inset 0 -4px 6px rgba(0,0,0,.25), inset 0 3px 5px rgba(255,255,255,.5)', flex: 'none' }} />
          <input value={name} maxLength={12} onChange={e => setNameState(e.target.value)} onBlur={() => { if (name.trim()) { saveName(name.trim()); send({ t: 'name', name: name.trim() }); } }}
            style={{ flex: 1, border: '2px solid #ece6d6', borderRadius: 12, padding: '10px 12px', fontFamily: RUB, fontSize: 16, fontWeight: 800, background: '#fbf9f3', minWidth: 0 }} />
          {isHost && <div style={{ fontSize: 11, fontWeight: 900, color: '#ef8b2d', textTransform: 'uppercase' }}>хозяин</div>}
        </div>
        <div style={{ fontWeight: 800, fontSize: 12, color: '#9a927e' }}>Ваш цвет</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          {([0, 1, 2, 3, 4, 5] as PlayerColor[]).map(ci => {
            const owner = room.members.find(m => m.color === ci && !m.left);
            const taken = !!owner && owner.id !== me;
            const isMine = mine?.color === ci;
            return <div key={ci} role="button" aria-label={COLORS[ci].name} onClick={() => { if (taken) { setToast(`${owner!.name} уже взял этот цвет`); setTimeout(() => setToast(null), 1200); return; } send({ t: 'color', color: isMine ? null : ci }); }}
              style={{ width: 44, height: 44, borderRadius: '50%', background: ballBg(ci), border: isMine ? '3px solid #2b2b33' : '3px solid transparent', opacity: taken ? .22 : 1, cursor: taken ? 'default' : 'pointer', flex: 'none' }} />;
          })}
        </div>
      </div>

      <div style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: '#9a927e' }}>В комнате · {active.length} из 6</div>
        {active.map(m => <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: m.color !== null ? ballBg(m.color) : '#e8e2d3', border: m.color === null ? '2px dashed #cfc7b4' : 'none', flex: 'none' }} />
          <div style={{ flex: 1, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: m.online ? 1 : .5 }}>{m.name}{m.id === me ? ' (вы)' : ''}</div>
          {m.voice && <div style={{ fontSize: 12 }}>🎙</div>}
          {m.host && <div style={{ fontSize: 11, fontWeight: 900, color: '#ef8b2d', textTransform: 'uppercase' }}>хозяин</div>}
          {m.color === null && <div style={{ fontSize: 12, fontWeight: 700, color: '#9a927e' }}>выбирает цвет</div>}
        </div>)}
        {active.length < 2 && <div style={{ fontSize: 13, fontWeight: 700, color: '#9a927e' }}>Ждём ещё хотя бы одного…</div>}
      </div>

      <div style={{ ...card, padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, fontWeight: 800 }}>Играем до <span style={{ fontFamily: UNB, color: '#2b5ea7' }}>{target}</span> очков</div>
        {isHost && <>
          <button onClick={() => send({ t: 'target', targetScore: Math.max(5, target - 5) })} style={{ ...btnSoft, padding: '8px 14px' }}>−</button>
          <button onClick={() => send({ t: 'target', targetScore: Math.min(100, target + 5) })} style={{ ...btnSoft, padding: '8px 14px' }}>+</button>
          {room.targetScore !== null && <button onClick={() => send({ t: 'target', targetScore: null })} style={{ ...btnSoft, padding: '8px 10px', fontSize: 12 }}>авто</button>}
        </>}
      </div>

      <button onClick={voice.toggle} style={{ ...btnSoft, background: voice.mic ? 'linear-gradient(180deg,#4f9d45,#3e8236)' : '#efe9da', color: voice.mic ? '#fff' : '#55503f' }}>{voice.mic ? '🎙 Микрофон включён — вас слышат' : '🎤 Включить микрофон'}</button>
      <div style={{ textAlign: 'center', fontSize: 12, color: '#9a927e', fontWeight: 700, marginTop: -8 }}>Голосовой канал общий: всех, кто включил микрофон, слышно сразу. Доступ к микрофону запрашивается при входе — пока кнопка выключена, вас не слышно.</div>
      {isHost
        ? <button disabled={!canStart} onClick={() => send({ t: 'start' })} style={{ ...btnPrimary, ...(canStart ? {} : btnDisabled) }}>Начать игру</button>
        : <div style={{ textAlign: 'center', fontWeight: 700, color: '#9a927e', fontSize: 13 }}>Игру начнёт {room.members.find(m => m.host)?.name ?? 'хозяин'}</div>}
      <Toast text={toast ?? err?.text ?? null} />
    </div>
  );
}
