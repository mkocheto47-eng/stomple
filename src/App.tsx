import { useEffect, useState } from 'react';
import { CODE_ALPHABET, CODE_LENGTH } from '../shared/protocol';
import { randomCode } from '../shared/room';
import { Shell, Logo, card, btnPrimary, btnBlue, btnSoft, UNB, RUB, btnDisabled } from './theme';
import { useAudio } from './audio';
import { getPref, setPref } from './storage';
import Hotseat from './Hotseat';
import Online from './Online';
import Rules from './Rules';
import { TRACKS } from './Player';

type Route = { page: 'home' } | { page: 'hotseat' } | { page: 'room'; code: string };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'hotseat') return { page: 'hotseat' };
  const m = /^r\/([A-Za-z]{4})$/.exec(h);
  if (m) return { page: 'room', code: m[1].toUpperCase() };
  return { page: 'home' };
}
const go = (hash: string) => { location.hash = hash; };

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [sound, setSound] = useState(() => getPref('sound', true));
  const [music, setMusic] = useState(() => getPref('music', true));
  const [voiceOn, setVoiceOn] = useState(false);
  const [rules, setRules] = useState(false);
  const sfx = useAudio(sound, music && TRACKS.length === 0, voiceOn);
  useEffect(() => { const f = () => setRoute(parseHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => setPref('sound', sound), [sound]);
  useEffect(() => setPref('music', music), [music]);

  const toggles = <>
    <button onClick={() => setRules(true)} aria-label="Правила" style={{ border: 'none', background: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', boxShadow: '0 2px 8px rgba(60,50,20,.08)', fontFamily: UNB, fontWeight: 900, fontSize: 15, color: '#2b5ea7' }}>?</button>
    <button onClick={() => setMusic(m => !m)} aria-label="Музыка" style={{ border: 'none', background: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', boxShadow: '0 2px 8px rgba(60,50,20,.08)', opacity: music ? 1 : .4, fontSize: 14 }}>🎵</button>
    <button onClick={() => setSound(s => !s)} aria-label="Звуки" style={{ border: 'none', background: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', boxShadow: '0 2px 8px rgba(60,50,20,.08)', opacity: sound ? 1 : .4, fontSize: 14 }}>🔊</button>
  </>;

  return <Shell>
    {route.page === 'home' && <Home toggles={toggles} onRules={() => setRules(true)} />}
    {route.page === 'hotseat' && <Hotseat sfx={sfx} onHome={() => go('')} headerRight={toggles} music={music} voiceOn={voiceOn} />}
    {route.page === 'room' && <Online key={route.code} code={route.code} sfx={sfx} onHome={() => { setVoiceOn(false); go(''); }} headerRight={toggles} onVoice={setVoiceOn} music={music} />}
    {rules && <Rules onClose={() => setRules(false)} />}
  </Shell>;
}

function Home({ toggles, onRules }: { toggles: React.ReactNode; onRules: () => void }) {
  const [code, setCode] = useState('');
  const ok = code.length === CODE_LENGTH;
  const join = () => { if (ok) go(`/r/${code}`); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 18, flex: 1 }}>
      <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>{toggles}</div>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <Logo size={44} />
        <div style={{ fontWeight: 700, color: '#7c7666', marginTop: 2 }}>Кто умно топит — тот побеждает!</div>
      </div>

      <button onClick={() => go(`/r/${randomCode(CODE_ALPHABET, CODE_LENGTH)}`)} style={{ ...btnPrimary, marginTop: 12 }}>Создать комнату</button>

      <div style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c7666' }}>Есть код? Войти</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={code} placeholder="ABCD" maxLength={CODE_LENGTH} autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text"
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH))} onKeyDown={e => { if (e.key === 'Enter') join(); }}
            style={{ flex: 1, border: '2px solid #ece6d6', borderRadius: 12, padding: '10px 12px', fontFamily: UNB, fontSize: 22, fontWeight: 800, letterSpacing: '.2em', textAlign: 'center', background: '#fbf9f3', minWidth: 0 }} />
          <button disabled={!ok} onClick={join} style={{ ...btnBlue, padding: '10px 18px', fontSize: 15, ...(ok ? {} : btnDisabled) }}>Войти</button>
        </div>
      </div>

      <button onClick={() => go('/hotseat')} style={btnSoft}>Играть на одном телефоне</button>
      <button onClick={onRules} style={{ ...btnSoft, background: 'none', color: '#2b5ea7' }}>Как играть?</button>

      <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 12, color: '#b5ad99', fontWeight: 700, fontFamily: RUB }}>Поле 7×7 · 2–6 игроков · до 40 / 20 / 15 очков</div>
    </div>
  );
}
