import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { tableRefusal, type GoRoomItem, type RoomItem } from "../../shared/room-items";
import { beginPlaneGrab, draggedOnPlane, type Ray, type Vec3 } from "../../shared/grab-move";
import { PANEL_HALF_LIFE, followPoint } from "../../shared/smooth-follow";
import { facingArc } from "../../shared/panel-place";
import { space } from "../space-client";
import { claimPointer } from "./pointer-claim";
import { SettingsPanel3D } from "./SettingsPanel3D";
import { GEAR, GO_PANEL, goSettingCost, goSettingFor, goSettingsItems } from "./GoTableSettings";

/**
 * The Go table: a thing in the room you can play on, move, and set up.
 *
 * IT IS DRAGGED BY ITS BASE, and that is the whole interaction. Nikk: "lets
 * allow for moving the go board in the same way" — the same grab-and-drag as
 * the panels, replacing what was there, which they described as "(now go board
 * movement settings are just buttons which is super weird)". Grabbing the
 * pedestal rather than the playing surface means there is no mode to switch:
 * the top is for stones, the base is for carrying, exactly as with a real
 * table. A panel needs a lock because its whole face is a page you click; a
 * table does not, because its handle is somewhere nobody would ever place a
 * stone.
 *
 * IT STAYS ON THE FLOOR. Panels hang in the air and are held at arm's length —
 * see `shared/grab-move.ts` — but furniture that can be lifted into the air by
 * pointing upward is a worse table, so this uses the plane drag from the same
 * module, which refuses a grazing ray rather than answering it with a wild
 * number.
 *
 * ITS SETTINGS ARE ON IT. The gear at the corner opens the table's own panel —
 * board size, how many are playing, and clearing the stones. They used to be a
 * list on the far side of the room, a row per size per table, reachable only by
 * walking away from the board you were setting up.
 */

