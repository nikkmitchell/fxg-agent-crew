import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { RoundedBox, Text } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { GoRoomItem, RoomItem } from "../../shared/room-items";
import { legalGoMoves } from "../../shared/go-rules";
import { GO_PITCH, GO_SURFACE, goExtent, goBoardWidth, goBowlScale, goDeckWidth, goBowl, goPoint, goRadius, goRingArc, goRingCapacity, goRingSlots, goRingSpot, goRingStone, goLabelOffset, GO_RING, goLocal, goTouchBowl, type Point3 } from "../../shared/go-layout";
import { heldStoneWorld, idleGoTouch, restOnBoard, stepGoTouch } from "../../shared/go-touch";
import type { WirePerson } from "../../shared/space-wire";
import { goHandInput } from "./go-hand-input";
import { space } from "../space-client";
import { claimPointer } from "./pointer-claim";
import { beginGrab, clamp, grabbedTo, pushPull, type Grab, type Ray, type Vec3 } from "../../shared/grab-move";
import { CONFIRM_DELETE_MS, goSettingCost, goSettingFor, goSettingRequest } from "./GoTableSettings";
import { GO_TABLE_POINTERS, goControls, goControlsShown } from "./go-controls";
import { goSnap, type GoMove } from "./go-snap";
import { GO_SURFACE_LOOKS } from "./go-surfaces";
import { GO_NAMES as NAMES, goStarPoints } from "../../shared/go-text";
import { countGo } from "../../shared/go-score";
import { canPass, lastPassLine, noMoveLine, passLabel, resultRows, scoreLine, turnLine, winners } from "./go-status";
import { goTableWriter } from "./go-table-writer";
import { bambooPixels, goTextureRepeat, stonePixels } from "./go-textures";
import { grabHold } from "./grab-hold";

