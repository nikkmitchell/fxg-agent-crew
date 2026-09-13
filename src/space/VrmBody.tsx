import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { VRM, VRMUtils } from "@pixiv/three-vrm";
import { armSpecOf, headHeightOf, loadVrm, type ArmSpec } from "./vrm-model";
import { elbowFor } from "./two-bone-ik";
import { headOf } from "./Avatar3D";
import type { AvatarRecipe } from "../avatar";
import type { WirePerson } from "../../shared/space-wire";

/**
 * A person with a body.
 *
 * WHAT THIS GIVES UP, said plainly because the figure it replaces was built to
 * avoid exactly this. A headset measures a head and two hands. A body has a
 * spine, elbows, hips, knees and feet, and every one of them is an invention.
 * The old figure refused to draw them at all: head, shoulders, and hands only
 * where hands were reported.
 *
 * Nikk asked for a real avatar, so here is one — and the honesty is kept where
 * it can be rather than dropped:
 *
 *   MEASURED PARTS ARE SOLID. The head goes where the head is and turns the way
 *   it turns. A hand goes where the hand is, and the elbow is placed by
 *   `two-bone-ik` so the arm actually reaches it rather than approximating.
 *
 *   INFERRED PARTS FADE. Below the waist nothing is tracked, so the legs are
 *   drawn at reduced opacity, fading toward the floor. It is visible at a
 *   glance which half of a person is known and which half is drawn.
 *
 *   A HAND THAT IS NOT TRACKED HAS NO ARM. When a hand goes untracked the arm
 *   drops out of sight rather than resting somewhere plausible: "I cannot see
 *   that hand" and "that hand is by their side" are different facts and the old
 *   figure was careful about it.
 *
 *   KIND MOVES TO THE FLOOR. The silhouette used to carry human / agent /
 *   never-told. It cannot any more — everybody has the same body — so the ring
 *   in `Avatar3D` carries it alone. Nothing was dropped; it moved.
 */

/** Where the waist is on this model, as a fraction of its height. */
const WAIST = 0.52;

