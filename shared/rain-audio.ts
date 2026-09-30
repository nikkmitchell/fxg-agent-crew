/** Continuous procedural rain: bounded state, no samples, loops or frame timers. */
export class RainTexture {
  private seed: number;
  private fast = 0;
  private middle = 0;
  private low = 0;
  private side = 0;
  private wash = 1;
  private washTarget = 1;
  private tint = .5;
  private tintTarget = .5;
  private driftIn = 0;
  private dropIn = 0;
  private readonly fastRate: number;
  private readonly midRate: number;
  private readonly lowRate: number;
  private readonly driftRate: number;
  private readonly voices = Array.from({ length: 4 }, () => ({
    age: 1, life: .1, amplitude: 0, pan: 0, filtered: 0, rate: .1,
  }));

  constructor(readonly sampleRate: number, seed: number) {
    this.seed = (seed >>> 0) || 1;
    this.fastRate = 1 - Math.exp(-2 * Math.PI * 3800 / sampleRate);
    this.midRate = 1 - Math.exp(-2 * Math.PI * 650 / sampleRate);
    this.lowRate = 1 - Math.exp(-2 * Math.PI * 100 / sampleRate);
    this.driftRate = 1 - Math.exp(-1 / (sampleRate * 2.5));
  }

  private random(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  render(left: Float32Array, right: Float32Array): void {
    const dt = 1 / this.sampleRate;
    for (let i = 0; i < left.length; i++) {
      if (--this.driftIn <= 0) {
        this.washTarget = .86 + this.random() * .28;
        this.tintTarget = .3 + this.random() * .4;
        this.driftIn = this.sampleRate * (3 + this.random() * 8);
      }
      if (--this.dropIn <= 0) {
        const voice = this.voices.find(v => v.age >= v.life);
        if (voice) {
          voice.age = 0; voice.life = .06 + this.random() * .19;
          voice.amplitude = .035 + this.random() ** 2 * .12;
          voice.pan = this.random() * 1.6 - .8;
          voice.filtered = 0;
          voice.rate = 1 - Math.exp(-2 * Math.PI * (900 + this.random() * 3100) / this.sampleRate);
        }
        // Exponentially distributed intervals: no regularly scheduled patter.
        this.dropIn = Math.max(1, -Math.log(Math.max(1e-9, this.random())) * this.sampleRate / 8);
      }
      this.wash += (this.washTarget - this.wash) * this.driftRate;
      this.tint += (this.tintTarget - this.tint) * this.driftRate;
      const white = this.random() * 2 - 1;
      this.fast += (white - this.fast) * this.fastRate;
      this.middle += (white - this.middle) * this.midRate;
      this.low += (white - this.low) * this.lowRate;
      this.side += ((this.random() * 2 - 1) - this.side) * this.midRate;
      const wash = ((this.fast - this.middle) * .35 + this.middle * this.tint + this.low * .4) * this.wash;
      let l = wash + this.side * .08, r = wash - this.side * .08;
      for (const voice of this.voices) {
        if (voice.age >= voice.life) continue;
        voice.age += dt;
        const phase = Math.min(1, voice.age / voice.life);
        // Soft attack, then a short noise-only splash; no musical drip tones.
        const envelope = Math.min(1, voice.age / .004) * (1 - phase) ** 3;
        voice.filtered += (white - voice.filtered) * voice.rate;
        const splash = voice.filtered * envelope * voice.amplitude;
        l += splash * (1 - voice.pan); r += splash * (1 + voice.pan);
      }
      left[i] = l; right[i] = r;
    }
  }
}
