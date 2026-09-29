import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KIT_LIMITS } from "../../shared/space-kit.js";

/**
 * TICKETS INTO A SPACE (shared/space-kit.ts has the why). saha.ing, which
 * knows who you are from your cookie, hands a space page a ticket naming you
 * and that one space. The page shows it to the live socket; that is the only
 * thing it can do with it. It cannot sign in to saha.ing, act in another space,
 * or outlive half an hour (the live socket hands out fresh ones while you stay).
 *
 * SEALED, NOT REMEMBERED. They used to be kept in memory, so every release
 * restarted the box and turned everybody in a space into a guest (Mica, 6319:
 * both tabs fell back to "watching · 0 here" right after a deploy). A ticket
 * now carries who, which body, which space and until when, sealed with an HMAC
 * under a key the box made once (Sill, 6326: in a file beside the spaces, mode
 * 600, never in the repo). Any restart can still open it; nobody without the
 * key can make or change one.
 */
export type TicketHolder = { username: string; body: string | null; space: string };

type Sealed = { u: string; b: string | null; s: string; e: number };

/** The box's ticket key: read, or made once, at `path`. */
export function ticketKey(path: string): Buffer {
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
    if (key.length >= 32) return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString("base64url"), { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

export class SpaceTickets {
  private readonly key: Buffer;
  /**
   * TICKETS MADE BEFORE YOU LEFT EVERY SPACE ARE NO LONGER YOURS TO USE
   * (Baiwei, 6414: after "Leave every space" two seats came straight back,
   * because whatever held them reconnected with the ticket it already had).
   * By person: tickets issued before this moment are refused. Entering again
   * from saha.ing makes a new one, after it. Kept for a ticket's lifetime.
   */
  private readonly leftAt = new Map<string, number>();

  /** `key`: the box's (ticketKey); a fresh one when none is given (tests). */
  constructor(key?: Buffer, private readonly now: () => number = Date.now) {
    this.key = key ?? randomBytes(32);
  }

  /** Refuse every ticket this person was given before now. */
  revokeUntilNow(username: string): void {
    const at = this.now();
    this.leftAt.set(username.toLowerCase(), at);
    for (const [who, when] of this.leftAt) if (when < at - KIT_LIMITS.ticketMs) this.leftAt.delete(who);
  }

  private mac(payload: string): Buffer {
    return createHmac("sha256", this.key).update(payload).digest();
  }

  issue(holder: TicketHolder): string {
    const sealed: Sealed = { u: holder.username, b: holder.body, s: holder.space, e: this.now() + KIT_LIMITS.ticketMs };
    const payload = Buffer.from(JSON.stringify(sealed)).toString("base64url");
    return `${payload}.${this.mac(payload).toString("base64url")}`;
  }

  /** Who a ticket is, for this space only; null for anything else. */
  read(ticket: string | null | undefined, space: string): TicketHolder | null {
    if (!ticket || ticket.length > 2048) return null;
    const [payload, given, extra] = ticket.split(".");
    if (!payload || !given || extra !== undefined) return null;
    const expected = this.mac(payload);
    const presented = Buffer.from(given, "base64url");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
    let sealed: Sealed;
    try {
      sealed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Sealed;
    } catch {
      return null;
    }
    if (typeof sealed.u !== "string" || typeof sealed.s !== "string" || typeof sealed.e !== "number") return null;
    if (sealed.e < this.now() || sealed.s !== space) return null;
    const left = this.leftAt.get(sealed.u.toLowerCase());
    if (left !== undefined && sealed.e - KIT_LIMITS.ticketMs <= left) return null;
    return { username: sealed.u, body: typeof sealed.b === "string" ? sealed.b : null, space: sealed.s };
  }
}
