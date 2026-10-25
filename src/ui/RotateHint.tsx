import { useState } from 'react';
import { RotateIcon } from './icons';

/** Ненав'язлива порада повернути телефон; нічого не блокує. */
export function RotateHint() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="rotate-hint glass" role="note">
      <RotateIcon />
      <span>Для зручного керування поверніть телефон горизонтально</span>
      <button className="link" onClick={() => setHidden(true)} aria-label="Закрити пораду">
        Зрозуміло
      </button>
    </div>
  );
}
