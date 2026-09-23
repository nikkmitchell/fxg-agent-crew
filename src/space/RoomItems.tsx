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
import { SettingsPanel3D } from "./SettingsPanel3D";
import { GEAR, GO_PANEL, gearAt, goSettingCost, goSettingFor, goSettingsItems } from "./GoTableSettings";

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

function TableButton({ label, at, onTap, width = 0.24 }: { label: string; at: [number, number, number]; onTap: () => void; width?: number }) {
  const [hover, setHover] = useState(false);
  return <group position={at} onClick={(event) => { event.stopPropagation(); onTap(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
    <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[width, 0.105]} /><meshBasicMaterial color={hover ? "#78654b" : "#483b2e"} /></mesh>
    <Text position-y={0.001} rotation-x={-Math.PI / 2} fontSize={0.029} color="#f1dfbd" raycast={noRaycast}>{label}</Text>
  </group>;
}

type TableContext = { you: string | null; peopleRef: RefObject<WirePerson[]>;
  items: RoomItem[]; reservations: RefObject<Map<string, { id: string; until: number }>> };
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
  const act = async (action: Parameters<typeof space.actOnGo>[1]) => {
    if (pending.current) return false;
    pending.current = true;
    try { await space.actOnGo(item.id, { ...action, revision: item.revision }); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not update the table."); return false; }
    finally { pending.current = false; }
  };
  const configure = async (change: Parameters<typeof space.configureGo>[1]) => {
    if (pending.current) return;
    pending.current = true;
    try { await space.configureGo(item.id, { ...change, revision: item.revision }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not move the table."); }
    finally { pending.current = false; }
  };
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

  const dropTable = useCallback(() => {
    const at = want.current;
    grab.current = null; want.current = null; grabbedPointer.current = null;
    setCarrying(false);
    if (!at) return;
    void configure({ position: { x: at.x, y: at.y, z: at.z, rotationY: item.position.rotationY } });
  }, [item.position.rotationY]);

  useEffect(() => {
    if (!carrying) return;
    const move = (event: PointerEvent) => steerTable(rayFromScreen(event.clientX, event.clientY));
    const up = () => dropTable();
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
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
    };
  }, [carrying, steerTable, rayFromScreen, dropTable, invalidate]);

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
  };

  const onSetting = (id: string) => {
    const change = goSettingFor(item, id);
    if (!change) return;
    if (change.kind === "close") { setSettingsOpen(false); return; }
    if (change.kind === "refused") { setNotice(change.why); return; }
    setNotice(goSettingCost(item, change) ?? "");
    void configure(
      change.kind === "size" ? { size: change.size }
      : change.kind === "players" ? { players: change.players }
      : change.kind === "scale" ? { scale: change.scale }
      : change.kind === "desk" ? { deskVisible: change.shown }
      : { reset: true },
    );
  };

  const gear = gearAt(item);
  const settingsItems = useMemo(() => goSettingsItems(item), [item]);
  const stars = item.size === 5 ? [2] : item.size === 9 ? [2, 4, 6] : [3, (item.size - 1) / 2, item.size - 4];
  const lifted = item.liftedColour === null ? null : goBowl(item.liftedColour, item.colours.length, item.size);
  const wide = item.colours.length > 2, deck = goDeckWidth(item.size, item.colours.length);
  const extent = goExtent(item.size), boardWidth = goBoardWidth(item.size), edge = deck / 2;
  return <group ref={body} position={[item.position.x, item.position.y, item.position.z]} rotation-y={item.position.rotationY} scale={item.scale}>
    {item.deskVisible && <RoundedBox args={[deck, 0.075, deck]} radius={0.035} smoothness={4} position={[0, 0.705, 0]} receiveShadow>
      <meshStandardMaterial map={wood} color="#765b49" roughness={0.42} metalness={0.06} />
    </RoundedBox>}
    {/*
      THE BOARD'S RIM IS THE HANDLE. It sits below the playing surface and
      carries no stone targets, so grabbing the table cannot be confused with
      placing a stone — the same reasoning as picking up a table by its edge
      rather than by the pieces on it.
    */}
    <RoundedBox args={[boardWidth + 0.06, 0.105, boardWidth + 0.06]} radius={0.035} smoothness={4} position={[0, 0.79, 0]} castShadow receiveShadow
      onPointerDown={takeTable}>
      <meshPhysicalMaterial color={carrying ? "#c2793f" : "#975d32"} roughness={0.38} clearcoat={0.4} />
    </RoundedBox>
    <RoundedBox args={[boardWidth, 0.025, boardWidth]} radius={0.01} smoothness={3} position={[0, GO_SURFACE - 0.0125, 0]} receiveShadow>
      <meshPhysicalMaterial map={wood} roughness={0.43} clearcoat={0.22} />
    </RoundedBox>
    {item.deskVisible && [-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * edge * 0.6, 0.34, z * edge * 0.6]} castShadow>
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
    <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.035 : boardWidth / 2 + 0.16]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.025 : 0.043} color={wide ? "#49331f" : ACCENTS[item.activeColour]} raycast={noRaycast}>
      {`${NAMES[item.activeColour].toUpperCase()}'S TURN`}
    </Text>
    <Text position={[0, wide ? GO_SURFACE + 0.002 : 0.752, wide ? extent / 2 + 0.075 : boardWidth / 2 + 0.245]} rotation-x={-Math.PI / 2} fontSize={wide ? 0.014 : 0.025} maxWidth={Math.max(0.8, boardWidth)} color={notice ? "#ff9f8d" : wide ? "#624526" : "#d8c8ac"} raycast={noRaycast}>
      {notice || (item.carrier?.hand ? `${item.carrier.by} · ${item.carrier.hand} hand · touch a glowing point` : item.liftedColour !== null ? "Choose a glowing intersection" : "Touch the glowing bowl to lift a stone")}
    </Text>
    {item.liftedColour !== null && <group position={[0, 0.754, edge - 0.095]} onClick={(event) => { event.stopPropagation(); void act({ action: "return" }); }}>
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[0.46, 0.1]} /><meshBasicMaterial color="#493d30" /></mesh>
      <Text rotation-x={-Math.PI / 2} position-y={0.001} fontSize={0.025} color="#eee0c6">RETURN STONE</Text>
    </group>}
    {/*
      THE GEAR. Board size, how many are playing, the table's own size, the
      desk, and clearing the stones — the things that used to be a nudge pad of
      X/Y/Z buttons and two floating labels. It stands above the near edge
      rather than lying on the deck; `GoTableSettings.ts` says why, at length,
      and a test holds it clear of every stone target and bowl at every size
      and seating.
    */}
    <group position={[gear.x, gear.y, gear.z]}>
      <mesh position={[0, -0.12, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.008, 0.008, 0.24, 8]} /><meshStandardMaterial color="#6b4328" roughness={0.6} />
      </mesh>
      <mesh onClick={(event) => { event.stopPropagation(); setNotice(""); setSettingsOpen((open) => !open); }}>
        <sphereGeometry args={[GEAR.radius, 20, 12]} />
        <meshStandardMaterial color={settingsOpen ? "#e45338" : "#2b2118"} roughness={0.4} />
      </mesh>
      <Text position={[0, 0, GEAR.radius + 0.002]} fontSize={0.07} color="#f1d8aa" anchorX="center" anchorY="middle" raycast={noRaycast}>
        ⚙
      </Text>
    </group>
    {settingsOpen && <group position={[gear.x, gear.y + 0.78, gear.z]}>
      <SettingsPanel3D items={settingsItems} surface={{ width: GO_PANEL.width, height: GO_PANEL.height }} onPress={onSetting} />
    </group>}
  </group>;
}

export function RoomItems({ items, reducedMotion, you = null, peopleRef }: { items: RoomItem[]; reducedMotion: boolean; you?: string | null; peopleRef?: RefObject<WirePerson[]> }) {
  const emptyPeople = useRef<WirePerson[]>([]), reservations = useRef(new Map<string, { id: string; until: number }>());
  const context = { you, peopleRef: peopleRef ?? emptyPeople, items, reservations };
  return <group onPointerDown={(event) => { claimPointer(event.nativeEvent); event.stopPropagation(); }}>
    {items.map((item) => <GoTable key={item.id} item={item} reducedMotion={reducedMotion} context={context} />)}
  </group>;
}
