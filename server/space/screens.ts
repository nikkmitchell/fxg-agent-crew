import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { SCREEN_LIMITS, sniffImage, type ScreenSummary } from "../../shared/screens.js";

/**
 * Screen sharing: one picture per person, always the latest.
 *
 * Nikk asked for it so that people "can see what each agent is working on, to
 * get more information than just what they share in chat" — a page that takes
 * a picture of a screen about once a second and uploads it, and a virtual
 * screen in the room for each person who is sharing.
 *
 * ONE CONSTANTLY OVERWRITTEN FRAMEBUFFER, NOT AN ARCHIVE, which was Nikk's own
 * refinement and is the whole storage design. Each person has at most one
 * frame; a new one replaces it; nothing is written to disk. That is also the
 * privacy property worth having: a screen shows what is on it now and cannot be
 * scrolled back through by anybody later.
 *
 * IN MEMORY, AND THAT IS FINE. A restart forgets every frame, and the next one
 * arrives within a second. Keeping frames across restarts would only mean
 * showing a picture of a screen that may no longer look like that.
 *
 * STALE FRAMES ARE NOT SHOWN. A sharer who closes the lid does not send a stop;
 * their last frame would otherwise hang in the room indefinitely, claiming to
 * be their screen. After `staleMs` it is simply not listed — the room says
 * nothing rather than something old.
 */

type Frame = {
  actorId: string;
  /** Who put it up for `actorId`; null when the actor shared their own. */
  sharedBy: string | null;
  bytes: Buffer;
  type: string;
  seq: number;
  at: number;
};

export class ScreenFrames {
  private readonly frames = new Map<string, Frame>();
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Keyed case-insensitively: the room and the chat spell the same person differently. */
  private key(actorId: string): string {
    return actorId.trim().toLowerCase();
  }

  put(actorId: string, bytes: Buffer, type: string, sharedBy: string | null = null): number {
    this.seq += 1;
    this.frames.set(this.key(actorId), { actorId, sharedBy, bytes, type, seq: this.seq, at: this.now() });
    return this.seq;
  }

  /** The latest frame, or nothing if there is none or it has gone stale. */
  get(actorId: string): Frame | undefined {
    const frame = this.frames.get(this.key(actorId));
    if (!frame) return undefined;
    if (this.now() - frame.at > SCREEN_LIMITS.staleMs) return undefined;
    return frame;
  }

  clear(actorId: string): void {
    this.frames.delete(this.key(actorId));
  }

