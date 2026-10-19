/**
 * Which way a VRM body faces, for the room and for the space kit alike.
 *
 * Kept apart from vrm-model.ts, which imports the site's router, so the kit
 * (src/kit, built on its own) can use the same answer instead of a copy. It had
 * one, and the copy missed the room's later fix for VRM 1 arms (Mica, 6861).
 */
import type { VRM } from "@pixiv/three-vrm";

/**
 * Which way to turn the model so it faces the way the room faces.
 *
 * THIS ROOM'S FORWARD IS -Z. Every other piece of placement agrees on it:
 * `RoomControls` puts the panel ahead of you at `(-sin yaw, -cos yaw)`, so a
 * person at facing 0 is looking down -Z.
 *
 * A VRM DOES NOT HAVE ONE ANSWER. The two spec versions disagree, and
 * `@pixiv/three-vrm` records which by setting `lookAt.faceFront`: a 0.x model
 * is imported facing -Z, a 1.0 model facing +Z. So the correction is not a
 * constant — it depends on the file.
 *
 * WHY NOT `VRMUtils.rotateVRM0`, WHICH IS WHAT THIS USED TO CALL. That helper
 * normalises a 0.x model to the 1.0 convention by adding half a turn, which is
 * the right thing to do if your world's forward is +Z. Ours is -Z, so it took
 * the one model that already agreed with us and turned its back to the room —
 * Nikk, from inside a headset: "the new avatars are facing backwards". It also
 * mirrored the arms, because the shoulders swap sides with the body, so a
 * tracked left hand was being reached for from the right shoulder.
 */
export function faceRoomYaw(faceFrontZ: number): number {
  return faceFrontZ > 0 ? Math.PI : 0;
}

/**
 * What that model says its own front is, on the -1/+1 axis `faceRoomYaw` wants.
 *
 * `lookAt` is optional in the format, so its absence is not an error — fall
 * back to the version, which is what three-vrm itself keys the answer off.
 */
export function faceFrontZOf(vrm: Pick<VRM, "lookAt" | "meta">): number {
  const stated = vrm.lookAt?.faceFront.z;
  if (stated !== undefined && Math.abs(stated) > 0.01) return stated;
  return vrm.meta?.metaVersion === "0" ? -1 : 1;
}

/**
 * Must a pose about the bones' X and Z axes be mirrored on this body? The
 * procedural poses were tuned on VRM 0 bodies, and three-vrm imports a VRM 1
 * body half a turn round from a VRM 0 one, so the same pose comes out mirrored
 * on it: arms that should hang at the sides rise instead (Mica, 6861).
 */
export function posesMirrored(vrm: Pick<VRM, "lookAt" | "meta">): boolean {
  return faceFrontZOf(vrm) > 0;
}
