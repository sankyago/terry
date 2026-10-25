import type { PointerEvent as RPointerEvent } from 'react';
import { useRef } from 'react';
import type { Game } from '../game/Game';
import type { Gear } from '../sim/vehicle';
import { GEARS } from '../sim/vehicle';
import { wrapAngle } from '../sim/math';

interface Props {
  game: Game;
  gear: Gear;
  touch: boolean;
}

/**
 * Екранні органи керування. Кожен елемент захоплює свій pointer (setPointerCapture),
 * тому кермо і педаль працюють одночасно двома пальцями. Значення пишуться напряму
 * в InputManager без React state.
 */
export function TouchControls({ game, gear, touch }: Props) {
  return (
    <div className="controls">
      {touch && <SteeringWheel game={game} />}
      <div className="controls-right">
        <GearSelector game={game} gear={gear} />
        {touch && (
          <div className="pedals">
            <Pedal game={game} kind="brake" />
            <Pedal game={game} kind="gas" />
          </div>
        )}
      </div>
    </div>
  );
}

const MAX_WHEEL = 2.4; // рад (~137°) — повний хід керма

function SteeringWheel({ game }: { game: Game }) {
  const ref = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const st = useRef({ id: -1, angle: 0, last: 0 });

  const setVisual = (a: number, animate: boolean) => {
    const rim = rimRef.current;
    if (!rim) return;
    rim.style.transition = animate ? 'transform 0.25s ease-out' : 'none';
    rim.style.transform = `rotate(${a}rad)`;
  };
  const polar = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { a: Math.atan2(dx, -dy), d: Math.hypot(dx, dy) };
  };
  const release = () => {
    st.current.id = -1;
    st.current.angle = 0;
    game.input.touchSteer = null;
    setVisual(0, true);
  };

  return (
    <div
      ref={ref}
      className="wheel"
      onPointerDown={(e) => {
        if (st.current.id !== -1) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        st.current.id = e.pointerId;
        st.current.last = polar(e).a;
        game.input.touchSteer = st.current.angle / MAX_WHEEL;
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (e.pointerId !== s.id) return;
        const { a, d } = polar(e);
        const delta = wrapAngle(a - s.last);
        s.last = a;
        if (d < 14) return; // біля центру кут нестабільний
        s.angle = Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, s.angle + delta));
        game.input.touchSteer = s.angle / MAX_WHEEL;
        setVisual(s.angle, false);
      }}
      onPointerUp={(e) => e.pointerId === st.current.id && release()}
      onLostPointerCapture={(e) => e.pointerId === st.current.id && release()}
      onPointerCancel={() => {
        release();
        game.interrupt();
      }}
      role="slider"
      aria-label="Кермо"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={0}
    >
      <div ref={rimRef} className="wheel-rim">
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="44" className="rim" />
          <circle cx="50" cy="50" r="11" className="hub" />
          <path d="M50 39V8M39 52L10 62M61 52l29 10" className="spoke" />
          <rect x="47" y="3" width="6" height="9" rx="2" className="marker" />
        </svg>
      </div>
    </div>
  );
}

function Pedal({ game, kind }: { game: Game; kind: 'gas' | 'brake' }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const id = useRef(-1);

  const set = (v: number) => {
    if (kind === 'gas') game.input.touchThrottle = v;
    else game.input.touchBrake = v;
    if (fillRef.current) fillRef.current.style.transform = `scaleY(${v})`;
  };
  // Вище на педалі — сильніше натискання (30–100 %).
  const fromEvent = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    return 0.3 + 0.7 * t;
  };
  const release = () => {
    id.current = -1;
    set(0);
  };

  return (
    <div
      className={`pedal ${kind}`}
      onPointerDown={(e) => {
        if (id.current !== -1) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        id.current = e.pointerId;
        set(fromEvent(e));
      }}
      onPointerMove={(e) => e.pointerId === id.current && set(fromEvent(e))}
      onPointerUp={(e) => e.pointerId === id.current && release()}
      onLostPointerCapture={(e) => e.pointerId === id.current && release()}
      onPointerCancel={() => {
        release();
        game.interrupt();
      }}
      role="button"
      aria-label={kind === 'gas' ? 'Педаль газу' : 'Педаль гальма'}
    >
      <div ref={fillRef} className="pedal-fill" />
      <span className="pedal-label">{kind === 'gas' ? 'Газ' : 'Гальмо'}</span>
      <span className="pedal-grip" aria-hidden />
    </div>
  );
}

const GEAR_TITLES: Record<Gear, string> = {
  P: 'Паркування',
  R: 'Задній хід',
  N: 'Нейтраль',
  D: 'Рух вперед',
};

function GearSelector({ game, gear }: { game: Game; gear: Gear }) {
  return (
    <div className="gears glass" role="radiogroup" aria-label="Селектор передач">
      {GEARS.map((g) => (
        <button
          key={g}
          role="radio"
          aria-checked={gear === g}
          title={GEAR_TITLES[g]}
          className={gear === g ? 'active' : ''}
          onPointerDown={(e) => {
            e.preventDefault();
            game.requestGear(g);
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}
