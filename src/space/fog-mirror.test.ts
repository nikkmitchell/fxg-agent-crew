import { describe, expect, it, vi } from "vitest";
import { breathMist, drawStillMist } from "./FogMirror";

describe("the fog mirror", () => {
  it("mists only on the out-breath, and only close to the glass", () => {
    expect(breathMist(1, 0.1)).toBe(0);
    expect(breathMist(3.6, 0.1)).toBeGreaterThan(0.5);
    expect(breathMist(3.6, 0.5)).toBe(0);
  });
  it("draws a still mist patch in source-over mode after an earlier wipe", () => {
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const context = {
      globalCompositeOperation: "destination-out",
      createRadialGradient: vi.fn(() => gradient),
      fillStyle: "",
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawStillMist(context, 256, 358);
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(context.createRadialGradient).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalledOnce();
  });
});
