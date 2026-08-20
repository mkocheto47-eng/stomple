import { useEffect, useRef, useState } from 'react';

type Opts = { type?: OscillatorType; vol?: number; when?: number; fe?: number | null; attack?: number; dest?: AudioNode | null };
export type Sfx = 'tap' | 'plop' | 'chain' | 'turn' | 'elim' | 'fanfare' | 'error';

/** Синтезированные звуки и фоновая музыка на WebAudio — без аудиофайлов. */
export function useAudio(sfxOn: boolean, musicOn: boolean, duck = false) {
  const ref = useRef<{ ac: AudioContext | null; master: GainNode | null; music: { timer: number; bus: GainNode } | null }>({ ac: null, master: null, music: null });
  // Браузеры не дают звучать до первого касания — ждём его и только потом запускаем музыку.
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (unlocked) return;
    const unlock = () => { const ac = ctx(); if (ac && ac.state === 'running') setUnlocked(true); else ac?.resume().then(() => setUnlocked(true)); };
    const evs = ['pointerdown', 'touchstart', 'keydown'];
    evs.forEach(e => window.addEventListener(e, unlock, { passive: true }));
    return () => evs.forEach(e => window.removeEventListener(e, unlock));
  }); // eslint-disable-line

  const ctx = () => {
    const r = ref.current;
    if (!r.ac) {
      try { r.ac = new (window.AudioContext || (window as any).webkitAudioContext)(); r.master = r.ac.createGain(); r.master.gain.value = .9; r.master.connect(r.ac.destination); } catch { return null; }
    }
    if (r.ac!.state === 'suspended') r.ac!.resume();
    return r.ac;
  };
  const note = (f: number, dur: number, { type = 'sine', vol = .12, when = 0, fe = null, attack = .01, dest = null }: Opts = {}) => {
    const ac = ctx(); if (!ac) return;
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (fe) o.frequency.exponentialRampToValueAtTime(fe, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o.connect(g); g.connect(dest || ref.current.master!); o.start(t); o.stop(t + dur + .05);
  };
  const sfx = (kind: Sfx) => {
    if (!sfxOn) return;
    if (kind === 'tap') note(1200, .05, { vol: .05, fe: 900 });
    if (kind === 'plop') { note(300, .28, { vol: .22, fe: 95 }); note(900, .06, { type: 'triangle', vol: .05, fe: 300 }); }
    if (kind === 'chain') { note(520, .22, { vol: .16, fe: 150 }); note(1040, .1, { type: 'triangle', vol: .05 }); }
    if (kind === 'turn') { note(523.25, .18, { type: 'triangle', vol: .07 }); note(783.99, .26, { type: 'triangle', vol: .07, when: .08 }); }
    if (kind === 'elim') { note(220, .5, { type: 'triangle', vol: .1, fe: 90 }); note(165, .6, { vol: .08, fe: 70, when: .05 }); }
    if (kind === 'error') note(240, .12, { type: 'triangle', vol: .06, fe: 180 });
    if (kind === 'fanfare') [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => note(f, .45, { type: 'triangle', vol: .11, when: i * .11 }));
  };

  useEffect(() => {
    const r = ref.current;
    const stop = () => {
      if (r.music && r.ac) { clearInterval(r.music.timer); const bus = r.music.bus; bus.gain.exponentialRampToValueAtTime(.001, r.ac.currentTime + .4); setTimeout(() => { try { bus.disconnect(); } catch {} }, 500); r.music = null; }
    };
    if (!musicOn || !unlocked) { stop(); return; }
    const ac = ctx(); if (!ac) return;
    const bus = ac.createGain(); bus.gain.value = .0001; bus.connect(r.master!); bus.gain.exponentialRampToValueAtTime(.5, ac.currentTime + 1.2);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(bus);
    const chords = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
    const base = 261.63, beat = 60 / 84;
    let bar = 0; const start = ac.currentTime + .05;
    const hz = (n: number) => base * Math.pow(2, n / 12);
    const schedule = () => {
      const t0 = start + bar * beat * 4;
      if (t0 - ac.currentTime > beat * 4) return;
      const ch = chords[bar % 4]; const w = t0 - ac.currentTime;
      note(hz(ch[0] - 24), beat * 1.9, { vol: .16, when: w, attack: .05, dest: lp });
      note(hz(ch[0] - 12), beat * .9, { type: 'triangle', vol: .05, when: w + beat * 2, attack: .03, dest: lp });
      [ch[0], ch[1], ch[2], ch[1] + 12, ch[2], ch[1], ch[0] + 12, ch[2]].forEach((n, i) => note(hz(n), beat * .55, { type: 'triangle', vol: .045, when: w + i * beat * .5, attack: .02, dest: lp }));
      if (bar % 2 === 1) note(hz(ch[(bar >> 1) % 3] + 24), beat * 1.4, { vol: .035, when: w + beat * 3, attack: .04, dest: lp });
      bar++;
    };
    schedule(); schedule();
    const timer = window.setInterval(schedule, 400);
    r.music = { timer, bus };
    return stop;
  }, [musicOn, unlocked]);

  // Приглушаем музыку, пока открыт микрофон
  useEffect(() => {
    const r = ref.current; if (!r.music || !r.ac) return;
    r.music.bus.gain.setTargetAtTime(duck ? .12 : .5, r.ac.currentTime, .3);
  }, [duck, musicOn, unlocked]);

  return sfx;
}
