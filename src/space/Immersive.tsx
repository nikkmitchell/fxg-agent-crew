import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { ROOM, type Vec3 } from "../../shared/space-layout";
import { clampToRoom, type Comfort } from "./comfort";
import type { ClientMessage } from "../../shared/space-wire";

/**
 * Standing in the room, rather than looking at it.
 *
 * I CANNOT VERIFY ANY OF THIS. Everything else in the space was checked in a
 * browser and screenshotted; a headset session cannot be. What follows is
 * written as carefully as I can manage and is UNTESTED ON HARDWARE — the
 * comments say which parts are guesses so that whoever puts the headset on
 * knows where to look first.
 *
 * The one thing that IS tested is the maths underneath: comfort settings, the
 * wall clamp and the speed all come from the same `shared/space-layout.ts` the
 * flat view uses, and are unit-tested in `src/space/comfort.test.ts`.
 */

/**
 * The player's feet, driven by the controller sticks.
 *
 * `useXRControllerLocomotion` moves the group it is given. The wall clamp is
 * applied AFTER it, every frame, rather than by refusing the input: a clamp on
 * the input would let the player push into a wall and stop dead, which in a
 * headset feels like the tracking has broken.
 */
export function ImmersivePlayer({
  comfort,
  send,
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
}) {
  const origin = useRef<THREE.Group>(null);
  const lastSent = useRef(0);

  useXRControllerLocomotion(
    origin,
    { speed: comfort.speed },
    comfort.turn === "snap"
      ? { type: "snap", degrees: comfort.snapDegrees, deadZone: 0.5 }
      : { type: "smooth", speed: 2, deadZone: 0.3 },
    // The LEFT stick moves and the right turns, which is the convention on both
    // Quest and Android XR. A guess only in the sense that I have not held one.
    "left",
  );

  useFrame(({ clock }) => {
    const group = origin.current;
    if (!group) return;

    const inside = clampToRoom({ x: group.position.x, z: group.position.z });
    group.position.x = inside.x;
    group.position.z = inside.z;
    // The floor is the floor. XROrigin is the player's FEET, so this is 0 —
    // head height comes from the headset's own tracking, not from us.
    group.position.y = 0;

    // Tell the room where we are, at the same rate as the flat view.
    const now = clock.getElapsedTime() * 1000;
    if (now - lastSent.current < 100) return;
    lastSent.current = now;
    const at: Vec3 = { x: group.position.x, y: 0, z: group.position.z };
    send({ type: "move", at, facing: group.rotation.y });
  });

  return <XROrigin ref={origin} position={[ROOM.spawn.x, 0, ROOM.spawn.z]} />;
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
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
  onChange: (inSession: boolean) => void;
}) {
  const session = useXR((state) => state.session);
  useEffect(() => {
    onChange(Boolean(session));
  }, [session, onChange]);
  return session ? <ImmersivePlayer comfort={comfort} send={send} /> : null;
}
