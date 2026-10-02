import { useCallback, useEffect, useState } from "react";
import { MODEL_HEIGHT, isModuleItem, type ModuleRoomItem, type RoomItem } from "../../../shared/room-items";
import { bff, type SpaceModule, type SpaceModules, type SpaceShelf } from "../../bff-client";
import { space } from "../../space-client";

/**
 * THE LIBRARY: every space you can bring things from, what each offers, and
 * what this room has brought in (Nikk, 2026-10-01: "inside a workroom for a
 * project we should be able to open in settings all the spaces that have been
 * made in that project"). One hook, so the headset's Library tab and the
 * window's sidebar say and do the same.
 */
export type Library = {
  spaces: SpaceShelf[] | null;
  /** The space being looked at, and what its branch offers. */
  open: { name: string; listing: SpaceModules | null } | null;
  /** What this room has brought in, newest last. */
  inRoom: ModuleRoomItem[];
  notice: string | null;
  busy: boolean;
  refresh: () => void;
  openSpace: (name: string | null, branch?: string) => void;
  /** Bring a thing in: an item in front of you, an environment around the room, a space as a model or full size. */
  bring: (module: SpaceModule, view?: "placed" | "full") => void;
  /** A space between a model and full size. */
  setView: (item: ModuleRoomItem, view: "placed" | "full") => void;
  remove: (item: ModuleRoomItem) => void;
};

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function useLibrary(options: {
  enabled: boolean;
  /** This room's own space, opened first (the project's). */
  roomSpace: string | null;
  roomItems: RoomItem[];
  applyRoomItem: (item: RoomItem) => void;
  removeRoomItem: (id: string) => void;
  /** Where to put a new item: in front of whoever brings it. */
  inFront?: () => { x: number; y: number; z: number; rotationY: number } | null;
}): Library {
  const [spaces, setSpaces] = useState<SpaceShelf[] | null>(null);
  const [open, setOpen] = useState<{ name: string; listing: SpaceModules | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!options.enabled) return;
    const abort = new AbortController();
    bff.spaceLibrary(abort.signal)
      .then((answer) => {
        // This room's own space first: it is the project's.
        const own = options.roomSpace;
        setSpaces([...answer.spaces].sort((a, b) => Number(b.name === own) - Number(a.name === own)));
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setNotice(message(error, "Could not list the spaces."));
      });
    return () => abort.abort();
  }, [options.enabled, options.roomSpace, revision]);

  const openSpace = useCallback((name: string | null, branch?: string) => {
    if (!name) {
      setOpen(null);
      return;
    }
    setOpen({ name, listing: null });
    setNotice(null);
    bff.spaceModules(name, branch)
      .then((listing) => setOpen((now) => (now?.name === name ? { name, listing } : now)))
      .catch((error: unknown) => setNotice(message(error, `Could not open ${name}.`)));
  }, []);

  const bring = useCallback((module: SpaceModule, view?: "placed" | "full") => {
    const listing = open?.listing;
    if (!listing) return;
    setBusy(true);
    setNotice(null);
    const spot = module.kind === "environment" || view === "full" ? null : options.inFront?.() ?? null;
    // A space as a model goes on a plinth at table height, where it can be worked on.
    const position = spot ? { ...spot, y: module.kind === "space" ? MODEL_HEIGHT : spot.y } : undefined;
    space.bringModule({ space: listing.space, branch: listing.branch, entry: module.id }, { ...(view ? { view } : {}), ...(position ? { position } : {}) })
      .then((answer) => {
        options.applyRoomItem(answer.item);
        setNotice(`${module.name} is in the room.`);
      })
      .catch((error: unknown) => setNotice(message(error, `Could not bring ${module.name} in.`)))
      .finally(() => setBusy(false));
  }, [open, options]);

  const setView = useCallback((item: ModuleRoomItem, view: "placed" | "full") => {
    space.placeModule(item.id, { view, revision: item.revision })
      .then((answer) => options.applyRoomItem(answer.item))
      .catch((error: unknown) => setNotice(message(error, `Could not change ${item.name}.`)));
  }, [options]);

  const remove = useCallback((item: ModuleRoomItem) => {
    space.removeRoomItem(item.id)
      .then(() => options.removeRoomItem(item.id))
      .catch((error: unknown) => setNotice(message(error, `Could not take ${item.name} away.`)));
  }, [options]);

  return {
    spaces,
    open,
    inRoom: options.roomItems.filter(isModuleItem),
    notice,
    busy,
    refresh: () => setRevision((n) => n + 1),
    openSpace,
    bring,
    setView,
    remove,
  };
}

/** How a thing in the room reads in a list. */
export function describeInRoom(item: ModuleRoomItem): string {
  const what = item.role === "environment" ? "environment" : item.role === "space" ? (item.view === "full" ? "space, full size" : "space, as a model") : "item";
  return `${item.name} · ${what} · from ${item.source.space}${item.source.branch === "main" ? "" : ` (${item.source.branch})`}`;
}

/**
 * Where a thing brought in should stand: a little over a metre in front of
 * whoever brought it, turned to face them. A facing of 0 looks down -Z (three's
 * camera), so ahead is (-sin, -cos); the thing's own front is +Z, and the same
 * yaw turns it toward them.
 */
export function inFrontOf(people: readonly { actorId: string; at: { x: number; y: number; z: number }; facing: number }[], you: string | null, distance = 1.3) {
  const me = people.find((person) => person.actorId === you);
  if (!me) return null;
  return { x: me.at.x - Math.sin(me.facing) * distance, y: 0, z: me.at.z - Math.cos(me.facing) * distance, rotationY: me.facing };
}
