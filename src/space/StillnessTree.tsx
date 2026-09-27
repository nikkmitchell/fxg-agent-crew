import { useMemo } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { treeOf } from "../../shared/meditation";
import { ORB_AT } from "./MeditationOrb";

/**
 * THE STILLNESS TREE: a tree beside the orb that grows with every minute the
 * room has breathed together (Meditation.breathedMinutes, shared/meditation.ts).
 *
 * Nightjar's prompt: "a meditation only possible because the room remembers".
 * A sapling on the first night; rings of branches, then leaves, then blossoms
 * as the room is used. It only ever grows. Separate from the orb (Nikk, 5484):
 * it is just there, like a plant in the corner.
 *
 * THE SAME TREE FOR EVERYBODY. Where each branch and leaf goes comes from a
 * fixed seed, not Math.random, so every headset draws the same tree.
 */
export const TREE_AT: [number, number, number] = [ORB_AT[0] + 0.95, 0, ORB_AT[2] - 0.15];

const noRaycast = () => undefined;

/** A small repeatable random: the same sequence on every device. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Twig = { from: THREE.Vector3; to: THREE.Vector3 };

export function StillnessTree({ minutes }: { minutes: number }) {
  const shape = treeOf(minutes);
  const { twigs, leaves, blossoms } = useMemo(() => {
    const random = seeded(4649);
    const twigs: Twig[] = [];
    // Branches in rings up the trunk, three to a ring, turning as they rise.
    for (let ring = 0; ring < shape.branches; ring += 1) {
      const y = shape.height * (0.45 + 0.5 * (ring / Math.max(1, 6)));
      for (let arm = 0; arm < 3; arm += 1) {
        const angle = (arm / 3) * Math.PI * 2 + ring * 0.9 + random() * 0.3;
        const reach = 0.18 + 0.12 * random() + 0.03 * (6 - ring);
        const from = new THREE.Vector3(0, y, 0);
        twigs.push({ from, to: new THREE.Vector3(Math.cos(angle) * reach, y + 0.12 + random() * 0.08, Math.sin(angle) * reach) });
      }
    }
    // Leaves and blossoms cluster at the branch tips, or round the top of a sapling.
    const tips = twigs.length > 0 ? twigs.map((twig) => twig.to) : [new THREE.Vector3(0, shape.height, 0)];
    const around = (count: number, spread: number) => Array.from({ length: count }, (_, index) => {
      const tip = tips[index % tips.length];
      return new THREE.Vector3(tip.x + (random() - 0.5) * spread, tip.y + (random() - 0.3) * spread, tip.z + (random() - 0.5) * spread);
    });
    return { twigs, leaves: around(shape.leaves, 0.2), blossoms: around(shape.blossoms, 0.16) };
  }, [shape.branches, shape.leaves, shape.blossoms, shape.height]);

  const whole = Math.floor(minutes);
  return <group position={TREE_AT}>
    {/* The trunk. */}
    <mesh position={[0, shape.height / 2, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.018, 0.035, shape.height, 8]} />
      <meshStandardMaterial color="#6b4a33" roughness={0.9} />
    </mesh>
    {twigs.map((twig, index) => {
      const middle = twig.from.clone().add(twig.to).multiplyScalar(0.5);
      const length = twig.from.distanceTo(twig.to);
      const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), twig.to.clone().sub(twig.from).normalize());
      return <mesh key={`b${index}`} position={middle} quaternion={turn} raycast={noRaycast}>
        <cylinderGeometry args={[0.007, 0.013, length, 6]} />
        <meshStandardMaterial color="#6b4a33" roughness={0.9} />
      </mesh>;
    })}
    {leaves.map((at, index) => <mesh key={`l${index}`} position={at} raycast={noRaycast}>
      <sphereGeometry args={[0.022, 6, 5]} />
      <meshStandardMaterial color={index % 3 === 0 ? "#7fbf6a" : "#5e9e52"} roughness={0.8} />
    </mesh>)}
    {blossoms.map((at, index) => <mesh key={`f${index}`} position={at} raycast={noRaycast}>
      <sphereGeometry args={[0.018, 6, 5]} />
      <meshBasicMaterial color="#ffd1e3" toneMapped={false} />
    </mesh>)}
    {/* A pot, so a sapling in someone's real room looks planted, not dropped. */}
    <mesh position={[0, 0.07, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.1, 0.08, 0.14, 16]} />
      <meshStandardMaterial color="#b9785a" roughness={0.8} />
    </mesh>
    <Text position={[0, 0.2, 0.16]} fontSize={0.028} color="#eefaf7" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418" anchorX="center">
      {whole === 0 ? "BREATHE HERE AND I GROW" : `${whole} MINUTE${whole === 1 ? "" : "S"} BREATHED TOGETHER`}
    </Text>
  </group>;
}
