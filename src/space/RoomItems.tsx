import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { RoundedBox, Text } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { GoRoomItem, RoomItem } from "../../shared/room-items";
import { legalGoMoves } from "../../shared/go-rules";
import { GO_PITCH, GO_SURFACE, goExtent, goBoardWidth, goDeckWidth, goBowl, goPoint, goRadius, goTray, goLocal, goTouchBowl, type Point3 } from "../../shared/go-layout";
import { goCarryPoint, idleGoTouch, stepGoTouch } from "../../shared/go-touch";
import type { WirePerson } from "../../shared/space-wire";
import { goHandInput } from "./go-hand-input";
import { space } from "../space-client";
import { claimPointer } from "./pointer-claim";
import { beginGrab, clamp, grabbedTo, pushPull, type Grab, type Ray, type Vec3 } from "../../shared/grab-move";
import { goSettingCost, goSettingFor, goSettingRequest } from "./GoTableSettings";
import { GO_TABLE_POINTERS, goControls, goControlsShown } from "./go-controls";
import { goTableWriter } from "./go-table-writer";

const NAMES = ["Black", "White", "Coral", "Blue", "Gold", "Jade", "Violet", "Rose"];
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

/** One draw call for all legal points, not 625 independent animated lights. */
function MoveLights({ item, reducedMotion, onPlace }: { item: GoRoomItem; reducedMotion: boolean; onPlace: (x: number, y: number) => void }) {
  const dots = useRef<THREE.InstancedMesh>(null), material = useRef<THREE.MeshBasicMaterial>(null);
  const [hover, setHover] = useState<number | null>(null);
  const texture = useMemo(glowTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const moves = useMemo(() => item.liftedColour === null ? [] : legalGoMoves(item.stones, item.size, item.activeColour), [item.stones, item.size, item.activeColour, item.liftedColour]);
  useLayoutEffect(() => {
    if (!dots.current) return;
    const object = new THREE.Object3D(), width = GO_PITCH * 0.88;
    moves.forEach((move, i) => {
      object.position.set(goPoint(move.x, item.size), GO_SURFACE + 0.003, goPoint(move.y, item.size));
      // Hover brightens, but never enlarges the clickable intersection into its neighbour.
      object.rotation.x = -Math.PI / 2; object.scale.setScalar(width); object.updateMatrix();
      dots.current!.setMatrixAt(i, object.matrix);
      dots.current!.setColorAt(i, new THREE.Color().setScalar(hover === i ? 1.7 : 1));
    });
    dots.current.count = moves.length; dots.current.instanceMatrix.needsUpdate = true;
    if (dots.current.instanceColor) dots.current.instanceColor.needsUpdate = true;
    dots.current.computeBoundingSphere();
  }, [moves, item.size, hover]);
  useFrame(({ clock }) => { if (material.current) material.current.opacity = reducedMotion ? 0.8 : 0.62 + Math.sin(clock.elapsedTime * 2.8) * 0.22; });
  const action = (instanceId?: number) => { const point = moves[instanceId ?? -1]; if (point) onPlace(point.x, point.y); };
  return <instancedMesh ref={dots} args={[undefined, undefined, item.size * item.size]} frustumCulled={false}
    onClick={(event) => { event.stopPropagation(); action(event.instanceId); }}
    onPointerMove={(event) => { event.stopPropagation(); setHover(event.instanceId ?? null); }} onPointerOut={() => setHover(null)}>
    <planeGeometry args={[1, 1]} />
    <meshBasicMaterial ref={material} map={texture} color={ACCENTS[item.activeColour]} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
  </instancedMesh>;
}

type StoneTarget = { id: string; at: Point3; colour: string; radius: number; from: Point3 };
/** Stable IDs let a captured stone fly to its tray instead of disappearing. */
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

function Bowl({ item, index, reducedMotion, onLift }: { item: GoRoomItem; index: number; reducedMotion: boolean; onLift: () => void }) {
  const pulse = useRef<THREE.MeshBasicMaterial>(null), rim = useRef<THREE.MeshStandardMaterial>(null);
  const active = index === item.activeColour;
  const colour = item.colours[index], accent = ACCENTS[index];
  const position = goBowl(index, item.colours.length, item.size), tray = goTray(index, item.colours.length, item.size);
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
    if (pulse.current) pulse.current.opacity = active ? wave : 0;
    if (rim.current) rim.current.emissiveIntensity = active ? wave * 0.8 : 0;
  });
  const captures = item.captures.filter((stone) => stone.by === index).length;
  return <>
    <group position={xyz(position)} onClick={(event) => { event.stopPropagation(); onLift(); }}>
      <mesh position={[0, -0.055, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <planeGeometry args={[0.72, 0.72]} /><meshBasicMaterial ref={pulse} map={texture} color={accent} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh castShadow><latheGeometry args={[profile, 48]} /><meshPhysicalMaterial color="#6d3b23" roughness={0.38} clearcoat={0.55} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.066, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.172, 0.007, 8, 64]} /><meshStandardMaterial ref={rim} color={active ? accent : "#c38d52"} emissive={accent} roughness={0.3} metalness={0.4} />
      </mesh>
      <Stones targets={stock} reducedMotion />
      {/* Invisible contact cap also makes the stones in the bowl clickable. */}
      <mesh position={[0, 0.045, 0]}><sphereGeometry args={[0.17, 16, 8]} /><meshBasicMaterial visible={false} /></mesh>
      <Text position={[0, -0.042, tray.z > position.z ? -0.24 : 0.24]} rotation-x={-Math.PI / 2} fontSize={0.039} color={active ? accent : "#c8b49a"} raycast={noRaycast}>
        {`${NAMES[index].toUpperCase()}${active ? " · TO PLAY" : ""}`}
      </Text>
    </group>
    <RoundedBox args={[0.22, 0.025, 0.27]} radius={0.011} smoothness={3} position={xyz(tray)} raycast={noRaycast}>
      <meshStandardMaterial color="#352920" roughness={0.46} />
    </RoundedBox>
    <Text position={[tray.x, tray.y + 0.017, tray.z + 0.18]} rotation-x={-Math.PI / 2} fontSize={0.028} color="#c8b49a" raycast={noRaycast}>{`${captures} CAPTURED`}</Text>
  </>;
}

