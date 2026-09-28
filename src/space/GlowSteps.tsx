import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { SHORE_AT } from "./Shore";

/**
 * GLOWING STEPS on the shore sand, like plankton lighting up at night: wherever
 * anyone walks on the strip of sand, a soft blue-green print glows under them
 * and fades over a dozen seconds. Worked out on each device from where people
 * already are (shared positions); nothing is sent.
 */

const COUNT = 80;
const FADE_MS = 12_000;
const STRIDE = 0.3;

/** Is the floor point (x, z) on the shore's sand, with a small margin? */
export function onSand(x: number, z: number): boolean {
  return Math.abs(x - SHORE_AT.x) < SHORE_AT.width / 2 - 0.05 && Math.abs(z - SHORE_AT.z) < SHORE_AT.depth / 2 - 0.05;
}

/** How bright a print is `ms` after it was made: bright at once, then slowly out. */
export function stepGlow(ms: number): number {
  return ms < 0 || ms > FADE_MS ? 0 : (1 - ms / FADE_MS) ** 1.6;
}

type Print = { x: number; z: number; at: number; turn: number };

export function GlowSteps({ peopleRef, you }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const prints = useRef<Print[]>([]);
  const last = useRef(new Map<string, { x: number; z: number; foot: number }>());
  const eye = useMemo(() => new THREE.Vector3(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Euler(), []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const glow = useMemo(() => new THREE.Color("#3fffe0").multiplyScalar(0.9), []);

  useFrame((state) => {
    const node = mesh.current;
    if (!node) return;
    const now = performance.now();
    state.camera.getWorldPosition(eye);
    const walkers: { id: string; x: number; z: number }[] = [{ id: "me", x: eye.x, z: eye.z }];
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      walkers.push({ id: person.actorId, x: person.at.x, z: person.at.z });
    }
    for (const walker of walkers) {
      if (!onSand(walker.x, walker.z)) {
        last.current.delete(walker.id);
        continue;
      }
      const before = last.current.get(walker.id);
      if (before && Math.hypot(walker.x - before.x, walker.z - before.z) < STRIDE) continue;
      const heading = before ? Math.atan2(walker.x - before.x, walker.z - before.z) : 0;
      const foot = before ? -before.foot : 1;
      // Left, right, left: each print a little to the side of the path.
      prints.current.push({ x: walker.x + Math.cos(heading) * 0.07 * foot, z: walker.z - Math.sin(heading) * 0.07 * foot, at: now, turn: heading });
      last.current.set(walker.id, { x: walker.x, z: walker.z, foot });
    }
    prints.current = prints.current.filter((print) => now - print.at < FADE_MS).slice(-COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      const print = prints.current[i];
      const bright = print ? stepGlow(now - print.at) : 0;
      up.set(-Math.PI / 2, 0, print?.turn ?? 0);
      turn.setFromEuler(up);
      at.set(print?.x ?? 0, 0.012, print?.z ?? 0);
      size.set(0.03, 0.065, 1).multiplyScalar(bright > 0 ? 1 : 0.0001);
      matrix.compose(at, turn, size);
      node.setMatrixAt(i, matrix);
      node.setColorAt(i, colour.copy(glow).multiplyScalar(bright));
    }
    node.instanceMatrix.needsUpdate = true;
    if (node.instanceColor) node.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} raycast={() => null} frustumCulled={false} renderOrder={2}>
      <circleGeometry args={[1, 12]} />
      <meshBasicMaterial transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}
