/**
 * A game clock for the Go table.
 *
 * Nikk (4826): "add a mode with a timer in the settings, allow it to set for
 * per round time and as well as total extra time, kind of how many online go
 * boards have". So: each move has a few free seconds (per move); time past
 * that comes out of that player's own bank (extra time); a player who runs
 * over with an empty bank loses on time. Off by default.
 *
 * ONE CLOCK FOR EVERYBODY, like the breathing orb: the table stores when the
 * turn began and what each bank holds, and every device works the count out
 * from those. Nothing ticks on the server; it settles the time used whenever a
 * move, a pass, or anything else touches the table.
 */

export type GoClock = {
  /** Free seconds for each move. */
  perMove: number;
  /** Each colour's extra time left, in seconds, by colour index. */
  bank: number[];
  /** When the current turn began, epoch ms. */
  turnStartedAt: number;
};

/** The timers offered in settings, from none to slow. [per move, extra] seconds. */
export const CLOCK_PRESETS: readonly (readonly [number, number] | null)[] = [
  null,
  [10, 60],
  [30, 300],
  [60, 600],
  [120, 1200],
];

export function clockLabel(clock: GoClock | null): string {
  if (!clock) return "OFF";
  return `${clock.perMove}s + ${Math.round(clock.bank.length ? Math.max(...clock.bank) / 60 : 0)}m`;
}

/** The preset a clock started from, or 0 (off). */
export function presetOf(clock: GoClock | null): number {
  if (!clock) return 0;
  const found = CLOCK_PRESETS.findIndex((p) => p !== null && p[0] === clock.perMove);
  return found < 0 ? 0 : found;
}

/** A fresh clock for a preset, every bank full, the turn starting now. */
export function startClock(preset: number, colours: number, now: number): GoClock | null {
  const chosen = CLOCK_PRESETS[preset] ?? null;
  if (!chosen) return null;
  return { perMove: chosen[0], bank: Array.from({ length: colours }, () => chosen[1]), turnStartedAt: now };
}

/** Where the clock stands at `now` for the colour to play. */
export function clockNow(clock: GoClock, colour: number, now: number): {
  /** Free seconds left on this move (0 once into the bank). */
  moveLeft: number;
  /** This colour's bank, after what this move has already used of it. */
  bankLeft: number;
  /** Out of time: past the free seconds with nothing left in the bank. */
  flagged: boolean;
} {
  const used = Math.max(0, (now - clock.turnStartedAt) / 1000);
  const over = Math.max(0, used - clock.perMove);
  const bankLeft = (clock.bank[colour] ?? 0) - over;
  return { moveLeft: Math.max(0, clock.perMove - used), bankLeft: Math.max(0, bankLeft), flagged: bankLeft <= 0 && over > 0 };
}

/**
 * Settle a finished turn: charge what it used past the free seconds to that
 * colour's bank, and start the next turn now.
 */
export function settleTurn(clock: GoClock, colour: number, now: number): GoClock {
  const { bankLeft } = clockNow(clock, colour, now);
  const bank = clock.bank.slice();
  bank[colour] = bankLeft;
  return { ...clock, bank, turnStartedAt: now };
}

/** m:ss, for the table. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
