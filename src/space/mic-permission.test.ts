import { describe, expect, it, vi } from "vitest";
import { askForMicrophoneEarly, microphoneState } from "./mic-permission";

const scope = (over: Record<string, unknown> = {}) => ({
  permissions: { query: async () => ({ state: "prompt" }) },
  mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream },
  ...over,
});

describe("what the browser says about the microphone", () => {
  it("passes the answer through", async () => {
    expect(await microphoneState(scope())).toBe("prompt");
  });

  it("says nothing rather than guessing when the browser will not answer", async () => {
    // Firefox throws on the microphone descriptor instead of replying.
    expect(await microphoneState(scope({ permissions: { query: async () => { throw new Error("no"); } } }))).toBeNull();
    expect(await microphoneState(scope({ permissions: undefined }))).toBeNull();
  });
});

describe("asking for the microphone before the headset, not inside it", () => {
  it("does not ask anybody who has already allowed it", async () => {
    let asked = false;
    const result = await askForMicrophoneEarly(
      scope({
        permissions: { query: async () => ({ state: "granted" }) },
        mediaDevices: {
          getUserMedia: async () => {
            asked = true;
            return { getTracks: () => [] } as unknown as MediaStream;
          },
        },
      }),
    );
    expect(result).toBe("already-granted");
    expect(asked, "no prompt for a question already answered").toBe(false);
  });

  it("does not pester somebody who has already refused", async () => {
    const result = await askForMicrophoneEarly(scope({ permissions: { query: async () => ({ state: "denied" }) } }));
    expect(result).toBe("already-refused");
  });

  /**
   * The case this exists for: undecided, so the dialog would otherwise appear
   * inside an immersive session the first time the speak button is pressed.
   */
  it("asks when the answer is unknown, and lets go of the microphone at once", async () => {
    const stop = vi.fn();
    const result = await askForMicrophoneEarly(
      scope({
        mediaDevices: {
          getUserMedia: async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
        },
      }),
    );
    expect(result).toBe("granted");
    expect(stop, "the permission was the point, not the audio").toHaveBeenCalled();
  });

  it("reports a refusal rather than throwing, because entering the room must not depend on it", async () => {
    const result = await askForMicrophoneEarly(
      scope({ mediaDevices: { getUserMedia: async () => { throw new Error("no"); } } }),
    );
    expect(result).toBe("refused");
  });

  it("asks nobody on a browser with no microphone at all", async () => {
    expect(await askForMicrophoneEarly(scope({ mediaDevices: undefined }))).toBe("not-asked");
  });
});
