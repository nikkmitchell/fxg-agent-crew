import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { READY_WORDS, OFFERING_LONGEST, sparkAt, type Offering } from "../../shared/fire";
import { onOffering } from "./fire-events";
import { crackle, fireLevel, rumble, whoosh } from "./fire-sound";
import { WristButton } from "./Backdrop";
import { Typing3D } from "./Typing3D";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE EMBER FIRE (shared/fire.ts): a small fire in a ring of stones, to the
 * right of where people arrive.
 *
 * Beside it stands a little sign, LET SOMETHING GO, with a few words you can
 * simply tap, or "my own word" for the keyboard. The word rises out of the
 * flames for everyone in the room, glows, and burns away into sparks. Nothing
 * is kept anywhere.
 */

export const FIRE_AT = { x: 2.3, z: 5.5 } as const;
const SPARKS_PER_WORD = 40;
const BURN_SECONDS = 4.5;
const IDLE_SPARKS = 36;
const noRaycast = () => null;

type Burning = { id: number; word: string; by: string; start: number; seeds: number[] };

function Flame({ index }: { index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * 10, []);
  const angle = (index / 5) * Math.PI * 2;
  const offset = index === 0 ? 0 : 0.07;
  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    const flicker = 0.85 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 13.7) * 0.06 + Math.sin(t * 3.3) * 0.05;
    if (mesh.current) {
      mesh.current.scale.set(1, flicker * (index === 0 ? 1.25 : 0.85), 1);
      mesh.current.rotation.y = t * 0.7;
      mesh.current.position.x = Math.cos(angle) * offset + Math.sin(t * 5) * 0.006;
      mesh.current.position.z = Math.sin(angle) * offset;
    }
  });
  const height = index === 0 ? 0.42 : 0.28;
  return (
    <mesh ref={mesh} position={[0, 0.1 + height / 2, 0]} raycast={noRaycast}>
      <coneGeometry args={[index === 0 ? 0.1 : 0.065, height, 12, 1, true]} />
      <meshBasicMaterial
        color={index === 0 ? "#ffb347" : index % 2 ? "#ff7a1f" : "#ffd27a"}
        transparent
        opacity={index === 0 ? 0.55 : 0.45}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Embers always drifting up from the fire, and every word's burst of sparks. */
function Sparks({ burning }: { burning: Burning[] }) {
  const points = useRef<THREE.Points>(null);
  const capacity = IDLE_SPARKS + SPARKS_PER_WORD * 6;
  const geometry = useMemo(() => {
    const made = new THREE.BufferGeometry();
    made.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    made.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    return made;
  }, [capacity]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const idleSeeds = useMemo(() => Array.from({ length: IDLE_SPARKS }, () => Math.random()), []);
  useFrame((state) => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
    const now = state.clock.elapsedTime;
    let n = 0;
    const put = (x: number, y: number, z: number, glow: number) => {
      if (n >= capacity) return;
      position.setXYZ(n, x, y, z);
      colour.setXYZ(n, glow, glow * 0.55, glow * 0.15);
      n += 1;
    };
    // Idle embers: each on its own 3-second loop, small and slow.
    idleSeeds.forEach((seed, i) => {
      const age = (now * 0.9 + seed * 3 + i * 0.37) % 3;
      const spark = sparkAt(seed, age * 0.6);
      put(spark.x * 0.5, 0.15 + spark.y * 0.9, spark.z * 0.5, spark.glow * 0.8);
    });
    for (const burn of burning) {
      const age = (performance.now() - burn.start) / 1000 - 0.8;
      if (age < 0) continue;
      for (const seed of burn.seeds) {
        const spark = sparkAt(seed, age);
        put(spark.x, 0.9 + spark.y, spark.z, spark.glow);
      }
    }
    for (let i = n; i < capacity; i += 1) position.setXYZ(i, 0, -10, 0);
    position.needsUpdate = true;
    colour.needsUpdate = true;
  });
  return (
    <points ref={points} geometry={geometry} raycast={noRaycast}>
      <pointsMaterial size={0.018} vertexColors transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/** One word, rising out of the fire and burning away. */
function BurningWord({ burn }: { burn: Burning }) {
  const text = useRef<THREE.Mesh & { fillOpacity?: number; color?: THREE.Color | string }>(null);
  const lift = useRef<THREE.Group>(null);
  useFrame(() => {
    const age = (performance.now() - burn.start) / 1000;
    const node = text.current;
    if (!node) return;
    if (lift.current) lift.current.position.y = 0.35 + Math.min(age, 1.2) * 0.5 + Math.max(0, age - 1.2) * 0.08;
    const fade = age < 0.4 ? age / 0.4 : Math.max(0, 1 - (age - 0.9) / 1.4);
    node.fillOpacity = fade;
    const hot = Math.min(1, Math.max(0, (age - 0.5) / 0.8));
    node.color = new THREE.Color("#fff6e0").lerp(new THREE.Color("#ff6a1a"), hot);
  });
  return (
    // Always turned to whoever is looking: everyone round the fire reads it.
    <group ref={lift} position={[0, 0.35, 0]}>
      <Billboard>
        <Text ref={text} fontSize={0.1} anchorX="center" anchorY="middle" outlineWidth={0.004} outlineColor="#3a1204" raycast={noRaycast}>
          {burn.word}
        </Text>
      </Billboard>
    </group>
  );
}

export function EmberFire({ you }: { you: string | null }) {
  const [burning, setBurning] = useState<Burning[]>([]);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const counter = useRef(0);
  const light = useRef<THREE.PointLight>(null);
  const level = useRef(0);

  const burn = (offering: Pick<Offering, "word" | "by">) => {
    counter.current += 1;
    const id = counter.current;
    setBurning((all) => [...all.slice(-5), { id, word: offering.word, by: offering.by, start: performance.now(), seeds: Array.from({ length: SPARKS_PER_WORD }, () => Math.random()) }]);
    whoosh(Math.max(0.2, level.current));
    setTimeout(() => setBurning((all) => all.filter((one) => one.id !== id)), BURN_SECONDS * 1000);
  };

  useEffect(
    () =>
      onOffering((offering) => {
        if (you && offering.by.toLowerCase() === you.toLowerCase()) return;
        burn(offering);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [you],
  );

  const give = (word: string) => {
    const one = word.replace(/\s+/g, " ").trim().slice(0, OFFERING_LONGEST);
    if (!one) return;
    burn({ word: one, by: you ?? "" });
    setNote(null);
    space.offerToFire(one).catch((error: unknown) => setNote(error instanceof Error ? error.message : "The fire did not take it."));
  };

  // THE SOUND: a rumble and crackle that grow as you walk up to the fire.
  useEffect(() => {
    const bed = rumble();
    const timer = setInterval(() => {
      if (Math.random() < 0.55) crackle(level.current);
      bed.set(level.current);
    }, 140);
    return () => {
      clearInterval(timer);
      bed.stop();
    };
  }, []);
  const listener = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    state.camera.getWorldPosition(listener);
    level.current = fireLevel(Math.hypot(listener.x - FIRE_AT.x, listener.z - FIRE_AT.z));
    if (light.current) {
      const t = state.clock.elapsedTime;
      light.current.intensity = 2.2 + Math.sin(t * 11) * 0.3 + Math.sin(t * 17.3) * 0.25 + burning.length * 0.6;
    }
  });

  // The sign faces where people arrive, and stands to the fire's left as they see it.
  const facing = Math.atan2(ROOM.spawn.x - FIRE_AT.x, ROOM.spawn.z - FIRE_AT.z);

  return (
    <group position={[FIRE_AT.x, 0, FIRE_AT.z]}>
      <pointLight ref={light} position={[0, 0.35, 0]} color="#ff9a4a" intensity={2.2} distance={4} decay={2} />
      {/* The ring of stones. */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32]} rotation={[a, a * 2, 0]} scale={[0.07, 0.055, 0.06]} raycast={noRaycast}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#55504a" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      {/* The logs, crossed. */}
      {[0, 1.1, 2.2].map((turn) => (
        <mesh key={turn} position={[0, 0.07, 0]} rotation={[0, turn, Math.PI / 2 - 0.25]} raycast={noRaycast}>
          <cylinderGeometry args={[0.035, 0.04, 0.42, 8]} />
          <meshStandardMaterial color="#3a2616" roughness={1} emissive="#5a1c05" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* The flames and the glowing bed under them. */}
      <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <circleGeometry args={[0.2, 24]} />
        <meshBasicMaterial color="#ff5a14" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {[0, 1, 2, 3, 4].map((index) => (
        <Flame key={index} index={index} />
      ))}
      <Sparks burning={burning} />
      {burning.map((one) => (
        <BurningWord key={one.id} burn={one} />
      ))}

      {/* THE SIGN: a few words to tap, or your own. */}
      <group position={[Math.sin(facing) * 0.1 - Math.cos(facing) * 0.7, 1.05, Math.cos(facing) * 0.1 + Math.sin(facing) * 0.7]} rotation={[0, facing, 0]}>
        <WristButton label="LET SOMETHING GO" y={0.2} width={0.62} height={0.08} lines={1} textSize={0.5} tone="muted" passThrough onTap={() => {}} />
        {READY_WORDS.map((word, index) => (
          <WristButton
            key={word}
            label={word}
            x={((index % 3) - 1) * 0.205}
            y={0.09 - Math.floor(index / 3) * 0.085}
            width={0.19}
            height={0.07}
            lines={1}
            textSize={0.42}
            onTap={() => give(word)}
          />
        ))}
        <WristButton label="my own word…" y={-0.17} width={0.4} height={0.07} lines={1} textSize={0.42} tone="live" onTap={() => setWriting(true)} />
        {note ? <WristButton label={note} y={-0.26} width={0.62} height={0.07} tone="muted" onTap={() => setNote(null)} /> : null}
        {writing ? (
          <Typing3D
            prompt="A word to let go of. Everyone here sees it burn; nothing is kept."
            limit={OFFERING_LONGEST}
            position={[0, -0.2, 0.3]}
            scale={1}
            onCancel={() => setWriting(false)}
            onDone={(word) => {
              setWriting(false);
              give(word);
            }}
          />
        ) : null}
      </group>
    </group>
  );
}
