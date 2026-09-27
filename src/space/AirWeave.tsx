import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { breathAt, type Meditation } from "../../shared/meditation";
import { airWeaveLinks, type AirWeaveLink as Link } from "../../shared/air-weave";
import type { WirePerson } from "../../shared/space-wire";
import { headOf } from "./Avatar3D";
import { useDisposableList } from "./use-disposable";

type Participant = Pick<WirePerson, "actorId" | "connected">;

const SEGMENTS = 24;
const MAX_DISTANCE = 9;
const STRANDS = [
  { colour: "#b9fff1", opacity: 0.2, width: 0.012, phase: 0 },
  { colour: "#b9d9ff", opacity: 0.13, width: 0.008, phase: (Math.PI * 2) / 3 },
  { colour: "#e9c9ff", opacity: 0.1, width: 0.006, phase: (Math.PI * 4) / 3 },
] as const;

type Strand = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  positions: Float32Array;
  material: THREE.MeshBasicMaterial;
  phase: number;
  opacity: number;
  width: number;
};

function useStrands() {
  return useDisposableList<Strand>(
    () => STRANDS.map(({ colour, opacity, width, phase }) => {
      // A narrow mesh rather than WebGL line width: line widths are fixed to
      // one pixel on many headsets, but this 6–12 mm strip remains legible.
      const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
      const geometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(positions, 3);
      position.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", position);
      const indices = new Uint16Array(SEGMENTS * 6);
      for (let index = 0; index < SEGMENTS; index++) {
        const left = index * 2;
        const right = left + 1;
        const nextLeft = left + 2;
        const nextRight = left + 3;
        const offset = index * 6;
        indices.set([left, right, nextLeft, right, nextRight, nextLeft], offset);
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      const material = new THREE.MeshBasicMaterial({
        // Light only: thin, translucent silk rather than a solid object in
        // passthrough. Additive colour stays capped, never a flash.
        color: colour,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.raycast = () => undefined;
      return { mesh, positions, material, phase, opacity, width };
    }),
    ({ mesh, material }) => { mesh.geometry.dispose(); material.dispose(); },
  );
}

/**
 * One physical bridge between two connected people. Three filaments braid
 * very gently around a single arch; they swell on the shared in-breath and
 * settle on the out-breath. No hand tracking, names, scores, or stored trails.
 */
function WeaveLink({
  link,
  peopleRef,
  meditation,
  reducedMotion,
  now,
}: {
  link: Link;
  peopleRef: RefObject<WirePerson[]>;
  meditation: Meditation;
  reducedMotion: boolean;
  now: () => number;
}) {
  const strands = useStrands();
  const endpoints = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3() });

  useFrame(() => {
    const fromPerson = peopleRef.current.find((person) => person.actorId === link[0] && person.connected);
    const toPerson = peopleRef.current.find((person) => person.actorId === link[1] && person.connected);
    if (!fromPerson || !toPerson) {
      for (const strand of strands) strand.mesh.visible = false;
      return;
    }

    const fromHead = headOf(fromPerson);
    const toHead = headOf(toPerson);
    const { from, to } = endpoints.current;
    from.set(fromHead.x, fromHead.y - 0.4, fromHead.z);
    to.set(toHead.x, toHead.y - 0.4, toHead.z);

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 0.35) {
      for (const strand of strands) strand.mesh.visible = false;
      return;
    }

    const breath = breathAt(meditation, now());
    if (breath.state !== "breathing") {
      for (const strand of strands) strand.mesh.visible = false;
      return;
    }

    // Very distant pairs fade out instead of drawing a taut cable across the
    // whole room. The last metre is a smooth fade, not a threshold flicker.
    const distance = from.distanceTo(to);
    const proximity = 1 - THREE.MathUtils.smoothstep(distance, MAX_DISTANCE - 1, MAX_DISTANCE);
    if (proximity <= 0) {
      for (const strand of strands) strand.mesh.visible = false;
      return;
    }

    const fullness = reducedMotion ? 0.5 : breath.fullness;
    const phase = reducedMotion || breath.paused ? 0 : breath.elapsed * 0.55;
    const normalX = -dz / horizontal;
    const normalZ = dx / horizontal;
    const wave = 0.035 + 0.035 * fullness;
    const lift = 0.08 + 0.18 * fullness;

    for (const strand of strands) {
      strand.mesh.visible = true;
      strand.material.opacity = strand.opacity * proximity;
      for (let index = 0; index <= SEGMENTS; index++) {
        const t = index / SEGMENTS;
        const envelope = Math.sin(Math.PI * t);
        const braid = t * Math.PI * 6 + phase + strand.phase;
        const side = Math.cos(braid) * wave * envelope;
        const vertical = Math.sin(braid) * wave * envelope;
        const halfWidth = strand.width * envelope;
        const centerX = from.x + dx * t + normalX * side;
        const centerY = from.y + (to.y - from.y) * t + lift * envelope + vertical;
        const centerZ = from.z + dz * t + normalZ * side;
        const offset = index * 6;
        strand.positions[offset] = centerX + normalX * halfWidth;
        strand.positions[offset + 1] = centerY;
        strand.positions[offset + 2] = centerZ + normalZ * halfWidth;
        strand.positions[offset + 3] = centerX - normalX * halfWidth;
        strand.positions[offset + 4] = centerY;
        strand.positions[offset + 5] = centerZ - normalZ * halfWidth;
      }
      const attribute = strand.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      attribute.needsUpdate = true;
    }
  });

  return <group>
    {strands.map((strand, index) => <primitive key={index} object={strand.mesh} />)}
  </group>;
}

/**
 * A light-only, wordless bridge; absent until two live people share a breath.
 * There is no per-person respiration signal in the room, so it visualizes only
 * the shared session clock and never claims that one person is in or out of step.
 */
export function AirWeave({
  peopleRef,
  roster,
  meditation,
  reducedMotion,
  now,
}: {
  peopleRef: RefObject<WirePerson[]>;
  roster: readonly Participant[];
  meditation: Meditation;
  reducedMotion: boolean;
  now: () => number;
}) {
  const links = airWeaveLinks(roster.filter((person) => person.connected).map((person) => person.actorId));
  if (links.length === 0) return null;
  return <group>
    {links.map((link) => <WeaveLink key={`${link[0]}\0${link[1]}`} link={link} peopleRef={peopleRef}
      meditation={meditation} reducedMotion={reducedMotion} now={now} />)}
  </group>;
}
