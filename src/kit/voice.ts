import type { KitPerson, KitSignal } from "../../shared/space-kit";
import { shouldDial } from "../space/voice-pairing";
import type { SahaRoom } from "./connect";

/**
 * VOICE IN A SPACE, the way saha.ing's room does it (src/space/useVoiceChat.ts):
 * a direct call between browsers, set up by a few small messages the server
 * passes along and nothing more; the same relay (STUN/TURN) for networks that
 * block direct calls; and saha.ing's own rule for who calls whom
 * (voice-pairing.ts): somebody talking calls everyone, two people talking
 * call once between them.
 *
 * LISTENING IS AUTOMATIC; TALKING IS A CHOICE. Your microphone stays off
 * until you turn it on (the badge button, or the wrist menu in VR).
 *
 * A space page on saha.ing's own address runs sandboxed, and a sandboxed page
 * is refused the microphone ("Invalid security origin"). Then talking says so,
 * and listening still works.
 */

export type Voice = {
  /** Turn your microphone on or off. Resolves false with a reason when it cannot. */
  setTalking(on: boolean): Promise<{ ok: true } | { ok: false; why: string }>;
  talking(): boolean;
  /** Why talking is not possible here, or null. */
  blocked(): string | null;
  dispose(): void;
};

const RETRY_MS = 2000;

export function createVoice(room: SahaRoom, options: { server: string; send: (message: unknown) => void; onSignal: (listener: (from: string, signal: KitSignal) => void) => void }): Voice {
  const peers = new Map<string, RTCPeerConnection>();
  const sounds = new Map<string, HTMLAudioElement>();
  const waiting = new Map<string, RTCIceCandidateInit[]>();
  const retries = new Map<string, number>();
  let microphone: MediaStream | null = null;
  let ice: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.miwifi.com:3478", "stun:stun.l.google.com:19302"] }] };
  const opaque = typeof self !== "undefined" && self.origin === "null";
  const blockedWhy = opaque
    ? "Talking needs the space on its own address (spaces.saha.ing); here you can listen."
    : typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia
      ? "This browser cannot use a microphone here."
      : null;

  // The relay, with the ticket (TURN credentials are for people in the space).
  if (room.ticket) {
    fetch(`${options.server}/bff/spaces/${encodeURIComponent(room.space)}/ice?ticket=${encodeURIComponent(room.ticket)}`)
      .then((answer) => (answer.ok ? answer.json() : null))
      .then((body: { iceServers?: RTCIceServer[] } | null) => {
        if (body?.iceServers?.length) ice = { iceServers: body.iceServers };
      })
      .catch(() => undefined);
  }

  const me = () => room.you?.id ?? "";
  const dialsTo = (them: KitPerson) => shouldDial(me(), them.id, microphone !== null, them.voice === true);

  const drop = (id: string) => {
    peers.get(id)?.close();
    peers.delete(id);
    const sound = sounds.get(id);
    if (sound) {
      sound.srcObject = null;
      sounds.delete(id);
    }
    waiting.delete(id);
  };

  const connectionTo = (id: string): RTCPeerConnection => {
    const existing = peers.get(id);
    if (existing) return existing;
    const peer = new RTCPeerConnection(ice);
    peers.set(id, peer);
    if (microphone) for (const track of microphone.getTracks()) peer.addTrack(track, microphone);
    else peer.addTransceiver("audio", { direction: "recvonly" });
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      options.send({
        t: "signal",
        to: id,
        s: { kind: "candidate", candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex },
      });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      let sound = sounds.get(id);
      if (!sound) {
        sound = document.createElement("audio");
        sound.autoplay = true;
        sounds.set(id, sound);
      }
      sound.srcObject = stream;
      void sound.play().catch(() => {
        // A browser will not play sound before a first tap: try again on it.
        addEventListener("pointerdown", () => void sound?.play().catch(() => undefined), { once: true });
      });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState !== "failed") return;
      drop(id);
      const them = room.people.get(id);
      if (!them || !dialsTo(them)) return;
      const tries = (retries.get(id) ?? 0) + 1;
      retries.set(id, tries);
      if (tries <= 3) setTimeout(() => void call(id), RETRY_MS * tries);
    };
    return peer;
  };

  const call = async (id: string) => {
    const peer = connectionTo(id);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    options.send({ t: "signal", to: id, s: { kind: "offer", sdp: offer.sdp ?? "" } });
  };

  const flush = async (id: string, peer: RTCPeerConnection) => {
    for (const candidate of waiting.get(id) ?? []) await peer.addIceCandidate(candidate).catch(() => undefined);
    waiting.delete(id);
  };

  options.onSignal(async (from, signal) => {
    if (signal.kind === "offer") {
      if (peers.has(from)) {
        const queued = waiting.get(from);
        drop(from);
        if (queued?.length) waiting.set(from, queued);
      }
      const peer = connectionTo(from);
      await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      await flush(from, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      options.send({ t: "signal", to: from, s: { kind: "answer", sdp: answer.sdp ?? "" } });
    } else if (signal.kind === "answer") {
      const peer = peers.get(from);
      if (!peer) return;
      await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp }).catch(() => undefined);
      await flush(from, peer);
    } else {
      const candidate = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
      const peer = peers.get(from);
      if (peer?.remoteDescription) await peer.addIceCandidate(candidate).catch(() => undefined);
      else waiting.set(from, [...(waiting.get(from) ?? []), candidate]);
    }
  });

  // Keep the calls matching who is here and who is talking.
  const settle = () => {
    for (const them of room.others()) {
      if (!peers.has(them.id) && dialsTo(them)) void call(them.id);
    }
    for (const id of peers.keys()) if (!room.people.has(id)) drop(id);
  };
  room.on("people", settle);

  const redial = () => {
    for (const id of [...peers.keys()]) drop(id);
    settle();
  };

  return {
    async setTalking(on) {
      if (on && blockedWhy) return { ok: false, why: blockedWhy };
      if (on && !microphone) {
        try {
          microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (error) {
          return { ok: false, why: `The microphone was refused: ${(error as Error).message}` };
        }
      } else if (!on && microphone) {
        for (const track of microphone.getTracks()) track.stop();
        microphone = null;
      }
      options.send({ t: "voice", on: microphone !== null });
      // Calls carry a microphone from their start, so starting or stopping means calling again.
      redial();
      return { ok: true };
    },
    talking: () => microphone !== null,
    blocked: () => blockedWhy,
    dispose() {
      for (const id of [...peers.keys()]) drop(id);
      for (const track of microphone?.getTracks() ?? []) track.stop();
      microphone = null;
    },
  };
}
