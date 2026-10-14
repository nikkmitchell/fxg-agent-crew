import { describe, expect, it } from "vitest";
import { jointIn, poseIn, viewerIn } from "./xr-pose";

const space = {} as XRSpace;
const base = {} as XRReferenceSpace;
const mismatched = () => {
  throw new DOMException("Failed to execute 'getViewerPose' on 'XRFrame': XRSpace and XRFrame sessions do not match.", "InvalidStateError");
};

describe("poses read across a session change (Kerf, 2026-10-14)", () => {
  it("are none for that frame, not a thrown error in the render loop", () => {
    const frame = { getPose: mismatched, getViewerPose: mismatched, getJointPose: mismatched } as unknown as XRFrame;
    expect(poseIn(frame, space, base)).toBeNull();
    expect(viewerIn(frame, base)).toBeNull();
    expect(jointIn(frame, space as XRJointSpace, base)).toBeNull();
  });

  it("are what the frame says otherwise", () => {
    const pose = { transform: {} } as XRPose;
    const frame = { getPose: () => pose, getViewerPose: () => pose, getJointPose: () => pose } as unknown as XRFrame;
    expect(poseIn(frame, space, base)).toBe(pose);
    expect(viewerIn(frame, base)).toBe(pose);
    expect(jointIn(frame, space as XRJointSpace, base)).toBe(pose);
  });
});
