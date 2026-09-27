import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  POINT_STEP,
  TRAY,
  applyGardenEvent,
  emptyGarden,
  rakeTines,
  type Garden,
  type GardenPoint,
} from "../../shared/garden";
import { onGardenChange } from "./garden-events";
import { goHandInput } from "./go-hand-input";
import { space } from "../space-client";

/**
 * THE ZEN SAND GARDEN (shared/garden.ts), on a low stand beside the orb.
 *
 * RAKE with a fingertip drawn through the sand, or by pinching and dragging a
 * ray across it: every path leaves three parallel grooves, for everyone, and
 * they stay. MOVE a stone by pinching it and dragging it somewhere else; each
 * stone always has rings raked round it. SMOOTH is the small wooden paddle at
 * the tray's corner: it clears the grooves for everyone.
 *
 * The sand is one canvas texture: grooves are painted as a shadow and a
 * highlight either side of a dark line, which reads as a groove from any
 * angle a headset sees it at, and costs nothing to draw.
 */

/** Left of where people arrive, clear of the orb and of Sill's tree (StillnessTree, x -0.95). */
export const GARDEN_AT = { x: -2.2, z: 5.2, height: 0.62 } as const;
/** Canvas pixels per metre of sand. */
const PPM = 900;
const SAND = "#d9ccb0";

const toCanvas = (point: GardenPoint): [number, number] => [(point[0] + TRAY.width / 2) * PPM, (point[1] + TRAY.depth / 2) * PPM];

/** The sand's grain, made once: flat colour with a little speckle. */
function grain(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = SAND;
  context.fillRect(0, 0, width, height);
  for (let i = 0; i < (width * height) / 60; i += 1) {
    const light = Math.random() > 0.5;
    context.fillStyle = light ? "rgba(255,250,235,0.35)" : "rgba(120,100,70,0.18)";
    context.fillRect(Math.random() * width, Math.random() * height, 1.5, 1.5);
  }
  return canvas;
}

function paintGroove(context: CanvasRenderingContext2D, line: readonly GardenPoint[]): void {
  if (line.length < 2) return;
  const path = () => {
    context.beginPath();
    const [x0, y0] = toCanvas(line[0]);
    context.moveTo(x0, y0);
    for (const point of line.slice(1)) {
      const [x, y] = toCanvas(point);
      context.lineTo(x, y);
    }
  };
  context.lineCap = "round";
  context.lineJoin = "round";
  // Shadow on the far wall, highlight on the near: light comes from above and in front.
  context.save();
  context.translate(0, -2.2);
  path();
  context.strokeStyle = "rgba(95, 78, 50, 0.45)";
  context.lineWidth = 7;
  context.stroke();
  context.restore();
  context.save();
  context.translate(0, 2.2);
  path();
  context.strokeStyle = "rgba(255, 250, 236, 0.55)";
  context.lineWidth = 6;
  context.stroke();
  context.restore();
  path();
  context.strokeStyle = "rgba(150, 128, 90, 0.95)";
  context.lineWidth = 6;
  context.stroke();
}

function paintStroke(context: CanvasRenderingContext2D, points: readonly GardenPoint[]): void {
  for (const tine of rakeTines(points)) paintGroove(context, tine);
}

/** Rings round a stone, the classic way, drawn under everything else. */
function paintRings(context: CanvasRenderingContext2D, stone: Garden["stones"][number]): void {
  for (const ring of [1.5, 2.1, 2.7]) {
    const points: GardenPoint[] = [];
    for (let i = 0; i <= 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      points.push([stone.x + Math.cos(a) * stone.size * ring, stone.z + Math.sin(a) * stone.size * ring * 0.85]);
    }
    paintGroove(context, points);
  }
}

