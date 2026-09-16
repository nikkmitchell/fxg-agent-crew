import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  TeleportTarget,
  XROrigin,
  useXR,
  useXRControllerLocomotion,
  useXRInputSourceState,
} from "@react-three/xr";
import * as THREE from "three";
import { ROOM, WORLD, facingFor, type Vec3 } from "../../shared/space-layout";
import { clampToRoom, type Comfort } from "./comfort";
import { heldHand, NO_HAND, type Held } from "./hand-hold";
import { StandingHeight, gripToWristConvention } from "./tracked-body";
import {
  IDLE,
  believableStep,
  stepJoystick,
  turnAbout,
  turnRate,
  walkVelocity,
  type JoystickState,
  type Quat,
  type Vec,
} from "./palm-joystick";
import { compensateReset, type Placed } from "./recenter";
import { stickStep } from "./stick-walk";
import { teleportIsTheOnlyWayToMove } from "./teleport-needed";
import { leaveCrumb } from "./left-crumb";
import { pinchTeleportEnabled, teleportNeeded, teleportOn, watchTeleport } from "./xr-store";
import { holdSession } from "../update-reload";
import { VoidSphere } from "./Backdrop";
import { RoomControls } from "./RoomControls";
import type { RoomFeed } from "./useRoomFeed";
import type { PanelChoices } from "./usePanelChoices";
import type { PanelArrange } from "./usePanelArrange";
import type { Showing } from "../../shared/space-wire";
import type { RoomShowingChoices } from "./useRoomShowing";
import type { VoiceChat } from "./useVoiceChat";
import type { Utterance } from "../../shared/voice";
import type { ClientMessage, Pose, WirePerson } from "../../shared/space-wire";
import { TOUCH_COOLDOWN_MS, agentTouchPoints, touchedPart } from "../../shared/touch";

/**
 * Standing in the room, rather than looking at it.
 *
 * MOST OF THIS I STILL CANNOT VERIFY. Everything else in the space was checked
 * in a browser and screenshotted; a headset session cannot be. What has changed
 * since the first version is that three of its guesses have now been tested by
 * Nikk on an XREAL Aura and a Quest, and were wrong in ways worth recording:
 *
 *   1. Not every headset has a thumbstick. The Aura has none, so smooth
 *      locomotion left Nikk unable to move at all. Teleport, below, is the
 *      answer, and it needs nothing but a pinch or a trigger.
 *   2. Hands fell to the floor whenever tracking dropped. See `hand-hold.ts`
 *      and `poseOfSpace` below — the old code read a three.js object that is
 *      not where the hand is.
 *   3. `enterVR` gets you an opaque session. Passthrough needs `immersive-ar`,
 *      which is why `enterRoom` in `xr-store.ts` asks for that first.
 *
 * The maths underneath is still the tested part: comfort settings, the wall
 * clamp and the speed all come from `shared/space-layout.ts`, and the hand
 * holding rule is unit-tested in `hand-hold.test.ts`.
 */

/**
 * WHERE YOU WERE STANDING, KEPT ACROSS A SESSION.
 *
 * Nikk, four times in an afternoon: "I did not walk over here... it's like some
 * kind of reset of position and rotation." Position AND rotation, instantly,
 * back to one particular spot — which is precisely what a NEW SESSION looks
 * like, because XROrigin started every session at the spawn point facing the
 * middle of the arc. A Quest ends and re-grants a session on its own: the
 * headset taken off and put back on, a tracking loss it cannot recover in
 * place, the browser reclaiming the session after a system dialog. None of
 * those is a re-centre, so the reset listener never fired and the log stayed
 * silent — which is exactly what we observed.
 *
 * So the place outlives the session. Kept in sessionStorage, so it also
 * survives the page reload people now take to pick up a new build: you come
 * back where you were rather than at the door.
 *
 * NOT localStorage, deliberately. Where you stood is true of this visit, not of
 * next week.
 */
const PLACE_KEY = "saha.xr-place";

/** Written into on every teleport, so a teleport allocates nothing. */
const scratchHead = new THREE.Vector3();
/** The same, for the heading a thumbstick walks along. Every frame; no garbage. */
const scratchTurn = new THREE.Quaternion();
const scratchAhead = new THREE.Vector3();

function rememberPlace(place: { x: number; z: number; yaw: number }): void {
  try {
    window.sessionStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // A private window simply starts at the spawn point each time.
  }
}

function lastPlace(): { x: number; z: number; yaw: number } | null {
  try {
    const raw = window.sessionStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    const place = JSON.parse(raw) as { x?: unknown; z?: unknown; yaw?: unknown };
    for (const value of [place.x, place.z, place.yaw]) {
      if (typeof value !== "number" || !isFinite(value)) return null;
    }
    return { x: place.x as number, z: place.z as number, yaw: place.yaw as number };
  } catch {
    return null;
  }
}

/**
 * The player's feet, driven by whatever input the device actually has.
 *
 * `useXRControllerLocomotion` moves the group it is given. The wall clamp is
 * applied AFTER it, every frame, rather than by refusing the input: a clamp on
 * the input would let the player push into a wall and stop dead, which in a
 * headset feels like the tracking has broken.
 */
