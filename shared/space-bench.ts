/**
 * THE WORKBENCH: A SPACE'S PIECES, LIVE IN ITS SAHA.ING ROOM (Nikk,
 * 2026-09-29: "as they are working on one of the pieces, we can see it inside
 * of the saha.ing group ... as it's been adjusted on the git, it can be seen
 * live in the saha.ing space").
 *
 * A space's repo lists its pieces in saha-pieces.json. The saha.ing room of
 * the same name shows them on a bench, from the branch the team picks (main,
 * or a work branch like wip), and every push to that branch reloads them in
 * the room for everyone standing there.
 *
 *   { "pieces": [
 *       { "id": "orb",   "name": "Meditation orb", "model": "models/orb.glb", "spin": true },
 *       { "id": "sky",   "name": "Sky study",      "image": "art/sky.png" },
 *       { "id": "bell",  "name": "Bell instrument", "page": "bell/" },
 *       { "id": "marimba", "name": "Marimba", "code": "pieces/marimba.js" }
 *   ] }
 *
 * A LIVE piece is a module that exports default function (saha) {...}: it
 * RUNS on the bench, in the room and in VR, for everyone standing there, in a
 * sandboxed worker (shared/piece-wire.ts). Its values and moments are the
 * space's own, so it is the same piece in the room and in the space.
 *
 *       { "id": "drums", "name": "Hand drums", "live": "pieces/drums.js" }
 *
 * A CODE piece is a JavaScript module other spaces import by URL
 * (import { createMarimba } from "/s/xr.instruments/pieces/marimba.js"). The
 * bench does not run it; public spaces' pieces are listed for everyone at
 * GET /bff/spaces/pieces, the catalogue (Nikk, 2026-09-29: build once, use anywhere).
 *
 * MODELS AND PICTURES COME INTO THE ROOM; PAGES DO NOT. A .glb is data: the
 * room can load it safely. A page is somebody's code, and running it inside
 * saha.ing's own page would let it act as whoever is looking, so a page
 * piece is a portal: tap it and you go to that page (multiplayer, as
 * yourself). Paths are inside the published folder, like every URL of the
 * space.
 */

export type BenchPiece = {
  id: string;
  name: string;
  kind: "model" | "image" | "page" | "code" | "live" | "item" | "environment" | "space";
  /** The file or folder, relative to the published site. */
  path: string;
  /** Model only: turn slowly on the bench. */
  spin: boolean;
  /**
   * An item, environment or space: the module's function to call, when it is
   * not the default export (Sill's instruments export createDrums and the like).
   */
  export?: string;
};

/**
 * THE THREE KINDS OF THING A ROOM CAN BRING IN (Nikk, 2026-10-01; see
 * ModuleRoomItem in shared/room-items.ts), each a JavaScript module of the
 * space, listed in saha-pieces.json by its kind:
 *
 *   { "id": "drums",  "name": "Hand drums", "item": "pieces/drums.js", "export": "createDrums" },
 *   { "id": "forest", "name": "Forest",     "environment": "env/forest.js" },
 *   { "id": "grove",  "name": "Grove concert", "space": "grove.js" }
 *
 * The module's function is called with { scene, camera, renderer, THREE, room,
 * at, rotationY, id, saha } and may return { update(dt, t), dispose() }
 * (src/space/modules/run-module.ts has the whole of it).
 */
export const MODULE_KINDS = ["item", "environment", "space"] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];
export const isModuleKind = (kind: BenchPiece["kind"]): kind is ModuleKind => (MODULE_KINDS as readonly string[]).includes(kind);

export const BENCH_LIMITS = {
  pieces: 32,
  modelBytes: 50 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
} as const;

const MODEL = /\.(glb|gltf)$/i;
const CODE = /\.m?js$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A path inside the site: no leading slash, no .., no dot-files (which are never published). */
function sitePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".." || part.startsWith("."))) return null;
  return parts.join("/") + (raw.endsWith("/") ? "/" : "");
}

/**
 * Read saha-pieces.json against the files a deploy actually published
 * (path -> bytes, relative to the site). Every problem is named, and one bad
 * piece does not hide the others: good pieces are kept, bad ones listed.
 */
