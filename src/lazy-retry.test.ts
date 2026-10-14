import { describe, expect, it, vi } from "vitest";
import { failedModuleUrl, retrying } from "./lazy-retry";

const dropped = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

describe("a lazily loaded part whose fetch drops (Kerf, 2026-10-14)", () => {
  it("is asked for again under a new address, since the browser keeps the failure for the old one", async () => {
    const load = vi.fn().mockRejectedValue(dropped("https://saha.ing/assets/HeadsetControls-abc.js"));
    const importUrl = vi.fn().mockResolvedValue({ default: "the part" });
    await expect(retrying(load, { waits: [0, 0], importUrl })()).resolves.toEqual({ default: "the part" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(importUrl).toHaveBeenCalledWith("https://saha.ing/assets/HeadsetControls-abc.js?retry=1");
  });

  it("hands the module to pick, for a part that is one export of its file", async () => {
    const load = vi.fn().mockRejectedValue(dropped("https://saha.ing/assets/H.js"));
    const importUrl = vi.fn().mockResolvedValue({ EnterHeadsetButton: "the button" });
    const got = await retrying(load, { waits: [0], importUrl, pick: (m) => ({ default: m.EnterHeadsetButton }) })();
    expect(got).toEqual({ default: "the button" });
  });

  it("tries the load itself again when the error names no file, and gives up with the last error", async () => {
    const load = vi.fn().mockRejectedValue(new Error("something else"));
    await expect(retrying(load, { waits: [0, 0] })()).rejects.toThrow("something else");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("reads the file out of Chrome's and Firefox's wording, and nothing out of anything else", () => {
    expect(failedModuleUrl(dropped("https://a.test/x.js"))).toBe("https://a.test/x.js");
    expect(failedModuleUrl(new TypeError("error loading dynamically imported module: https://a.test/y.js"))).toBe("https://a.test/y.js");
    expect(failedModuleUrl(new Error("no"))).toBeNull();
  });
});
