import { describe, expect, it } from "vitest";
import { isMenuPreviewPath } from "./pieces-events";

describe("the local room-pieces preview", () => {
  it("is enabled only on the development preview page", () => {
    expect(isMenuPreviewPath("/dev/menu-preview.html", true)).toBe(true);
    expect(isMenuPreviewPath("/meditation", true)).toBe(false);
    expect(isMenuPreviewPath("/dev/menu-preview.html", false)).toBe(false);
  });
});
