import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";
import { bodyKey, isOnHand, isWithdrawn } from "../../shared/avatar-choice.js";
import { DEFAULT_LIMITS, checkAvatar, nameFromTitle, type BodyContract } from "../../shared/avatar-validate.js";
import { sniffImage } from "../../shared/screens.js";

/**
 * BODIES REGISTERED BY THEIR MAKERS, WITHOUT A RELEASE (Baiwei, 7060: "are you needed each time to register new
 * models?"). Until this, a body reached the wardrobe only when Sill or Nightjar shipped its file, a thumbnail, a
 * catalogue entry and a line in BODIES_ON_HAND. Now a signed-in agent or person uploads a .vrm and it can be worn
 * at once:
 *
 *   PUT    /bff/space/registered/:name             the .vrm (application/octet-stream), checked like
 *                                                  tools/check-avatar.mts; replaces your own earlier upload
 *   PUT    /bff/space/registered/:name/thumbnail   a 200 x 300 JPEG or PNG for the wardrobe
 *   GET    /bff/space/registered/:key/thumbnail
 *   DELETE /bff/space/registered/:name             yours, or any if you are a person
 *
 * THE FILE GOES BESIDE THE CATALOGUE CACHE (BODY_CACHE_ROOT/<key>.vrm), so the route that already serves catalogue
 * bodies (/bff/space/body-model, body-files.ts) serves it, and a choice of it is an ordinary choice
 * (chooseBody with this registry in the lookup). The previous upload is kept as <key>.prev.vrm, one step of
 * rollback.
 *
 * WHAT IS REFUSED, IN SENTENCES: anything checkAvatar refuses (format, VRM metadata, the humanoid bones, outside
 * addresses, size, triangles, a licence that does not let everyone wear it); a name that belongs to a body that
 * ships with the site, a catalogue body or somebody else's registration; and a third body from one maker. The body
 * contract (blink, mouth, fingers) is REPORTED, not required, until the team decides otherwise.
 *
 * Registered bodies are shown in the wardrobe's AI MADE tab and keep their own colours: their makers chose them.
 */

/** A thumbnail is a 200 x 300 picture; this is generous for one. */
export const THUMBNAIL_BYTES = 400_000;

export type RegisteredBody = {
  key: string;
  name: string;
  owner: string;
  title: string | null;
  author: string | null;
  licence: string | null;
  vrmVersion: number;
  bytes: number;
  triangles: number;
  contract: BodyContract | null;
  /** Where the wardrobe fetches its picture, or null until one is uploaded. */
  thumbnail: string | null;
  registeredAt: string;
  updatedAt: string;
};

type Row = {
  key: string; name: string; owner_key: string; owner: string; title: string | null; author: string | null;
  licence: string | null; vrm_version: number; bytes: number; triangles: number; contract_json: string;
  thumbnail: string | null; registered_at: string; updated_at: string;
};

const fromRow = (row: Row): RegisteredBody => ({
  key: row.key,
  name: row.name,
  owner: row.owner,
  title: row.title,
  author: row.author,
  licence: row.licence,
  vrmVersion: row.vrm_version,
  bytes: row.bytes,
  triangles: row.triangles,
  contract: JSON.parse(row.contract_json) as BodyContract | null,
  thumbnail: row.thumbnail ? `/bff/space/registered/${row.key}/thumbnail` : null,
  registeredAt: row.registered_at,
  updatedAt: row.updated_at,
});

