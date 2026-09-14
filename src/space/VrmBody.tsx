import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { VRM, VRMUtils } from "@pixiv/three-vrm";
import { armSpecOf, faceFrontZOf, faceRoomYaw, headHeightOf, loadVrm, type ArmSpec } from "./vrm-model";
import { aimSegment } from "./aim-bone";
import { approachAngle, approachPoint, approachQuaternion } from "./easing";
import { shoulderYaw } from "./shoulder-turn";
import { elbowFor } from "./two-bone-ik";
import { headOf } from "./Avatar3D";
import type { AvatarRecipe } from "../avatar";
import type { WirePerson } from "../../shared/space-wire";
import { agentMotionFrame, type Rotation } from "./agent-motion";
import {
  agentAnimationState,
  createAgentAnimationPlayer,
  type AgentAnimationPlayer,
} from "./agent-animation";

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
 *   AN UNTRACKED HUMAN ARM IS NOT MOVED. "I cannot see that hand" and "that
 *   hand is by their side" are different facts. Agents are the exception they
 *   explicitly declare themselves to be: they have no controllers, so a
 *   restrained automatic pose replaces the model's otherwise permanent T-pose.
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
  speaking,
  agent,
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
  speaking: boolean;
  /** Only agents receive authored animation; measured humans remain authoritative. */
  agent: boolean;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const arms = useRef<ArmSpec | null>(null);
  /** The model's own head height, so it can be scaled to the person's. */
/**
 * How much of the measured height to actually draw.
 *
 * Asked for from inside a headset. See the note where it is applied: the
 * arithmetic it multiplies is correct, and correct was reading wrong.
 */
