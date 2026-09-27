import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { burning, leftOf, type Stick } from "../../shared/incense";
import { onIncense } from "./incense-events";
import { WristButton } from "./Backdrop";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE INCENSE BOWL (shared/incense.ts), on a small stand behind the orb. Tap
 * "light incense" and a stick catches for everyone: its tip glows, a thin
 * thread of smoke curls up and drifts, and it burns down over ten minutes.
 */

export const INCENSE_AT = { x: 0, z: 3.75, height: 0.8 } as const;
const STICK_LENGTH = 0.24;
const SMOKE = 60;

function Smoke({ from }: { from: THREE.Vector3 }) {
  const points = useRef<THREE.Points>(null);
  const seeds = useMemo(() => Array.from({ length: SMOKE }, () => Math.random()), []);
  const geometry = useMemo(() => {
    const made = new THREE.BufferGeometry();
    made.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3));
    return made;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((state) => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    seeds.forEach((seed, i) => {
      const age = (t * 0.25 + seed) % 1;
      const rise = age * 0.7;
      // A thread that starts straight and begins to curl as it climbs.
      const curl = age * age * 0.12;
      position.setXYZ(
        i,
        from.x + Math.sin(t * 0.9 + rise * 9) * curl,
        from.y + rise,
        from.z + Math.cos(t * 0.7 + rise * 7) * curl,
      );
    });
    position.needsUpdate = true;
  });
  return (
    <points ref={points} geometry={geometry} raycast={() => null}>
      <pointsMaterial size={0.02} color="#d8d8d8" transparent opacity={0.25} depthWrite={false} />
    </points>
  );
}

export function IncenseBowl() {
  const [sticks, setSticks] = useState<Stick[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const offset = useRef(0);
  const [, tick] = useState(0);

  useEffect(() => {
    space.incense().then((answer) => {
      offset.current = answer.now - Date.now();
      setSticks(answer.sticks);
    }).catch(() => {});
  }, []);
  useEffect(() => onIncense((next) => setSticks(next)), []);
  // Burn down visibly: redraw every few seconds.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 4000);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now() + offset.current;
  const lit = burning(sticks, now);
  const facing = Math.atan2(ROOM.spawn.x - INCENSE_AT.x, ROOM.spawn.z - INCENSE_AT.z);

  const light = () => {
    setNote(null);
    space.lightIncense().then((answer) => {
      offset.current = answer.now - Date.now();
      setSticks(answer.sticks);
    }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "It did not catch."));
  };

  return (
    <group position={[INCENSE_AT.x, 0, INCENSE_AT.z]}>
      <mesh position={[0, (INCENSE_AT.height - 0.04) / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.1, 0.14, INCENSE_AT.height - 0.04, 20]} />
        <meshStandardMaterial color="#3a2c24" roughness={0.9} />
      </mesh>
      {/* The bowl of ash. */}
      <mesh position={[0, INCENSE_AT.height, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.11, 0.08, 0.07, 24]} />
        <meshStandardMaterial color="#2c3a3f" roughness={0.6} />
      </mesh>
      <mesh position={[0, INCENSE_AT.height + 0.036, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[0.1, 24]} />
        <meshStandardMaterial color="#b9b2a6" roughness={1} />
      </mesh>
      {lit.map((stick) => {
        const left = leftOf(stick, now);
        const length = 0.02 + STICK_LENGTH * left;
        const a = (stick.slot / 5) * Math.PI * 2;
        const base = new THREE.Vector3(Math.cos(a) * 0.035, INCENSE_AT.height + 0.036, Math.sin(a) * 0.035);
        const tip = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.03 * (length / STICK_LENGTH), length, Math.sin(a) * 0.03 * (length / STICK_LENGTH)));
        return (
          <group key={stick.id}>
            <mesh position={base.clone().lerp(tip, 0.5)} lookAt={tip} raycast={() => null}>
              <cylinderGeometry args={[0.0022, 0.0022, length, 5]} />
              <meshStandardMaterial color="#6b3f22" roughness={0.9} />
            </mesh>
            <mesh position={tip} raycast={() => null}>
              <sphereGeometry args={[0.004, 8, 6]} />
              <meshBasicMaterial color="#ff6a1a" toneMapped={false} />
            </mesh>
            <Smoke from={tip} />
          </group>
        );
      })}
      <group position={[0, INCENSE_AT.height + 0.42, 0]} rotation={[0, facing, 0]}>
        <WristButton
          label={lit.length ? `light incense · ${lit.length} burning` : "light incense · 10 minutes"}
          y={0}
          width={0.46}
          height={0.075}
          lines={1}
          textSize={0.4}
          tone="live"
          onTap={light}
        />
        {note ? <WristButton label={note} y={-0.09} width={0.6} height={0.07} tone="muted" onTap={() => setNote(null)} /> : null}
      </group>
    </group>
  );
}
