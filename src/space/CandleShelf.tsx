import { useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { INTENTION_LONGEST, MOST_CANDLES, burning, candleLeft, type Meditation } from "../../shared/meditation";
import { space } from "../space-client";
import { Typing3D } from "./Typing3D";

/**
 * THE CANDLE SHELF. Light a candle, for someone or something if you like, and
 * it burns for everybody in the room for a day, getting shorter as it goes,
 * then goes out (shared/meditation.ts, Candle). A separate thing in the room
 * (Nikk, 5484), set back on the right where the space was free.
 */
export const SHELF_AT: [number, number, number] = [1.5, 0, 3.5];
const SHELF_HEIGHT = 0.9;
const SHELF_WIDTH = 1.2;
const TALLEST = 0.14;

const noRaycast = () => undefined;

export function candleFlameScale(seconds: number, seed: number, reducedMotion = false): [number, number, number] {
  if (reducedMotion) return [0.9, 1, 0.9];
  const t = seconds + seed * 7.3;
  const flicker = 1 + 0.12 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 13.7);
  return [0.9 + 0.1 * Math.sin(t * 5), flicker, 0.9];
}

function Flame({ seed, reducedMotion }: { seed: number; reducedMotion: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useFrame(({ clock }) => {
    if (!flame.current) return;
    flame.current.scale.set(...candleFlameScale(clock.elapsedTime, seed, reducedMotion));
    if (!reducedMotion) invalidate();
  });
  return <mesh ref={flame} raycast={noRaycast}>
    <sphereGeometry args={[0.012, 10, 8]} />
    <meshBasicMaterial color="#ffc46b" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
  </mesh>;
}

export function CandleShelf({ meditation, onMeditation, reducedMotion = false }: {
  meditation: Meditation;
  onMeditation: (session: Meditation) => void;
  reducedMotion?: boolean;
}) {
  const [lighting, setLighting] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const down = useRef<number | null>(null);
  const now = Date.now();
  const lit = burning(meditation.candles, now);

  const light = (dedication: string) => {
    setTrouble(null);
    space.meditate({ action: "light", for: dedication })
      .then((answer) => onMeditation(answer.meditation))
      .catch((error: { message?: string }) => setTrouble(error?.message ?? "the candle would not light"));
  };

  const spacing = SHELF_WIDTH / (MOST_CANDLES / 2 + 1);
  return <group position={SHELF_AT} rotation-y={-0.35}>
    {/* The shelf: a plank on two legs. */}
    <mesh position={[0, SHELF_HEIGHT - 0.015, 0]} raycast={noRaycast}>
      <boxGeometry args={[SHELF_WIDTH, 0.03, 0.26]} />
      <meshStandardMaterial color="#5a3d2b" roughness={0.85} />
    </mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * (SHELF_WIDTH / 2 - 0.05), (SHELF_HEIGHT - 0.03) / 2, 0]} raycast={noRaycast}>
      <boxGeometry args={[0.04, SHELF_HEIGHT - 0.03, 0.22]} />
      <meshStandardMaterial color="#4a3223" roughness={0.9} />
    </mesh>)}

    {/* Two rows, front and back: twelve to a row. */}
    {lit.map((candle, index) => {
      const row = index < MOST_CANDLES / 2 ? 0 : 1;
      const x = -SHELF_WIDTH / 2 + spacing * ((index % (MOST_CANDLES / 2)) + 1);
      const z = row === 0 ? 0.06 : -0.06;
      const height = 0.02 + TALLEST * candleLeft(candle, now);
      return <group key={`${candle.by}-${candle.litAt}`} position={[x, SHELF_HEIGHT, z]}>
        <mesh position={[0, height / 2, 0]} raycast={noRaycast}>
          <cylinderGeometry args={[0.016, 0.016, height, 12]} />
          <meshStandardMaterial color="#f3ead7" roughness={0.5} emissive="#ffb35c" emissiveIntensity={0.15} />
        </mesh>
        <group position={[0, height + 0.018, 0]}><Flame seed={index + candle.litAt % 97} reducedMotion={reducedMotion} /></group>
        {candle.for && <Text position={[0, height + 0.06, 0]} fontSize={0.018} color="#fff1d6" raycast={noRaycast} outlineWidth={0.0015} outlineColor="#0b1418">{candle.for}</Text>}
      </group>;
    })}

    <group position={[0, SHELF_HEIGHT + 0.36, 0.1]}>
      <Text fontSize={0.035} color="#fff1d6" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">
        {lit.length === 0 ? "LIGHT A CANDLE" : `${lit.length} CANDLE${lit.length === 1 ? "" : "S"} BURNING`}
      </Text>
      <group position={[0, -0.07, 0]}
        onPointerDown={(event) => { event.stopPropagation(); down.current = event.pointerId; }}
        onPointerUp={(event) => { if (down.current !== event.pointerId) return; event.stopPropagation(); down.current = null; setLighting(true); }}>
        <mesh><planeGeometry args={[0.3, 0.065]} /><meshBasicMaterial color="#ffc46b" transparent opacity={0.18} depthWrite={false} /></mesh>
        <Text position-z={0.002} fontSize={0.028} color="#fff1d6" raycast={noRaycast}>+ LIGHT ONE</Text>
      </group>
      {trouble && <Text position={[0, -0.13, 0]} fontSize={0.022} color="#ffb4a6" raycast={noRaycast}>{trouble}</Text>}
    </group>

    {lighting && <Typing3D
      prompt="Who or what is it for? Everyone here will see it. Leave empty for no words."
      limit={INTENTION_LONGEST}
      position={[0, SHELF_HEIGHT + 0.25, 0.45]}
      scale={1}
      onCancel={() => setLighting(false)}
      onDone={(dedication) => { setLighting(false); light(dedication); }}
    />}
  </group>;
}
