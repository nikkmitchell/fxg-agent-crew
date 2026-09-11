import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { avatarRecipe } from "../avatar";
import { makeLabelTexture } from "./label-texture";
import { bodySpec, ringIsBroken } from "./avatar-shape";
import type { Pose, WirePerson } from "../../shared/space-wire";

/**
 * A person, in three dimensions: head, shoulders, and hands when there are any.
 *
 * NOTHING BETWEEN THEM, and that is the honest shape rather than a stylistic
 * one. A headset reports three things — where the head is and two hands, when
 * they are tracked. It reports nothing about elbows, hips or knees. Drawing a
 * full body means inventing a pose for every joint nobody measured, and the
 * invention is most visible exactly when it matters: an arm bending the wrong
 * way as somebody reaches for a card.
 *
 * So: a head where the head is, a torso hanging below it, and hands only where
 * hands were actually reported. Somebody at a desk with a mouse has no hands in
 * this room and is drawn without them.
 *
 * Built from the SAME `avatarRecipe` as the tile on the People page, so the
 * figure across the room and the mark beside a comment are recognisably one
 * identity.
 *
 * WHAT THE FIGURE IS ALLOWED TO SAY, unchanged: shape carries kind — round for
 * a human, square-shouldered for an agent, and neither for an actor whose kind
 * we were never told, who also gets a broken ring on the floor. Colour and
 * motif carry nothing.
 */

export type Avatar3DProps = {
  actorId: string;
  kind: "human" | "agent" | null;
  /** True while a live socket is attached. Agents placed by activity have none. */
  connected: boolean;
  /**
   * The latest of everything that moves, read EVERY FRAME rather than passed as
   * props.
   *
   * Heads and hands change continuously; routing them through React would
   * re-render this tree ten times a second per person to move three objects.
   * Positions already worked this way and now everything does, in one place.
   *
   * All coordinates are ROOM-ABSOLUTE. The figure places itself; there is no
   * enclosing group to add an offset, which is the kind of double-translation
   * that shows up as avatars standing twice as far out as they should.
   */
  live: () => WirePerson | undefined;
  /** Snap instead of easing, for someone who asked for reduced motion. */
  reducedMotion: boolean;
  /**
   * The last thing this person said aloud, or null.
   *
   * Shown as TEXT above them whether or not anything was spoken. That is not
   * decoration: synthesis can fail, be muted, or not exist in the browser at
   * all, and a reply that was only ever audio is a reply that is simply lost.
   */
  saying: string | null;
};

/** The name, cached per actor. */
function useNameTexture(actorId: string): THREE.CanvasTexture | null {
  return useMemo(() => makeLabelTexture(actorId), [actorId]);
}

const HEAD_RADIUS = 0.16;
/** Head to ribs. Everything below that is not measured and is not drawn. */
const TORSO_HEIGHT = 0.42;
/** Where an untracked head sits above the floor. A standing adult's eyeline. */
export const EYE_HEIGHT = 1.62;
const LABEL_REFERENCE_METRES = 4;

/**
 * Keep text the same apparent size however close you are standing.
 *
 * A sprite obeys perspective like everything else, so walking up to somebody
 * put their name across the entire screen. Clamped at both ends: never bigger
 * than it would be at two metres, never smaller than at ten.
 */
function useConstantApparentSize(base: [number, number]) {
  const ref = useRef<THREE.Sprite>(null);
  useFrame(({ camera }) => {
    const sprite = ref.current;
    if (!sprite) return;
    const distance = camera.position.distanceTo(sprite.getWorldPosition(new THREE.Vector3()));
    const factor = Math.min(10, Math.max(2, distance)) / LABEL_REFERENCE_METRES;
    sprite.scale.set(base[0] * factor, base[1] * factor, 1);
  });
  return ref;
}

/**
 * One hand. Always mounted, made visible only when a hand is actually reported.
 *
 * Mounting and unmounting on every tracking dropout would thrash React; a
 * `visible` flag is one boolean per frame and says the same thing.
 */
const Hand = ({ colour, boxy, groupRef }: {
  colour: string;
  boxy: boolean;
  groupRef: React.RefObject<THREE.Group | null>;
}) => {
  return (
    <group ref={groupRef} visible={false}>
      <mesh>
        {boxy ? <boxGeometry args={[0.09, 0.05, 0.14]} /> : <sphereGeometry args={[0.055, 14, 10]} />}
        <meshStandardMaterial color={colour} roughness={0.6} />
      </mesh>
      {/* A short stub along -Z, the direction a controller or a palm points.
          Without it a hand is a blob with no facing, and which way somebody is
          pointing is most of what a hand is for. */}
      <mesh position={[0, 0, -0.07]}>
        <boxGeometry args={[0.03, 0.03, 0.08]} />
        <meshStandardMaterial color={colour} roughness={0.6} />
      </mesh>
    </group>
  );
};

