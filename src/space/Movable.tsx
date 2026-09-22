import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { facingArc, placementRefusal, scaleOf } from "../../shared/panel-place";
import { resizedScale } from "./panel-resize";
import { PANEL_HALF_LIFE, follow, followPoint } from "../../shared/smooth-follow";
import type { ArrangeMode } from "./usePanelArrange";
import type { Placement } from "../../shared/space-wire";
import { claimPointer } from "./pointer-claim";

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
 * pointer: R3F gives a mouse press and a controller ray the same event, with
 * `pointerType` to tell them apart if anything ever needs to. Nothing here
 * does, which is the point.
 *
 * MOVES ON THE FLOOR PLANE, KEEPS ITS HEIGHT. Dragging in three dimensions from
 * a two-dimensional pointer needs a mode switch, and every one I could think of
 * was worse than not offering it.
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
  /** Which handle to offer. See the note above; this is not cosmetic. */
  /** Called once, on release, with where it ended up. Never during the drag. */
  onPlaced: (place: Placement) => void;
  onTrouble: (why: string | null) => void;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<"move" | "resize">("move");
  const grabOffset = useRef({ x: 0, z: 0 });
  /** Where the resize started: how far out it was grabbed, and the size then. */
  const grabbed = useRef({ distance: 1, scale: 1 });
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

  const scratch = useRef({
    plane: new THREE.Plane(),
    ray: new THREE.Raycaster(),
    hit: new THREE.Vector3(),
    ndc: new THREE.Vector2(),
  });

  /**
   * A world point, flattened to the floor plane the panel moves on.
   *
   * In a headset the pointer event already carries the world position where
   * the ray struck — no screen, no projection, no camera involved. The panel
   * moves on the floor plane and keeps its height (see the note at the top),
   * so the height of the strike is deliberately dropped.
   */
  const onFloor = useCallback(
    (point: THREE.Vector3 | undefined): { x: number; z: number } | null =>
      point ? { x: point.x, z: point.z } : null,
    [],
  );

  /** Where on the floor, at the panel's height, a screen point lands. */
  const floorPoint = useCallback(
    (clientX: number, clientY: number): { x: number; z: number } | null => {
      const { plane, ray, hit, ndc } = scratch.current;
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      plane.set(new THREE.Vector3(0, 1, 0), -place.position.y);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    },
    [camera, gl, place.position.y],
  );

  /**
   * Take hold, at a point on the floor plane.
   *
   * A FLOOR POINT RATHER THAN SCREEN COORDINATES, and this is the whole reason
   * dragging never worked in a headset. It used to take `clientX/clientY` and
   * cast a ray from the camera through that screen position — which is exactly
   * right for a mouse and meaningless in an immersive session, where there is
   * no screen, no cursor, and a controller event carries no useful client
   * coordinates. Nikk: "on panel movement and rescaling, draggin never worked
   * on those." It could not have: every drag was computing a ray through the
   * point (0, 0) of a canvas nobody was looking at.
   *
   * The window converts its pointer to a floor point and passes that in; the
   * headset passes the world position where its ray actually struck the panel.
   * One piece of maths, two ways of pointing at it.
   */
  const begin = useCallback(
    (at: { x: number; z: number } | null, kind: "move" | "resize" = "move") => {
      gesture.current = kind;
      // Remember where on the panel it was taken hold of, so it does not jump
      // its own centre under the pointer the moment you grab it.
      grabOffset.current = at
        ? { x: place.position.x - at.x, z: place.position.z - at.z }
        : { x: 0, z: 0 };
      grabbed.current = {
        distance: at ? Math.hypot(at.x - place.position.x, at.z - place.position.z) : 0,
        scale: scaleOf(place),
      };
      setDragging(true);
    },
    [place],
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
  const target = useRef<{ position: { x: number; z: number }; scale: number } | null>(null);

  const drag = useCallback(
    (at: { x: number; z: number } | null) => {
      const node = group.current;
      if (!node || !at) return;

      if (gesture.current === "resize") {
        // The panel stays where it is; only its size follows the ray. Moving
        // and resizing at once would mean neither could be done deliberately.
        const now = Math.hypot(at.x - place.position.x, at.z - place.position.z);
        target.current = {
          position: { x: node.position.x, z: node.position.z },
          scale: resizedScale(grabbed.current.scale, grabbed.current.distance, now),
        };
        invalidate();
        return;
      }

      target.current = {
        position: { x: at.x + grabOffset.current.x, z: at.z + grabOffset.current.z },
        scale: node.scale.x,
      };
      // A room set to redraw only when something happens still has to redraw
      // while a panel is being dragged through it.
      invalidate();
    },
    [invalidate, place.position],
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
    const moved = followPoint(
      { x: node.position.x, z: node.position.z },
      want.position,
      delta,
      PANEL_HALF_LIFE,
    );
    const sized = follow(node.scale.x, want.scale, delta, PANEL_HALF_LIFE, 0.0008);
    node.position.set(moved.value.x, place.position.y, moved.value.z);
    node.rotation.y = facingArc(moved.value.x, moved.value.z);
    node.scale.setScalar(sized.value);
    if (moved.settled && sized.settled) {
      target.current = null;
      return;
    }
    invalidate();
  });

  const release = useCallback(() => {
    const node = group.current;
    setDragging(false);
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
    const x = want ? want.position.x : node.position.x;
    const z = want ? want.position.z : node.position.z;
    const scale = want ? want.scale : node.scale.x;
    const next: Placement = {
      id: place.id,
      position: { x, y: node.position.y, z },
      rotationY: facingArc(x, z),
      scale,
    };
    const refused = placementRefusal(next);
    if (refused) {
      // Drop the target as well, or the ease carries on pulling the panel back
      // toward the place the server just refused.
      target.current = null;
      node.position.set(place.position.x, place.position.y, place.position.z);
      node.rotation.y = place.rotationY;
      node.scale.setScalar(scaleOf(place));
      invalidate();
      onTrouble(refused);
      return;
    }
    onTrouble(null);
    onPlaced(next);
  }, [invalidate, onPlaced, onTrouble, place]);

  /**
   * While dragging, the whole window listens.
   *
   * Not the bar: a pointer moving faster than React re-renders leaves a small
   * DOM element behind within the first few pixels, and the panel would stop
   * following halfway through every drag.
   */
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => drag(floorPoint(event.clientX, event.clientY));
    const up = () => release();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, drag, floorPoint, release]);

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

  return (
    <group ref={group}>
      {children}

      {/*
        THE WHOLE FACE OF THE PANEL, once it is unlocked.

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
          position={[0, 0.6, 0.02]}
          onPointerDown={(event) => {
            event.stopPropagation();
            // Tell the look-drag this press is spoken for, or arranging a panel
            // also swings the camera round the room.
            claimPointer(event.nativeEvent);
            grabbedPointer.current = event.pointerId;
            // Capture, so the drag survives the ray slipping off the panel for
            // a frame. Guarded because it is not there on every pointer.
            (event.target as { setPointerCapture?: (id: number) => void } | null)
              ?.setPointerCapture?.(event.pointerId);
            begin(onFloor(event.point), mode === "resize" ? "resize" : "move");
          }}
          onPointerMove={(event) => {
            if (grabbedPointer.current !== event.pointerId) return;
            event.stopPropagation();
            drag(onFloor(event.point));
          }}
          onPointerUp={(event) => {
            if (grabbedPointer.current !== event.pointerId) return;
            grabbedPointer.current = null;
            release();
          }}
        >
          <planeGeometry args={[4.0, 2.6]} />
          <meshBasicMaterial
            color={mode === "resize" ? "#c9a86f" : "#6f86c9"}
            transparent
            opacity={dragging ? 0.28 : 0.14}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {/*
        A 3D bar the full width of the panel: a big target for a ray from across
        the room, where a small gizmo arrow is a test of nerve — and a perfectly
        ordinary thing to click with a mouse.
      */}
      <mesh
          position={[0, top, 0.01]}
          onPointerDown={(event) => {
            event.stopPropagation();
            claimPointer(event.nativeEvent);
            grabbedPointer.current = event.pointerId;
            (event.target as { setPointerCapture?: (id: number) => void } | null)
              ?.setPointerCapture?.(event.pointerId);
            begin(onFloor(event.point));
          }}
          onPointerMove={(event) => {
            if (grabbedPointer.current !== event.pointerId) return;
            event.stopPropagation();
            drag(onFloor(event.point));
          }}
          onPointerUp={(event) => {
            if (grabbedPointer.current !== event.pointerId) return;
            grabbedPointer.current = null;
            release();
          }}
        >
          <boxGeometry args={[4.0, 0.14, 0.06]} />
          <meshBasicMaterial
            color={dragging ? "#6f86c9" : "#2b3245"}
            transparent
            opacity={dragging ? 0.95 : 0.6}
          />
      </mesh>
    </group>
  );
}
