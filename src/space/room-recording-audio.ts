/** The active avatar take can copy room speech as it is played, without making the room audio depend on the recorder. */
let listener: ((speaker: string, element: HTMLAudioElement) => void) | null = null;

export function listenForRecordedSpeech(next: (speaker: string, element: HTMLAudioElement) => void): () => void {
  listener = next;
  return () => { if (listener === next) listener = null; };
}

export function offerRecordedSpeech(speaker: string, audio: unknown): void {
  if (typeof HTMLAudioElement !== "undefined" && audio instanceof HTMLAudioElement) listener?.(speaker, audio);
}
