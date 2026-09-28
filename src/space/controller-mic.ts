/**
 * THE MICROPHONE ON THE CONTROLLER'S BUTTONS (Nikk, 2026-09-28): "lets switch
 * controller mode to not be pressing the button in physical space ... A or X
 * is to start recording, A or X press again is to finish and send recording,
 * B or Y cancels recording. We can keep the push button to record thing as a
 * setting." The touch mic by your hip is now off unless that setting is on.
 *
 * Immersive.tsx writes which face buttons are held, every frame, from the
 * tracked controllers; RoomControls.tsx acts on the moment one goes down.
 */
export const controllerFaceButtons = { talk: false, cancel: false };

export function clearControllerFaceButtons(): void {
  controllerFaceButtons.talk = false;
  controllerFaceButtons.cancel = false;
}

type ButtonState = { state?: "default" | "touched" | "pressed" } | undefined;

/** Is this face button down right now? Touched is not pressed. */
export function isPressed(button: ButtonState): boolean {
  return button?.state === "pressed";
}

/**
 * What a press means. A or X starts a recording when one could start, and
 * finishes and sends one that is under way (or words waiting to go); B or Y
 * throws a recording away. Anything else is ignored.
 */
export function controllerMicAction(pressed: "talk" | "cancel", recording: boolean, canStart: boolean): "start" | "finish" | "cancel" | null {
  if (pressed === "cancel") return recording ? "cancel" : null;
  if (recording) return "finish";
  return canStart ? "start" : null;
}

/** The setting that brings back the touch mic by your hip, for controllers. Per device. */
const TOUCH_MIC_KEY = "touch-mic-buttons";
export function readTouchMicSetting(): boolean {
  try {
    return localStorage.getItem(TOUCH_MIC_KEY) === "on";
  } catch {
    return false;
  }
}
export function writeTouchMicSetting(on: boolean): void {
  try {
    localStorage.setItem(TOUCH_MIC_KEY, on ? "on" : "off");
  } catch {
    /* per-device convenience only */
  }
}
