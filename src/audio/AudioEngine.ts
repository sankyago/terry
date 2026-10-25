/** Простий синтезований звук без зовнішніх файлів: двигун, покажчики, удар, успіх. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private muted = false;
  private active = false;

  /** Викликати з обробника жесту користувача (політика автовідтворення). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 500;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      this.osc1.connect(this.filter);
      this.osc2.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.osc1.start();
      this.osc2.start();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }

  /** Двигун звучить лише під час активної спроби. */
  setActive(a: boolean) {
    this.active = a;
    if (!a && this.engineGain && this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  updateEngine(speedMs: number, throttle: number, running: boolean) {
    if (!this.ctx || !this.osc1 || !this.osc2 || !this.engineGain || !this.filter) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + Math.min(1, Math.abs(speedMs) / 10) * 0.55 + throttle * 0.3;
    const f = 38 + rpm * 70;
    this.osc1.frequency.setTargetAtTime(f, t, 0.08);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.filter.frequency.setTargetAtTime(280 + throttle * 600 + rpm * 300, t, 0.1);
    const g = this.active && running ? 0.035 + throttle * 0.035 : 0;
    this.engineGain.gain.setTargetAtTime(g, t, 0.1);
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  tick(on: boolean) {
    this.blip(on ? 1500 : 1100, 0.03, 'square', 0.05);
  }

  thud(strength: number) {
    this.blip(70, 0.25, 'sine', Math.min(0.5, 0.15 + strength * 0.08));
    this.blip(140, 0.12, 'triangle', 0.08);
  }

  success() {
    this.blip(660, 0.25, 'sine', 0.15);
    this.blip(990, 0.35, 'sine', 0.15, 0.15);
  }

  fail() {
    this.blip(330, 0.3, 'triangle', 0.12);
    this.blip(247, 0.4, 'triangle', 0.12, 0.18);
  }

  suspend() {
    void this.ctx?.suspend().catch(() => {});
  }

  resume() {
    void this.ctx?.resume().catch(() => {});
  }

  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
