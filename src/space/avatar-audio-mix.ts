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
  const speech = new Map<MediaElementAudioSourceNode, string>();
  const speechRecorded = new Set<MediaElementAudioSourceNode>();
  let stopped = false;
  const eligible = (actorId: string) => !mutedNow().has(actorId.toLowerCase()) && people().some((person) => person.actorId.toLowerCase() === actorId.toLowerCase() && (person.kind === "human" && includeHumans || person.kind === "agent" && includeAgents));
  const clearSpeech = (node: MediaElementAudioSourceNode) => {
    try { node.disconnect(destination); } catch { /* already disconnected */ }
    try { node.disconnect(context.destination); } catch { /* already disconnected */ }
    speech.delete(node);
    speechRecorded.delete(node);
    if (stopped && speech.size === 0) void context.close();
  };
  const unlisten = listenForRecordedSpeech((speaker, element) => {
    if (stopped || !eligible(speaker)) return;
    try {
      const node = context.createMediaElementSource(element);
      node.connect(destination);
      node.connect(context.destination);
      speech.set(node, speaker);
      speechRecorded.add(node);
      element.addEventListener("ended", () => clearSpeech(node), { once: true });
      element.addEventListener("error", () => clearSpeech(node), { once: true });
    } catch { /* Keep ordinary room playback working if this browser cannot tap it. */ }
  });
  return {
    stream: destination.stream,
    update: (remote, muted) => {
      if (stopped) return;
      for (const [node, speaker] of speech) if (speechRecorded.has(node) && !eligible(speaker)) {
        node.disconnect(destination);
        speechRecorded.delete(node);
      }
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
      for (const node of speechRecorded) node.disconnect(destination);
      speechRecorded.clear();
      destination.stream.getTracks().forEach((track) => track.stop());
      if (!speech.size) void context.close();
    },
  };
}
