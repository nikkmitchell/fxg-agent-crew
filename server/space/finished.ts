import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { finishedRoomName, finishedTitle, type FinishedSpace } from "../../shared/finished-spaces.js";
import { isModuleItem, parseModuleItem, type ModuleRoomItem, type RoomItem } from "../../shared/room-items.js";
import { roomKey } from "../../shared/space-room.js";
import type { Config } from "../config.js";
import { makeRequireSession } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { WebharnessError, type WebharnessClient } from "../webharness/client.js";
import type { RoomItems } from "./items.js";

/**
 * FINISHED SPACES, KEPT (shared/finished-spaces.ts). One row per room that is
 * a finished experience: what it shows and the deploy it is pinned to.
 */
export class FinishedSpaces {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS finished_spaces (
      room TEXT PRIMARY KEY, title TEXT NOT NULL, space TEXT NOT NULL, branch TEXT NOT NULL,
      entry TEXT NOT NULL, deploy TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL)`);
  }
  all(): FinishedSpace[] {
    return this.db.prepare("SELECT * FROM finished_spaces ORDER BY title").all() as FinishedSpace[];
  }
  get(room: string): FinishedSpace | null {
    return (this.db.prepare("SELECT * FROM finished_spaces WHERE room = ?").get(roomKey(room)) as FinishedSpace | undefined) ?? null;
  }
  /** Is this room a finished space: its things are not to be moved, changed or taken away. */
  has(room: string): boolean {
    return this.get(room) !== null;
  }
  put(finished: FinishedSpace): void {
    this.db.prepare(`INSERT INTO finished_spaces (room, title, space, branch, entry, deploy, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room) DO UPDATE SET title = excluded.title, space = excluded.space, branch = excluded.branch, entry = excluded.entry,
      deploy = excluded.deploy, by = excluded.by, at = excluded.at`)
      .run(roomKey(finished.room), finished.title, finished.space, finished.branch, finished.entry, finished.deploy, finished.by, finished.at);
  }
}

type Describe = (who: { username: string; token: string }, source: { space: string; branch: string; entry: string }) =>
  Promise<{ name: string; role: "item" | "environment" | "space" } | { status: number; error: string }>;

/**
 * PUBLISH, LIST AND UPDATE (Nikk, 6940).
 *
 *   GET  /bff/finished                 every finished space, for the room selector's first tab
 *   POST /bff/finished                 { title, source: { space, branch, entry } }: make the room, pinned
 *   POST /bff/finished/:room/update    pin it to the branch's live deploy now
 *
 * Publishing makes a PUBLIC WebHarness room named by the title, as the person
 * publishing (who therefore owns it), and puts the one thing in it at full
 * size, pinned. Only a space or an environment can be a finished space.
 */
export function registerFinishedRoutes(app: FastifyInstance, options: {
  config: Config;
  sessions: SessionStore;
  finished: FinishedSpaces;
  items: RoomItems;
  client: Pick<WebharnessClient, "request">;
  describeModule: Describe;
  /** The live deploy of a space's branch, to pin to; null when nothing is live. */
  liveDeploy: (space: string, branch: string) => string | null;
  announce: (room: string, items: RoomItem[], by: string) => void;
}): void {
  const requireSession = makeRequireSession(options.config, options.sessions);

  app.get("/bff/finished", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.header("cache-control", "no-store").send({ spaces: options.finished.all() });
  });

  app.post<{ Body: { title?: unknown; source?: unknown } }>("/bff/finished", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const title = finishedTitle(request.body?.title);
    const roomName = title ? finishedRoomName(title) : null;
    if (!title || !roomName) return reply.code(400).send({ code: "BAD_TITLE", error: "Give it a title of 2 to 48 characters, with some letters or digits in it." });
    const draft = parseModuleItem({ id: "draft", kind: "module", source: request.body?.source ?? {}, role: "space", view: "full", position: { x: 0, y: 0, z: 0, rotationY: 0 }, scale: 1 });
    if (!draft) return reply.code(400).send({ code: "BAD_SOURCE", error: "Say which space, branch and thing: { source: { space, branch, entry } }." });
    const source = { space: draft.source.space, branch: draft.source.branch, entry: draft.source.entry };
    const described = await options.describeModule({ username: session.username, token: session.token }, source);
    if ("error" in described) return reply.code(described.status).send({ error: described.error });
    if (described.role === "item") return reply.code(400).send({ code: "NOT_A_SPACE", error: "A finished space is a space or an environment; an item goes inside one." });
    const deploy = options.liveDeploy(source.space, source.branch);
    if (!deploy) return reply.code(409).send({ code: "NOTHING_LIVE", error: `${source.space} has nothing live on ${source.branch} to pin.` });
    if (options.finished.has(roomName)) return reply.code(409).send({ code: "TAKEN", error: `There is already a finished space called ${title}.` });

    // The room itself: public, so everyone can find and enter it; made as the person publishing.
    try {
      const made = await options.client.request<{ created?: boolean; roomName?: string }>("/api/rooms", {
        method: "POST",
        token: session.token,
        body: { roomName, visibility: "public" },
      });
      if (made?.created === false) return reply.code(409).send({ code: "ROOM_EXISTS", error: `A room called ${roomName} already exists; pick another title.` });
    } catch (error) {
      if (error instanceof WebharnessError && error.status === 401) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "Sign in again.", reauth: true });
      if (error instanceof WebharnessError && error.status === 422) return reply.code(400).send({ code: "BAD_TITLE", error: `WebHarness would not name a room ${roomName}.` });
      return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "WebHarness could not make the room." });
    }

    const item: ModuleRoomItem = {
      ...draft,
      id: randomUUID(),
      source: { ...source, deploy },
      name: described.name,
      role: described.role,
      view: "full",
      position: { x: 0, y: 0, z: 0, rotationY: 0 },
      scale: 1,
      addedBy: session.username,
    };
    const room = roomKey(roomName);
    for (const other of options.items.all(room)) options.items.remove(room, other.id);
    options.items.insert(room, item, session.username);
    const finished: FinishedSpace = { room, title, ...source, deploy, by: session.username, at: new Date().toISOString() };
    options.finished.put(finished);
    options.announce(room, options.items.all(room), session.username);
    return reply.code(201).send({ finished });
  });

  app.post<{ Params: { room: string } }>("/bff/finished/:room/update", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const finished = options.finished.get(request.params.room);
    if (!finished) return reply.code(404).send({ error: "There is no finished space by that name." });
    const source = { space: finished.space, branch: finished.branch, entry: finished.entry };
    // Whoever may use its source may update it (the same check as bringing it in).
    const described = await options.describeModule({ username: session.username, token: session.token }, source);
    if ("error" in described) return reply.code(described.status).send({ error: described.error });
    const deploy = options.liveDeploy(finished.space, finished.branch);
    if (!deploy) return reply.code(409).send({ code: "NOTHING_LIVE", error: `${finished.space} has nothing live on ${finished.branch}.` });
    for (const item of options.items.all(finished.room).filter(isModuleItem)) {
      if (item.source.space !== finished.space || item.source.entry !== finished.entry) continue;
      options.items.save(finished.room, { ...item, revision: item.revision + 1, source: { ...source, deploy } }, session.username);
    }
    const updated: FinishedSpace = { ...finished, deploy, by: session.username, at: new Date().toISOString() };
    options.finished.put(updated);
    options.announce(finished.room, options.items.all(finished.room), session.username);
    return reply.send({ finished: updated });
  });
}
