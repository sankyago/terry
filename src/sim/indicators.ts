export type IndicatorSide = 'none' | 'left' | 'right';

/** Покажчики повороту з автоматичним вимкненням після повернення керма, як у реальному авто. */
export class Indicators {
  side: IndicatorSide = 'none';
  private turnedEnough = false;

  toggle(side: Exclude<IndicatorSide, 'none'>) {
    this.side = this.side === side ? 'none' : side;
    this.turnedEnough = false;
  }

  update(steer: number) {
    if (this.side === 'none') return;
    const dir = this.side === 'right' ? 1 : -1;
    if (steer * dir > 0.45) this.turnedEnough = true;
    else if (this.turnedEnough && steer * dir < 0.12) {
      this.side = 'none';
      this.turnedEnough = false;
    }
  }

  reset() {
    this.side = 'none';
    this.turnedEnough = false;
  }

  /** Фаза блимання (≈1,5 Гц) від часу симуляції. */
  static lit(time: number) {
    return Math.floor(time * 3) % 2 === 0;
  }
}
