import { turnAbout } from "./palm-joystick";

/**
 * Staying where you were when the headset re-centres itself.
 *
 * Nikk, from the headset: "I just seem to have teleported over here... it
 * happens a bunch of times where I just automatically teleport on my own
 * without me doing anything, over into this area where I am right now."
 *
 * WHAT ACTUALLY HAPPENS. Every pose a headset reports is measured against a
 * reference space, and the device may move that space underneath us: a Quest
 * does it when somebody holds the system button to re-centre, when tracking is
 * lost and found again, and when the headset is taken off and put back on. The
 * spec calls it a `reset` event on the reference space. Neither three.js nor
 * @react-three/xr listens for it, so the player's frame — the XROrigin — stays
 * exactly where it was while the person's measured position jumps, which lands
 * them back wherever they entered or last moved to. It looks like a teleport
 * because it is one.
 *
 * WHAT WE DO ABOUT IT. The room remembers where the person's head was standing
 * and which way it faced, in ROOM coordinates, on the frame before the reset.
 * After the reset, their head is measured somewhere else; this works out where
 * the origin has to go for the head to be back where it was, facing the way it
 * faced. The person keeps their place in the room and the re-centre does what
 * they asked it to do — line their body up with their real room — instead of
 * moving them.
 *
 * NOT `event.transform`. The event may carry the transform between old space
 * and new, and on the devices we have it is frequently absent; measuring the
 * head before and after needs nothing the device chooses to provide.
 */

export type Placed = { x: number; z: number; yaw: number };

/** Where the origin must be for the head to stay put across a reset. */
export function compensateReset(origin: Placed, before: Placed, after: Placed): Placed {
  // Turn the player's whole frame about the head's NEW position, so the turn
  // itself does not move the head, then slide the frame so the head lands back
  // where it was.
  const turned = turnAbout(origin, { x: after.x, z: after.z }, before.yaw - after.yaw);
  return {
    x: turned.x + (before.x - after.x),
    z: turned.z + (before.z - after.z),
    yaw: turned.yaw,
  };
}

/**
 * Where a head ends up, given the origin its frame sits at and the head's pose
 * within that frame. Exported for the test, which has no headset to ask.
 */
export function headInRoom(origin: Placed, local: Placed): Placed {
  const cos = Math.cos(origin.yaw);
  const sin = Math.sin(origin.yaw);
  return {
    x: origin.x + local.x * cos + local.z * sin,
    z: origin.z - local.x * sin + local.z * cos,
    yaw: origin.yaw + local.yaw,
  };
}
