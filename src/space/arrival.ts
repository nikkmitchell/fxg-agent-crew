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
 * BACK WINS OVER THE SPACE THAT COMES BACK (Mica 7429, 7432): closing a review's version restores where you
 * stood, and then the room's own full-size space, displaced while the version was open, mounts again and would
 * send you to its spawn. Its first arrival after that is skipped: held by WHICH thing was displaced, not by a
 * clock, so a slow connection that takes longer to load it again changes nothing.
 */
const held = new Set<string>();
export const restoreArrival = (pose: Pose): void => requestArrival(pose);
/** These things were displaced by a review's version: their next spawn arrival does not move you. */
export const holdSpawnFor = (ids: readonly string[]): void => {
  for (const id of ids) held.add(id);
};
/** A full-size space's first start: its spawn, unless it is coming back from being displaced. */
export const arriveAtSpawn = (pose: Pose, id: string): void => {
  if (held.delete(id)) return;
  requestArrival(pose);
};
