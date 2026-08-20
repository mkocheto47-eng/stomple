import { COLORS, UNB, ballBg, btnPrimary } from './theme';

const Ball = ({ ci, size = 22 }: { ci: number; size?: number }) => <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: ballBg(ci), verticalAlign: 'middle', boxShadow: 'inset 0 -3px 4px rgba(0,0,0,.22)', margin: '0 2px' }} />;
const Stomper = () => <span style={{ display: 'inline-block', width: 16, height: 24, verticalAlign: 'middle', position: 'relative', margin: '0 4px' }}><span style={{ position: 'absolute', left: 3, right: 3, top: 0, bottom: 5, borderRadius: '46% 46% 24% 24%', background: 'linear-gradient(100deg,#fff,#e6e3da 70%,#cfcabb)', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} /><span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 7, borderRadius: '50%', background: COLORS[3].hex }} /></span>;

/** Мини-схема 3×3: центр — стомпер, вокруг — шарики */
function Mini({ cells, hi }: { cells: (number | 'S' | null)[]; hi?: number[] }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 3, background: 'linear-gradient(180deg,#5b8ec9,#3e6ba6)', padding: 6, borderRadius: 10, flex: 'none' }}>
    {cells.map((c, i) => <div key={i} style={{ width: 28, height: 28, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: '12%', borderRadius: '50%', background: '#0f2444', boxShadow: 'inset 0 3px 5px rgba(0,8,25,.7)' }} />
      {typeof c === 'number' && <div style={{ position: 'absolute', inset: '10%', borderRadius: '50%', background: ballBg(c), boxShadow: '0 2px 3px rgba(8,20,45,.5)', outline: hi?.includes(i) ? '2px solid #7df0a0' : 'none', outlineOffset: 1 }} />}
      {c === 'S' && <div style={{ position: 'absolute', left: '30%', width: '40%', top: '8%', bottom: '18%', borderRadius: '46% 46% 24% 24%', background: 'linear-gradient(100deg,#fff,#e6e3da)', boxShadow: '0 1px 2px rgba(0,0,0,.4)' }} />}
      {c === 'S' && <div style={{ position: 'absolute', left: '22%', width: '56%', bottom: '12%', height: '18%', borderRadius: '50%', background: COLORS[3].hex }} />}
    </div>)}
  </div>;
}

export default function Rules({ onClose }: { onClose: () => void }) {
  const h = (t: string) => <div style={{ fontFamily: UNB, fontSize: 15, fontWeight: 800, color: '#2b5ea7', marginTop: 6 }}>{t}</div>;
  const p: React.CSSProperties = { margin: 0, lineHeight: 1.5, fontSize: 14, fontWeight: 500 };
  const row: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,28,20,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 40 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '88dvh', overflowY: 'auto', padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, animation: 'popIn .3s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: UNB, fontSize: 20, fontWeight: 900 }}>Как играть</div>
          <button onClick={onClose} aria-label="Закрыть" style={{ border: 'none', background: '#efe9da', borderRadius: 999, width: 32, height: 32, fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <p style={p}>Поле 7×7, 49 шариков: по 7 каждого из шести цветов игроков и 7 белых <Ball ci={6} size={18} /> — они ничьи. У каждого игрока свой цвет и стомпер <Stomper />, которым он топит шарики. Цель раунда — остаться последним, кто может ходить.</p>

        {h('Первый ход')}
        <p style={p}>Поставьте стомпер на любой шарик по краю поля, кроме своего цвета. Шарик тонет, стомпер встаёт на его место.</p>

        {h('Обычный ход')}
        <div style={row}>
          <Mini cells={[0, 2, null, 5, 'S', 1, null, 4, 6]} hi={[0, 1, 3, 5, 7, 8]} />
          <p style={p}>Шагните на любой соседний шарик — по прямой или по диагонали. На пустые лунки и на чужой стомпер наступать нельзя.</p>
        </div>

        {h('Цепочка')}
        <div style={row}>
          <Mini cells={[1, 1, null, 'S', 1, null, null, 1, 2]} hi={[0, 1, 4, 7]} />
          <p style={p}>Если рядом с затопленным шариком лежат шарики того же цвета, можно продолжить и утопить их тоже — в любую сторону, хоть с поворотами, пока цепочка не кончится. Остановиться можно где угодно. Тапните на дальний шарик, чтобы пройти всё сразу, или идите по одному и жмите «Готово».</p>
        </div>

        {h('Прыжок')}
        <p style={p}>Вместо шага можно перенести стомпер на любой шарик <b>своего цвета</b> в любой точке поля. Шарик тонет, а если рядом есть ещё свои — цепочка продолжается как обычно. Белые <Ball ci={6} size={18} /> ничьи, на них прыгать нельзя. Каждый свой шарик, потраченный на прыжок, не принесёт очков в конце.</p>

        {h('Выбывание и очки')}
        <p style={p}>Если в свой ход игроку некуда ступить и не на что прыгнуть — он выбывает из раунда. Последний оставшийся получает <b>3 очка</b> за победу, по <b>1</b> за каждый уцелевший шарик своего цвета и по <b>3</b> за каждый белый <Ball ci={6} size={18} />, оставшийся на поле.</p>

        {h('Победа')}
        <p style={p}>Раунды играются, пока кто-то не наберёт нужную сумму: <b>40</b> очков вдвоём, <b>20</b> втроём, <b>15</b> — при четырёх и больше. Хозяин комнаты может поменять порог перед стартом.</p>

        {h('Тактика')}
        <p style={p}>Берегите свои шарики — они и ваши прыжки, и ваши очки. Белые дороже всего: каждый уцелевший — 3 очка победителю, так что топите их, если побеждать собирается не вы. Не загоняйте себя в угол: стомпер в пустоте без своих шариков — это выбывание.</p>

        <button onClick={onClose} style={{ ...btnPrimary, padding: 14, fontSize: 16, marginTop: 4 }}>Понятно</button>
      </div>
    </div>
  );
}
