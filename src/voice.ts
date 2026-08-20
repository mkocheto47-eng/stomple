import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMsg } from '../shared/protocol';

/**
 * Голосовой чат: WebRTC mesh (каждый с каждым), до 6 участников.
 * Сигналинг — через сокет комнаты ({t:'rtc'}), звук идёт напрямую между телефонами.
 *
 * Кто инициирует соединение: тот, чей id лексикографически меньше, —
 * так двое не шлют друг другу offer одновременно.
 */

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
if (import.meta.env.VITE_TURN_URL) {
  ICE.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
}

export interface VoicePeer { id: string; speaking: boolean; connected: boolean }

export function useVoice(opts: {
  me: string;
  /** id всех, у кого сейчас включён микрофон (из снимка комнаты), кроме меня */
  others: string[];
  send: (m: ClientMsg) => void;
  /** подписка на входящие rtc-сообщения: возвращает отписку */
  onRtc: (cb: (from: string, data: any) => void) => () => void;
}) {
  const { me, send } = opts;
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({});
  const [mySpeaking, setMySpeaking] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audios = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analysers = useRef<Map<string, { ctx: AudioContext; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> }>>(new Map());

  const setPeer = (id: string, patch: Partial<VoicePeer>) => setPeers(p => { const base: VoicePeer = p[id] ?? { id, speaking: false, connected: false }; return { ...p, [id]: { ...base, ...patch } }; });

  const attachAnalyser = (id: string, s: MediaStream) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      analysers.current.set(id, { ctx, an, buf: new Uint8Array(new ArrayBuffer(an.frequencyBinCount)) });
    } catch { /* без индикации речи */ }
  };

  const closePeer = useCallback((id: string) => {
    pcs.current.get(id)?.close(); pcs.current.delete(id);
    const a = audios.current.get(id); if (a) { a.srcObject = null; a.remove(); audios.current.delete(id); }
    const an = analysers.current.get(id); if (an) { an.ctx.close().catch(() => {}); analysers.current.delete(id); }
    setPeers(p => { const n = { ...p }; delete n[id]; return n; });
  }, []);

  const makePeer = useCallback((id: string) => {
    if (pcs.current.has(id)) return pcs.current.get(id)!;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcs.current.set(id, pc);
    stream.current?.getTracks().forEach(t => pc.addTrack(t, stream.current!));
    pc.onicecandidate = e => { if (e.candidate) send({ t: 'rtc', to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = e => {
      const s = e.streams[0];
      let a = audios.current.get(id);
      if (!a) { a = document.createElement('audio'); a.autoplay = true; (a as any).playsInline = true; a.style.display = 'none'; document.body.appendChild(a); audios.current.set(id, a); }
      a.srcObject = s; a.play().catch(() => {});
      attachAnalyser(id, s);
      setPeer(id, { connected: true });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPeer(id, { connected: true });
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { closePeer(id); }
    };
    pc.onnegotiationneeded = async () => {
      if (me > id) return; // инициирует меньший id
      try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } }); } catch { /* повторим при следующем onnegotiationneeded */ }
    };
    setPeer(id, {});
    return pc;
  }, [me, send, closePeer]);

  // Входящий сигналинг
  useEffect(() => opts.onRtc(async (from, data) => {
    if (!on) return;
    const pc = makePeer(from);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } }); }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch { /* устаревшее сообщение */ }
  }), [on, makePeer, send]); // eslint-disable-line

  // Синхронизация набора собеседников со снимком комнаты
  const othersKey = opts.others.slice().sort().join(',');
  useEffect(() => {
    if (!on) return;
    const want = new Set(opts.others);
    for (const id of [...pcs.current.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) makePeer(id);
  }, [on, othersKey, makePeer, closePeer]); // eslint-disable-line

  // Индикация «кто говорит»
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      const level = (a: { an: AnalyserNode; buf: Uint8Array<ArrayBuffer> }) => { a.an.getByteFrequencyData(a.buf); let s = 0; for (let i = 0; i < a.buf.length; i++) s += a.buf[i]; return s / a.buf.length; };
      const mine = analysers.current.get('__me');
      if (mine) setMySpeaking(level(mine) > 18);
      setPeers(p => {
        let changed = false; const n = { ...p };
        for (const [id, a] of analysers.current) { if (id === '__me' || !n[id]) continue; const sp = level(a) > 18; if (n[id].speaking !== sp) { n[id] = { ...n[id], speaking: sp }; changed = true; } }
        return changed ? n : p;
      });
    }, 120);
    return () => clearInterval(t);
  }, [on]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      stream.current = s;
      attachAnalyser('__me', s);
      setOn(true);
      send({ t: 'voice', on: true });
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Микрофон недоступен');
    }
  }, [send]);

  const stop = useCallback(() => {
    send({ t: 'voice', on: false });
    setOn(false); setMySpeaking(false);
    for (const id of [...pcs.current.keys()]) closePeer(id);
    const mine = analysers.current.get('__me'); if (mine) { mine.ctx.close().catch(() => {}); analysers.current.delete('__me'); }
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
  }, [send, closePeer]);

  useEffect(() => () => { if (on) stop(); }, []); // eslint-disable-line

  return { on, start, stop, toggle: () => (on ? stop() : start()), peers, mySpeaking, error };
}
