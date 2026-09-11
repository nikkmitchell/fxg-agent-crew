import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion, useXRInputSourceState } from "@react-three/xr";
import * as THREE from "three";
import { ROOM, type Vec3 } from "../../shared/space-layout";
import { clampToRoom, type Comfort } from "./comfort";
import type { ClientMessage, Pose } from "../../shared/space-wire";

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
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const worldQuaternion = useMemo(() => new THREE.Quaternion(), []);

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

  /**
   * Read a tracked thing in ROOM space.
   *
   * Everything the headset reports is in the XR reference space, which is the
   * player's own origin — so a head at (0,1.6,0) means "1.6m above my feet",
   * not "above the middle of the room". The room's coordinates are what every
   * other client draws in, so the conversion happens here, once, rather than
   * three times in the renderer.
   */
  const inRoomSpace = (object: THREE.Object3D | null | undefined): Pose | null => {
    if (!object) return null;
    object.getWorldPosition(worldPosition);
    object.getWorldQuaternion(worldQuaternion);
    return {
      p: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
      q: { x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w },
    };
  };

  useFrame(({ clock, camera }) => {
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

    // THE HEAD IS THE XR CAMERA. In a session three.js drives it from the
    // headset's own pose every frame, so this is a measurement rather than a
    // guess — the one part of an avatar a headset can state outright.
    const head = inRoomSpace(camera);

    // HANDS ARE WHATEVER IS ACTUALLY TRACKED, and null when nothing is. A
    // controller set down on a desk stops being reported, and the figure loses
    // that hand rather than leaving one hovering where it was abandoned.
    // `left` and `right` are the XR handedness, so they are the person's own
    // left and right and not the viewer's.
    // `.object` is the three.js node the library keeps in sync with the input
    // source, and it is OPTIONAL — absent until the device has actually located
    // that hand. An absent object is reported as an untracked hand rather than
    // as a hand at the origin, which is where an unchecked `.object` would put
    // it: on the floor in the middle of the room.
    const hands = {
      left: inRoomSpace(leftHand?.object) ?? inRoomSpace(leftController?.object),
      right: inRoomSpace(rightHand?.object) ?? inRoomSpace(rightController?.object),
    };

    send({ type: "move", at, facing: group.rotation.y, ...(head ? { head } : {}), hands });
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
