import { useCallback, useState } from "react";

/**
 * Whether a panel is being arranged, and how.
 *
 * PER VIEWER, NOT SHARED, which is the opposite of where a panel HANGS. Where
 * it hangs is furniture: an agent walks to its actual position, and everyone
 * must see the same room. Whether you are currently in the middle of moving one
 * is about your hands, not the room, and broadcasting it would mean somebody
 * else's panels going live under your ray while you were reading them.
 *
 * LOCKED BY DEFAULT, and this is the reason the mode exists at all rather than
 * panels simply always being draggable. A panel is a live web page you are
 * meant to read and click; if grabbing it also moved it, every press of a
 * button on the board would shove the board. Nikk asked for it this way round:
 * "we can make the resizing to be a toggle in the settings (for each window),
 * and then if drag is on we can click on the window and move it."
 */
export type ArrangeMode = "locked" | "move" | "resize";

/** The order the settings row steps through, so tapping cycles predictably. */
const ORDER: ArrangeMode[] = ["locked", "move", "resize"];

export type PanelArrange = {
  modeOf: (id: string) => ArrangeMode;
  /** Step one panel to the next mode. */
  cycle: (id: string) => void;
  /** Put everything back to locked — the way out if a panel is mid-move. */
  lockAll: () => void;
  /** True when anything at all is unlocked, for saying so once rather than per panel. */
  anyUnlocked: boolean;
};

export function usePanelArrange(): PanelArrange {
  const [modes, setModes] = useState<Record<string, ArrangeMode>>({});

  const modeOf = useCallback((id: string): ArrangeMode => modes[id] ?? "locked", [modes]);

  const cycle = useCallback((id: string) => {
    setModes((before) => {
      const now = before[id] ?? "locked";
      const next = ORDER[(ORDER.indexOf(now) + 1) % ORDER.length];
      return { ...before, [id]: next };
    });
  }, []);

  const lockAll = useCallback(() => setModes({}), []);

  return {
    modeOf,
    cycle,
    lockAll,
    anyUnlocked: Object.values(modes).some((mode) => mode !== "locked"),
  };
}
