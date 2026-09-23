import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { PANEL_Y, facingPoint, placementRefusal, scaleOf } from "../../shared/panel-place";
import { PANEL } from "../../shared/space-layout";
import { resizedScale } from "./panel-resize";
import { PANEL_HALF_LIFE, follow, followVec3 } from "../../shared/smooth-follow";
import { beginGrab, clamp, grabbedTo, pushPull, type Grab, type Ray, type Vec3 } from "../../shared/grab-move";
import type { ArrangeMode } from "./usePanelArrange";
import type { Placement } from "../../shared/space-wire";
import { claimPointer } from "./pointer-claim";
import { grabHold } from "./grab-hold";
import { space } from "../space-client";
import { CARD_INK } from "../../shared/card-paint";

/**
 * A panel you can pick up and put somewhere else.
 *
 * ONE HANDLE, BOTH WORLDS — it used to be two, and the reason it was two is
 * gone. While the panels were DOM behind drei's `occlude="blending"`, the WebGL
 * canvas carried `pointer-events: none` so those iframes stayed clickable,
 * which meant NO 3D object could receive a pointer in a window at all. I wrote
 * a 3D drag bar first, watched it do nothing, and found the canvas dead to the
 * mouse; the window got a DOM bar and the headset got the 3D one.
 *
 * The panels are meshes now and the occluder went with the iframes, so the
 * canvas takes a mouse again and the 3D bar works for both. A pointer is a
 * pointer: R3F gives a mouse press and a controller ray the same event, and
 * both carry `event.ray` — a world-space ray, with no screen anywhere in it.
 * That is the whole input, for both worlds.
 *
 * HELD AT ARM'S LENGTH, THE WAY A HEADSET DOES IT. The panel keeps the distance
 * it was grabbed at and goes where you point — left, right, up, down. Pushing
 * it away and pulling it in is a separate input, because that is the one
 * direction a ray cannot express. All of that arithmetic lives in
 * `shared/grab-move.ts`, which says at length what the old version got wrong:
 * it cast at a level plane three centimetres above the eye, so one degree of
 * pointing was nearly a metre of travel and the panel flew to your feet. Nikk:
 * "the drags for movement are very strange, like when you start dragging a
 * board is pulled right to where you are."
 *
 * IT MOVES UP AND DOWN NOW. The note that used to be here said that dragging in
 * three dimensions from a two-dimensional pointer needed a mode switch, and
 * that every one I could think of was worse than not offering it. That was true
 * of a pointer read as a POSITION ON A PLANE and false of a pointer read as a
 * DIRECTION: a ray already points up and down, and it was only the plane that
 * threw that away.
 *
 * THE PANEL TURNS TO FACE THE ROOM as it moves, rather than keeping the angle
 * it had. A panel dragged round the arc while staying edge-on to everybody is a
 * panel nobody can read, and the correction is what you would do by hand every
 * single time.
 *
 * REFUSED LOCALLY, by the same rule the server applies — `shared/panel-place.ts`
 * is shared for exactly this. A drag let go somewhere impossible snaps back
 * where it came from and says why, rather than travelling to the server to be
 * undone a moment later.
 */

/** How far a notch of the wheel pushes a panel away from you. */
const WHEEL_REACH = 0.0022;

/**
 * How tall the drag bar along the top of a panel is.
 *
 * It was 0.14, and I missed it twice trying to verify the drag: from five
 * metres that is about 1.6 degrees — seven pixels in a window, and about as much
 * as a controller ray wobbles. Four metres wide and too thin to take hold of.
 * 0.28 is about 3.2 degrees at the same distance, and grab-face.test.ts holds a
 * floor under it.
 */
const BAR_HEIGHT = 0.28;

/** How long the panel says why it would not move. Long enough to read twice. */
const SAYS_FOR_MS = 4_000;

const noRaycast = () => undefined;

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const normalised = (ray: Ray): Vec3 => {
  const l = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z) || 1;
  return { x: ray.direction.x / l, y: ray.direction.y / l, z: ray.direction.z / l };
};

/** How far along a ray a world point sits. */
function alongRay(ray: Ray, at: Vec3): number {
  const d = normalised(ray);
  return (at.x - ray.origin.x) * d.x + (at.y - ray.origin.y) * d.y + (at.z - ray.origin.z) * d.z;
}

/** The point a given way along a ray. */
function reachAt(ray: Ray, along: number): Vec3 {
  const d = normalised(ray);
  return {
    x: ray.origin.x + d.x * along,
    y: ray.origin.y + d.y * along,
    z: ray.origin.z + d.z * along,
  };
}

