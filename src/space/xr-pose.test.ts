import { describe, expect, it } from "vitest";
import { guardFramePoses, jointIn, poseIn, viewerIn } from "./xr-pose";

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

describe("the library's own pose reads (XRFrame.getPose, guarded once)", () => {
  class FakeFrame {
    calls = 0;
    constructor(private readonly answer: () => XRPose | undefined) {}
    getPose(): XRPose | undefined {
      this.calls += 1;
      return this.answer();
    }
  }

  it("answers a read across a session change with no pose, and anything else as before", () => {
    const proto = FakeFrame.prototype as unknown as { getPose?: unknown };
    guardFramePoses(proto);
    const across = new FakeFrame(mismatched as () => XRPose) as unknown as XRFrame;
    expect(across.getPose(space, base)).toBeUndefined();
    const pose = { transform: {} } as XRPose;
    expect((new FakeFrame(() => pose) as unknown as XRFrame).getPose(space, base)).toBe(pose);
    // Other errors are still errors: a wrong argument must not quietly become "not tracked".
    const wrong = new FakeFrame(() => { throw new TypeError("parameter 1 is not of type 'XRSpace'"); }) as unknown as XRFrame;
    expect(() => wrong.getPose(space, base)).toThrow(TypeError);
  });

  it("wraps only once, however often the store is asked for", () => {
    class Frame { getPose() { return undefined; } }
    const proto = Frame.prototype as unknown as { getPose?: unknown };
    guardFramePoses(proto);
    const once = proto.getPose;
    guardFramePoses(proto);
    expect(proto.getPose).toBe(once);
  });

  it("does nothing where there is no XRFrame (a desktop browser, a test)", () => {
    expect(() => guardFramePoses(undefined)).not.toThrow();
  });
});
