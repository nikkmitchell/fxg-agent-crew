import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { breathAt, type Meditation } from "../../shared/meditation";

/**
 * THE BREATHING SILK: a tall length of pale saffron silk hanging behind the
 * orb, as seen from where people arrive. While a session breathes, it billows
 * toward you on the in-breath and falls back on the out-breath, so the whole
 * back of the room breathes with you. Between sessions it stirs on a slow air.
 * One shader on one mesh; the same for everyone (the room's session clock).
 */

export const SILK_AT = { x: 0.4, z: -0.6 } as const;
const WIDTH = 1.6;
const HEIGHT = 2.4;

const vertex = /* glsl */ `
  uniform float uFull;
  uniform float uTime;
  varying vec2 vUv;
  varying float vBillow;
  void main() {
    vUv = uv;
    // Held at the top rail; free below. The belly of the billow is low and centred.
    float hang = 1.0 - uv.y;
    float belly = sin(uv.x * 3.14159) * pow(hang, 0.8);
    float ripple = sin(uv.x * 7.0 + uTime * 0.9) * 0.02 + sin(uv.y * 9.0 - uTime * 0.7) * 0.015;
    float billow = belly * (0.05 + uFull * 0.28) + ripple * hang;
    vBillow = billow;
    vec3 p = position + vec3(0.0, 0.0, billow);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const fragment = /* glsl */ `
  varying vec2 vUv;
  varying float vBillow;
  void main() {
    vec3 silk = vec3(0.96, 0.78, 0.46);
    // Light catches the fold toward you; the hem and edges fade.
    float sheen = 0.75 + vBillow * 1.6;
    float edge = smoothstep(0.0, 0.05, vUv.x) * (1.0 - smoothstep(0.95, 1.0, vUv.x)) * smoothstep(0.0, 0.06, vUv.y);
    gl_FragColor = vec4(silk * sheen, 0.5 * edge);
  }
`;

export function BreathingSilk({ meditation }: { meditation: Meditation | null }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uFull: { value: 0.3 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    const now = meditation ? breathAt(meditation, Date.now()) : { state: "idle" as const };
    const target = now.state === "breathing" ? now.fullness : 0.25 + Math.sin(state.clock.elapsedTime * 0.3) * 0.12;
    material.uniforms.uFull.value += (target - material.uniforms.uFull.value) * Math.min(1, delta * 2.5);
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  const facing = Math.atan2(0 - SILK_AT.x, 6.2 - SILK_AT.z);
  return (
    <group position={[SILK_AT.x, 0, SILK_AT.z]} rotation-y={facing}>
      <mesh position={[0, 0.25 + HEIGHT / 2, 0]} material={material} raycast={() => null}>
        <planeGeometry args={[WIDTH, HEIGHT, 24, 32]} />
      </mesh>
      {/* The rail it hangs from. */}
      <mesh position={[0, 0.25 + HEIGHT + 0.02, 0]} rotation-z={Math.PI / 2} raycast={() => null}>
        <cylinderGeometry args={[0.015, 0.015, WIDTH + 0.2, 8]} />
        <meshStandardMaterial color="#4a3526" roughness={0.8} />
      </mesh>
    </group>
  );
}
