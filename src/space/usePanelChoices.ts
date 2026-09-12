import { useCallback, useEffect, useState } from "react";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout";
import { base } from "../router";

/**
 * Which panels you have open, as the server knows it.
 *
 * SERVER-SIDE RATHER THAN `localStorage`, which is the obvious place and the
 * wrong one here. You arrange the room sitting at a desk and then put a headset
 * on, and a headset is a different browser — everything you chose would be gone
 * at exactly the moment you wanted it. One round trip on load is a small price
 * for the arrangement following you across devices.
 *
 * The optimistic update is deliberate: a checkbox that waits for a network
 * round trip before moving reads as broken. If the server refuses, the box goes
 * back and says why, which is the one case where being told is worth more than
 * being fast.
 */
export type PanelChoice = { id: string; label: string; tab: string };

export type PanelChoices = {
  catalogue: PanelChoice[];
  open: string[];
  /** Null unless the last change was refused, in which case, why. */
  refusal: string | null;
  setOpen: (id: string, open: boolean) => void;
};

const CATALOGUE: PanelChoice[] = Object.values(STATIONS).map((station) => ({
  id: station.id,
  label: station.label,
  tab: station.tab,
}));

export function usePanelChoices(enabled: boolean): PanelChoices {
  // Starts at the defaults rather than empty, so the room draws its panels on
  // the first frame instead of appearing bare and then filling in.
  const [open, setOpenState] = useState<string[]>(DEFAULT_OPEN_PANELS);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${base}/bff/space/panels`, { credentials: "same-origin" });
        if (!response.ok) return;
        const body = (await response.json()) as { open?: unknown };
        if (!cancelled && Array.isArray(body.open)) setOpenState(body.open as string[]);
      } catch {
        // Keep the defaults. A room showing everything is a better failure than
        // a room showing nothing, and the panels themselves say when they are
        // not loading.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const setOpen = useCallback((id: string, next: boolean) => {
    setRefusal(null);
    const before = open;
    setOpenState(
      next
        ? CATALOGUE.filter((panel) => panel.id === id || before.includes(panel.id)).map((p) => p.id)
        : before.filter((panelId) => panelId !== id),
    );
    void (async () => {
      try {
        const response = await fetch(`${base}/bff/space/panels/${encodeURIComponent(id)}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ open: next }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          open?: unknown;
          error?: string;
        };
        if (!response.ok) {
          setOpenState(before);
          setRefusal(body.error ?? "The room would not change that.");
          return;
        }
        if (Array.isArray(body.open)) setOpenState(body.open as string[]);
      } catch {
        setOpenState(before);
        setRefusal("That change did not reach the room, so nothing was saved.");
      }
    })();
  }, [open]);

  return { catalogue: CATALOGUE, open, refusal, setOpen };
}
