import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { MODULE_SCALE, type ModuleRoomItem, type RoomItem } from "../../../shared/room-items";
import type { ClientMessage, ServerMessage } from "../../../shared/space-wire";
import { bff, type SpaceModule, type SpaceModules } from "../../bff-client";
import { space } from "../../space-client";
import { WristButton } from "../Backdrop";
import { moduleRoom } from "./module-room";
import { runModule, type ModuleMode, type RunningModule } from "./run-module";
import { useCarry } from "./use-carry";

/**
 * THINGS FROM SPACES, LIVE IN THE ROOM (shared/room-items.ts, ModuleRoomItem;
 * Nikk, 2026-10-01). Each is a module from a space's git, run right here
 * (run-module.ts) in its own group: an item where it was put, an environment
 * or a full-size space around the room, a space as a model on the table. A
 * push to its branch reloads it for everyone (spaceDeployed).
 *
 * Mounted once in Scene.tsx, for the window and the headset alike.
 */

const noRaycast = () => undefined;

type Sources = Map<string, SpaceModules | { error: string }>;
const sourceKey = (spaceName: string, branch: string) => `${spaceName}@${branch}`;

/** What each space's branch offers now, refetched whenever it deploys. */
function useModuleSources(items: ModuleRoomItem[], subscribe: (listener: (message: ServerMessage) => void) => () => void): Sources {
  const [sources, setSources] = useState<Sources>(new Map());
  const asked = useRef(new Set<string>());
  const fetchSource = useCallback((spaceName: string, branch: string) => {
    const key = sourceKey(spaceName, branch);
    asked.current.add(key);
    bff.spaceModules(spaceName, branch)
      .then((listing) => setSources((now) => new Map(now).set(key, listing)))
      .catch((error: unknown) => setSources((now) => new Map(now).set(key, { error: error instanceof Error ? error.message : `Could not read ${spaceName}.` })));
  }, []);
  useEffect(() => {
    for (const item of items) {
      const key = sourceKey(item.source.space, item.source.branch);
      if (!asked.current.has(key)) fetchSource(item.source.space, item.source.branch);
    }
  }, [items, fetchSource]);
  useEffect(() => subscribe((message) => {
    if (message.type !== "spaceDeployed") return;
    if (asked.current.has(sourceKey(message.space, message.branch))) fetchSource(message.space, message.branch);
  }), [subscribe, fetchSource]);
  return sources;
}

/**
 * PRESSES FOR WHAT THINGS ASKED TO HEAR (saha.onPress): one router for the
 * room, so nothing a thing draws can stand between a pointer and the room's
 * own buttons. A click in the window, or a trigger pulled in a headset, is
 * cast at the pressable parts of every running thing; the nearest hears it.
 *
 * And in a headset, three's controllers, grips and hands are hung on the
 * player's origin, so a thing that reads them (Sill's drums do) gets room
 * positions after you have walked or teleported.
 */
function usePressRouter(running: Map<string, RunningModule>, you: { id: string; name: string } | null) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const caster = useMemo(() => new THREE.Raycaster(), []);
  const youRef = useRef(you);
  youRef.current = you;

  const pressAlong = useCallback((origin: THREE.Vector3, direction: THREE.Vector3) => {
    caster.set(origin, direction);
    const parts: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.userData.sahaPressable) parts.push(object);
    });
    const hit = caster.intersectObjects(parts, true)[0];
    if (!hit) return;
    for (const module of running.values()) if (module.press(hit.object, { point: hit.point, by: youRef.current })) return;
  }, [caster, running, scene]);

  useEffect(() => {
    const element = gl.domElement;
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY });
    const onUp = (event: PointerEvent) => {
      // A drag to look round is not a press.
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
      const rect = element.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
      caster.setFromCamera(ndc, camera);
      pressAlong(caster.ray.origin.clone(), caster.ray.direction.clone());
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, caster, pressAlong]);

  useEffect(() => {
    const xr = gl.xr;
    const hung: THREE.Object3D[] = [];
    const selects: Array<() => void> = [];
    const start = () => {
      const origin = xr.getCamera().parent;
      if (!origin) return;
      for (const index of [0, 1]) {
        const ray = xr.getController(index);
        for (const object of [ray, xr.getControllerGrip(index), xr.getHand(index)]) {
          if (object.parent !== origin) {
            origin.add(object);
            hung.push(object);
          }
        }
        const onSelect = () => {
          const at = new THREE.Vector3();
          const towards = new THREE.Vector3(0, 0, -1);
          ray.getWorldPosition(at);
          towards.applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion())).normalize();
          pressAlong(at, towards);
        };
        ray.addEventListener("select", onSelect);
        selects.push(() => ray.removeEventListener("select", onSelect));
      }
    };
    const end = () => {
      for (const off of selects.splice(0)) off();
      for (const object of hung.splice(0)) object.parent?.remove(object);
    };
    xr.addEventListener("sessionstart", start);
    xr.addEventListener("sessionend", end);
    if (xr.isPresenting) start();
    return () => {
      xr.removeEventListener("sessionstart", start);
      xr.removeEventListener("sessionend", end);
      end();
    };
  }, [gl, pressAlong]);
}

