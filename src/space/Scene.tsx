import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ROOM,
  STATIONS,
  WALK_SPEED,
  type Vec3,
} from "../../shared/space-layout";
import { base } from "../router";
import { XR } from "@react-three/xr";
import { Avatar3D, EYE_HEIGHT } from "./Avatar3D";
import { Immersive } from "./Immersive";
import { getXRStore } from "./xr-store";
import type { Comfort } from "./comfort";
import { WebPanel } from "./WebPanel";
import { StillPanel } from "./StillPanel";

import { makeMoveSender, type SpaceConnection } from "./useSpaceSocket";

/**
 * The room.
 *
 * Flat first: a normal browser window, mouse and keyboard. This is not a
 * throwaway step towards the headset — it is the harness every later stage is
 * verified in, because a scene I can screenshot is a scene I can prove
 * something about, and a headset is a scene only Nikk can see.
 *
 * The geometry all comes from `shared/space-layout.ts`, which the server also
 * reads. Nothing here invents a coordinate.
 */

const COLOURS = {
  floor: "#d9d4c7",
  wall: "#efece4",
  trim: "#c2bbaa",
  taskBoard: "#3156d8",
  moodBoard: "#a33d70",
  people: "#3d8063",
} as const;

/**
 * The void.
 *
 * There is no room. No floor, no walls, no ceiling — panels and people hanging
 * in empty space, which is what was asked for and is also more honest: a
 * rendered office was decoration pretending to be a place, and every hour spent
 * on its walls was an hour not spent on what the space is actually for.
 *
 * A faint grid sits under everyone's feet. Not a floor: without ANY ground
 * reference a person cannot tell whether they are moving, and walking in a
 * featureless void is disorienting enough in a window and genuinely unpleasant
 * in a headset. It fades out well before the edge so it reads as a hint rather
 * than a surface.
 */
function Void() {
  const grid = useMemo(() => {
    const material = new THREE.LineBasicMaterial({
      color: "#3a4152",
      transparent: true,
      opacity: 0.5,
    });
    const points: THREE.Vector3[] = [];
    const half = 9;
    for (let i = -half; i <= half; i += 1.5) {
      points.push(
        new THREE.Vector3(-half, 0, i),
        new THREE.Vector3(half, 0, i),
      );
      points.push(
        new THREE.Vector3(i, 0, -half),
        new THREE.Vector3(i, 0, half),
      );
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      material,
    );
  }, []);

  return <primitive object={grid} position={[0, -0.01, 0]} />;
}

/**
 * Everyone else, interpolated toward where the server last put them.
 *
 * The server ticks at 10Hz and the browser draws at 60+. Snapping every 100ms
 * looks like a stutter, so the figure eases toward the last reported position —
 * which shows the same journey, at the same speed, between the same two points.
 * It is smoothing, not invention: nobody is ever drawn anywhere the server has
 * not already put them, only slightly behind.
 */
/**
 * Everyone else.
 *
 * WHICH figures exist comes from the roster, which is React state and changes
 * only when somebody joins or leaves. WHERE every part of them is comes from
 * the ref, read each frame by the figure itself — heads and hands move
 * continuously, and routing that through React would re-render this tree ten
 * times a second per person in order to move three objects.
 *
 * There is no positioning wrapper any more. Head, hands and feet all arrive in
 * room-absolute coordinates, so a group translated to the person's position
 * would add their offset twice and stand everybody at double the distance.
 */
function Crowd({
  peopleRef,
  roster,
  you,
  reducedMotion,
}: {
  peopleRef: SpaceConnection["peopleRef"];
  roster: SpaceConnection["roster"];
  you: string | null;
  reducedMotion: boolean;
}) {
  const cast = roster.filter((person) => person.actorId !== you);

  return (
    <group>
      {cast.map((person) => (
        <Avatar3D
          key={person.actorId}
          actorId={person.actorId}
          kind={person.kind}
          connected={person.connected}
          reducedMotion={reducedMotion}
          live={() =>
            (peopleRef.current ?? []).find(
              (one) => one.actorId === person.actorId,
            )
          }
        />
      ))}
    </group>
  );
}

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * You.
 *
 * WASD or the arrow keys to walk, drag to look. Smooth stick locomotion in the
 * headset is the same maths with a different input, which is why the flat view
 * is a real rehearsal rather than a different feature.
 */
