import { useState, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LOOK_SENSITIVITY, tiltBy } from "./look-pitch";
import { setRoomPreferences, useRoomPreferences } from "./room-preferences";
import {
  ROOM,
  STATIONS,
  WALK_SPEED,
  clampToWorld,
  facingFor,
  type Vec3,
} from "../../shared/space-layout";
import { base } from "../router";
import { XR } from "@react-three/xr";
import { Avatar3D, EYE_HEIGHT } from "./Avatar3D";
import { Immersive } from "./Immersive";
import { getXRStore } from "./xr-store";
import type { Comfort } from "./comfort";
import { pointerWasClaimed } from "./pointer-claim";
import { RoomPanel } from "./RoomPanel";
import { useBoardCards } from "./useBoardCards";
import { ScreenWall } from "./ScreenWall";
import { ArrivalSparkles } from "./ArrivalSparkles";
import { SpeakingMotes } from "./SpeakingMotes";
import { TouchReactions } from "./TouchReactions";
import { useRoomFeed } from "./useRoomFeed";
import { useRoomShowing } from "./useRoomShowing";
import type { PanelChoices } from "./usePanelChoices";
import type { PanelArrange } from "./usePanelArrange";
import type { VoiceChat } from "./useVoiceChat";
import { SpatialVoices } from "./SpatialVoices";
import { Movable } from "./Movable";
import { placeOf, savePlacement } from "./panel-placement";
import { PANEL_SCALE, scaleOf } from "../../shared/panel-place";
import type { SettingsItem } from "../../shared/settings-3d";
import { defaultPlacement } from "../../shared/panel-place";
import type { Placement } from "../../shared/space-wire";
import { RoomItems } from "./RoomItems";
import { MeditationOrb } from "./MeditationOrb";
import { space } from "../space-client";

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

