import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM, STATIONS, WALK_SPEED, type Vec3 } from "../../shared/space-layout";
import { Avatar3D, EYE_HEIGHT } from "./Avatar3D";
import { makeLabelTexture } from "./label-texture";
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

/** The room shell. Static: built once, never re-created on a snapshot. */
function Shell() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshStandardMaterial color={COLOURS.floor} roughness={0.95} />
      </mesh>

      {/* Four walls, normals pointing INTO the room, drawn single-sided.
          Visible from inside, invisible from outside — so a debug camera above
          the room can look straight down into it.

          This was BackSide first, on the reasoning that the outside faces
          should be the hidden ones. Backwards: with inward normals, a camera
          inside sees the FRONT face, so BackSide hid every wall and the room
          rendered as a floor floating in the clear colour. Caught by looking at
          it, which is the entire argument for building the flat view before the
          headset one. */}
      {[
        { position: [0, ROOM.height / 2, -ROOM.depth / 2], rotation: [0, 0, 0], width: ROOM.width },
        { position: [0, ROOM.height / 2, ROOM.depth / 2], rotation: [0, Math.PI, 0], width: ROOM.width },
        { position: [-ROOM.width / 2, ROOM.height / 2, 0], rotation: [0, Math.PI / 2, 0], width: ROOM.depth },
        { position: [ROOM.width / 2, ROOM.height / 2, 0], rotation: [0, -Math.PI / 2, 0], width: ROOM.depth },
      ].map((wall, index) => (
        <mesh
          key={index}
          position={wall.position as [number, number, number]}
          rotation={wall.rotation as [number, number, number]}
        >
          <planeGeometry args={[wall.width, ROOM.height]} />
          <meshStandardMaterial color={COLOURS.wall} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The three surfaces, as empty frames.
 *
 * Empty ON PURPOSE at this stage. Stage 4 hangs the real cards and images on
 * them; until then a frame with nothing in it says "nothing is here yet", and a
 * frame with invented cards in it would say something false to anyone who
 * walked up to read it.
 */
function Stations() {
  const labels = useMemo(
    () =>
      Object.fromEntries(
        Object.values(STATIONS).map((station) => [
          station.id,
          makeLabelTexture(station.label, { pixelsPerLine: 56 }),
        ]),
      ),
    [],
  );

  return (
    <group>
      {Object.values(STATIONS).map((station) => {
        const colour =
          station.id === "taskBoard" ? COLOURS.taskBoard
          : station.id === "moodBoard" ? COLOURS.moodBoard
          : COLOURS.people;
        return (
          <group
            key={station.id}
            position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
            rotation={[0, station.surface.rotationY, 0]}
          >
            <mesh position={[0, 0, 0.02]}>
              <planeGeometry args={[station.surface.width, station.surface.height]} />
              <meshStandardMaterial color="#faf8f3" roughness={0.9} />
            </mesh>
            {/* A coloured edge so the three are distinguishable across the room
                without reading the label. */}
            <mesh position={[0, -station.surface.height / 2 - 0.06, 0.03]}>
              <planeGeometry args={[station.surface.width, 0.1]} />
              <meshBasicMaterial color={colour} />
            </mesh>
            {/* Named, so a wall you are looking at says what it is. An unlabelled
                blank frame is indistinguishable from a rendering fault. */}
            {labels[station.id] ? (
              <mesh position={[0, station.surface.height / 2 - 0.28, 0.04]}>
                <planeGeometry args={[2.6, 0.65]} />
                <meshBasicMaterial map={labels[station.id]!} transparent />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
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
  const groups = useRef(new Map<string, THREE.Group>());
  // Reused rather than allocated per person per frame.
  const scratch = useRef(new THREE.Vector3());

  // WHICH figures exist comes from the roster, which is React state and changes
  // only when somebody joins or leaves. WHERE they are comes from the ref, read
  // by the render loop. Driving the list off the ref instead — the first thing
  // I wrote — means a new arrival never appears, because a ref does not
  // re-render anything.
  const cast = roster.filter((person) => person.actorId !== you);

  useFrame((_, delta) => {
    const current = peopleRef.current ?? [];
    for (const person of current) {
      const group = groups.current.get(person.actorId);
      if (!group) continue;
      if (reducedMotion) {
        group.position.set(person.at.x, person.at.y, person.at.z);
        group.rotation.y = person.facing;
        continue;
      }
      // Cap the ease at walking speed plus a margin, so catching up after a
      // dropped frame still looks like walking rather than sliding.
      const target = scratch.current.set(person.at.x, person.at.y, person.at.z);
      const gap = target.distanceTo(group.position);
      if (gap > 0.001) {
        const step = Math.min(gap, WALK_SPEED * 1.6 * delta);
        group.position.addScaledVector(target.sub(group.position).normalize(), step);
      }
      // Shortest way round, so a figure turning from 179° to -179° does not
      // spin the long way.
      const turn = ((person.facing - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      group.rotation.y += turn * Math.min(1, delta * 8);
    }
  });

  return (
    <group>
      {cast.map((person) => (
        <group
          key={person.actorId}
          ref={(group) => {
            if (group) {
              if (!groups.current.has(person.actorId)) {
                // Appear where the server says, not at the origin — otherwise
                // everyone who joins is briefly drawn walking out of the middle
                // of the floor, which never happened.
                const known = (peopleRef.current ?? []).find((one) => one.actorId === person.actorId);
                if (known) {
                  group.position.set(known.at.x, known.at.y, known.at.z);
                  group.rotation.y = known.facing;
                }
              }
              groups.current.set(person.actorId, group);
            } else groups.current.delete(person.actorId);
          }}
        >
          <Avatar3D
            actorId={person.actorId}
            kind={person.kind}
            connected={person.connected}
            because={person.because}
          />
        </group>
      ))}
    </group>
  );
}

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
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
}: {
  connection: SpaceConnection;
  reducedMotion: boolean;
}) {
  const { camera, gl, invalidate } = useThree();
  const held = useRef(new Set<string>());
  const yaw = useRef(0);
  const dragging = useRef(false);
  const sendMove = useMemo(() => makeMoveSender(connection.send), [connection.send]);

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
    const down = (event: KeyboardEvent) => {
      if (!KEYS[event.code]) return;
      held.current.add(event.code);
      // Only swallow the key when the canvas is the thing being driven.
      if (document.activeElement === canvas) event.preventDefault();
      invalidate();
    };
    const up = (event: KeyboardEvent) => held.current.delete(event.code);
    const blur = () => held.current.clear();

    const startDrag = () => { dragging.current = true; };
    const stopDrag = () => { dragging.current = false; };
    const look = (event: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= event.movementX * 0.004;
      camera.rotation.set(0, yaw.current, 0, "YXZ");
      invalidate();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    canvas.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointermove", look);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("pointerdown", startDrag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointermove", look);
    };
  }, [camera, gl, invalidate]);

  useFrame((_, delta) => {
    let forward = 0;
    let strafe = 0;
    for (const code of held.current) {
      const key = KEYS[code];
      if (!key) continue;
      strafe += key[0];
      forward += key[1];
    }
    if (forward === 0 && strafe === 0) return;

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
    camera.position.x += (ahead * -Math.sin(yaw.current) + strafe * Math.cos(yaw.current)) * distance;
    camera.position.z += (ahead * -Math.cos(yaw.current) + strafe * -Math.sin(yaw.current)) * distance;

    // The walls are walls.
    const margin = 0.45;
    camera.position.x = Math.max(-ROOM.width / 2 + margin, Math.min(ROOM.width / 2 - margin, camera.position.x));
    camera.position.z = Math.max(-ROOM.depth / 2 + margin, Math.min(ROOM.depth / 2 - margin, camera.position.z));
    camera.position.y = EYE_HEIGHT;

    const at: Vec3 = { x: camera.position.x, y: 0, z: camera.position.z };
    sendMove(at, yaw.current);
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
}: {
  connection: SpaceConnection;
  reducedMotion: boolean;
}) {
  const you = connection.status.state === "open" ? connection.status.you : null;

  return (
    <Canvas
      shadows
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
      camera={{ fov: 70, near: 0.1, far: 60, position: [ROOM.spawn.x, EYE_HEIGHT, ROOM.spawn.z] }}
      gl={{ antialias: true }}
      tabIndex={0}
      style={{ outline: "none", touchAction: "none" }}
    >
      <color attach="background" args={["#cfd6dd"]} />
      <hemisphereLight args={["#ffffff", "#b8ae9c", 1.5]} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} castShadow />
      <Shell />
      <Stations />
      <Crowd
        peopleRef={connection.peopleRef}
        roster={connection.roster}
        you={you}
        reducedMotion={reducedMotion}
      />
      <Me connection={connection} reducedMotion={reducedMotion} />
      <OnDemand connection={connection} />
    </Canvas>
  );
}
