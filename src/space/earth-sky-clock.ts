import { makeEarthSky, type SkyReference } from "../../shared/earth-sky";
import catalogue from "./sky/hyg-bright.json";
import { EarthSkyView } from "./earth-sky-view";

/** A reference-night preview advances at real speed. Live mode uses actual UTC. */
export class EarthSkyClock {
  readonly view: EarthSkyView;
  private intervalStart: number;
  private readonly epoch: number;
  private readonly started: number;
  constructor(private readonly reference: SkyReference, private readonly live = true, now = Date.now()) {
    this.started = now;
    this.epoch = live ? now : Date.parse(reference.at);
    this.intervalStart = this.epoch;
    this.view = new EarthSkyView(this.snapshot(this.epoch));
    this.refresh();
  }
  private snapshot(ms: number) {
    return makeEarthSky(catalogue.stars, { ...this.reference, at: new Date(ms).toISOString() });
  }
  private refresh(): void {
    this.view.setInterval(this.snapshot(this.intervalStart), this.snapshot(this.intervalStart + 60_000));
  }
  advance(now = Date.now()): number {
    const at = this.live ? now : this.epoch + now - this.started;
    if (at < this.intervalStart || at >= this.intervalStart + 60_000) {
      this.intervalStart = at;
      this.refresh();
    }
    return (at - this.intervalStart) / 60_000;
  }
}
