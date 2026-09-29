import type { WirePerson } from "../../shared/space-wire";
import { listenForRecordedSpeech } from "./room-recording-audio";

/** Mix the recorder's mic, selected live calls and selected room utterances into one timed track. */
export function avatarAudioMix(
  microphone: MediaStream,
  includeHumans: boolean,
  includeAgents: boolean,
  people: () => WirePerson[],
  mutedNow: () => Set<string>,
): {
  stream: MediaStream;
  update: (remote: Map<string, MediaStream>, muted: Set<string>) => void;
  stop: () => void;
} {
  if (!includeHumans && !includeAgents) return { stream: microphone, update: () => {}, stop: () => {} };
  const context = new AudioContext();
  void context.resume();
  const destination = context.createMediaStreamDestination();
  const own = context.createMediaStreamSource(microphone);
  own.connect(destination);
  const connected = new Map<string, { stream: MediaStream; node: MediaStreamAudioSourceNode }>();
  /**
   * AGENTS' SPOKEN LINES ARE COPIED IN, NOT TAPPED. This used to reroute the
   * playing <audio> element through this context (createMediaElementSource).
   * In Nikk's headset that failed without a word (6253: "I heard you when you
   * spoke but I didn't hear you in the recording"), and a tap that half-works
   * can also silence the room. Now the same sound file is decoded here and
   * played into the recording only, starting where the room's playback is,
   * while the room plays it exactly as it always did.
   */
  const speech = new Map<AudioBufferSourceNode, string>();
  let stopped = false;
  const eligible = (actorId: string) => !mutedNow().has(actorId.toLowerCase()) && people().some((person) => person.actorId.toLowerCase() === actorId.toLowerCase() && (person.kind === "human" && includeHumans || person.kind === "agent" && includeAgents));
  const clearSpeech = (node: AudioBufferSourceNode) => {
    try { node.stop(); } catch { /* not started, or already stopped */ }
    try { node.disconnect(); } catch { /* already disconnected */ }
    speech.delete(node);
  };
  const unlisten = listenForRecordedSpeech((speaker, element) => {
    if (stopped || !eligible(speaker) || !element.src) return;
    const decoded = fetch(element.src).then((answer) => answer.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes));
    const begin = () => void decoded.then((buffer) => {
      if (stopped || !eligible(speaker) || element.ended) return;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(destination);
      speech.set(node, speaker);
      node.onended = () => clearSpeech(node);
      node.start(0, Math.min(Math.max(0, element.currentTime), buffer.duration));
      element.addEventListener("pause", () => clearSpeech(node), { once: true });
    }).catch((error: unknown) => console.warn("the recording could not copy a spoken line", error));
    if (!element.paused && element.currentTime > 0) begin();
    else element.addEventListener("playing", begin, { once: true });
  });
  return {
    stream: destination.stream,
    update: (remote, muted) => {
      if (stopped) return;
      for (const [node, speaker] of speech) if (!eligible(speaker)) clearSpeech(node);
      for (const [actorId, attached] of connected) {
        if (!eligible(actorId) || muted.has(actorId.toLowerCase()) || remote.get(actorId) !== attached.stream) {
          attached.node.disconnect(destination);
          connected.delete(actorId);
        }
      }
      for (const [actorId, stream] of remote) {
        if (!eligible(actorId) || muted.has(actorId.toLowerCase()) || connected.has(actorId) || !stream.getAudioTracks().some((track) => track.readyState === "live")) continue;
        const node = context.createMediaStreamSource(stream);
        node.connect(destination);
        connected.set(actorId, { stream, node });
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      unlisten();
      own.disconnect(destination);
      for (const { node } of connected.values()) node.disconnect(destination);
      connected.clear();
      for (const node of [...speech.keys()]) clearSpeech(node);
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