export function ImmersivePlayer({
  comfort,
  send,
  passthrough,
  passthroughAvailable,
  blendMode,
  onTogglePassthrough,
  openPanels,
  you,
  groupRoom,
  voice,
  liveUtterance,
  feed,
  panels,
  arrange,
  showing,
  showingChoices,
  agents,
  peopleRef,
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
  passthrough: boolean;
  passthroughAvailable: boolean;
  /** What the session says it can do, shown on the button when it cannot. */
  blendMode: string | null;
  onTogglePassthrough: () => void;
  openPanels: string[];
  /** Who the room says you are, for the line the group chat sees. */
  you: string | null;
  /** The WebHarness room to post into when you choose to tell the agents. */
  groupRoom: string | null;
  /** Live voice, owned above the session so entering one cannot close it. */
  voice: VoiceChat;
  /** The newest thing said in the room, for reading replies aloud. */
  liveUtterance: Utterance | null;
  /** The WebHarness chat, read once in the scene and passed down. */
  feed: RoomFeed;
  /** Which panels are on the arc, so the headset can change it too. */
  panels: PanelChoices;
  /** Moving and resizing, which are settings rather than a separate control. */
  arrange: PanelArrange;
  /** What the room is showing, shared by everybody standing in it. */
  showing: Showing;
  showingChoices: RoomShowingChoices;
  /** Agents in the room, for placing them from the menu. */
  agents: string[];
  /** Everyone in the room, live, for noticing when a hand touches an agent. */
  peopleRef: RefObject<WirePerson[]>;
}) {
  const origin = useRef<THREE.Group>(null);
  const lastSent = useRef(0);
  const held = useRef<{ left: Held; right: Held }>({ left: NO_HAND, right: NO_HAND });
  /** When this person last touched each agent, so a resting hand is one touch. */
  const lastTouch = useRef(new Map<string, number>());
  /** The palm joystick, one per hand — see palm-joystick.ts. */
  const joystick = useRef<{ left: JoystickState; right: JoystickState }>({ left: IDLE, right: IDLE });
  const balls = {
    left: useRef<THREE.Mesh>(null),
    leftShadow: useRef<THREE.Mesh>(null),
    right: useRef<THREE.Mesh>(null),
    rightShadow: useRef<THREE.Mesh>(null),
  };
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }),
    [],
  );

  /**
   * Hands and controllers, whichever the device is giving us.
   *
   * A Quest with controllers reports controller spaces; hand tracking reports
   * joint spaces; Android XR can switch between them mid-session as somebody
   * puts a controller down. Both are read and the hand wins, so switching does
   * not need a reconnect.
   */
  const leftController = useXRInputSourceState("controller", "left");
  const rightController = useXRInputSourceState("controller", "right");
  const leftHand = useXRInputSourceState("hand", "left");
  const rightHand = useXRInputSourceState("hand", "right");

  /**
   * The space every WebXR pose is reported in. It is the XROrigin's space, so
   * a pose read against it is the player's own frame of reference and has to be
   * put through the origin's world matrix to become a room coordinate.
   */
  const originSpace = useXR((state) => state.originReferenceSpace);
  /**
   * THE HEADSET'S OWN CAMERA, not the flat view's.
   *
   * `gl.xr.getCamera()` is the camera three.js drives from the viewer pose, and
   * @react-three/xr parents it to the XROrigin. R3F's `state.camera` is a
   * different object that the flat controls own, and reading it inside a
   * session is how the teleport arithmetic came to subtract a number that had
   * nothing to do with anybody's head. See `teleport`.
   */
  const xrCamera = useThree((state) => state.gl.xr.getCamera());
  /**
   * Where this session begins: where the last one ended, or the door.
   *
   * Read once, so nothing moves the player mid-session.
   */
  const [began] = useState(() => {
    const remembered = lastPlace();
    return remembered
      ? { ...remembered, resumed: true }
      : { x: ROOM.spawn.x, z: ROOM.spawn.z, yaw: facingFor(openPanels), resumed: false };
  });
  /**
   * Where the player's body is, for the controls to hang in front of.
   *
   * The head's horizontal position and yaw — not its height and not its pitch.
   * Looking down at your feet must not tip the menu away from you, and
   * crouching must not drag it to the floor.
   */
  const bodyRef = useRef<{ at: Vec3; yaw: number } | null>(null);
  const bodyAnchor = useCallback(() => bodyRef.current, []);

  /**
   * Where the head was standing in the room last frame, and a reset waiting to
   * be undone. See recenter.ts.
   */
  const headRoom = useRef<Placed | null>(null);
  const recentre = useRef<Placed | null>(null);
  /**
   * Say something only the headset can see into the server's log. See the
   * `note` frame.
   *
   * STABLE FOR THE LIFE OF THE SESSION, and that is the whole point of the ref.
   * `send` is rebuilt whenever the socket reconnects, so a `tell` that depended
   * on it changed identity too — and every effect that reports something ONCE
   * and lists `tell` in its dependencies ran again each time. It filled the
   * journal with "session began" a dozen times a minute in one place, and
   * "press to speak: the server can write speech down" a dozen times in
   * another, which is two separate afternoon's worth of the same mistake.
   *
   * A ref for the changing part and a callback with no dependencies: the
   * sentence "report this once" now means what it says, and nobody else has to
   * remember to guard it.
   */
  const sender = useRef(send);
  sender.current = send;
  const tell = useCallback((note: string) => sender.current({ type: "note", note }), []);
  /**
   * HOW TALL I AM, measured here and told to the room.
   *
   * Nikk, sitting in a chair: "on joining the room it should take your current
   * height position and set that as how tall you are... so if you're sitting or
   * standing it will be set naturally", and "add in a setting where you can
   * reset head position at any time". Every viewer used to guess this from the
   * head heights it happened to see; this device was there when the person
   * arrived, so it is the one that knows. See StandingHeight.
   */
  const standing = useRef(new StandingHeight());
  const resetStanding = useCallback(() => {
    standing.current.reset();
    tell("head position reset; measuring from where the head is now");
  }, [tell]);
  /**
   * SAID ONCE PER SESSION. It fired on every render in the first version,
   * because `tell` is rebuilt whenever the socket's `send` is, and the log
   * filled with a dozen "session began" lines a minute. A ref, so the sentence
   * means what it says.
   */
  /** Whether a plausible head has been seen at all this session. See rememberPlace. */
  const headSeen = useRef(false);
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    tell(
      `session began at (${began.x.toFixed(2)}, ${began.z.toFixed(2)}) facing ${began.yaw.toFixed(2)}` +
        // Which of the two it was answers a question the numbers alone cannot:
        // an empty sessionStorage means a NEW TAB, because a reload keeps it.
        `, ${began.resumed ? "resumed from where the last session ended" : "the spawn point — nothing was remembered"}`,
    );
  }, [tell, began]);

  /**
   * WHEN THE ROOM GOES AWAY AND WHY, written down.
   *
   * Nikk, watching Baiwei vanish every time he tapped a text box: "you can set
   * up some logs so I can see that he currently gets kicked whenever he tests
   * the text". There was nothing in the journal between "session began" and
   * silence — the room disappearing left no trace at all, which is why it took
   * somebody sitting in a headset to notice.
   *
   * Three lines now. The document hiding is the one that mattered: Quest
   * Browser hides it to show the system keyboard, and the reload poller used to
   * treat a hidden page as an empty one.
   */
  useEffect(() => {
    const onHidden = () => {
      tell(
        `the page went ${document.visibilityState} while the session was live` +
          (document.visibilityState === "hidden" ? " — no reload will be taken until it ends" : ""),
      );
    };
    /**
     * AND THE ONE THAT SURVIVES THE PAGE ITSELF.
     *
     * A note travels down the room's socket, so a note about the page going
     * away races the page going away and loses. Worse, React runs no cleanup
     * for a reload at all — so a session that ended because the page reloaded
     * looks identical, in the journal, to no session ending at all.
     *
     * So the fact is written to sessionStorage, which outlives a reload, and
     * the next page that loads reports it. `pagehide` rather than
     * `beforeunload`: it fires for a reload, a navigation and a tab being
     * discarded, and it does not stop a headset going to sleep.
     */
    const onLeaving = () => {
      leaveCrumb();
      tell("the page is going away while the session is live");
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeaving);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeaving);
      tell("session ended");
    };
  }, []);


  /**
   * A CONTROLLER WITH NO THUMBSTICK NEEDS TELEPORT, whatever the setting says:
   * on the XREAL Aura it is the only way to move. Everything else gets teleport
   * only when somebody turns it on — Nikk was thrown 7.8 metres across the room
   * by a resting left controller's trigger while using hand movement. See
   * teleportNeeded in xr-store.ts.
   */
  /**
   * HANDS ARE LATCHED, because tracking blinks. A hand that leaves the cameras'
   * view for a frame must not hand teleport back to somebody who turned it off
   * — that is this same bug in miniature.
   */
  const handsSeen = useRef(false);
  if (leftHand || rightHand) handsSeen.current = true;
  const stickless = teleportIsTheOnlyWayToMove({
    controllers: [leftController, rightController],
    handsSeen: handsSeen.current,
  });
  useEffect(() => {
    teleportNeeded(stickless);
    return () => teleportNeeded(false);
  }, [stickless]);

  /**
   * AND THE FLOOR ITSELF GOES AWAY when teleport is off.
   *
   * `teleportPointer: false` was supposed to be enough. It was not: Nikk was
   * teleported three more times on the build that turned it off, and the log
   * said the setting was off while it happened. `TeleportTarget` adds a
   * `pointerup` listener to its group the moment it mounts and moves the player
   * for whatever delivers one, so as long as it is in the tree something can
   * still fire it. Not mounting it is the only version of "off" that cannot be
   * argued with.
   */
  const [teleportAllowed, setTeleportAllowed] = useState(teleportOn);
  useEffect(() => watchTeleport(setTeleportAllowed), []);

  useEffect(() => {
    if (!originSpace) return;
    const onReset = () => {
      // The head's last known place in the room, to put the person back on.
      recentre.current = headRoom.current;
    };
    originSpace.addEventListener("reset", onReset);
    return () => originSpace.removeEventListener("reset", onReset);
  }, [originSpace]);

  /**
   * TURNING ONLY, FROM THE LIBRARY. Walking is ours — see stick-walk.ts for the
   * two faults that made this necessary, both of which move somebody who did
   * not ask to be moved: no dead zone on translation, so a stick resting at
   * 0.02 walks you across the room; and a module-level movement vector applied
   * on any frame with translation OR rotation, so a smooth turn with a centred
   * move stick slides you along whatever heading you last walked.
   *
   * Passing `false` does more than skip the feature: the helper is written only
   * inside the translation branch, so with translation off it is never written
   * and the stale-vector path can never fire.
   */
  useXRControllerLocomotion(
    origin,
    false,
    comfort.turn === "snap"
      ? { type: "snap", degrees: comfort.snapDegrees, deadZone: 0.5 }
      : { type: "smooth", speed: 2, deadZone: 0.3 },
    // The LEFT stick moves and the right turns, which is the convention on both
    // Quest and Android XR. On a device with no sticks this simply does
    // nothing, which is why teleport exists rather than replacing it.
    "left",
  );

  /**
   * Read a tracked three.js object in ROOM space.
   *
   * Used for the HEAD only. three.js drives the XR camera from the headset's
   * own pose every frame, so its world position is a measurement. The same is
   * NOT true of the objects hanging off an input source — see below.
   */
  const inRoomSpace = (object: THREE.Object3D | null | undefined): Pose | null => {
    if (!object) return null;
    object.getWorldPosition(scratch.position);
    object.getWorldQuaternion(scratch.quaternion);
    return poseOf(scratch.position, scratch.quaternion);
  };

  /**
   * Read an XR SPACE in room space, asking the frame directly.
   *
   * THIS IS THE HANDS FIX, and it is worth writing down why the obvious thing
   * was wrong. `useXRInputSourceState(...).object` is the rendered model, and
   * for a tracked HAND that model's root never moves at all — the library poses
   * the twenty-five finger joints inside it and leaves the root at the origin
   * of the player's space. So `getWorldPosition` on it returned the player's
   * own feet, and both of Nikk's hands sat on the floor whenever hand tracking
   * was in use. For a CONTROLLER the model does sit under a tracked space, but
   * the same floor position is reported for every frame before the device has
   * located it.
   *
   * Asking the frame for the pose of the wrist joint (or the controller's grip
   * space) has neither problem, and gives us the thing the old code was missing
   * entirely: `getPose` returns null when the space could not be located, which
   * is precisely "this hand is not being tracked right now" stated by the
   * device rather than guessed by us.
   */
  const poseOfSpace = (
    space: XRSpace | undefined | null,
    frame: XRFrame | undefined,
    group: THREE.Group,
  ): Pose | null => {
    if (!space || !frame || !originSpace) return null;
    const located = frame.getPose(space, originSpace);
    if (!located) return null;
    scratch.matrix.fromArray(located.transform.matrix).premultiply(group.matrixWorld);
    scratch.matrix.decompose(scratch.position, scratch.quaternion, scratch.scale);
    return poseOf(scratch.position, scratch.quaternion);
  };

  /**
   * Teleport, which is the only way to move on a headset with no thumbstick.
   *
   * The point arrives already corrected for where the player's head is standing
   * within their own tracked area, so it is the position the ORIGIN should take
   * for the head to land where the arc pointed. It still goes through the same
   * wall clamp as the sticks: one rule about where a person may stand, not two.
   */
  const teleport = useCallback((point: THREE.Vector3, event?: { point?: THREE.Vector3 }) => {
    const group = origin.current;
    if (!group) return;
    const from = { x: group.position.x, z: group.position.z };
    /**
     * WHERE THE ARC ACTUALLY POINTED, worked out here rather than taken on
     * trust. This is the whole of the "teleport sends me to the same wrong
     * place every time" bug, and it was never about which button fired.
     *
     * The library hands us `hit − camera.matrix position`, meaning to give the
     * origin a place to stand such that the HEAD lands on the point. The camera
     * it reads is R3F's default camera — the one the flat view owns. Inside a
     * session that camera is not the headset and is not parented to the origin,
     * so the number subtracted is not a head offset at all. When the arc lands
     * near the player's own feet, which is what a controller pointing at the
     * floor does, `hit` and that camera's position very nearly cancel and the
     * answer is ≈ (0, 0) — THE ROOM'S ORIGIN. Nikk was thrown to the same spot
     * six times, and (0.09, −0.11), (0.07, −0.12), (0.01, 0.01), (0.05, −0.04)
     * in the log are not four teleports to a place he pointed at. They are four
     * subtractions landing on zero.
     *
     * So: take the raw hit from the event, and subtract the head's offset from
     * the origin measured in the SAME frame — the headset camera's world
     * position, which @react-three/xr parents to the origin, less the origin's
     * own. No rotation to get wrong, and nothing borrowed from the flat view.
     */
    const hit = event?.point;
    const head = xrCamera.getWorldPosition(scratchHead);
    const target = hit
      ? { x: hit.x - (head.x - group.position.x), z: hit.z - (head.z - group.position.z) }
      : { x: point.x, z: point.z };
    const inside = clampToRoom(target);
    group.position.set(inside.x, 0, inside.z);
    /**
     * EVERY TELEPORT IS WRITTEN DOWN, with how far it moved you, what was in
     * your hands, and WHETHER TELEPORT WAS ON AT ALL.
     *
     * The last of those is the line I wish the first version had printed. It
     * logged `pinchTeleportEnabled()`, the SETTING, and the log therefore said
     * "pinch teleport off" through three teleports that the setting had nothing
     * to do with — an instrument that reported the switch instead of the state.
     */
    tell(
      `teleported ${Math.hypot(inside.x - from.x, inside.z - from.z).toFixed(2)} m` +
        ` to (${inside.x.toFixed(2)}, ${inside.z.toFixed(2)})` +
        (hit ? ` from arc (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})` : " with no arc point") +
        `; hands ${leftHand ? "L" : "-"}${rightHand ? "R" : "-"},` +
        ` controllers ${leftController ? "L" : "-"}${rightController ? "R" : "-"},` +
        ` setting ${pinchTeleportEnabled() ? "on" : "off"},` +
        ` teleport ${teleportOn() ? "on" : "off"}`,
    );
  }, [tell, xrCamera, leftHand, rightHand, leftController, rightController]);

  /**
   * A joint's pose in the PLAYER'S frame — the origin's reference space, not
   * the room. The palm joystick works in this frame on purpose: see the note at
   * the top of palm-joystick.ts about the runaway it avoids.
   */
  const localPose = (space: XRSpace | undefined | null, frame: XRFrame | undefined): { p: Vec; q: Quat } | null => {
    if (!space || !frame || !originSpace) return null;
    const located = frame.getPose(space, originSpace);
    if (!located) return null;
    const { position: p, orientation: o } = located.transform;
    return { p: { x: p.x, y: p.y, z: p.z }, q: { x: o.x, y: o.y, z: o.z, w: o.w } };
  };

  /**
   * THE PALM JOYSTICK. Every frame, not at the send rate: movement at ten
   * updates a second would judder.
   *
   * Hands only. A controller has a thumbstick for this already, and a
   * controller's grip held palm-up would otherwise start walking somebody who
   * is only looking at their watch.
   */
  const palmJoystick = (group: THREE.Group, frame: XRFrame | undefined, delta: number) => {
    const nowMs = performance.now();
    const palmOf = (hand: typeof leftHand) =>
      localPose(hand?.inputSource.hand.get("middle-finger-metacarpal") ?? hand?.inputSource.hand.get("wrist"), frame);

    const left = stepJoystick(joystick.current.left, palmOf(leftHand), nowMs);
    const right = stepJoystick(joystick.current.right, palmOf(rightHand), nowMs);
    joystick.current.left = left.state;
    joystick.current.right = right.state;

    const yaw = group.rotation.y;
    // LEFT WALKS. The velocity is in the player's frame; turn it by the
    // origin's yaw to move the origin through the room.
    if (left.state.phase === "active" && left.ball) {
      const v = walkVelocity(left.state.anchor, left.ball);
      group.position.x += (v.x * Math.cos(yaw) + v.z * Math.sin(yaw)) * delta;
      group.position.z += (-v.x * Math.sin(yaw) + v.z * Math.cos(yaw)) * delta;
    }

    // RIGHT TURNS, about the head so the person stays on the spot.
    if (right.state.phase === "active" && right.ball && frame && originSpace) {
      const viewer = frame.getViewerPose(originSpace);
      if (viewer) {
        const o = viewer.transform.orientation;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
        const headYaw = Math.atan2(-forward.x, -forward.z);
        const rate = turnRate(right.state.anchor, right.ball, headYaw);
        if (rate !== 0) {
          const hp = viewer.transform.position;
          group.updateWorldMatrix(true, false);
          const head = new THREE.Vector3(hp.x, hp.y, hp.z).applyMatrix4(group.matrixWorld);
          const turned = turnAbout({ x: group.position.x, z: group.position.z, yaw }, { x: head.x, z: head.z }, rate * delta);
          group.position.x = turned.x;
          group.position.z = turned.z;
          group.rotation.y = turned.yaw;
        }
      }
    }

    // The balls are children of the origin, so their positions are in the
    // player's frame already.
    const show = (mesh: THREE.Mesh | null, where: Vec | null) => {
      if (!mesh) return;
      mesh.visible = where !== null;
      if (where) mesh.position.set(where.x, where.y, where.z);
    };
    show(balls.left.current, left.ball);
    show(balls.leftShadow.current, left.state.phase === "active" ? left.state.anchor : null);
    show(balls.right.current, right.ball);
    show(balls.rightShadow.current, right.state.phase === "active" ? right.state.anchor : null);
  };

  useFrame(({ clock, camera }, delta, frame) => {
    const group = origin.current;
    if (!group) return;

    /**
     * WALKING AND TURNING, WITH A LIMIT ON HOW FAR ONE FRAME MAY MOVE YOU.
     * See believableStep: a mislocated hand or head is the likeliest cause of
     * Nikk being "teleported off to the side", and no person walks half a
     * metre in a frame.
     */
    const stood = { x: group.position.x, z: group.position.z, yaw: group.rotation.y };
    palmJoystick(group, frame, Math.min(delta, 0.1));
    /**
     * THE THUMBSTICK, walked by us rather than by the library. The dead zone is
     * the whole point: a controller lying on a desk is the normal state of a
     * controller, and the library moved you for any reading at all. See
     * stick-walk.ts.
     */
    const stick = leftController?.gamepad?.["xr-standard-thumbstick"];
    if (stick) {
      // The heading is read from the HEADSET's camera, which @react-three/xr
      // parents to the origin, so its world yaw is already a room heading. The
      // flat view's camera is a different object and not in this graph at all.
      xrCamera.getWorldQuaternion(scratchTurn);
      const look = scratchAhead.set(0, 0, -1).applyQuaternion(scratchTurn);
      const step = stickStep(
        { x: stick.xAxis ?? 0, y: stick.yAxis ?? 0 },
        Math.atan2(-look.x, -look.z),
        comfort.speed,
        Math.min(delta, 0.1),
      );
      group.position.x += step.x;
      group.position.z += step.z;
    }
    if (!believableStep(stood, group.position)) {
      group.position.x = stood.x;
      group.position.z = stood.z;
      group.rotation.y = stood.yaw;
      tell("locomotion refused: a frame tried to move me far further than a step");
    }

    /**
     * A HEADSET THAT RE-CENTRES MUST NOT MOVE YOU IN THE ROOM. See recenter.ts:
     * the device moves the space every pose is measured in, and unless the
     * player's frame moves with it the person is left standing somewhere else.
     * Nikk: "I just automatically teleport on my own without me doing
     * anything... over into this area where I am right now."
     */
    camera.getWorldPosition(scratch.position);
    camera.getWorldQuaternion(scratch.quaternion);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(scratch.quaternion);
    const headNow = {
      x: scratch.position.x,
      z: scratch.position.z,
      yaw: Math.atan2(-facing.x, -facing.z),
    };
    const wasAt = recentre.current;
    if (wasAt) {
      recentre.current = null;
      tell("the headset re-centred; putting you back where you were standing");
      const put = compensateReset(
        { x: group.position.x, z: group.position.z, yaw: group.rotation.y },
        wasAt,
        headNow,
      );
      group.position.x = put.x;
      group.position.z = put.z;
      group.rotation.y = put.yaw;
      group.updateWorldMatrix(true, false);
      headRoom.current = wasAt;
    } else {
      headRoom.current = headNow;
    }

    const inside = clampToRoom({ x: group.position.x, z: group.position.z });
    group.position.x = inside.x;
    group.position.z = inside.z;
    /**
     * The only thing that survives a session the device ends and re-grants on
     * its own. See rememberPlace.
     *
     * NOT UNTIL A HEAD HAS BEEN SEEN. Plumbline's point, and it is a good one:
     * reading this back is defended and writing it was not, so a frame during a
     * session transition — head at the floor, nothing tracked yet — could write
     * a place that is evidence of nothing and hand it to the next session as
     * where somebody was standing. A head below 0.6 m is not a head; it is a
     * device that has not found one, the same test StandingHeight uses.
     *
     * ONCE SEEN, ALWAYS WRITTEN, and the first version got this wrong in a way
     * worth keeping a note about. It required a good head ON THAT FRAME, and
     * since it shipped, every one of Baiwei's sessions began at the spawn point
     * where they had previously resumed where he left off. I cannot yet prove
     * the guard is why — but a condition of mine that silently stops a feature
     * working on a device I cannot test is not something to leave standing while
     * we hunt something else. A latch instead: any plausible head this session
     * is enough, so a single bad frame cannot block it, and a device that never
     * reports a head still writes nothing.
     */
    if (scratch.position.y > 0.6) headSeen.current = true;
    if (headSeen.current) {
      rememberPlace({ x: inside.x, z: inside.z, yaw: group.rotation.y });
    }
    // The floor is the floor. XROrigin is the player's FEET, so this is 0 —
    // head height comes from the headset's own tracking, not from us.
    group.position.y = 0;

    // Tell the room where we are, at the same rate as the flat view.
    const now = clock.getElapsedTime() * 1000;
    if (now - lastSent.current < 100) return;
    lastSent.current = now;
    const at: Vec3 = { x: group.position.x, y: 0, z: group.position.z };

    // The clamp above moved the group, so the matrix cached from last frame is
    // stale. Every hand pose is expressed through it.
    group.updateWorldMatrix(true, false);

    // THE HEAD IS THE XR CAMERA. In a session three.js drives it from the
    // headset's own pose every frame, so this is a measurement rather than a
    // guess — the one part of an avatar a headset can state outright.
    const head = inRoomSpace(camera);

    // HANDS ARE WHATEVER IS ACTUALLY TRACKED — the wrist joint when the device
    // is tracking hands, the controller's grip when it is not. `left` and
    // `right` are the XR handedness, so they are the person's own left and
    // right and not the viewer's.
    //
    // A hand the device cannot locate is HELD where it last was rather than
    // reported as missing or, worse, as being on the floor. `hand-hold.ts` says
    // why, and how long a held hand stays believable.
    //
    // ONE ORIENTATION CONVENTION ON THE WIRE: the hand joint's, where -Z runs
    // toward the fingertips and -Y out of the palm. A controller's grip space
    // points its axes differently, so it is turned into that convention here,
    // once, and every body drawing this person can turn the wrist the same way
    // whichever the device was holding. See gripToWristConvention.
    const gripAsWrist = (grip: Pose | null, side: "left" | "right"): Pose | null => {
      if (!grip) return null;
      const q = gripToWristConvention(new THREE.Quaternion(grip.q.x, grip.q.y, grip.q.z, grip.q.w), side);
      return { p: grip.p, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
    };
    const liveLeft =
      poseOfSpace(leftHand?.inputSource.hand.get("wrist"), frame, group) ??
      gripAsWrist(poseOfSpace(leftController?.inputSource.gripSpace, frame, group), "left");
    const liveRight =
      poseOfSpace(rightHand?.inputSource.hand.get("wrist"), frame, group) ??
      gripAsWrist(poseOfSpace(rightController?.inputSource.gripSpace, frame, group), "right");
    held.current.left = heldHand(held.current.left, liveLeft, now, undefined, head);
    held.current.right = heldHand(held.current.right, liveRight, now, undefined, head);

    /**
     * TOUCHING AN AGENT. A live hand (not a remembered one) within reach of a
     * part of an agent's body sends a touch; the agent reacts as it chose. See
     * shared/touch.ts. A buzz on a controller, where there is one, so the
     * person feels it land. Rate-limited here and again on the server.
     */
    for (const [side, hand] of [["left", liveLeft], ["right", liveRight]] as const) {
      if (!hand) continue;
      for (const agent of peopleRef.current ?? []) {
        if (agent.kind !== "agent" || agent.actorId === you) continue;
        const part = touchedPart(
          hand.p,
          agentTouchPoints({ at: agent.at, facing: agent.facing, lying: agent.avatar.posture === "sleeping" && !agent.moving }),
        );
        if (!part) continue;
        const last = lastTouch.current.get(agent.actorId) ?? -Infinity;
        if (now - last < TOUCH_COOLDOWN_MS) continue;
        lastTouch.current.set(agent.actorId, now);
        send({ type: "touch", agentId: agent.actorId, part });
        const controller = side === "left" ? leftController : rightController;
        const actuator = (controller?.inputSource.gamepad as (Gamepad & { hapticActuators?: { pulse?: (v: number, ms: number) => unknown }[] }) | undefined)?.hapticActuators?.[0];
        void actuator?.pulse?.(0.35, 50);
      }
    }

    // Where the controls hang: the head's own position and heading, taken
    // from the measured head rather than from the XROrigin, so the panel is in
    // front of the PERSON and not in front of where they happened to arrive.
    if (head) {
      const q = new THREE.Quaternion(head.q.x, head.q.y, head.q.z, head.q.w);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      bodyRef.current = {
        at: head.p,
        // Heading only. `atan2` of the forward vector's x and z ignores pitch
        // and roll entirely, which is the point: look at the ceiling and the
        // menu stays where your body is.
        yaw: Math.atan2(-forward.x, -forward.z),
      };
    }

    const myHeight = head ? standing.current.update(head.p.y, Math.min(delta, 0.25)) : standing.current.current;
    send({
      type: "move",
      at,
      facing: group.rotation.y,
      ...(head ? { head } : {}),
      ...(myHeight !== null ? { standing: myHeight } : {}),
      hands: { left: held.current.left.pose, right: held.current.right.pose },
    });
  });

  return (
    <>
      {/* Turned toward whatever this person has open, for the same reason the
        window is: arriving in a headset looking at the gap where you closed a
        panel is worse than arriving in a window looking at it, because you
        cannot see the settings that would tell you why. Read once, on the first
        render of the session — the room must never turn you mid-session. */}
      {/* The controls used to hang off the origin here. They are on the wrist
        now, all of them behind one button — see WristVoice. */}
      <XROrigin
        ref={origin}
        position={[began.x, 0, began.z]}
        rotation={[0, began.yaw, 0]}
      >
        {/* The palm joystick's balls: the one you move, and its shadow where it
          first appeared. Children of the origin because they live in the
          player's frame. Hidden until a palm has faced up for a second. */}
        {(["left", "right"] as const).map((side) => (
          <group key={side}>
            <mesh ref={balls[side]} visible={false} raycast={() => null}>
              <sphereGeometry args={[0.022, 20, 14]} />
              <meshBasicMaterial color={side === "left" ? "#7cc4ff" : "#ffb86b"} transparent opacity={0.9} depthTest={false} />
            </mesh>
            <mesh ref={balls[side === "left" ? "leftShadow" : "rightShadow"]} visible={false} raycast={() => null}>
              <sphereGeometry args={[0.022, 20, 14]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.25} depthTest={false} wireframe />
            </mesh>
          </group>
        ))}
      </XROrigin>
      {passthrough ? null : <VoidSphere />}
      {/* The controls you need while standing in the room. In front of you at
        body level, not on a hand — see the note at the top of RoomControls. */}
      <RoomControls
        onResetStanding={resetStanding}
        onNote={tell}
        anchor={bodyAnchor}
        you={you}
        groupRoom={groupRoom}
        passthrough={passthrough}
        passthroughAvailable={passthroughAvailable}
        blendMode={blendMode}
        onTogglePassthrough={onTogglePassthrough}
        voice={voice}
        liveUtterance={liveUtterance}
        feed={feed}
        panels={panels}
        arrange={arrange}
        showing={showing}
        showingChoices={showingChoices}
        agents={agents}
        positionOf={(actorId) =>
          (peopleRef.current ?? []).find((person) => person.actorId.toLowerCase() === actorId.toLowerCase())?.at ?? null
        }
      />
      {/*
        The floor you can teleport onto. It is deliberately invisible: the room
        has no floor by design, and drawing one to make teleport work would put
        a surface back that was taken out on purpose. Raycasting does not care
        whether a material can be seen.

        It sits OUTSIDE the XROrigin, in room coordinates, because a teleport
        target that moved with the player would always be underfoot.
      */}
      {teleportAllowed ? (
        <TeleportTarget onTeleport={teleport}>
          {/*
            AS WIDE AS THE WALK, not as wide as the room. This plane is the
            only surface a teleport ray can hit, so leaving it room-sized would
            have kept the boundary for exactly the people who move BY
            teleporting — the ones who cannot simply walk past it with a stick.
            Taking the rail out of the walking code and leaving it here would
            have removed the wall for one kind of headset and kept it for
            another, which is worse than not removing it at all.
          */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[WORLD.half * 2, WORLD.half * 2]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </TeleportTarget>
      ) : null}
    </>
  );
}

/** Both halves of a pose, read out of three.js scratch objects. */
function poseOf(position: THREE.Vector3, quaternion: THREE.Quaternion): Pose {
  return {
    p: { x: position.x, y: position.y, z: position.z },
    q: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
  };
}

/**
 * Everything immersive, and ONLY while a session exists.
 *
 * `XROrigin` is the player's feet and `useXRControllerLocomotion` reads
 * controller sticks; outside a session there are no feet and no sticks, so
 * neither has anything to do. Gating them on the session keeps a second thing
 * from steering the camera the flat controls already own, and means the flat
 * view carries no XR machinery at all.
 *
 * Reporting the session out is the other half: the page can say "you are in the
 * room" rather than leaving somebody wondering whether the button did anything,
 * and `Me` stands down while a headset is driving.
 */
export function Immersive({
  comfort,
  send,
  onChange,
  openPanels,
  you,
  groupRoom,
  voice,
  liveUtterance,
  feed,
  panels,
  arrange,
  showing,
  showingChoices,
  agents,
  peopleRef,
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
  onChange: (inSession: boolean) => void;
  openPanels: string[];
  you: string | null;
  groupRoom: string | null;
  voice: VoiceChat;
  /** The newest thing said in the room, for reading replies aloud. */
  liveUtterance: Utterance | null;
  feed: RoomFeed;
  panels: PanelChoices;
  arrange: PanelArrange;
  showing: Showing;
  showingChoices: RoomShowingChoices;
  agents: string[];
  peopleRef: RefObject<WirePerson[]>;
}) {
  const session = useXR((state) => state.session);
  /**
   * WHETHER PASSTHROUGH IS POSSIBLE IS THE SESSION'S ANSWER, NOT OURS.
   *
   * This used to be `mode === "immersive-ar"`, which is a guess about what an
   * AR session implies. `environmentBlendMode` is the thing that actually
   * decides: "opaque" means the compositor shows nothing behind what we draw,
   * whatever the session was called, and "additive" or "alpha-blend" mean it
   * does. Reading it means a device that gives us an AR session that cannot
   * blend gets told so, rather than being handed a switch that does nothing.
   *
   * Passthrough is on by default where it exists, because the alternative is
   * standing in a black void in your own living room, and that is the thing
   * worth asking for rather than the other way round.
   */
  const blend = session?.environmentBlendMode ?? null;
  const available = blend !== null && blend !== "opaque";
  const [passthrough, setPassthrough] = useState(true);
  const togglePassthrough = useCallback(() => setPassthrough((on) => !on), []);
  useEffect(() => {
    onChange(Boolean(session));
  }, [session, onChange]);
  /**
   * NO RELOAD WHILE SOMEBODY IS IN A HEADSET.
   *
   * A deploy reloads every open page so nobody is left on yesterday's build —
   * but a reload ends an immersive session, which drops the wearer out of the
   * room and back into a browser window they then have to find and press twice.
   * It waits until the session ends. Several deploys land in an hour here, so
   * this was a real chance of interrupting somebody mid-sentence.
   *
   * `holdSession`, NOT `holdReload`, and that distinction cost Baiwei an
   * afternoon: an ordinary hold is overridden by a hidden page, and Quest
   * Browser hides the document when it opens the system keyboard. Every tap on
   * a text box therefore reloaded the page and threw him out of the room. See
   * the note at the top of update-reload.ts.
   */
  useEffect(() => {
    holdSession("xr-session", Boolean(session));
    return () => holdSession("xr-session", false);
  }, [session]);
  return session ? (
    <ImmersivePlayer
      comfort={comfort}
      send={send}
      passthrough={available && passthrough}
      passthroughAvailable={available}
      blendMode={blend}
      onTogglePassthrough={togglePassthrough}
      openPanels={openPanels}
      you={you}
      groupRoom={groupRoom}
      voice={voice}
      liveUtterance={liveUtterance}
      feed={feed}
      panels={panels}
      arrange={arrange}
      showing={showing}
      showingChoices={showingChoices}
      agents={agents}
      peopleRef={peopleRef}
    />
  ) : null;
}
