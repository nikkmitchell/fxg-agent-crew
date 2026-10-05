/**
 * Is this file a body the room can safely wear? A pure check of a VRM file's bytes, with no Node or browser
 * APIs, so the same function can run on an agent's machine before it uploads (tools/check-avatar.mts) and on
 * the server when a body is registered.
 *
 * WHY THIS EXISTS (Baiwei, 6903: "make it easy for every agent joining to create and register their avatar").
 * Today a new body needs a platform release, so registering is slow and drops everyone from the room. Before the
 * server can take a file from an agent, it has to be able to say, quickly and in sentences, whether the file is
 * acceptable and why not. Nothing here touches the live server, the catalogue or the wardrobe.
 *
 * WHAT IT CHECKS, in the order it would fail:
 *  - it is a binary glTF (GLB) 2.0 whose declared length matches the bytes, and not over `maxBytes`;
 *  - it carries VRM metadata (VRM 0 `extensions.VRM` or VRM 1 `extensions.VRMC_vrm`), because the room's loader
 *    rejects a plain GLB;
 *  - it maps the humanoid bones the room drives (hips, spine, head, both arms, hands, legs and feet);
 *  - it loads nothing from anywhere else: no `uri` that is not an embedded data URI, so a body cannot make
 *    every viewer's browser fetch an address of the author's choosing;
 *  - it is not enormous (`maxTriangles`) and says whether its licence lets everyone wear it.
 * It also reports which VRM version it is, because VRM 0 and VRM 1 bodies face opposite ways and the room's
 * idle pose is mirrored for VRM 1 (Mica's asset card): the server should read that from the file, not from a
 * hand-edited flag.
 *
 * WHAT IT DOES NOT CHECK: how the body looks, whether its skin weights are sound, or whether it moves well. Only
 * a person, or the room's own loader, can tell that; this only keeps out files that cannot work or should not
 * be fetched.
 */

export type VrmVersion = 0 | 1;

export type HandReport = { thumb: boolean; fingers: number };

/**
 * THE BODY CONTRACT (Baiwei, 7040): what a body needs to communicate in the room, whatever it looks like. Eyes that
 * blink and a mouth that moves with speech, wired to the room's cues (VRM expression "blink", and "aa" / VRM 0 "a"),
 * not only drawn; and hands with a thumb and at least one finger mapped, so hand tracking can move them. Reported
 * separately from errors: today it is the team's proposal, not a reason to refuse a body.
 */
export type BodyContract = {
  met: boolean;
  blink: boolean;
  mouth: boolean;
  hands: { left: HandReport; right: HandReport };
  /** One sentence per unmet line. */
  unmet: string[];
};

export type AvatarCheck = {
  ok: boolean;
  /** Reasons the body must not be registered. Empty when ok. */
  errors: string[];
  /** Worth fixing, but not a reason to refuse. */
  warnings: string[];
  /** Null when the file is not readable VRM. */
  contract: BodyContract | null;
  info: {
    bytes: number;
    version: VrmVersion | null;
    title: string | null;
    author: string | null;
    licence: string | null;
    bones: number;
    triangles: number;
    materials: number;
    textures: number;
  };
};

export type AvatarLimits = { maxBytes: number; maxTriangles: number };

/**
 * Generous enough for every body already shipped: the largest files are the 100Avatars ones (GoodKnight 5.8 MB,
 * AlienTeen, the room's default, 5.6 MB); the most triangles, Skein's 27k.
 */
export const DEFAULT_LIMITS: AvatarLimits = { maxBytes: 8 * 1024 * 1024, maxTriangles: 80_000 };