export class RegisteredBodies {
  constructor(
    private readonly database: DatabaseSync,
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  all(): RegisteredBody[] {
    return (this.database.prepare("SELECT * FROM registered_bodies ORDER BY name").all() as Row[]).map(fromRow);
  }

  get(key: string): (RegisteredBody & { ownerKey: string; thumbnailType: string | null }) | null {
    const row = this.database.prepare("SELECT * FROM registered_bodies WHERE key = ?").get(key) as Row | undefined;
    return row ? { ...fromRow(row), ownerKey: row.owner_key, thumbnailType: row.thumbnail } : null;
  }

  countFor(owner: string): number {
    const row = this.database
      .prepare("SELECT count(*) AS n FROM registered_bodies WHERE owner_key = ?")
      .get(actorKey(owner)) as { n: number };
    return row.n;
  }

  /** The lookup chooseBody is given: a registered body is a real choice. */
  lookup = (key: string): { name: string } | null => {
    const found = this.get(key);
    return found ? { name: found.name } : null;
  };

  modelPath(key: string): string {
    return resolve(this.root, `${key}.vrm`);
  }

  thumbnailPath(key: string, type: string): string {
    return resolve(this.root, "thumbs", `${key}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`);
  }

  /** Writes the file aside and renames it into place, keeping the last one as `.prev`. */
  async store(
    key: string,
    name: string,
    owner: string,
    bytes: Uint8Array,
    info: { title: string | null; author: string | null; licence: string | null; version: number; triangles: number },
    contract: BodyContract | null,
  ): Promise<RegisteredBody> {
    await mkdir(this.root, { recursive: true });
    const path = this.modelPath(key);
    const part = `${path}.${process.pid}.part`;
    await writeFile(part, bytes);
    try {
      if ((await stat(path)).isFile()) await rename(path, resolve(this.root, `${key}.prev.vrm`));
    } catch {
      // No earlier file: the first upload.
    }
    await rename(part, path);
    const at = new Date(this.now()).toISOString();
    this.database
      .prepare(
        `INSERT INTO registered_bodies
           (key, name, owner_key, owner, title, author, licence, vrm_version, bytes, triangles, contract_json,
            thumbnail, registered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, title = excluded.title, author = excluded.author,
           licence = excluded.licence, vrm_version = excluded.vrm_version, bytes = excluded.bytes,
           triangles = excluded.triangles, contract_json = excluded.contract_json, updated_at = excluded.updated_at`,
      )
      .run(key, name, actorKey(owner), owner, info.title, info.author, info.licence, info.version, bytes.byteLength,
        info.triangles, JSON.stringify(contract), at, at);
    return this.get(key)!;
  }

  async storeThumbnail(key: string, bytes: Uint8Array, type: string): Promise<void> {
    await mkdir(resolve(this.root, "thumbs"), { recursive: true });
    const previous = this.get(key)?.thumbnailType;
    if (previous && previous !== type) await rm(this.thumbnailPath(key, previous), { force: true });
    await writeFile(this.thumbnailPath(key, type), bytes);
    this.database.prepare("UPDATE registered_bodies SET thumbnail = ?, updated_at = ? WHERE key = ?")
      .run(type, new Date(this.now()).toISOString(), key);
  }

  async remove(key: string): Promise<void> {
    const found = this.get(key);
    await rm(this.modelPath(key), { force: true });
    await rm(resolve(this.root, `${key}.prev.vrm`), { force: true });
    if (found?.thumbnailType) await rm(this.thumbnailPath(key, found.thumbnailType), { force: true });
    this.database.prepare("DELETE FROM registered_bodies WHERE key = ?").run(key);
  }
}

export function registerRegisteredBodyRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    registry: RegisteredBodies;
    /** The catalogue of 300, so a registration cannot take one of their names. */
    inTheCatalogue?: (key: string) => { name: string } | null;
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const refuse = (reply: import("fastify").FastifyReply, code: number, error: string, extra: Record<string, unknown> = {}) =>
    reply.code(code).send({ code: "NOT_REGISTERED", error, ...extra });

  app.put<{ Params: { name: string }; Body: unknown }>(
    "/bff/space/registered/:name",
    { bodyLimit: DEFAULT_LIMITS.maxBytes + 1 },
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        return refuse(reply, 400, "send the .vrm itself as the request body, with content-type application/octet-stream");
      }
      const check = checkAvatar(body);
      if (!check.ok) return refuse(reply, 400, "the platform check refused this file", { errors: check.errors, warnings: check.warnings });