/** Reused so the frame loop allocates nothing. */
const scratch = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  euler: new THREE.Euler(),
};

/** Ease a value toward a target at a capped speed, or snap for reduced motion. */
function approach(
  object: THREE.Object3D,
  to: { x: number; y: number; z: number },
  metresPerSecond: number,
  delta: number,
  snap: boolean,
): void {
  scratch.position.set(to.x, to.y, to.z);
  if (snap) {
    object.position.copy(scratch.position);
    return;
  }
  const gap = scratch.position.distanceTo(object.position);
  if (gap < 0.0005) return;
  object.position.lerp(scratch.position, Math.min(1, (metresPerSecond * delta) / gap));
}

function turnToward(object: THREE.Object3D, q: Pose["q"], delta: number, snap: boolean): void {
  scratch.quaternion.set(q.x, q.y, q.z, q.w);
  if (snap) object.quaternion.copy(scratch.quaternion);
  else object.quaternion.slerp(scratch.quaternion, Math.min(1, delta * 14));
}

export function Avatar3D({ actorId, kind, connected, live, reducedMotion, saying }: Avatar3DProps) {
  const recipe = useMemo(() => avatarRecipe(actorId), [actorId]);
  const nameTexture = useNameTexture(actorId);
  const nameRef = useConstantApparentSize([1.1, 0.275]);
  const speechRef = useConstantApparentSize([1.6, 0.4]);
  const attendRef = useRef<THREE.Group>(null);

  /**
   * The spoken line, baked when it changes.
   *
   * Wrapped to two lines rather than squeezed onto one: `say` is capped at 240
   * characters, and 240 characters condensed into a single 512px canvas is a
   * grey smear. The caption bug on the headset stills was exactly this.
   */
  const speechTexture = useMemo(
    () => (saying ? makeLabelTexture(saying, { pixelsPerLine: 40, lines: 2 }) : null),
    [saying],
  );
  const spec = useMemo(() => bodySpec(kind), [kind]);

  const headRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const feetRef = useRef<THREE.Group>(null);
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  const labelRef = useRef<THREE.Sprite>(null);

  /**
   * SHOULDERS AND CHEST, not a body.
   *
   * The first version was 0.63m tall and tapered to the floor, which read as a
   * snowman rather than a person — and implied a lower body that is not being
   * tracked. Short and slightly wider at the top stops at the ribs, where the
   * measurements stop.
   */
  const torso = useMemo(
    () =>
      spec.shape === "boxy"
        ? new THREE.BoxGeometry(spec.width * 1.1, TORSO_HEIGHT, spec.depth)
        : new THREE.CylinderGeometry(
            spec.radiusBottom * 1.05,
            spec.radiusTop * 0.85,
            TORSO_HEIGHT,
            spec.segments,
          ),
    [spec],
  );

  useFrame((_, delta) => {
    const person = live();
    if (!person) return;

    // WHERE THE HEAD IS. A reported pose wins. Without one — every agent, and
    // any client that only sends a position — it is placed at a standing
    // eyeline above their feet, turned the way they are walking. That is a
    // placement, not a measurement, and it is why hands are not invented the
    // same way: a head has one sensible default and a hand has none.
    const head = headRef.current;
    if (head) {
      approach(
        head,
        person.head
          ? person.head.p
          : { x: person.at.x, y: EYE_HEIGHT, z: person.at.z },
        6,
        delta,
        reducedMotion,
      );
      turnToward(
        head,
        person.head
          ? person.head.q
          : (() => {
              scratch.euler.set(0, person.facing, 0, "YXZ");
              return new THREE.Quaternion().setFromEuler(scratch.euler);
            })(),
        delta,
        reducedMotion,
      );
    }

    // The torso hangs FROM the head, so ducking takes the shoulders down too.
    // Anchoring the body to the floor while the head follows a tracker makes a
    // person's neck stretch when they crouch, which is the most uncanny thing a
    // half-tracked avatar can do.
    //
    // Only the head's YAW is used: tilting your head does not tilt your
    // shoulders, and the full rotation makes the body roll like a boat.
    const torsoGroup = torsoRef.current;
    if (torsoGroup && head) {
      // Hung just under the chin, so the neck does not stretch when somebody
      // ducks and the shoulders go down with the head.
      torsoGroup.position.set(
        head.position.x,
        head.position.y - HEAD_RADIUS - TORSO_HEIGHT / 2 - 0.05,
        head.position.z,
      );
      scratch.euler.setFromQuaternion(head.quaternion, "YXZ");
      torsoGroup.rotation.set(0, scratch.euler.y, 0);
    }

    // The ring stays on the floor under their feet, wherever the head is.
    if (feetRef.current) {
      approach(feetRef.current, { x: person.at.x, y: 0.02, z: person.at.z }, 6, delta, reducedMotion);
    }

    if (labelRef.current && head) {
      labelRef.current.position.set(head.position.x, head.position.y + 0.42, head.position.z);
    }
    if (speechRef.current && head) {
      speechRef.current.position.set(head.position.x, head.position.y + 0.78, head.position.z);
    }
    if (attendRef.current && head) {
      attendRef.current.visible = person.attending !== null;
      attendRef.current.position.set(head.position.x, head.position.y + 0.34, head.position.z);
    }

    // HANDS ONLY WHERE HANDS WERE REPORTED. A null hand is not tracked — the
    // person may be holding a mug, or at a desk with a mouse, or have set the
    // controllers down. Drawing them a pair would invent the one thing hands
    // are good at showing.
    for (const [ref, pose] of [
      [leftRef, person.hands.left],
      [rightRef, person.hands.right],
    ] as const) {
      const group = ref.current;
      if (!group) continue;
      group.visible = pose !== null;
      if (!pose) continue;
      approach(group, pose.p, 8, delta, reducedMotion);
      turnToward(group, pose.q, delta, reducedMotion);
    }
  });

  return (
    <group>
      <group ref={torsoRef}>
        <mesh geometry={torso}>
          <meshStandardMaterial color={recipe.paper} roughness={0.75} />
        </mesh>
        {/* The motif band across the shoulders. Decoration, and the only thing
            the accent colour is used for — exactly as on the 2D tile. */}
        <mesh position={[0, TORSO_HEIGHT * 0.34, 0]}>
          <torusGeometry args={[spec.shape === "boxy" ? 0.3 : 0.27, 0.028, 8, 24]} />
          <meshStandardMaterial color={recipe.accent} roughness={0.5} />
        </mesh>
      </group>

      <group ref={headRef}>
        <mesh>
          <sphereGeometry args={[HEAD_RADIUS, 20, 16]} />
          <meshStandardMaterial color={recipe.paper} roughness={0.7} />
        </mesh>
        {/* Which way they are looking, on the head itself. A sphere gives no
            clue, and "who is looking at the board" is most of why this room
            exists. -Z is forward. */}
        <mesh position={[0, 0.01, -HEAD_RADIUS * 0.94]}>
          <boxGeometry args={[0.13, 0.045, 0.02]} />
          <meshStandardMaterial color={recipe.ink} roughness={0.4} />
        </mesh>
      </group>

      <Hand groupRef={leftRef} colour={recipe.paper} boxy={spec.shape === "boxy"} />
      <Hand groupRef={rightRef} colour={recipe.paper} boxy={spec.shape === "boxy"} />

      {/* The floor ring. Solid for a declared kind; broken for one we were
          never given — the 3D equivalent of the dashed outline in Identity.tsx,
          carried across so the two pictures make the same claim. */}
      <group ref={feetRef}>
        {ringIsBroken(kind) ? (
          [0, 1, 2, 3, 4, 5].map((index) => (
            <mesh key={index} rotation={[-Math.PI / 2, 0, (index * Math.PI) / 3]}>
              <ringGeometry args={[0.34, 0.4, 12, 1, 0, Math.PI / 5]} />
              <meshBasicMaterial color={recipe.accent} side={THREE.DoubleSide} />
            </mesh>
          ))
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.34, 0.4, 32]} />
            <meshBasicMaterial
              color={recipe.accent}
              side={THREE.DoubleSide}
              transparent
              opacity={connected ? 1 : 0.45}
            />
          </mesh>
        )}
      </group>

      {/* WHAT THEY SAID, in text, above the name. Present even when a voice
          read it out, because a reply that exists only as audio is one that
          cannot be re-read, quoted, or recovered when the speaker is muted. */}
      {speechTexture ? (
        <sprite ref={speechRef} scale={[1.6, 0.4, 1]}>
          <spriteMaterial map={speechTexture} transparent depthWrite={false} />
        </sprite>
      ) : null}

      {/* A DECLARED intention to answer — never inferred from silence. Three
          dots, because the honest content of this state is "they said they are
          working on it" and nothing more specific than that is known. */}
      <group ref={attendRef} visible={false}>
        {[-0.09, 0, 0.09].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <sphereGeometry args={[0.028, 10, 8]} />
            <meshBasicMaterial color={recipe.accent} />
          </mesh>
        ))}
      </group>

      {nameTexture ? (
        <sprite ref={(node) => { nameRef.current = node; labelRef.current = node; }} scale={[1.1, 0.275, 1]}>
          <spriteMaterial map={nameTexture} transparent depthWrite={false} />
        </sprite>
      ) : null}
    </group>
  );
}