export function ModuleItems({ items, you, send, subscribe, onItem, onRemoved }: {
  items: ModuleRoomItem[];
  you: string | null;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  onItem: (item: RoomItem) => void;
  onRemoved: (id: string) => void;
}) {
  const sources = useModuleSources(items, subscribe);
  const running = useMemo(() => new Map<string, RunningModule>(), []);
  const person = useMemo(() => (you ? { id: you, name: you } : null), [you]);
  usePressRouter(running, person);
  return (
    <>
      {items.map((item) => {
        const source = sources.get(sourceKey(item.source.space, item.source.branch));
        const entry = source && "modules" in source ? source.modules.find((module) => module.id === item.source.entry) ?? null : null;
        const missing = !source ? null : "error" in source ? source.error : entry ? null : `${item.source.space} no longer lists ${item.source.entry} on ${item.source.branch}.`;
        return (
          <ModuleThing
            key={item.id}
            item={item}
            entry={entry}
            missing={missing}
            you={person}
            send={send}
            subscribe={subscribe}
            running={running}
            onItem={onItem}
            onRemoved={onRemoved}
          />
        );
      })}
    </>
  );
}

function ModuleThing({ item, entry, missing, you, send, subscribe, running, onItem, onRemoved }: {
  item: ModuleRoomItem;
  entry: SpaceModule | null;
  missing: string | null;
  you: { id: string; name: string } | null;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  running: Map<string, RunningModule>;
  onItem: (item: RoomItem) => void;
  onRemoved: (id: string) => void;
}) {
  const place = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const world = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const full = item.view === "full";
  const mode: ModuleMode = full ? "full" : item.role === "space" ? "model" : "item";
  const url = entry ? new URL(entry.url, window.location.origin).href : null;
  const exportName = entry?.export ?? null;

  useEffect(() => {
    if (!url || !root.current) return;
    const group = root.current;
    let alive = true;
    let mine: RunningModule | null = null;
    let room: ReturnType<typeof moduleRoom> | null = null;
    setProblem(null);
    void space.moduleState(item.id)
      .catch(() => ({ state: {} as Record<string, unknown> }))
      .then(({ state }) => {
        if (!alive) return null;
        room = moduleRoom({ item: item.id, you, send, subscribe, state });
        return runModule({ url, exportName, id: item.id, mode, root: group, world, camera, renderer: gl, room, scale: full ? 1 : item.scale, onProblem: setProblem });
      })
      .then((started) => {
        if (!started) return;
        if (!alive) {
          started.dispose();
          return;
        }
        mine = started;
        running.set(item.id, started);
        // Which parts asked to hear presses: the router looks for this mark.
        invalidate();
      });
    return () => {
      alive = false;
      running.delete(item.id);
      mine?.dispose();
      room?.close();
    };
    // A new deploy is a new url: the thing reloads, for everyone at once.
  }, [url, exportName, item.id, mode, world, camera, gl, running, invalidate, you, send, subscribe, full, item.scale]);

  useFrame((state, delta) => running.get(item.id)?.update(Math.min(delta, 0.1), state.clock.elapsedTime));

  const save = useCallback(
    (change: { position?: { x: number; y: number; z: number; rotationY: number }; scale?: number }) =>
      space.placeModule(item.id, { ...change, revision: item.revision })
        .then((answer) => {
          onItem(answer.item);
          return true;
        })
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : "That did not stick.");
          return false;
        }),
    [item.id, item.revision, onItem],
  );
  const carry = useCarry({ id: item.id, position: item.position, body: place, save: (position) => save({ position }), notice: setNotice });

  const at = full ? { x: 0, y: 0, z: 0, rotationY: 0 } : item.position;
  const words = missing ?? problem ?? notice;
  return (
    <group ref={place} position={[at.x, at.y, at.z]} rotation={[0, at.rotationY, 0]}>
      <group scale={full ? 1 : item.scale}>
        <group ref={root} name={`thing ${item.source.space}/${item.source.entry}`} />
      </group>
      {words ? (
        <Text position={[0, 1.4, 0]} fontSize={0.05} color={missing || problem ? "#f0a0a0" : "#e9edf2"} maxWidth={1.4} textAlign="center" anchorY="bottom" raycast={noRaycast}>
          {`${item.name}: ${words}`}
        </Text>
      ) : null}
      {full ? null : (
        <ThingControls
          item={item}
          carrying={carry.carrying}
          take={carry.take}
          steer={carry.steerByRay}
          drop={carry.dropByRay}
          resize={(by) => void save({ scale: Math.min(MODULE_SCALE.max, Math.max(MODULE_SCALE.min, Math.round(item.scale * by * 1000) / 1000)) })}
          turn={() => void save({ position: { ...item.position, rotationY: (item.position.rotationY + Math.PI / 4) % (Math.PI * 2) } })}
          fullSize={item.role === "space" ? () => void space.placeModule(item.id, { view: "full", revision: item.revision }).then((answer) => onItem(answer.item)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not open it full size.")) : null}
          remove={() => void space.removeRoomItem(item.id).then(() => onRemoved(item.id)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not take it away."))}
        />
      )}
    </group>
  );
}

/**
 * A THING'S OWN CONTROLS, at its feet: a gear that opens MOVE, smaller,
 * bigger, turn, full size (a space) and take away (pressed twice).
 */
function ThingControls({ item, carrying, take, steer, drop, resize, turn, fullSize, remove }: {
  item: ModuleRoomItem;
  carrying: boolean;
  take: (event: import("@react-three/fiber").ThreeEvent<PointerEvent>) => void;
  steer: (event: import("@react-three/fiber").ThreeEvent<PointerEvent>) => void;
  drop: (event: import("@react-three/fiber").ThreeEvent<PointerEvent>) => void;
  resize: (by: number) => void;
  turn: () => void;
  fullSize: (() => void) | null;
  remove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <group position={[0, 0, 0.45]}>
      {/* The MOVE handle, always there: press and drag. */}
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2.6, 0, 0]} onPointerDown={take} onPointerMove={steer} onPointerUp={drop}>
        <planeGeometry args={[0.34, 0.1]} />
        <meshBasicMaterial color={carrying ? "#4f6fd8" : "#243049"} transparent opacity={0.92} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[0, 0.075, 0.012]} rotation={[-Math.PI / 2.6, 0, 0]} fontSize={0.035} color="#f4f6fb" anchorX="center" anchorY="middle" raycast={noRaycast}>
        {carrying ? "MOVING" : `✥ ${item.name.slice(0, 18)}`}
      </Text>
      <WristButton label="⚙" glyph x={0.24} y={0.08} width={0.09} height={0.09} onTap={() => setOpen((now) => !now)} />
      {open ? (
        <group position={[0, 0.22, 0]}>
          <WristButton label="−" glyph x={-0.33} y={0} width={0.1} height={0.1} onTap={() => resize(0.8)} />
          <WristButton label="+" glyph x={-0.21} y={0} width={0.1} height={0.1} onTap={() => resize(1.25)} />
          <WristButton label="⟲" glyph x={-0.09} y={0} width={0.1} height={0.1} onTap={turn} />
          {fullSize ? <WristButton label="FULL SIZE" x={0.08} y={0} width={0.2} height={0.1} onTap={fullSize} /> : null}
          <WristButton
            label={armed ? "SURE?" : "✕"}
            glyph={!armed}
            tone="danger"
            x={0.27}
            y={0}
            width={armed ? 0.14 : 0.1}
            height={0.1}
            onTap={() => {
              if (armed) remove();
              else setArmed(true);
            }}
          />
        </group>
      ) : null}
    </group>
  );
}
