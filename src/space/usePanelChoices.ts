import { useCallback, useEffect, useState } from "react";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout";
import { ApiError } from "../api-request";
import { space } from "../space-client";

/**
 * Which panels THE ROOM has open, as the server knows it.
 *
 * NOT YOURS ANY MORE. This was per-person, and Nikk asked for it to be shared
 * like position and scale: "Now the enabled or dissabled boards/panels are not
 * syned, we want this to also be synced." So somebody else closing a panel has
 * to reach this hook while it is on screen, which is what `fromRoom` is for —
 * the socket carries the whole set on every change.
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

export function usePanelChoices(
  enabled: boolean,
  /**
   * The set the room last broadcast, or null before it has said anything.
   *
   * PASSED IN RATHER THAN SUBSCRIBED HERE, because the socket is already open
   * one level up and a second subscription would mean two connections
   * disagreeing about the same four booleans.
   */
  fromRoom: string[] | null = null,
): PanelChoices {
  // Starts at the defaults rather than empty, so the room draws its panels on
  // the first frame instead of appearing bare and then filling in.
  const [open, setOpenState] = useState<string[]>(DEFAULT_OPEN_PANELS);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const body = await space.panels();
        if (!cancelled) setOpenState(body.open);
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

  /**
   * SOMEBODY ELSE CHANGED IT.
   *
   * Applied straight, with no merge: the frame carries the whole set and the
   * room is the authority now. Merging would invent a third arrangement that
   * neither person chose.
   *
   * It is also what makes the optimistic update below safe to keep — the
   * server's broadcast arrives moments later and overwrites any guess.
   */
  useEffect(() => {
    if (fromRoom) setOpenState(fromRoom);
  }, [fromRoom]);

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
        const body = await space.setPanelOpen(id, next);
        setOpenState(body.open);
      } catch (cause) {
        setOpenState(before);
        // The server's refusal is a sentence written for a person; an
        // ApiError carries it verbatim. Anything else never reached the room.
        setRefusal(
          cause instanceof ApiError
            ? cause.message
            : "That change did not reach the room, so nothing was saved.",
        );
      }
    })();
  }, [open]);

  return { catalogue: CATALOGUE, open, refusal, setOpen };
}
