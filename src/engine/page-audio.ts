/**
 * THE PAGE'S ONE AUDIO CONTEXT, and the master every thing's sound goes into.
 *
 * The room's voices, the Things' sounds, and every bowl, chime, gong and breath
 * tone play through this one context, the one a headset tap unlocks
 * (room-audio.ts). three.js is pointed at it wherever three is loaded
 * (three-audio.ts), so its AudioListener plays through it too.
 *
 * NO three.js HERE, on purpose. The breath tones are reached from the page's
 * first download (SpacePanel -> voice-mouth -> breath-sound), and finding this
 * context through THREE.AudioContext.getContext() put all of three.js, about
 * 100 KB gzipped, back into every page's first load: the board, sign-in and
 * profiles included (Kerf, 2026-10-21; src/first-load.test.ts now walks the
 * whole graph).
 *
 * It is given a close() that does nothing, so a thing that tidies up by closing
 * its context (Mica's RainAudio does) cannot silence the room's calls.
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;

export function pageAudioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
    (context as { close: () => Promise<void> }).close = () => Promise.resolve();
  }
  return context;
}

export function pageAudio(): { context: AudioContext; master: GainNode } {
  const page = pageAudioContext();
  if (!master || master.context !== page) {
    master = page.createGain();
    master.connect(page.destination);
  }
  return { context: page, master };
}
