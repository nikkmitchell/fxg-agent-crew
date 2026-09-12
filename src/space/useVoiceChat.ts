import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, VoiceSignal } from "../../shared/space-wire";

/**
 * Hearing each other, in the room.
 *
 * A DIRECT CONNECTION BETWEEN BROWSERS. The audio never touches saha.ing — the
 * server copies a few kilobytes of setup between two people and then gets out
 * of the way. That is not an optimisation: the box has 1.6GB of memory and is
 * already running a headless Chrome for the panel photographs, and mixing
 * everybody's audio on it is not something it could do.
 *
 * A MESH, one connection per pair. Fine for the handful of people this room
 * holds and wrong for thirty; when that day comes the answer is an SFU, and it
 * will be obvious because the room will start getting hot. Said here so that
 * nobody has to rediscover the limit from a laptop fan.
 *
 * WHO CALLS WHOM IS DECIDED BY NAME. Both ends learn about each other at the
 * same moment, and if both offer at once the connection collapses — so the one
 * whose actor id sorts lower makes the call and the other waits. Arbitrary, but
 * it is the same answer on both machines, which is the only property that
 * matters.
 *
 * NOTHING HAPPENS UNTIL YOU SWITCH IT ON. No microphone is opened, no
 * connection is offered, and nobody is told anything, because a room that could
 * start listening on its own is a room you would be right not to stand in.
 */

export type VoiceChat = {
  /** True once the microphone is open and the room has been told. */
  on: boolean;
  /**
   * Everyone's incoming audio, by actor id.
   *
   * Handed out so the scene can put each voice where its speaker is standing.
   * The streams are ALSO attached to a muted `<audio>` element inside this
   * hook, and that is not redundant: a MediaStream that is never attached to a
   * media element does not flow in Chrome, so without it the positioned audio
   * would be silence with no error anywhere.
   */
  streams: Map<string, MediaStream>;
  /** Who else has their microphone on. */
  others: string[];
  /** Null unless something went wrong, in which case what. */
  trouble: string | null;
  /** Turn it on, or off. Off closes every connection and the microphone. */
  setOn: (on: boolean) => void;
};

