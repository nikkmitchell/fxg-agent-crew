import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { afloat, boatAt, type Boat } from "../../shared/boats";
import { onBoat } from "./boat-events";
import { POND_AT } from "./KoiPond";
import { WristButton } from "./Backdrop";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";
import { displayMotionTime, freezeMotionTime } from "./ambient-motion";

/**
 * PAPER BOATS (shared/boats.ts) on the koi pond: a small sign at the pond's
 * edge, "float a paper boat". Tap it and a white folded boat drifts slowly
 * round the water among the koi, bobbing, for everyone, until it softens and
 * sinks some minutes later.
 */

const WATER = POND_AT.height - 0.03;

/** A folded paper boat: a hull and a sail, merged into one small shape. */
function boatGeometry(): THREE.BufferGeometry {
  const s = 0.05;
  const vertices = new Float32Array([
    // hull: two slanted sides meeting at a keel line
    -s, 0.012, -s * 0.35, s, 0.012, -s * 0.35, s * 0.6, -0.005, 0, -s, 0.012, -s * 0.35, s * 0.6, -0.005, 0, -s * 0.6, -0.005, 0,
    -s, 0.012, s * 0.35, -s * 0.6, -0.005, 0, s * 0.6, -0.005, 0, -s, 0.012, s * 0.35, s * 0.6, -0.005, 0, s, 0.012, s * 0.35,
    // sail: a tall triangle across the middle
    -s * 0.55, 0.012, 0, s * 0.55, 0.012, 0, 0, 0.065, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function PaperBoats({ reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  const [boats, setBoats] = useState<Boat[]>([]);
  const offset = useRef(0);
  const nodes = useRef(new Map<string, THREE.Mesh>());
  const frozenAges = useRef(new Map<string, number>());
  const geometry = useMemo(boatGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    space.boats().then((answer) => {
      offset.current = answer.now - Date.now();
      setBoats(answer.boats);
    }).catch(() => {});
  }, []);
  useEffect(
    () =>
      onBoat((boat) => setBoats((all) => (all.some((one) => one.id === boat.id) ? all : afloat([...all, boat], Date.now() + offset.current)))),
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => setBoats((all) => afloat(all, Date.now() + offset.current)), 30_000);
    return () => clearInterval(timer);
  }, []);

  useFrame((state) => {
    const now = Date.now() + offset.current;
    const active = new Set(boats.map((boat) => boat.id));
    for (const id of frozenAges.current.keys()) if (!active.has(id)) frozenAges.current.delete(id);
    for (const boat of boats) {
      const node = nodes.current.get(boat.id);
      if (!node) continue;
      const age = (now - boat.at) / 1000;
      const frozenAge = freezeMotionTime(age, frozenAges.current.get(boat.id) ?? null, reducedMotion);
      if (frozenAge === null) frozenAges.current.delete(boat.id);
      else frozenAges.current.set(boat.id, frozenAge);
      const shownAge = displayMotionTime(age, frozenAges.current.get(boat.id) ?? null, reducedMotion);
      const at = boatAt(boat.seed, shownAge);
      const bob = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.6 + boat.seed * 10) * 0.003;
      node.position.set(POND_AT.x + at.x * POND_AT.radius, WATER + bob - at.sink * 0.03, POND_AT.z + at.z * POND_AT.radius);
      node.rotation.set(reducedMotion ? 0 : Math.sin(state.clock.elapsedTime + boat.seed) * 0.06, at.heading + Math.PI / 2, 0);
    }
  });

  const float = () => {
    space.floatBoat().then((answer) => {
      offset.current = answer.now - Date.now();
      setBoats((all) => (all.some((one) => one.id === answer.boat.id) ? all : [...all, answer.boat]));
    }).catch(() => {});
  };

  // The sign stands at the pond's edge nearest where people arrive.
  const toward = Math.atan2(ROOM.spawn.x - POND_AT.x, ROOM.spawn.z - POND_AT.z);
  const signAt = { x: POND_AT.x + Math.sin(toward) * (POND_AT.radius + 0.25), z: POND_AT.z + Math.cos(toward) * (POND_AT.radius + 0.25) };

  return (
    <group>
      {boats.map((boat) => (
        <mesh
          key={boat.id}
          ref={(node) => {
            if (node) nodes.current.set(boat.id, node);
            else nodes.current.delete(boat.id);
          }}
          geometry={geometry}
          raycast={() => null}
        >
          <meshStandardMaterial color="#f3efe6" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <group position={[signAt.x, 0.95, signAt.z]} rotation={[0, toward, 0]}>
        <WristButton label="float a paper boat" y={0} width={0.4} height={0.07} lines={1} textSize={0.42} tone="live" onTap={float} />
      </group>
    </group>
  );
}
