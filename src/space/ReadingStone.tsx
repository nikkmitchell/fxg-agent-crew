import { useEffect, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { READINGS, READING_IDS } from "../../shared/guided";
import { ORB_AT } from "./MeditationOrb";

/**
 * THE READING STONE: tap it to hear a short passage read aloud, a line at a
 * time, with the words shown above it. Public-domain texts only (READINGS in
 * shared/guided.ts): the Tao Te Ching in Legge's 1891 translation, Dickinson,
 * Whitman. Nikk (5463): "old ... speeches or chants".
 *
 * FOR THE PERSON WHO TAPPED IT, not the room: a reading is something you go
 * and sit with, and a room where anybody can start a poem for everybody would
 * be a room where a session gets talked over. Separate from the orb (5484).
 */
export const READING_AT: [number, number, number] = [ORB_AT[0] - 1.35, 0, ORB_AT[2] - 0.45];

const noRaycast = () => undefined;

function StoneButton({ label, at, onTap, width = 0.2 }: { label: string; at: [number, number, number]; onTap: () => void; width?: number }) {
  const [hover, setHover] = useState(false);
  const down = useRef<number | null>(null);
  return <group position={at}
    // On release, for the pointer that pressed: a headset squeeze is longer
    // than a click, see usePress in RoomItems.tsx.
    onPointerDown={(event) => { event.stopPropagation(); down.current = event.pointerId; }}
    onPointerUp={(event) => { if (down.current !== event.pointerId) return; event.stopPropagation(); down.current = null; onTap(); }}
    onPointerOver={() => setHover(true)} onPointerOut={() => { setHover(false); down.current = null; }}>
    <mesh><planeGeometry args={[width, 0.07]} /><meshBasicMaterial color="#f2e6cc" transparent opacity={hover ? 0.3 : 0.1} depthWrite={false} /></mesh>
    <Text position-z={0.002} fontSize={0.03} color="#f2e6cc" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">{label}</Text>
  </group>;
}

/** The tea practice is read at the tea table, not here. */
const ON_THE_STONE = READING_IDS.filter((id) => id !== "tea");

export function ReadingStone() {
  const [pick, setPick] = useState(0);
  const [line, setLine] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const base = useRef("");
  useEffect(() => {
    void import("../router").then((router) => { base.current = router.base; }).catch(() => undefined);
    return () => { audio.current?.pause(); };
  }, []);

  const id = ON_THE_STONE[pick];
  const reading = READINGS[id];

  /** Read line `index`, then the next when it ends, until the passage is done. */
  const read = (index: number) => {
    audio.current?.pause();
    if (index >= reading.lines.length) { setLine(null); audio.current = null; return; }
    setLine(index);
    const next = new Audio(`${base.current}/bff/space/readings/${id}/${index}/audio`);
    audio.current = next;
    // A short pause between lines, the way a person reading aloud breathes.
    next.onended = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 900); };
    // No voice (a box without a speech engine): the words still show, a line every five seconds.
    next.onerror = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 5000); };
    void next.play().catch(() => undefined);
  };
  const stop = () => { audio.current?.pause(); audio.current = null; setLine(null); };

  return <group position={READING_AT} rotation-y={0.6}>
    {/* A low plinth and a flat, smooth stone on it. */}
    <mesh position={[0, 0.2, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.16, 0.19, 0.4, 20]} />
      <meshStandardMaterial color="#8d8a84" roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.43, 0]} scale={[1, 0.28, 0.8]} raycast={noRaycast}>
      <sphereGeometry args={[0.13, 24, 16]} />
      <meshStandardMaterial color="#5b6a70" roughness={0.6} />
    </mesh>
    <group position={[0, 0.78, 0]}>
      <Text position={[0, 0.2, 0]} fontSize={0.04} color="#fff6e0" raycast={noRaycast} outlineWidth={0.003} outlineColor="#0b1418">{reading.title}</Text>
      <Text position={[0, 0.15, 0]} fontSize={0.022} color="#cfe7e3" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">{reading.by}</Text>
      <Text position={[0, 0.06, 0]} fontSize={0.03} maxWidth={0.7} textAlign="center" color="#fff6e0" raycast={noRaycast} outlineWidth={0.003} outlineColor="#0b1418">
        {line === null ? "Tap READ to hear it." : reading.lines[line]}
      </Text>
      <StoneButton label={line === null ? "READ" : "STOP"} at={[-0.12, -0.06, 0]} onTap={() => (line === null ? read(0) : stop())} />
      <StoneButton label="NEXT" at={[0.12, -0.06, 0]} onTap={() => { stop(); setPick((pick + 1) % ON_THE_STONE.length); }} />
    </group>
  </group>;
}