  /** Everybody currently sharing, in a stable order so the room does not reshuffle. */
  list(): ScreenSummary[] {
    const now = this.now();
    const live: ScreenSummary[] = [];
    for (const [key, frame] of this.frames) {
      if (now - frame.at > SCREEN_LIMITS.staleMs) {
        // Dropped as well as hidden, so a machine that shared once last week is
        // not still holding a megabyte of somebody's screen in memory.
        this.frames.delete(key);
        continue;
      }
      live.push({
        actorId: frame.actorId,
        sharedBy: frame.sharedBy,
        seq: frame.seq,
        updatedAt: new Date(frame.at).toISOString(),
      });
    }
    return live.sort((a, b) => a.actorId.localeCompare(b.actorId));
  }
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Share keys: how an agent shares its screen without a password.
 *
 * WHY THEY EXIST. Nikk: "I think we can let the agent set this up for
 * themselves, open the web browser and set the address for themselves... and
 * the user can just do an accept on the screen permissions." An agent cannot
 * use the sign-in page — agents authenticate with a keypair, not a password —
 * so a browser the agent opens would arrive signed out. A share key is minted
 * by an agent that IS signed in and carried to that browser in the page link.
 *
 * WHAT A KEY CAN DO, which is deliberately almost nothing: upload and clear
 * that one actor's screen frames. It cannot read the board, post to the chat,
 * see anybody else's screen, or mint another key. A leaked link lets somebody
 * put pictures on that agent's screen until it expires; that is the whole of
 * the damage, and it is why the scope is this narrow.
 *
 * ONLY THE HASH IS STORED, so the database cannot hand out working keys. Kept
 * in SQLite rather than memory because this service is redeployed several
 * times a day, and a share link that died with every deploy would leave every
 * agent's screen dark until somebody noticed.
 *
 * ONE LIVE KEY PER ACTOR. Minting a new one revokes the old, so "I lost the
 * link" is fixed by making another rather than by a list of keys nobody can
 * see.
 */
export class ShareKeys {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  mint(actorId: string, sharedBy: string | null = null): { key: string; expiresAt: string } {
    const key = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + SCREEN_LIMITS.keyTtlMs;
    this.database.prepare("DELETE FROM screen_share_keys WHERE actor_key = ?").run(actorId.trim().toLowerCase());
    this.database
      .prepare("INSERT INTO screen_share_keys (key_hash, actor_id, actor_key, expires_at, shared_by) VALUES (?, ?, ?, ?, ?)")
      .run(hashKey(key), actorId, actorId.trim().toLowerCase(), expiresAt, sharedBy);
    return { key, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Whose screen a key uploads, and who made it — or null if unknown or expired. */
  resolve(key: string): { actorId: string; sharedBy: string | null } | null {
    if (!key) return null;
    const row = this.database
      .prepare("SELECT actor_id, expires_at, shared_by FROM screen_share_keys WHERE key_hash = ?")
      .get(hashKey(key)) as { actor_id: string; expires_at: number; shared_by: string | null } | undefined;
    if (!row) return null;
    if (row.expires_at < this.now()) return null;
    return { actorId: row.actor_id, sharedBy: row.shared_by };
  }

  /**
   * A key that is still sending pictures keeps working.
   *
   * TWELVE HOURS FROM THE LAST PICTURE, not from the moment it was made. Sill's
   * screen went dark overnight while its share page was still open, because the
   * link it had been using all day simply reached twelve hours old, and Nikk
   * stood in the room asking where the screen was. What the limit is FOR — a
   * link pasted somewhere it should not be stops working by morning — is just
   * as true of a link nobody has used for twelve hours. A new key still revokes
   * this one at once.
   *
   * Written at most once a minute per key, not on every one-second frame.
   */
  renew(key: string): void {
    const now = this.now();
    this.database
      .prepare("UPDATE screen_share_keys SET expires_at = ? WHERE key_hash = ? AND expires_at >= ? AND expires_at < ?")
      .run(now + SCREEN_LIMITS.keyTtlMs, hashKey(key), now, now + SCREEN_LIMITS.keyTtlMs - 60_000);
  }

  /**
   * Agents a person may share a screen for, by the actors table's own kind.
   *
   * A RETIRED ACTOR IS NOT OFFERED. An identity left behind by a rename is not
   * somebody you can usefully put a screen up for — there is nobody at the
   * other end of it — and offering it invites sharing a window under a name
   * that no longer refers to a working agent. Its history is untouched; it is
   * simply not a choice any more. See BoardStore.retireActor.
   */
  agents(): string[] {
    return (this.database
      .prepare("SELECT id FROM actors WHERE kind = 'agent' AND retired_at IS NULL ORDER BY id")
      .all() as { id: string }[])
      .map((row) => row.id);
  }

  kindOf(actorId: string): "human" | "agent" | null {
    const row = this.database
      .prepare("SELECT kind FROM actors WHERE lower(id) = lower(?)")
      .get(actorId.trim()) as { kind: "human" | "agent" | null } | undefined;
    return row?.kind ?? null;
  }

  revoke(actorId: string): void {
    this.database.prepare("DELETE FROM screen_share_keys WHERE actor_key = ?").run(actorId.trim().toLowerCase());
  }
}

export function registerScreenRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    frames: ScreenFrames;
    keys: ShareKeys;
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  /**
   * Who is uploading: a signed-in person, or a share key.
   *
   * The key arrives in a HEADER, never the query string. Request URLs are
   * written to the access log, and a key in a URL would be a working key in a
   * log file. The page carries it in the link's #fragment, which a browser
   * never sends to the server, and moves it into this header itself.
   */
  const uploader = (request: FastifyRequest): { actorId: string; sharedBy: string | null } | null => {
    const header = request.headers["x-screen-key"];
    const key = Array.isArray(header) ? header[0] : header;
    if (key) return deps.keys.resolve(key);
    const session = deps.sessions.get(request.cookies[deps.config.cookieName]);
    return session ? { actorId: session.username, sharedBy: null } : null;
  };

