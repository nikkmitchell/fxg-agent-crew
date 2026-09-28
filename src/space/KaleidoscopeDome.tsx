import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { breathAt, type Meditation } from "../../shared/meditation";
import { audio } from "./breath-sound";
import type { WirePerson } from "../../shared/space-wire";

/**
 * THE KALEIDOSCOPE DOME: for the trippy end of the room (baiwei, 5489: "Run a
 * whole spectrum of experiences, from calming to trippy").
 *
 * From outside it is a soft glowing ball, three metres across, with light
 * moving under its skin. Walk into it and the whole inside is a slowly turning
 * eight-fold mandala of colour, drifting through the hues, with a low pad of
 * sound only you hear. While the orb runs a session it BREATHES with it: the
 * pattern opens and brightens on the in-breath and settles on the out.
 *
 * Nothing is sent or stored: it is the same for everyone because it is drawn
 * from the same clock, and each person hears only their own pad.
 */

export const DOME_AT = { x: -2.8, z: 2.2, radius: 1.5 } as const;

const vertex = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vDir = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uBreath;
  uniform float uInside;
  uniform float uTogether;
  varying vec3 vDir;
  varying vec3 vNormal;
  varying vec3 vView;

  // A jewel palette: violet, rose, gold, teal, turning slowly through them.
  vec3 palette(float t) {
    return vec3(0.5, 0.4, 0.6) + vec3(0.5, 0.4, 0.4) * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  }

  void main() {
    // Round the dome from its crown, folded into twelve mirrored slices.
    float a = atan(vDir.z, vDir.x) + uTime * 0.04;
    float slice = 6.2831853 / 12.0;
    a = abs(mod(a, slice) - slice * 0.5);
    float r = acos(clamp(vDir.y, -1.0, 1.0)) * (1.0 + uBreath * 0.25);
    float t = uTime * 0.25;

    // Rings rippling out from the crown, petals across them, and fine lace.
    float rings = sin(r * 10.0 - t * 3.0 + sin(a * 12.0) * 1.2);
    float petals = sin(r * 23.0 + a * 36.0 - t * 2.0);
    float lace = cos(a * 48.0 + r * 6.0 + t);
    float m = rings * 0.5 + petals * 0.3 + lace * 0.2;
    float line = smoothstep(0.82, 1.0, abs(rings)) + smoothstep(0.9, 1.0, abs(petals)) * 0.6;

    vec3 colour = palette(r * 0.15 + m * 0.18 + uTime * 0.02);
    colour *= 0.22 + 0.45 * (m * 0.5 + 0.5) + uBreath * 0.2;
    colour += line * vec3(1.0, 0.85, 0.6) * (0.35 + uBreath * 0.25);

    // TOGETHER (Lumenfold, 5552): with two or more inside, a second mandala
    // turns the other way, and where the two patterns meet a gold rosette
    // blooms. Nobody has to match anyone's breath for it.
    if (uTogether > 0.001) {
      float b = atan(vDir.z, vDir.x) - uTime * 0.05;
      float slice2 = 6.2831853 / 8.0;
      b = abs(mod(b, slice2) - slice2 * 0.5);
      float second = sin(r * 13.0 + t * 2.4 + sin(b * 8.0) * 1.5);
      float rosette = smoothstep(0.7, 1.0, rings * second) + smoothstep(0.85, 1.0, abs(second)) * 0.25;
      colour += vec3(1.0, 0.78, 0.35) * rosette * uTogether * 0.8;
    }

    if (gl_FrontFacing && uInside < 0.5) {
      // Seen from OUTSIDE: a glowing skin, brighter at the edge.
      float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.2);
      gl_FragColor = vec4(colour * 1.4 + vec3(0.25, 0.2, 0.4) * rim, 0.25 + rim * 0.6);
    } else {
      gl_FragColor = vec4(colour, uInside > 0.5 ? 0.94 : 0.0);
    }
  }
`;

/** A low pad only the person inside hears: two slightly detuned tones and a fifth. */
function startPad(): { set: (level: number) => void; stop: () => void } {
  const ctx = audio();
  if (!ctx) return { set: () => {}, stop: () => {} };
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.connect(gain).connect(ctx.destination);
  const oscillators = [110, 110.6, 164.8, 220.3].map((frequency, index) => {
    const osc = ctx.createOscillator();
    osc.type = index < 2 ? "sawtooth" : "triangle";
    osc.frequency.value = frequency;
    const level = ctx.createGain();
    level.gain.value = index < 2 ? 0.15 : 0.25;
    osc.connect(level).connect(filter);
    osc.start();
    return osc;
  });
  return {
    set: (level) => gain.gain.setTargetAtTime(level * 0.08, ctx.currentTime, 0.8),
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => oscillators.forEach((osc) => osc.stop()), 1500);
    },
  };
}

export function domeVisualState(seconds: number, fullness: number, breathing: boolean, reducedMotion = false): { time: number; breath: number } {
  if (reducedMotion) return { time: 0, breath: 0.5 };
  return { time: seconds, breath: breathing ? fullness : 0.5 + Math.sin(seconds * 0.35) * 0.2 };
}

export function KaleidoscopeDome({ meditation, peopleRef, you, reducedMotion = false }: { meditation: Meditation | null; peopleRef?: { current: WirePerson[] | null }; you?: string | null; reducedMotion?: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uTime: { value: 0 }, uBreath: { value: 0 }, uInside: { value: 0 }, uTogether: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const pad = useRef<ReturnType<typeof startPad> | null>(null);
  useEffect(() => () => pad.current?.stop(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const mesh = useRef<THREE.Mesh>(null);
  const breath = useRef(0);

  useFrame((state, delta) => {
    const seconds = state.clock.elapsedTime;
    const now = meditation ? breathAt(meditation, Date.now()) : { state: "idle" as const };
    const visual = domeVisualState(seconds, now.state === "breathing" ? now.fullness : 0.5, now.state === "breathing", reducedMotion);
    material.uniforms.uTime.value = visual.time;
    if (reducedMotion) breath.current = visual.breath;
    else breath.current += (visual.breath - breath.current) * Math.min(1, delta * 3);
    material.uniforms.uBreath.value = breath.current;

    state.camera.getWorldPosition(eye);
    mesh.current?.getWorldPosition(centre);
    const inside = eye.distanceTo(centre) < DOME_AT.radius - 0.1;
    material.uniforms.uInside.value = inside ? 1 : 0;
    // How many are inside: me, and anyone else standing within the dome.
    let together = inside ? 1 : 0;
    for (const person of peopleRef?.current ?? []) {
      if (you && person.actorId.toLowerCase() === you.toLowerCase()) continue;
      if (Math.hypot(person.at.x - centre.x, person.at.z - centre.z) < DOME_AT.radius - 0.1) together += 1;
    }
    const shared = together >= 2 ? 1 : 0;
    if (reducedMotion) material.uniforms.uTogether.value = shared;
    else material.uniforms.uTogether.value += (shared - material.uniforms.uTogether.value) * Math.min(1, delta * 0.8);
    if (inside && !pad.current) pad.current = startPad();
    pad.current?.set(inside ? 0.6 + breath.current * 0.4 : 0);
  });

  return (
    <mesh ref={mesh} position={[DOME_AT.x, 1.2, DOME_AT.z]} material={material} raycast={() => null} renderOrder={-1}>
      <sphereGeometry args={[DOME_AT.radius, 64, 48]} />
    </mesh>
  );
}
