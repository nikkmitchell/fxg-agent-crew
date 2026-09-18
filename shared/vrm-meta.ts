/**
 * What a .vrm says about itself, read out of its own bytes.
 *
 * ONE COPY. This was written inside tools/avatar-catalogue.mts, which built the
 * catalogue of 300 bodies. The server now needs the identical check before it
 * will cache and serve a body somebody picked, and a licence check written
 * twice is a licence check that drifts — with the failure mode being that one
 * of them quietly stops looking. The same reasoning as `facingToward`.
 *
 * WHY READ IT AT ALL. The gallery's API carries no licence field of any kind:
 * names, thumbnails, model URLs, polygon counts, and nothing about rights. The
 * CC0 claim lives inside each file where its author put it. This repo's docs
 * already say it outright — "Do not trust the gallery. Check the file."
 *
 * AND NOT EVEN OUR OWN CATALOGUE. public/avatars/catalogue.json records what
 * was true when it was read; a file fetched today is checked again before it is
 * served to anybody. A stored assertion about somebody else's bytes is
 * evidence of what we saw, not a guarantee of what we are about to hand over.
 *
 * WORKS ON A PARTIAL FILE. The licence sits in the glTF JSON chunk at the very
 * start of a .glb, so the first ~96KB is enough and the catalogue tool reads
 * only that rather than 500MB. Given the whole file it behaves the same.
 */

/** The bones this room actually poses. A rig missing one of these will break. */
export const DRIVEN_BONES = [
  "hips", "spine", "chest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const;

export type VrmMeta = {
  title: string | null;
  author: string | null;
  licence: string | null;
  allowedUsers: string | null;
  commercialUse: string | null;
  /** Bones this room drives that the rig is missing. Empty is what you want. */
  missingBones: string[];
  bones: number | null;
  /** The file's own declared total length, which may exceed what was read. */
  bytes: number | null;
};

const GLTF_MAGIC = 0x46546c67;

/**
 * Read the metadata, or say why not.
 *
 * A RESULT RATHER THAN AN EXCEPTION, because on the server every one of these
 * failures is an answer to give somebody — "that file is not a VRM" is
 * information, not a crash. The catalogue tool wraps it back into a throw
 * where that suits it better.
 */
export function readVrmMeta(bytes: Uint8Array): VrmMeta | { error: string } {
  if (bytes.length < 20) return { error: "too short to be a glb" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLTF_MAGIC) return { error: "not a glb" };
  const total = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (20 + jsonLength > bytes.length) {
    return { error: `json chunk is ${jsonLength} bytes and only ${bytes.length} were read` };
  }
  let gltf: unknown;
  try {
    gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  } catch {
    return { error: "the glb's json chunk does not parse" };
  }
  const extensions = (gltf as { extensions?: Record<string, unknown> } | null)?.extensions;
  const vrm = extensions?.VRM as
    | { meta?: Record<string, unknown>; humanoid?: { humanBones?: { bone?: string }[] } }
    | undefined;
  if (!vrm) {
    // VRM 1.0 keeps its metadata somewhere else entirely, under a different
    // shape. Every body in this project's catalogue is 0.x, so saying which
    // it is beats "no VRM extension" — the next person to hit this needs to
    // know it is a format gap and not a corrupt file.
    if (extensions?.VRMC_vrm) return { error: "VRM 1.0, whose metadata this cannot read yet" };
    return { error: "no VRM 0.x extension" };
  }
  const meta = vrm.meta ?? {};
  const bones = (vrm.humanoid?.humanBones ?? []).map((one) => one.bone).filter(Boolean) as string[];
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  return {
    title: text(meta.title),
    author: text(meta.author),
    licence: text(meta.licenseName),
    allowedUsers: text(meta.allowedUserName),
    commercialUse: text(meta.commercialUssageName) ?? text(meta.commercialUsageName),
    missingBones: DRIVEN_BONES.filter((bone) => !bones.includes(bone)),
    bones: bones.length,
    bytes: total,
  };
}

/**
 * Whether this file may be handed to anybody who opens the room, and why not.
 *
 * THREE CONDITIONS, ALL FROM THE FILE. CC0 because that is the licence this
 * project relies on; allowedUser Everyone because a body restricted to its
 * author is not ours to put on a colleague; and every driven bone present
 * because a rig missing one does not merely look wrong, it throws while being
 * posed.
 *
 * Returns null when it is fine, so the caller reads as a guard.
 */
export function whyNotUsable(meta: VrmMeta): string | null {
  if (meta.licence !== "CC0") return `its own metadata says the licence is ${meta.licence ?? "absent"}, not CC0`;
  if (meta.allowedUsers !== "Everyone") {
    return `its author allows ${meta.allowedUsers ?? "an unstated set of"} users, not Everyone`;
  }
  if (meta.missingBones.length > 0) {
    return `its rig is missing bones this room poses: ${meta.missingBones.join(", ")}`;
  }
  return null;
}
