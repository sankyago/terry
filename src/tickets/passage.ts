import type { ActorSpec } from './types';

export type PassagePosition = 'first' | 'middle' | 'last';

/** Черговість визначається поведінкою учасників, а не формулюванням відповіді. */
export function passagePosition(ticket: { actors: ActorSpec[] }): PassagePosition {
  const moving = ticket.actors.filter((a) => !a.parked && !a.atFault);
  const after = moving.filter((a) => a.yieldsToEgo).length;
  return after === 0 ? 'last' : after === moving.length ? 'first' : 'middle';
}

/** Строго менше 30 % навіть для короткого заїзду: для 20 білетів — щонайбільше 5. */
export const lastPlaceLimit = (count: number) => Math.max(0, Math.ceil(count * 0.3) - 1);
