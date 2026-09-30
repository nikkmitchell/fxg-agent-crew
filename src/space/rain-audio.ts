import workletURL from "./rain-audio-worklet.ts?worker&url";

/** One listener's gesture-enabled sound. It owns and disposes every audio resource. */
export class RainAudio {
  private ctx: AudioContext | null = null;
  private source: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private pending: Promise<boolean> | null = null;
  private disposed = false;
  private enabled = false;
  private lastLevel = -1;
  private processing = false;
  private proximity = 0;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly visibility = () => { this.update(this.proximity); };

  constructor(private readonly options = {
    url: workletURL, name: "rain-texture", level: .085, mode: "rain",
  }) { document.addEventListener("visibilitychange", this.visibility); }

  enable(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.pending = this.start().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async start(): Promise<boolean> {
    try {
      const ctx = this.ctx ?? new AudioContext();
      this.ctx = ctx;
      // Resume while still in the gesture, before waiting for the worklet download.
      await ctx.resume();
      if (!this.source) {
        await ctx.audioWorklet.addModule(this.options.url);
        if (this.disposed) return false;
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        this.source = new AudioWorkletNode(ctx, this.options.name, {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { seed, mode: this.options.mode },
        });
        this.gain = ctx.createGain(); this.gain.gain.value = 0;
        this.source.connect(this.gain).connect(ctx.destination);
      }
      return this.enabled = !this.disposed && ctx.state === "running";
    } catch {
      this.release();
      return false;
    }
  }
  mute(): void { this.enabled = false; this.update(0); }
  update(proximity: number): void {
    this.proximity = proximity;
    if (!this.ctx || !this.gain || !this.source) return;
    const level = this.enabled && !document.hidden ? Math.max(0, Math.min(1, proximity)) * this.options.level : 0;
    if (Math.abs(level - this.lastLevel) > .0005 || level === 0 && this.lastLevel !== 0) {
      this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, .5);
      this.lastLevel = level;
    }
    // A hidden tab's animation loop may stop entirely. Finish the fade without it.
    if (level > 0) {
      if (this.quietTimer) clearTimeout(this.quietTimer);
      this.quietTimer = null;
      if (!this.processing) { this.source.port.postMessage({ audible: true }); this.processing = true; }
    } else if (this.processing && !this.quietTimer) {
      this.quietTimer = setTimeout(() => {
        this.source?.port.postMessage({ audible: false }); this.processing = false; this.quietTimer = null;
      }, 4000);
    }
  }
  private release(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.enabled = false; this.processing = false; this.lastLevel = -1;
    this.source?.disconnect(); this.source?.port.close(); this.gain?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null; this.source = null; this.gain = null;
  }
  dispose(): void {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.visibility);
    this.release();
  }
}