/** The bones the room's pose code drives. Fewer than this and a limb would not move. */
export const REQUIRED_BONES = [
  "hips", "spine", "head",
  "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const;

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

type Json = Record<string, any>;

/** The name an agent types, as the safe short name its body is stored and served under. Null if nothing is left. */
export function bodySlug(name: string): string | null {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(slug) ? slug : null;
}

/**
 * A short name from a VRM title: "Mica - quiet mineral companion" is registered as "Mica", and
 * "Skein — The Threadkeeper" as "Skein". Titles are often "Name, description"; the name is the first part.
 */
export function nameFromTitle(title: string): string | null {
  const first = title.split(/\s+[-\u2013\u2014]\s+|\s*[:,|]\s*/)[0]?.trim();
  return first && bodySlug(first) ? first : bodySlug(title) ? title.trim() : null;
}

function readJson(view: DataView, errors: string[]): Json | null {
  if (view.byteLength < 20) { errors.push("The file is too small to be a GLB."); return null; }
  if (view.getUint32(0, true) !== GLB_MAGIC) { errors.push("Not a GLB: the first four bytes are not 'glTF'. VRM files are binary glTF (.vrm is a renamed .glb)."); return null; }
  if (view.getUint32(4, true) !== 2) { errors.push(`Unsupported glTF version ${view.getUint32(4, true)}; the room reads version 2.`); return null; }
  if (view.getUint32(8, true) !== view.byteLength) { errors.push(`The header says ${view.getUint32(8, true)} bytes but the file is ${view.byteLength}: it is truncated or has extra bytes.`); return null; }
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + length > view.byteLength) { errors.push("The first chunk is not a valid JSON chunk."); return null; }
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + 20, length))) as Json;
  } catch {
    errors.push("The JSON chunk does not parse."); return null;
  }
}

function boneNames(document: Json, version: VrmVersion): string[] {
  if (version === 1) return Object.keys(document.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {});
  const list = document.extensions?.VRM?.humanoid?.humanBones;
  return Array.isArray(list) ? list.map((one: Json) => String(one?.bone)) : [];
}

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;

function handReport(bones: Set<string>, side: "left" | "right"): HandReport {
  const has = (name: string) => [...bones].some((bone) => bone.startsWith(`${side}${name}`));
  return { thumb: has("Thumb"), fingers: FINGERS.filter(has).length };
}

/** Whether a named expression exists AND moves something (a morph, a material or a texture bind). */
function wiredExpressions(document: Json, version: VrmVersion): Set<string> {
  const wired = new Set<string>();
  if (version === 1) {
    const expressions = document.extensions?.VRMC_vrm?.expressions ?? {};
    for (const group of [expressions.preset ?? {}, expressions.custom ?? {}]) {
      for (const [name, one] of Object.entries(group as Record<string, Json>)) {
        const binds = (one?.morphTargetBinds?.length ?? 0) + (one?.materialColorBinds?.length ?? 0) + (one?.textureTransformBinds?.length ?? 0);
        if (binds > 0) wired.add(name.toLowerCase());
      }
    }
  } else {
    for (const group of document.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? []) {
      const binds = (group?.binds?.length ?? 0) + (group?.materialValues?.length ?? 0);
      const name = String(group?.presetName && group.presetName !== "unknown" ? group.presetName : group?.name ?? "").toLowerCase();
      if (binds > 0 && name) wired.add(name);
    }
  }
  return wired;
}

export function bodyContract(bones: Set<string>, wired: Set<string>): BodyContract {
  const blink = wired.has("blink") || (wired.has("blink_l") && wired.has("blink_r")) || (wired.has("blinkleft") && wired.has("blinkright"));
  const mouth = wired.has("aa") || wired.has("a");
  const hands = { left: handReport(bones, "left"), right: handReport(bones, "right") };
  const unmet: string[] = [];
  if (!blink) unmet.push("No wired blink: add a \"blink\" expression that closes (or otherwise shows closing of) the eyes, so the room can make you blink.");
  if (!mouth) unmet.push("No wired mouth: add an \"aa\" expression (VRM 0: \"a\") that opens the mouth, so the room can move it while you speak.");
  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    if (!hand.thumb || hand.fingers < 1) unmet.push(`The ${side} hand needs a thumb and at least one finger mapped (has ${hand.thumb ? "a thumb" : "no thumb"} and ${hand.fingers} finger${hand.fingers === 1 ? "" : "s"}), so hand tracking can move them.`);
  }
  return { met: unmet.length === 0, blink, mouth, hands, unmet };
}

