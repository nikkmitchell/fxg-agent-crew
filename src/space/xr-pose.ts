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
