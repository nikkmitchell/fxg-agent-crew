import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  GRAIN_STEP,
  PLATE_RADIUS,
  SANDS,
  applyMandalaEvent,
  emptyMandala,
  mirrored,
  type Mandala,
  type PlatePoint,
} from "../../shared/mandala";
import { onMandalaChange } from "./mandala-events";
import { goHandInput } from "./go-hand-input";
import { WristButton } from "./Backdrop";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE SAND MANDALA (shared/mandala.ts), on a low plinth behind and to the left
 * of where people arrive.
 *
 * CHOOSE a sand from the six cups at the plate's edge, then POUR by pinching
 * and dragging across the plate, or by drawing a fingertip over it. Every pour
 * is repeated eight times round and mirrored, so it becomes part of a
 * symmetric pattern, and it stays for everyone. SWEEP with the brush (tap it
 * twice): the sand spirals into the centre and is gone, for everyone.
 */

export const MANDALA_AT = { x: -3.6, z: 7.2, height: 0.72 } as const;
const PX = 1024;
const SWEEP_SECONDS = 4;

/** Plate x, y (radii, y toward the viewer) → canvas pixels. */
const toCanvas = (x: number, y: number): [number, number] => [PX / 2 + (x * PX) / 2, PX / 2 + (y * PX) / 2];

/** A little deterministic scatter, so a line of grains looks like sand and not a pen. */
const jitter = (seed: number) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};

function paintPlate(context: CanvasRenderingContext2D): void {
  context.clearRect(0, 0, PX, PX);
  context.fillStyle = "#1d1a2b";
  context.beginPath();
  context.arc(PX / 2, PX / 2, PX / 2 - 2, 0, Math.PI * 2);
  context.fill();
  // The faint gold guide lines monks chalk before they start.
  context.strokeStyle = "rgba(214, 180, 110, 0.22)";
  context.lineWidth = 2;
  for (const ring of [0.18, 0.4, 0.62, 0.84, 0.98]) {
    context.beginPath();
    context.arc(PX / 2, PX / 2, (ring * PX) / 2, 0, Math.PI * 2);
    context.stroke();
  }
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    context.beginPath();
    context.moveTo(...toCanvas(Math.cos(a) * 0.18, Math.sin(a) * 0.18));
    context.lineTo(...toCanvas(Math.cos(a) * 0.98, Math.sin(a) * 0.98));
    context.stroke();
  }
  // The palace: a square with gates, the classic mandala's inner walls.
  const half = 0.5;
  context.strokeRect(PX / 2 - (half * PX) / 2, PX / 2 - (half * PX) / 2, half * PX, half * PX);
}

function paintGrains(context: CanvasRenderingContext2D, colour: string, points: readonly PlatePoint[], seed: number, sweep = 0): void {
  context.fillStyle = colour;
  points.forEach((point, index) => {
    // SWEEPING: every grain spirals in toward the centre and fades.
    const r = point[0] * (1 - sweep);
    const a = point[1] + sweep * 4;
    for (const [x, y] of mirrored([r, a])) {
      for (let g = 0; g < 3; g += 1) {
        const s = seed * 131 + index * 7 + g;
        const [cx, cy] = toCanvas(x + jitter(s) * 0.012, y + jitter(s + 3.3) * 0.012);
        context.globalAlpha = 0.9 * (1 - sweep);
        context.beginPath();
        context.arc(cx, cy, 4.5 + jitter(s + 7.7) * 2, 0, Math.PI * 2);
        context.fill();
      }
    }
  });
  context.globalAlpha = 1;
}

/** Put the six cups (or their sand) along the plate's near edge; the chosen one is raised and its sand brighter. */
function placeCups(node: THREE.InstancedMesh | null, chosen: number, part: "cup" | "sand"): void {
  if (!node) return;
  const matrix = new THREE.Matrix4();
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  SANDS.forEach((colour, index) => {
    const a = ((index - (SANDS.length - 1) / 2) / SANDS.length) * 1.5;
    const r = PLATE_RADIUS + 0.12;
    const y = MANDALA_AT.height + (index === chosen ? 0.04 : 0.015) + (part === "sand" ? 0.016 : 0);
    matrix.compose(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r), part === "sand" ? flat : new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    node.setMatrixAt(index, matrix);
    if (part === "sand") node.setColorAt(index, new THREE.Color(colour).multiplyScalar(index === chosen ? 1.35 : 1));
  });
  node.instanceMatrix.needsUpdate = true;
  if (node.instanceColor) node.instanceColor.needsUpdate = true;
  // The bounds must cover where the cups now are, or taps and culling miss them.
  node.computeBoundingSphere();
}