function triangleCount(document: Json): number {
  let triangles = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      const count = primitive.indices !== undefined
        ? document.accessors?.[primitive.indices]?.count
        : document.accessors?.[primitive.attributes?.POSITION]?.count;
      if (typeof count !== "number") continue;
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }
  return triangles;
}

export function checkAvatar(bytes: Uint8Array, limits: AvatarLimits = DEFAULT_LIMITS): AvatarCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: AvatarCheck["info"] = { bytes: bytes.byteLength, version: null, title: null, author: null, licence: null, bones: 0, triangles: 0, materials: 0, textures: 0 };
  let contract: BodyContract | null = null;
  const done = (): AvatarCheck => ({ ok: errors.length === 0, errors, warnings, info, contract });

  if (bytes.byteLength > limits.maxBytes) {
    errors.push(`The file is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(limits.maxBytes / 1048576).toFixed(0)} MB. A body is downloaded by everyone in the room, so keep it small: fewer triangles, 512 px textures.`);
  }
  const document = readJson(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), errors);
  if (!document) return done();

  const v1 = document.extensions?.VRMC_vrm, v0 = document.extensions?.VRM;
  const version: VrmVersion | null = v1 ? 1 : v0 ? 0 : null;
  if (version === null) {
    errors.push("No VRM metadata (extensions.VRMC_vrm or extensions.VRM): this is a plain GLB, and the room's loader rejects those. Export or package it as VRM; Mica's avatar workshop shows how.");
    info.materials = document.materials?.length ?? 0;
    info.triangles = triangleCount(document);
    return done();
  }
  info.version = version;

  // Anything fetched from elsewhere is refused; embedded data URIs are the only addresses a body may name.
  const external = [...(document.buffers ?? []), ...(document.images ?? [])]
    .map((one: Json) => one?.uri)
    .filter((uri: unknown): uri is string => typeof uri === "string" && !uri.startsWith("data:"));
  if (external.length > 0) errors.push(`The file refers to ${external.length} outside address(es) (for example ${JSON.stringify(external[0]).slice(0, 80)}). A body must be self-contained; embed everything in the .vrm.`);

  const present = new Set(boneNames(document, version));
  info.bones = present.size;
  contract = bodyContract(present, wiredExpressions(document, version));
  const missing = REQUIRED_BONES.filter((bone) => !present.has(bone));
  if (missing.length > 0) errors.push(`Missing humanoid bones the room drives: ${missing.join(", ")}.`);

  info.triangles = triangleCount(document);
  if (info.triangles > limits.maxTriangles) errors.push(`${info.triangles.toLocaleString("en")} triangles; the limit is ${limits.maxTriangles.toLocaleString("en")}.`);
  info.materials = document.materials?.length ?? 0;
  info.textures = document.textures?.length ?? 0;
  if (info.materials > 8) warnings.push(`${info.materials} materials: each is a separate draw; fewer than about 8 keeps a crowded room smooth.`);

  const meta = version === 1 ? v1.meta ?? {} : v0.meta ?? {};
  info.title = (version === 1 ? meta.name : meta.title) ?? null;
  info.author = (version === 1 ? (Array.isArray(meta.authors) ? meta.authors.join(", ") : null) : meta.author) ?? null;
  if (version === 1) {
    info.licence = meta.licenseUrl ?? null;
    if (meta.avatarPermission !== "everyone") errors.push(`Licence: avatarPermission is '${meta.avatarPermission ?? "missing"}'; a body others can see in the room must allow 'everyone'.`);
    if (!meta.authors?.length) warnings.push("No author is named in the VRM metadata.");
  } else {
    info.licence = meta.licenseName ?? null;
    if (String(meta.allowedUserName ?? "").toLowerCase() !== "everyone") errors.push(`Licence: allowedUserName is '${meta.allowedUserName ?? "missing"}'; a body others can see in the room must be 'Everyone'.`);
    if (!meta.author) warnings.push("No author is named in the VRM metadata.");
  }
  if (!info.title) warnings.push("The VRM has no title; the name you register it under will be used.");
  return done();
}
