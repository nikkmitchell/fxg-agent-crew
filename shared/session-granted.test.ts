import { describe, expect, it } from "vitest";
import { enterWhenGranted, resetGranted } from "./session-granted";

describe("staying in VR across a door (Nikk, 2026-09-29)", () => {
  it("enters VR when the browser grants a session, once, and does nothing where it cannot", async () => {
    resetGranted();
    const listeners: Array<() => void> = [];
    let entered = 0;
    const xr = { addEventListener: (type: string, listener: () => void) => { if (type === "sessiongranted") listeners.push(listener); } };
    expect(enterWhenGranted(async () => { entered += 1; }, xr)).toBe(true);
    expect(enterWhenGranted(async () => { entered += 1; }, xr)).toBe(false);
    listeners.forEach((listener) => listener());
    await Promise.resolve();
    expect(entered).toBe(1);
    resetGranted();
    expect(enterWhenGranted(async () => undefined, undefined)).toBe(false);
  });
});
