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
 * CC0, and the licence is asserted INSIDE the file by its author rather than
 * merely assumed by the gallery it came from. `public/avatars/alienteen.vrm`,
 * meta: licenseName CC0, allowedUserName Everyone, commercialUssageName Allow.
 */
const URL = `${base}/avatars/alienteen.vrm`;

export function loadVrm(): Promise<VRM> {
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

/** Arm segment lengths, measured off the model rather than guessed. */
export type ArmSpec = { upper: number; lower: number };

export function armSpecOf(vrm: VRM): ArmSpec {
  const bone = (name: Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0]) =>
    vrm.humanoid.getNormalizedBoneNode(name);
  const upperArm = bone("leftUpperArm");
  const lowerArm = bone("leftLowerArm");
  const hand = bone("leftHand");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  upperArm?.getWorldPosition(a);
  lowerArm?.getWorldPosition(b);
  hand?.getWorldPosition(c);
  const upper = a.distanceTo(b);
  const lower = b.distanceTo(c);
  // Fall back to adult-ish proportions if the model has no arms to measure —
  // better than zero-length bones, which put every hand at the shoulder.
  return { upper: upper > 0.01 ? upper : 0.28, lower: lower > 0.01 ? lower : 0.26 };
}
