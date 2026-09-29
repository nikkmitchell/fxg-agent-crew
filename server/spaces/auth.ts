import { createHash } from "node:crypto";
import { spaceKey } from "../../shared/spaces.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * WHO IS PUSHING, for git over HTTPS (Nikk, 6150: "their own saha.ing login
 * (which is the webharness.chat login) works, any members of the room, human
 * or agents").
 *
 * git sends a username and password with every request (HTTP Basic). The
 * password is one of two things, and both are checked by WebHarness, never
 * here:
 *  - a person's WebHarness password: exchanged for a token by /api/login;
 *  - an agent's WebHarness token, which it gets on its own machine by signing
 *    WebHarness's challenge with its private key. We ask WebHarness whose it is.
 * The username git sends must be that same account, so a token cannot be
 * used under somebody else's name.
 *
 * Nothing is stored: a short-lived memory of "these credentials were good",
 * keyed by a hash, so one clone (three or four requests) is one WebHarness
 * check rather than four. Membership is the WebHarness room of the space's name.
 */

export type GitIdentity = { username: string; token: string };

const CREDENTIALS_FOR_MS = 5 * 60_000;
const ROOMS_FOR_MS = 60_000;
const FAILURES = { max: 10, windowMs: 10 * 60_000 } as const;

export function parseBasic(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon <= 0) return null;
  return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

export class SpaceAuth {
  private readonly known = new Map<string, { identity: GitIdentity; until: number }>();
  private readonly rooms = new Map<string, { rooms: string[]; until: number }>();
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly client: WebharnessClient, private readonly now: () => number = Date.now) {}

  /** Null when the visitor has failed too often lately; otherwise not refused yet. */
  blocked(visitor: string): boolean {
    const recent = (this.failures.get(visitor) ?? []).filter((at) => this.now() - at < FAILURES.windowMs);
    this.failures.set(visitor, recent);
    return recent.length >= FAILURES.max;
  }

  private failed(visitor: string): void {
    const recent = this.failures.get(visitor) ?? [];
    recent.push(this.now());
    this.failures.set(visitor, recent);
  }

  /** The account these credentials belong to, or null. Throws only when WebHarness cannot be reached. */
  async identify(user: string, pass: string, visitor: string): Promise<GitIdentity | null> {
    const key = createHash("sha256").update(`${user}\0${pass}`).digest("hex");
    const cached = this.known.get(key);
    if (cached && cached.until > this.now()) return cached.identity;

    let identity: GitIdentity | null = null;
    // An agent's token first: asking WebHarness whose token this is is not a
    // sign-in attempt, so a person's password never gets tried as a token
    // AND as a password against their account.
    try {
      const who = await this.client.whoami(pass);
      if (who.toLowerCase() === user.toLowerCase()) identity = { username: who, token: pass };
    } catch (error) {
      if (!(error instanceof WebharnessError) || error.status >= 500) throw error;
    }
    if (!identity) {
      try {
        identity = { username: user, token: await this.client.login(user, pass) };
      } catch (error) {
        if (!(error instanceof WebharnessError) || error.status >= 500) throw error;
      }
    }
    if (!identity) {
      this.failed(visitor);
      return null;
    }
    this.known.set(key, { identity, until: this.now() + CREDENTIALS_FOR_MS });
    return identity;
  }

  /** The rooms (keyed) this token's owner is a member of, briefly remembered. */
  async roomsOf(identity: GitIdentity): Promise<string[]> {
    const key = identity.username.toLowerCase();
    const cached = this.rooms.get(key);
    if (cached && cached.until > this.now()) return cached.rooms;
    const rooms = (await this.client.rooms(identity.token)).map(spaceKey);
    this.rooms.set(key, { rooms, until: this.now() + ROOMS_FOR_MS });
    return rooms;
  }

  async isMember(identity: GitIdentity, space: string): Promise<boolean> {
    return (await this.roomsOf(identity)).includes(space);
  }

  /** Forget a member's rooms, after they create a space or join a room here. */
  forgetRooms(username: string): void {
    this.rooms.delete(username.toLowerCase());
  }
}
