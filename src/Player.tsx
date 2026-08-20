import { useEffect, useRef, useState } from 'react';
import tracksJson from './tracks.json';
import type { MusicState } from '../shared/protocol';
import { UNB } from './theme';

export interface Track { file: string; title: string }
export const TRACKS: Track[] = tracksJson as Track[];

/**
 * Плеер с общим состоянием. `state` приходит из комнаты (или локальный в хот-ситe),
 * `canControl` — хозяин. Все синхронизируют позицию по state.at.
 * Эквалайзер — AnalyserNode на аудио-элементе.
 */
export default function Player({ state, canControl, onChange, muted, duck, serverOffset = 0 }: {
  state: MusicState | null;
  canControl: boolean;
  onChange: (s: { track: number; playing: boolean; position: number }) => void;
  /** локальный выключатель звука (кнопка 🎵) */
  muted: boolean;
  /** приглушить (микрофон включён) */
  duck: boolean;
  /** поправка: серверное время − локальное */
  serverOffset?: number;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const an = useRef<{ ctx: AudioContext; node: AnalyserNode; gain: GainNode; buf: Uint8Array<ArrayBuffer> } | null>(null);
  const [bars, setBars] = useState<number[]>(Array(12).fill(0));
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const track = state ? TRACKS[state.track % Math.max(1, TRACKS.length)] : null;
  const playing = !!state?.playing && !muted;

  // Аудио-элемент + анализатор
  useEffect(() => {
    const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous'; (a as any).playsInline = true;
    audio.current = a;
    const setup = () => {
      if (an.current) return;
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = ctx.createMediaElementSource(a);
        const node = ctx.createAnalyser(); node.fftSize = 64; node.smoothingTimeConstant = .75;
        const gain = ctx.createGain();
        src.connect(node); node.connect(gain); gain.connect(ctx.destination);
        an.current = { ctx, node, gain, buf: new Uint8Array(new ArrayBuffer(node.frequencyBinCount)) };
      } catch { /* без эквалайзера */ }
    };
    const unlock = () => { setup(); an.current?.ctx.resume(); a.play().then(() => setBlocked(false)).catch(() => {}); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    return () => { window.removeEventListener('pointerdown', unlock); a.pause(); a.src = ''; an.current?.ctx.close().catch(() => {}); an.current = null; };
  }, []);

  // Синхронизация с состоянием
  useEffect(() => {
    const a = audio.current; if (!a || !track) return;
    const want = track.file;
    if (!a.src.endsWith(want)) { a.src = want; a.load(); }
    const pos = state!.playing ? state!.position + (Date.now() + serverOffset - state!.at) / 1000 : state!.position;
    const apply = () => { if (Math.abs(a.currentTime - pos) > 1.5) a.currentTime = Math.max(0, pos); };
    if (a.readyState >= 1) apply(); else a.addEventListener('loadedmetadata', apply, { once: true });
    if (playing) { an.current?.ctx.resume(); a.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }
    else a.pause();
  }, [state?.track, state?.playing, state?.position, state?.at, playing, track?.file]); // eslint-disable-line

  // Громкость / приглушение
  useEffect(() => {
    const target = duck ? .18 : .6;
    if (an.current) an.current.gain.gain.setTargetAtTime(target, an.current.ctx.currentTime, .3);
    else if (audio.current) audio.current.volume = target;
  }, [duck, playing]);

  // Хозяин: автопереход к следующему треку
  useEffect(() => {
    const a = audio.current; if (!a) return;
    const onEnd = () => { if (canControl && state) onChange({ track: (state.track + 1) % TRACKS.length, playing: true, position: 0 }); };
    a.addEventListener('ended', onEnd); return () => a.removeEventListener('ended', onEnd);
  }, [canControl, state?.track, onChange]); // eslint-disable-line

  // Эквалайзер
  useEffect(() => {
    if (!playing) { setBars(b => b.map(() => 0)); return; }
    let raf = 0;
    const tick = () => {
      const A = an.current;
      if (A) { A.node.getByteFrequencyData(A.buf); const n = 12; const out: number[] = []; for (let i = 0; i < n; i++) { const j = Math.min(A.buf.length - 1, Math.floor(Math.pow(i / n, 1.4) * A.buf.length)); out.push(A.buf[j] / 255); } setBars(out); }
      else setBars(b => b.map((_, i) => .3 + .5 * Math.abs(Math.sin(Date.now() / 300 + i))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  if (!TRACKS.length) return null;
  const cur = state?.track ?? 0;
  const pos = () => audio.current?.currentTime ?? 0;
  const go = (i: number, play = true) => onChange({ track: (i + TRACKS.length) % TRACKS.length, playing: play, position: 0 });
  const toggle = () => state ? onChange({ track: state.track, playing: !state.playing, position: pos() }) : go(0);

  const btn: React.CSSProperties = { border: 'none', background: '#fff', borderRadius: 999, width: 34, height: 34, cursor: 'pointer', boxShadow: '0 2px 8px rgba(60,50,20,.08)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2b2b33', flex: 'none' };
  const title = track?.title ?? 'Музыка';

  return (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 14px rgba(60,50,20,.08)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {canControl && <button onClick={() => go(cur - 1)} aria-label="Предыдущий" style={btn}>⏮</button>}
        {canControl && <button onClick={toggle} aria-label={state?.playing ? 'Пауза' : 'Играть'} style={{ ...btn, background: 'linear-gradient(180deg,#2b5ea7,#1f4b8b)', color: '#fff', width: 40, height: 40 }}>{state?.playing ? '❚❚' : '▶'}</button>}
        {canControl && <button onClick={() => go(cur + 1)} aria-label="Следующий" style={btn}>⏭</button>}
        <div onClick={() => setOpen(o => !o)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ fontWeight: 900, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9a927e' }}>{blocked && state?.playing && !muted ? 'Нажмите на экран, чтобы включить звук' : muted ? 'Звук выключен у вас' : state?.playing ? `${cur + 1} из ${TRACKS.length}${canControl ? '' : ' · включает хозяин'}` : 'Пауза'}</div>
        </div>
        <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 26, flex: 'none' }}>
          {bars.map((v, i) => <div key={i} style={{ width: 3, height: Math.max(3, v * 26), borderRadius: 2, background: `hsl(${200 + i * 12},70%,${45 + v * 20}%)`, transition: 'height .08s linear' }} />)}
        </div>
      </div>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
        {TRACKS.map((t, i) => <div key={t.file} onClick={() => canControl && go(i)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 10, background: i === cur ? '#eef3fb' : 'none', cursor: canControl ? 'pointer' : 'default', fontSize: 13, fontWeight: i === cur ? 900 : 600 }}>
          <span style={{ fontFamily: UNB, fontSize: 11, color: '#9a927e', width: 16 }}>{i + 1}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
          {i === cur && state?.playing && <span style={{ fontSize: 11 }}>▶</span>}
        </div>)}
      </div>}
    </div>
  );
}