export function SandMandala() {
  const [mandala, setMandala] = useState<Mandala>(emptyMandala);
  const current = useRef(mandala);
  current.current = mandala;
  const [sand, setSand] = useState(1);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const sweeping = useRef<{ start: number; pours: Mandala["pours"] } | null>(null);

  const read = useCallback(() => {
    space.mandala().then((answer) => {
      current.current = answer.mandala;
      setMandala(answer.mandala);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onMandalaChange((event) => {
        if (event.kind === "sweep") sweeping.current = { start: performance.now(), pours: current.current.pours };
        const next = applyMandalaEvent(current.current, event);
        if (next) {
          current.current = next;
          setMandala(next);
        } else read();
      }),
    [read],
  );

  const plate = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = PX;
    canvas.height = PX;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, []);
  useEffect(() => () => plate.texture.dispose(), [plate]);

  const pouring = useRef<PlatePoint[] | null>(null);
  const repaint = useCallback(() => {
    const context = plate.canvas.getContext("2d");
    if (!context) return;
    paintPlate(context);
    current.current.pours.forEach((pour, index) => paintGrains(context, SANDS[pour.colour], pour.points, index));
    if (pouring.current) paintGrains(context, SANDS[sand], pouring.current, 9999);
    plate.texture.needsUpdate = true;
  }, [plate, sand]);
  useEffect(repaint, [repaint, mandala]);

  // Plate point from a spot in the room.
  const toPlate = (x: number, z: number): PlatePoint | null => {
    const px = (x - MANDALA_AT.x) / PLATE_RADIUS;
    const py = (z - MANDALA_AT.z) / PLATE_RADIUS;
    const r = Math.hypot(px, py);
    return r > 1 ? null : [r, Math.atan2(py, px)];
  };
  const add = (point: PlatePoint | null) => {
    const stroke = pouring.current;
    if (!stroke || !point) return;
    const last = stroke[stroke.length - 1];
    if (last) {
      const dx = last[0] * Math.cos(last[1]) - point[0] * Math.cos(point[1]);
      const dy = last[0] * Math.sin(last[1]) - point[0] * Math.sin(point[1]);
      if (Math.hypot(dx, dy) < GRAIN_STEP) return;
    }
    stroke.push(point);
    const context = plate.canvas.getContext("2d");
    if (context) {
      paintGrains(context, SANDS[sand], [point], 9999 + stroke.length);
      plate.texture.needsUpdate = true;
    }
  };
  const finish = () => {
    const stroke = pouring.current;
    pouring.current = null;
    if (!stroke || stroke.length === 0) return;
    space.changeMandala({ action: "pour", colour: sand, points: stroke }).catch(() => repaint());
  };

  const onDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    pouring.current = [];
    add(toPlate(event.point.x, event.point.z));
  };
  const onMove = (event: ThreeEvent<PointerEvent>) => {
    if (!pouring.current) return;
    event.stopPropagation();
    add(toPlate(event.point.x, event.point.z));
  };
  const onUp = (event: ThreeEvent<PointerEvent>) => {
    if (!pouring.current) return;
    event.stopPropagation();
    finish();
  };

  // FINGERTIPS just above the plate pour; lifting ends the pour.
  const tip = useRef<"left" | "right" | null>(null);
  useFrame(() => {
    // The sweep, if one is happening: repaint every frame while it spirals in.
    const sweep = sweeping.current;
    if (sweep) {
      const t = (performance.now() - sweep.start) / 1000 / SWEEP_SECONDS;
      const context = plate.canvas.getContext("2d");
      if (context) {
        paintPlate(context);
        if (t < 1) sweep.pours.forEach((pour, index) => paintGrains(context, SANDS[pour.colour], pour.points, index, t));
        plate.texture.needsUpdate = true;
      }
      if (t >= 1) {
        sweeping.current = null;
        repaint();
      }
      return;
    }
    const now = performance.now();
    let touching: { side: "left" | "right"; point: PlatePoint } | null = null;
    for (const side of ["left", "right"] as const) {
      const hand = goHandInput[side];
      if (!hand || now - hand.at > 200) continue;
      const above = hand.contact.y - MANDALA_AT.height;
      const point = toPlate(hand.contact.x, hand.contact.z);
      if (point && above < 0.025 && above > -0.05 && (!touching || side === tip.current)) touching = { side, point };
    }
    if (touching) {
      if (tip.current !== touching.side) {
        if (tip.current) finish();
        tip.current = touching.side;
        pouring.current = [];
      }
      add(touching.point);
    } else if (tip.current) {
      tip.current = null;
      finish();
    }
  });

  useEffect(() => {
    if (!confirmSweep) return;
    const timer = setTimeout(() => setConfirmSweep(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmSweep]);

  // The cups and the brush sit on the side toward where people arrive.
  const facing = Math.atan2(ROOM.spawn.x - MANDALA_AT.x, ROOM.spawn.z - MANDALA_AT.z);

  return (
    <group position={[MANDALA_AT.x, 0, MANDALA_AT.z]}>
      {/* THE PLINTH. */}
      <mesh position={[0, (MANDALA_AT.height - 0.02) / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[PLATE_RADIUS + 0.12, PLATE_RADIUS + 0.2, MANDALA_AT.height - 0.02, 48]} />
        <meshStandardMaterial color="#3a2c24" roughness={0.9} />
      </mesh>
      {/* THE PLATE: pour on it. */}
      <mesh
        position={[0, MANDALA_AT.height + 0.002, 0]}
        rotation-x={-Math.PI / 2}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          if (pouring.current && !tip.current) finish();
        }}
      >
        <circleGeometry args={[PLATE_RADIUS, 96]} />
        <meshStandardMaterial map={plate.texture} roughness={1} />
      </mesh>
      <group rotation={[0, facing, 0]}>
        {/* THE SIX CUPS OF SAND, along the near edge: tap one to pour with it. */}
        {/* Two draws for all six cups and their sand, not twelve (draw-call count, 2026-09-28). */}
        <instancedMesh
          args={[undefined, undefined, SANDS.length]}
          ref={(node) => placeCups(node, sand, "cup")}
          onClick={(event) => {
            event.stopPropagation();
            if (event.instanceId !== undefined) setSand(event.instanceId);
          }}
        >
          <cylinderGeometry args={[0.035, 0.025, 0.03, 16]} />
          <meshStandardMaterial color="#6a5646" roughness={0.8} />
        </instancedMesh>
        <instancedMesh args={[undefined, undefined, SANDS.length]} ref={(node) => placeCups(node, sand, "sand")} raycast={() => null}>
          <circleGeometry args={[0.031, 16]} />
          <meshStandardMaterial roughness={1} />
        </instancedMesh>
        {/* THE BRUSH: tap twice to sweep. */}
        <mesh
          position={[PLATE_RADIUS + 0.1, MANDALA_AT.height + 0.02, 0.25]}
          rotation={[0, 0.6, Math.PI / 2]}
          onClick={(event) => {
            event.stopPropagation();
            if (!confirmSweep) {
              setConfirmSweep(true);
              return;
            }
            setConfirmSweep(false);
            space.changeMandala({ action: "sweep" }).catch(() => {});
          }}
        >
          <cylinderGeometry args={[0.02, 0.035, 0.18, 12]} />
          <meshStandardMaterial color="#c9a36a" roughness={0.7} />
        </mesh>
        {confirmSweep ? (
          <group position={[PLATE_RADIUS + 0.1, MANDALA_AT.height + 0.22, 0.25]}>
            <WristButton label="Tap the brush again to sweep it all away" y={0} width={0.5} height={0.07} tone="muted" passThrough onTap={() => {}} />
          </group>
        ) : mandala.pours.length === 0 ? (
          <group position={[0, MANDALA_AT.height + 0.3, 0]}>
            <WristButton
              label={mandala.lastSwept ? `Swept by ${mandala.lastSwept.by}. Begin again: choose a sand, then pour.` : "Choose a sand from a cup, then pour it on the plate."}
              y={0}
              width={0.62}
              height={0.08}
              tone="muted"
              passThrough
              onTap={() => {}}
            />
          </group>
        ) : null}
      </group>
    </group>
  );
}