function GoTable({ item }: { item: GoRoomItem }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const extent = 1.22;
  const step = extent / (item.size - 1);
  const lines = useMemo(() => Array.from({ length: item.size }, (_, index) => -extent / 2 + index * step), [item.size, step]);
  const point = (n: number) => -extent / 2 + n * step;

  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const held = useRef<Vec3 | null>(null);
  const target = useRef<{ x: number; z: number } | null>(null);
  const grabbedPointer = useRef<number | null>(null);
  const scratch = useMemo(() => ({ caster: new THREE.Raycaster(), ndc: new THREE.Vector2() }), []);

  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 0.65 + Math.sin(clock.elapsedTime * 4) * 0.35;
  });

  const vec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });
  const rayOf = (event: ThreeEvent<PointerEvent>): Ray => ({
    origin: vec(event.ray.origin),
    direction: vec(event.ray.direction),
  });

  /** The same ray from a raw window event, for a drag that has left the table behind. */
  const rayFromScreen = useCallback(
    (clientX: number, clientY: number): Ray | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      scratch.ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      scratch.caster.setFromCamera(scratch.ndc, camera);
      return { origin: vec(scratch.caster.ray.origin), direction: vec(scratch.caster.ray.direction) };
    },
    [camera, gl, scratch],
  );

  const drag = useCallback(
    (ray: Ray | null) => {
      const offset = held.current;
      if (!ray || !offset) return;
      const at = draggedOnPlane(ray, offset, 0);
      // A grazing ray is a miss. The table stays where it is rather than
      // leaping across the room, which is exactly what the old plane-cast did
      // to the panels.
      if (!at) return;
      target.current = { x: at.x, z: at.z };
      invalidate();
    },
    [invalidate],
  );

  const release = useCallback(() => {
    setDragging(false);
    grabbedPointer.current = null;
    const offset = held.current;
    held.current = null;
    const want = target.current;
    const node = group.current;
    if (!offset || !want || !node) return;
    const refused = tableRefusal(want);
    if (refused) {
      target.current = null;
      node.position.set(item.position.x, 0, item.position.z);
      invalidate();
      setNotice(refused);
      return;
    }
    setNotice(null);
    void space
      .configureGo(item.id, { position: { x: want.x, z: want.z, rotationY: facingArc(want.x, want.z) } })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not move the table."));
  }, [invalidate, item.id, item.position.x, item.position.z]);

  useFrame((_, delta) => {
    const node = group.current;
    const want = target.current;
    if (!node || !want) return;
    const moved = followPoint({ x: node.position.x, z: node.position.z }, want, delta, PANEL_HALF_LIFE);
    node.position.set(moved.value.x, 0, moved.value.z);
    node.rotation.y = facingArc(moved.value.x, moved.value.z);
    if (moved.settled) {
      target.current = null;
      return;
    }
    invalidate();
  });

  // While dragging, the whole window listens — the table moves out from under
  // the pointer, and R3F only delivers events while the ray is over a mesh.
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => drag(rayFromScreen(event.clientX, event.clientY));
    const up = () => release();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, drag, rayFromScreen, release]);

  // Follow the table wherever anybody else puts it.
  useEffect(() => {
    const node = group.current;
    if (!node || dragging) return;
    node.position.set(item.position.x, 0, item.position.z);
    node.rotation.y = item.position.rotationY;
    invalidate();
  }, [dragging, invalidate, item.position.x, item.position.z, item.position.rotationY]);

  const takeTable = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    const node = group.current;
    if (!node) return;
    const offset = beginPlaneGrab(rayOf(event), { x: node.position.x, y: 0, z: node.position.z }, 0);
    /**
     * REFUSED RATHER THAN STARTED. A grab from a ray too level to meet the
     * floor cannot be steered, and starting one anyway gives a table that
     * sticks to the pointer and will not go anywhere — which is indistinguish-
     * able from a broken feature.
     */
    if (!offset) {
      setNotice("Look down at the table to pick it up.");
      return;
    }
    held.current = offset;
    grabbedPointer.current = event.pointerId;
    (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
    setNotice(null);
    setDragging(true);
  };

  const onSetting = (id: string) => {
    const change = goSettingFor(item, id);
    if (!change) return;
    if (change.kind === "close") {
      setSettingsOpen(false);
      return;
    }
    if (change.kind === "refused") {
      setNotice(change.why);
      return;
    }
    // Say what it cost, rather than letting a board quietly empty itself.
    setNotice(goSettingCost(item, change));
    const body =
      change.kind === "size"
        ? { size: change.size }
        : change.kind === "players"
          ? { players: change.players }
          : ({ reset: true } as const);
    void space.configureGo(item.id, body).catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : "Could not change the table."),
    );
  };

  const bowlPosition = (index: number): [number, number, number] => {
    const angle = (index / item.colours.length) * Math.PI * 2 + Math.PI / 2;
    return [Math.cos(angle) * 0.94, 0.86, Math.sin(angle) * 0.94];
  };

  const settingsItems = useMemo(() => goSettingsItems(item), [item]);

  return (
    <group ref={group} position={[item.position.x, 0, item.position.z]} rotation-y={item.position.rotationY}>
      {/*
        THE PEDESTAL IS THE HANDLE: nowhere anybody would ever aim a stone, and
        a big target for a controller ray from across the room.
      */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow onPointerDown={takeTable}>
        <cylinderGeometry args={[0.92, 0.8, 0.72, 8]} />
        <meshStandardMaterial color={dragging ? "#4d3526" : "#39261c"} roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.77, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.48, 0.1, 1.48]} />
        <meshStandardMaterial color="#c79855" roughness={0.56} />
      </mesh>
      {lines.map((offset, index) => (
        <group key={index}>
          <mesh position={[offset, 0.826, 0]} rotation-x={Math.PI / 2}>
            <planeGeometry args={[0.008, extent]} /><meshBasicMaterial color="#51351f" />
          </mesh>
          <mesh position={[0, 0.827, offset]} rotation-x={Math.PI / 2}>
            <planeGeometry args={[extent, 0.008]} /><meshBasicMaterial color="#51351f" />
          </mesh>
        </group>
      ))}
      {Array.from({ length: item.size * item.size }, (_, index) => {
        const x = index % item.size; const y = Math.floor(index / item.size);
        return <mesh key={`hit-${index}`} position={[point(x), 0.845, point(y)]} rotation-x={-Math.PI / 2}
          onClick={(event) => { event.stopPropagation(); void space.actOnGo(item.id, { action: "place", x, y }); }}>
          <circleGeometry args={[Math.max(0.025, step * 0.38), 12]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>;
      })}
      {item.stones.map((stone, index) => (
        <mesh key={`${stone.x}-${stone.y}-${index}`} position={[point(stone.x), 0.86, point(stone.y)]} castShadow>
          <sphereGeometry args={[Math.min(0.055, step * 0.42), 22, 10]} /><meshStandardMaterial color={item.colours[stone.colour]} roughness={0.28} />
        </mesh>
      ))}
      {item.colours.map((colour, index) => {
        const position = bowlPosition(index); const active = index === item.activeColour;
        return <group key={`${colour}-${index}`} position={position} onClick={(event) => { event.stopPropagation(); if (active) void space.actOnGo(item.id, { action: "lift" }); }}>
          <mesh castShadow><cylinderGeometry args={[0.16, 0.12, 0.09, 24]} /><meshStandardMaterial color="#6b4328" roughness={0.68} /></mesh>
          <mesh position={[0, 0.055, 0]} castShadow><sphereGeometry args={[0.095, 20, 10]} />
            <meshStandardMaterial ref={active ? glow : undefined} color={colour} emissive={active ? colour : "#000000"} emissiveIntensity={active ? 0.8 : 0} roughness={0.25} />
          </mesh>
          {item.liftedColour === index && <mesh position={[0, 0.25, 0]} castShadow><sphereGeometry args={[0.06, 22, 10]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.3} /></mesh>}
        </group>;
      })}

      {/*
        THE GEAR, on the table it belongs to.

        At the near corner of the top rather than floating above it, so it is
        obviously part of THIS table and not of the one beside it. Generously
        sized: the room has already had three separate controls that were the
        right size in metres and too small to hit with a pointer, and every one
        of them read as a broken feature rather than as a missed click.
      */}
      <group position={[GEAR.out, GEAR.y, GEAR.out]}>
        {/* A short stalk down to the corner, so it reads as part of THIS table. */}
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
          <meshStandardMaterial color="#6b4328" roughness={0.6} />
        </mesh>
        <mesh
          rotation-x={-Math.PI / 2}
          onClick={(event) => {
            event.stopPropagation();
            setNotice(null);
            setSettingsOpen((open) => !open);
          }}
        >
          <circleGeometry args={[GEAR.radius, 20]} />
          <meshBasicMaterial color={settingsOpen ? "#e45338" : "#2b2118"} transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.085} color="#f1d8aa" anchorX="center" anchorY="middle">
          ⚙
        </Text>
      </group>

      {settingsOpen ? (
        <group position={[0, 1.6, 0]}>
          <SettingsPanel3D
            items={settingsItems}
            surface={{ width: GO_PANEL.width, height: GO_PANEL.height }}
            onPress={onSetting}
          />
        </group>
      ) : null}

      <Text position={[0, 0.48, -0.91]} rotation={[0, 0, 0]} fontSize={0.09} color="#f1d8aa" anchorX="center" anchorY="middle">
        {`GO  ${item.size}×${item.size}`}
      </Text>

      {notice ? (
        <Text
          position={[0, 1.08, 0]}
          fontSize={0.075}
          color="#e45338"
          anchorX="center"
          anchorY="middle"
          maxWidth={1.4}
          outlineWidth={0.006}
          outlineColor="#1a1410"
        >
          {notice}
        </Text>
      ) : null}
    </group>
  );
}

export function RoomItems({ items }: { items: RoomItem[] }) {
  return <>{items.map((item) => item.kind === "go" ? <GoTable key={item.id} item={item} /> : null)}</>;
}
