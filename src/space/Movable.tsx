import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { facingArc, placementRefusal, scaleOf } from "../../shared/panel-place";
import { resizedScale } from "./panel-resize";
import type { ArrangeMode } from "./usePanelArrange";
import type { Placement } from "../../shared/space-wire";
import { dropGrip, onGrabOf, putGrip } from "./grip-positions";

/**
 * A panel you can pick up and put somewhere else.
 *
 * TWO HANDLES, ONE FOR EACH WORLD, and the reason is not tidiness. In a window
 * the panels are real DOM, and drei's `occlude="blending"` sets
 * `pointer-events: none` on the WebGL canvas so those iframes stay clickable —
 * which means NO 3D object can ever receive a pointer there. I wrote a 3D drag
 * bar first, watched it do nothing, and found the canvas dead to the mouse. So
 * the window gets a DOM bar and a headset gets the 3D one, both driving the
 * same three lines of maths below.
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
  inHeadset,
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
  inHeadset: boolean;
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
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const scratch = useRef({
    plane: new THREE.Plane(),
    ray: new THREE.Raycaster(),
    hit: new THREE.Vector3(),
    ndc: new THREE.Vector2(),
  });

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

  const begin = useCallback(
    (clientX: number, clientY: number, kind: "move" | "resize" = "move") => {
      const at = floorPoint(clientX, clientY);
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
    [floorPoint, place],
  );

  const drag = useCallback(
    (clientX: number, clientY: number) => {
      const node = group.current;
      const at = floorPoint(clientX, clientY);
      if (!node || !at) return;

      if (gesture.current === "resize") {
        // The panel stays where it is; only its size follows the ray. Moving
        // and resizing at once would mean neither could be done deliberately.
        const now = Math.hypot(at.x - place.position.x, at.z - place.position.z);
        node.scale.setScalar(resizedScale(grabbed.current.scale, grabbed.current.distance, now));
        invalidate();
        return;
      }

      const x = at.x + grabOffset.current.x;
      const z = at.z + grabOffset.current.z;
      node.position.set(x, place.position.y, z);
      node.rotation.y = facingArc(x, z);
      // A room set to redraw only when something happens still has to redraw
      // while a panel is being dragged through it.
      invalidate();
    },
    [floorPoint, invalidate, place.position],
  );

  const release = useCallback(() => {
    const node = group.current;
    setDragging(false);
    if (!node) return;
    const next: Placement = {
      id: place.id,
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      rotationY: node.rotation.y,
      scale: node.scale.x,
    };
    const refused = placementRefusal(next);
    if (refused) {
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
    const move = (event: PointerEvent) => drag(event.clientX, event.clientY);
    const up = () => release();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, drag, release]);

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
      {inHeadset && mode !== "locked" ? (
        <mesh
          position={[0, 0.6, 0.02]}
          onPointerDown={(event) => {
            event.stopPropagation();
            begin(event.clientX, event.clientY, mode === "resize" ? "resize" : "move");
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

      {inHeadset ? (
        // A 3D bar the full width of the panel: a big target for a ray from
        // across the room, where a small gizmo arrow is a test of nerve.
        <mesh
          position={[0, top, 0.01]}
          onPointerDown={(event) => {
            event.stopPropagation();
            begin(event.clientX, event.clientY);
          }}
        >
          <boxGeometry args={[4.0, 0.14, 0.06]} />
          <meshBasicMaterial
            color={dragging ? "#6f86c9" : "#2b3245"}
            transparent
            opacity={dragging ? 0.95 : 0.6}
          />
        </mesh>
      ) : (
        // A DOM bar, because the canvas beneath it is `pointer-events: none`.
        <PanelGrip id={place.id} worldY={top} onGrab={begin} />
      )}
    </group>
  );
}



/**
 * Reports where this panel's handle belongs on screen, every frame.
 *
 * It draws nothing. `PanelGrips`, outside the Canvas, draws the button — see
 * `grip-positions.ts` for why it cannot be done in here.
 */
function PanelGrip({
  id,
  worldY,
  onGrab,
}: {
  id: string;
  worldY: number;
  onGrab: (clientX: number, clientY: number) => void;
}) {
  const anchor = useRef<THREE.Object3D>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const at = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    onGrabOf(id, onGrab);
  }, [id, onGrab]);

  useEffect(() => () => dropGrip(id), [id]);

  useFrame(() => {
    const point = anchor.current;
    if (!point) return;
    point.getWorldPosition(at);
    at.project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    putGrip({
      id,
      x: rect.left + ((at.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - at.y) / 2) * rect.height,
      // Behind the camera projects to a mirrored point on the far side of the
      // screen, which would put a handle nowhere near its panel.
      shown: at.z <= 1,
    });
  });

  return <object3D ref={anchor} position={[0, worldY, 0.02]} />;
}
