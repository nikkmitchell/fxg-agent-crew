/**
 * POSES THAT CANNOT TAKE DOWN A FRAME.
 *
 * The reference space a component holds comes from React state; the frame
 * comes from whichever session is running. Entering VR again, there is a frame
 * or two where they belong to different sessions, and the browser throws
 * "XRSpace and XRFrame sessions do not match" (InvalidStateError) from inside
 * the render loop: twice in Nikk's headset on 2026-10-13, read from the client
 * error log. Asked through these, that frame simply has no pose, as when
 * tracking is lost, and the next one is right.
 */
export function poseIn(frame: XRFrame, space: XRSpace, base: XRSpace): XRPose | null {
  try {
    return frame.getPose(space, base) ?? null;
  } catch {
    return null;
  }
}

export function viewerIn(frame: XRFrame, base: XRReferenceSpace): XRViewerPose | null {
  try {
    return frame.getViewerPose(base) ?? null;
  } catch {
    return null;
  }
}

export function jointIn(frame: XRFrame, joint: XRJointSpace, base: XRSpace): XRJointPose | null {
  try {
    return frame.getJointPose?.(joint, base) ?? null;
  } catch {
    return null;
  }
}

const GUARDED = Symbol.for("saha.guardedGetPose");

/**
 * THE SAME RULE FOR @react-three/xr's OWN READS. Its hand and controller models place themselves with
 * frame.getPose (pmndrs xr, space.js), unguarded even in 6.6.32, and in the frame or two after a new
 * session starts their input-source spaces still belong to the old one: "XRSpace and XRFrame sessions do
 * not match", uncaught, in Nikk's headset four times on 2026-10-23 (client error log), each costing a
 * frame. So XRFrame.getPose answers such a read with no pose, which the library already treats as "not
 * tracked this frame". Only that InvalidStateError: anything else still throws. Done once, at the store.
 */
export function guardFramePoses(proto: { getPose?: unknown } | undefined = (globalThis as { XRFrame?: { prototype: { getPose?: unknown } } }).XRFrame?.prototype): void {
  if (!proto || typeof proto.getPose !== "function" || (proto as Record<symbol, unknown>)[GUARDED]) return;
  const original = proto.getPose as (this: XRFrame, space: XRSpace, base: XRSpace) => XRPose | undefined;
  proto.getPose = function guardedGetPose(this: XRFrame, space: XRSpace, base: XRSpace) {
    try {
      return original.call(this, space, base);
    } catch (error) {
      if (error instanceof DOMException && error.name === "InvalidStateError") return undefined;
      throw error;
    }
  };
  (proto as Record<symbol, unknown>)[GUARDED] = true;
}
