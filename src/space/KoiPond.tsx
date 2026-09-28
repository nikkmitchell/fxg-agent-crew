import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";
import { goHandInput } from "./go-hand-input";
import { audio } from "./breath-sound";

/**
 * THE KOI POND: a low stone basin of dark water with koi circling slowly.
 * Hold a hand over the water and they drift over to it; touch the surface and
 * rings spread out from your finger, with a small plop.
 *
 * THE SAME FISH FOR EVERYONE: each koi swims a path worked out from the clock,
 * so two people looking at the pond see the same fish in the same place.
 * Only a fish's curiosity about a nearby hand is worked out on each device.
 */

export const POND_AT = { x: 3.5, z: 4.4, radius: 0.75, height: 0.36 } as const;
const WATER = POND_AT.height - 0.03;

/** A koi's colouring: white, red-orange and black, the classic kohaku and showa. */
const KOI = [
  { body: "#f4efe6", patch: "#e2542a", speed: 0.21, size: 1.0, phase: 0 },
  { body: "#ef7a2a", patch: "#f7e9d8", speed: 0.17, size: 0.9, phase: 1.7 },
  { body: "#f6f2ea", patch: "#1c1c1f", speed: 0.24, size: 0.8, phase: 3.1 },
  { body: "#e8a23a", patch: "#f6f2ea", speed: 0.19, size: 0.85, phase: 4.4 },
  { body: "#d8382a", patch: "#1c1c1f", speed: 0.15, size: 1.1, phase: 5.6 },
] as const;

/**
 * Where koi `index` is at `seconds`, from the pond's centre: a slow wandering
 * loop that stays well inside the rim, and the way it is heading.
 */
export function koiAt(index: number, seconds: number, radius = POND_AT.radius): { x: number; z: number; heading: number } {
  const koi = KOI[index % KOI.length];
  const t = seconds * koi.speed + koi.phase;
  const reach = radius * 0.62;
  const x = Math.sin(t) * reach * (0.75 + 0.25 * Math.sin(t * 0.37 + index));
  const z = Math.sin(t * 2 + index) * reach * 0.55 + Math.cos(t * 0.5) * reach * 0.3;
  const dt = 0.05;
  const t2 = t + dt * koi.speed;
  const x2 = Math.sin(t2) * reach * (0.75 + 0.25 * Math.sin(t2 * 0.37 + index));
  const z2 = Math.sin(t2 * 2 + index) * reach * 0.55 + Math.cos(t2 * 0.5) * reach * 0.3;
  return { x, z, heading: Math.atan2(x2 - x, z2 - z) };
}

const waterVertex = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const waterFragment = /* glsl */ `
  uniform float uTime;
  uniform vec4 uRipples[8];
  varying vec2 vLocal;
  void main() {
    vec2 p = vLocal;
    float lap = sin(p.x * 11.0 + uTime * 0.9) * 0.5 + sin(p.y * 13.0 - uTime * 0.7) * 0.5;
    float rings = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > 4.0 || r.w <= 0.0) continue;
      float d = distance(p, r.xy);
      float front = age * 0.28;
      rings += r.w * exp(-pow((d - front) * 30.0, 2.0)) * exp(-age * 0.9);
      rings += r.w * 0.5 * exp(-pow((d - front * 0.6) * 30.0, 2.0)) * exp(-age * 1.3);
    }
    vec3 deep = vec3(0.03, 0.12, 0.14);
    vec3 light = vec3(0.16, 0.34, 0.36);
    vec3 colour = mix(deep, light, 0.35 + lap * 0.08) + vec3(0.7, 0.85, 0.9) * rings * 0.6;
    gl_FragColor = vec4(colour, 0.62 + rings * 0.3);
  }
`;

function plop(level: number): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(900, at);
  osc.frequency.exponentialRampToValueAtTime(260, at + 0.12);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.08 * level, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.3);
}

/**
 * The five koi, drawn as three instanced meshes (bodies, patches, tails)
 * instead of fifteen (Nightjar's draw-call count, 2026-09-28). Each fish's
 * place and heading come from its anchor group, which KoiPond moves.
 */