/**
 * The void.
 *
 * There is no room. No floor, no walls, no ceiling — panels and people hanging
 * in empty space, which is what was asked for and is also more honest: a
 * rendered office was decoration pretending to be a place, and every hour spent
 * on its walls was an hour not spent on what the space is actually for.
 *
 * A faint grid sits under everyone's feet IN A WINDOW. Not a floor: without any
 * ground reference at all a person cannot tell whether they are moving, and
 * walking in a featureless void is genuinely disorienting on a flat screen.
 *
 * It is not drawn in a headset. The reasoning that put it there assumed the
 * void; in passthrough the real floor of the real room is already underfoot,
 * and a glowing grid laid over your own carpet is worse than nothing —
 * it is the one thing in the scene pretending to be somewhere you are not.
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
  heard,
}: {
  peopleRef: SpaceConnection["peopleRef"];
  roster: SpaceConnection["roster"];
  you: string | null;
  reducedMotion: boolean;
  heard: SpaceConnection["heard"];
}) {
  /**
   * The last thing each person said aloud, for as long as it takes to read.
   *
   * HOW LONG DEPENDS ON THE LINE, which was Inkstone's review point and is
   * plainly right: a fixed thirty seconds left "Done." hanging over somebody's
   * head long after it meant anything, while a full-length remark got the same
   * window as a single word. Six seconds for something short, up to fourteen
   * for something at the spoken cap.
   *
   * It still expires. Leaving a line indefinitely turns a remark into a label —
   * somebody who said "looking at the blockers" an hour ago should not still
   * appear to be saying it.
   */
  const lastSaid = useMemo(() => {
    const now = Date.now();
    const latest = new Map<string, string>();
    for (const utterance of heard) {
      if (!utterance.say) continue;
      // Roughly reading speed with a beat to notice it, bounded at both ends.
      const window = Math.min(14_000, Math.max(6_000, 2_000 + utterance.say.length * 55));
      if (now - Date.parse(utterance.at) > window) continue;
      latest.set(utterance.actorId, utterance.say);
    }
    return latest;
  }, [heard]);

  const cast = roster.filter((person) => person.actorId !== you);

  return (
    <group>
      {cast.map((person) => (
        <Avatar3D
          key={person.actorId}
          actorId={person.actorId}
          body={person.body}
          kind={person.kind}
          connected={person.connected}
          reducedMotion={reducedMotion}
          saying={lastSaid.get(person.actorId) ?? null}
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
  openPanels,
}: {
  connection: SpaceConnection;
  reducedMotion: boolean;
  /** False in a headset session: the player's own body steers then, not WASD. */
  active: boolean;
  /** What this person has open, which decides which way they arrive facing. */
  openPanels: string[];
}) {
  const { camera, gl, invalidate } = useThree();
  const held = useRef(new Set<string>());
  const yaw = useRef(0);
  /**
   * Looking up and down, which the window could not do until Nikk asked for it.
   * Kept separate from `yaw` because only the HEADING may drive walking: tilt
   * the camera and you must still walk along the floor rather than into the
   * air. See the step below, which reads `yaw` alone.
   */
  const pitch = useRef(0);
  const dragging = useRef(false);
  /**
   * The press that might become a look, held until the first move decides.
   * Null once a panel has claimed it, or once the look has begun.
   */
  const pressed = useRef<PointerEvent | null>(null);
  const sendMove = useMemo(
    () => makeMoveSender(connection.send),
    [connection.send],
  );

  // ONLY ON ARRIVAL, which is why `openPanels` is read through a ref rather
  // than listed as a dependency. Closing a panel while you are standing there
  // must not spin you round to re-centre what is left; being turned by the room
  // while you are looking at something is disorienting in a window and
  // genuinely unpleasant in a headset.
  const panelsOnArrival = useRef(openPanels);
  panelsOnArrival.current = openPanels;
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    camera.position.set(ROOM.spawn.x, EYE_HEIGHT, ROOM.spawn.z);
    // Facing the middle of whatever this person has open. A three.js camera
    // looks down -Z at yaw 0, which is straight up the arc, so a full set of
    // panels leaves this at 0 — but somebody who has closed everything except
    // the panel at one end would otherwise arrive looking at empty space with
    // their one panel off the edge of the screen.
    yaw.current = facingFor(panelsOnArrival.current);
    pitch.current = 0;
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
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
     * Drag-to-look listens on the canvas's CONTAINER, not the canvas, and skips
     * a press a panel already handled.
     *
     * IT USED TO ASK A QUESTION THAT NOW ALWAYS ANSWERS NO. While the panels
     * were DOM behind `occlude="blending"`, the canvas was `pointer-events:
     * none`, the press really landed on a div, and `closest(".space-panel-
     * frame")` found it. The panels are meshes now: every press lands on the
     * canvas, that check never matches again, and the camera would swing round
     * under every card drag in the room.
     *
     * So the meshes say so themselves — see `pointer-claim.ts`. The container
     * listener still runs second, because a DOM event reaches its target before
     * its ancestors, which is what makes this work at all.
     */
    const surface = canvas.parentElement ?? canvas;
    const startedInAPanel = (event: PointerEvent) =>
      pointerWasClaimed(event) ||
      (event.target instanceof Element && event.target.closest(".space-panel-frame") !== null);

    const down = (event: KeyboardEvent) => {
      if (!KEYS[event.code]) return;
      held.current.add(event.code);
      // Only swallow the key when the canvas is the thing being driven.
      if (document.activeElement === canvas) event.preventDefault();
      invalidate();
    };
    const up = (event: KeyboardEvent) => held.current.delete(event.code);
    const blur = () => held.current.clear();

    /**
     * THE DECISION IS MADE ON THE FIRST MOVE, NOT ON THE PRESS.
     *
     * Both R3F and this listener sit on the same element — R3F's event source
     * defaults to the canvas's parent, which is exactly what `surface` is — so
     * "the mesh speaks first" is a statement about REGISTRATION ORDER, not
     * about bubbling, and it is not something to build on. I did build on it,
     * and the room proved it: dragging a card turned the camera, which moved
     * the board out from under the pointer, so the drag died half-finished and
     * the next one missed the panel entirely.
     *
     * Waiting for the first move removes the ordering question altogether. By
     * the time a move arrives, the press has certainly been dispatched and any
     * panel that wanted it has said so. It also means a click that never moves
     * never starts a look, which is what a click should do.
     */
    const startDrag = (event: PointerEvent) => {
      pressed.current = startedInAPanel(event) ? null : event;
      dragging.current = false;
    };
    const stopDrag = () => {
      pressed.current = null;
      dragging.current = false;
    };
    const look = (event: PointerEvent) => {
      if (!dragging.current) {
        const down = pressed.current;
        if (!down) return;
        // Asked now rather than at press time: a panel has had its chance.
        if (pointerWasClaimed(down)) {
          pressed.current = null;
          return;
        }
        dragging.current = true;
      }
      yaw.current -= event.movementX * LOOK_SENSITIVITY;
      // Clamped, and the clamp is the part that matters: "YXZ" gimbal-locks at
      // exactly ±90° and inverts past it. See look-pitch.ts.
      pitch.current = tiltBy(pitch.current, event.movementY);
      camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
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

      // THERE ARE NO WALLS ANY MORE. Nikk: "remove the limited walking
      // boundary we don't want to have any limit to walking". What is left is
      // the arithmetic bound ten kilometres out, so a position stays a usable
      // number rather than to stop anybody — see WORLD in shared/space-layout.
      const walked = clampToWorld({ x: camera.position.x, z: camera.position.z });
      camera.position.x = walked.x;
      camera.position.z = walked.z;
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
  spaceRoomName,
  reducedMotion,
  comfort,
  onImmersiveChange,
  onReturnToLobby,
  onSwitchRoom,
  inHeadset,
  panels,
  arrange,
  onPanelTrouble,
  voice,
}: {
  connection: SpaceConnection;
  /** Server-confirmed WebHarness room this session is standing in. */
  spaceRoomName: string | null;
  reducedMotion: boolean;
  comfort: Comfort;
  onImmersiveChange: (inSession: boolean) => void;
  onReturnToLobby: () => void;
  /** Move this session to another room in place: the Rooms page (shared/room-switch.ts). */
  onSwitchRoom: (roomName: string) => Promise<void>;
  /** True once a headset session is live. */
  inHeadset: boolean;
  /**
   * Which panels this person has open, and the way to change it.
   *
   * THE WHOLE OBJECT rather than just the open ids: the headset settings can
   * now open and close panels too, and passing the list alone would have meant
   * a second prop beside it carrying the setter — two halves of one thing,
   * which is how they drift apart.
   */
  panels: PanelChoices;
  /** Which panels are being moved or resized, and by which gesture. */
  arrange: PanelArrange;
  /** Said out loud when a panel cannot go where it was dropped. */
  onPanelTrouble: (why: string | null) => void;
  /** Live voice, owned above the scene so a session change cannot close it. */
  voice: VoiceChat;
}) {
  /**
   * THE ROOM'S THEME, read FIRST. Reading the preferences is what applies the
   * palette (see room-preferences.ts), and a parent renders before its
   * children — so by the time any board below paints, CARD_INK is already the
   * dark one. Without this the first frame would be white and then repaint.
   */
  const { dark } = useRoomPreferences();
  const you = connection.status.state === "open" ? connection.status.you : null;
  /**
   * The WebHarness room, read ONCE for the whole scene.
   *
   * It used to be read here for its name and again inside ChatPanel3D for its
   * messages — two hooks, two timers, two cursors, twice the requests, for one
   * conversation. Read here and passed down.
   */
  // The same room powers the native chat panel and headset posts. Fetching the
  // selected room from the session also makes direct /room reloads safe; the
  // front door's in-memory selection is not the source of truth.
  const feed = useRoomFeed(spaceRoomName !== null, spaceRoomName ?? "saha.ing", spaceRoomName);


  /**
   * The board's cards, and which one has been pulled out into its own panel.
   *
   * THE ROOM NEVER HAD THIS. The board was an iframe, so its contents lived
   * inside a page the room could not see into; drawing cards natively means
   * fetching them. `showing.projectId` is which project the room is looking at,
   * chosen by whoever is in it — see RoomShowing.
   */
  const boardFeed = useBoardCards(connection.showing.projectId ?? null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const openPanels = panels.open;


  // The lists to choose from, and the way to change what the room shows. The
  // current VALUE comes from the socket, not from here — see useRoomShowing.
  /**
   * ALWAYS ON, WHERE IT USED TO BE HEADSET-ONLY.
   *
   * This was `useRoomShowing(inHeadset, …)`, so on a desktop the project list
   * was never even fetched — and the one control that decides what the whole
   * room is looking at could only be reached from inside a session. The
   * settings panel is on the arc for both now, so the lists have to be there
   * for both.
   */
  const showingChoices = useRoomShowing(true, connection.showing);
  /**
   * The two reading panels, as rows.
   *
   * SHAPED HERE rather than in the panel, so the panel stays a thing that draws
   * a list and knows nothing about rosters or utterances.
   */
  const peopleRows = useMemo(
    () =>
      connection.roster.map((person) => ({
        primary: person.actorId,
        secondary: person.connected ? (person.kind ?? "here") : "away",
        // Somebody who has left is still part of the room's memory, but saying
        // so in full ink would claim they are standing there.
        faded: !person.connected,
      })),
    [connection.roster],
  );

  const saidRows = useMemo(
    () =>
      connection.heard
        // `say` is what was actually said; `detail` is the longer version some
        // sources carry. An utterance with neither is a record that something
        // happened, not something to read off a wall.
        .filter((utterance) => (utterance.say ?? utterance.detail ?? "").trim() !== "")
        .map((utterance) => ({
          primary: (utterance.say ?? utterance.detail ?? "").trim(),
          secondary: utterance.to ? `${utterance.actorId} → ${utterance.to}` : utterance.actorId,
        })),
    [connection.heard],
  );


  /**
   * WHAT THE SETTINGS PANEL OFFERS, built from the room's own state.
   *
   * Assembled here rather than inside the panel because every one of these
   * already exists somewhere above: the socket owns what the room is showing,
   * `panels` owns which are open, `arrange` owns which are being moved, and a
   * panel's size lives in its placement. A second source for any of them would
   * be a second opinion.
   */
  const settings = useMemo(() => {
    /**
     * HOW THE ROOM LOOKS, FIRST. Dark mode is on for everybody until they turn
     * it off, and this panel is the settings a person actually has in front of
     * them — so the switch belongs here as well as in the look-down menu.
     * Nikk: "also add a setting to turn off dark mode in settings".
     */
    const items: SettingsItem[] = [
      { kind: "heading", label: "How the room looks" },
      { kind: "toggle", id: "theme:dark", label: "Dark mode", on: dark },
      // Shared, like what the wall shows: the orb is in the room for everybody.
      { kind: "toggle", id: "orb:shown", label: "Breathing orb", on: connection.meditation?.shown === true },
      { kind: "heading", label: "What the room is showing" },
    ];
    if (showingChoices.projects === null) {
      items.push({ kind: "note", label: "The projects could not be read." });
    } else if (showingChoices.projects.length === 0) {
      items.push({ kind: "note", label: "No projects yet." });
    } else {
      for (const project of showingChoices.projects) {
        items.push({
          kind: "choice",
          id: `project:${project.id}`,
          label: project.name,
          selected: connection.showing.projectId === project.id,
        });
      }
    }

    if (showingChoices.boards && showingChoices.boards.length > 0) {
      items.push({ kind: "heading", label: "Mood board" });
      for (const moodBoard of showingChoices.boards) {
        items.push({
          kind: "choice",
          id: `board:${moodBoard.id}`,
          label: moodBoard.title,
          selected: connection.showing.boardId === moodBoard.id,
        });
      }
    }

    items.push({ kind: "heading", label: "Panels" });
    for (const panel of panels.catalogue) {
      const open = panels.open.includes(panel.id);
      items.push({ kind: "toggle", id: `panel:${panel.id}`, label: panel.label, on: open });
      if (!open) continue;
      items.push({
        kind: "stepper",
        id: `size:${panel.id}`,
        label: `${panel.label} size`,
        value: `${Math.round(scaleOf(placeOf(connection.places, panel.id)) * 100)}%`,
      });
      items.push({
        kind: "cycle",
        id: `arrange:${panel.id}`,
        label: `${panel.label} drag`,
        value: arrange.modeOf(panel.id),
      });
    }

    const onPress = (id: string) => {
      const [kind, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
      if (kind === "theme") return setRoomPreferences({ dark: !dark });
      if (kind === "orb") {
        return void space.meditate({ action: "show", shown: connection.meditation?.shown !== true })
          .then((answer) => connection.setMeditation(answer.meditation))
          .catch((error: Error) => onPanelTrouble(error.message));
      }
      if (kind === "project") return showingChoices.choose({ projectId: rest, boardId: null });
      if (kind === "board") return showingChoices.choose({ projectId: connection.showing.projectId ?? null, boardId: rest });
      if (kind === "panel") return panels.setOpen(rest, !panels.open.includes(rest));
      if (kind === "arrange") return arrange.cycle(rest);
      if (kind === "size") {
        const [panelId, which] = rest.split(":");
        const place = placeOf(connection.places, panelId);
        const step = which === "more" ? 0.2 : -0.2;
        const next = Math.min(PANEL_SCALE.max, Math.max(PANEL_SCALE.min, scaleOf(place) + step));
        void savePlacement({ ...place, scale: next }).then(onPanelTrouble);
      }
    };

    return { items, onPress };
  }, [arrange, connection, dark, onPanelTrouble, panels, showingChoices]);


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
      // XR tracking/contact must still run every device frame. Decorative Go
      // motion separately honors reducedMotion, without freezing a carried stone.
      frameloop={reducedMotion && !inHeadset ? "demand" : "always"}
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
        {/* NOT IN A HEADSET. The grid is there so that somebody moving through
          a featureless void can tell they are moving — which is a real problem
          in a window and no problem at all in passthrough, where the actual
          floor of the actual room is right there. Nikk, on an Aura: "passthrough
          is working, except for the ground, also we don't even need the
          ground". */}
        {inHeadset ? null : <Void />}
        {/* The real tabs, live — replaced in a headset by something that says why
          they are not there. DOM is not composited into an immersive frame, so
          leaving them mounted would keep three copies of the app running to
          draw nothing, and leaving the spaces empty told nobody anything. */}
        {/* ONLY WHAT YOU HAVE OPEN, and unmounted rather than hidden: a live
          panel is an iframe running the whole app, and three of those drawing
          nothing behind a `visible={false}` is the same waste as leaving them
          up in a headset. */}
        {openPanels
          .map((id) => STATIONS[id])
          .filter((station) => station !== undefined)
          .map((station) => (
            <Movable
              key={station.id}
              // The server's word if it has spoken, and the computed arc until
              // then — so the room draws itself on the first frame rather than
              // appearing empty and filling in when the socket opens.
              place={placeOf(connection.places, station.id)}
              mode={arrange.modeOf(station.id)}
              // The save is handed back so the panel lets go of its hold only
              // once the save has landed, and goes back if the room refused it.
              onPlaced={(next) => savePlacement(next).then((why) => { onPanelTrouble(why); return why; })}
              onTrouble={onPanelTrouble}
            >
              {/* ONE PANEL, CHOSEN BY WHAT IT SHOWS, NOT BY WHERE YOU ARE.
                  This was a branch on `inHeadset` that gave the desktop an
                  iframe and a headset a photograph — two implementations of
                  every panel, which is why anything added to one was missing
                  from the other. See RoomPanel and docs/ONE-ROOM.md. */}
              <RoomPanel
                // A NEW THEME IS A NEW PANEL. Painted canvases keep the colours
                // they were drawn in, so switching dark or light remounts every
                // panel and each paints itself again from CARD_INK. Rare, cheap,
                // and it does not end a headset session: only these meshes go.
                key={dark ? "dark" : "light"}
                station={station}
                feed={feed}
                boardFeed={boardFeed}
                onSay={onPanelTrouble}
                onOpenCard={setOpenCard}
                openCard={openCard}
                onCloseCard={() => setOpenCard(null)}
                projectId={connection.showing.projectId ?? null}
                settings={settings}
                boardId={connection.showing.boardId ?? null}
                people={peopleRows}
                said={saidRows}
              />
            </Movable>
          ))}
        {/* Shared screens. A person's hangs in the row above the panels; an
          agent's sits in front of the agent, only while it is working there.
          Textures on planes, so the same in the window and in a headset. */}
        <ScreenWall base={base} peopleRef={connection.peopleRef} reducedMotion={reducedMotion} />
        {/* Sparks where an agent reaches a board, as its card change lands. */}
        <ArrivalSparkles peopleRef={connection.peopleRef} reducedMotion={reducedMotion} />
        {/* Light rising off whoever is speaking, for as long as their line
          lasts. Nikk: "particle effects... pulsing out of them that happens
          while the voice thing is playing". See speaking-motes.ts. */}
        <SpeakingMotes
          peopleRef={connection.peopleRef}
          liveUtterance={connection.liveUtterance}
          you={you}
          reducedMotion={reducedMotion}
        />
        {/* How an agent took being touched, above its head for a moment. */}
        <TouchReactions subscribe={connection.subscribe} peopleRef={connection.peopleRef} />
        <Crowd
          peopleRef={connection.peopleRef}
          roster={connection.roster}
          you={you}
          reducedMotion={reducedMotion}
          heard={connection.heard}
        />
        <Me
          connection={connection}
          reducedMotion={reducedMotion}
          active={!inHeadset}
          openPanels={openPanels}
        />
        {/* Each voice placed where its speaker is standing. Nothing at all
          until somebody opens a microphone. */}
        <SpatialVoices streams={voice.streams} muted={voice.muted} peopleRef={connection.peopleRef} />

        <OnDemand connection={connection} />
        {/* Renders nothing at all until a headset session exists — see Immersive.tsx. */}
        {/* The breathing orb, in rooms that have been given one: see shared/meditation.ts. */}
        {connection.meditation?.shown && <MeditationOrb meditation={connection.meditation} onMeditation={connection.setMeditation} reducedMotion={reducedMotion} />}
        <RoomItems items={connection.roomItems} reducedMotion={reducedMotion} you={you} peopleRef={connection.peopleRef} onItem={connection.applyRoomItem} onRemoved={connection.removeRoomItem} />
        <Immersive
          comfort={comfort}
          send={connection.send}
          onChange={onImmersiveChange}
          onReturnToLobby={onReturnToLobby}
          onSwitchRoom={onSwitchRoom}
          currentRoom={spaceRoomName}
          openPanels={openPanels}
          you={you}
          groupRoom={feed.room}
          voice={voice}
          liveUtterance={connection.liveUtterance}
          feed={feed}
          panels={panels}
          arrange={arrange}
          showing={connection.showing}
          showingChoices={showingChoices}
          agents={connection.roster.filter((person) => person.kind === "agent").map((person) => person.actorId)}
          roomItems={connection.roomItems}
          meditation={connection.meditation}
          onMeditation={connection.setMeditation}
          peopleRef={connection.peopleRef}
        />
      </XR>
    </Canvas>
  );
}