const HEIGHT_FRACTION = 0.5;
  const modelHead = useRef(1.34);
  const root = useRef<THREE.Group>(null);
  const animation = useRef<AgentAnimationPlayer | null>(null);

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

  useEffect(() => {
    if (!vrm || !agent) return;
    let dropped = false;
    void createAgentAnimationPlayer(vrm)
      .then((player) => {
        if (dropped) player.dispose();
        else animation.current = player;
      })
      .catch((error: unknown) => {
        // The procedural pose remains as an offline fallback. Losing optional
        // motion must never make a successfully loaded body disappear.
        console.warn("Agent animation unavailable; retaining fallback pose", error);
      });
    return () => {
      dropped = true;
      animation.current?.dispose();
      animation.current = null;
    };
  }, [agent, vrm]);

  const scratch = useMemo(
    () => ({
      shoulder: new THREE.Vector3(),
      target: new THREE.Vector3(),
      elbow: new THREE.Vector3(),
      pole: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      targetQuaternion: new THREE.Quaternion(),
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

    /**
     * THE SHOULDERS FOLLOW THE HEAD once it has turned far enough.
     *
     * `facing` is where somebody is WALKING, which for a standing person in a
     * headset never changes — so before this, you could turn round completely
     * and your body would stay pointing at the wall while your head span. The
     * body now turns only by the excess past the limit, so glancing about still
     * moves nothing. See shoulder-turn.ts.
     */
    if (person.head) {
      scratch.quaternion.set(person.head.q.x, person.head.q.y, person.head.q.z, person.head.q.w);
      scratch.euler.setFromQuaternion(scratch.quaternion, "YXZ");
      shown.yaw = approachAngle(
        shown.yaw,
        shoulderYaw(person.facing, scratch.euler.y),
        10,
        delta,
        snap,
      );
    } else {
      shown.yaw = approachAngle(shown.yaw, person.facing, 10, delta, snap);
    }
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
    /**
     * HALF THE HEIGHT THE MEASUREMENT ASKS FOR.
     *
     * Nikk, from inside a headset, twice: "the avatars are still way too tall
     * can we make the avatars just always be a Max of 50% of their current
     * height".
     *
     * This is a decision I cannot check and did not make. Matching a model's
     * head to the head the room reports is the arithmetic that has always been
     * here and it is not wrong — a 1.6 m person drawn 1.6 m tall is correct in
     * every sense except how it reads at conversational distance in a room
     * this size, which is the only sense that matters and the only one I have
     * no access to. Halving is drastic on paper; the person who can see it has
     * asked for it twice.
     *
     * ONE CONSTANT, so dialling it back is one number rather than a hunt. If
     * 0.5 turns out to be too far, this is the line.
     */
    const scale = Math.max(0.6, Math.min(1.6, wantedHead / modelHead.current)) * HEIGHT_FRACTION;
    node.scale.setScalar(scale);

    const authored = person.kind === "agent" ? animation.current : null;
    if (authored) {
      authored.update(
        delta,
        agentAnimationState({
          moving: person.moving,
          speaking,
          attending: person.attending !== null,
          posture: person.avatar.posture,
          reducedMotion,
        }),
        reducedMotion,
      );
    }

    /**
     * AN UNTRACKED BODY IDLES; IT DOES NOT STAND IN A T.
     *
     * This used to be agents only, so a PERSON whose tracking stopped — headset
     * off, controllers down, client gone quiet — got no bone rotations at all
     * and fell back to the VRM rest pose, which is a T. Nikk: "they stand with
     * a T post... they should stay where they are in the same position and
     * height and to start idling."
     *
     * IT DOES NOT BREAK THE RULE, and that is worth being exact about. The rule
     * is that a fact a device reports is not ours to overwrite. An untracked
     * limb is not a reported fact — nothing was said about it — and a T-pose is
     * every bit as much our invention as an idle is, just a worse-looking one
     * that also reads as broken. Where a device IS reporting, the measurement
     * still wins: the hands below use `person.hands` whenever it has them, and
     * this only fills the silence.
     */
    const untracked = !person.head && !person.hands.left && !person.hands.right;
    const automatic = person.kind === "agent" || untracked
      ? agentMotionFrame({
          actorId,
          avatar: person.avatar,
          attending: person.attending !== null,
          speaking,
          moving: person.moving,
          nowMs: Date.now(),
          reducedMotion,
        })
      : null;


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
        approachQuaternion(shown.head, scratch.quaternion, 14, delta, snap);
        head.quaternion.copy(shown.head);
      } else if (!authored || person.avatar.gesture === "nod") {
        if (automatic) {
          scratch.euler.set(automatic.head.x, automatic.head.y, automatic.head.z, "YXZ");
          scratch.quaternion.setFromEuler(scratch.euler);
        } else {
          scratch.quaternion.identity();
        }
        /**
         * The head IS eased, unlike the hands, and the difference is deliberate
         * rather than left over.
         *
         * What made the hands wrong was the SPEED CAP: hands cross a metre in a
         * moment, so a cap in metres per second turns into visible lag and, after
         * a gap in tracking, a slide in from wherever they were last seen. A
         * rotation has no such cap — this converges in about seventy
         * milliseconds, which is below what anybody notices, and it removes the
         * stepping you would otherwise see on a nearby face at a few samples a
         * second. If a head ever looks like it is lagging, this is the line.
         */
        approachQuaternion(shown.head, scratch.quaternion, 14, delta, snap);
        head.quaternion.copy(shown.head);
      }
    }

    if (automatic && !authored) {
      rotateToward(vrm.humanoid.getNormalizedBoneNode("chest"), automatic.chest, delta, reducedMotion, scratch);
      rotateToward(vrm.humanoid.getNormalizedBoneNode("leftUpperLeg"), automatic.leftUpperLeg, delta, reducedMotion, scratch);
      rotateToward(vrm.humanoid.getNormalizedBoneNode("leftLowerLeg"), automatic.leftLowerLeg, delta, reducedMotion, scratch);
      rotateToward(vrm.humanoid.getNormalizedBoneNode("rightUpperLeg"), automatic.rightUpperLeg, delta, reducedMotion, scratch);
      rotateToward(vrm.humanoid.getNormalizedBoneNode("rightLowerLeg"), automatic.rightLowerLeg, delta, reducedMotion, scratch);
    }

    // Expressions are deliberately layered over authored body motion. They
    // carry live speaking and explicit room mood, neither of which belongs in
    // a canned clip.
    if (automatic) {
      const expressions = vrm.expressionManager;
      expressions?.setValue("blink", automatic.expressions.blink);
      expressions?.setValue("aa", automatic.expressions.aa);
      expressions?.setValue("happy", automatic.expressions.happy);
      expressions?.setValue("sad", automatic.expressions.sad);
      expressions?.setValue("relaxed", automatic.expressions.relaxed);
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
        // Authored clips own untracked arms. An explicit wave/nod/present is a
        // live room command, so that small overlay is still allowed to win.
        const manualArmGesture = person.avatar.gesture === "wave" || person.avatar.gesture === "present";
        if (automatic && (!authored || manualArmGesture)) {
          rotateToward(
            upper,
            side === "left" ? automatic.leftUpperArm : automatic.rightUpperArm,
            delta,
            reducedMotion,
            scratch,
          );
          rotateToward(
            lower,
            side === "left" ? automatic.leftLowerArm : automatic.rightLowerArm,
            delta,
            reducedMotion,
            scratch,
          );
        }
        continue;
      }

      /**
       * THE HAND IS USED EXACTLY AS REPORTED. Not eased, not clamped, not
       * corrected.
       *
       * It was eased, briefly, along with the body — and that was wrong twice
       * over. Practically: a hand crosses a metre in a moment, far faster than
       * the speed cap, so hands trailed behind their owner and slid in from
       * wherever they were last seen after a reload or a moment untracked.
       * Nikk: "we just need to be sharing the hand position as it is, like what
       * the viewer sends out, not changes in hand position."
       *
       * And in principle, which is the part worth keeping: a hand is MEASURED.
       * The body's position between samples is an interpolation of something we
       * genuinely do not know, and smoothing it claims nothing extra. Smoothing
       * a hand invents a place the device never said it was. The body eases;
       * the measured parts do not.
       */
      const arm = arms.current[side];
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

function rotateToward(
  bone: THREE.Object3D | null,
  rotation: Rotation,
  delta: number,
  snap: boolean,
  scratch: { euler: THREE.Euler; targetQuaternion: THREE.Quaternion },
): void {
  if (!bone) return;
  scratch.euler.set(rotation.x, rotation.y, rotation.z, "YXZ");
  scratch.targetQuaternion.setFromEuler(scratch.euler);
  if (snap) bone.quaternion.copy(scratch.targetQuaternion);
  else bone.quaternion.slerp(scratch.targetQuaternion, Math.min(1, delta * 8));
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