export function GardenTray() {
  const [garden, setGarden] = useState<Garden>(emptyGarden);
  const current = useRef(garden);
  current.current = garden;

  const read = useCallback(() => {
    space.garden().then((answer) => {
      current.current = answer.garden;
      setGarden(answer.garden);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onGardenChange((event) => {
        // Held at once, not only on the next render: two strokes can arrive
        // between renders, and the second must build on the first.
        const next = applyGardenEvent(current.current, event);
        if (next) {
          current.current = next;
          setGarden(next);
        } else read();
      }),
    [read],
  );

  // THE SAND: a canvas the size of the tray, repainted when the garden changes.
  const width = Math.round(TRAY.width * PPM);
  const height = Math.round(TRAY.depth * PPM);
  const sand = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture, grain: grain(width, height) };
  }, [width, height]);
  useEffect(() => () => sand.texture.dispose(), [sand]);

  const drawing = useRef<GardenPoint[] | null>(null);
  const repaint = useCallback(() => {
    const context = sand.canvas.getContext("2d");
    if (!context) return;
    context.drawImage(sand.grain, 0, 0);
    for (const stone of current.current.stones) paintRings(context, stone);
    for (const stroke of current.current.strokes) paintStroke(context, stroke.points);
    if (drawing.current) paintStroke(context, drawing.current);
    sand.texture.needsUpdate = true;
  }, [sand]);
  useEffect(repaint, [repaint, garden]);

  // RAKING: add a point to the stroke being drawn, and show it at once.
  const addPoint = (x: number, z: number) => {
    if (Math.abs(x) > TRAY.width / 2 || Math.abs(z) > TRAY.depth / 2) return;
    const stroke = drawing.current;
    if (!stroke) return;
    const last = stroke[stroke.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - z) < POINT_STEP) return;
    stroke.push([x, z]);
    const context = sand.canvas.getContext("2d");
    if (context && stroke.length >= 2) {
      paintStroke(context, stroke.slice(-3));
      sand.texture.needsUpdate = true;
    }
  };
  const finish = () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke || stroke.length < 2) return;
    space.rakeGarden({ action: "stroke", points: stroke }).catch(() => repaint());
  };

  const local = (point: THREE.Vector3) => ({ x: point.x - GARDEN_AT.x, z: point.z - GARDEN_AT.z });

  // STONES: pinch one and drag it; let go to set it down.
  const [held, setHeld] = useState<{ index: number; x: number; z: number } | null>(null);

  const onSandDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (held) return;
    const at = local(event.point);
    drawing.current = [];
    addPoint(at.x, at.z);
  };
  const onSandMove = (event: ThreeEvent<PointerEvent>) => {
    const at = local(event.point);
    if (held) {
      event.stopPropagation();
      setHeld({ ...held, x: at.x, z: at.z });
      return;
    }
    if (drawing.current) {
      event.stopPropagation();
      addPoint(at.x, at.z);
    }
  };
  const onSandUp = (event: ThreeEvent<PointerEvent>) => {
    if (held) {
      event.stopPropagation();
      const put = held;
      setHeld(null);
      space.rakeGarden({ action: "stone", index: put.index, x: put.x, z: put.z }).catch(() => read());
      return;
    }
    if (drawing.current) {
      event.stopPropagation();
      finish();
    }
  };

  // FINGERTIPS: a fingertip just above the sand rakes; lifting it ends the stroke.
  const tipDrawing = useRef<"left" | "right" | null>(null);
  useFrame(() => {
    const now = performance.now();
    let touching: { side: "left" | "right"; x: number; z: number } | null = null;
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) continue;
      const x = hand.contact.x - GARDEN_AT.x;
      const z = hand.contact.z - GARDEN_AT.z;
      const above = hand.contact.y - GARDEN_AT.height;
      if (Math.abs(x) <= TRAY.width / 2 && Math.abs(z) <= TRAY.depth / 2 && above < 0.025 && above > -0.06) {
        if (!touching || side === tipDrawing.current) touching = { side, x, z };
      }
    }
    if (touching) {
      if (tipDrawing.current !== touching.side) {
        if (tipDrawing.current) finish();
        tipDrawing.current = touching.side;
        drawing.current = [];
      }
      addPoint(touching.x, touching.z);
    } else if (tipDrawing.current) {
      tipDrawing.current = null;
      finish();
    }
  });

  const stones = garden.stones.map((stone, index) => (held?.index === index ? { ...stone, x: held.x, z: held.z } : stone));
  const rimHeight = 0.04;

  return (
    <group position={[GARDEN_AT.x, 0, GARDEN_AT.z]}>
      {/* THE STAND: a low dark box the tray sits in. */}
      <mesh position={[0, (GARDEN_AT.height - 0.01) / 2, 0]} raycast={() => null}>
        <boxGeometry args={[TRAY.width + 0.1, GARDEN_AT.height - 0.01, TRAY.depth + 0.1]} />
        <meshStandardMaterial color="#2a211a" roughness={0.9} />
      </mesh>
      {/* THE FRAME: four wooden rails round the sand. */}
      {([
        [0, -(TRAY.depth / 2 + 0.025), TRAY.width + 0.1, 0.05],
        [0, TRAY.depth / 2 + 0.025, TRAY.width + 0.1, 0.05],
      ] as const).map(([x, z, w, d], i) => (
        <mesh key={`r${i}`} position={[x, GARDEN_AT.height + rimHeight / 2, z]} raycast={() => null}>
          <boxGeometry args={[w, rimHeight, d]} />
          <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
        </mesh>
      ))}
      {([-1, 1] as const).map((side) => (
        <mesh key={`s${side}`} position={[side * (TRAY.width / 2 + 0.025), GARDEN_AT.height + rimHeight / 2, 0]} raycast={() => null}>
          <boxGeometry args={[0.05, rimHeight, TRAY.depth]} />
          <meshStandardMaterial color="#6b4a2f" roughness={0.7} />
        </mesh>
      ))}
      {/* THE SAND: rake it by pinching and dragging, or with a fingertip. */}
      <mesh
        position={[0, GARDEN_AT.height + 0.002, 0]}
        rotation-x={-Math.PI / 2}
        onPointerDown={onSandDown}
        onPointerMove={onSandMove}
        onPointerUp={onSandUp}
        onPointerLeave={() => {
          if (drawing.current && !tipDrawing.current) finish();
        }}
      >
        <planeGeometry args={[TRAY.width, TRAY.depth]} />
        <meshStandardMaterial map={sand.texture} roughness={1} />
      </mesh>
      {/* THE STONES. */}
      {stones.map((stone, index) => (
        <mesh
          key={index}
          position={[stone.x, GARDEN_AT.height + stone.size * 0.35, stone.z]}
          rotation={[0.2, stone.turn, 0.1]}
          scale={[stone.size, stone.size * 0.62, stone.size * 0.85]}
          onPointerDown={(event) => {
            event.stopPropagation();
            setHeld({ index, x: stone.x, z: stone.z });
          }}
          onPointerUp={onSandUp}
        >
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={index === 0 ? "#4a4d52" : index === 1 ? "#5d5a55" : "#3b3d40"} roughness={0.85} flatShading />
        </mesh>
      ))}
      {/* SMOOTH: a wooden paddle at the corner clears the grooves for everyone. */}
      <mesh
        position={[TRAY.width / 2 + 0.03, GARDEN_AT.height + rimHeight + 0.015, TRAY.depth / 2 + 0.03]}
        onClick={(event) => {
          event.stopPropagation();
          space.rakeGarden({ action: "smooth" }).catch(() => {});
        }}
      >
        <boxGeometry args={[0.16, 0.02, 0.06]} />
        <meshStandardMaterial color="#a57a4e" roughness={0.6} />
      </mesh>
    </group>
  );
}
