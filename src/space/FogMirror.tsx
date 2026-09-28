import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { goHandInput } from "./go-hand-input";
import { ROOM } from "../../shared/space-layout";

/**
 * THE FOG MIRROR: a tall pane of dark glass on a stand. Lean close and breathe
 * and it mists over where your face is, a little more with each out-breath.
 * Draw in the mist with a fingertip (or drag across it) and the line shows
 * clear glass. Left alone, the mist slowly lifts. Only you see your mist.
 */

export const FOG_AT = { x: 2.6, z: 3.4 } as const;
const WIDTH = 0.5;
const HEIGHT = 0.7;
const BOTTOM = 1.0;
const PIXELS = 256;
/** How close your face must be to breathe on the glass, in metres. */
const BREATH_REACH = 0.4;

/** How much mist a breath lays at `seconds`: only on the out-breath of a slow 5 s cycle. */
export function breathMist(seconds: number, distance: number): number {
  if (distance >= BREATH_REACH) return 0;
  const phase = (seconds % 5) / 5;
  const out = phase > 0.45 ? Math.sin(((phase - 0.45) / 0.55) * Math.PI) : 0;
  return out * (1 - distance / BREATH_REACH);
}

/** Lay one stable, drawable patch of mist without inheriting a prior wipe's erase mode. */
export function drawStillMist(context: CanvasRenderingContext2D, width: number, height: number): void {
  const px = width / 2;
  const py = height / 2;
  context.globalCompositeOperation = "source-over";
  const gradient = context.createRadialGradient(px, py, 0, px, py, 60);
  gradient.addColorStop(0, "rgba(235,240,245,0.45)");
  gradient.addColorStop(1, "rgba(235,240,245,0)");
  context.fillStyle = gradient;
  context.fillRect(px - 60, py - 60, 120, 120);
}

export function FogMirror({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const canvas = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = PIXELS;
    element.height = Math.round((PIXELS * HEIGHT) / WIDTH);
    return element;
  }, []);
  const texture = useMemo(() => new THREE.CanvasTexture(canvas), [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  const glass = useRef<THREE.Mesh>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const local = useMemo(() => new THREE.Vector3(), []);
  const lastFade = useRef(0);
  const facing = Math.atan2(ROOM.spawn.x - FOG_AT.x, ROOM.spawn.z - FOG_AT.z);

  // Reduced motion gets one still patch of mist; wiping it remains interactive.
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (reducedMotion) drawStillMist(context, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }, [canvas, texture, reducedMotion]);

  /** A point on the glass, in its own metres (x across, y up from its centre), to canvas pixels. */
  const toPixel = (x: number, y: number) => ({ px: ((x + WIDTH / 2) / WIDTH) * canvas.width, py: ((HEIGHT / 2 - y) / HEIGHT) * canvas.height });

  const wipe = (x: number, y: number) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const { px, py } = toPixel(x, y);
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(px, py, 5, 0, Math.PI * 2);
    context.fill();
    texture.needsUpdate = true;
  };

  useFrame((state, delta) => {
    const node = glass.current;
    const context = canvas.getContext("2d");
    if (!node || !context) return;
    let changed = false;
    // The mist lifts slowly on its own.
    const now = state.clock.elapsedTime;
    // (Per second, not per frame: a slow or throttled frame rate mists and clears the same.)
    if (!reducedMotion && now - lastFade.current > 0.15) {
      lastFade.current = now;
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "rgba(0,0,0,0.012)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      changed = true;
    }
    // A breath: mist around where your face is, if you are close and in front.
    state.camera.getWorldPosition(eye);
    local.copy(eye);
    node.worldToLocal(local);
    const mist = !reducedMotion && local.z > 0 ? breathMist(Date.now() / 1000, local.z) : 0;
    if (mist > 0 && Math.abs(local.x) < WIDTH / 2 + 0.1 && Math.abs(local.y) < HEIGHT / 2 + 0.1) {
      const { px, py } = toPixel(local.x, local.y - 0.08);
      const gradient = context.createRadialGradient(px, py, 0, px, py, 60);
      gradient.addColorStop(0, `rgba(235,240,245,${Math.min(1, 4 * mist * delta)})`);
      gradient.addColorStop(1, "rgba(235,240,245,0)");
      context.globalCompositeOperation = "source-over";
      context.fillStyle = gradient;
      context.fillRect(px - 60, py - 60, 120, 120);
      changed = true;
    }
    // A fingertip on the glass draws a clear line.
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || performance.now() - hand.at > 200) continue;
      local.set(hand.contact.x, hand.contact.y, hand.contact.z);
      node.worldToLocal(local);
      if (Math.abs(local.z) < 0.03 && Math.abs(local.x) < WIDTH / 2 && Math.abs(local.y) < HEIGHT / 2) wipe(local.x, local.y);
    }
    if (changed) texture.needsUpdate = true;
  });

  const drag = (event: ThreeEvent<PointerEvent>) => {
    if (!(event.buttons & 1) || !glass.current) return;
    event.stopPropagation();
    local.copy(event.point);
    glass.current.worldToLocal(local);
    wipe(local.x, local.y);
  };

  return (
    <group position={[FOG_AT.x, 0, FOG_AT.z]} rotation-y={facing}>
      {/* The stand and frame. */}
      <mesh position={[0, BOTTOM / 2, -0.02]} raycast={() => null}>
        <boxGeometry args={[0.06, BOTTOM, 0.04]} />
        <meshStandardMaterial color="#3b2e24" roughness={0.8} />
      </mesh>
      <mesh position={[0, BOTTOM + HEIGHT / 2, -0.012]} raycast={() => null}>
        <boxGeometry args={[WIDTH + 0.05, HEIGHT + 0.05, 0.02]} />
        <meshStandardMaterial color="#3b2e24" roughness={0.8} />
      </mesh>
      {/* The dark glass, and the mist over it. */}
      <mesh position={[0, BOTTOM + HEIGHT / 2, 0]} raycast={() => null}>
        <planeGeometry args={[WIDTH, HEIGHT]} />
        <meshStandardMaterial color="#0e1418" roughness={0.08} metalness={0.6} />
      </mesh>
      <mesh ref={glass} position={[0, BOTTOM + HEIGHT / 2, 0.003]} onPointerMove={drag} onPointerDown={drag}>
        <planeGeometry args={[WIDTH, HEIGHT]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
      <Text position={[0, BOTTOM - 0.06, 0.02]} fontSize={0.03} color="#cfc6b4" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        {reducedMotion ? "draw a clear path through the still mist" : "breathe on the glass, then draw in the mist"}
      </Text>
    </group>
  );
}
