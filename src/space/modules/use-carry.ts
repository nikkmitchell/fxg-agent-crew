import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { beginGrab, clamp, grabbedTo, pushPull, type Grab, type Vec3 } from "../../../shared/grab-move";
import { PANEL_HALF_LIFE, followVec3 } from "../../../shared/smooth-follow";
import { useGrab } from "../use-grab";

/**
 * CARRYING A THING: a thing from a space, or the Go table (RoomItems.tsx).
 * Press its MOVE handle and it goes where the pointer goes, at the distance it
 * was taken from (the wheel or a thumbstick pushes and pulls), and is saved where
 * it is let go. The grab itself — both input roads, one carrier, letting go
 * once — is use-grab.ts, the same as the panels'.
 *
 * IT EASES THE WAY A PANEL DOES (Kerf, 2026-10-14). A carried thing used to be
 * set straight from the pointer while a panel followed it with a 60ms half-life,
 * so in a headset the table shook with your hand and the board beside it did
 * not. Same arithmetic now (smooth-follow.ts), and it is SAVED FROM THE TARGET,
 * not from wherever the ease has got to, or a thing carried repeatedly would
 * creep backwards along its own path.
 */
type Place = { x: number; y: number; z: number; rotationY: number };

export function useCarry(options: {
  id: string;
  position: Place;
  /** The group that stands where the thing does. */
  body: RefObject<THREE.Object3D | null>;
  /** Save where it was let go; resolves false if that did not stick. */
  save: (to: Place) => Promise<boolean>;
  notice: (text: string) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const latest = useRef(options);
  latest.current = options;
  const grab = useRef<Grab | null>(null);
  /** Where the pointer says it should be. Kept after letting go until the ease arrives. */
  const target = useRef<Vec3 | null>(null);

  /** Back where the room has it: the position prop is not applied again if it has not changed. */
  const putBack = () => {
    target.current = null;
    const node = latest.current.body.current;
    const at = latest.current.position;
    if (node) node.position.set(at.x, at.y, at.z);
    invalidate();
  };

  const { held, holding, take, steer, letGo } = useGrab({
    thing: `item:${options.id}`,
    begin: (ray) => {
      const at = latest.current.position;
      grab.current = beginGrab(ray, { x: at.x, y: at.y, z: at.z });
    },
    drag: (ray) => {
      if (!grab.current) return;
      const to = grabbedTo(ray, grab.current);
      // The server keeps a thing's height between -0.5 and 5; stopping the
      // gesture at the limit beats letting it run and refusing it at the end.
      target.current = { x: to.x, y: clamp(to.y, -0.5, 5), z: to.z };
      invalidate();
    },
    reach: (metres) => {
      if (!grab.current) return;
      grab.current = pushPull(grab.current, metres);
      invalidate();
    },
    release: () => {
      grab.current = null;
      const at = target.current;
      if (!at) return;
      const saved = latest.current.save({ x: at.x, y: at.y, z: at.z, rotationY: latest.current.position.rotationY });
      void saved.then((ok) => {
        if (!ok && !holding()) putBack();
      });
      return saved;
    },
    refused: (why) => {
      grab.current = null;
      putBack();
      latest.current.notice(why);
    },
  });

  // Ease toward the target, and STOP when it arrives: the room redraws on demand,
  // and a follow always a hair short would keep asking for frames.
  useFrame((_, delta) => {
    const node = latest.current.body.current;
    const want = target.current;
    if (!node || !want) return;
    const moved = followVec3(node.position, want, delta, PANEL_HALF_LIFE);
    node.position.set(moved.value.x, moved.value.y, moved.value.z);
    if (moved.settled && !grab.current) {
      target.current = null;
      return;
    }
    invalidate();
  });

  return {
    carrying: held,
    take: take("move") as (event: ThreeEvent<PointerEvent>) => void,
    steerByRay: steer,
    dropByRay: letGo,
  };
}
