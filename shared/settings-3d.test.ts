import { describe, expect, it } from "vitest";
import { SETTINGS, SETTINGS_PX, layOutSettings, paintSettings, settingAt, type SettingsItem } from "./settings-3d.js";
import type { Ink } from "./card-paint.js";

const measure = (text: string, size: number) => text.length * size * 0.55;
const texts = (ink: Ink[]) => ink.flatMap((i) => (i.kind === "text" ? [i.text] : []));
const said = (ink: Ink[]) => texts(ink).join("   ");

/** uv of a target's centre, which is how the renderer would point at it. */
const uvOf = (layout: ReturnType<typeof layOutSettings>, id: string) => {
  const target = layout.targets.find((t) => t.id === id);
  if (!target) throw new Error(`no target ${id}`);
  return { x: target.x / layout.width + 0.5, y: target.y / layout.height + 0.5 };
};

const sample: SettingsItem[] = [
  { kind: "heading", label: "What the room is showing" },
  { kind: "choice", id: "project:meditation-app", label: "Meditation app", selected: true },
  { kind: "choice", id: "project:saha", label: "saha.ing", selected: false },
  { kind: "heading", label: "Panels" },
  { kind: "toggle", id: "panel:taskBoard", label: "Board", on: true },
  { kind: "stepper", id: "size:taskBoard", label: "Board size", value: "100%" },
  { kind: "cycle", id: "arrange:taskBoard", label: "Board drag", value: "locked" },
];

describe("laying the settings out", () => {
  it("gives every pressable row a target and headings none", () => {
    const layout = layOutSettings(sample);
    const ids = layout.targets.map((t) => t.id);
    expect(ids).toContain("project:meditation-app");
    expect(ids).toContain("panel:taskBoard");
    expect(ids).toContain("arrange:taskBoard");
    // A heading is not a button, and pressing one must not do anything.
    expect(ids.some((id) => id.includes("What the room"))).toBe(false);
  });

  it("gives a stepper two ends, not one", () => {
    const ids = layOutSettings(sample).targets.map((t) => t.id);
    expect(ids).toContain("size:taskBoard:less");
    expect(ids).toContain("size:taskBoard:more");
  });

  it("finds the control the layout put there", () => {
    const layout = layOutSettings(sample);
    for (const target of layout.targets) {
      expect(settingAt(layout, uvOf(layout, target.id)), target.id).toBe(target.id);
    }
  });

  it("IS EXACT, because every press here changes the room for everybody", () => {
    // Unlike dropping a card, which is forgiving on purpose: a near miss that
    // picks the neighbouring project changes what everyone else is looking at.
    const layout = layOutSettings(sample);
    const between = layout.rows[1].y - SETTINGS.rowHeight / 2 - SETTINGS.rowGap / 2;
    expect(settingAt(layout, { x: 0.5, y: between / layout.height + 0.5 })).toBeNull();
    expect(settingAt(layout, { x: 0.5, y: 5 })).toBeNull();
  });

  it("never overlaps two controls", () => {
    const layout = layOutSettings(sample);
    for (let i = 0; i < layout.targets.length; i += 1) {
      for (let j = i + 1; j < layout.targets.length; j += 1) {
        const a = layout.targets[i];
        const b = layout.targets[j];
        const apart =
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-9 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2 - 1e-9;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it("keeps every control on the panel", () => {
    const layout = layOutSettings(sample);
    for (const target of layout.targets) {
      expect(Math.abs(target.x) + target.width / 2).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
      expect(Math.abs(target.y) + target.height / 2).toBeLessThanOrEqual(layout.height / 2 + 1e-9);
    }
  });

  it("COUNTS WHAT DID NOT FIT rather than quietly stopping", () => {
    // A list that silently ends looks like a list that has ended.
    const many: SettingsItem[] = Array.from({ length: 60 }, (_, i) => ({
      kind: "choice" as const, id: `p${i}`, label: `Project ${i}`, selected: false,
    }));
    const layout = layOutSettings(many);
    expect(layout.hidden).toBeGreaterThan(0);
    expect(layout.rows.length + layout.hidden).toBe(many.length);
    expect(said(paintSettings(layout, measure))).toContain("not shown");
  });

  it("is quiet about overflow when everything fits", () => {
    const layout = layOutSettings(sample);
    expect(layout.hidden).toBe(0);
    expect(said(paintSettings(layout, measure))).not.toContain("not shown");
  });
});

describe("drawing the settings", () => {
  it("says what everything is", () => {
    const words = said(paintSettings(layOutSettings(sample), measure));
    expect(words).toContain("Meditation app");
    expect(words).toContain("Board");
    expect(words).toContain("locked");
    expect(words).toContain("100%");
  });

  it("shows the chosen one differently from the rest", () => {
    // Otherwise a list of projects says nothing about which one you are on.
    const ink = paintSettings(layOutSettings(sample), measure);
    const chosen = ink.find((i) => i.kind === "text" && i.text === "Meditation app");
    const other = ink.find((i) => i.kind === "text" && i.text === "saha.ing");
    expect(chosen && other && chosen.fill).not.toBe(other && other.fill);
  });

  it("stays inside the bitmap", () => {
    const many: SettingsItem[] = Array.from({ length: 60 }, (_, i) => ({
      kind: "choice" as const, id: `p${i}`, label: `A project with a fairly long name ${i}`, selected: false,
    }));
    for (const item of paintSettings(layOutSettings(many), measure)) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(SETTINGS_PX.width);
      expect(item.y).toBeLessThanOrEqual(SETTINGS_PX.height);
    }
  });

  it("is deterministic", () => {
    const layout = layOutSettings(sample);
    expect(paintSettings(layout, measure)).toEqual(paintSettings(layout, measure));
  });
});
