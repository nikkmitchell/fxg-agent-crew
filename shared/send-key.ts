/**
 * An idempotency key for one message: the same parts always give the same
 * key, so sending the same words again within two minutes is answered with
 * the first answer instead of being posted twice (server/idempotency.ts).
 *
 * SHARED so the server, when it sends a voice message itself after writing it
 * down (transcribe.ts), labels its posts exactly as the headset would: a
 * headset that then sends the same words as a fallback is answered once.
 */
export function sendKey(...parts: string[]): string {
  // FNV-1a over the joined parts: short, stable, and not a secret.
  let hash = 0x811c9dc5;
  const text = parts.join("\u0000");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `send-${hash.toString(36)}-${text.length}`;
}
