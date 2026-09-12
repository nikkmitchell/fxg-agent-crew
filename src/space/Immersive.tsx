import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  TeleportTarget,
  XROrigin,
  useXR,
  useXRControllerLocomotion,
  useXRInputSourceState,
} from "@react-three/xr";
import * as THREE from "three";
import { ROOM, facingFor, type Vec3 } from "../../shared/space-layout";
import { clampToRoom, type Comfort } from "./comfort";
import { heldHand, NO_HAND, type Held } from "./hand-hold";
import { PassthroughButton, VoidSphere } from "./Backdrop";
import type { ClientMessage, Pose } from "../../shared/space-wire";

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
  onTogglePassthrough,
  openPanels,
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
  passthrough: boolean;
  passthroughAvailable: boolean;
  onTogglePassthrough: () => void;
  openPanels: string[];
}) {
  const origin = useRef<THREE.Group>(null);
  const lastSent = useRef(0);
  const held = useRef<{ left: Held; right: Held }>({ left: NO_HAND, right: NO_HAND });
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
  const [arrivalFacing] = useState(() => facingFor(openPanels));

  useXRControllerLocomotion(
    origin,
    { speed: comfort.speed },
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
  const teleport = useCallback((point: THREE.Vector3) => {
    const group = origin.current;
    if (!group) return;
    const inside = clampToRoom({ x: point.x, z: point.z });
    group.position.set(inside.x, 0, inside.z);
  }, []);

  useFrame(({ clock, camera }, _delta, frame) => {
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
    const liveLeft =
      poseOfSpace(leftHand?.inputSource.hand.get("wrist"), frame, group) ??
      poseOfSpace(leftController?.inputSource.gripSpace, frame, group);
    const liveRight =
      poseOfSpace(rightHand?.inputSource.hand.get("wrist"), frame, group) ??
      poseOfSpace(rightController?.inputSource.gripSpace, frame, group);
    held.current.left = heldHand(held.current.left, liveLeft, now);
    held.current.right = heldHand(held.current.right, liveRight, now);

    send({
      type: "move",
      at,
      facing: group.rotation.y,
      ...(head ? { head } : {}),
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
      <XROrigin
        ref={origin}
        position={[ROOM.spawn.x, 0, ROOM.spawn.z]}
        rotation={[0, arrivalFacing, 0]}
      >
        <PassthroughButton
          passthrough={passthrough}
          supported={passthroughAvailable}
          onToggle={onTogglePassthrough}
        />
      </XROrigin>
      {passthrough ? null : <VoidSphere />}
      {/*
        The floor you can teleport onto. It is deliberately invisible: the room
        has no floor by design, and drawing one to make teleport work would put
        a surface back that was taken out on purpose. Raycasting does not care
        whether a material can be seen.

        It sits OUTSIDE the XROrigin, in room coordinates, because a teleport
        target that moved with the player would always be underfoot.
      */}
      <TeleportTarget onTeleport={teleport}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[ROOM.width, ROOM.depth]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </TeleportTarget>
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
}: {
  comfort: Comfort;
  send: (message: ClientMessage) => void;
  onChange: (inSession: boolean) => void;
  openPanels: string[];
}) {
  const session = useXR((state) => state.session);
  const mode = useXR((state) => state.mode);
  /**
   * Passthrough is on by default WHERE IT EXISTS, because the alternative is a
   * person in a black void in their own living room and that is the thing that
   * needs asking for, not the other way round. Where the session cannot blend
   * at all the void sphere is drawn anyway: it changes nothing visible, and
   * having one code path rather than two is worth a draw call.
   */
  const available = mode === "immersive-ar";
  const [passthrough, setPassthrough] = useState(true);
  const togglePassthrough = useCallback(() => setPassthrough((on) => !on), []);
  useEffect(() => {
    onChange(Boolean(session));
  }, [session, onChange]);
  return session ? (
    <ImmersivePlayer
      comfort={comfort}
      send={send}
      passthrough={available && passthrough}
      passthroughAvailable={available}
      onTogglePassthrough={togglePassthrough}
      openPanels={openPanels}
    />
  ) : null;
}
