import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { LANTERN_WORD, lanternAt, stillAloft, type Lantern } from "../../shared/lantern";
import { onLantern } from "./lantern-events";
import { WristButton } from "./Backdrop";
import { Typing3D } from "./Typing3D";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";
import { displayMotionTime, freezeMotionTime } from "./ambient-motion";

/**
 * FLOATING LANTERNS (shared/lantern.ts): a small stone step behind the orb
 * where you release a paper lantern, with a word if you like. It rises slowly
 * into the dark and drifts away, glowing, for everyone in the room; minutes
 * later it is too high and far to see.
 */

export const LAUNCH_AT = { x: 0.6, z: 2.6 } as const;

export function lanternDisplaySeconds(seconds: number, frozenSeconds: number | null, reducedMotion = false): number {
  return displayMotionTime(seconds, frozenSeconds, reducedMotion);
}

function OneLantern({ lantern, offset, reducedMotion }: { lantern: Lantern; offset: React.MutableRefObject<number>; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const paper = useRef<THREE.MeshBasicMaterial>(null);
  const flicker = useMemo(() => Math.random() * 10, []);
  const frozenSeconds = useRef<number | null>(null);
  useFrame((state) => {
    const seconds = (Date.now() + offset.current - lantern.at) / 1000;
    frozenSeconds.current = freezeMotionTime(seconds, frozenSeconds.current, reducedMotion);
    const shownSeconds = lanternDisplaySeconds(seconds, frozenSeconds.current, reducedMotion);
    const at = lanternAt(lantern.seed, shownSeconds);
    if (group.current) {
      group.current.position.set(at.x, at.y, at.z);
      group.current.rotation.y = shownSeconds * 0.2 + lantern.seed * 6;
      group.current.visible = at.glow > 0;
    }
    if (paper.current) paper.current.opacity = 0.9 * at.glow * (reducedMotion ? 0.9 : 0.9 + Math.sin(state.clock.elapsedTime * 7 + flicker) * 0.08);
  });
  return (
    <group ref={group}>
      <mesh raycast={() => null}>
        <cylinderGeometry args={[0.1, 0.085, 0.24, 16, 1, true]} />
        <meshBasicMaterial ref={paper} color="#ffb257" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.1, 0]} raycast={() => null}>
        <sphereGeometry args={[0.035, 10, 8]} />
        <meshBasicMaterial color="#fff1c4" toneMapped={false} />
      </mesh>
      {lantern.word ? (
        <Billboard position={[0, 0, 0]}>
          <Text fontSize={0.035} color="#5a2a08" anchorX="center" anchorY="middle" raycast={() => null}>
            {lantern.word}
          </Text>
        </Billboard>
      ) : null}
    </group>
  );
}

export function Lanterns({ you, reducedMotion = false }: { you: string | null; reducedMotion?: boolean }) {
  const [sky, setSky] = useState<Lantern[]>([]);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Server clock minus ours, so every lantern is where the room thinks it is. */
  const offset = useRef(0);

  useEffect(() => {
    space
      .lanterns()
      .then((answer) => {
        offset.current = answer.now - Date.now();
        setSky(answer.lanterns);
      })
      .catch(() => {});
  }, []);
  useEffect(
    () =>
      onLantern((lantern) => {
        setSky((all) => (all.some((one) => one.id === lantern.id) ? all : stillAloft([...all, lantern], Date.now() + offset.current)));
      }),
    [],
  );
  // Let go of lanterns that have left the sky, once a minute.
  useEffect(() => {
    const timer = setInterval(() => setSky((all) => stillAloft(all, Date.now() + offset.current)), 60_000);
    return () => clearInterval(timer);
  }, []);

  const release = (word: string) => {
    setNote(null);
    space
      .releaseLantern(word)
      .then((answer) => {
        offset.current = answer.now - Date.now();
        setSky((all) => (all.some((one) => one.id === answer.lantern.id) ? all : [...all, answer.lantern]));
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "The lantern did not go up."));
  };

  const facing = Math.atan2(ROOM.spawn.x - LAUNCH_AT.x, ROOM.spawn.z - LAUNCH_AT.z);
  void you;

  return (
    <group position={[LAUNCH_AT.x, 0, LAUNCH_AT.z]}>
      {/* The step they are let go from. */}
      <mesh position={[0, 0.05, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.3, 0.34, 0.1, 32]} />
        <meshStandardMaterial color="#5b564e" roughness={0.9} />
      </mesh>
      {sky.map((lantern) => (
        <OneLantern key={lantern.id} lantern={lantern} offset={offset} reducedMotion={reducedMotion} />
      ))}
      <group position={[0, 1.05, 0]} rotation={[0, facing, 0]}>
        <WristButton label="release a lantern" y={0.05} width={0.44} height={0.08} lines={1} textSize={0.42} tone="live" onTap={() => release("")} />
        <WristButton label="…with a word" y={-0.05} width={0.44} height={0.07} lines={1} textSize={0.42} onTap={() => setWriting(true)} />
        {note ? <WristButton label={note} y={-0.15} width={0.6} height={0.07} tone="muted" onTap={() => setNote(null)} /> : null}
        {writing ? (
          <Typing3D
            prompt="A word to send up with the lantern. Everyone here will see it rise."
            limit={LANTERN_WORD}
            position={[0, -0.2, 0.3]}
            scale={1}
            onCancel={() => setWriting(false)}
            onDone={(word) => {
              setWriting(false);
              release(word);
            }}
          />
        ) : null}
      </group>
    </group>
  );
}
