/**
 * Getting the microphone question out of the headset.
 *
 * WHY. Pressing the speak button inside an immersive session calls
 * `getUserMedia`, and if nobody has allowed the microphone yet, THE BROWSER
 * ASKS — with a system dialog, inside a session, which is the exact shape of
 * the bug that threw Baiwei out of the room every time he tapped a text box.
 * Live voice asks for the microphone too, but only when somebody turns it on,
 * so a person who has never used voice arrives in the headset with the question
 * still unanswered and the first press of the new button is where it lands.
 *
 * I have not watched this happen — Baiwei had already allowed his microphone,
 * which is why speaking worked for him first time. But the cost of being wrong
 * is somebody's first use of the feature ending with the room disappearing, and
 * the cost of being right is one prompt in a browser window where a prompt
 * belongs.
 *
 * WHAT I TRIED FIRST AND THREW AWAY: asking on the "Enter in your headset"
 * press. `navigator.xr.requestSession` needs the user activation from that
 * click, so the permission call cannot be awaited before it — which leaves the
 * dialog appearing WHILE the session starts, a worse moment than the one it was
 * meant to avoid. Prompting everybody who opens the room to guard a button some
 * of them will never press is no better.
 *
 * SO THE ROOM WARNS INSTEAD, the same way it does for the headset keyboard:
 * when nobody has decided yet, the first press says what is about to happen and
 * the second one does it. No dialog anybody did not choose, no race with a
 * session starting, and nothing surprising at the moment it matters.
 *
 * `askForMicrophoneEarly` is what the second press calls. It never blocks
 * anything: a refused microphone means the speak button says so, not that the
 * room stops working.
 */

type PermissionScope = {
  permissions?: { query(descriptor: { name: string }): Promise<{ state: string }> };
  mediaDevices?: { getUserMedia(constraints: { audio: boolean }): Promise<MediaStream> };
};

/** "granted", "denied", "prompt", or null when the browser will not say. */
export async function microphoneState(scope: PermissionScope = navigator as PermissionScope): Promise<string | null> {
  try {
    // The name is not in TypeScript's PermissionName union, and Firefox throws
    // on it outright rather than answering — hence the string and the catch.
    const status = await scope.permissions?.query({ name: "microphone" });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask for the microphone now, in the page, if and only if nobody has decided.
 *
 * Returns what happened, for the journal: a line saying the question was
 * settled out here is worth having when somebody later reports the room
 * vanishing at the moment they pressed a button.
 */
export async function askForMicrophoneEarly(
  scope: PermissionScope = navigator as PermissionScope,
): Promise<"already-granted" | "already-refused" | "granted" | "refused" | "not-asked"> {
  const state = await microphoneState(scope);
  if (state === "granted") return "already-granted";
  if (state === "denied") return "already-refused";
  // Unknown ("prompt") or unknowable (null). Only ask when there is a real
  // chance of a dialog appearing inside a session later.
  if (!scope.mediaDevices?.getUserMedia) return "not-asked";
  try {
    const stream = await scope.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch {
    return "refused";
  }
}
