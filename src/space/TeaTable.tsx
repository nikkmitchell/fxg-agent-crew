import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { READINGS } from "../../shared/guided";
import { teaPourFrame, TEA_POUR_MS } from "./tea-motion";

/**
 * THE TEA TABLE: a low table with a teapot and a cup, near where people
 * arrive. Tap the pot: it pours, the cup fills and steams, and a short
 * practice of drinking one cup of tea slowly is read to you, a line at a
 * time, in the room's voice (READINGS.tea in shared/guided.ts). For the
 * person who tapped it. A separate experience (Nikk, 5484).
 */
export const TEA_AT: [number, number, number] = [-1.7, 0, 6.8];
const TABLE = 0.38;
const noRaycast = () => undefined;

export function TeaTable({ reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  const [pouredAt, setPouredAt] = useState<number | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const tea = useRef<THREE.Mesh>(null);
  const stream = useRef<THREE.Mesh>(null);
  const steam = useRef<THREE.Group>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const base = useRef("");
  const down = useRef<number | null>(null);
  const pourTimer = useRef<number | null>(null);
  const readingStartedAt = useRef<number | null>(null);
  const snappedPourAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    void import("../router").then((router) => { base.current = router.base; }).catch(() => undefined);
    return () => {
      if (pourTimer.current !== null) window.clearTimeout(pourTimer.current);
      audio.current?.pause();
    };
  }, []);

  const lines = READINGS.tea.lines;
  const read = useCallback((index: number) => {
    audio.current?.pause();
    if (index >= lines.length) { setLine(null); audio.current = null; return; }
    setLine(index);
    const next = new Audio(`${base.current}/bff/space/readings/tea/${index}/audio`);
    audio.current = next;
    // Longer pauses than the stone: each line is something to do.
    next.onended = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 4000); };
    next.onerror = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 8000); };
    void next.play().catch(() => undefined);
  }, [lines]);

  const pour = () => {
    if (pouredAt !== null && Date.now() - pouredAt < TEA_POUR_MS) return;
    const startedAt = Date.now();
    setPouredAt(startedAt);
    readingStartedAt.current = null;
    snappedPourAt.current = reducedMotion ? startedAt : null;
    if (pourTimer.current !== null) window.clearTimeout(pourTimer.current);
    if (reducedMotion) {
      pourTimer.current = null;
      readingStartedAt.current = startedAt;
      read(0);
    } else {
      pourTimer.current = window.setTimeout(() => {
        pourTimer.current = null;
        readingStartedAt.current = startedAt;
        read(0);
      }, TEA_POUR_MS);
    }
  };

  // If the preference changes during a pour, finish it without waiting or animating.
  useEffect(() => {
    if (!reducedMotion || pouredAt === null || Date.now() - pouredAt >= TEA_POUR_MS) return;
    if (readingStartedAt.current === pouredAt) return;
    if (pourTimer.current !== null) window.clearTimeout(pourTimer.current);
    pourTimer.current = null;
    snappedPourAt.current = pouredAt;
    readingStartedAt.current = pouredAt;
    read(0);
  }, [pouredAt, read, reducedMotion]);

  useFrame(({ clock }) => {
    const frame = teaPourFrame(pouredAt, Date.now(), reducedMotion, snappedPourAt.current);
    if (tea.current) {
      tea.current.visible = frame.fill > 0.02;
      tea.current.scale.y = Math.max(0.01, frame.fill);
      tea.current.position.y = TABLE + 0.012 + 0.03 * frame.fill;
    }
    if (stream.current) stream.current.visible = frame.pouring;
    if (steam.current) {
      steam.current.visible = frame.complete;
      steam.current.children.forEach((puff, index) => {
        const material = (puff as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (reducedMotion) {
          puff.position.set((index - 1) * 0.035, 0.1 + index * 0.045, 0);
          material.opacity = 0.12;
        } else {
          const t = (clock.elapsedTime * 0.35 + index / 3) % 1;
          puff.position.set(Math.sin(t * 6 + index) * 0.015, 0.09 + t * 0.2, 0);
          material.opacity = 0.25 * (1 - t);
        }
      });
    }
    if (!reducedMotion && (frame.pouring || frame.complete)) invalidate();
  });

  return <group position={TEA_AT} rotation-y={Math.PI * 0.85}>
    {/* A low wooden table. */}
    <mesh position={[0, TABLE - 0.015, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.32, 0.32, 0.03, 32]} />
      <meshStandardMaterial color="#6a4a32" roughness={0.8} />
    </mesh>
    <mesh position={[0, (TABLE - 0.03) / 2, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.05, 0.08, TABLE - 0.03, 12]} />
      <meshStandardMaterial color="#553a27" roughness={0.9} />
    </mesh>
    {/* The teapot: tap it to pour. */}
    <group position={[-0.12, TABLE, 0]}
      onPointerDown={(event) => { event.stopPropagation(); down.current = event.pointerId; }}
      onPointerUp={(event) => { if (down.current !== event.pointerId) return; event.stopPropagation(); down.current = null; pour(); }}>
      <mesh position={[0, 0.07, 0]}><sphereGeometry args={[0.075, 24, 16]} /><meshStandardMaterial color="#3f5a4c" roughness={0.4} /></mesh>
      <mesh position={[0.08, 0.08, 0]} rotation-z={-0.9}><cylinderGeometry args={[0.008, 0.014, 0.08, 8]} /><meshStandardMaterial color="#3f5a4c" roughness={0.4} /></mesh>
      <mesh position={[0, 0.15, 0]}><sphereGeometry args={[0.018, 12, 8]} /><meshStandardMaterial color="#2f4439" roughness={0.4} /></mesh>
    </group>
    {/* The stream while pouring. */}
    <mesh ref={stream} position={[0.03, TABLE + 0.09, 0]} rotation-z={0.35} visible={false} raycast={noRaycast}>
      <cylinderGeometry args={[0.004, 0.004, 0.09, 6]} />
      <meshBasicMaterial color="#b98a3e" transparent opacity={0.8} />
    </mesh>
    {/* The cup, and the tea rising in it. */}
    <mesh position={[0.08, TABLE + 0.03, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.035, 0.028, 0.06, 20, 1, true]} />
      <meshStandardMaterial color="#e9e2d4" roughness={0.5} side={THREE.DoubleSide} />
    </mesh>
    <mesh ref={tea} position={[0.08, TABLE + 0.012, 0]} visible={false} raycast={noRaycast}>
      <cylinderGeometry args={[0.032, 0.028, 0.06, 20]} />
      <meshStandardMaterial color="#8a5a1e" roughness={0.3} />
    </mesh>
    <group ref={steam} position={[0.08, TABLE, 0]} visible={false}>
      {[0, 1, 2].map((index) => <mesh key={index} raycast={noRaycast}>
        <sphereGeometry args={[0.02, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} depthWrite={false} />
      </mesh>)}
    </group>
    <Text position={[0, TABLE + 0.5, 0]} fontSize={0.032} maxWidth={0.8} textAlign="center" color="#fff6e0" raycast={noRaycast} outlineWidth={0.0025} outlineColor="#0b1418">
      {line === null ? (pouredAt === null ? "TAP THE TEAPOT FOR A CUP OF TEA" : "") : lines[line]}
    </Text>
  </group>;
}