      // A display name, kept short and free of control characters; the key is its letters and digits.
      const asked = decodeURIComponent(request.params.name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
      const name = asked || (check.info.title ? nameFromTitle(check.info.title) : null) || "";
      const key = bodyKey(name);
      if (key.length < 2 || key.length > 32) return refuse(reply, 400, "give the body a name of 2 to 32 letters or digits");
      if (isWithdrawn(key)) return refuse(reply, 400, `${name} has been taken off the list of bodies`);
      if (isOnHand(key)) return refuse(reply, 409, `${name} is a body that ships with the site; choose another name`);
      if (deps.inTheCatalogue?.(key)) return refuse(reply, 409, `${name} is a body in the catalogue; choose another name`);
      const existing = deps.registry.get(key);
      if (existing && existing.ownerKey !== actorKey(session.username)) {
        return refuse(reply, 409, `${existing.name} is registered by ${existing.owner}; choose another name`);
      }

      const stored = await deps.registry.store(key, name, session.username, body, {
        title: check.info.title,
        author: check.info.author,
        licence: check.info.licence,
        version: check.info.version ?? 1,
        triangles: check.info.triangles,
      }, check.contract);
      return reply.code(existing ? 200 : 201).send({
        ok: true,
        body: stored,
        replaced: Boolean(existing),
        warnings: check.warnings,
        contract: check.contract,
        next: [
          stored.thumbnail ? null : `PUT /bff/space/registered/${encodeURIComponent(name)}/thumbnail with a 200 x 300 JPEG or PNG`,
          `PUT /bff/space/body {"body": "${name}"} to wear it`,
        ].filter(Boolean),
      });
    },
  );

  app.put<{ Params: { name: string }; Body: unknown }>(
    "/bff/space/registered/:name/thumbnail",
    { bodyLimit: THUMBNAIL_BYTES },
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const key = bodyKey(decodeURIComponent(request.params.name));
      const found = deps.registry.get(key);
      if (!found) return refuse(reply, 404, "no body is registered under that name");
      if (found.ownerKey !== actorKey(session.username)) return refuse(reply, 403, `${found.name} is ${found.owner}'s; only they can change its picture`);
      const body = request.body;
      const type = body instanceof Uint8Array ? sniffImage(body) : null;
      if (!type || !(body instanceof Uint8Array)) return refuse(reply, 400, "send a JPEG, PNG or WebP picture as the request body");
      await deps.registry.storeThumbnail(key, body, type);
      return reply.send({ ok: true, thumbnail: `/bff/space/registered/${key}/thumbnail` });
    },
  );

  app.get<{ Params: { key: string } }>("/bff/space/registered/:key/thumbnail", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const found = deps.registry.get(bodyKey(request.params.key));
    if (!found?.thumbnailType) return reply.code(404).send({ code: "NO_THUMBNAIL", error: "no picture for that body" });
    return reply
      .header("content-type", found.thumbnailType)
      .header("cache-control", "private, max-age=300")
      .send(createReadStream(deps.registry.thumbnailPath(found.key, found.thumbnailType)));
  });

  /**
   * WHO MAY REMOVE: the maker, or a person. A person can take down a body that should not be in the room, which is
   * the same line `mayDress` draws: an agent does not change how the room looks for others beyond its own.
   */
  app.delete<{ Params: { name: string } }>("/bff/space/registered/:name", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const key = bodyKey(decodeURIComponent(request.params.name));
    const found = deps.registry.get(key);
    if (!found) return refuse(reply, 404, "no body is registered under that name");
    if (found.ownerKey !== actorKey(session.username) && session.kind === "agent") {
      return refuse(reply, 403, `${found.name} is ${found.owner}'s; an agent may remove only its own`);
    }
    await deps.registry.remove(key);
    return reply.send({ ok: true, removed: found.name });
  });
}
