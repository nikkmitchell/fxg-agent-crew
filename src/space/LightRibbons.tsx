import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";

/**
 * LIGHT RIBBONS: a glowing circle on the floor, back-right of the room. Step
 * inside and your hands leave soft ribbons of light that fade over a few
 * seconds, for slow tai-chi and qigong movement: you can see the shape your
 * hands have drawn in the air, and slowing down makes it smoother.
 *
 * EVERYONE'S HANDS, not only yours: the room already shares where each
 * person's hands are, so two people moving in the circle together each see
 * both ribbons. Each person's colour comes from their name, so it is theirs
 * every time. Nothing new is sent or stored.
 */

export const RIBBONS_AT = { x: 2.7, z: 2.3, radius: 1.3 } as const;
/** How long a ribbon lasts. */
const FADE_SECONDS = 6;
/** How often a point is added: often enough to be smooth at a slow pace. */
const SAMPLE_MS = 33;
const MAX_POINTS = Math.ceil((FADE_SECONDS * 1000) / SAMPLE_MS) + 2;
/** How wide the ribbon is, in metres. */
const WIDTH = 0.05;

/** A colour from a name: the same person is always the same hue. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 360) / 360;
}

/** Whether a point on the floor plan is inside the circle. */
export function inCircle(x: number, z: number): boolean {
  return Math.hypot(x - RIBBONS_AT.x, z - RIBBONS_AT.z) <= RIBBONS_AT.radius;
}

type Trail = { points: { x: number; y: number; z: number; at: number }[]; colour: THREE.Color; mesh: THREE.Mesh };

function makeTrailMesh(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
  const index: number[] = [];
  for (let i = 0; i < MAX_POINTS - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

export function LightRibbons({ peopleRef, you }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null }) {
  const group = useRef<THREE.Group>(null);
  const trails = useRef(new Map<string, Trail>());
  const lastSample = useRef(0);
  const ring = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(
    () => () => {
      for (const trail of trails.current.values()) {
        trail.mesh.geometry.dispose();
        (trail.mesh.material as THREE.Material).dispose();
      }
      trails.current.clear();
    },
    [],
  );

  const trailFor = (key: string, name: string): Trail => {
    let trail = trails.current.get(key);
    if (!trail) {
      const colour = new THREE.Color().setHSL(hueOf(name) + (key.endsWith(":right") ? 0.18 : 0), 0.85, 0.6);
      trail = { points: [], colour, mesh: makeTrailMesh() };
      trails.current.set(key, trail);
      group.current?.add(trail.mesh);
    }
    return trail;
  };

  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const side = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const now = performance.now();
    if (ring.current) ring.current.opacity = 0.35 + Math.sin(state.clock.elapsedTime * 0.8) * 0.12;

    // SAMPLE every hand that is inside the circle.
    if (now - lastSample.current >= SAMPLE_MS) {
      lastSample.current = now;
      const hands: { key: string; name: string; p: { x: number; y: number; z: number } }[] = [];
      if (you) {
        if (selfPose.hands.left) hands.push({ key: `${you}:left`, name: you, p: selfPose.hands.left.p });
        if (selfPose.hands.right) hands.push({ key: `${you}:right`, name: you, p: selfPose.hands.right.p });
      }
      for (const person of peopleRef.current ?? []) {
        if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
        if (person.hands?.left) hands.push({ key: `${person.actorId}:left`, name: person.actorId, p: person.hands.left.p });
        if (person.hands?.right) hands.push({ key: `${person.actorId}:right`, name: person.actorId, p: person.hands.right.p });
      }
      for (const hand of hands) {
        if (!inCircle(hand.p.x, hand.p.z)) continue;
        const trail = trailFor(hand.key, hand.name);
        const last = trail.points[trail.points.length - 1];
        // A hand held still adds nothing: the ribbon is a record of movement.
        if (last && Math.hypot(last.x - hand.p.x, last.y - hand.p.y, last.z - hand.p.z) < 0.004) continue;
        trail.points.push({ x: hand.p.x, y: hand.p.y, z: hand.p.z, at: now });
        if (trail.points.length > MAX_POINTS) trail.points.shift();
      }
    }

    // DRAW each ribbon: a flat strip along the path, turned to lie across the
    // direction of travel, fading from the hand back to nothing.
    for (const [key, trail] of trails.current) {
      while (trail.points.length && now - trail.points[0].at > FADE_SECONDS * 1000) trail.points.shift();
      const geometry = trail.mesh.geometry;
      const count = trail.points.length;
      if (count < 2) {
        geometry.setDrawRange(0, 0);
        if (count === 0) {
          group.current?.remove(trail.mesh);
          trail.mesh.geometry.dispose();
          (trail.mesh.material as THREE.Material).dispose();
          trails.current.delete(key);
        }
        continue;
      }
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
      for (let i = 0; i < count; i += 1) {
        const point = trail.points[i];
        const next = trail.points[Math.min(count - 1, i + 1)];
        const previous = trail.points[Math.max(0, i - 1)];
        direction.set(next.x - previous.x, next.y - previous.y, next.z - previous.z);
        side.crossVectors(direction, up);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        side.normalize().multiplyScalar(WIDTH / 2);
        // The newest end is brightest; it fades with age and tapers at the tail.
        const life = 1 - (now - point.at) / (FADE_SECONDS * 1000);
        const glow = Math.max(0, life) ** 1.5;
        const taper = Math.min(1, i / 6) * (0.4 + 0.6 * glow);
        position.setXYZ(i * 2, point.x - side.x * taper, point.y - side.y * taper, point.z - side.z * taper);
        position.setXYZ(i * 2 + 1, point.x + side.x * taper, point.y + side.y * taper, point.z + side.z * taper);
        colour.setXYZ(i * 2, trail.colour.r * glow, trail.colour.g * glow, trail.colour.b * glow);
        colour.setXYZ(i * 2 + 1, trail.colour.r * glow, trail.colour.g * glow, trail.colour.b * glow);
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
      geometry.setDrawRange(0, (count - 1) * 6);
    }
  });

  return (
    <group>
      {/* THE CIRCLE on the floor: step in to draw. */}
      <mesh position={[RIBBONS_AT.x, 0.012, RIBBONS_AT.z]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[RIBBONS_AT.radius - 0.04, RIBBONS_AT.radius, 96]} />
        <meshBasicMaterial ref={ring} color="#9fd8ff" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[RIBBONS_AT.x, 0.01, RIBBONS_AT.z]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[RIBBONS_AT.radius, 96]} />
        <meshBasicMaterial color="#5aa0ff" transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={group} />
    </group>
  );
}