/** Public STUN only. No TURN, so two people behind strict NATs may not connect. */
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export function useVoiceChat(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  you: string | null,
): VoiceChat {
  const [on, setOnState] = useState(false);
  const [others, setOthers] = useState<string[]>([]);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [trouble, setTrouble] = useState<string | null>(null);

  const microphone = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const sounds = useRef(new Map<string, HTMLAudioElement>());
  const live = useRef({ on, you });
  live.current = { on, you };

  const drop = useCallback((actorId: string) => {
    peers.current.get(actorId)?.close();
    peers.current.delete(actorId);
    const sound = sounds.current.get(actorId);
    if (sound) {
      sound.srcObject = null;
      sound.remove();
      sounds.current.delete(actorId);
    }
    setStreams((before) => {
      if (!before.has(actorId)) return before;
      const next = new Map(before);
      next.delete(actorId);
      return next;
    });
  }, []);

  const connectionTo = useCallback(
    (actorId: string): RTCPeerConnection => {
      const existing = peers.current.get(actorId);
      if (existing) return existing;

      const peer = new RTCPeerConnection(ICE);
      peers.current.set(actorId, peer);

      for (const track of microphone.current?.getTracks() ?? []) {
        peer.addTrack(track, microphone.current as MediaStream);
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        send({
          type: "voice",
          to: actorId,
          signal: {
            kind: "candidate",
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      };

      peer.ontrack = (event) => {
        // PLAYED THROUGH AN <audio> ELEMENT, which is not as redundant as it
        // looks: a MediaStream that is never attached to a media element does
        // not flow in Chrome, so even a future spatialised version has to keep
        // this. Muted output would be silence with no error anywhere.
        const stream = event.streams[0] ?? null;
        let sound = sounds.current.get(actorId);
        if (!sound) {
          sound = document.createElement("audio");
          sound.autoplay = true;
          // MUTED, and still necessary. The element is what makes the stream
          // flow at all in Chrome; the sound you actually hear is placed in the
          // room by SpatialVoices. Unmuting this would play every voice a
          // second time, flat and from nowhere.
          sound.muted = true;
          sounds.current.set(actorId, sound);
        }
        sound.srcObject = stream;
        if (stream) {
          setStreams((before) => {
            if (before.get(actorId) === stream) return before;
            const next = new Map(before);
            next.set(actorId, stream);
            return next;
          });
        }
        void sound.play().catch(() => {
          // Autoplay refused. It cannot be: this only ever runs after the
          // person pressed a button to turn their own microphone on, which is
          // the gesture browsers require. Reported rather than swallowed in
          // case some headset browser disagrees.
          setTrouble("This browser would not play the room's audio.");
        });
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          // Named, because the usual cause is two strict NATs and no TURN
          // server, and "voice does not work" is not something anybody can act
          // on while wearing a headset.
          setTrouble(`Could not reach ${actorId}. You will not hear each other.`);
          drop(actorId);
        }
      };

      return peer;
    },
    [drop, send],
  );

  const call = useCallback(
    async (actorId: string) => {
      const peer = connectionTo(actorId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({ type: "voice", to: actorId, signal: { kind: "offer", sdp: offer.sdp ?? "" } });
    },
    [connectionTo, send],
  );

  const handle = useCallback(
    async (from: string, signal: VoiceSignal) => {
      const peer = connectionTo(from);
      if (signal.kind === "offer") {
        await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: "voice", to: from, signal: { kind: "answer", sdp: answer.sdp ?? "" } });
        return;
      }
      if (signal.kind === "answer") {
        await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        return;
      }
      // An empty candidate is end-of-candidates and must still be delivered.
      await peer.addIceCandidate(
        signal.candidate
          ? {
              candidate: signal.candidate,
              sdpMid: signal.sdpMid ?? undefined,
              sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
            }
          : undefined,
      );
    },
    [connectionTo, send],
  );

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "welcome") {
        // Who was already talking before we arrived. Without this, only people
        // who switch their microphone on while you are watching are ever
        // audible — so the first person to turn theirs on is inaudible to
        // everybody who came later, which is most people.
        setOthers(message.voice);
        const me = live.current.you ?? message.you;
        if (live.current.on) {
          for (const actorId of message.voice) if (me < actorId) void call(actorId);
        }
        return;
      }
      if (message.type === "voicePresence") {
        if (message.actorId === live.current.you) return;
        setOthers((before) =>
          message.on
            ? before.includes(message.actorId)
              ? before
              : [...before, message.actorId]
            : before.filter((id) => id !== message.actorId),
        );
        if (!message.on) {
          drop(message.actorId);
          return;
        }
        // Both ends hear about each other at the same moment. The lower id
        // calls; the other waits, or the two offers cross and collapse.
        const me = live.current.you;
        if (live.current.on && me && me < message.actorId) void call(message.actorId);
        return;
      }
      if (message.type === "voice") {
        if (!live.current.on) return;
        void handle(message.from, message.signal).catch(() =>
          setTrouble(`Could not set up audio with ${message.from}.`),
        );
      }
    });
  }, [call, drop, handle, subscribe]);

  const setOn = useCallback(
    (next: boolean) => {
      setTrouble(null);
      if (!next) {
        for (const actorId of [...peers.current.keys()]) drop(actorId);
        for (const track of microphone.current?.getTracks() ?? []) track.stop();
        microphone.current = null;
        setOnState(false);
        send({ type: "voicePresence", on: false });
        return;
      }
      void (async () => {
        try {
          microphone.current = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch {
          setTrouble("The microphone was refused, so nobody can hear you.");
          return;
        }
        setOnState(true);
        // Announced only AFTER the microphone is actually open. Telling the
        // room first would have people calling a caller with nothing to send.
        send({ type: "voicePresence", on: true });
      })();
    },
    [drop, send],
  );

  // Everything stops when this unmounts: leaving a microphone open after
  // somebody navigates away is the worst possible failure for this feature.
  useEffect(
    () => () => {
      for (const actorId of [...peers.current.keys()]) drop(actorId);
      for (const track of microphone.current?.getTracks() ?? []) track.stop();
      microphone.current = null;
    },
    [drop],
  );

  return { on, others, streams, trouble, setOn };
}
