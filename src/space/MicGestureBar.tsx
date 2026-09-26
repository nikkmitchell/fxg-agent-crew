import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { micGestureHands, micGestureIndicator } from "./mic-gesture-input";

/**
 * RECORDING, SHOWN BESIDE THE HAND. Nikk (5044): "a talking kind of small
 * rectangle that appears to the side of your hand, either to the left if
 * using your right hand or to the right if you're using your left hand ...
 * green ... the same design and look as the movement spheres". It replaces the
 * glowing outline drawn over the whole hand.
 *
 * Drawn like the palm joystick's balls: unlit, a little see-through, never
 * hidden behind anything (depthTest off), with a faint white wireframe edge
 * like the ball's shadow. It breathes gently so it reads as live. Beside the
 * middle of the hand, toward the inside of the body, level with where you are
 * looking, so it never covers the hand itself.
 *
 * A child of the XR origin, like the balls, because the hand positions it
 * reads are in the player's frame.
 */
const GREEN = "#6fdc8c";
const BESIDE_METRES = 0.07;
const scratchRight = new THREE.Vector3();
const scratchCentre = new THREE.Vector3();

export function MicGestureBar() {
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const node = group.current;
    if (!node) return;
    const side = micGestureIndicator.side;
    const hand = side ? micGestureHands[side] : null;
    node.visible = hand !== null;
    if (!hand || !side) return;
    // The middle of the hand: wrist to middle knuckle, when tracked.
    const wrist = hand.wrist.p, knuckle = hand.joints[11] ?? wrist;
    scratchCentre.set((wrist.x + knuckle.x) / 2, (wrist.y + knuckle.y) / 2, (wrist.z + knuckle.z) / 2);
    // "Left of your right hand, right of your left": along the head's right.
    if (hand.head) {
      const q = hand.head.q;
      scratchRight.set(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      scratchRight.y = 0;
      scratchRight.normalize();
    } else {
      scratchRight.set(1, 0, 0);
    }
    scratchCentre.addScaledVector(scratchRight, side === "right" ? -BESIDE_METRES : BESIDE_METRES);
    node.position.copy(scratchCentre);
    // Upright, and turned to face where you are looking.
    node.rotation.set(0, Math.atan2(scratchRight.x, scratchRight.z) - Math.PI / 2, 0);
    if (fill.current) fill.current.opacity = 0.75 + Math.sin(clock.elapsedTime * 4) * 0.15;
  });
  return (
    <group ref={group} visible={false}>
      <mesh raycast={() => null} renderOrder={10}>
        <boxGeometry args={[0.014, 0.075, 0.014]} />
        <meshBasicMaterial ref={fill} color={GREEN} transparent opacity={0.85} depthTest={false} />
      </mesh>
      <mesh raycast={() => null} renderOrder={11}>
        <boxGeometry args={[0.018, 0.079, 0.018]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.25} depthTest={false} wireframe />
      </mesh>
    </group>
  );
}