const ACCENTS = ["#edc58d", "#bdeeff", "#ff9582", "#7cbdff", "#ffdb7d", "#a9e6b3", "#d4afff", "#ffc0dc"];
const xyz = (p: Point3): [number, number, number] => [p.x, p.y, p.z];
const noRaycast = () => {};

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#d9ad6f"; ctx.fillRect(0, 0, 512, 512);
  for (let n = 0; n < 240; n++) {
    ctx.strokeStyle = `rgba(103,60,26,${0.025 + (Math.sin(n * 3.17) + 1) * 0.023})`;
    ctx.lineWidth = n % 9 === 0 ? 1.4 : 0.6; ctx.beginPath();
    for (let y = 0; y <= 512; y += 8) {
      const x = n * 2.2 + Math.sin(y * 0.014 + n * 0.18) * 2.4 + Math.sin(y * 0.004 + n) * 5;
      if (!y) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

function glowTexture(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const at = (y * size + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = 255;
    data[at + 3] = Math.round(Math.max(0, 1 - d) ** 2 * 255);
  }
  const texture = new THREE.DataTexture(data, size, size); texture.needsUpdate = true; return texture;
}

/**
 * The playing surface's grain: a tile from go-textures.ts, repeated by the
 * metre so a 5x5 and a 25x25 board have the same grain (card saha-ing-67276601).
 * The pixels are made once per look and shared; each board gets its own
 * texture only so it can set its own repeat.
 */
const surfacePixels = new Map<string, Uint8ClampedArray>();
function surfaceTexture(grain: "wood" | "stone", base: string, width: number): THREE.DataTexture {
  const key = `${grain}/${base}`, size = 512;
  let pixels = surfacePixels.get(key);
  if (!pixels) {
    pixels = grain === "stone" ? stonePixels(size, base) : bambooPixels(size, base);
    surfacePixels.set(key, pixels);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.setScalar(goTextureRepeat(width));
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The carving in a bowl's side, as a bump map: white is raised, and blurred a
 * little so it reads as carved rather than stamped. The lathe's u runs round
 * the bowl and v up its profile (bottom, out and up to the rim, then down the
 * inside), so the outer belly is v 0.08-0.40 — the canvas's lower part, as a
 * CanvasTexture is flipped.
 */
function bowlRelief(style: "lotus" | "fret"): THREE.CanvasTexture {
  const width = 1024, height = 256;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
  ctx.filter = "blur(1.5px)";
  ctx.strokeStyle = "#fff"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const top = height * (1 - 0.4), bottom = height * (1 - 0.08), band = bottom - top;
  if (style === "lotus") {
    // Lotus petals round the belly, each with a rib: Longquan's classic carving.
    const petals = 14, w = width / petals;
    for (let i = 0; i < petals; i++) {
      const cx = (i + 0.5) * w;
      ctx.lineWidth = 5; ctx.beginPath();
      ctx.moveTo(cx - w * 0.44, bottom);
      ctx.quadraticCurveTo(cx - w * 0.5, top + band * 0.3, cx, top);
      ctx.quadraticCurveTo(cx + w * 0.5, top + band * 0.3, cx + w * 0.44, bottom);
      ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, top + band * 0.22); ctx.lineTo(cx, bottom - 8); ctx.stroke();
    }
  } else {
    // A fret (key) band between two lines, round the belly of the clay.
    const y0 = top + band * 0.25, y1 = bottom - band * 0.25, mid = (y0 + y1) / 2;
    ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(0, y0 - 10); ctx.lineTo(width, y0 - 10); ctx.moveTo(0, y1 + 10); ctx.lineTo(width, y1 + 10); ctx.stroke();
    const units = 22, u = width / units;
    for (let i = 0; i < units; i++) {
      const x = i * u;
      ctx.beginPath();
      ctx.moveTo(x + u * 0.1, y1); ctx.lineTo(x + u * 0.1, y0); ctx.lineTo(x + u * 0.9, y0); ctx.lineTo(x + u * 0.9, y1);
      ctx.lineTo(x + u * 0.35, y1); ctx.lineTo(x + u * 0.35, mid); ctx.lineTo(x + u * 0.65, mid);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/**
 * Where a held stone will land: A GHOST OF THE STONE, half-transparent, with
 * the aimed point glowing softly under it (MoveLights lights it). There was a
 * column of light rising from the point too; Nikk, via Lumenfold: "remove the
 * vertical light column/beam during stone placement. Show only a
 * half-transparent ghost stone at the aimed intersection with a small soft
 * glow directly underneath it."
 */
function GhostStone({ x, z, stone }: { x: number; z: number; stone: string }) {
  const radius = goRadius();
  return <mesh position={[x, GO_SURFACE + radius * 0.46, z]} scale={[radius, radius * 0.46, radius]} raycast={noRaycast}>
    <sphereGeometry args={[1, 24, 12]} />
    <meshStandardMaterial color={stone} transparent opacity={0.5} depthWrite={false} roughness={0.3} />
  </mesh>;
}

/**
 * The WHOLE BOARD takes the press: where the laser meets it is snapped to the
 * nearest free intersection (go-snap.ts), that one point lights, a ghost of the
 * stone appears on it (GhostStone), and pressing puts the stone there.
 *
 * Dots used to be the only targets, each a little smaller than a square: a ray
 * between two of them pressed nothing, and a shaky one flickered on and off a
 * dot. Then every legal point glowed as a hint, until Baiwei asked for only the
 * target. Now just the aimed point is lit.
 */
function MoveLights({ item, reducedMotion, onPlace }: { item: GoRoomItem; reducedMotion: boolean; onPlace: (x: number, y: number) => void }) {
  const dots = useRef<THREE.InstancedMesh>(null), material = useRef<THREE.MeshBasicMaterial>(null), frame = useRef<THREE.Group>(null);
  const [aim, setAim] = useState<GoMove | null>(null);
  // Where the column stood when the press went DOWN: that is where the stone
  // goes, even if the ray shivers before it comes up.
  const pressed = useRef<GoMove | null>(null);
  const texture = useMemo(glowTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const moves = useMemo(() => item.liftedColour === null ? [] : legalGoMoves(item.stones, item.size, item.activeColour), [item.stones, item.size, item.activeColour, item.liftedColour]);
  useEffect(() => { setAim(null); pressed.current = null; }, [moves]);
  const hover = aim ? moves.findIndex((move) => move.x === aim.x && move.y === aim.y) : -1;
  useLayoutEffect(() => {
    if (!dots.current) return;
    const object = new THREE.Object3D(), width = GO_PITCH * 0.88;
    // ONLY THE POINT BEING AIMED AT, or none. Baiwei: "While a stone hovers over
    // the board, preview only the target intersection (or none), not every
    // spot." Every legal point used to glow at once, which made the board
    // shimmer exactly when the one point that mattered needed to stand out.
    // The legal points still decide where the magnet can snap (goSnap).
    let lit = 0;
    moves.forEach((move, i) => {
      if (i !== hover) return;
      object.position.set(goPoint(move.x, item.size), GO_SURFACE + 0.003, goPoint(move.y, item.size));
      object.rotation.x = -Math.PI / 2; object.scale.setScalar(width * 1.25); object.updateMatrix();
      dots.current!.setMatrixAt(lit, object.matrix);
      dots.current!.setColorAt(lit, new THREE.Color().setScalar(2));
      lit += 1;
    });
    dots.current.count = lit; dots.current.instanceMatrix.needsUpdate = true;
    if (dots.current.instanceColor) dots.current.instanceColor.needsUpdate = true;
    dots.current.computeBoundingSphere();
  }, [moves, item.size, hover]);
  useFrame(({ clock }) => { if (material.current) material.current.opacity = reducedMotion ? 0.8 : 0.62 + Math.sin(clock.elapsedTime * 2.8) * 0.22; });
  const aimAt = (event: ThreeEvent<PointerEvent | MouseEvent>): GoMove | null => {
    if (!frame.current) return null;
    const local = frame.current.worldToLocal(event.point.clone());
    return goSnap({ x: local.x, z: local.z }, moves, item.size);
  };
  const catcher = goExtent(item.size) + GO_PITCH;
  return <group ref={frame}>
    <instancedMesh ref={dots} args={[undefined, undefined, item.size * item.size]} frustumCulled={false} raycast={noRaycast}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={material} map={texture} color={ACCENTS[item.activeColour]} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
    </instancedMesh>
    {moves.length > 0 && <mesh position={[0, GO_SURFACE + 0.004, 0]} rotation-x={-Math.PI / 2}
      onPointerMove={(event) => { event.stopPropagation(); setAim(aimAt(event)); }}
      onPointerOut={() => { setAim(null); pressed.current = null; }}
      onPointerDown={(event) => { event.stopPropagation(); pressed.current = aimAt(event); }}
      onClick={(event) => {
        event.stopPropagation();
        const at = pressed.current ?? aimAt(event);
        pressed.current = null;
        if (at) onPlace(at.x, at.y);
      }}>
      <planeGeometry args={[catcher, catcher]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>}
    {aim && <GhostStone x={goPoint(aim.x, item.size)} z={goPoint(aim.y, item.size)} stone={item.colours[item.activeColour]} />}
  </group>;
}

/**
 * What the board fades behind while SETTINGS is open — Baiwei: "Maybe the
 * board with stones could fade out a little bit while the settings appear."
 * It fades in and out rather than switching, and lies just above the stones,
 * under the sheet (go-controls.ts). Drawn before the sheet's words
 * (renderOrder), so it can never tint them.
 */
function Veil({ open, y, width, opacity, reducedMotion }: { open: boolean; y: number; width: number; opacity: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null), material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, delta) => {
    if (!mesh.current || !material.current) return;
    const target = open ? opacity : 0;
    material.current.opacity = reducedMotion ? target : THREE.MathUtils.damp(material.current.opacity, target, 14, delta);
    mesh.current.visible = material.current.opacity > 0.01;
  });
  return <mesh ref={mesh} position-y={y} rotation-x={-Math.PI / 2} renderOrder={-1} visible={false} raycast={noRaycast}>
    <planeGeometry args={[width, width]} />
    <meshBasicMaterial ref={material} color="#ecdcbf" transparent opacity={0} depthWrite={false} />
  </mesh>;
}

type StoneTarget = { id: string; at: Point3; colour: string; radius: number; from: Point3 };
/** Stable IDs let a captured stone fly to its capture ring instead of disappearing. */
function Stones({ targets, reducedMotion }: { targets: StoneTarget[]; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const motions = useRef(new Map<string, { p: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number }>());
  const scratch = useMemo(() => ({ object: new THREE.Object3D(), colour: new THREE.Color() }), []);
  useLayoutEffect(() => {
    const keep = new Set(targets.map((target) => target.id));
    for (const id of motions.current.keys()) if (!keep.has(id)) motions.current.delete(id);
    for (const target of targets) {
      const to = new THREE.Vector3(...xyz(target.at));
      const old = motions.current.get(target.id);
      if (!old) { const from = new THREE.Vector3(...xyz(target.from)); motions.current.set(target.id, { p: from.clone(), from, to, t: 0 }); }
      else if (!old.to.equals(to)) { old.from.copy(old.p); old.to.copy(to); old.t = 0; }
    }
  }, [targets]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    targets.forEach((target, i) => {
      const motion = motions.current.get(target.id); if (!motion) return;
      motion.t = reducedMotion ? 1 : Math.min(1, motion.t + delta / 0.48);
      const ease = 1 - (1 - motion.t) ** 3;
      motion.p.lerpVectors(motion.from, motion.to, ease);
      motion.p.y += Math.sin(Math.PI * motion.t) * 0.15;
      scratch.object.position.copy(motion.p); scratch.object.scale.set(target.radius, target.radius * 0.46, target.radius);
      scratch.object.updateMatrix(); mesh.current!.setMatrixAt(i, scratch.object.matrix);
      mesh.current!.setColorAt(i, scratch.colour.set(target.colour));
    });
    mesh.current.count = targets.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, targets.length)]} frustumCulled={false} raycast={noRaycast} castShadow>
    <sphereGeometry args={[1, 28, 16]} /><meshPhysicalMaterial roughness={0.22} clearcoat={0.7} clearcoatRoughness={0.2} metalness={0.04} />
  </instancedMesh>;
}


/**
 * The capture ring's line: a thin arc round the outside of a bowl, that the
 * captured stones sit on like beads. Delicate by request, the same colour as the
 * bowl's rim, and never a target: it is a place, not a control. A second arc
 * only once the first row is full. See GO_RING in shared/go-layout.
 */
function CaptureRing({ index, item, rows, colour }: { index: number; item: GoRoomItem; rows: 1 | 2; colour: string }) {
  return <>{([0, 1] as const).slice(0, rows).map((row) => {
    const arc = goRingArc(index, item.colours.length, item.size, row);
    return <group key={row} position={[arc.centre.x, GO_RING.y + 0.001, arc.centre.z]} rotation-y={-arc.start}>
      <mesh rotation-x={Math.PI / 2} raycast={noRaycast}>
        <torusGeometry args={[arc.radius, 0.0028, 6, 72, arc.length]} />
        <meshStandardMaterial color={colour} roughness={0.5} transparent opacity={0.75} />
      </mesh>
    </group>;
  })}</>;
}

function Bowl({ item, index, reducedMotion, onLift, onPass, winner }: { item: GoRoomItem; index: number; reducedMotion: boolean; onLift: () => void; onPass: () => void; winner: boolean }) {
  const pulse = useRef<THREE.MeshBasicMaterial>(null), rim = useRef<THREE.MeshStandardMaterial>(null);
  const active = index === item.activeColour;
  /**
   * A DELICATE GLOW UNDER THE BOWL WHOSE TURN IT IS — and only until its stone
   * is lifted. Baiwei: "Selecting a stone should show a delicate glow under its
   * source bowl; once lifted and carried for placement, that bowl glow should
   * turn off." It used to be a bright 72cm pool that stayed on all turn,
   * competing with the board just when the board was what mattered.
   */
  // And not once the game is over: nobody's turn any more.
  const glowing = active && item.liftedColour === null && !item.ended;
  const look = GO_SURFACE_LOOKS[item.surface] ?? GO_SURFACE_LOOKS.bamboo;
  const relief = useMemo(() => bowlRelief(look.bowl.relief), [look.bowl.relief]);
  useEffect(() => () => relief.dispose(), [relief]);
  const colour = item.colours[index], accent = ACCENTS[index];
  const position = goBowl(index, item.colours.length, item.size);
  const nameAt = goLabelOffset(index, item.colours.length, 0.24), passAt = goLabelOffset(index, item.colours.length, 0.35);
  const texture = useMemo(glowTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const profile = useMemo(() => [[0.055, -0.064], [0.09, -0.057], [0.139, -0.026], [0.17, 0.025], [0.18, 0.063], [0.173, 0.072], [0.163, 0.062], [0.155, 0.028], [0.125, -0.009], [0.078, -0.038], [0, -0.041]].map(([r, y]) => new THREE.Vector2(r, y)), []);
  const stock = useMemo(() => Array.from({ length: 13 }, (_, i) => {
    const angle = i * 2.4, r = i < 9 ? 0.095 : 0.048;
    const at = { x: Math.cos(angle) * r, y: i < 9 ? 0.029 : 0.062, z: Math.sin(angle) * r };
    return { id: `stock-${i}`, at, from: at, colour, radius: goRadius() };
  }), [colour]);
  useFrame(({ clock }) => {
    const wave = reducedMotion ? 0.7 : 0.65 + Math.sin(clock.elapsedTime * 2.8) * 0.25;
    // "Increase the existing under-bowl turn glow just a little, still soft
    // and comfortable in VR" — a little stronger and a little wider.
    // THE WINNER'S BOWL GLOWS once the game is over, steadily rather than
    // pulsing: Baiwei, "can we have the winner shown by highlight under the
    // bowl with stones". Both bowls on a tie.
    if (pulse.current) pulse.current.opacity = winner ? 0.85 : glowing ? wave * 0.7 : 0;
    if (rim.current) rim.current.emissiveIntensity = winner ? 0.85 : glowing ? wave * 0.7 : 0;
  });
  const captures = item.captures.filter((stone) => stone.by === index).length;
  return <>
    {/* In proportion to the board: see goBowlScale. */}
    <group position={xyz(position)} scale={goBowlScale(item.size)} onClick={(event) => { event.stopPropagation(); onLift(); }}>
      <mesh position={[0, -0.055, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <planeGeometry args={[0.56, 0.56]} /><meshBasicMaterial ref={pulse} map={texture} color={accent} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh castShadow><latheGeometry args={[profile, 48]} /><meshPhysicalMaterial color={look.bowl.body} roughness={look.bowl.roughness} clearcoat={look.bowl.clearcoat} bumpMap={relief} bumpScale={look.bowl.relief === "lotus" ? 1.2 : 1.6} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.066, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.172, 0.007, 8, 64]} /><meshStandardMaterial ref={rim} color={active ? accent : look.bowl.rim} emissive={accent} roughness={0.3} metalness={0.4} />
      </mesh>
      <Stones targets={stock} reducedMotion />
      {/* Invisible contact cap also makes the stones in the bowl clickable. */}
      <mesh position={[0, 0.045, 0]}><sphereGeometry args={[0.17, 16, 8]} /><meshBasicMaterial visible={false} /></mesh>
      {/* Clear of the capture ring (goLabelOffset), with the count under the name. */}
      <Text position={[nameAt.x, -0.042, nameAt.z]} rotation-x={-Math.PI / 2} fontSize={0.039} lineHeight={1.25} textAlign="center" color={active ? accent : "#c8b49a"} raycast={noRaycast}>
        {`${NAMES[index].toUpperCase()}${winner ? " · WINS" : active && !item.ended ? " · TO PLAY" : ""}${captures ? `\n${captures} CAPTURED` : ""}`}
      </Text>
      {/*
        PASS, at the bowl whose turn it is — the one place a player already
        looks, for two players or eight. Nikk (4504): "the game ends when both
        players pass". Not while a stone is in the air: pass OR play, not both.
      */}
      {/* Outlined in the bowl's own colour, and it says when it ends the game
          (Baiwei: "not very clear ... that you have to pass and the game is
          done"). Not before the first stone: see canPass. */}
      {active && canPass(item) && <TableButton label={passLabel(item)} onTap={onPass} outline={accent}
        width={0.34} depth={0.1} fontSize={0.04} at={[passAt.x, -0.04, passAt.z]} />}
    </group>
    <CaptureRing index={index} item={item} rows={captures > goRingCapacity(index, item.colours.length, item.size, 0) ? 2 : 1} colour={look.bowl.rim} />
  </>;
}

/**
 * WHOSE LAND IS WHOSE: on every empty point only one colour surrounds
 * (shared/go-score.ts), a square in that colour's OWN stone colour on a
 * slightly larger one in its accent — the way Go programs mark territory.
 *
 * WHY TWO SQUARES. The first version was one small accent square, and in the
 * harness it was drawn and could not be seen: a 5cm gold square on a beige
 * board, a few pixels tall from a seat. Proven by blowing one up twenty times
 * (it appeared, red, exactly where it should). The stone colour reads on the
 * light board, the accent edge on the dark stone one, and together they read
 * on both. Fainter while the count is only provisional.
 */
function Territory({ item }: { item: GoRoomItem }) {
  const shown = item.ended || item.territoryShown;
  const points = useMemo(
    () => (shown ? countGo(item.stones, item.size, item.colours.length).territory : []),
    [shown, item.stones, item.size, item.colours.length],
  );
  const edge = useRef<THREE.InstancedMesh>(null), fill = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const place = new THREE.Object3D(), colour = new THREE.Color();
    const lay = (target: THREE.InstancedMesh | null, lift: number, paint: (owner: number) => string) => {
      if (!target) return;
      points.forEach((point, index) => {
        place.position.set(goPoint(point.x, item.size), GO_SURFACE + lift, goPoint(point.y, item.size));
        place.rotation.set(-Math.PI / 2, 0, 0);
        place.updateMatrix();
        target.setMatrixAt(index, place.matrix);
        target.setColorAt(index, colour.set(paint(point.colour)));
      });
      target.count = points.length;
      target.instanceMatrix.needsUpdate = true;
      if (target.instanceColor) target.instanceColor.needsUpdate = true;
    };
    lay(edge.current, 0.0022, (owner) => ACCENTS[owner]);
    lay(fill.current, 0.0026, (owner) => item.colours[owner]);
  }, [points, item.size, item.colours]);
  if (!points.length) return null;
  const opacity = item.ended ? 1 : 0.6;
  // frustumCulled off, like the move lights: an instanced mesh is culled by its
  // one small square at the table's origin, under the table, not by where its
  // instances are.
  return <group key={points.length}>
    <instancedMesh ref={edge} args={[undefined, undefined, points.length]} raycast={noRaycast} renderOrder={1} frustumCulled={false}>
      <planeGeometry args={[GO_PITCH * 0.5, GO_PITCH * 0.5]} />
      <meshBasicMaterial transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </instancedMesh>
    <instancedMesh ref={fill} args={[undefined, undefined, points.length]} raycast={noRaycast} renderOrder={2} frustumCulled={false}>
      <planeGeometry args={[GO_PITCH * 0.36, GO_PITCH * 0.36]} />
      <meshBasicMaterial transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  </group>;
}

/**
 * A thin rectangle, drawn flat — the stroke of an outline button. Baiwei asked
 * for SETTINGS and MOVE as "outline buttons (thin stroke, no filled
 * background)"; PASS takes the same look in its bowl's colour, so the front row
 * reads as one set.
 */
function Outline({ width, depth, colour, stroke = 0.0035 }: { width: number; depth: number; colour: string; stroke?: number }) {
  const edges: [number, number, number, number][] = [
    [0, depth / 2 - stroke / 2, width, stroke], [0, -depth / 2 + stroke / 2, width, stroke],
    [width / 2 - stroke / 2, 0, stroke, depth], [-width / 2 + stroke / 2, 0, stroke, depth],
  ];
  return <group rotation-x={-Math.PI / 2} position-y={0.0008}>
    {edges.map(([x, y, w, h], index) => <mesh key={index} position={[x, y, 0]} raycast={noRaycast}>
      <planeGeometry args={[w, h]} /><meshBasicMaterial color={colour} toneMapped={false} />
    </mesh>)}
  </group>;
}

function TableButton({ label, at, onTap, width = 0.24, depth = 0.105, fontSize = 0.029, outline }: {
  label: string; at: [number, number, number]; onTap: () => void; width?: number; depth?: number; fontSize?: number;
  /** Draw it as an outline in this colour instead of a filled pad. */
  outline?: string;
}) {
  const [hover, setHover] = useState(false);
  return <group position={at} onClick={(event) => { event.stopPropagation(); onTap(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
    {outline
      // Still a full-size plane, so the whole button is a target; only a hint of fill on hover.
      ? <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[width, depth]} /><meshBasicMaterial color={outline} transparent opacity={hover ? 0.16 : 0} depthWrite={false} /></mesh>
      : <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[width, depth]} /><meshBasicMaterial color={hover ? "#78654b" : "#483b2e"} /></mesh>}
    {outline && <Outline width={width} depth={depth} colour={outline} />}
    <Text position-y={0.001} rotation-x={-Math.PI / 2} fontSize={fontSize} color={outline ?? "#f1dfbd"} raycast={noRaycast}>{label}</Text>
  </group>;
}

type TableContext = { you: string | null; peopleRef: RefObject<WirePerson[]>;
  items: RoomItem[]; reservations: RefObject<Map<string, { id: string; until: number }>>;
  /** Apply a table as the server just answered with it — see withFresher. */
  onItem: (item: RoomItem) => void;
  /** Take a table out of the room here, now: it was deleted. */
  onRemoved: (id: string) => void };
function GoTable({ item, reducedMotion, context }: { item: GoRoomItem; reducedMotion: boolean; context: TableContext }) {
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const pending = useRef(false), held = useRef<THREE.Mesh>(null);
  const contacts = useRef({ left: idleGoTouch(), right: idleGoTouch() });
  const lastHeld = useRef<Point3 | null>(null);
  /**
   * THE GLOW UNDER A PICKED-UP STONE, from the moment it leaves the bowl:
   * "When a stone is picked up from the bowl, give it that same subtle glow
   * immediately, before it reaches the board." It follows the stone.
   */
  const heldGlow = useRef<THREE.Mesh>(null);
  const heldGlowMap = useMemo(glowTexture, []);
  useEffect(() => () => heldGlowMap.dispose(), [heldGlowMap]);
  const liftAge = useRef(0);
  useEffect(() => { liftAge.current = 0; }, [item.liftedColour, item.carrier?.by, item.carrier?.hand]);
  const previous = useRef(new Set(item.stones.map((stone) => stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`)));
  const wood = useMemo(woodTexture, []);
  useEffect(() => () => wood.dispose(), [wood]);
  const look = GO_SURFACE_LOOKS[item.surface] ?? GO_SURFACE_LOOKS.bamboo;
  const surface = useMemo(() => surfaceTexture(look.grain, look.base, goBoardWidth(item.size)), [look.grain, look.base, item.size]);
  useEffect(() => () => surface.dispose(), [surface]);
  const radius = goRadius(item.size);
  const targets = useMemo(() => {
    const result: StoneTarget[] = item.stones.map((stone) => {
      const id = stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`;
      const at = { x: goPoint(stone.x, item.size), y: GO_SURFACE + radius * 0.46, z: goPoint(stone.y, item.size) };
      const bowl = goBowl(stone.colour, item.colours.length, item.size);
      return { id, at, from: previous.current.has(id) ? at : lastHeld.current ?? { ...bowl, y: bowl.y + 0.3 }, colour: item.colours[stone.colour], radius };
    });
    item.colours.forEach((_, index) => {
      // Along the bowl's capture ring, first taken first. More than the ring
      // shows are still counted by the bowl's name; only the newest are drawn.
      item.captures.filter((stone) => stone.by === index).slice(-goRingSlots(index, item.colours.length, item.size)).forEach((stone, n) => {
        const at = goRingSpot(index, item.colours.length, item.size, n);
        result.push({ id: stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`, at,
          from: at, colour: item.colours[stone.colour], radius: goRingStone(item.size) });
      });
    });
    return result;
  }, [item.stones, item.captures, item.colours, item.size, radius]);
  useEffect(() => { previous.current = new Set(item.stones.map((stone) => stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`)); }, [item.stones]);
  useEffect(() => { setNotice(""); }, [item.revision]);
  /**
   * Changes go through go-table-writer.ts, where the rules that fixed Nikk's
   * headset live and are tested against a socket that never delivers: apply the
   * answer at once, catch up on "The table changed", retry a settings change
   * once from the fresh table, never retry a move. It shares `pending` with the
   * hand-contact loop below, which reads it every frame.
   */
  const latest = useRef(item);
  latest.current = item;
  const applyItem = useRef(context.onItem);
  applyItem.current = context.onItem;
  const writer = useMemo(() => goTableWriter({
    current: () => latest.current,
    apply: (one) => applyItem.current(one),
    api: {
      configure: (id, change) => space.configureGo(id, change as Parameters<typeof space.configureGo>[1]),
      act: (id, action) => space.actOnGo(id, action as Parameters<typeof space.actOnGo>[1]),
      items: () => space.roomItems(),
    },
    notice: setNotice,
    pending,
  }), []);
  const act = (action: Parameters<typeof space.actOnGo>[1]) => writer.act(action);
  const configure = (
    change: Parameters<typeof space.configureGo>[1],
    again?: (fresh: GoRoomItem) => Parameters<typeof space.configureGo>[1] | null,
  ) => writer.configure(change, again as ((fresh: GoRoomItem) => Record<string, unknown> | null) | undefined);
  useFrame(({ clock }, delta) => {
    const now = performance.now();
    if (context.you) for (const side of ["left", "right"] as const) {
      const sample = goHandInput[side];
      const point = sample && now - sample.at < 120 ? goLocal(sample.contact, item) : null;
      const holding = item.liftedColour !== null && item.carrier?.by === context.you && item.carrier.hand === side;
      const reservation = context.reservations.current.get(side);
      const otherTable = context.items.some((table) => table.id !== item.id && table.carrier?.by === context.you && table.carrier.hand === side);
      const canLift = item.liftedColour === null && !item.ended && !pending.current && !otherTable && (!reservation || reservation.until < now || reservation.id === item.id);
      const next = stepGoTouch(contacts.current[side], { point, item, holding, canLift, now, pending: pending.current });
      contacts.current[side] = next.state;
      if (next.action && !pending.current) {
        if (next.action.action === "lift") {
          context.reservations.current.set(side, { id: item.id, until: now + 5000 });
          void act({ action: "lift", hand: side, colour: item.activeColour }).then((ok) => { if (!ok) context.reservations.current.delete(side); });
        } else void act(next.action);
      }
    }
    if (!held.current || item.liftedColour === null) return;
    if (item.carrier?.hand) {
      const side = item.carrier.hand;
      const sample = goHandInput[side];
      const remote = context.peopleRef.current.find((person) => person.actorId === item.carrier!.by)?.hands[side];
      // YOUR STONE IS AT YOUR FINGERTIP, where the touch that plays it is (Nikk
      // 4452). It floated at the palm while the fingertip played the board. See
      // heldStoneWorld in shared/go-touch.ts.
      const yours = item.carrier.by === context.you;
      const world = heldStoneWorld({
        yours,
        fingertip: sample && now - sample.at < 120 ? sample.contact : null,
        theirWrist: remote ?? null,
      });
      if (world) {
        const local = goLocal(world, item);
        const p = yours ? restOnBoard(local, radius * 0.46) : local;
        // Tracking is functional motion, never disabled by reduced-motion preference.
        liftAge.current += delta;
        const amount = reducedMotion || liftAge.current > 0.35 ? 1 : 1 - Math.exp(-delta * 14);
        held.current.position.x += (p.x - held.current.position.x) * amount;
        held.current.position.y += (p.y - held.current.position.y) * amount;
        held.current.position.z += (p.z - held.current.position.z) * amount;
      }
      // Lost tracking freezes the stone in flight; it never places a remembered hand.
    } else {
      const bowl = goBowl(item.liftedColour, item.colours.length, item.size);
      const height = bowl.y + 0.29 + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 2.2) * 0.012);
      held.current.position.y = reducedMotion ? height : THREE.MathUtils.damp(held.current.position.y, height, 7, delta);
    }
    lastHeld.current = { x: held.current.position.x, y: held.current.position.y, z: held.current.position.z };
    heldGlow.current?.position.set(held.current.position.x, held.current.position.y - radius * 0.46 - 0.003, held.current.position.z);
  });
  const offsets = Array.from({ length: item.size }, (_, n) => goPoint(n, item.size));
  /**
   * CARRYING THE TABLE, the same gesture the panels use.
   *
   * Nikk asked for "a standard move system like in the vision pro, or other
   * places where you grab a window and drag it left or right or up or down, or
   * forward and backward", and then "also lets allow for moving the go board in
   * the same way" — pointing at the X/Y/Z nudge pad that used to be here:
   * "(now go board movement settings are just buttons which is super weird)".
   *
   * So the table is taken hold of and carried at the distance it was grabbed
   * at, going wherever the ray points, with the wheel for nearer and further.
   * The arithmetic is `shared/grab-move.ts`, shared with the panels, and the
   * reasons it is not a cast at a level plane are written down there.
   */
  const body = useRef<THREE.Group>(null);
  const grab = useRef<Grab | null>(null);
  const grabbedPointer = useRef<number | null>(null);
  const want = useRef<Vec3 | null>(null);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const caster = useMemo(() => ({ ray: new THREE.Raycaster(), ndc: new THREE.Vector2() }), []);
  const asVec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });

  /**
   * ONE CARRIER AT A TIME — where Nikk found it: two people carried this table
   * at once, and because a carry is retried after "the table changed", both
   * succeeded and the later simply overwrote the earlier. The carry claims the
   * table in the background (grab-hold.ts); if somebody else has it, the table
   * leaves your hand and the notice says who.
   */
  const refusedCarry = useRef<(why: string) => void>(() => undefined);
  const tableHold = useMemo(
    () => grabHold({ thing: `item:${item.id}`, api: space.hold, refused: (why) => refusedCarry.current(why) }),
    [item.id],
  );
  useEffect(() => () => tableHold.release(), [tableHold]);

  /**
   * Back where the room has it. Needed by hand: the group's position is a prop,
   * and a prop that has not changed is not applied again, so a table let go of
   * without a new position would stay wherever the carry had left it.
   */
  const putTableBack = useCallback(() => {
    const node = body.current, at = latest.current.position;
    if (node) node.position.set(at.x, at.y, at.z);
    invalidate();
  }, [invalidate]);

  const rayFromScreen = useCallback((clientX: number, clientY: number): Ray | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    caster.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    caster.ray.setFromCamera(caster.ndc, camera);
    return { origin: asVec(caster.ray.ray.origin), direction: asVec(caster.ray.ray.direction) };
  }, [camera, gl, caster]);

  const steerTable = useCallback((ray: Ray | null) => {
    const hold = grab.current;
    if (!ray || !hold) return;
    const to = grabbedTo(ray, hold);
    // The server keeps a table's height between -0.5 and 5; stopping the
    // gesture at the limit beats letting it run and refusing it at the end.
    want.current = { x: to.x, y: clamp(to.y, -0.5, 5), z: to.z };
    invalidate();
  }, [invalidate]);

  /**
   * LET GO EXACTLY ONCE. A mouse delivers the release twice — the window's
   * `pointerup` and the bar's own — while a headset delivers only the bar's.
   */
  const dropTable = useCallback(() => {
    if (!grab.current) return;
    const at = want.current;
    grab.current = null; want.current = null; grabbedPointer.current = null;
    setCarrying(false);
    if (!at) { tableHold.release(); return; }
    const place = { position: { x: at.x, y: at.y, z: at.z, rotationY: item.position.rotationY } };
    // Where it was put does not depend on anything else about the table.
    const saved = configure(place, () => place);
    // Let go of the claim only once the save has landed, or it could arrive
    // first and let somebody else in ahead of this very drop.
    tableHold.release(saved);
    void saved.then((ok) => { if (!ok && !grab.current) putTableBack(); });
  }, [item.position.rotationY, putTableBack, tableHold]);

  /**
   * THE LISTENERS GO ON AT THE MOMENT OF THE GRAB, not on the next render.
   *
   * They used to be a `useEffect` gated on a `carrying` state flag, which is
   * the obvious shape and is wrong: the effect does not run until React has
   * re-rendered, so a drag that starts and finishes inside that gap never gets
   * a single `pointermove` and the table does not move at all. I found it by
   * dragging the bar and watching the position not change — three times, while
   * blaming my aim, because a grab that takes hold and then ignores you looks
   * exactly like a grab that missed.
   *
   * A flick of a controller is faster than a render. So the window is listening
   * before this handler returns.
   */
  const letGoOfTable = useRef<(() => void) | null>(null);

  const listenWhileCarrying = useCallback(() => {
    letGoOfTable.current?.();
    const move = (event: PointerEvent) => steerTable(rayFromScreen(event.clientX, event.clientY));
    const up = () => { letGoOfTable.current?.(); dropTable(); };
    const wheel = (event: WheelEvent) => {
      if (!grab.current) return;
      event.preventDefault();
      grab.current = pushPull(grab.current, -event.deltaY * 0.0022);
      invalidate();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("wheel", wheel, { passive: false });
    letGoOfTable.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
      letGoOfTable.current = null;
    };
  }, [steerTable, rayFromScreen, dropTable, invalidate]);

  // Never leave a listener behind on a table that has gone away.
  useEffect(() => () => letGoOfTable.current?.(), []);

  refusedCarry.current = (why: string) => {
    if (!grab.current) return;
    letGoOfTable.current?.();
    grab.current = null; want.current = null; grabbedPointer.current = null;
    setCarrying(false);
    putTableBack();
    setNotice(why);
  };

  useFrame(() => {
    const node = body.current, at = want.current;
    if (!node || !at) return;
    node.position.set(at.x, at.y, at.z);
  });

  const takeTable = (event: ThreeEvent<PointerEvent>) => {
    if (item.liftedColour !== null) {
      setNotice("Place or return the flying stone before moving the table.");
      return;
    }
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    grab.current = beginGrab(
      { origin: asVec(event.ray.origin), direction: asVec(event.ray.direction) },
      { x: item.position.x, y: item.position.y, z: item.position.z },
    );
    tableHold.take();
    grabbedPointer.current = event.pointerId;
    (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
    setNotice("");
    setCarrying(true);
    listenWhileCarrying();
  };

  /**
   * DELETE THIS BOARD, in two presses. The first arms it and says what the
   * second will do; the second, within CONFIRM_DELETE_MS, deletes. A game is
   * the one thing here that cannot be put back, and a laser from across the
   * room is exactly how a button gets pressed by accident.
   */
  const [deleteArmedAt, setDeleteArmedAt] = useState<number | null>(null);
  useEffect(() => {
    if (deleteArmedAt === null) return;
    const disarm = setTimeout(() => setDeleteArmedAt(null), CONFIRM_DELETE_MS);
    return () => clearTimeout(disarm);
  }, [deleteArmedAt]);
  const deleteTable = async () => {
    try {
      await space.removeRoomItem(item.id);
      context.onRemoved(item.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete the table.");
    }
  };

  const onSetting = (id: string) => {
    const change = goSettingFor(item, id, Date.now(), deleteArmedAt);
    if (!change) return;
    if (change.kind !== "delete") setDeleteArmedAt(null);
    if (change.kind === "close") { setSettingsOpen(false); return; }
    if (change.kind === "refused") { setNotice(change.why); return; }
    if (change.kind === "delete") {
      if (!change.confirmed) {
        setDeleteArmedAt(Date.now());
        setNotice(goSettingCost(item, change) ?? "");
        return;
      }
      setDeleteArmedAt(null);
      void deleteTable();
      return;
    }
    setNotice(goSettingCost(item, change) ?? "");
    const request = goSettingRequest(item, id);
    if (request) void configure(request, (fresh) => goSettingRequest(fresh, id));
  };

  const controls = useMemo(() => goControls(item, deleteArmedAt !== null), [item, deleteArmedAt]);
  const won = useMemo(() => winners(item), [item]);
  const result = useMemo(() => resultRows(item), [item]);
  const showControls = goControlsShown(item);
  // Lifting a stone puts the glowing intersections on the board the sheet was
  // lying on, so the sheet closes rather than waiting underneath them.
  useEffect(() => { if (!showControls) setSettingsOpen(false); }, [showControls]);
  const stars = goStarPoints(item.size);
  const lifted = item.liftedColour === null ? null : goBowl(item.liftedColour, item.colours.length, item.size);
  const wide = item.colours.length > 2, deck = goDeckWidth(item.size, item.colours.length);
  const extent = goExtent(item.size), boardWidth = goBoardWidth(item.size), edge = deck / 2;
  return <group ref={body} position={[item.position.x, item.position.y, item.position.z]} rotation-y={item.position.rotationY} scale={item.scale} pointerEventsType={GO_TABLE_POINTERS}>
    {/*
      NOTHING BELOW THIS LINE CATCHES A POINTER UNLESS IT DOES SOMETHING.

      Nikk, in a headset: "there seems to be loads of colliders all over the
      model... if my hand is above the board it just hits colliders and the
      pointer is blocked". R3F raycasts a handler-bearing group RECURSIVELY, and
      RoomItems wraps every table in one that claims the pointer — so the desk,
      the legs, the rim and the playing surface were all targets that did
      nothing but stop the ray. They take no rays now. table-colliders.test.ts
      fails if anything new is added here without saying which it is.
    */}
    {item.deskVisible && <RoundedBox args={[deck, 0.075, deck]} radius={0.035} smoothness={4} position={[0, 0.705, 0]} receiveShadow raycast={noRaycast}>
      <meshStandardMaterial map={wood} color="#765b49" roughness={0.42} metalness={0.06} />
    </RoundedBox>}
    <RoundedBox args={[boardWidth + 0.06, 0.105, boardWidth + 0.06]} radius={0.035} smoothness={4} position={[0, 0.79, 0]} castShadow receiveShadow raycast={noRaycast}>
      <meshPhysicalMaterial color={carrying ? look.rimCarrying : look.rim} roughness={look.grain === "stone" ? 0.7 : 0.38} clearcoat={look.grain === "stone" ? 0.05 : 0.4} />
    </RoundedBox>
    <RoundedBox args={[boardWidth, 0.025, boardWidth]} radius={0.01} smoothness={3} position={[0, GO_SURFACE - 0.0125, 0]} receiveShadow raycast={noRaycast}>
      <meshPhysicalMaterial map={surface} roughness={look.roughness} clearcoat={look.clearcoat} />
    </RoundedBox>
    {item.deskVisible && [-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * edge * 0.6, 0.34, z * edge * 0.6]} castShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.07, 0.045, 0.68, 12]} /><meshStandardMaterial color="#382720" roughness={0.4} />
    </mesh>))}
    {offsets.map((offset, index) => {
      const width = index === 0 || index === item.size - 1 ? 0.0035 : 0.0025;
      // Carved stone: a lit lip beside each groove, never overlapping it.
      const lip = width / 2 + 0.0007;
      return <group key={index}>
        <mesh position={[offset, GO_SURFACE + 0.0015, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[width, extent]} /><meshBasicMaterial color={look.lines} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>
        <mesh position={[0, GO_SURFACE + 0.0016, offset]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[extent, width]} /><meshBasicMaterial color={look.lines} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>
        {look.lineLight && <mesh position={[offset + lip, GO_SURFACE + 0.0014, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[0.0012, extent]} /><meshBasicMaterial color={look.lineLight} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>}
        {look.lineLight && <mesh position={[0, GO_SURFACE + 0.0014, offset + lip]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[extent, 0.0012]} /><meshBasicMaterial color={look.lineLight} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>}
      </group>;
    })}
    {stars.flatMap((x) => stars.map((y) => <mesh key={`star-${x}-${y}`} position={[goPoint(x, item.size), GO_SURFACE + 0.001, goPoint(y, item.size)]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
      <circleGeometry args={[0.0045, 16]} /><meshBasicMaterial color={look.lines} />
    </mesh>))}
    <MoveLights item={item} reducedMotion={reducedMotion} onPlace={(x, y) => void act({ action: "place", x, y })} />
    <Territory item={item} />
    <Stones targets={targets} reducedMotion={reducedMotion} />
    {item.colours.map((_, index) => <Bowl key={index} item={item} index={index} reducedMotion={reducedMotion}
      onPass={() => void act({ action: "pass", colour: index })}
      winner={won.includes(index)}
      onLift={() => {
        if (index !== item.activeColour || item.liftedColour !== null) return;
        // A poke click and the physical-contact adapter can arrive in either order.
        // Both must claim the touching hand, never turn its stone into a mouse lift.
        const hand = (["left", "right"] as const).find((side) => {
          const sample = goHandInput[side];
          return sample && performance.now() - sample.at < 120 && goTouchBowl(goLocal(sample.contact, item), item);
        });
        void act({ action: "lift", colour: index, ...(hand ? { hand } : {}) });
      }} />)}
    {lifted && <mesh key={`held-glow-${item.activeColour}`} ref={heldGlow} position={[lifted.x, lifted.y + 0.06 - radius * 0.46 - 0.003, lifted.z]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
      <planeGeometry args={[GO_PITCH * 1.1, GO_PITCH * 1.1]} />
      <meshBasicMaterial map={heldGlowMap} color={ACCENTS[item.activeColour]} transparent opacity={0.75} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
    </mesh>}
    {lifted && <mesh key={`held-${item.activeColour}`} ref={held} position={[lifted.x, lifted.y + 0.06, lifted.z]} scale={[radius, radius * 0.46, radius]} raycast={noRaycast} castShadow>
      <sphereGeometry args={[1, 32, 20]} /><meshPhysicalMaterial color={item.colours[item.activeColour]} roughness={0.18} clearcoat={1} emissive={ACCENTS[item.activeColour]} emissiveIntensity={0.025} />
    </mesh>}
    {!settingsOpen && <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.035 : boardWidth / 2 + 0.16]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.025 : 0.043} color={wide ? look.ink : ACCENTS[item.activeColour]} raycast={noRaycast}>
      {turnLine(item)}
    </Text>}
    {/*
      THE RESULT, IN ROWS. Baiwei: "the letters below game over that count the
      moves should be arranged more neatly". It was one long line; now: who
      won, then each colour's count in its own colour, then how to start again.
    */}
    {!settingsOpen && result && (() => {
      const base = wide ? extent / 2 + 0.075 : boardWidth / 2 + 0.25, step = wide ? 0.03 : 0.058, y = wide ? GO_SURFACE + 0.002 : 0.752;
      const span = Math.min(wide ? boardWidth * 0.9 : Math.max(0.8, boardWidth), result.scores.length * (wide ? 0.16 : 0.26));
      const at = (index: number) => result.scores.length === 1 ? 0 : -span / 2 + (span / (result.scores.length - 1)) * index;
      return <group>
        <Text position={[0, y, base]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.022 : 0.038}
          color={won.length === 1 ? ACCENTS[won[0]] : "#f1dfbd"} raycast={noRaycast}>{result.verdict}</Text>
        {result.scores.map((score, index) => <Text key={score.colour} position={[at(index), y, base + step]} rotation-x={-Math.PI / 2}
          fontSize={wide ? 0.017 : 0.03} color={ACCENTS[score.colour]} raycast={noRaycast}>{score.text}</Text>)}
        <Text position={[0, y, base + step * 1.85]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.012 : 0.02}
          color={wide ? look.inkSoft : "#c8b49a"} raycast={noRaycast}>{result.again}</Text>
      </group>;
    })()}
    {!settingsOpen && !result && <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.075 : boardWidth / 2 + 0.245]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.014 : 0.025} maxWidth={Math.max(0.8, boardWidth)} color={notice ? "#ff9f8d" : wide ? look.inkSoft : "#d8c8ac"} raycast={noRaycast}>
      {notice || scoreLine(item) || noMoveLine(item) || lastPassLine(item) || (item.carrier?.hand ? `${item.carrier.by} · ${item.carrier.hand} hand · touch a point on the board` : item.liftedColour !== null ? "Point at the board: a ghost stone shows where it lands" : "Touch the glowing bowl to lift a stone, or PASS at it")}
    </Text>}
    {item.liftedColour !== null && <group position={[0, 0.754, edge - 0.095]} onClick={(event) => { event.stopPropagation(); void act({ action: "return" }); }}>
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[0.46, 0.1]} /><meshBasicMaterial color="#493d30" /></mesh>
      <Text rotation-x={-Math.PI / 2} position-y={0.001} fontSize={0.025} color="#eee0c6">RETURN STONE</Text>
    </group>}
    {/*
      FLAT ON THE TABLE, AS TEXT. Nikk, in a headset: "I really don't like the
      grab for the Go thing being floating above in the air it should be like on
      the ground the end of Black's turn... the settings those should also be
      flat on the ground like you can just be [a] text on the ground". MOVE sits
      at the end of the turn line, SETTINGS at its start, and the settings lay
      themselves on the board. go-controls.ts places all of it; its test holds
      it clear of every bowl at every size and seating.

      ONLY WHILE NO STONE IS IN THE AIR. The glowing intersections exist only
      while one is, so the two can never be under the same pointer.
    */}
    {showControls && !settingsOpen && <group position={[controls.move.x, controls.move.y, controls.move.z]}
      onPointerDown={takeTable}
      onPointerMove={(event) => {
        if (grabbedPointer.current !== event.pointerId) return;
        event.stopPropagation();
        steerTable({ origin: asVec(event.ray.origin), direction: asVec(event.ray.direction) });
      }}
      onPointerUp={(event) => {
        if (grabbedPointer.current !== event.pointerId) return;
        letGoOfTable.current?.();
        dropTable();
      }}>
      {/*
        STEERED AND RELEASED FROM R3F TOO, not only from the window: a headset
        delivers no window pointer events at all, so a handle that relied on the
        window could be picked up in a headset and never moved or put down.
      */}
      {/* The whole plane stays the handle; it is only drawn as an outline now. */}
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[controls.move.width, controls.move.depth]} />
        <meshBasicMaterial color={carrying ? "#e45338" : "#f1dfbd"} transparent opacity={carrying ? 0.35 : 0} depthWrite={false} />
      </mesh>
      <Outline width={controls.move.width} depth={controls.move.depth} colour={carrying ? "#e45338" : "#f1dfbd"} />
      <Text position-y={0.001} rotation-x={-Math.PI / 2} fontSize={controls.line.fontSize * 0.8} color={carrying ? "#ff9582" : "#f1dfbd"} raycast={noRaycast}>
        {carrying ? "MOVING" : "MOVE ✥"}
      </Text>
    </group>}
    {showControls && !settingsOpen && <TableButton label="⚙ SETTINGS" at={[controls.settings.x, controls.settings.y, controls.settings.z]}
      width={controls.settings.width} depth={controls.settings.depth} fontSize={controls.line.fontSize * 0.8} outline="#f1dfbd"
      onTap={() => { setNotice(""); setSettingsOpen(true); }} />}
    <Veil open={showControls && settingsOpen} y={controls.veil.y} width={controls.veil.width} opacity={controls.veil.opacity} reducedMotion={reducedMotion} />
    {showControls && settingsOpen && <group>
      {notice && <Text position={[0, controls.sheet.y, controls.sheet.rows[0].z - controls.sheet.rowDepth]} rotation-x={-Math.PI / 2}
        fontSize={controls.sheet.fontSize * 0.8} maxWidth={controls.sheet.width} color="#ff9f8d" raycast={noRaycast}>{notice}</Text>}
      {controls.sheet.rows.map((row) => <group key={row.label || row.buttons[0].id}>
        {row.label && <Text position={[-controls.sheet.width / 2 + 0.03, controls.sheet.y, row.z]} rotation-x={-Math.PI / 2}
          anchorX="left" fontSize={controls.sheet.fontSize} color="#3b2a1a" raycast={noRaycast}>{row.label}</Text>}
        {row.value && <Text position={[row.valueX ?? 0, controls.sheet.y, row.z]} rotation-x={-Math.PI / 2}
          fontSize={controls.sheet.fontSize} color="#3b2a1a" raycast={noRaycast}>{row.value}</Text>}
        {row.buttons.map((button) => <TableButton key={button.id} label={button.label}
          at={[button.x, controls.sheet.y, row.z]} width={button.width} depth={controls.sheet.rowDepth * 0.86}
          fontSize={controls.sheet.fontSize} onTap={() => onSetting(button.id)} />)}
      </group>)}
    </group>}
  </group>;
}

export function RoomItems({ items, reducedMotion, you = null, peopleRef, onItem, onRemoved }: { items: RoomItem[]; reducedMotion: boolean; you?: string | null; peopleRef?: RefObject<WirePerson[]>; onItem?: (item: RoomItem) => void; onRemoved?: (id: string) => void }) {
  const emptyPeople = useRef<WirePerson[]>([]), reservations = useRef(new Map<string, { id: string; until: number }>());
  const context = { you, peopleRef: peopleRef ?? emptyPeople, items, reservations, onItem: onItem ?? (() => {}), onRemoved: onRemoved ?? (() => {}) };
  return <group onPointerDown={(event) => { claimPointer(event.nativeEvent); event.stopPropagation(); }}>
    {items.map((item) => <GoTable key={item.id} item={item} reducedMotion={reducedMotion} context={context} />)}
  </group>;
}
