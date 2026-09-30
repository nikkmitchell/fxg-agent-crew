import { natureRandom, type NatureKind } from "./nature-retreat.js";

/** Quiet continuous wind/leaf texture or nighttime bed, without recorded loops. */
export class NatureTexture {
  private readonly random: () => number;
  private low = 0;
  private mid = 0;
  private side = 0;
  private level = .75;
  private target = .75;
  private drift = 0;
  private accent = 0;
  private accentAge = 2;
  private accentLife = 1;
  private amplitude = 0;
  private phase = 0;
  private frequency = 3000;
  private pan = 0;
  private readonly lowRate: number;
  private readonly midRate: number;
  private readonly glide: number;
  constructor(readonly rate: number, readonly kind: NatureKind, seed: number) {
    this.random = natureRandom(seed);
    this.lowRate = 1 - Math.exp(-2 * Math.PI * 160 / rate);
    this.midRate = 1 - Math.exp(-2 * Math.PI * 1300 / rate);
    this.glide = 1 - Math.exp(-1 / (rate * 3));
  }
  render(left: Float32Array, right: Float32Array) {
    const night = this.kind === "fireflies", dt = 1 / this.rate;
    for (let i = 0; i < left.length; i++) {
      if (--this.drift <= 0) {
        this.target = .55 + this.random() * .4;
        this.drift = this.rate * (4 + this.random() * 9);
      }
      this.level += (this.target - this.level) * this.glide;
      if (--this.accent <= 0) {
        this.accentAge = 0; this.accentLife = night ? .4 + this.random() * .45 : 1 + this.random() * 1.5;
        this.amplitude = night ? .009 + this.random() * .013 : .05 + this.random() * .07;
        this.frequency = 2600 + this.random() * 1400; this.pan = this.random() - .5;
        this.accent = this.rate * (night ? 6 + this.random() * 11 : 3 + this.random() * 8);
      }
      const white = this.random() * 2 - 1;
      this.low += (white - this.low) * this.lowRate;
      this.mid += (white - this.mid) * this.midRate;
      this.side += ((this.random() * 2 - 1) - this.side) * this.lowRate;
      const wash = (this.low * .7 + (this.mid - this.low) * .13) * this.level * (night ? .45 : 1);
      let accent = 0;
      if (this.accentAge < this.accentLife) {
        this.accentAge += dt;
        const t = Math.min(1, this.accentAge / this.accentLife), envelope = Math.sin(t * Math.PI) ** 2;
        if (night) {
          // A tiny distant insect phrase, not a sound emitted by a flashing firefly.
          this.phase += Math.PI * 2 * this.frequency * dt;
          if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
          const phrase = (.5 + .5 * Math.sin(t * Math.PI * 6)) ** 2;
          accent = Math.sin(this.phase) * envelope * phrase * this.amplitude;
        } else accent = (this.mid - this.low) * envelope * this.amplitude;
      }
      left[i] = wash + this.side * .035 + accent * (1 - this.pan);
      right[i] = wash - this.side * .035 + accent * (1 + this.pan);
    }
  }
}
