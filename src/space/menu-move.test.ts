import { describe, expect, it } from "vitest";
import { hitMenu, layOutMenu, type MenuModel } from "./menu-layout";
import { MENU_REACH, NO_OFFSET, clampOffset, loadOffset, saveOffset } from "./menu-move";
import { SETTINGS_TABS } from "./settings-menu-model";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const model = (badge: MenuModel["badge"] = undefined): MenuModel => ({
  title: "Settings",
  tabs: SETTINGS_TABS,
  active: SETTINGS_TABS[0].id,
  onTab: () => {},
  onClose: () => {},
  sections: [{ title: "A", rows: [{ kind: "toggle", label: "one", on: true, onTap: () => {} }] }],
  badge,
});

describe("moving your settings menu (Nikk, 5903)", () => {
  it("puts the move button beside close, clear of the tabs, close and the update badge", () => {
    for (const layout of [layOutMenu(model()), layOutMenu(model({ label: "Update now", onTap: () => {} }))]) {
      expect(layout.move.x + layout.move.width).toBeLessThan(layout.close.x);
      expect(layout.move.y).toBe(layout.close.y);
      expect(overlaps(layout.move, layout.tabTrack)).toBe(false);
      if (layout.badge) expect(overlaps(layout.move, layout.badge)).toBe(false);
      const middle = { x: layout.move.x + layout.move.width / 2, y: layout.move.y + layout.move.height / 2 };
      expect(hitMenu(layout, middle.x, middle.y)?.id).toBe("move");
    }
  });

  it("keeps the menu within reach, and a bad saved value is no offset at all", () => {
    expect(clampOffset({ x: 9, y: -9, z: 0.1 })).toEqual({ x: MENU_REACH.x, y: -MENU_REACH.y, z: 0.1 });
    expect(clampOffset({ x: Number.NaN, y: 0, z: 0 }).x).toBe(0);
    expect(loadOffset({ getItem: () => "not json" })).toEqual(NO_OFFSET);
    expect(loadOffset({ getItem: () => null })).toEqual(NO_OFFSET);
    expect(loadOffset(null)).toEqual(NO_OFFSET);
  });

  it("remembers where you put it", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
    saveOffset({ x: -0.5, y: -0.3, z: 0.2 }, storage);
    expect(loadOffset(storage)).toEqual({ x: -0.5, y: -0.3, z: 0.2 });
  });
});
