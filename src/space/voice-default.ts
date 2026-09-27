/**
 * VOICE IS ON FROM THE START.
 *
 * Nikk (desktop chat, 2026-09-28): "to start lets have voice not muted, have
 * it on naturally"; and in the room (5423): "have the audio start by always
 * being on and then to turn it off it's just inside the settings under the
 * mute button". The browser still asks for the microphone the first time —
 * Nikk (5454): "every XR headset will ask for permissions before audio can be
 * shared, so we do not need to add anything extra there".
 *
 * TWO LIMITS, both about not surprising anybody:
 *
 *   - A MUTE YOU CHOSE STAYS for the rest of this browser session, so a reload
 *     (an update, a room switch) does not open your microphone again behind
 *     your back. A new visit starts on again.
 *   - NOT FROM INSIDE A HEADSET SESSION unless the microphone is already
 *     granted: a permission dialog inside immersive mode is what threw baiwei
 *     out of the room (Sill, 5452). The flat page asks first, before you enter.
 */

const KEY = "saha.voice.self-muted";

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

/** Remember that you turned your own microphone off (or back on). */
export function rememberSelfMute(muted: boolean): void {
  try {
    if (muted) window.sessionStorage.setItem(KEY, "1");
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // A private window: the choice holds until the page goes, which is enough.
  }
}

export function selfMuted(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether voice should turn itself on now. */
export function shouldStartVoice(state: {
  selfMuted: boolean;
  alreadyOn: boolean;
  immersive: boolean;
  permission: MicPermission;
}): boolean {
  if (state.selfMuted || state.alreadyOn) return false;
  // Refused before: asking again is a dialog that can only say no.
  if (state.permission === "denied") return false;
  if (state.immersive && state.permission !== "granted") return false;
  return true;
}

/** What the browser says about the microphone, without asking for it. */
export async function microphonePermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return status?.state ?? "unknown";
  } catch {
    // Firefox and older Quest browsers do not know the name.
    return "unknown";
  }
}
