import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { spinAfter, type WheelPush } from "../../shared/wheel";
import { onWheelPush } from "./wheel-events";
import { goHandInput } from "./go-hand-input";
import { audio } from "./breath-sound";
import { space } from "../space-client";

/**
 * THE PRAYER WHEEL (shared/wheel.ts): a tall painted drum on a post, back-left
 * beyond the garden. Push it round with a sweep of your hand, or point and
 * pinch at it; it spins for everyone in the room, a small bell rings at each
 * full turn, and the plaque counts every push.
 */

export const WHEEL_AT = { x: -3.6, z: 4.5 } as const;
const RADIUS = 0.16;
const HEIGHT = 0.42;
const MIDDLE = 1.25;

function paintDrum(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#8f1d1d";
  c.fillRect(0, 0, 1024, 512);
  // Gold bands top and bottom, a lotus-petal border, and the mantra round the middle.
  c.fillStyle = "#d9a441";
  c.fillRect(0, 0, 1024, 46);
  c.fillRect(0, 466, 1024, 46);
  for (let i = 0; i < 32; i += 1) {
    const x = i * 32 + 16;
    for (const [y, dir] of [[46, 1], [466, -1]] as const) {
      c.beginPath();
      c.moveTo(x - 14, y);
      c.quadraticCurveTo(x, y + dir * 42, x + 14, y);
      c.fill();
    }
  }
  c.fillStyle = "#1f4f8a";
  c.fillRect(0, 150, 1024, 212);
  c.fillStyle = "#f3d27a";
  // Twice round, evenly, so the seam falls between repeats.
  c.font = "700 60px Georgia, serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("OM MANI PADME HUM ·", 256, 258);
  c.fillText("OM MANI PADME HUM ·", 768, 258);
  return canvas;
}

function bell(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  for (const [f, level, decay] of [[2093, 0.05, 1.6], [2093 * 2.4, 0.02, 0.8]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

export function PrayerWheel({ you }: { you: string | null }) {
  const [turns, setTurns] = useState<number | null>(null);
  const drum = useRef<THREE.Mesh>(null);
  /** Pushes still turning the wheel: when, and how hard. */
  const pushes = useRef<{ at: number; strength: number }[]>([]);
  const angle = useRef(0);
  const turned = useRef(0);
  const texture = useMemo(() => {
    const made = new THREE.CanvasTexture(paintDrum());
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 8;
    return made;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    space.wheel().then((answer) => setTurns(answer.turns)).catch(() => {});
  }, []);
  useEffect(
    () =>
      onWheelPush((push: WheelPush) => {
        setTurns(push.turns);
        if (you && push.by.toLowerCase() === you.toLowerCase()) return;
        pushes.current.push({ at: performance.now(), strength: push.strength });
      }),
    [you],
  );

  const push = (strength: number) => {
    pushes.current.push({ at: performance.now(), strength });
    space.pushWheel(strength).catch(() => {});
  };

  const last = useRef<Record<"left" | "right", { x: number; z: number; time: number } | null>>({ left: null, right: null });
  const lastPush = useRef(0);
  useFrame((_, delta) => {
    const now = performance.now();
    pushes.current = pushes.current.filter((one) => now - one.at < 40_000);
    const speed = pushes.current.reduce((sum, one) => sum + spinAfter(one.strength, (now - one.at) / 1000), 0);
    // Clockwise, as a prayer wheel is always turned.
    angle.current -= Math.min(3, speed) * Math.PI * 2 * delta;
    if (drum.current) drum.current.rotation.y = angle.current;
    const whole = Math.floor(-angle.current / (Math.PI * 2));
    if (whole > turned.current) {
      turned.current = whole;
      bell();
    }

    // A HAND sweeping past the drum's side pushes it round.
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) {
        last.current[side] = null;
        continue;
      }
      const x = hand.contact.x - WHEEL_AT.x;
      const z = hand.contact.z - WHEEL_AT.z;
      const before = last.current[side];
      last.current[side] = { x, z, time: now };
      const across = Math.hypot(x, z);
      const onDrum = Math.abs(across - RADIUS) < 0.05 && Math.abs(hand.contact.y - MIDDLE) < HEIGHT / 2;
      if (!before || !onDrum || now - lastPush.current < 500) continue;
      const seconds = Math.max(0.001, (now - before.time) / 1000);
      // How fast the hand moves ROUND the drum, clockwise seen from above.
      const tangent = ((x - before.x) * (z / across) - (z - before.z) * (x / across)) / seconds;
      if (tangent > 0.25) {
        lastPush.current = now;
        push(Math.min(1, tangent / 1.2));
      }
    }
  });

  return (
    <group position={[WHEEL_AT.x, 0, WHEEL_AT.z]}>
      {/* The post, and the stone it stands in. */}
      <mesh position={[0, 0.06, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.2, 0.24, 0.12, 24]} />
        <meshStandardMaterial color="#5b564e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.8, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.018, 0.018, 1.6, 12]} />
        <meshStandardMaterial color="#3a2a1d" roughness={0.6} />
      </mesh>
      {/* The drum. */}
      <mesh
        ref={drum}
        position={[0, MIDDLE, 0]}
        onClick={(event) => {
          event.stopPropagation();
          push(0.7);
        }}
      >
        <cylinderGeometry args={[RADIUS, RADIUS, HEIGHT, 48]} />
        <meshStandardMaterial map={texture} roughness={0.55} metalness={0.15} />
      </mesh>
      {/* Its gold caps. */}
      {[MIDDLE + HEIGHT / 2 + 0.015, MIDDLE - HEIGHT / 2 - 0.015].map((y) => (
        <mesh key={y} position={[0, y, 0]} raycast={() => null}>
          <cylinderGeometry args={[RADIUS + 0.012, RADIUS + 0.012, 0.03, 48]} />
          <meshStandardMaterial color="#d9a441" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, MIDDLE + HEIGHT / 2 + 0.07, 0]} raycast={() => null}>
        <coneGeometry args={[0.05, 0.1, 16]} />
        <meshStandardMaterial color="#d9a441" metalness={0.8} roughness={0.3} />
      </mesh>
      <Text position={[0, 0.2, RADIUS + 0.1]} rotation={[-0.5, 0, 0]} fontSize={0.045} color="#f3d27a" outlineWidth={0.002} outlineColor="#2a1a0a" raycast={() => null}>
        {turns === null ? "push the wheel round" : `turned ${turns} ${turns === 1 ? "time" : "times"}`}
      </Text>
    </group>
  );
}
