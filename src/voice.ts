import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMsg } from '../shared/protocol';
import { getAudioCtx } from './audioCtx';

/**
 * Голосовой канал («рация»): все в комнате слышат друг друга, кнопка включает
 * и выключает только свой микрофон.
 *
 * Схема — каноническая «perfect negotiation» (MDN/W3C):
 *  1. При входе в канал один раз запрашиваем микрофон и держим его выключенным
 *     (track.enabled = false). Это нужно и для iOS: без собственного захвата
 *     Safari не воспроизводит входящий WebRTC-звук.
 *  2. Соединения создаём только после этого. Обе стороны делают addTrack —
 *     одинаково, без трюков с трансиверами.
 *  3. Коллизии предложений решаются политикой «вежливый/невежливый»:
 *     вежливый (больший id) откатывает своё предложение, невежливый игнорирует чужое.
 *  4. Микрофон вкл/выкл — только track.enabled, без пересогласований.
 */

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (import.meta.env.VITE_TURN_URL) {
  ICE.push({ urls: import.meta.env.VITE_TURN_URL.split(',').map(u => u.trim()), username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
} else {
  // Публичный ретранслятор на время тестов. Для постоянной игры заведите свой (см. .env.example).
  ICE.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
}

export interface VoicePeer { id: string; speaking: boolean; connected: boolean }

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement | null;
  analyser: { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> } | null;
  disconnectedAt: number | null;
}

const level = (a: NonNullable<Peer['analyser']>) => { a.an.getByteFrequencyData(a.buf); let s = 0; for (let i = 0; i < a.buf.length; i++) s += a.buf[i]; return s / a.buf.length; };

export function useVoice(opts: {
  me: string;
  /** id всех, кто сейчас онлайн в комнате, кроме меня */
  others: string[];
  /** канал активен: мы в комнате, сокет открыт, пользователь уже касался экрана */
  enabled: boolean;
  send: (m: ClientMsg) => void;
  onRtc: (cb: (from: string, data: any) => void) => () => void;
}) {
  const { me, send, enabled } = opts;
  const [mic, setMic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({});
  const [mySpeaking, setMySpeaking] = useState(false);
  /** 'idle' → 'acquiring' → 'ready' (есть микрофон) | 'denied' (слушаем без микрофона) */
  const [stage, setStage] = useState<'idle' | 'acquiring' | 'ready' | 'denied'>('idle');
  const stream = useRef<MediaStream | null>(null);
  const myAnalyser = useRef<Peer['analyser']>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const othersRef = useRef<string[]>(opts.others); othersRef.current = opts.others;

  const publish = (id: string, patch: Partial<VoicePeer>) => setPeers(p => { const base: VoicePeer = p[id] ?? { id, speaking: false, connected: false }; return { ...p, [id]: { ...base, ...patch } }; });

  const makeAnalyser = (s: MediaStream): Peer['analyser'] => {
    try {
      const ctx = getAudioCtx(); if (!ctx) return null;
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      return { src, an, buf: new Uint8Array(new ArrayBuffer(an.frequencyBinCount)) };
    } catch { return null; }
  };
  const dropAnalyser = (a: Peer['analyser']) => { if (a) { try { a.src.disconnect(); a.an.disconnect(); } catch {} } };

  // ── 1. Микрофон ──
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStage('acquiring');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        const track = s.getAudioTracks()[0];
        track.enabled = false;
        track.onended = () => { if (stream.current === s) { setMic(false); send({ t: 'voice', on: false }); } };
        stream.current = s;
        myAnalyser.current = makeAnalyser(s);
        setStage('ready'); setError(null);
      })
      .catch(e => {
        if (cancelled) return;
        setStage('denied');
        setError(e?.name === 'NotAllowedError' ? 'Микрофон запрещён — вы слышите других, но вас не слышно. Разрешите доступ в настройках.' : 'Микрофон недоступен — вы только слушаете.');
      });
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
      dropAnalyser(myAnalyser.current); myAnalyser.current = null;
      setStage('idle'); setMic(false);
    };
  }, [enabled]); // eslint-disable-line

  // ── 2. Соединения ──
  const closePeer = useCallback((id: string) => {
    const p = peersRef.current.get(id); if (!p) return;
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onnegotiationneeded = p.pc.onconnectionstatechange = null;
    p.pc.close();
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    dropAnalyser(p.analyser);
    peersRef.current.delete(id);
    setPeers(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const createPeer = useCallback((id: string): Peer => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer: Peer = { pc, polite: me > id, makingOffer: false, ignoreOffer: false, audio: null, analyser: null, disconnectedAt: null };
    peersRef.current.set(id, peer);

    const s = stream.current;
    if (s) for (const t of s.getTracks()) pc.addTrack(t, s);
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send({ t: 'rtc', to: id, data: { description: pc.localDescription } });
      } catch { /* повторится при следующем negotiationneeded */ }
      finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ t: 'rtc', to: id, data: { candidate } }); };
    pc.ontrack = ({ track, streams }) => {
      const ms = streams[0] ?? new MediaStream([track]);
      if (!peer.audio) {
        const a = document.createElement('audio'); a.autoplay = true; (a as any).playsInline = true; a.style.display = 'none';
        document.body.appendChild(a); peer.audio = a;
      }
      peer.audio.srcObject = ms;
      peer.audio.play().catch(() => { /* повторим по касанию */ });
      dropAnalyser(peer.analyser); peer.analyser = makeAnalyser(ms);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { peer.disconnectedAt = null; publish(id, { connected: true }); }
      else if (st === 'disconnected') { peer.disconnectedAt ??= Date.now(); publish(id, { connected: false }); }
      else if (st === 'failed') { pc.restartIce(); peer.disconnectedAt ??= Date.now(); publish(id, { connected: false }); }
    };
    publish(id, {});
    return peer;
  }, [me, send]);

  // Создаём/закрываем соединения только когда микрофон определился (ready | denied)
  const peersWanted = stage === 'ready' || stage === 'denied';
  const othersKey = opts.others.slice().sort().join(',');
  useEffect(() => {
    if (!enabled || !peersWanted) { for (const id of [...peersRef.current.keys()]) closePeer(id); return; }
    const want = new Set(opts.others);
    for (const id of [...peersRef.current.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) if (!peersRef.current.has(id)) createPeer(id);
  }, [enabled, peersWanted, othersKey, createPeer, closePeer]); // eslint-disable-line

  // ── 3. Сигналинг (perfect negotiation) ──
  useEffect(() => opts.onRtc(async (from, data) => {
    if (!enabled || !peersWanted) return;
    if (!othersRef.current.includes(from)) return;
    const peer = peersRef.current.get(from) ?? createPeer(from);
    const { pc } = peer;
    try {
      if (data.description) {
        const desc: RTCSessionDescriptionInit = data.description;
        const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(desc); // для вежливого — неявный откат своего offer
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          send({ t: 'rtc', to: from, data: { description: pc.localDescription } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch { /* устаревшее сообщение — следующий negotiationneeded всё поправит */ }
  }), [enabled, peersWanted, createPeer, send]); // eslint-disable-line

  // ── 4. Сторож: пересоздать соединение, если оно не ожило за 8 с; по касанию/возврату — запустить звук ──
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      for (const [id, p] of peersRef.current) {
        if (p.disconnectedAt && Date.now() - p.disconnectedAt > 8000 && othersRef.current.includes(id)) { closePeer(id); createPeer(id); }
      }
    };
    const kick = () => { getAudioCtx(); peersRef.current.forEach(p => { if (p.audio?.paused) p.audio.play().catch(() => {}); }); };
    const onVis = () => { if (document.visibilityState === 'visible') { kick(); setTimeout(check, 500); } };
    const t = setInterval(check, 4000);
    window.addEventListener('pointerdown', kick, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); window.removeEventListener('pointerdown', kick); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, createPeer, closePeer]);

  // ── 5. Кто говорит ──
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const mine = myAnalyser.current;
      setMySpeaking(!!mine && mic && level(mine) > 18);
      setPeers(prev => {
        let changed = false; const n = { ...prev };
        for (const [id, p] of peersRef.current) { if (!p.analyser || !n[id]) continue; const sp = level(p.analyser) > 18; if (n[id].speaking !== sp) { n[id] = { ...n[id], speaking: sp }; changed = true; } }
        return changed ? n : prev;
      });
    }, 120);
    return () => clearInterval(t);
  }, [enabled, mic]);

  // ── 6. Кнопка ──
  const toggle = useCallback(() => {
    const track = stream.current?.getAudioTracks()[0];
    if (!track) { if (stage === 'denied') setError('Микрофон запрещён — разрешите доступ в настройках браузера'); return; }
    const on = !track.enabled;
    track.enabled = on;
    setMic(on); if (!on) setMySpeaking(false);
    send({ t: 'voice', on });
  }, [send, stage]);

  const leave = useCallback(() => {
    if (mic) send({ t: 'voice', on: false });
    for (const id of [...peersRef.current.keys()]) closePeer(id);
  }, [mic, send, closePeer]);

  /** Диагностика для скрытой панели (долгое нажатие на кнопку микрофона). */
  const debug = () => [
    `me:${me.slice(0, 6)} · mic:${stage}${stage === 'ready' ? (mic ? '/on' : '/muted') : ''} · others:${opts.others.length}`,
    ...[...peersRef.current.entries()].map(([id, p]) => {
      const snd = p.pc.getSenders().find(s => s.track);
      return `${id.slice(0, 6)}${p.polite ? ' (polite)' : ''} · ${p.pc.connectionState}/${p.pc.iceConnectionState}/${p.pc.signalingState} · tx:${snd ? (snd.track!.enabled ? 'on' : 'muted') : 'none'} · rx:${p.audio?.srcObject ? (p.audio.paused ? 'paused' : 'playing') : 'none'}`;
    }),
  ];

  return { mic, toggle, leave, peers, mySpeaking, error, debug };
}
