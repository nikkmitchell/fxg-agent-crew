import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * THE MOON: in tonight's real phase, large over the far side of the room,
 * crossing slowly the way the real one does: up in the east in the evening,
 * highest around midnight, down in the west by morning. Look up from sitting
 * and it has moved.
 *
 * YOUR OWN SKY: its place follows each viewer's own clock, since people in
 * this room live eight time zones apart; its phase is the same for everyone.
 * By day it stays, pale, as the moon often does.
 */

/** Days since a known new moon (6 Jan 2000, 18:14 UTC), and the synodic month. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_DAYS = 29.530588853;

/** How far through its cycle the moon is at `ms`: 0 new, 0.5 full, back to 1. */
export function moonPhase(ms: number): number {
  const days = (ms - NEW_MOON_MS) / 86_400_000;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

/**
 * Where the moon is at local `hour` (0..24): how far across the sky from east
 * (0) to west (1), and how bright (1 at night, pale by day). It rises at 18:00,
 * is highest at midnight, sets at 06:00, and by day comes back round, faint.
 */
export function moonArc(hour: number): { across: number; bright: number } {
  const since = (hour - 18 + 24) % 24;
  return since <= 12 ? { across: since / 12, bright: 1 } : { across: (since - 12) / 12, bright: 0.3 };
}

const DISTANCE = 22;
const SIZE = 1.3;

export function Moon() {
  const group = useRef<THREE.Group>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return { canvas, made };
  }, []);
  const painted = useRef(-1);
  const face = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const now = new Date();
    const phase = moonPhase(now.getTime());
    // Repaint the lit part only when the phase moves on noticeably.
    if (Math.abs(phase - painted.current) > 0.002) {
      painted.current = phase;
      const c = texture.canvas.getContext("2d")!;
      c.clearRect(0, 0, 256, 256);
      // The dark disc, faintly, then the lit part: a circle and a squashed ellipse.
      c.fillStyle = "rgba(40, 44, 60, 0.35)";
      c.beginPath();
      c.arc(128, 128, 120, 0, Math.PI * 2);
      c.fill();
      const waxing = phase < 0.5;
      const lit = Math.cos(phase * Math.PI * 2); // 1 new, -1 full
      c.fillStyle = "#f4efdc";
      c.beginPath();
      c.arc(128, 128, 120, -Math.PI / 2, Math.PI / 2, !waxing);
      c.ellipse(128, 128, Math.abs(lit) * 120, 120, 0, Math.PI / 2, -Math.PI / 2, lit > 0 ? waxing : !waxing);
      c.fill();
      // A few soft maria.
      c.fillStyle = "rgba(160, 155, 140, 0.25)";
      for (const [x, y, r] of [[100, 95, 26], [150, 120, 20], [120, 160, 18], [165, 80, 12]]) {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      texture.made.needsUpdate = true;
    }
    const arc = moonArc(now.getHours() + now.getMinutes() / 60);
    const node = group.current;
    if (!node) return;
    if (face.current) face.current.opacity = arc.bright;
    // From east (+x) over the far side (-z) to west (-x), highest at the middle.
    const across = Math.PI * arc.across;
    node.position.set(Math.cos(across) * DISTANCE, 3 + Math.sin(across) * 9, 4 - Math.sin(across) * DISTANCE * 0.6 - 6);
    node.lookAt(0, 1.6, 6.2);
  });

  return (
    <group ref={group}>
      <mesh raycast={() => null}>
        <planeGeometry args={[SIZE * 2, SIZE * 2]} />
        <meshBasicMaterial ref={face} map={texture.made} transparent depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      <mesh position={[0, 0, -0.01]} raycast={() => null}>
        <circleGeometry args={[SIZE * 1.6, 48]} />
        <meshBasicMaterial color="#8fa3c8" transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} fog={false} />
      </mesh>
    </group>
  );
}
