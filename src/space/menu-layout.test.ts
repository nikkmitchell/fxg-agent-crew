import { describe, expect, it, vi } from "vitest";
import { MENU, hitMenu, layOutMenu, menuColumns, menuHeight, menuPixel, menuSignature, type MenuModel, type MenuRow } from "./menu-layout";

const toggle = (label: string, onTap = () => {}): MenuRow => ({ kind: "toggle", label, on: true, onTap });
const model = (sections: MenuModel["sections"], extra: Partial<MenuModel> = {}): MenuModel => ({
  title: "Settings",
  tabs: [
    { id: "me", label: "Me" },
    { id: "rooms", label: "Rooms" },
  ],
  active: "me",
  onTab: () => {},
  onClose: () => {},
  sections,
  ...extra,
});
const centre = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

describe("the headset settings panel (Nikk 5439, 5445)", () => {
  it("is the same height whatever a tab holds: it grows sideways, never down", () => {
    const short = layOutMenu(model([{ title: "A", rows: [toggle("one")] }]));
    const long = layOutMenu(model([{ title: "A", rows: Array.from({ length: 13 }, (_, i) => toggle(`row ${i}`)) }]));
    expect(short.height).toBe(menuHeight());
    expect(long.height).toBe(short.height);
    expect(long.columns).toHaveLength(3);
    expect(long.columns.map((column) => column.rows.length)).toEqual([MENU.maxRows, MENU.maxRows, 3]);
    expect(long.columns.map((column) => column.title)).toEqual(["A", "", ""]);
  });

  it("sets sections side by side, left to right, in order", () => {
    const layout = layOutMenu(model([
      { title: "Voice", rows: [toggle("mic")] },
      { title: "Moving", rows: [toggle("teleport")] },
      { title: "View", rows: [toggle("dark")] },
    ]));
    const xs = layout.columns.map((column) => column.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.width).toBeGreaterThanOrEqual(MENU.minWidth);
    const wider = layOutMenu(model(Array.from({ length: 5 }, (_, i) => ({ title: `S${i}`, rows: [toggle("x")] }))));
    expect(wider.width).toBeGreaterThan(layout.width);
  });

  it("gives an empty section something to say", () => {
    expect(menuColumns([{ title: "Empty", rows: [] }])[0].rows[0].row.kind).toBe("note");
  });

  it("finds the tab, the close button and the row under a point", () => {
    const onTab = vi.fn();
    const onClose = vi.fn();
    const mic = vi.fn();
    const layout = layOutMenu(model([{ title: "Voice", rows: [toggle("My microphone", mic)] }], { onTab, onClose }));

    const rooms = layout.tabs.find((tab) => tab.id === "rooms")!;
    hitMenu(layout, centre(rooms).x, centre(rooms).y)?.onTap();
    expect(onTab).toHaveBeenCalledWith("rooms");

    hitMenu(layout, centre(layout.close).x, centre(layout.close).y)?.onTap();
    expect(onClose).toHaveBeenCalled();

    const row = layout.columns[0].rows[0].rect;
    hitMenu(layout, row.x + 30, centre(row).y)?.onTap();
    expect(mic).toHaveBeenCalled();

    expect(hitMenu(layout, 5, layout.height - 5)).toBeNull();
  });

  it("presses a stepper's − and + rather than the row they sit in", () => {
    const less = vi.fn();
    const more = vi.fn();
    const layout = layOutMenu(model([{ title: "View", rows: [{ kind: "stepper", label: "Pointer", value: "60%", onLess: less, onMore: more, onTap: () => {} }] }]));
    const plus = layout.targets.find((target) => target.id.endsWith(":more"))!;
    const minus = layout.targets.find((target) => target.id.endsWith(":less"))!;
    hitMenu(layout, centre(plus).x, centre(plus).y)?.onTap();
    hitMenu(layout, centre(minus).x, centre(minus).y)?.onTap();
    expect(more).toHaveBeenCalledTimes(1);
    expect(less).toHaveBeenCalledTimes(1);
  });

  it("never offers a note, or a switch that cannot switch, as something to press", () => {
    const layout = layOutMenu(model([{ title: "X", rows: [{ kind: "note", label: "words" }, { kind: "toggle", label: "Passthrough", on: false, disabled: true, onTap: () => {} }] }]));
    expect(layout.targets.filter((target) => target.id.startsWith("s0"))).toEqual([]);
  });

  it("puts Update now where the title is, and presses it", () => {
    const update = vi.fn();
    const layout = layOutMenu(model([{ title: "A", rows: [toggle("x")] }], { badge: { label: "Update now", onTap: update } }));
    expect(layout.badge).not.toBeNull();
    expect(layout.badge!.x + layout.badge!.width).toBeLessThan(layout.tabTrack.x);
    hitMenu(layout, centre(layout.badge!).x, centre(layout.badge!).y)?.onTap();
    expect(update).toHaveBeenCalled();
    expect(layOutMenu(model([{ title: "A", rows: [toggle("x")] }])).badge).toBeNull();
  });

  it("turns a point on the plane, in metres from its middle, into the pixel under it", () => {
    const layout = layOutMenu(model([{ title: "A", rows: [toggle("x")] }]));
    expect(menuPixel(layout, { x: 0, y: 0 })).toEqual({ x: layout.width / 2, y: layout.height / 2 });
    const topLeft = menuPixel(layout, { x: -layout.width / 2 / MENU.pxPerMetre, y: layout.height / 2 / MENU.pxPerMetre });
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
  });

  it("repaints only when something that is drawn changes", () => {
    const a = layOutMenu(model([{ title: "A", rows: [toggle("x")] }]));
    const b = layOutMenu(model([{ title: "A", rows: [toggle("x", () => 1)] }]));
    expect(menuSignature(a, null, null)).toBe(menuSignature(b, null, null));
    const off = layOutMenu(model([{ title: "A", rows: [{ kind: "toggle", label: "x", on: false, onTap: () => {} }] }]));
    expect(menuSignature(off, null, null)).not.toBe(menuSignature(a, null, null));
    expect(menuSignature(a, "s0r0", null)).not.toBe(menuSignature(a, null, null));
  });
});
