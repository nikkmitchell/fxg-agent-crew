import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { micGestureHands, micGestureIndicator } from "./mic-gesture-input";
import { recordedControl, recorderControlVisual } from "./recorder-control-visual";

/**
 * RECORDING, SHOWN BESIDE THE HAND. Nikk (5044): "a talking kind of small
 * rectangle that appears to the side of your hand, either to the left if
 * using your right hand or to the right if you're using your left hand ...
 * green ... the same design and look as the movement spheres". It replaces the
 * glowing outline drawn over the whole hand.
 *
 * AND IT SHOWS HOW NEAR THE END YOU ARE, differently for the two ends.
 * Closing toward a fist throws the words away, so the bar loses its colour
 * toward white and breaks apart white (5069). Tilting down sends them, and
 * Nikk (5113): "as I'm angling downwards the [bar] should also angle with my
 * hand and it should go brighter and more green and then when the message
 * sends it should do a green pop out". So the bar leans with the hand the
 * whole time, brightens with micGestureIndicator.tilt, fades with .closing,
 * and the pieces it breaks into are green for a send and white for a cancel.
 *
 * Drawn like the palm joystick's balls: unlit, a little see-through, never
 * hidden behind anything (depthTest off), a faint white wireframe edge. Beside
 * the middle of the hand, toward the inside of the body, so it never covers
 * the hand. A child of the XR origin, like the balls, because the hand
 * positions it reads are in the player's frame.
 */
const GREEN = new THREE.Color("#6fdc8c");
/** Where the tilt takes it: brighter and greener, about to send. */
const BRIGHT_GREEN = new THREE.Color("#8dff6a");
const WHITE = new THREE.Color("#ffffff");
const BESIDE_METRES = 0.07;
const POP_MS = 450;
const SHARDS = 10;
/** Where each shard flies, fixed so the pop looks the same every time. */
const SHARD_DIRECTIONS = Array.from({ length: SHARDS }, (_, i) => {
  const a = (i / SHARDS) * Math.PI * 2, up = ((i * 7) % SHARDS) / SHARDS - 0.5;
  return new THREE.Vector3(Math.cos(a), up * 1.4, Math.sin(a)).normalize();
});
const scratchRight = new THREE.Vector3();
const scratchCentre = new THREE.Vector3();
const scratchAlong = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export function MicGestureBar() {
  const bar = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const shards = useRef<THREE.Group>(null);
  // One material for every piece, so they fade together.
  const shardMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthTest: false }), []);
  useEffect(() => () => shardMaterial.dispose(), [shardMaterial]);
  const last = useRef(new THREE.Vector3());
  const lastPop = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const node = bar.current, pieces = shards.current;
    if (!node || !pieces) return;
    const now = performance.now();

    // THE POP: from where the bar last was, for a moment, then gone.
    const popAt = micGestureIndicator.popAt;
    const popping = popAt !== null && now - popAt < POP_MS;
    if (popping && lastPop.current !== popAt) {
      lastPop.current = popAt;
      pieces.position.copy(last.current);
      shardMaterial.color.copy(micGestureIndicator.popKind === "sent" ? BRIGHT_GREEN : WHITE);
    }
    pieces.visible = popping;
    if (popping) {
      const t = (now - popAt!) / POP_MS;
      pieces.children.forEach((piece, i) => {
        piece.position.copy(SHARD_DIRECTIONS[i]).multiplyScalar(0.012 + t * 0.09);
        piece.rotation.set(t * 6 + i, t * 4, 0);
      });
      shardMaterial.opacity = 0.9 * (1 - t);
    }

    const side = micGestureIndicator.side;
    const hand = side ? micGestureHands[side] : null;
    node.visible = hand !== null && !popping;
    if (!hand || !side) { recorderControlVisual.micBar = null; return; }
    // The middle of the hand: wrist to middle knuckle, when tracked.
    const wrist = hand.wrist.p, knuckle = hand.joints[11] ?? wrist;
    scratchCentre.set((wrist.x + knuckle.x) / 2, (wrist.y + knuckle.y) / 2, (wrist.z + knuckle.z) / 2);
    // "Left of your right hand, right of your left": along the head's right.
    if (hand.head) {
      const q = hand.head.q;
      scratchRight.set(1, 0, 0).applyQuaternion(scratchQuaternion.set(q.x, q.y, q.z, q.w));
      scratchRight.y = 0;
      scratchRight.normalize();
    } else {
      scratchRight.set(1, 0, 0);
    }
    scratchCentre.addScaledVector(scratchRight, side === "right" ? -BESIDE_METRES : BESIDE_METRES);
    node.position.copy(scratchCentre);
    last.current.copy(scratchCentre);
    // LEANING WITH THE HAND: its length along the hand, wrist to knuckle, so
    // tilting the hand down to send tilts the bar with it. Upright when the
    // knuckle is not tracked.
    scratchAlong.set(knuckle.x - wrist.x, knuckle.y - wrist.y, knuckle.z - wrist.z);
    if (scratchAlong.lengthSq() > 1e-6) node.quaternion.setFromUnitVectors(UP, scratchAlong.normalize());
    else node.quaternion.identity();
    const tilt = Math.max(0, Math.min(1, micGestureIndicator.tilt));
    const closing = Math.max(0, Math.min(1, micGestureIndicator.closing));
    if (fill.current) {
      fill.current.color.copy(GREEN).lerp(BRIGHT_GREEN, tilt).lerp(WHITE, closing);
      // Breathing while live; steadier, and more solid, as it nears sending.
      fill.current.opacity = Math.min(1, 0.8 + tilt * 0.2) + Math.sin(clock.elapsedTime * 4) * 0.12 * (1 - Math.max(tilt, closing));
    }
    recorderControlVisual.micBar = recordedControl(node);
  });
  return (
    <>
      <group ref={bar} visible={false}>
        <mesh raycast={() => null} renderOrder={10}>
          <boxGeometry args={[0.014, 0.075, 0.014]} />
          <meshBasicMaterial ref={fill} color={GREEN} transparent opacity={0.85} depthTest={false} />
        </mesh>
        <mesh raycast={() => null} renderOrder={11}>
          <boxGeometry args={[0.018, 0.079, 0.018]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.25} depthTest={false} wireframe />
        </mesh>
      </group>
      <group ref={shards} visible={false}>
        {SHARD_DIRECTIONS.map((_, i) => (
          <mesh key={i} raycast={() => null} renderOrder={12} material={shardMaterial}>
            <boxGeometry args={[0.008, 0.012, 0.008]} />
          </mesh>
        ))}
      </group>
    </>
  );
}
