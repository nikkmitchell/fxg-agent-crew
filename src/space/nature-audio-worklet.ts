import { NatureTexture } from "../../shared/nature-audio";
import type { NatureKind } from "../../shared/nature-retreat";
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class NatureProcessor extends AudioWorkletProcessor {
  private readonly texture: NatureTexture;
  private audible = false;
  constructor(options: { processorOptions?: { mode?: NatureKind; seed?: number } } = {}) {
    super();
    this.texture = new NatureTexture(sampleRate, options.processorOptions?.mode ?? "sakura", options.processorOptions?.seed ?? 1);
    this.port.onmessage = (event: MessageEvent<{ audible: boolean }>) => { this.audible = event.data.audible; };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const channels = outputs[0];
    if (this.audible && channels?.length === 2) this.texture.render(channels[0], channels[1]);
    return true;
  }
}
registerProcessor("nature-texture", NatureProcessor);