function Me({
  connection,
  reducedMotion,
  active,
}: {
  connection: SpaceConnection;
  reducedMotion: boolean;
  /** False in a headset session: the player's own body steers then, not WASD. */
  active: boolean;
}) {
  const { camera, gl, invalidate } = useThree();
  const held = useRef(new Set<string>());
  const yaw = useRef(0);
  const dragging = useRef(false);
  const sendMove = useMemo(
    () => makeMoveSender(connection.send),
    [connection.send],
  );

  useEffect(() => {
    camera.position.set(ROOM.spawn.x, EYE_HEIGHT, ROOM.spawn.z);
    // Facing the task board on the far wall, which is where a newcomer should
    // be looking. A three.js camera looks down -Z at yaw 0, and the board is at
    // negative Z, so 0 is the answer — the first version used Math.PI and put
    // every newcomer's nose against the back wall.
    yaw.current = 0;
    camera.rotation.set(0, yaw.current, 0, "YXZ");
  }, [camera]);

  // TELL THE SERVER WHERE WE PUT THE CAMERA, once, as soon as the socket is up.
  //
  // Without this the client and the server disagree the whole time somebody
  // stands still: the browser draws them at the spawn point while the server
  // still has them wherever their last board action put them, labelled with the
  // reason for it. Everyone else in the room sees the stale one.
  const announced = useRef(false);
  const open = connection.status.state === "open";
  useEffect(() => {
    if (!open || announced.current) return;
    announced.current = true;
    connection.send({
      type: "move",
      at: { x: camera.position.x, y: 0, z: camera.position.z },
      facing: yaw.current,
    });
  }, [open, connection, camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    /**
     * Drag-to-look listens on the canvas's CONTAINER, not the canvas.
     *
     * `occlude="blending"` on the panels puts the canvas above the DOM with
     * `pointer-events: none`, so the canvas itself receives nothing. The
     * container still does — and a pointerdown that started inside a panel is
     * ignored, so scrolling the board does not also swing the view around.
     */
    const surface = canvas.parentElement ?? canvas;
    const startedInAPanel = (event: PointerEvent) =>
      event.target instanceof Element &&
      event.target.closest(".space-panel-frame") !== null;

    const down = (event: KeyboardEvent) => {
      if (!KEYS[event.code]) return;
      held.current.add(event.code);
      // Only swallow the key when the canvas is the thing being driven.
      if (document.activeElement === canvas) event.preventDefault();
      invalidate();
    };
    const up = (event: KeyboardEvent) => held.current.delete(event.code);
    const blur = () => held.current.clear();

    const startDrag = (event: PointerEvent) => {
      if (startedInAPanel(event)) return;
      dragging.current = true;
    };
    const stopDrag = () => {
      dragging.current = false;
    };
    const look = (event: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= event.movementX * 0.004;
      camera.rotation.set(0, yaw.current, 0, "YXZ");
      invalidate();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    surface.addEventListener("pointerdown", startDrag as EventListener);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointermove", look);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      surface.removeEventListener("pointerdown", startDrag as EventListener);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointermove", look);
    };
  }, [camera, gl, invalidate]);

  useFrame((_, delta) => {
    if (!active) return;
    let forward = 0;
    let strafe = 0;
    for (const code of held.current) {
      const key = KEYS[code];
      if (!key) continue;
      strafe += key[0];
      forward += key[1];
    }
    // NOT AN EARLY RETURN ANY MORE. Standing still is not the same as having
    // nothing to say: a person who has stopped walking is still looking around,
    // and skipping these frames left them reported with no head at all — so
    // everyone else drew them staring rigidly ahead while they turned to watch
    // the room. The rate limiter in makeMoveSender caps the traffic; this only
    // decides whether there is anything to cap.
    const walking = forward !== 0 || strafe !== 0;
    if (walking) {
      // Normalised, so walking diagonally is not faster than walking straight.
      const distance = (WALK_SPEED * delta) / Math.hypot(forward, strafe);

      // Walk in the direction you are looking, which is what makes turning and
      // walking feel like one action rather than two.
      //
      // At yaw 0 the camera looks down -Z, so ahead is (-sin y, 0, -cos y) and
      // right is (cos y, 0, -sin y). `forward` is negative for W (see KEYS), so
      // ahead is -forward. Written out rather than condensed: the first version
      // folded the signs together and got two of the four wrong, which reads as
      // "the controls are inverted" rather than as an error in one expression.
      const ahead = -forward;
      camera.position.x +=
        (ahead * -Math.sin(yaw.current) + strafe * Math.cos(yaw.current)) *
        distance;
      camera.position.z +=
        (ahead * -Math.cos(yaw.current) + strafe * -Math.sin(yaw.current)) *
        distance;

      // The walls are walls.
      const margin = 0.45;
      camera.position.x = Math.max(
        -ROOM.width / 2 + margin,
        Math.min(ROOM.width / 2 - margin, camera.position.x),
      );
      camera.position.z = Math.max(
        -ROOM.depth / 2 + margin,
        Math.min(ROOM.depth / 2 - margin, camera.position.z),
      );
      camera.position.y = EYE_HEIGHT;
    }

    const at: Vec3 = { x: camera.position.x, y: 0, z: camera.position.z };
    // A HEAD, AND NO HANDS. In a window we genuinely know where the viewer's
    // eyeline is and which way it is turned — that is the camera. We know
    // nothing whatever about their hands, so none are sent and none are drawn.
    // Reporting a pair at some plausible resting position would be inventing
    // the one thing hands are good at showing.
    sendMove(at, yaw.current, {
      head: {
        p: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        q: {
          x: camera.quaternion.x,
          y: camera.quaternion.y,
          z: camera.quaternion.z,
          w: camera.quaternion.w,
        },
      },
      hands: { left: null, right: null },
    });
    if (reducedMotion) invalidate();
  });

  return null;
}

