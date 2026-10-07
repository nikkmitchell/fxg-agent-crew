/**
 * WHERE YOU ARRIVE (Mica 7421): a full-size space's own spawn (defineSpace({ spawn })), in place of the room's,
 * and back to where you stood when a review's version is closed. ModuleItems asks; the window's camera (Scene)
 * moves. One wire, so neither has to know the other.
 */
export type Pose = { x: number; z: number; yaw: number };

const listeners = new Set<(pose: Pose) => void>();
let poseNow: (() => Pose | null) | null = null;

/** Put the viewer here (in room metres, yaw as the window's camera reads it). */
export const requestArrival = (pose: Pose): void => {
  for (const listener of listeners) listener(pose);
};
export const onArrival = (listener: (pose: Pose) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The window's camera says where it is, for coming back. */
export const providePose = (read: (() => Pose | null) | null): void => {
  poseNow = read;
};
export const currentPose = (): Pose | null => poseNow?.() ?? null;

/**
 * BACK WINS OVER THE SPACE THAT COMES BACK (Mica 7429): closing a review's version restores where you stood, and
 * then the room's own full-size space mounts again and would send you to its spawn. A restore holds off the next
 * spawn arrival, once.
 */
/** Until when the next spawn arrival is held off: long enough for a space to load again, not forever. */
let holdSpawnUntil = 0;
const HOLD_MS = 15_000;
export const restoreArrival = (pose: Pose): void => {
  holdSpawnUntil = Date.now() + HOLD_MS;
  requestArrival(pose);
};
/** A full-size space's first start: its spawn, unless a restore has just put you back. */
export const arriveAtSpawn = (pose: Pose): void => {
  if (Date.now() < holdSpawnUntil) {
    holdSpawnUntil = 0;
    return;
  }
  requestArrival(pose);
};
