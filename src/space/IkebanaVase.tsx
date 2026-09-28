import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

/** Paint every vertex of `geometry` one colour, for a merged, vertex-coloured mesh. */
function painted(geometry: THREE.BufferGeometry, colour: string): THREE.BufferGeometry {
  const c = new THREE.Color(colour);
  const count = geometry.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  // Merging needs the same attributes everywhere: keep position, normal, colour.
  for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "color"].includes(name)) geometry.deleteAttribute(name);
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

/** One stem and its bloom: the stem, six petals and the centre, placed and painted. */
export function bloomParts(stem: Stem): THREE.BufferGeometry[] {
  const flower = FLOWERS[stem.flower];
  const start = new THREE.Vector3(0, 0, 0);
  const end = new THREE.Vector3(stem.x, stem.y, stem.z);
  const middle = start.clone().lerp(end, 0.5).add(new THREE.Vector3(stem.x * 0.25, 0.04, stem.z * 0.25));
  const parts = [painted(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, middle, end]), 16, 0.004, 5, false), "#4f6b34")];
  const facing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().normalize());
  const bloom = new THREE.Matrix4().compose(end, facing, new THREE.Vector3(1, 1, 1));
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.SphereGeometry(1, 10, 8);
    petal.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * 0.022, 0.004, Math.sin(a) * 0.022),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0.5)),
        new THREE.Vector3(0.024, 0.006, 0.014),
      ),
    );
    parts.push(painted(petal.applyMatrix4(bloom), flower.colour));
  }
  const centre = new THREE.SphereGeometry(0.009, 10, 8).translate(0, 0.008, 0).applyMatrix4(bloom);
  parts.push(painted(centre, flower.centre));
  return parts;
}

/**
 * THE WHOLE ARRANGEMENT AS ONE DRAW. It was a mesh per petal (a hundred draws
 * for twelve stems, Sill's check 5594), then three per stem (36); now every
 * stem, petal and centre is merged into one vertex-coloured mesh.
 */
function Arrangement({ stems }: { stems: Stem[] }) {
  const geometry = useMemo(() => {
    if (stems.length === 0) return null;
    const parts = stems.flatMap(bloomParts);
    const merged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    return merged;
  }, [stems]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial vertexColors roughness={0.65} />
    </mesh>
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
        <Arrangement stems={vase.stems} />
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
