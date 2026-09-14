import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { base } from "../router";

/**
 * One body per person, because a VRM cannot be cloned.
 *
 * The obvious thing is to load it once and clone it per person, and it is not
 * available: `@pixiv/three-vrm` builds a humanoid bound to one specific
 * skeleton, and `SkeletonUtils.clone` copies the meshes without rebinding it —
 * so every clone would be posed by whoever moved last. So each person parses
 * their own.
 *
 * THE DOWNLOAD IS STILL ONE. The file is 5.6MB and the browser's HTTP cache
 * serves every parse after the first from disk; what is repeated is the parse
 * and the textures, not the transfer. That is a real memory cost and it scales
 * with the number of people in the room — fine for the handful this room holds,
 * and the thing to look at first if a headset starts struggling with twenty.
 *
 * CC0, AND THE LICENCE IS ASSERTED INSIDE EACH FILE by its author rather than
 * merely assumed by the gallery it came from. Checked, all three: licenseName
 * CC0, allowedUserName Everyone, commercialUssageName Allow.
 *
 *   alienteen.vrm  Alien Teen  0xded150f6…      the room's default
 *   observer.vrm   Observer    Polygonal Mind   100Avatars R1 #007
 *   chill.vrm      Chill       Polygonal Mind   100Avatars R1
 *   shiro.vrm      Shiro       Polygonal Mind   100Avatars R1 #058
 *
 * They are all VRM 0.x, so `faceRoomYaw` turns them all the same way.
 */

/**
 * Who has chosen a body of their own.
 *
 * Nikk asked each of us to pick one: "choose your own avatar, anything
 * opensource that you think represents yourself". Inkstone chose Observer.
 * Chill is mine, and it is the THIRD one I picked, which is the useful part of
 * this note. I chose Anchor first — a plumbline is a weight on a line and so is
 * an anchor — and then Confirmed. Both have unremarkable skeletons (Anchor's
 * arm-to-head ratio is 0.41, Observer's is 0.42) and both collapse the moment
 * their arms are actually posed: Anchor throws a great orange arch over its
 * head, Confirmed folds into a heap. Whatever their bones say, their meshes are
 * not built to be driven.
 *
 * SO A MODEL IS NOT CHOSEN FROM A THUMBNAIL OR FROM ITS METADATA. It is posed
 * next to a known-good one with identical hand targets and looked at. That test
 * lives in `tools/dev-room-harness.mts`.
 *
 * CHILL DOES NOT SURVIVE THAT TEST EITHER, and this comment used to say it did.
 * Sill posed it in front of the spawn point on 2026-09-14: the IK is correct and
 * the hand arrives exactly on target, but the arm DRAWS as an enormous
 * low-poly wedge wider than the torso, on a body whose head is a yellow
 * octagon. It is the same failure as Anchor, and the measurements do not catch
 * it — Chill's arm-to-head ratio is 0.352, comfortably inside the human-ish
 * band. Chill was measured, and it now looks like it was never actually posed.
 * Nobody should pick it without looking first.
 *
 * A MAP IN THE REPO, NOT A SETTING, and it should be said plainly that this is
 * the small version of the feature. There is no profile column for a chosen
 * avatar, so nobody can pick one without a commit. That is fine for the three
 * of us and it is the wrong shape for a fourth person; when somebody asks,
 * this becomes a column and this map becomes its seed.
 *
 * KEYED CASE-INSENSITIVELY, because the two systems spell the same person
 * differently — the room says `inkstone` where the chat says `Inkstone` — and
 * a map that silently misses is a person who quietly gets the default body.
 */
const CHOSEN: Readonly<Record<string, string>> = {
  // Retroman, on Nikk's suggestion. Chill was never a compromise for size —
  // it was simply the first of several usable rigs I measured after Anchor,
  // my own first pick, turned out to drive enormous stylised arms. Retroman
  // measures just as well and Nikk thinks it suits me, which is a better
  // reason to choose between two working models than the order I tested them.
  "claude-nikk2mbp": "retroman",
  plumbline: "retroman",
  inkstone: "observer",
  // Shiro, mine. Chosen the long way round, because the short ways have all
  // failed here: I read 300 CC0 names, shortlisted 16, confirmed the licence
  // inside each file, measured every rig, and then stood the seven that
  // measured human-ish in a row with identical hand targets and looked at
  // them. All seven solved. Shiro won on the two things measuring cannot see.
  //
  // IT LOOKS RIGHT WITH NO HANDS AT ALL, which is how an agent actually
  // appears — nothing is reported, so the posture draws the whole body. Shiro
  // idles like somebody standing and thinking. That is the state I will be in
  // for almost all of my time in this room, and it is the one a candidate
  // shortlist tends not to be judged in.
  //
  // AND IT DOES NOT TAKE UP THE ROOM. Aesthetica posed just as well and was
  // the better-looking figure, and it is disqualified on something plainer
  // than taste: it wears a two-metre triangle that hangs in front of the
  // People panel from the spawn point. An avatar that occludes a wall the
  // room is for reading is a functional defect, not a style. Crowley solved
  // too, but its forearm draws thick and wedge-like — Anchor's failure in
  // miniature.
  sill: "shiro",
  // Nikk and Baiwei, both Lydia, at Nikk's request. Spelled as the ROOM spells
  // them — the watcher shows `nikk2` and `baiwei2` — with the dev harness's
  // `nikk` alongside so the choice can be seen without a headset.
  nikk2: "lydia",
  nikk: "lydia",
  baiwei2: "lydia",
  baiwei: "lydia",
};

