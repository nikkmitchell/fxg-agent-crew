import { useSyncExternalStore } from "react";
import type { ModuleRoomItem } from "../../../shared/room-items";
import type { ReviewMode, ReviewVariant } from "../../../shared/reviews";
import { currentPose, requestArrival, type Pose } from "../arrival";

/**
 * A REVIEW ROUND'S VERSION, OPENED FOR YOU ALONE (ctx.reviews.open; Mica 7348:
 * "the Library cannot be honestly tested inside a small comparison model").
 * The exact deploy is shown at its own size in this page only, in place of the
 * room's full view while it is a full-size space, until Back. Nobody else's
 * room changes, and nothing is sent: it is a view, not a room item.
 */
export type ReviewView = { round: string; title: string; variant: ReviewVariant; space: string; entry: string; mode: ReviewMode; deploy: string };

let current: ReviewView | null = null;
const listeners = new Set<() => void>();
const set = (next: ReviewView | null) => {
  current = next;
  for (const listener of listeners) listener();
};

let returnTo: Pose | null = null;
/** Opening remembers where you stood; closing puts you back there (Mica 7421). */
export const openReviewView = (view: ReviewView) => {
  if (!current) returnTo = currentPose();
  set(view);
};
export const closeReviewView = () => {
  const back = returnTo;
  returnTo = null;
  set(null);
  if (back) requestArrival(back);
};
export const reviewViewNow = () => current;
export const useReviewView = (): ReviewView | null =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => current, () => current);

/** The id the view's thing runs under: lowercase, as a part's id must be, and never a room item's. */
export const REVIEW_VIEW_ID = "review-view";

/** The room's things with the review's version among them: in place of the room's full view when it is one. */
export function withReviewView(items: readonly ModuleRoomItem[], view: ReviewView | null, you: string | null): ModuleRoomItem[] {
  if (!view) return [...items];
  const full = view.mode === "full";
  const shown: ModuleRoomItem = {
    id: REVIEW_VIEW_ID,
    kind: "module",
    revision: 0,
    source: { space: view.space, branch: "main", entry: view.entry, deploy: view.deploy },
    name: `${view.title} · ${view.variant}`,
    role: full ? "space" : "item",
    view: full ? "full" : "placed",
    position: { x: 0, y: 0, z: full ? 0 : -1.5, rotationY: 0 },
    scale: view.mode === "model" ? 0.05 : 1,
    addedBy: you ?? "",
  };
  return [...items.filter((item) => !(full && item.view === "full")), shown];
}