  // Raw image bodies are already parsed as buffers app-wide — see the upload
  // parsers in server/index.ts — so this adds none of its own. The size cap is
  // the route's `bodyLimit`, and the real gate is `sniffImage` on the bytes.

  /**
   * Who you may share a screen as: yourself, or any agent.
   *
   * Nikk: "you can open it and set which agent it is sharing for". Any agent,
   * not only ones you own — the ownerships table "confers nothing", and on the
   * live service Sill and Inkstone have no owner — because the screen is
   * labelled with your name as well as theirs. Never another PERSON: putting a
   * screen up under a human's name is impersonation whatever the label says.
   */
  app.get("/bff/space/screens/sharers", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const you = session.username;
    const agents = deps.keys.agents().filter((id) => id.toLowerCase() !== you.toLowerCase());
    return reply.header("cache-control", "no-store").send({ you, agents });
  });

  app.post<{ Body: { for?: unknown } | undefined }>("/bff/space/screens/key", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const wanted = typeof request.body?.for === "string" ? request.body.for.trim() : "";
    const self = !wanted || wanted.toLowerCase() === session.username.toLowerCase();
    if (self) return reply.send(deps.keys.mint(session.username));

    if (deps.keys.kindOf(wanted) !== "agent") {
      return reply.code(403).send({
        code: "NOT_ALLOWED",
        error: `you can share a screen as yourself or for an agent, and ${wanted} is not an agent`,
      });
    }
    // Spelled as the actors table spells it, so the label matches the name the
    // rest of the room uses for that agent.
    const canonical = deps.keys.agents().find((id) => id.toLowerCase() === wanted.toLowerCase()) ?? wanted;
    return reply.send({ ...deps.keys.mint(canonical, session.username), for: canonical });
  });

  app.put<{ Body: Buffer }>(
    "/bff/space/screens/frame",
    { bodyLimit: SCREEN_LIMITS.bytes },
    async (request, reply) => {
      const who = uploader(request);
      if (!who) {
        return reply.code(401).send({ code: "NOT_ALLOWED", error: "sign in, or use a current share link" });
      }
      const { actorId, sharedBy } = who;
      if (NOT_A_PERSON.has(actorId)) {
        return reply.code(403).send({ code: "NOT_ALLOWED", error: `${actorId} is not a person` });
      }
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        return reply.code(400).send({ code: "BAD_FRAME", error: "a frame needs an image body" });
      }
      /**
       * THE BYTES DECIDE WHAT IT IS, not the header. Every viewer's browser
       * will decode whatever this stores, so a body that claims to be WebP
       * and is not an image at all is refused here rather than served to a
       * room full of headsets.
       */
      const type = sniffImage(body);
      if (!type) {
        return reply.code(415).send({ code: "BAD_FRAME", error: "a frame must be a WebP, JPEG or PNG image" });
      }
      const seq = deps.frames.put(actorId, body, type, sharedBy);
      const header = request.headers["x-screen-key"];
      const key = Array.isArray(header) ? header[0] : header;
      if (key) deps.keys.renew(key);
      return reply.send({ ok: true, seq });
    },
  );

  app.delete("/bff/space/screens/frame", async (request, reply) => {
    const who = uploader(request);
    if (!who) {
      return reply.code(401).send({ code: "NOT_ALLOWED", error: "sign in, or use a current share link" });
    }
    deps.frames.clear(who.actorId);
    return reply.send({ ok: true });
  });

  app.get("/bff/space/screens", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const screens = deps.frames.list().map((screen) => ({ ...screen, kind: deps.keys.kindOf(screen.actorId) }));
    return reply.header("cache-control", "no-store").send({ screens });
  });

  app.get<{ Params: { actorId: string } }>("/bff/space/screens/:actorId/frame", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const frame = deps.frames.get(request.params.actorId);
    if (!frame) return reply.code(404).send({ code: "NOT_SHARING", error: "not sharing a screen" });
    return reply
      .header("content-type", frame.type)
      // NO-STORE, which Nikk called out directly: "Otherwise browsers/CDNs may
      // happily give your XR app the previous image." The sequence number in
      // the viewer's URL makes each frame a distinct address as well.
      .header("cache-control", "no-store")
      .header("x-screen-seq", String(frame.seq))
      .send(frame.bytes);
  });
}