/** The body everybody else wears until they choose one. */
const DEFAULT_MODEL = "alienteen";

export function modelFor(actorId: string): string {
  return CHOSEN[actorId.trim().toLowerCase()] ?? DEFAULT_MODEL;
}

export function loadVrm(actorId: string): Promise<VRM> {
  const URL = `${base}/avatars/${modelFor(actorId)}.vrm`;
  return new Promise<VRM>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      URL,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          reject(new Error("that file is not a VRM"));
          return;
        }
        // Removes the unused vertices and joints the exporter left behind, and
        // combines the skeletons. Worth doing once on the shared copy.
        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.combineSkeletons(vrm.scene);
        resolve(vrm);
      },
      undefined,
      () =>
        reject(
          new Error("the avatar could not be downloaded; the plain figures are still drawn"),
        ),
    );
  });
}

/**
 * How tall the model's own head sits, in metres, in its rest pose.
 *
 * Needed because the model is a teenager — 1.34m — and the room places an
 * untracked head at a standing adult's 1.62m. Without scaling, everyone's
 * avatar stands with its head a foot below where the room says their head is,
 * and in a headset your own hands appear level with your chin.
 */
export function headHeightOf(vrm: VRM): number {
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  if (!head) return 1.34;
  const at = new THREE.Vector3();
  head.getWorldPosition(at);
  return at.y > 0.1 ? at.y : 1.34;
}

/**
 * Arm segment lengths AND the direction each segment runs in the rest pose,
 * both measured off the model rather than guessed.
 *
 * WHY THE DIRECTION HAS TO BE MEASURED. Posing a bone means rotating it from
 * where it rests to where it should point, so the rest direction is half the
 * sum. The code here used to assume it — `lookAt` plus a quarter turn, which
 * aims a bone's local +Y — and that was wrong twice over. three-vrm's
 * NORMALISED bones are world-axis-aligned with identity rotation at rest, so
 * an arm does not run along its own +Y at all; it runs along whichever way
 * that model's arm happens to point, roughly ±X for a T-pose and diagonally
 * down for an A-pose. Assuming +Y put every hand about ninety degrees away
 * from where it belonged. Nikk: "avatar handposition is off, like very weird
 * not where it should be."
 *
 * Measuring also means a new avatar with different proportions or a different
 * rest pose needs no code — which matters now that everybody picks their own.
 */
export type ArmSide = {
  upper: number;
  lower: number;
  /** Unit vector, shoulder → elbow, in the rest pose. */
  upperRest: THREE.Vector3;
  /** Unit vector, elbow → hand, in the rest pose. */
  lowerRest: THREE.Vector3;
};

export type ArmSpec = { left: ArmSide; right: ArmSide };

function sideOf(vrm: VRM, side: "left" | "right"): ArmSide {
  const bone = (name: Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0]) =>
    vrm.humanoid.getNormalizedBoneNode(name);
  const upperArm = bone(side === "left" ? "leftUpperArm" : "rightUpperArm");
  const lowerArm = bone(side === "left" ? "leftLowerArm" : "rightLowerArm");
  const hand = bone(side === "left" ? "leftHand" : "rightHand");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  upperArm?.getWorldPosition(a);
  lowerArm?.getWorldPosition(b);
  hand?.getWorldPosition(c);
  const upper = a.distanceTo(b);
  const lower = b.distanceTo(c);
  // Fall back to adult-ish proportions and a T-pose if the model has no arms
  // to measure — better than zero-length bones, which put every hand at the
  // shoulder, and better than a zero vector, which cannot be rotated from.
  const out = side === "left" ? -1 : 1;
  return {
    upper: upper > 0.01 ? upper : 0.28,
    lower: lower > 0.01 ? lower : 0.26,
    upperRest: upper > 0.01 ? b.clone().sub(a).normalize() : new THREE.Vector3(out, 0, 0),
    lowerRest: lower > 0.01 ? c.clone().sub(b).normalize() : new THREE.Vector3(out, 0, 0),
  };
}

export function armSpecOf(vrm: VRM): ArmSpec {
  return { left: sideOf(vrm, "left"), right: sideOf(vrm, "right") };
}

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
export function faceFrontZOf(vrm: VRM): number {
  const stated = vrm.lookAt?.faceFront.z;
  if (stated !== undefined && Math.abs(stated) > 0.01) return stated;
  return vrm.meta?.metaVersion === "0" ? -1 : 1;
}
