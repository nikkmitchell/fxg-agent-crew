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
