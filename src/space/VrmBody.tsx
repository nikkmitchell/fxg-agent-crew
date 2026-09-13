import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { VRM, VRMUtils } from "@pixiv/three-vrm";
import { armSpecOf, faceFrontZOf, faceRoomYaw, headHeightOf, loadVrm, type ArmSpec } from "./vrm-model";
import { aimSegment } from "./aim-bone";
import { approachAngle, approachPoint, approachQuaternion } from "./easing";
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
 *   AN UNTRACKED ARM IS NOT MOVED AT ALL. The old wireframe figure drew no arm
 *   there, because "I cannot see that hand" and "that hand is by their side"
 *   are different facts. A full body cannot do that — it is a single skinned
 *   mesh and an arm cannot be taken out of it — so the arm simply stays where
 *   the model left it. See the note in the frame loop: for an agent, which
 *   never reports a hand, that means a T-pose, and animation is what fixes it.
 *
 *   KIND MOVES TO THE FLOOR. The silhouette used to carry human / agent /
 *   never-told. It cannot any more — everybody has the same body — so the ring
 *   in `Avatar3D` carries it alone. Nothing was dropped; it moved.
 */

/** Where the waist is on this model, as a fraction of its height. */
const WAIST = 0.52;

export function VrmBody({
  actorId,
  live,
  recipe,
  reducedMotion,
  onFailed,
}: {
  /** Whose body this is, which decides which model they wear. */
  actorId: string;
  live: () => WirePerson | null | undefined;
  recipe: AvatarRecipe;
  /**
   * When true nothing is eased — every pose snaps to the sample that arrived.
   * Somebody who asked for no animation gets the raw data, not a smoothed lie
   * about it.
   */
  reducedMotion: boolean;
  /** Told when the model cannot be had, so the plain figure is drawn instead. */
  onFailed: () => void;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const arms = useRef<ArmSpec | null>(null);
  /** The model's own head height, so it can be scaled to the person's. */
  const modelHead = useRef(1.34);
  const root = useRef<THREE.Group>(null);

  useEffect(() => {
    let dropped = false;
    void loadVrm(actorId)
      .then((loaded) => {
        if (dropped) {
          VRMUtils.deepDispose(loaded.scene);
          return;
        }
        // Turned to match the room's forward, which is -Z. See `faceRoomYaw`:
        // this used to call `VRMUtils.rotateVRM0`, which faces a model the
        // other way and put everybody's back to the room.
        loaded.scene.rotation.y = faceRoomYaw(faceFrontZOf(loaded));
        arms.current = armSpecOf(loaded);
        modelHead.current = headHeightOf(loaded);
        tint(loaded, recipe);
        setVrm(loaded);
      })
      .catch(onFailed);
    return () => {
      dropped = true;
    };
  }, [actorId, onFailed, recipe]);

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

  /**
   * WHERE THIS BODY IS NOW, as opposed to where the last snapshot said.
   *
   * Held here rather than read from the wire each frame, because the wire is a
   * few samples a second and a frame is ninety. Assigning straight from the
   * sample — which is what this did — is what made the avatars judder while the
   * old wireframe figures beside them glided: the figures had this and the
   * bodies did not.
   *
   * `settled` is false until the first sample, so somebody who joins does not
   * glide in from the origin.
   */
  const shown = useMemo(
    () => ({
      settled: false,
      at: new THREE.Vector3(),
      yaw: 0,
      head: new THREE.Quaternion(),
      hands: { left: new THREE.Vector3(), right: new THREE.Vector3() },
      handSeen: { left: false, right: false },
    }),
    [],
  );

  useFrame((_, delta) => {
    const person = live();
    const node = root.current;
    if (!vrm || !person || !node || !arms.current) return;

    // FEET ON THE FLOOR, facing the way they are walking. The head is tracked
    // separately below; the body is placed, not measured, and this is the one
    // place that is true of the whole figure.
    //
    // EASED TOWARD THE SAMPLE, never past it. See easing.ts: the body is always
    // catching up with what the room last said, and never predicting.
    const snap = reducedMotion || !shown.settled;
    approachPoint(shown.at, { x: person.at.x, y: 0, z: person.at.z }, 6, delta, snap);
    shown.yaw = approachAngle(shown.yaw, person.facing, 10, delta, snap);
    shown.settled = true;
    node.position.copy(shown.at);
    node.rotation.y = shown.yaw;

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
        // that turning the body does not turn the head twice. Against the
        // SHOWN yaw rather than the sampled one, or the head counter-rotates
        // against a body that has not finished turning yet — a small wrongness
        // that reads as the head twitching while the shoulders swing.
        scratch.quaternion.set(person.head.q.x, person.head.q.y, person.head.q.z, person.head.q.w);
        scratch.euler.set(0, -shown.yaw, 0);
        scratch.quaternion.premultiply(head.quaternion.setFromEuler(scratch.euler));
      } else {
        scratch.quaternion.identity();
      }
      approachQuaternion(shown.head, scratch.quaternion, 14, delta, snap);
      head.quaternion.copy(shown.head);
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

      if (!pose) {
        /**
         * NOTHING IS DONE TO AN ARM NOBODY IS MOVING — it stays in the model's
         * rest pose, which is straight out to the side.
         *
         * This line used to read `upper.visible = pose !== null`, on the
         * principle that "I cannot see that hand" and "that hand is by their
         * side" are different facts. The principle is right and the code never
         * carried it out: a VRM body is ONE skinned mesh, and a bone is not
         * drawn — it only supplies a matrix to the vertices — so hiding a bone
         * node changes nothing at all on screen. It was removed rather than
         * left in, because a line that looks like it enforces a rule and does
         * not is worse than no line.
         *
         * SO THE ROOM IS CURRENTLY HONEST BY ACCIDENT AND UGLY ON PURPOSE:
         * every agent stands in a T-pose, because an agent has no controllers
         * and never reports a hand. Nikk: "agents dont have controllers or
         * things to control the body position... for agents lets install
         * something like this for them to auto animate their avatars." That is
         * the real answer and it is being built; until it lands, an arm that
         * never moves is at least not pretending to be tracked.
         */
        continue;
      }

      // EASED TO THE HAND, like everything else. A hand is the fastest-moving
      // thing a headset reports and the most obviously choppy when it is not
      // smoothed; it also gets the highest speed, because a hand really can
      // cross a metre in a moment and dragging behind reads as lag.
      const seen = shown.handSeen[side];
      approachPoint(shown.hands[side], pose.p, 4, delta, snap || !seen);
      shown.handSeen[side] = true;

      const arm = arms.current[side];
      upper.getWorldPosition(scratch.shoulder);
      scratch.target.copy(shown.hands[side]);
      // Down and away from the body, which is where a human elbow goes.
      scratch.pole.set(side === "left" ? -1 : 1, -2, 0).normalize();

      // The bone lengths are the MODEL's, and the model has just been scaled,
      // so the reach must be scaled with it or the arms solve for a body that
      // is not the size being drawn.
      const elbow = elbowFor(
        scratch.shoulder,
        scratch.target,
        arm.upper * scale,
        arm.lower * scale,
        scratch.pole,
      );
      // Each segment is turned from the direction it RESTS in, measured off
      // this model, to the direction it needs to point. See aim-bone.ts for
      // what the previous version assumed and why it could not be right.
      aimSegment(upper, arm.upperRest, scratch.elbow.set(elbow.x, elbow.y, elbow.z));
      aimSegment(lower, arm.lowerRest, scratch.target);
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