function KoiSchool({ fish }: { fish: MutableRefObject<(THREE.Group | null)[]> }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const patches = useRef<THREE.InstancedMesh>(null);
  const tails = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    return {
      body: at(0, 0, 0, 0.028, 0.02, 0.075),
      patch: at(0, 0.012, 0.012, 0.02, 0.01, 0.035),
      tailBase: new THREE.Matrix4().makeTranslation(0, 0, -0.075),
      // The cone stands on its base, laid along the fish and flattened.
      tailShape: new THREE.Matrix4().makeRotationX(Math.PI / 2).multiply(at(0, 0.03, 0, 1, 1, 0.25)),
    };
  }, []);
  const wag = useMemo(() => new THREE.Matrix4(), []);
  const out = useMemo(() => new THREE.Matrix4(), []);
  useEffect(() => {
    KOI.forEach((koi, index) => {
      bodies.current?.setColorAt(index, new THREE.Color(koi.body));
      patches.current?.setColorAt(index, new THREE.Color(koi.patch));
      tails.current?.setColorAt(index, new THREE.Color(koi.body));
    });
    for (const mesh of [bodies.current, patches.current, tails.current]) if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);
  useFrame((state) => {
    KOI.forEach((_, index) => {
      const anchor = fish.current[index];
      if (!anchor) return;
      anchor.updateMatrix();
      bodies.current?.setMatrixAt(index, out.multiplyMatrices(anchor.matrix, parts.body));
      patches.current?.setMatrixAt(index, out.multiplyMatrices(anchor.matrix, parts.patch));
      wag.makeRotationY(Math.sin(state.clock.elapsedTime * 6 + index) * 0.45);
      tails.current?.setMatrixAt(index, out.copy(anchor.matrix).multiply(parts.tailBase).multiply(wag).multiply(parts.tailShape));
    });
    for (const mesh of [bodies.current, patches.current, tails.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, KOI.length]} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={patches} args={[undefined, undefined, KOI.length]} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={tails} args={[undefined, undefined, KOI.length]} raycast={() => null} frustumCulled={false}>
        <coneGeometry args={[0.028, 0.06, 8]} />
        <meshStandardMaterial roughness={0.5} transparent opacity={0.9} />
      </instancedMesh>
    </>
  );
}

export function KoiPond({ peopleRef }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null } }) {
  const fish = useRef<(THREE.Group | null)[]>([]);
  const curiosity = useRef(KOI.map(() => ({ x: 0, z: 0 })));
  const ripples = useMemo(() => Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)), []);
  const nextRipple = useRef(0);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: waterVertex,
        fragmentShader: waterFragment,
        uniforms: { uTime: { value: 0 }, uRipples: { value: ripples } },
        transparent: true,
        depthWrite: false,
      }),
    [ripples],
  );
  useEffect(() => () => material.dispose(), [material]);
  const touching = useRef<Record<"left" | "right", boolean>>({ left: false, right: false });

  const ripple = (x: number, z: number, strength: number, time: number) => {
    // The water plane is turned to lie flat: its local y is the pond's -z.
    ripples[nextRipple.current].set(x, -z, time, strength);
    nextRipple.current = (nextRipple.current + 1) % ripples.length;
  };

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    material.uniforms.uTime.value = time;
    const seconds = Date.now() / 1000;

    // Every hand near the water, in the pond's own coordinates.
    const hands: { x: number; y: number; z: number }[] = [];
    for (const pose of [selfPose.hands.left, selfPose.hands.right]) if (pose) hands.push(pose.p);
    for (const person of peopleRef.current ?? []) {
      if (person.hands?.left) hands.push(person.hands.left.p);
      if (person.hands?.right) hands.push(person.hands.right.p);
    }
    const near = hands
      .map((p) => ({ x: p.x - POND_AT.x, y: p.y - WATER, z: p.z - POND_AT.z }))
      .filter((p) => Math.hypot(p.x, p.z) < POND_AT.radius && p.y < 0.35 && p.y > -0.1);

    KOI.forEach((_, index) => {
      const node = fish.current[index];
      if (!node) return;
      const path = koiAt(index, seconds);
      // CURIOUS: drift toward the nearest hand over the water, and back to the path when it goes.
      let target = { x: 0, z: 0 };
      let closest = Infinity;
      for (const hand of near) {
        const d = Math.hypot(hand.x - path.x, hand.z - path.z);
        if (d < closest && d < 0.5) {
          closest = d;
          target = { x: (hand.x - path.x) * 0.85, z: (hand.z - path.z) * 0.85 };
        }
      }
      const pull = curiosity.current[index];
      const ease = Math.min(1, delta * (closest < Infinity ? 1.2 : 0.5));
      pull.x += (target.x - pull.x) * ease;
      pull.z += (target.z - pull.z) * ease;
      const x = path.x + pull.x;
      const z = path.z + pull.z;
      const heading = closest < Infinity ? Math.atan2(pull.x - node.position.x + path.x, pull.z - node.position.z + path.z) : path.heading;
      node.position.set(x, WATER - 0.05 - index * 0.006, z);
      node.rotation.y += Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y)) * Math.min(1, delta * 3);
    });

    // TOUCHING THE WATER: a fingertip reaching the surface rings it.
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      const fresh = hand && performance.now() - hand.at < 200;
      const x = fresh ? hand.contact.x - POND_AT.x : 0;
      const z = fresh ? hand.contact.z - POND_AT.z : 0;
      const wet = Boolean(fresh && Math.hypot(x, z) < POND_AT.radius - 0.03 && Math.abs(hand.contact.y - WATER) < 0.02);
      if (wet && !touching.current[side]) {
        ripple(x, z, 1, time);
        plop(1);
      }
      touching.current[side] = wet;
    }
  });

  return (
    <group position={[POND_AT.x, 0, POND_AT.z]}>
      {/* THE BASIN: a low round wall of dark stone, and its floor. */}
      <mesh position={[0, POND_AT.height / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[POND_AT.radius + 0.08, POND_AT.radius + 0.12, POND_AT.height, 48, 1, true]} />
        <meshStandardMaterial color="#4a4640" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, POND_AT.height, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[POND_AT.radius, POND_AT.radius + 0.1, 48]} />
        <meshStandardMaterial color="#5b564e" roughness={0.9} />
      </mesh>
      <mesh position={[0, WATER - 0.12, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <circleGeometry args={[POND_AT.radius, 48]} />
        <meshStandardMaterial color="#1a2a26" roughness={1} />
      </mesh>
      {/* A few smooth stones on the bottom, and a lily pad or two on top. */}
      {[[-0.3, 0.2, 0.06], [0.25, -0.35, 0.05], [0.4, 0.3, 0.04]].map(([x, z, s], i) => (
        <mesh key={i} position={[x, WATER - 0.11, z]} scale={[s, s * 0.45, s * 0.8]} raycast={() => null}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#3d4a45" roughness={0.8} />
        </mesh>
      ))}
      {[[0.45, -0.15, 0.09, 0.4], [-0.2, -0.45, 0.07, 2.2]].map(([x, z, r, turn], i) => (
        <mesh key={i} position={[x, WATER + 0.004, z]} rotation={[-Math.PI / 2, 0, turn]} raycast={() => null}>
          <circleGeometry args={[r, 20, 0.3, Math.PI * 2 - 0.3]} />
          <meshStandardMaterial color="#3f7a45" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Each koi's anchor: KoiPond moves it, KoiSchool draws the fish there. */}
      {KOI.map((koi, index) => (
        <group key={index} ref={(node) => { fish.current[index] = node; }} scale={koi.size * 1.45} />
      ))}
      <KoiSchool fish={fish} />
      {/* THE WATER: a ray or a click on it rings it too. */}
      <mesh
        position={[0, WATER, 0]}
        rotation-x={-Math.PI / 2}
        material={material}
        onClick={(event) => {
          event.stopPropagation();
          ripple(event.point.x - POND_AT.x, event.point.z - POND_AT.z, 0.8, material.uniforms.uTime.value);
          plop(0.7);
        }}
      >
        <circleGeometry args={[POND_AT.radius, 64]} />
      </mesh>
    </group>
  );
}
