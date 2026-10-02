import { describe, expect, it } from "vitest";
import { MENU_BUTTON, MENU_TOUCH, touchedButton } from "./menu";

describe("touching a wrist-menu button with the controller's sphere", () => {
  const centre = (index: number) => MENU_BUTTON.top - index * MENU_BUTTON.gap;
  it("hits the button whose face the sphere is at", () => {
    expect(touchedButton({ x: 0, y: centre(0), z: 0.01 }, 3)).toBe(0);
    expect(touchedButton({ x: 0.05, y: centre(2), z: -0.01 }, 3)).toBe(2);
  });
  it("misses beside a button, between buttons, or too far in front of the panel", () => {
    expect(touchedButton({ x: 0.2, y: centre(0), z: 0 }, 3)).toBe(-1);
    expect(touchedButton({ x: 0, y: centre(0) - MENU_BUTTON.gap / 2, z: 0 }, 3)).toBe(-1);
    expect(touchedButton({ x: 0, y: centre(0), z: MENU_TOUCH.near + 0.01 }, 3)).toBe(-1);
  });
  it("only counts the buttons that exist", () => {
    expect(touchedButton({ x: 0, y: centre(2), z: 0 }, 2)).toBe(-1);
  });
});
