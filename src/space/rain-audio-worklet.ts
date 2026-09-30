import { RainTexture } from "../../shared/rain-audio";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class RainProcessor extends AudioWorkletProcessor {
  private readonly texture: RainTexture;
  private audible = false;
  constructor(options: { processorOptions?: { seed?: number } } = {}) {
    super();
    this.texture = new RainTexture(sampleRate, options.processorOptions?.seed ?? 1);
    this.port.onmessage = (event: MessageEvent<{ audible: boolean }>) => { this.audible = event.data.audible; };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (this.audible && channels?.length === 2) this.texture.render(channels[0], channels[1]);
    // The browser supplies zeroed buffers while quiet; retain the node for unmute.
    return true;
  }
}
registerProcessor("rain-texture", RainProcessor);