export function VrmBody({
  live,
  recipe,
  onFailed,
}: {
  live: () => WirePerson | null | undefined;
  recipe: AvatarRecipe;
  /** Told when the model cannot be had, so the plain figure is drawn instead. */
  onFailed: () => void;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const arms = useRef<ArmSpec>({ upper: 0.28, lower: 0.26 });
  /** The model's own head height, so it can be scaled to the person's. */
  const modelHead = useRef(1.34);
  const root = useRef<THREE.Group>(null);

  useEffect(() => {
    let dropped = false;
    void loadVrm()
      .then((loaded) => {
        if (dropped) {
          VRMUtils.deepDispose(loaded.scene);
          return;
        }
        // The model faces +z by default and this room's figures face -z.
        VRMUtils.rotateVRM0(loaded);
        arms.current = armSpecOf(loaded);
        modelHead.current = headHeightOf(loaded);
        tint(loaded, recipe);
        setVrm(loaded);
      })
      .catch(onFailed);
    return () => {
      dropped = true;
    };
  }, [onFailed, recipe]);

  // Freed on unmount: a body left behind when somebody leaves the room is
  // several megabytes of texture that nothing will ever draw again.
  useEffect(
    () => () => {
      if (vrm) VRMUtils.deepDispose(vrm.scene);
    },
    [vrm],
  );

  const scratch = useMemo(
    () => ({
      shoulder: new THREE.Vector3(),
      target: new THREE.Vector3(),
      elbow: new THREE.Vector3(),
      pole: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      euler: new THREE.Euler(0, 0, 0, "YXZ"),
    }),
    [],
  );

  useFrame((_, delta) => {
    const person = live();
    const node = root.current;
    if (!vrm || !person || !node) return;

    // FEET ON THE FLOOR, facing the way they are walking. The head is tracked
    // separately below; the body is placed, not measured, and this is the one
    // place that is true of the whole figure.
    node.position.set(person.at.x, 0, person.at.z);
    node.rotation.y = person.facing;

    /**
     * SCALED SO ITS HEAD IS WHERE THEIR HEAD IS.
     *
     * The model is a teenager and stands 1.34m; the room places an untracked
     * head at a standing adult's 1.62m, and a real headset reports whatever
     * height its wearer actually is. Left unscaled, every avatar's head sits a
     * foot below where the room says the head is — and in a headset your own
     * hands appear level with your chin, which is the kind of wrongness you
     * feel before you can name.
     *
     * Clamped, because a tracking glitch reporting a head at four metres must
     * not produce a four-metre person.
     */
    const wantedHead = headOf(person).y;
    const scale = Math.max(0.6, Math.min(1.6, wantedHead / modelHead.current));
    node.scale.setScalar(scale);

    const head = vrm.humanoid.getNormalizedBoneNode("head");
    if (head) {
      if (person.head) {
        // The measured head orientation, taken into the body's own frame so
        // that turning the body does not turn the head twice.
        scratch.quaternion.set(person.head.q.x, person.head.q.y, person.head.q.z, person.head.q.w);
        scratch.euler.set(0, -person.facing, 0);
        head.quaternion.setFromEuler(scratch.euler).multiply(scratch.quaternion);
      } else {
        head.quaternion.identity();
      }
    }

    // ARMS REACH THE HANDS, or disappear. See the note above: a hand that is
    // not tracked is not a hand resting by a side.
    for (const side of ["left", "right"] as const) {
      const pose = person.hands[side];
      const upper = vrm.humanoid.getNormalizedBoneNode(
        side === "left" ? "leftUpperArm" : "rightUpperArm",
      );
      const lower = vrm.humanoid.getNormalizedBoneNode(
        side === "left" ? "leftLowerArm" : "rightLowerArm",
      );
      if (!upper || !lower) continue;
      upper.visible = pose !== null;
      if (!pose) continue;

      upper.getWorldPosition(scratch.shoulder);
      scratch.target.set(pose.p.x, pose.p.y, pose.p.z);
      // Down and away from the body, which is where a human elbow goes.
      scratch.pole.set(side === "left" ? -1 : 1, -2, 0).normalize();

      // The bone lengths are the MODEL's, and the model has just been scaled,
      // so the reach must be scaled with it or the arms solve for a body that
      // is not the size being drawn.
      const elbow = elbowFor(
        scratch.shoulder,
        scratch.target,
        arms.current.upper * scale,
        arms.current.lower * scale,
        scratch.pole,
      );
      aimBoneAt(upper, scratch.elbow.set(elbow.x, elbow.y, elbow.z));
      aimBoneAt(lower, scratch.target);
    }

    // Spring bones and look-at. Cheap, and without it nothing on the model
    // settles: hair and clothing stay frozen mid-swing.
    vrm.update(delta);

  });

  if (!vrm) return null;
  return (
    <group ref={root}>
      <primitive object={vrm.scene} />
    </group>
  );
}

/**
 * Point a bone at a world position, keeping its length.
 *
 * Bones are rotations, not positions, so reaching a point means turning the
 * parent until the child lands on it. `lookAt` on the bone itself turns its
 * FORWARD axis, which for a VRM arm is not the direction the bone runs — hence
 * the correction through the parent's inverse.
 */
function aimBoneAt(bone: THREE.Object3D, target: THREE.Vector3): void {
  const parent = bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  bone.lookAt(target);
  bone.rotateX(Math.PI / 2);
}

/**
 * Whose body it is.
 *
 * Everybody wears the same model, so without this the room is a crowd of
 * identical strangers. The tint comes from `avatarRecipe` — the same FNV-1a
 * hash of the username that draws their mark on the People page — so a figure
 * across the room and a mark beside a comment are one identity.
 *
 * A TINT RATHER THAN A REPLACEMENT: the model's own shading is multiplied by
 * the colour rather than overwritten, so the face and features survive.
 */
function tint(vrm: VRM, recipe: AvatarRecipe): void {
  const colour = new THREE.Color(recipe.paper);
  vrm.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if ("color" in material && material.color instanceof THREE.Color) {
        material.color.lerp(colour, 0.45);
      }

      /**
       * WRITE DEPTH, or the panels paint over people.
       *
       * The live panels are DOM behind `<Html transform occlude="blending">`,
       * which renders an invisible depth-writing plane so that anything nearer
       * the camera covers the panel. A material that does not write depth is
       * invisible to that test — so the first version of this avatar was sliced
       * off at the panel's bottom edge: legs in front, everything above the
       * waist hidden behind a board four metres further away.
       *
       * VRM ships MToon materials, and MToon's transparent modes skip the depth
       * buffer. The body is opaque, so it should be in it.
       */
      material.depthWrite = true;
      /**
       * AND OPAQUE, which is the half that actually fixes it.
       *
       * `depthWrite` alone was not enough. Three draws opaque objects first and
       * transparent ones afterwards; drei's occluder is opaque, so a transparent
       * avatar is drawn AFTER the hole has already been punched in the canvas
       * and never gets the chance to fill it. The body is not see-through, so
       * it belongs in the opaque pass.
       *
       * `alphaTest` keeps the cut-out bits — hair edges, eyelashes — working
       * without transparency: a pixel is drawn or it is not, which is all a
       * cut-out ever needed.
       */
      if (material.transparent) {
        material.transparent = false;
        material.alphaTest = 0.5;
      }
    }
  });
}
