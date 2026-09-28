import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { selfPose } from "./self-pose";
import { displayMotionTime, freezeMotionTime } from "./ambient-motion";

/**
 * THE NEBULA: a slow, swirling cloud of three thousand points of coloured
 * light, hanging at chest height back-right of the room. Walk into it; put
 * your hands in it and it streams away from them and curls back round, like
 * smoke round a hand in still air. For the trippy end of the room.
 *
 * ONE DRAW CALL: every point moves in the shader, from the clock and up to
 * eight hands (anyone's; the room already shares where hands are).
 */

export const NEBULA_AT = { x: -5.0, z: 3.5, y: 1.3, radius: 0.9 } as const;
const POINTS = 3000;
const HANDS = 8;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHands[${HANDS}];
  uniform float uSize;
  attribute vec3 seed;
  varying vec3 vColour;
  varying float vFade;

  vec3 palette(float t) {
    return vec3(0.55, 0.45, 0.7) + vec3(0.45, 0.4, 0.3) * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  }

  void main() {
    // Each point orbits the middle on its own tilted ring, at its own pace.
    float r = ${NEBULA_AT.radius.toFixed(2)} * pow(seed.x, 0.6);
    float speed = 0.08 + 0.25 * (1.0 - seed.x);
    float a = seed.y * 6.2831853 + uTime * speed;
    float tilt = (seed.z - 0.5) * 2.4;
    vec3 p = vec3(cos(a) * r, sin(a * 2.0 + seed.z * 9.0) * r * 0.35, sin(a) * r);
    p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
    p.y += sin(uTime * 0.3 + seed.y * 12.0) * 0.05;

    // Hands push the cloud away, and it curls round them.
    for (int i = 0; i < ${HANDS}; i++) {
      vec3 d = p - uHands[i];
      float dist = length(d);
      float push = exp(-dist * dist * 40.0) * 0.22;
      vec3 around = normalize(cross(d + vec3(0.0001), vec3(0.0, 1.0, 0.0)));
      p += normalize(d + vec3(0.0001)) * push + around * push * 0.8;
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + seed.z) / -mv.z;
    vColour = palette(seed.x * 0.6 + seed.y * 0.2 + uTime * 0.02);
    vFade = 0.35 + 0.65 * (1.0 - seed.x);
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColour;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float soft = (1.0 - smoothstep(0.0, 0.5, length(c)));
    gl_FragColor = vec4(vColour * soft * vFade, soft * vFade);
  }
`;

export function Nebula({ peopleRef, you, reducedMotion = false }: { peopleRef: MutableRefObject<WirePerson[] | null> | { current: WirePerson[] | null }; you: string | null; reducedMotion?: boolean }) {
  const geometry = useMemo(() => {
    const made = new THREE.BufferGeometry();
    const seeds = new Float32Array(POINTS * 3);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = Math.random();
    made.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3));
    made.setAttribute("seed", new THREE.BufferAttribute(seeds, 3));
    made.boundingSphere = new THREE.Sphere(new THREE.Vector3(), NEBULA_AT.radius * 2);
    return made;
  }, []);
  const hands = useMemo(() => Array.from({ length: HANDS }, () => new THREE.Vector3(0, -100, 0)), []);
  const frozenTime = useRef<number | null>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uTime: { value: 0 }, uHands: { value: hands }, uSize: { value: 26 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [hands],
  );
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state) => {
    frozenTime.current = freezeMotionTime(state.clock.elapsedTime, frozenTime.current, reducedMotion);
    material.uniforms.uTime.value = displayMotionTime(state.clock.elapsedTime, frozenTime.current, reducedMotion);
    const all: { x: number; y: number; z: number }[] = [];
    if (selfPose.hands.left) all.push(selfPose.hands.left.p);
    if (selfPose.hands.right) all.push(selfPose.hands.right.p);
    for (const person of peopleRef.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      if (person.hands?.left) all.push(person.hands.left.p);
      if (person.hands?.right) all.push(person.hands.right.p);
    }
    const near = all.filter((p) => Math.hypot(p.x - NEBULA_AT.x, p.y - NEBULA_AT.y, p.z - NEBULA_AT.z) < NEBULA_AT.radius + 0.4);
    hands.forEach((hand, i) => {
      const p = near[i];
      if (p) hand.set(p.x - NEBULA_AT.x, p.y - NEBULA_AT.y, p.z - NEBULA_AT.z);
      else hand.set(0, -100, 0);
    });
  });

  return <points geometry={geometry} material={material} position={[NEBULA_AT.x, NEBULA_AT.y, NEBULA_AT.z]} raycast={() => null} />;
}
