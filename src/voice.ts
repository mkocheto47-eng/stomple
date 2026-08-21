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
  // Свой TURN (Metered / Cloudflare Calls) — см. .env.example
  ICE.push({ urls: import.meta.env.VITE_TURN_URL.split(',').map(u => u.trim()), username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
} else {
  // Запасной публичный ретранслятор Metered OpenRelay: без TURN телефоны на LTE друг друга не находят.
  ICE.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
}

export interface VoicePeer { id: string; speaking: boolean; connected: boolean }
type Analyser = { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> };

import { getAudioCtx as getCtx } from './audioCtx';

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
  const [hasStream, setHasStream] = useState(false);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({});
  const [mySpeaking, setMySpeaking] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const senders = useRef<Map<string, RTCRtpSender>>(new Map());
  const audios = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analysers = useRef<Map<string, Analyser>>(new Map());
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const offerRef = useRef<(id: string) => void>(() => {});
  /** Привязать трансивер к собеседнику: запомнить sender и подать в него микрофон, если он включён. */
  const adoptTransceiver = (id: string, tr: RTCRtpTransceiver) => {
    try { tr.direction = 'sendrecv'; } catch {}
    senders.current.set(id, tr.sender);
    const track = stream.current?.getAudioTracks()[0];
    if (track) tr.sender.replaceTrack(track).catch(() => {});
  };
  const setPeer = (id: string, patch: Partial<VoicePeer>) => setPeers(p => { const base: VoicePeer = p[id] ?? { id, speaking: false, connected: false }; return { ...p, [id]: { ...base, ...patch } }; });

  const detachAnalyser = (id: string) => { const a = analysers.current.get(id); if (a) { try { a.src.disconnect(); a.an.disconnect(); } catch {} analysers.current.delete(id); } };
  const attachAnalyser = (id: string, s: MediaStream) => {
    try {
      detachAnalyser(id);
      const ctx = getCtx(); if (!ctx) return;
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      analysers.current.set(id, { src, an, buf: new Uint8Array(new ArrayBuffer(an.frequencyBinCount)) });
    } catch { /* без индикации речи */ }
  };

  const closePeer = useCallback((id: string) => {
    pcs.current.get(id)?.close(); pcs.current.delete(id); senders.current.delete(id); pendingIce.current.delete(id);
    const a = audios.current.get(id); if (a) { a.srcObject = null; a.remove(); audios.current.delete(id); }
    detachAnalyser(id);
    setPeers(p => { const n = { ...p }; delete n[id]; return n; });
  }, []);

  const makePeer = useCallback((id: string) => {
    const existing = pcs.current.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcs.current.set(id, pc);
    // Инициатор создаёт аудио-канал сам; отвечающий возьмёт его из offer
    // (Safari не переиспользует заранее созданный трансивер — появлялся второй, только на приём).
    if (me < id) adoptTransceiver(id, pc.addTransceiver('audio', { direction: 'sendrecv' }));

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
    pc.onnegotiationneeded = () => { if (me < id) offerRef.current(id); };
    setPeer(id, {});
    // Сообщаем собеседнику, что готовы: инициатор в ответ пришлёт (или повторит) offer.
    send({ t: 'rtc', to: id, data: { ready: true } });
    return pc;
  }, [me, send, closePeer]); // eslint-disable-line

  /** Инициатор: создать и отправить offer (или повторить уже созданный). */
  const offer = useCallback(async (id: string) => {
    const pc = pcs.current.get(id); if (!pc) return;
    try {
      if (pc.signalingState === 'have-local-offer' && pc.localDescription) { send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } }); return; }
      if (pc.signalingState !== 'stable') return;
      const o = await pc.createOffer(); await pc.setLocalDescription(o);
      send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } });
    } catch { /* повторим по следующему ready */ }
  }, [send]);
  offerRef.current = offer;

  // Входящий сигналинг
  useEffect(() => opts.onRtc(async (from, data) => {
    if (!enabled) return;
    const pc = makePeer(from);
    try {
      if (data.ready) {
        // Собеседник готов. Инициатор шлёт offer; если соединение уже было и сломалось — пересоздаём.
        if (me < from) { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { closePeer(from); makePeer(from); } else offer(from); }
        return;
      }
      if (data.sdp) {
        if (data.sdp.type === 'offer' && pc.signalingState !== 'stable' && me < from) return; // гонка: инициатор игнорирует встречный offer
        await pc.setRemoteDescription(data.sdp);
        for (const c of pendingIce.current.get(from) ?? []) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.current.delete(from);
        if (data.sdp.type === 'offer') {
          const tr = pc.getTransceivers().find(t => t.receiver.track?.kind === 'audio') ?? pc.getTransceivers()[0];
          if (tr) adoptTransceiver(from, tr);
          const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else pendingIce.current.set(from, [...(pendingIce.current.get(from) ?? []), data.candidate]);
      }
    } catch { /* устаревшее сообщение */ }
  }), [enabled, makePeer, send, me, offer, closePeer]); // eslint-disable-line

  // Набор собеседников = все онлайн в комнате
  const othersKey = opts.others.slice().sort().join(',');
  useEffect(() => {
    if (!enabled) { for (const id of [...pcs.current.keys()]) closePeer(id); return; }
    const want = new Set(opts.others);
    for (const id of [...pcs.current.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) makePeer(id);
  }, [enabled, othersKey, makePeer, closePeer]); // eslint-disable-line

  // Сторож: пересоздаём сломанные соединения, перезапускаем подвисшие, при возврате в приложение — сразу.
  const disconnectedSince = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const want = new Set(opts.others);
      for (const id of want) {
        const pc = pcs.current.get(id);
        if (!pc) { makePeer(id); continue; }
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') { closePeer(id); makePeer(id); disconnectedSince.current.delete(id); continue; }
        if (st === 'disconnected') {
          const since = disconnectedSince.current.get(id) ?? Date.now();
          disconnectedSince.current.set(id, since);
          if (Date.now() - since > 4000) {
            if (me < id && pc.signalingState === 'stable') {
              pc.createOffer({ iceRestart: true }).then(o => pc.setLocalDescription(o)).then(() => send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } })).catch(() => {});
            } else send({ t: 'rtc', to: id, data: { ready: true } });
            disconnectedSince.current.set(id, Date.now());
          }
        } else disconnectedSince.current.delete(id);
        // соединение есть, но дорожки нет дольше 8 с — попросить offer заново
        if (st === 'connected' && !audios.current.get(id) && me > id) send({ t: 'rtc', to: id, data: { ready: true } });
      }
    };
    const t = setInterval(check, 3000);
    const onVis = () => { if (document.visibilityState === 'visible') { getCtx(); setTimeout(check, 300); audios.current.forEach(a => a.play().catch(() => {})); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, othersKey, makePeer, closePeer, me, send]); // eslint-disable-line

  // iOS может отклонить play() вне жеста — повторяем при любом касании
  useEffect(() => {
    if (!enabled) return;
    const kick = () => { getCtx(); audios.current.forEach(a => { if (a.paused) a.play().catch(() => {}); }); };
    window.addEventListener('pointerdown', kick, { passive: true });
    document.addEventListener('visibilitychange', kick);
    return () => { window.removeEventListener('pointerdown', kick); document.removeEventListener('visibilitychange', kick); };
  }, [enabled]);

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

  /**
   * Микрофон захватываем один раз при входе в канал и держим ВЫКЛЮЧЕННЫМ (track.enabled = false).
   * Причина: iOS Safari не воспроизводит входящий WebRTC-звук, пока приложение само не
   * запросило микрофон. Кнопка — это mute/unmute, без пересогласований.
   */
  const acquire = useCallback(async (): Promise<MediaStreamTrack | null> => {
    if (stream.current) return stream.current.getAudioTracks()[0] ?? null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      stream.current = s;
      const track = s.getAudioTracks()[0];
      track.enabled = false;
      track.onended = () => { if (stream.current === s) { stream.current = null; setHasStream(false); micOffRef.current(); } };
      for (const sender of senders.current.values()) sender.replaceTrack(track).catch(() => {});
      attachAnalyser('__me', s);
      setHasStream(true); setError(null);
      return track;
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Микрофон недоступен');
      return null;
    }
  }, []);
  useEffect(() => { if (enabled) acquire(); }, [enabled, acquire]);

  const micOn = useCallback(async () => {
    const track = await acquire(); if (!track) return;
    track.enabled = true;
    setMic(true);
    send({ t: 'voice', on: true });
  }, [send, acquire]);

  const micOffRef = useRef<() => void>(() => {});
  const micOff = useCallback(() => {
    const track = stream.current?.getAudioTracks()[0]; if (track) track.enabled = false;
    setMic(false); setMySpeaking(false);
    send({ t: 'voice', on: false });
  }, [send]);
  micOffRef.current = micOff;

  const release = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; detachAnalyser('__me'); setHasStream(false); };
  const leave = useCallback(() => {
    if (mic) micOff();
    for (const id of [...pcs.current.keys()]) closePeer(id);
    release();
  }, [mic, micOff, closePeer]); // eslint-disable-line
  useEffect(() => () => { release(); for (const id of [...pcs.current.keys()]) closePeer(id); }, []); // eslint-disable-line
  useEffect(() => { if (!enabled) release(); }, [enabled]); // eslint-disable-line

  /** Диагностика для скрытой панели. */
  const debug = () => [...pcs.current.entries()].map(([id, pc]) => {
    const a = audios.current.get(id);
    const snd = senders.current.get(id);
    return `${id.slice(0, 6)} · ${pc.connectionState}/${pc.iceConnectionState}/${pc.signalingState} · tx:${snd?.track ? (snd.track.enabled ? 'on' : 'muted') : 'none'} · rx:${a?.srcObject ? (a.paused ? 'paused' : 'playing') : 'none'}`;
  }).concat([`mic:${hasStream ? (mic ? 'on' : 'muted') : 'no-stream'} · others:${opts.others.length} · enabled:${enabled}`]);

  return { mic, toggle: () => (mic ? micOff() : micOn()), leave, peers, mySpeaking, error, debug };
}
