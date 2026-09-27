import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type ThreeEvent } from "@react-three/fiber";
import { FLOWERS, REACH, applyVaseEvent, emptyVase, type Stem, type Vase } from "../../shared/ikebana";
import { onVaseChange } from "./vase-events";
import { WristButton } from "./Backdrop";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * IKEBANA (shared/ikebana.ts): a low table with a dark ceramic vase and a
 * basket of five flowers, front-right of the labyrinth. Tap a flower in the
 * basket, then point and pinch where its bloom should be above the vase: a
 * stem grows from the vase to there, for everyone, and stays. Tap the vase
 * twice to empty it.
 */

export const VASE_AT = { x: 1.9, z: 7.9, table: 0.55 } as const;
const MOUTH = VASE_AT.table + 0.2;

function Bloom({ stem }: { stem: Stem }) {
  const flower = FLOWERS[stem.flower];
  const geometry = useMemo(() => {
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(stem.x, stem.y, stem.z);
    const middle = start.clone().lerp(end, 0.5).add(new THREE.Vector3(stem.x * 0.25, 0.04, stem.z * 0.25));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, middle, end]), 16, 0.004, 5, false);
  }, [stem]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const facing = useMemo(() => {
    const up = new THREE.Vector3(stem.x, stem.y, stem.z).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  }, [stem]);
  return (
    <group>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial color="#4f6b34" roughness={0.8} />
      </mesh>
      <group position={[stem.x, stem.y, stem.z]} quaternion={facing}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.022, 0.004, Math.sin(a) * 0.022]} rotation={[0, -a, 0.5]} scale={[0.024, 0.006, 0.014]} raycast={() => null}>
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial color={flower.colour} roughness={0.6} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.008, 0]} raycast={() => null}>
          <sphereGeometry args={[0.009, 10, 8]} />
          <meshStandardMaterial color={flower.centre} roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

export function IkebanaVase() {
  const [vase, setVase] = useState<Vase>(emptyVase);
  const current = useRef(vase);
  current.current = vase;
  const [chosen, setChosen] = useState<number | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(() => {
    space.vase().then((answer) => {
      current.current = answer.vase;
      setVase(answer.vase);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onVaseChange((event) => {
        const next = applyVaseEvent(current.current, event);
        if (next) {
          current.current = next;
          setVase(next);
        } else read();
      }),
    [read],
  );
  useEffect(() => {
    if (!confirmEmpty) return;
    const timer = setTimeout(() => setConfirmEmpty(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmEmpty]);

  const vaseShape = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.001, 0),
          new THREE.Vector2(0.09, 0),
          new THREE.Vector2(0.11, 0.05),
          new THREE.Vector2(0.1, 0.13),
          new THREE.Vector2(0.06, 0.18),
          new THREE.Vector2(0.05, 0.2),
          new THREE.Vector2(0.045, 0.2),
          new THREE.Vector2(0.045, 0.12),
        ],
        32,
      ),
    [],
  );
  useEffect(() => () => vaseShape.dispose(), [vaseShape]);

  const place = (event: ThreeEvent<MouseEvent>) => {
    if (chosen === null) return;
    event.stopPropagation();
    const x = event.point.x - VASE_AT.x;
    const y = event.point.y - MOUTH;
    const z = event.point.z - VASE_AT.z;
    setNote(null);
    space.changeVase({ action: "place", flower: chosen, x, y, z }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "It would not stand there."));
  };

  const facing = Math.atan2(ROOM.spawn.x - VASE_AT.x, ROOM.spawn.z - VASE_AT.z);

  return (
    <group position={[VASE_AT.x, 0, VASE_AT.z]}>
      {/* The low table. */}
      <mesh position={[0, VASE_AT.table - 0.02, 0]} raycast={() => null}>
        <boxGeometry args={[0.8, 0.04, 0.5]} />
        <meshStandardMaterial color="#3a2a1d" roughness={0.7} />
      </mesh>
      {[[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, (VASE_AT.table - 0.04) / 2, z]} raycast={() => null}>
          <boxGeometry args={[0.04, VASE_AT.table - 0.04, 0.04]} />
          <meshStandardMaterial color="#2b1d14" roughness={0.8} />
        </mesh>
      ))}
      {/* The vase: tap twice to empty it. */}
      <mesh
        geometry={vaseShape}
        position={[0, VASE_AT.table, 0]}
        onClick={(event) => {
          event.stopPropagation();
          if (!confirmEmpty) {
            setConfirmEmpty(true);
            return;
          }
          setConfirmEmpty(false);
          space.changeVase({ action: "empty" }).catch(() => {});
        }}
      >
        <meshStandardMaterial color="#1f2a2e" roughness={0.35} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>
      {/* The arrangement. */}
      <group position={[0, MOUTH, 0]}>
        {vase.stems.map((stem, index) => (
          <Bloom key={`${index}-${stem.x}-${stem.y}`} stem={stem} />
        ))}
        {/* Where a bloom can go: seen faintly once you have chosen a flower. */}
        <mesh onClick={place} visible={chosen !== null}>
          <sphereGeometry args={[REACH * 0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.05} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group rotation={[0, facing, 0]}>
        {/* THE BASKET: a flower of each kind; tap one to choose it. */}
        {FLOWERS.map((flower, index) => (
          <group key={flower.name} position={[-0.3 + index * 0.07, VASE_AT.table + (index === chosen ? 0.04 : 0.02), 0.17]}>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                setChosen(index === chosen ? null : index);
              }}
            >
              <sphereGeometry args={[0.025, 12, 8]} />
              <meshStandardMaterial color={flower.colour} roughness={0.6} emissive={index === chosen ? flower.colour : "#000000"} emissiveIntensity={index === chosen ? 0.3 : 0} />
            </mesh>
          </group>
        ))}
        <group position={[0, VASE_AT.table + 0.9, 0]}>
          <WristButton
            label={
              confirmEmpty
                ? "Tap the vase again to empty it"
                : note ?? (chosen === null ? "IKEBANA · choose a flower, then point above the vase" : `${FLOWERS[chosen].name} · point where it should bloom`)
            }
            y={0}
            width={0.72}
            height={0.075}
            lines={1}
            textSize={0.36}
            tone="muted"
            passThrough
            onTap={() => {}}
          />
        </group>
      </group>
    </group>
  );
}
