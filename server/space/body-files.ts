import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { bodyKey, isOnHand } from "../../shared/avatar-choice.js";
import { readVrmMeta, whyNotUsable } from "../../shared/vrm-meta.js";
import type { CatalogueBody } from "./catalogue.js";

/**
 * Serving a body that does not ship with this site.
 *
 * Fifteen bodies are committed files. The catalogue lists 300, and until this
 * existed the other 285 could be CHOSEN and not WORN — so an agent picked a
 * name and then waited for somebody to commit a 2MB binary, which is the nine
 * hours this whole line of work is about, moved one step later.
 *
 * FETCHED ONCE, THEN LOCAL. The first browser to ask pulls it from the
 * collection; every request after that is served off disk. Nobody's onboarding
 * should depend on somebody else's uptime, which is the same reason the
 * catalogue is a static file rather than a live call.
 *
 * NO CALLER EVER SUPPLIES A URL. The slug is looked up in our own catalogue and
 * the address comes from there, so there is no request a caller can aim
 * anywhere. Anything not in the catalogue is a 404 before a socket is opened.
 *
 * AND THE LICENCE IS CHECKED AGAIN, FROM THE BYTES. The catalogue records what
 * was true when it was read; this checks the file in hand before handing it to
 * anybody, and refuses without caching if it is not CC0, not released to
 * Everyone, or missing a bone this room poses. A stored assertion about
 * somebody else's bytes is evidence of what we saw, not a promise about what
 * we are about to serve.
 */

/** Refuse anything absurd before reading it into memory. */
const MAX_BYTES = 40 * 1024 * 1024;

/** How long a fetch may take. The slowest measured real one was 2.2s. */
const FETCH_TIMEOUT_MS = 60_000;

export type BodyFileResult =
  | { ok: true; path: string; fetched: boolean }
  | { ok: false; code: number; error: string };

export class BodyFiles {
  /**
   * One in-flight fetch per body.
   *
   * Four browsers entering the room together ask for the same body at the same
   * moment. Without this they would each pull 8MB and three would write over
   * the finished file — so they share one fetch and all four get the same
   * answer.
   */
  private readonly inFlight = new Map<string, Promise<BodyFileResult>>();

  constructor(
    private readonly root: string,
    private readonly lookUp: (key: string) => CatalogueBody | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private pathFor(slug: string): string {
    return resolve(this.root, `${slug}.vrm`);
  }

  async want(slug: string): Promise<BodyFileResult> {
    const key = bodyKey(slug);
    if (key === "") return { ok: false, code: 404, error: "no body was named" };
    /**
     * A body that ships with the site must never come through here. It would
     * work — and it would mean two URLs for one file, one of them uncached by
     * the browser, which is the sort of thing that looks fine and doubles the
     * bytes a headset downloads.
     */
    if (isOnHand(key)) {
      return { ok: false, code: 404, error: `${slug} ships with this site; load it from /avatars/${key}.vrm` };
    }
    const already = await this.onDisk(key);
    if (already) return { ok: true, path: already, fetched: false };
    const running = this.inFlight.get(key);
    if (running) return running;
    const started = this.fetchAndKeep(key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);
    return started;
  }

  private async onDisk(key: string): Promise<string | null> {
    const path = this.pathFor(key);
    try {
      const found = await stat(path);
      return found.isFile() && found.size > 0 ? path : null;
    } catch {
      return null;
    }
  }

  private async fetchAndKeep(key: string): Promise<BodyFileResult> {
    const entry = this.lookUp(key);
    if (!entry) return { ok: false, code: 404, error: `no body called ${key} is in the catalogue` };

    let bytes: Uint8Array;
    try {
      const response = await this.fetchImpl(entry.model, {
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, code: 502, error: `the collection answered ${response.status} for ${entry.name}` };
      }
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) {
        return { ok: false, code: 502, error: `${entry.name} is ${declared} bytes, which is more than this will hold` };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      // The collection being unreachable is not this site being broken, and
      // the message has to say which — the machine this was written on has a
      // proxy that dies and returns, and two wrong diagnoses came from exactly
      // this confusion.
      return {
        ok: false,
        code: 502,
        error: `could not reach the collection for ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (bytes.length > MAX_BYTES) {
      return { ok: false, code: 502, error: `${entry.name} is larger than this will hold` };
    }

    const meta = readVrmMeta(bytes);
    if ("error" in meta) {
      return { ok: false, code: 502, error: `${entry.name} is not a readable VRM: ${meta.error}` };
    }
    const unusable = whyNotUsable(meta);
    if (unusable) {
      // NOT CACHED. A file we will not serve must not be kept, or the next
      // reader finds it on disk and serves it without ever checking.
      return { ok: false, code: 403, error: `${entry.name} cannot be worn here: ${unusable}` };
    }

    const path = this.pathFor(key);
    try {
      await mkdir(this.root, { recursive: true });
      /**
       * WRITTEN ASIDE AND RENAMED. A half-written file at the real path is a
       * body that passes the `onDisk` check and then fails to parse in
       * somebody's browser, for ever, with nothing to say why. Rename is
       * atomic on one filesystem, so a reader sees either no file or a whole
       * one.
       */
      const part = `${path}.${process.pid}.part`;
      await writeFile(part, bytes);
      await rename(part, path);
    } catch (error) {
      return {
        ok: false,
        code: 500,
        error: `${entry.name} was fetched and could not be stored: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { ok: true, path, fetched: true };
  }
}

export function registerBodyFileRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; files: BodyFiles },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  /**
   * SIGNED IN, like every other room route. These are CC0 files anybody could
   * fetch from the collection themselves, so this is not protecting the bytes
   * — it is refusing to let an unauthenticated caller spend this server's
   * bandwidth and disk pulling 300 files.
   */
  app.get<{ Params: { file: string } }>("/bff/space/body-model/:file", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const asked = request.params.file.replace(/\.vrm$/i, "");
    const result = await deps.files.want(asked);
    if (!result.ok) return reply.code(result.code).send({ code: "NO_BODY_FILE", error: result.error });
    return reply
      .header("content-type", "model/gltf-binary")
      // Immutable: the slug names one file in a collection that does not
      // rewrite them, so a browser and a headset should keep it.
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(createReadStream(result.path));
  });
}