/** Redraw on a snapshot, for a scene that is not running a continuous loop. */
function OnDemand({ connection }: { connection: SpaceConnection }) {
  const { invalidate } = useThree();
  useEffect(() => {
    connection.onSnapshot.current = () => invalidate();
    return () => {
      connection.onSnapshot.current = null;
    };
  }, [connection, invalidate]);
  return null;
}

export default function Scene({
  connection,
  reducedMotion,
  comfort,
  onImmersiveChange,
  inHeadset,
}: {
  connection: SpaceConnection;
  reducedMotion: boolean;
  comfort: Comfort;
  onImmersiveChange: (inSession: boolean) => void;
  /** True once a headset session is live. */
  inHeadset: boolean;
}) {
  const you = connection.status.state === "open" ? connection.status.you : null;

  return (
    <Canvas
      // REDUCED MOTION IS HONOURED HERE, EXPLICITLY.
      //
      // src/styles.css turns animation off globally with CSS, which a
      // requestAnimationFrame loop ignores completely — so a scene that did
      // nothing about it would silently break a promise the rest of the app
      // keeps. On demand means nothing moves unless something happened: a
      // snapshot arrived, or you pressed a key. Other people snap between
      // positions instead of gliding, which is the point rather than a
      // shortcoming.
      frameloop={reducedMotion ? "demand" : "always"}
      camera={{
        fov: 70,
        near: 0.1,
        far: 60,
        position: [ROOM.spawn.x, EYE_HEIGHT, ROOM.spawn.z],
      }}
      gl={{ antialias: true }}
      tabIndex={0}
      style={{ outline: "none", touchAction: "none" }}
    >
      <XR store={getXRStore()}>
        {/* Black void. Left UNSET in a headset so the compositor can show
          passthrough behind the scene where the device supports it; where it
          does not, the session is simply black, which is what was asked for. */}
        {inHeadset ? null : <color attach="background" args={["#0b0d12"]} />}
        <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
        <directionalLight position={[3, 6, 4]} intensity={1.4} />
        <Void />
        {/* The real tabs, live — replaced in a headset by something that says why
          they are not there. DOM is not composited into an immersive frame, so
          leaving them mounted would keep three copies of the app running to
          draw nothing, and leaving the spaces empty told nobody anything. */}
        {inHeadset
          ? // Photographs of the same pages, taken on the server. The live panels
            // are DOM and a session draws 3D only.
            Object.values(STATIONS).map((station) => (
              <StillPanel
                key={station.id}
                station={station}
                base={base}
                active={inHeadset}
              />
            ))
          : Object.values(STATIONS).map((station) => (
              <WebPanel key={station.id} station={station} base={base} />
            ))}
        <Crowd
          peopleRef={connection.peopleRef}
          roster={connection.roster}
          you={you}
          reducedMotion={reducedMotion}
        />
        <Me
          connection={connection}
          reducedMotion={reducedMotion}
          active={!inHeadset}
        />
        <OnDemand connection={connection} />
        {/* Renders nothing at all until a headset session exists — see Immersive.tsx. */}
        <Immersive
          comfort={comfort}
          send={connection.send}
          onChange={onImmersiveChange}
        />
      </XR>
    </Canvas>
  );
}
