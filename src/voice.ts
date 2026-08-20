import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMsg } from '../shared/protocol';

/**
 * Голосовой канал как в шутере: все в комнате всегда слышат друг друга,
 * кнопка включает/выключает только СВОЙ микрофон.
 *
 * WebRTC mesh (каждый с каждым), до 6 человек. Сигналинг — через сокет
 * комнаты ({t:'rtc'}), звук идёт напрямую. Соединение строится сразу при
 * входе в комнату с аудио-трансивером; включение микрофона — это
 * replaceTrack, без повторных переговоров.
 *
 * Кто инициирует: тот, чей id лексикографически меньше.
 */

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
if (import.meta.env.VITE_TURN_URL) {
  ICE.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
}

export interface VoicePeer { id: string; speaking: boolean; connected: boolean }
type Analyser = { ctx: AudioContext; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> };

export function useVoice(opts: {
  me: string;
  /** id всех, кто сейчас онлайн в комнате, кроме меня */
  others: string[];
  /** канал активен (мы в комнате и пользователь уже касался экрана) */
  enabled: boolean;
  send: (m: ClientMsg) => void;
  onRtc: (cb: (from: string, data: any) => void) => () => void;
}) {
  const { me, send, enabled } = opts;
  const [mic, setMic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({});
  const [mySpeaking, setMySpeaking] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const senders = useRef<Map<string, RTCRtpSender>>(new Map());
  const audios = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analysers = useRef<Map<string, Analyser>>(new Map());
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const setPeer = (id: string, patch: Partial<VoicePeer>) => setPeers(p => { const base: VoicePeer = p[id] ?? { id, speaking: false, connected: false }; return { ...p, [id]: { ...base, ...patch } }; });

  const attachAnalyser = (id: string, s: MediaStream) => {
    try {
      analysers.current.get(id)?.ctx.close().catch(() => {});
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      analysers.current.set(id, { ctx, an, buf: new Uint8Array(new ArrayBuffer(an.frequencyBinCount)) });
    } catch { /* без индикации речи */ }
  };

  const closePeer = useCallback((id: string) => {
    pcs.current.get(id)?.close(); pcs.current.delete(id); senders.current.delete(id); pendingIce.current.delete(id);
    const a = audios.current.get(id); if (a) { a.srcObject = null; a.remove(); audios.current.delete(id); }
    const an = analysers.current.get(id); if (an) { an.ctx.close().catch(() => {}); analysers.current.delete(id); }
    setPeers(p => { const n = { ...p }; delete n[id]; return n; });
  }, []);

  const makePeer = useCallback((id: string) => {
    const existing = pcs.current.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcs.current.set(id, pc);
    // Аудио-трансивер сразу: слушаем всегда, отправляем когда включён микрофон.
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    senders.current.set(id, tr.sender);
    const track = stream.current?.getAudioTracks()[0];
    if (track) tr.sender.replaceTrack(track).catch(() => {});

    pc.onicecandidate = e => { if (e.candidate) send({ t: 'rtc', to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = e => {
      const s = e.streams[0] ?? new MediaStream([e.track]);
      let a = audios.current.get(id);
      if (!a) { a = document.createElement('audio'); a.autoplay = true; (a as any).playsInline = true; a.style.display = 'none'; document.body.appendChild(a); audios.current.set(id, a); }
      a.srcObject = s; a.play().catch(() => {});
      attachAnalyser(id, s);
      setPeer(id, { connected: true });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPeer(id, { connected: true });
      if (pc.connectionState === 'disconnected') setPeer(id, { connected: false });
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(id);
    };
    pc.onnegotiationneeded = async () => {
      if (me > id) return; // инициирует меньший id
      try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } }); } catch { /* повторится */ }
    };
    setPeer(id, {});
    return pc;
  }, [me, send, closePeer]);

  // Входящий сигналинг
  useEffect(() => opts.onRtc(async (from, data) => {
    if (!enabled) return;
    const pc = makePeer(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer' && pc.signalingState !== 'stable' && me < from) return; // гонка: инициатор игнорирует встречный offer
        await pc.setRemoteDescription(data.sdp);
        for (const c of pendingIce.current.get(from) ?? []) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.current.delete(from);
        if (data.sdp.type === 'offer') { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } }); }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else pendingIce.current.set(from, [...(pendingIce.current.get(from) ?? []), data.candidate]);
      }
    } catch { /* устаревшее сообщение */ }
  }), [enabled, makePeer, send, me]); // eslint-disable-line

  // Набор собеседников = все онлайн в комнате
  const othersKey = opts.others.slice().sort().join(',');
  useEffect(() => {
    if (!enabled) { for (const id of [...pcs.current.keys()]) closePeer(id); return; }
    const want = new Set(opts.others);
    for (const id of [...pcs.current.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) makePeer(id);
  }, [enabled, othersKey, makePeer, closePeer]); // eslint-disable-line

  // Индикация «кто говорит»
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const level = (a: Analyser) => { a.an.getByteFrequencyData(a.buf); let s = 0; for (let i = 0; i < a.buf.length; i++) s += a.buf[i]; return s / a.buf.length; };
      const mine = analysers.current.get('__me');
      setMySpeaking(!!mine && mic && level(mine) > 18);
      setPeers(p => {
        let changed = false; const n = { ...p };
        for (const [id, a] of analysers.current) { if (id === '__me' || !n[id]) continue; const sp = level(a) > 18; if (n[id].speaking !== sp) { n[id] = { ...n[id], speaking: sp }; changed = true; } }
        return changed ? n : p;
      });
    }, 120);
    return () => clearInterval(t);
  }, [enabled, mic]);

  const micOn = useCallback(async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      stream.current = s;
      const track = s.getAudioTracks()[0];
      for (const sender of senders.current.values()) sender.replaceTrack(track).catch(() => {});
      attachAnalyser('__me', s);
      setMic(true);
      send({ t: 'voice', on: true });
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Микрофон недоступен');
    }
  }, [send]);

  const micOff = useCallback(() => {
    for (const sender of senders.current.values()) sender.replaceTrack(null).catch(() => {});
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    const mine = analysers.current.get('__me'); if (mine) { mine.ctx.close().catch(() => {}); analysers.current.delete('__me'); }
    setMic(false); setMySpeaking(false);
    send({ t: 'voice', on: false });
  }, [send]);

  const leave = useCallback(() => {
    if (mic) micOff();
    for (const id of [...pcs.current.keys()]) closePeer(id);
  }, [mic, micOff, closePeer]);
  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); for (const id of [...pcs.current.keys()]) closePeer(id); }, []); // eslint-disable-line

  return { mic, toggle: () => (mic ? micOff() : micOn()), leave, peers, mySpeaking, error };
}