export function readPieces(text: string, published: ReadonlyMap<string, number>): { pieces: BenchPiece[]; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { pieces: [], problems: ["saha-pieces.json is not valid JSON."] };
  }
  const list = (raw as { pieces?: unknown })?.pieces;
  if (!Array.isArray(list)) return { pieces: [], problems: ['saha-pieces.json needs a "pieces" list.'] };
  const pieces: BenchPiece[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = typeof item.id === "string" ? item.id : `piece ${index + 1}`;
    if (pieces.length >= BENCH_LIMITS.pieces) {
      problems.push(`Only ${BENCH_LIMITS.pieces} pieces fit on the bench; ${label} and after are left off.`);
      break;
    }
    if (typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id)) {
      problems.push(`${label}: needs a unique "id" of lower-case letters, digits, - or _.`);
      continue;
    }
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : item.id;
    const kinds = (["model", "image", "page", "code", "live", ...MODULE_KINDS] as const).filter((kind) => item[kind] !== undefined);
    if (kinds.length !== 1) {
      problems.push(`${label}: give exactly one of "model", "image", "page", "code", "live", "item", "environment" or "space".`);
      continue;
    }
    const kind = kinds[0];
    const path = sitePath(item[kind]);
    if (path === null) {
      problems.push(`${label}: "${kind}" must be a path inside the published site.`);
      continue;
    }
    if (kind === "model" || kind === "image") {
      const pattern = kind === "model" ? MODEL : IMAGE;
      const limit = kind === "model" ? BENCH_LIMITS.modelBytes : BENCH_LIMITS.imageBytes;
      const size = published.get(path);
      if (!pattern.test(path)) {
        problems.push(`${label}: a ${kind} must be ${kind === "model" ? ".glb or .gltf" : ".png, .jpg or .webp"}.`);
        continue;
      }
      if (size === undefined) {
        problems.push(`${label}: ${path} is not in what was published.`);
        continue;
      }
      if (size > limit) {
        problems.push(`${label}: ${path} is ${Math.round(size / 1048576)} MB; the bench takes up to ${limit / 1048576} MB.`);
        continue;
      }
    } else if (kind === "code" || kind === "live" || isModuleKind(kind)) {
      if (!CODE.test(path) || !published.has(path)) {
        problems.push(`${label}: "${kind}" must be a .js file that was published; ${path} is not.`);
        continue;
      }
    } else {
      const page = path.endsWith("/") ? `${path}index.html` : path;
      if (!published.has(page) && !published.has(`${path}/index.html`)) {
        problems.push(`${label}: there is no page at ${path}.`);
        continue;
      }
    }
    const exported = item.export;
    if (exported !== undefined && (typeof exported !== "string" || !/^[A-Za-z_$][\w$]{0,63}$/.test(exported))) {
      problems.push(`${label}: "export" must be the name of a function the module exports.`);
      continue;
    }
    seen.add(item.id);
    pieces.push({ id: item.id, name, kind, path, spin: item.spin === true, ...(typeof exported === "string" && isModuleKind(kind) ? { export: exported } : {}) });
  }
  return { pieces, problems };
}

/** One entry in the catalogue of every public space's pieces. */
export type CataloguePiece = { space: string; id: string; name: string; kind: BenchPiece["kind"]; url: string };

/** A public space's live pieces as catalogue entries; URLs are stable (no deploy id) so other spaces can import them. */
export function catalogueOf(space: string, pieces: readonly BenchPiece[]): CataloguePiece[] {
  return pieces.map((piece) => ({ space, id: piece.id, name: piece.name, kind: piece.kind, url: `/s/${space}/${piece.path}` }));
}

/**
 * THE KIT'S OWN PIECES, listed with every space's, so they are found where
 * people look for things to use (Sill, 6289). They live in /kit/saha.js and
 * are imported by name: import { openDoor } from "/kit/saha.js".
 */
export const KIT_PIECES: readonly CataloguePiece[] = [
  { space: "saha.ing kit", id: "openScreen", name: "Screen: any space or web page on a panel (openScreen)", kind: "code", url: "/kit/saha.js" },
  { space: "saha.ing kit", id: "openDoor", name: "Door: into another space or the lobby, staying in VR (openDoor)", kind: "code", url: "/kit/saha.js" },
];

/** Where the bench stands in a room: behind and to the right of where people arrive, clear of every piece and panel. */
export const BENCH_AT = { x: 3.4, z: 9.4 } as const;
/** Pedestals per row, and their spacing, in metres. */
export const BENCH_ROW = { perRow: 4, gap: 0.85, rowGap: 0.9 } as const;

/** Each piece's spot on the bench, in the bench's own frame (x across, z back). */
export function benchSlot(index: number): { x: number; z: number; height: number } {
  const row = Math.floor(index / BENCH_ROW.perRow);
  const column = index % BENCH_ROW.perRow;
  return {
    x: (column - (BENCH_ROW.perRow - 1) / 2) * BENCH_ROW.gap,
    z: row * BENCH_ROW.rowGap,
    // The back row stands taller, so it shows over the front.
    height: 0.8 + row * 0.25,
  };
}

/**
 * A module of one deploy, by a path that names the deploy: /s/<space>/~<deploy>/<path>.
 * Every file it imports in turn resolves inside the same deploy, so a push
 * gives every one of them a new address and the room loads the new code whole,
 * never a fresh entry importing the old version's other files.
 */
export function moduleUrl(space: string, deployId: string, path: string): string {
  return `/s/${space}/~${deployId}/${path}`;
}

/** The URL of a piece in a deploy, with the deploy id so a new push is a new URL (no stale cache). */
export function pieceUrl(space: string, branch: string, path: string, deployId: string): string {
  const root = branch === "main" ? `/s/${space}/` : `/s/${space}/@${branch}/`;
  return `${root}${path}?v=${encodeURIComponent(deployId)}`;
}
