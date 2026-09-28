let roomAudioContext: AudioContext | null = null;

/** Register the scene's playback context so headset controls can unlock it. */
export function registerRoomAudioContext(context: AudioContext): () => void {
  roomAudioContext = context;
  return () => {
    if (roomAudioContext === context) roomAudioContext = null;
  };
}

/** Resume synchronously from an explicit room-call gesture (including XR taps). */
export function resumeRoomAudio(): void {
  const context = roomAudioContext;
  if (!context || context.state === "running" || context.state === "closed") return;
  void context.resume().catch(() => undefined);
}

/**
 * A controller or hand selection is a headset user gesture, but it need not
 * dispatch a DOM pointer event. Unlock the page-wide playback context from
 * WebXR's trusted `select` event, and ignore gaze-triggered selections. A
 * transient pointer is used by hand-tracked pinch input in visionOS.
 */
export function unlockRoomAudioFromXR(
  session: Pick<XRSession, "addEventListener" | "removeEventListener"> | null | undefined,
): () => void {
  if (!session) return () => {};
  const unlock = (event: XRInputSourceEvent) => {
    if (!event.isTrusted || event.inputSource.targetRayMode === "gaze") return;
    resumeRoomAudio();
  };
  session.addEventListener("select", unlock);
  return () => session.removeEventListener("select", unlock);
}
