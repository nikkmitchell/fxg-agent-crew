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
