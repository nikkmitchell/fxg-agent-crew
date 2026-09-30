import { makeEarthSky, type EarthSkySnapshot, type SkyReference } from "../../shared/earth-sky";
import { EarthSkyView } from "./earth-sky-view";

/** A reference-night preview advances at real speed. Live mode uses actual UTC. */
export class EarthSkyClock {
  readonly view: EarthSkyView;
  private intervalStart: number;
  private readonly epoch: number;
  private readonly started: number;
  private current: EarthSkySnapshot;
  private next: EarthSkySnapshot;
  constructor(private readonly catalogue: number[][], private readonly reference: SkyReference, private readonly live = true, now = Date.now()) {
    this.started = now;
    this.epoch = live ? now : Date.parse(reference.at);
    this.intervalStart = this.epoch;
    this.current = this.snapshot(this.epoch);
    this.next = this.snapshot(this.epoch + 60_000);
    this.view = new EarthSkyView(this.current);
    this.view.setInterval(this.current, this.next);
  }
  private snapshot(ms: number) {
    return makeEarthSky(this.catalogue, { ...this.reference, at: new Date(ms).toISOString() });
  }
  private refresh(): void {
    this.current = this.snapshot(this.intervalStart);
    this.next = this.snapshot(this.intervalStart + 60_000);
    this.view.setInterval(this.current, this.next);
  }
  advance(now = Date.now()): number {
    const at = this.live ? now : this.epoch + now - this.started;
    if (at >= this.intervalStart + 60_000 && at < this.intervalStart + 120_000) {
      this.intervalStart += 60_000;
      this.current = this.next;
      this.next = this.snapshot(this.intervalStart + 60_000);
      this.view.setInterval(this.current, this.next);
    } else if (at < this.intervalStart || at >= this.intervalStart + 120_000) {
      this.intervalStart = at;
      this.refresh();
    }
    return (at - this.intervalStart) / 60_000;
  }
}
