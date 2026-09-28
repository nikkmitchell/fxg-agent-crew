/** Keep a viewer's current place in a shared ambient animation while reduced
 * motion is on; new viewers still get a stable first frame. */
export function freezeMotionTime(seconds: number, frozenSeconds: number | null, reducedMotion: boolean): number | null {
  return reducedMotion ? frozenSeconds ?? seconds : null;
}

export function displayMotionTime(seconds: number, frozenSeconds: number | null, reducedMotion: boolean): number {
  return freezeMotionTime(seconds, frozenSeconds, reducedMotion) ?? seconds;
}
