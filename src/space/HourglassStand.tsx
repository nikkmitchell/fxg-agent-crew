import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { topAt, type Hourglass } from "../../shared/hourglass";
import { onHourglass } from "./hourglass-events";
import { space } from "../space-client";

/**
 * THE HOURGLASS (shared/hourglass.ts) on a low plinth near the cushions. Tap
 * it and it turns over, for everyone; three minutes of sand run down, a thin
 * thread falling from the top bulb into a heap in the bottom one.
 */

export const HOURGLASS_AT = { x: 1.25, z: 6.05, height: 0.62 } as const;
const BULB = 0.07;

export function HourglassStand() {
  const [glass, setGlass] = useState<Hourglass>({ turnedAt: null, topThen: 0 });
  const offset = useRef(0);
  const turning = useRef(0);
  const frame = useRef<THREE.Group>(null);
  const top = useRef<THREE.Mesh>(null);
  const bottom = useRef<THREE.Mesh>(null);
  const thread = useRef<THREE.Mesh>(null);

  useEffect(() => {
    space.hourglass().then((answer) => {
      offset.current = answer.now - Date.now();
      setGlass(answer.glass);
    }).catch(() => {});
  }, []);
  useEffect(
    () =>
      onHourglass((next) => {
        setGlass(next);
        turning.current = 1;
      }),
    [],
  );

  const cone = useMemo(() => new THREE.ConeGeometry(BULB * 0.8, BULB * 0.9, 20), []);
  useEffect(() => () => cone.dispose(), [cone]);

  useFrame((_, delta) => {
    const left = topAt(glass, Date.now() + offset.current);
    // The top heap shrinks down into its neck; the bottom one grows up from the base.
    if (top.current) {
      top.current.visible = left > 0.01;
      top.current.scale.setScalar(Math.max(0.01, Math.cbrt(left)));
    }
    if (bottom.current) {
      bottom.current.visible = left < 0.99;
      bottom.current.scale.setScalar(Math.max(0.01, Math.cbrt(1 - left)));
    }
    if (thread.current) thread.current.visible = left > 0.001 && left < 0.999;
    // A half turn when it is turned over.
    if (frame.current) {
      turning.current = Math.max(0, turning.current - delta * 2);
      frame.current.rotation.z = turning.current * Math.PI;
    }
  });

  return (
    <group position={[HOURGLASS_AT.x, 0, HOURGLASS_AT.z]}>
      <mesh position={[0, HOURGLASS_AT.height / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.1, 0.13, HOURGLASS_AT.height, 20]} />
        <meshStandardMaterial color="#3a2c24" roughness={0.9} />
      </mesh>
      <group
        ref={frame}
        position={[0, HOURGLASS_AT.height + BULB * 1.2 + 0.02, 0]}
        onClick={(event) => {
          event.stopPropagation();
          space.turnHourglass().then((answer) => {
            offset.current = answer.now - Date.now();
            setGlass(answer.glass);
            turning.current = 1;
          }).catch(() => {});
        }}
      >
        {/* Glass: two bulbs meeting at a waist. */}
        {[1, -1].map((side) => (
          <mesh key={side} position={[0, side * BULB * 0.6, 0]} scale={[1, 1.1, 1]}>
            <sphereGeometry args={[BULB, 20, 14]} />
            <meshStandardMaterial color="#cfe3f5" transparent opacity={0.22} roughness={0.1} depthWrite={false} />
          </mesh>
        ))}
        {/* Sand: a cone in the top pointing down, a heap in the bottom, the thread between. */}
        <mesh ref={top} geometry={cone} position={[0, BULB * 0.45, 0]} rotation-z={Math.PI} raycast={() => null}>
          <meshStandardMaterial color="#d9b77a" roughness={1} />
        </mesh>
        <mesh ref={bottom} geometry={cone} position={[0, -BULB * 0.95, 0]} raycast={() => null}>
          <meshStandardMaterial color="#d9b77a" roughness={1} />
        </mesh>
        <mesh ref={thread} position={[0, -BULB * 0.35, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.0015, 0.0015, BULB * 1.1, 4]} />
          <meshBasicMaterial color="#d9b77a" />
        </mesh>
        {/* The wooden ends and posts. */}
        {[1, -1].map((side) => (
          <mesh key={`e${side}`} position={[0, side * BULB * 1.45, 0]} raycast={() => null}>
            <cylinderGeometry args={[BULB * 1.15, BULB * 1.15, 0.015, 20]} />
            <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
          </mesh>
        ))}
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <mesh key={`p${i}`} position={[Math.cos(a) * BULB * 1.0, 0, Math.sin(a) * BULB * 1.0]} raycast={() => null}>
              <cylinderGeometry args={[0.004, 0.004, BULB * 2.9, 6]} />
              <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
