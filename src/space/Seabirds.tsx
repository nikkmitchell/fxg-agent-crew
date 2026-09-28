import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { audio } from "./breath-sound";
import { SHORE_AT } from "./Shore";

/**
 * SEABIRDS over the shore: three pale birds gliding in slow, wide circles high
 * above the sand, wings beating now and then and holding still between, like
 * gulls riding the wind. Now and again one calls, faint and far, if you are
 * near the shore. On the clock: the same birds for everyone.
 */

const BIRDS = 3;
const HEIGHT = 3.2;

/** Where bird `index` is at `seconds`, and how its wings are. */
export function birdAt(index: number, seconds: number, reducedMotion = false): { x: number; y: number; z: number; heading: number; flap: number } {
  if (reducedMotion) seconds = 0;
  const speed = 0.12 + index * 0.025;
  const radius = 1.4 + index * 0.5;
  const angle = seconds * speed + index * 2.1;
  // Beat for a couple of seconds, then glide for several.
  const beating = Math.sin(seconds * 0.5 + index * 1.7) > 0.55;
  return {
    x: SHORE_AT.x + 1.2 + Math.cos(angle) * radius,
    y: HEIGHT + index * 0.35 + Math.sin(seconds * 0.3 + index) * 0.2,
    z: SHORE_AT.z - 0.8 + Math.sin(angle) * radius * 0.7,
    heading: -angle,
    flap: beating ? Math.sin(seconds * 9 + index) * 0.6 : 0.12,
  };
}

/** A gull's call: two short falling cries, far away. */
function cry(level: number): void {
  const ctx = audio();
  if (!ctx || level <= 0) return;
  for (let i = 0; i < 2; i += 1) {
    const start = ctx.currentTime + i * 0.32;
    const tone = ctx.createOscillator();
    tone.type = "triangle";
    tone.frequency.setValueAtTime(1500, start);
    tone.frequency.exponentialRampToValueAtTime(900, start + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.025 * level, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 2200;
    tone.connect(far).connect(gain).connect(ctx.destination);
    tone.start(start);
    tone.stop(start + 0.3);
  }
}

export function Seabirds({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const birds = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Mesh | null)[]>([]);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const lastCry = useRef(0);
  const shape = useMemo(() => {
    // One wing: a long, thin, swept triangle.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.03, 0, 0, 0.04, 0.32, 0, -0.05], 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);
  useEffect(() => () => shape.dispose(), [shape]);

  useFrame((state) => {
    const seconds = Date.now() / 1000;
    for (let i = 0; i < BIRDS; i += 1) {
      const bird = birdAt(i, seconds, reducedMotion);
      const node = birds.current[i];
      if (node) {
        node.position.set(bird.x, bird.y, bird.z);
        node.rotation.set(0, bird.heading, 0.15);
      }
      const left = wings.current[i * 2];
      const right = wings.current[i * 2 + 1];
      if (left) left.rotation.z = Math.PI - bird.flap;
      if (right) right.rotation.z = bird.flap;
    }
    // A call about every half minute, heard only near the shore.
    state.camera.getWorldPosition(eye);
    const level = Math.max(0, 1 - Math.hypot(eye.x - SHORE_AT.x, eye.z - SHORE_AT.z) / 5);
    const slot = Math.floor(seconds / 29);
    if (slot !== lastCry.current) {
      if (lastCry.current !== 0) cry(level);
      lastCry.current = slot;
    }
  });

  return (
    <group>
      {Array.from({ length: BIRDS }, (_, i) => (
        <group key={i} ref={(node) => { birds.current[i] = node; }}>
          <mesh scale={[0.05, 0.03, 0.14]} raycast={() => null}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color="#e9eef0" />
          </mesh>
          {[0, 1].map((side) => (
            <mesh key={side} ref={(mesh) => { wings.current[i * 2 + side] = mesh; }} geometry={shape} raycast={() => null}>
              <meshBasicMaterial color={side ? "#dfe6ea" : "#d4dde2"} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
