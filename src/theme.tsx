import type { ReactNode } from 'react';

export const COLORS = [
  { hex: '#d94436', name: 'Красный' }, { hex: '#ef8b2d', name: 'Оранжевый' }, { hex: '#f0b929', name: 'Жёлтый' },
  { hex: '#4f9d45', name: 'Зелёный' }, { hex: '#7a4fa3', name: 'Фиолетовый' }, { hex: '#33343a', name: 'Чёрный' }, { hex: '#efece3', name: 'Белый' },
];
export const LOGO_COLORS = ['#d94436', '#ef8b2d', '#f0b929', '#4f9d45', '#2b5ea7', '#7a4fa3', '#22a7c9'];
export const UNB = "'Unbounded', sans-serif";
export const RUB = "'Rubik', sans-serif";

const shade = (hex: string, f: number) => { const n = hex.replace('#', ''); const v = (k: number) => Math.round(parseInt(n.slice(k, k + 2), 16) * f); return `rgb(${v(0)},${v(2)},${v(4)})`; };
export const ballBg = (ci: number) => { const h = COLORS[ci].hex; return `radial-gradient(circle at 30% 24%, rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 16%, rgba(255,255,255,0) 38%), radial-gradient(circle at 45% 40%, ${h} 30%, ${shade(h, .72)} 68%, ${shade(h, .42)} 100%)`; };

export const GLOBAL_CSS = `
html,body{margin:0;padding:0;background:#f6f1e7;overscroll-behavior:none}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
input{outline:none}
button{font-family:${UNB}}
button:focus-visible,input:focus-visible{outline:3px solid #2b5ea7;outline-offset:2px}
@keyframes ballDrop{0%{transform:translateY(0) scale(1);opacity:1}60%{transform:translateY(18%) scale(.62);opacity:.9}100%{transform:translateY(34%) scale(.3);opacity:0}}
@keyframes hop{0%{transform:translateY(0) scale(1)}40%{transform:translateY(-38%) scale(1.06,.94)}100%{transform:translateY(0) scale(1)}}
@keyframes shakeB{0%,100%{transform:translate(0,0) rotate(0)}15%{transform:translate(-6px,2px) rotate(-1deg)}30%{transform:translate(6px,-3px) rotate(1deg)}45%{transform:translate(-5px,-2px) rotate(-.8deg)}60%{transform:translate(5px,3px) rotate(.8deg)}75%{transform:translate(-3px,1px) rotate(-.4deg)}90%{transform:translate(2px,-1px) rotate(.3deg)}}
@keyframes confettiFall{0%{transform:translateY(-10vh) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:.8}}
@keyframes popIn{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes fadeBanner{0%{transform:translateY(-14px) scale(.9);opacity:0}15%{transform:translateY(0) scale(1);opacity:1}80%{opacity:1}100%{opacity:0}}
@keyframes turnIn{0%{transform:translateX(-10px);opacity:0}100%{transform:translateX(0);opacity:1}}
@keyframes chipPulse{0%{box-shadow:0 0 0 0 var(--c)}100%{box-shadow:0 0 0 10px rgba(0,0,0,0)}}
@keyframes toastUp{0%{transform:translateY(16px);opacity:0}100%{transform:translateY(0);opacity:1}}
@keyframes reactPop{0%{transform:translateY(10px) scale(.3);opacity:0}12%{transform:translateY(-4px) scale(1.15);opacity:1}20%{transform:translateY(0) scale(1)}80%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-16px) scale(.9);opacity:0}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

export const card: React.CSSProperties = { background: '#fff', borderRadius: 18, boxShadow: '0 4px 14px rgba(60,50,20,.08)' };
export const btnPrimary: React.CSSProperties = { padding: 16, border: 'none', borderRadius: 18, background: 'linear-gradient(180deg,#4f9d45,#3e8236)', color: '#fff', fontFamily: UNB, fontSize: 18, fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 0 #2d6127, 0 10px 18px rgba(45,97,39,.3)' };
export const btnBlue: React.CSSProperties = { ...btnPrimary, background: 'linear-gradient(180deg,#2b5ea7,#1f4b8b)', boxShadow: '0 6px 0 #163a6e, 0 10px 18px rgba(22,58,110,.3)' };
export const btnSoft: React.CSSProperties = { padding: 12, border: 'none', borderRadius: 14, background: '#efe9da', color: '#55503f', fontFamily: UNB, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
export const btnDisabled: React.CSSProperties = { background: '#e8e2d3', color: '#a49c88', boxShadow: '0 6px 0 #d3ccba', cursor: 'default' };

export const Logo = ({ size }: { size: number }) => (
  <div style={{ fontFamily: UNB, fontSize: size, fontWeight: 900, lineHeight: 1.25 }}>
    {['s', 't', 'o', 'm', 'p', 'l', 'e'].map((ch, i) => <span key={i} style={{ color: LOGO_COLORS[i] }}>{ch}</span>)}
  </div>
);

export const Shell = ({ children }: { children: ReactNode }) => (
  <div style={{ minHeight: '100dvh', background: 'radial-gradient(circle at 50% -10%, #fbf7ee, #f2ecdd)', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: RUB, color: '#2b2b33', overflow: 'hidden', position: 'relative' }}>
    <style>{GLOBAL_CSS}</style>
    <div style={{ width: '100%', maxWidth: 440, flex: 1, display: 'flex', flexDirection: 'column', padding: 'calc(12px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))' }}>{children}</div>
  </div>
);

export const Ball = ({ ci, size, style }: { ci: number; size: number; style?: React.CSSProperties }) => (
  <div style={{ width: size, height: size, borderRadius: '50%', background: ballBg(ci), boxShadow: '0 3px 6px rgba(0,0,0,.2), inset 0 -4px 6px rgba(0,0,0,.22)', flex: 'none', ...style }} />
);

export const Toast = ({ text }: { text: string | null }) => text
  ? <div style={{ position: 'fixed', left: '50%', bottom: 'calc(96px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', background: '#33343a', color: '#fff', borderRadius: 999, padding: '10px 20px', fontWeight: 800, fontSize: 14, zIndex: 30, whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis', animation: 'toastUp .25s ease forwards', boxShadow: '0 8px 20px rgba(0,0,0,.3)' }}>{text}</div>
  : null;
