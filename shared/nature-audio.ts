import { natureRandom, type NatureKind } from "./nature-retreat.js";

/** Quiet continuous wind/leaf texture or nighttime bed, without recorded loops. */
export class NatureTexture {
  private readonly random: () => number;
  private low = 0;
  private mid = 0;
  private leaf = 0;
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
  private animal = 0;
  private cicadaPhase = 0;
  private chirr = 0;
  private pan = 0;
  private readonly lowRate: number;
  private readonly midRate: number;
  private readonly leafRate: number;
  private readonly glide: number;
  constructor(readonly rate: number, readonly kind: NatureKind, seed: number) {
    this.random = natureRandom(seed);
    this.lowRate = 1 - Math.exp(-2 * Math.PI * 160 / rate);
    this.midRate = 1 - Math.exp(-2 * Math.PI * 1300 / rate);
    this.leafRate = 1 - Math.exp(-2 * Math.PI * 4500 / rate);
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
        this.animal = this.random();
        this.accentAge = 0; this.accentLife = night ? 1.2 + this.random() * 2.7 : 1.5 + this.random() * 2.2;
        this.amplitude = night ? .014 + this.random() * .016 : .065 + this.random() * .055;
        this.frequency = night && this.animal > .65 ? (this.animal > .9 ? 390 : 190) + this.random() * 90 : 2600 + this.random() * 1400;
        this.pan = this.random() * 1.2 - .6;
        this.accent = this.rate * (night ? 7 + this.random() * 16 : 3.5 + this.random() * 7);
      }
      const white = this.random() * 2 - 1;
      this.low += (white - this.low) * this.lowRate;
      this.mid += (white - this.mid) * this.midRate;
      this.leaf += (white - this.leaf) * this.leafRate;
      this.side += ((this.random() * 2 - 1) - this.side) * this.lowRate;
      let wash = (this.low * .7 + (this.mid - this.low) * .13) * this.level * (night ? .45 : 1);
      let accent = 0;
      if (this.accentAge < this.accentLife) {
        this.accentAge += dt;
        const t = Math.min(1, this.accentAge / this.accentLife), envelope = Math.sin(t * Math.PI) ** 2;
        if (night) {
          // A quiet, synthetic evening chorus; one distant call at a time.
          this.phase += Math.PI * 2 * this.frequency * dt;
          if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
          if (this.animal > .9) {
            // Two soft owl-like hoots with a rounded breathy harmonic.
            const phrase = Math.sin(Math.min(1,t/.36)*Math.PI)**4 + Math.sin(Math.max(0,Math.min(1,(t-.48)/.44))*Math.PI)**4;
            accent = (Math.sin(this.phase + Math.sin(t*8.)*.18) + Math.sin(this.phase*2.)*.08) * envelope * phrase * this.amplitude;
          } else if (this.animal > .65) {
            // Irregular throaty frog phrases, rather than a repeating clip.
            const phrase = (.5+.5*Math.sin(t*Math.PI*(8.+this.animal*8.)))**3;
            accent = (Math.sin(this.phase+Math.sin(this.phase*2.1)*.55)*.8+(this.leaf-this.mid)*.7) * envelope * phrase * this.amplitude;
          } else {
            const phrase = (.5+.5*Math.sin(t*Math.PI*(10.+this.animal*13.)))**3;
            accent = (Math.sin(this.phase)*.45+(this.leaf-this.mid)*.7) * envelope * phrase * this.amplitude;
          }
        } else {
          wash *= 1.+envelope*.18;
          const flutter=.65+.35*Math.sin(t*Math.PI*(7.+this.pan*2.))**2;
          accent=(this.leaf-this.mid)*envelope*flutter*this.amplitude;
        }
      }
      if (night) {
        // Low cicada/grass bed, continually generated with slow uneven swells.
        this.cicadaPhase += Math.PI*2*58*dt;
        if(this.cicadaPhase>Math.PI*2)this.cicadaPhase-=Math.PI*2;
        this.chirr += ((this.random()*2-1)-this.chirr)*this.glide;
        wash += (this.leaf-this.mid)*(.004+.012*this.level)*(.65+.35*Math.sin(this.cicadaPhase)**2);
        wash += (this.mid-this.low)*.045*(.65+Math.abs(this.chirr)*3.);
      }
      left[i] = wash + this.side * .035 + accent * (1 - this.pan);
      right[i] = wash - this.side * .035 + accent * (1 + this.pan);
    }
  }
}