function TableButton({ label, at, onTap, width = 0.24, depth = 0.105, fontSize = 0.029 }: { label: string; at: [number, number, number]; onTap: () => void; width?: number; depth?: number; fontSize?: number }) {
  const [hover, setHover] = useState(false);
  return <group position={at} onClick={(event) => { event.stopPropagation(); onTap(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
    <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[width, depth]} /><meshBasicMaterial color={hover ? "#78654b" : "#483b2e"} /></mesh>
    <Text position-y={0.001} rotation-x={-Math.PI / 2} fontSize={fontSize} color="#f1dfbd" raycast={noRaycast}>{label}</Text>
  </group>;
}

type TableContext = { you: string | null; peopleRef: RefObject<WirePerson[]>;
  items: RoomItem[]; reservations: RefObject<Map<string, { id: string; until: number }>>;
  /** Apply a table as the server just answered with it — see withFresher. */
  onItem: (item: RoomItem) => void };
function GoTable({ item, reducedMotion, context }: { item: GoRoomItem; reducedMotion: boolean; context: TableContext }) {
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const pending = useRef(false), held = useRef<THREE.Mesh>(null);
  const contacts = useRef({ left: idleGoTouch(), right: idleGoTouch() });
  const lastHeld = useRef<Point3 | null>(null);
  const liftAge = useRef(0);
  useEffect(() => { liftAge.current = 0; }, [item.liftedColour, item.carrier?.by, item.carrier?.hand]);
  const previous = useRef(new Set(item.stones.map((stone) => stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`)));
  const wood = useMemo(woodTexture, []);
  useEffect(() => () => wood.dispose(), [wood]);
  const radius = goRadius(item.size);
  const targets = useMemo(() => {
    const result: StoneTarget[] = item.stones.map((stone) => {
      const id = stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`;
      const at = { x: goPoint(stone.x, item.size), y: GO_SURFACE + radius * 0.46, z: goPoint(stone.y, item.size) };
      const bowl = goBowl(stone.colour, item.colours.length, item.size);
      return { id, at, from: previous.current.has(id) ? at : lastHeld.current ?? { ...bowl, y: bowl.y + 0.3 }, colour: item.colours[stone.colour], radius };
    });
    item.colours.forEach((_, index) => {
      const tray = goTray(index, item.colours.length, item.size);
      item.captures.filter((stone) => stone.by === index).slice(-24).forEach((stone, n) => {
        const at = { x: tray.x + (n % 3 - 1) * 0.065, y: tray.y + 0.026 + Math.floor(n / 9) * 0.028, z: tray.z + (Math.floor(n / 3) % 3 - 1) * 0.073 };
        result.push({ id: stone.id ?? `${stone.colour}-${stone.x}-${stone.y}`, at,
          from: at, colour: item.colours[stone.colour], radius: Math.min(radius, 0.032) });
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
      const canLift = item.liftedColour === null && !pending.current && !otherTable && (!reservation || reservation.until < now || reservation.id === item.id);
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
      const world = item.carrier.by === context.you
        ? sample && now - sample.at < 120 ? sample.carry : null
        : remote ? goCarryPoint(remote) : null;
      if (world) {
        const p = goLocal(world, item);
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
    if (!at) return;
    const place = { position: { x: at.x, y: at.y, z: at.z, rotationY: item.position.rotationY } };
    // Where it was put does not depend on anything else about the table.
    void configure(place, () => place);
  }, [item.position.rotationY]);

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
    grabbedPointer.current = event.pointerId;
    (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
    setNotice("");
    setCarrying(true);
    listenWhileCarrying();
  };

  const onSetting = (id: string) => {
    const change = goSettingFor(item, id);
    if (!change) return;
    if (change.kind === "close") { setSettingsOpen(false); return; }
    if (change.kind === "refused") { setNotice(change.why); return; }
    setNotice(goSettingCost(item, change) ?? "");
    const request = goSettingRequest(item, id);
    if (request) void configure(request, (fresh) => goSettingRequest(fresh, id));
  };

  const controls = useMemo(() => goControls(item), [item]);
  const showControls = goControlsShown(item);
  // Lifting a stone puts the glowing intersections on the board the sheet was
  // lying on, so the sheet closes rather than waiting underneath them.
  useEffect(() => { if (!showControls) setSettingsOpen(false); }, [showControls]);
  const stars = item.size === 5 ? [2] : item.size === 9 ? [2, 4, 6] : [3, (item.size - 1) / 2, item.size - 4];
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
      <meshPhysicalMaterial color={carrying ? "#c2793f" : "#975d32"} roughness={0.38} clearcoat={0.4} />
    </RoundedBox>
    <RoundedBox args={[boardWidth, 0.025, boardWidth]} radius={0.01} smoothness={3} position={[0, GO_SURFACE - 0.0125, 0]} receiveShadow raycast={noRaycast}>
      <meshPhysicalMaterial map={wood} roughness={0.43} clearcoat={0.22} />
    </RoundedBox>
    {item.deskVisible && [-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * edge * 0.6, 0.34, z * edge * 0.6]} castShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.07, 0.045, 0.68, 12]} /><meshStandardMaterial color="#382720" roughness={0.4} />
    </mesh>))}
    {offsets.map((offset, index) => <group key={index}>
      <mesh position={[offset, GO_SURFACE + 0.0015, 0]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[index === 0 || index === item.size - 1 ? 0.0035 : 0.0025, extent]} /><meshBasicMaterial color="#503822" polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>
      <mesh position={[0, GO_SURFACE + 0.0016, offset]} rotation-x={-Math.PI / 2} raycast={noRaycast}><planeGeometry args={[extent, index === 0 || index === item.size - 1 ? 0.0035 : 0.0025]} /><meshBasicMaterial color="#503822" polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2} /></mesh>
    </group>)}
    {stars.flatMap((x) => stars.map((y) => <mesh key={`star-${x}-${y}`} position={[goPoint(x, item.size), GO_SURFACE + 0.001, goPoint(y, item.size)]} rotation-x={-Math.PI / 2} raycast={noRaycast}>
      <circleGeometry args={[0.0045, 16]} /><meshBasicMaterial color="#503822" />
    </mesh>))}
    <MoveLights item={item} reducedMotion={reducedMotion} onPlace={(x, y) => void act({ action: "place", x, y })} />
    <Stones targets={targets} reducedMotion={reducedMotion} />
    {item.colours.map((_, index) => <Bowl key={index} item={item} index={index} reducedMotion={reducedMotion}
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
    {lifted && <mesh key={`held-${item.activeColour}`} ref={held} position={[lifted.x, lifted.y + 0.06, lifted.z]} scale={[radius, radius * 0.46, radius]} raycast={noRaycast} castShadow>
      <sphereGeometry args={[1, 32, 20]} /><meshPhysicalMaterial color={item.colours[item.activeColour]} roughness={0.18} clearcoat={1} emissive={ACCENTS[item.activeColour]} emissiveIntensity={0.025} />
    </mesh>}
    {!settingsOpen && <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.035 : boardWidth / 2 + 0.16]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.025 : 0.043} color={wide ? "#49331f" : ACCENTS[item.activeColour]} raycast={noRaycast}>
      {`${NAMES[item.activeColour].toUpperCase()}'S TURN`}
    </Text>}
    {!settingsOpen && <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.075 : boardWidth / 2 + 0.245]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.014 : 0.025} maxWidth={Math.max(0.8, boardWidth)} color={notice ? "#ff9f8d" : wide ? "#624526" : "#d8c8ac"} raycast={noRaycast}>
      {notice || (item.carrier?.hand ? `${item.carrier.by} · ${item.carrier.hand} hand · touch a glowing point` : item.liftedColour !== null ? "Choose a glowing intersection" : "Touch the glowing bowl to lift a stone")}
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
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[controls.move.width, controls.move.depth]} />
        <meshBasicMaterial color={carrying ? "#e45338" : "#483b2e"} transparent opacity={carrying ? 0.9 : 0.72} />
      </mesh>
      <Text position-y={0.001} rotation-x={-Math.PI / 2} fontSize={controls.line.fontSize * 0.8} color="#f1dfbd" raycast={noRaycast}>
        {carrying ? "MOVING" : "MOVE ✥"}
      </Text>
    </group>}
    {showControls && !settingsOpen && <TableButton label="⚙ SETTINGS" at={[controls.settings.x, controls.settings.y, controls.settings.z]}
      width={controls.settings.width} depth={controls.settings.depth} fontSize={controls.line.fontSize * 0.8}
      onTap={() => { setNotice(""); setSettingsOpen(true); }} />}
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

export function RoomItems({ items, reducedMotion, you = null, peopleRef, onItem }: { items: RoomItem[]; reducedMotion: boolean; you?: string | null; peopleRef?: RefObject<WirePerson[]>; onItem?: (item: RoomItem) => void }) {
  const emptyPeople = useRef<WirePerson[]>([]), reservations = useRef(new Map<string, { id: string; until: number }>());
  const context = { you, peopleRef: peopleRef ?? emptyPeople, items, reservations, onItem: onItem ?? (() => {}) };
  return <group onPointerDown={(event) => { claimPointer(event.nativeEvent); event.stopPropagation(); }}>
    {items.map((item) => <GoTable key={item.id} item={item} reducedMotion={reducedMotion} context={context} />)}
  </group>;
}
