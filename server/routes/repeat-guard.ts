/**
 * THE SAME WORDS, ONCE. Seen on 2026-09-26 (4962/4965, 4963/4964): a message
 * posted twice to the group chat, two ways.
 *
 * - A headset's browser held a chat post for twenty seconds before sending it.
 *   The client's send deadline (src/space/send-timeout.ts) had already said it
 *   failed, the person pressed send again, and both arrived.
 * - A Quest 2 sent the same post twice, a second apart.
 *
 * Neither is somebody meaning to say it twice. So a post with exactly the same
 * words, from the same person, to the same room, within REPEAT_WINDOW_MS of the
 * last one is answered with the first one's result instead of being posted
 * again. A second copy that arrives while the first is still going upstream
 * waits for it rather than racing it.
 *
 * If the first one FAILED, the repeat is a real retry and goes through.
 *
 * In memory: a restart forgets, which at worst lets one duplicate through.
 */
export const REPEAT_WINDOW_MS = 90_000;

type Entry<T> = { at: number; result: Promise<T | null> };

export class RepeatGuard<T> {
  private readonly recent = new Map<string, Entry<T>>();

  constructor(private readonly now: () => number = Date.now, private readonly windowMs = REPEAT_WINDOW_MS) {}

  /**
   * Post through `send` unless the same key was posted within the window; then
   * hand back what that post produced. `send` resolving to null, or throwing,
   * counts as not posted.
   */
  async once(key: string, send: () => Promise<T | null>): Promise<{ result: T | null; repeated: boolean }> {
    this.sweep();
    const before = this.recent.get(key);
    if (before && this.now() - before.at < this.windowMs) {
      const result = await before.result.catch(() => null);
      if (result !== null) return { result, repeated: true };
    }
    const result = send();
    this.recent.set(key, { at: this.now(), result: result.catch(() => null) });
    return { result: await result, repeated: false };
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.recent) if (now - entry.at >= this.windowMs) this.recent.delete(key);
  }
}

export const repeatKey = (who: string, room: string, content: string) => `${who}\u0000${room.toLowerCase()}\u0000${content}`;