export function Movable({
  place,
  mode,
  onPlaced,
  onTrouble,
  children,
}: {
  place: Placement;
  /**
   * Locked, being moved, or being resized — see usePanelArrange.
   *
   * While it is locked the panel is a page you read and click, and only the bar
   * along its top moves it. Unlocked, the whole face of it becomes the handle,
   * which is what makes it usable from across the room with a controller ray.
   */
  mode: ArrangeMode;
  /**
   * Called once, on release, with where it ended up. Never during the drag.
   *
   * May answer with the save: a promise of the server's refusal, or null. The
   * panel's hold is let go only once that has landed, and a refused save puts
   * the panel back where the room still has it.
   */
  onPlaced: (place: Placement) => void | Promise<string | null | void>;
  onTrouble: (why: string | null) => void;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * WHY IT WOULD NOT MOVE, SAID ON THE PANEL ITSELF.
   *
   * Every refusal used to reach only a line in the side column of the page —
   * 1,800 pixels down, found by looking for it — and a headset has no side
   * column at all. So a panel somebody else was holding would simply jump back
   * out of your hand with no reason given. The reason now appears just above
   * the bar you grabbed, where you are already looking, for a few seconds.
   */
  const [says, setSays] = useState<string | null>(null);
  useEffect(() => {
    if (!says) return;
    const quiet = setTimeout(() => setSays(null), SAYS_FOR_MS);
    return () => clearTimeout(quiet);
  }, [says]);
  const refuse = useCallback((why: string) => {
    setSays(why);
    onTrouble(why);
  }, [onTrouble]);
  const gesture = useRef<"move" | "resize">("move");

  /** How the panel is being held: how far along the ray, and where on it. */
  const held = useRef<Grab | null>(null);

  /**
   * Whether a grab is in progress, so it is let go of EXACTLY ONCE.
   *
   * A release arrives by two roads and both are needed. In a window the DOM
   * `pointerup` on the window is what reliably ends a drag that has left the
   * panel behind; in a headset there are no window pointer events at all, and
   * only R3F's own `onPointerUp` ever arrives. A mouse gets both, so the panel
   * was saved twice per drag — caught by watching the requests, which showed two
   * identical PUTs for every drag. Harmless while both carry the same target,
   * and one easing frame away from saving two different places.
   */
  const grabbing = useRef(false);

  /**
   * What a resize needs, which is not what a move needs.
   *
   * A move carries the panel; a resize leaves it exactly where it is and reads
   * HOW FAR FROM ITS MIDDLE you are pointing. So it remembers the distance
   * along the ray at which the panel was struck, and compares the reach point
   * at that same distance against the panel's centre. No plane is involved, so
   * none of the grazing trouble that made moving unusable.
   */
  const sizing = useRef({ along: 1, from: 1, scale: 1, centre: { x: 0, y: 0, z: 0 } as Vec3 });

  /**
   * Which pointer is doing the dragging.
   *
   * A headset has two, and without this the other hand brushing the panel
   * mid-drag would take it over. It also means a move event from a pointer that
   * never grabbed anything is ignored rather than treated as a drag.
   */
  const grabbedPointer = useRef<number | null>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const scratch = useMemo(() => ({ caster: new THREE.Raycaster(), ndc: new THREE.Vector2() }), []);

  const vec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });

  /**
   * The ray an R3F event was cast along — mouse or controller, the same field.
   *
   * This is what lets one piece of maths serve both rooms. A window builds this
   * ray from the camera and a cursor; a headset builds it from a controller's
   * pose. Neither fact reaches this file.
   */
  const rayOf = useCallback(
    (event: ThreeEvent<PointerEvent>): Ray => ({
      origin: vec(event.ray.origin),
      direction: vec(event.ray.direction),
    }),
    [],
  );

  /**
   * The same ray, rebuilt from a raw window pointer event.
   *
   * Needed because R3F only delivers events while the ray is over one of our
   * meshes, and a drag that has carried the panel out from under the pointer
   * must keep steering — see the window listener below.
   */
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

  /**
   * WHERE THE POINTER SAYS THE PANEL SHOULD BE — not where it is.
   *
   * The panel used to be set straight from the pointer, which is perfectly
   * responsive and passes on every tremor: a hand in a headset is never still,
   * and a controller ray four metres from a wall turns a millimetre of wobble
   * at the wrist into a centimetre at the panel. The pointer now moves a
   * target and the panel eases toward it, a frame at a time, at a rate that is
   * the same at 60fps and at 120 — see `smooth-follow.ts`.
   */
  /**
   * `toward` is where the person dragging is — the pointer ray's origin — and
   * the panel turns to face it. Absent for a resize, which does not move the
   * panel and so must not swing it either.
   */
  const target = useRef<{ position: Vec3; scale: number; toward?: { x: number; z: number } } | null>(null);

  /** The room's word on where this panel is, NOW — read after a save, which is later than any render. */
  const placeNow = useRef(place);
  placeNow.current = place;

  /** Put the panel back where the room has it, and forget where it was headed. */
  const putBack = useCallback(() => {
    const node = group.current;
    target.current = null;
    if (!node) return;
    const at = placeNow.current;
    node.position.set(at.position.x, at.position.y, at.position.z);
    node.rotation.y = at.rotationY;
    node.scale.setScalar(scaleOf(at));
    invalidate();
  }, [invalidate]);

  /**
   * NOBODY ELSE MAY MOVE IT WHILE YOU DO — see grab-hold.ts. The grab starts
   * at once and claims the panel in the background; if somebody else already
   * has it, the drag ends in your hand and the room says who.
   */
  const cancelled = useRef<(why: string) => void>(() => undefined);
  const hold = useMemo(
    () => grabHold({ thing: `panel:${place.id}`, api: space.hold, refused: (why) => cancelled.current(why) }),
    [place.id],
  );

  /** Take hold, along a ray, at the point on the panel the ray struck. */
  const begin = useCallback(
    (ray: Ray | null, struck: Vec3 | null, kind: "move" | "resize" = "move") => {
      const node = group.current;
      if (!ray || !node) return;
      grabbing.current = true;
      gesture.current = kind;
      hold.take();
      const centre = vec(node.position);

      if (kind === "resize") {
        // Along the ray to where it actually hit the panel, so the reach point
        // used from here on sits on the panel's own surface.
        const along = alongRay(ray, struck ?? centre);
        sizing.current = { along, from: distance(reachAt(ray, along), centre), scale: scaleOf(place), centre };
        held.current = null;
      } else {
        held.current = beginGrab(ray, centre);
      }
      setDragging(true);
    },
    [hold, place],
  );

  const drag = useCallback(
    (ray: Ray | null) => {
      const node = group.current;
      if (!node || !ray) return;

      if (gesture.current === "resize") {
        const { along, from, scale, centre } = sizing.current;
        target.current = {
          // The panel stays exactly where it is; only its size follows. Moving
          // and resizing at once would mean neither could be done deliberately.
          position: centre,
          scale: resizedScale(scale, from, distance(reachAt(ray, along), centre)),
        };
        invalidate();
        return;
      }

      const grab = held.current;
      if (!grab) return;
      const want = grabbedTo(ray, grab);
      target.current = {
        // FACE WHOEVER IS MOVING IT, not a centre the room does not have.
        toward: { x: ray.origin.x, z: ray.origin.z },
        /**
         * CLAMPED AT THE CEILING AND THE FLOOR rather than refused there.
         *
         * The room refuses an impossible placement on release and says why, and
         * that is right for somewhere across the room. Height is different: a
         * ray sweeps past the ceiling constantly, and a gesture that stops at
         * the limit is better than one that works all the way and is thrown
         * away at the end of it.
         */
        position: { x: want.x, y: clamp(want.y, PANEL_Y.min, PANEL_Y.max), z: want.z },
        scale: node.scale.x,
      };
      // A room set to redraw only when something happens still has to redraw
      // while a panel is being dragged through it.
      invalidate();
    },
    [invalidate],
  );

  /**
   * Push it away, pull it in.
   *
   * THE ONE AXIS A RAY CANNOT SAY ANYTHING ABOUT, so it gets an input of its
   * own rather than being guessed at from the other two. Guessing at it is
   * exactly what the old plane-cast did, and why a panel could never be put
   * further away than about three metres.
   */
  const reachBy = useCallback(
    (metres: number) => {
      const grab = held.current;
      if (!grab || gesture.current !== "move") return;
      held.current = pushPull(grab, metres);
      invalidate();
    },
    [invalidate],
  );

  /**
   * Ease toward the target, and STOP when it arrives.
   *
   * The stop is not a nicety: this room redraws on demand, so a follow that is
   * always a hair short would ask for another frame forever and keep a machine
   * awake for a panel nobody is touching.
   */
  useFrame((_, delta) => {
    const node = group.current;
    const want = target.current;
    if (!node || !want) return;
    const moved = followVec3(vec(node.position), want.position, delta, PANEL_HALF_LIFE);
    const sized = follow(node.scale.x, want.scale, delta, PANEL_HALF_LIFE, 0.0008);
    node.position.set(moved.value.x, moved.value.y, moved.value.z);
    if (want.toward) {
      const facing = facingPoint(moved.value.x, moved.value.z, want.toward);
      if (facing !== null) node.rotation.y = facing;
    }
    node.scale.setScalar(sized.value);
    if (moved.settled && sized.settled) {
      target.current = null;
      return;
    }
    invalidate();
  });

  const release = useCallback(() => {
    if (!grabbing.current) return;
    grabbing.current = false;
    const node = group.current;
    setDragging(false);
    held.current = null;
    if (!node) return;
    /**
     * SAVED FROM THE TARGET, NOT FROM WHERE THE EASE HAS GOT TO.
     *
     * The panel is still catching up when the pointer is let go, so reading its
     * current position would store somewhere slightly behind where it was put —
     * and a little further behind each time, so a panel dragged repeatedly
     * would drift backwards along its own path. The target is what the person
     * asked for; the ease is only how it gets there.
     */
    const want = target.current;
    const at = want ? want.position : vec(node.position);
    const scale = want ? want.scale : node.scale.x;
    const next: Placement = {
      id: place.id,
      position: { x: at.x, y: at.y, z: at.z },
      rotationY: (want?.toward ? facingPoint(at.x, at.z, want.toward) : null) ?? node.rotation.y,
      scale,
    };
    const refused = placementRefusal(next);
    if (refused) {
      hold.release();
      // Drop the target as well, or the ease carries on pulling the panel back
      // toward the place the server just refused.
      putBack();
      refuse(refused);
      return;
    }
    onTrouble(null);
    setSays(null);
    const saved = Promise.resolve(onPlaced(next));
    hold.release(saved);
    // REFUSED BY THE ROOM, not just by the rule above — somebody else was
    // holding it, say, and this drag was over before the claim came back. The
    // panel goes back to where everybody else can see it, not left where the
    // room said no.
    void saved.then((why) => {
      if (typeof why !== "string" || grabbing.current) return;
      putBack();
      setSays(why);
    });
  }, [hold, onPlaced, onTrouble, place.id, putBack, refuse]);

  /**
   * While dragging, the whole window listens — FROM THE MOMENT OF THE GRAB.
   *
   * Not the bar: a pointer moving faster than React re-renders leaves a small
   * DOM element behind within the first few pixels, and the panel would stop
   * following halfway through every drag.
   *
   * And not a `useEffect` gated on the dragging flag, which is the obvious
   * shape and has a hole in it: an effect does not run until React has
   * re-rendered, so a drag that starts and finishes inside that gap never
   * receives a single `pointermove`. The panel survived that because its whole
   * face also carries `onPointerMove`, which covers a drag that stays on the
   * panel; the Go table had no such second path and simply did not move. Same
   * bug, one of them visible. A flick of a controller is faster than a render,
   * so the window is listening before the press handler returns.
   */
  const stopListening = useRef<(() => void) | null>(null);

  const listenWhileDragging = useCallback(() => {
    stopListening.current?.();
    const move = (event: PointerEvent) => drag(rayFromScreen(event.clientX, event.clientY));
    const up = () => { stopListening.current?.(); release(); };
    const wheel = (event: WheelEvent) => {
      if (gesture.current !== "move") return;
      // Or the page scrolls underneath the room while somebody is placing a
      // panel, which moves the canvas out from under the drag.
      event.preventDefault();
      // Wheel up is negative, and wheel up should send it away from you.
      reachBy(-event.deltaY * WHEEL_REACH);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("wheel", wheel, { passive: false });
    stopListening.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
      stopListening.current = null;
    };
  }, [drag, rayFromScreen, reachBy, release]);

  // Never leave a listener behind on a panel that has gone away — nor a claim
  // on it being renewed every few seconds by a drag that no longer exists.
  useEffect(() => () => stopListening.current?.(), []);
  useEffect(() => () => hold.release(), [hold]);

  /**
   * SOMEBODY ELSE HAS IT. The drag ends where it is, exactly as a release would
   * end it, except that nothing is saved and the panel goes back.
   */
  cancelled.current = (why: string) => {
    if (!grabbing.current) return;
    grabbing.current = false;
    grabbedPointer.current = null;
    stopListening.current?.();
    held.current = null;
    setDragging(false);
    putBack();
    refuse(why);
  };

  // Follow the authoritative place whenever it changes and we are not the one
  // moving it — somebody else dragging a panel must move it here too.
  useEffect(() => {
    const node = group.current;
    if (!node || dragging) return;
    node.position.set(place.position.x, place.position.y, place.position.z);
    node.rotation.y = place.rotationY;
    node.scale.setScalar(scaleOf(place));
    invalidate();
  }, [dragging, invalidate, place]);

  const top = 1.42;

  const take = (kind: "move" | "resize") => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    // Tell the look-drag this press is spoken for, or arranging a panel also
    // swings the camera round the room.
    claimPointer(event.nativeEvent);
    grabbedPointer.current = event.pointerId;
    // Capture, so the drag survives the ray slipping off the panel for a frame.
    // Guarded because it is not there on every pointer.
    (event.target as { setPointerCapture?: (id: number) => void } | null)
      ?.setPointerCapture?.(event.pointerId);
    begin(rayOf(event), event.point ? vec(event.point) : null, kind);
    listenWhileDragging();
  };

  const steer = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    event.stopPropagation();
    drag(rayOf(event));
  };

  const letGo = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    grabbedPointer.current = null;
    release();
  };

  return (
    <group ref={group}>
      {children}

      {/*
        THE WHOLE FACE OF THE PANEL, once it is unlocked.

        AND IT IS THE PANEL'S OWN SIZE NOW. It was a hardcoded 4.0 x 2.6 hung
        0.6 above centre, which is wrong at both ends: it missed the bottom
        fifth of the panel, so dragging worked in the top of a panel and did
        nothing in the bottom — the worst kind of broken, because it looks
        intermittent — and it reached 0.65 ABOVE the panel, over the drag bar
        at 1.42, which it then stole every press from because it sits in front.
        Found by dragging a panel by its lower half and watching nothing
        happen.

        A bar along the top is fine for a deliberate nudge and hopeless as the
        only way to arrange a room from four metres away with a controller ray.
        Unlocked, the panel itself is the handle — which is what Nikk asked for:
        "if drag is on we can click on the window and move it."

        IT ONLY EXISTS WHILE UNLOCKED. A permanently invisible plane in front of
        every panel would swallow every ray aimed at the page behind it, and a
        board you cannot press is worse than one you cannot move.

        Visible, faintly, because a mode you cannot see is a mode you forget you
        are in — and this one changes what pressing a board does.
      */}
      {mode !== "locked" ? (
        <mesh
          position={[0, 0, 0.02]}
          onPointerDown={take(mode === "resize" ? "resize" : "move")}
          onPointerMove={steer}
          onPointerUp={letGo}
        >
          <planeGeometry args={[PANEL.width, PANEL.height]} />
          <meshBasicMaterial
            color={mode === "resize" ? "#c9a86f" : "#6f86c9"}
            transparent
            opacity={dragging ? 0.28 : 0.14}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {says ? (
        <group position={[0, top + BAR_HEIGHT / 2 + 0.22, 0.04]}>
          <mesh raycast={noRaycast}>
            <planeGeometry args={[PANEL.width * 0.9, 0.34]} />
            <meshBasicMaterial color={CARD_INK.paperHeld} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0, 0.005]}
            // About the size of a panel title: readable from where you stood to grab it.
            fontSize={0.17}
            maxWidth={PANEL.width * 0.85}
            color={CARD_INK.refused}
            anchorX="center"
            anchorY="middle"
            raycast={noRaycast}
          >
            {says}
          </Text>
        </group>
      ) : null}

      {/*
        A 3D bar the full width of the panel: a big target for a ray from across
        the room, where a small gizmo arrow is a test of nerve — and a perfectly
        ordinary thing to click with a mouse.
      */}
      <mesh
        position={[0, top, 0.01]}
        onPointerDown={take("move")}
        onPointerMove={steer}
        onPointerUp={letGo}
      >
        <boxGeometry args={[PANEL.width, BAR_HEIGHT, 0.06]} />
        <meshBasicMaterial
          color={dragging ? "#6f86c9" : "#2b3245"}
          transparent
          opacity={dragging ? 0.95 : 0.6}
        />
      </mesh>
    </group>
  );
}
