/** Pure visual states for percussion pieces, kept separate for cheap unit tests. */
export function singingBowlVisual(
  ringing: number,
  note: number,
  elapsedSeconds: number,
  reducedMotion: boolean,
): { glow: number; scale: number } {
  const level = Math.max(0, Math.min(1, ringing));
  return {
    // Keep an unanimated, steady strike cue until the ring has ended.
    glow: reducedMotion ? (level > 0 ? 0.28 : 0) : level * 0.28,
    scale: reducedMotion ? 1 : 1 + Math.sin(elapsedSeconds * note * 0.05) * 0.004 * level,
  };
}

export function gongVisual(
  ringing: number,
  elapsedSeconds: number,
  reducedMotion: boolean,
): { glow: number; rotationX: number; rotationZ: number } {
  const level = Math.max(0, Math.min(1, ringing));
  return {
    // Keep feedback visible without pulsing or moving the disc.
    glow: reducedMotion ? (level > 0 ? 0.25 : 0) : level * 0.25,
    rotationX: reducedMotion ? 0 : Math.sin(elapsedSeconds * 7) * 0.012 * level,
    rotationZ: reducedMotion ? 0 : Math.sin(elapsedSeconds * 5.3) * 0.01 * level,
  };
}
