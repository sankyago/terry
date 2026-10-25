/**
 * Фіксує окрему подію помилки за переднім фронтом умови.
 * Після спрацювання повторно «зводиться» лише тоді, коли умова була знята
 * (clear) безперервно `rearmAfter` секунд, і не частіше ніж раз на `cooldown`.
 * Так одна тривала помилка не нараховується щокадру.
 */
export class EdgeTrigger {
  private armed = true;
  private clearSince: number | null = null;
  private lastFire = -Infinity;

  constructor(
    private readonly rearmAfter: number,
    private readonly cooldown: number,
  ) {}

  update(t: number, active: boolean, clear: boolean = !active): boolean {
    if (this.armed) {
      if (active && t - this.lastFire >= this.cooldown) {
        this.armed = false;
        this.lastFire = t;
        this.clearSince = null;
        return true;
      }
      return false;
    }
    if (clear) {
      if (this.clearSince === null) this.clearSince = t;
      if (t - this.clearSince >= this.rearmAfter) this.armed = true;
    } else {
      this.clearSince = null;
    }
    return false;
  }

  reset() {
    this.armed = true;
    this.clearSince = null;
    this.lastFire = -Infinity;
  }
}
