import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, VoiceSignal } from "../../shared/space-wire";
import { shouldDial } from "./voice-pairing";

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
 * holds and wrong for thirty; when that day comes the answer is an SFU.
 *
 * WHAT CHANGED, and why. Nikk: "fix voice chat so users can actually chat
 * naturally through the app (and allow for specific users to be muted)".
 *
 *   - LISTENING NEEDS NO MICROPHONE. You used to hear people only after
 *     opening your own, so somebody talking to a room of people who had not
 *     was talking to nobody. Now whoever talks is heard by everyone in the
 *     room; your microphone only decides whether you are heard.
 *   - CANDIDATES THAT ARRIVE EARLY ARE KEPT. A network candidate can reach us
 *     before the offer it belongs to has been applied, and adding it then
 *     throws — which silently lost the path the call needed. They now wait.
 *   - A FAILED CALL IS TRIED AGAIN, a few seconds later, instead of ending the
 *     conversation until somebody switched off and on.
 *   - ANYONE CAN BE MUTED, by you, for you. Remembered in this browser.
 *
 * WHO DIALS whom is `shouldDial`: a talker dials listeners, two talkers use
 * the lower id. The same answer on both machines without either asking.
 */

export type VoiceChat = {
  /** True once your microphone is open and the room has been told. */
  on: boolean;
  /**
   * Everyone's incoming audio, by actor id, for the scene to place where each
   * speaker stands. Also attached to a muted `<audio>` element here: a
   * MediaStream never attached to a media element does not flow in Chrome.
   */
  streams: Map<string, MediaStream>;
  /** Who else has their microphone on. */
  others: string[];
  /** Who you have muted, for yourself only. */
  muted: Set<string>;
  setMuted: (actorId: string, muted: boolean) => void;
  /** Null unless something went wrong, in which case what. */
  trouble: string | null;
  /** Open or close your microphone. Closing it leaves you listening. */
  setOn: (on: boolean) => void;
};

/** Public STUN only. No TURN, so two people behind strict NATs may not connect. */
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

const RETRY_MS = 4_000;
const MUTED_KEY = "saha.voice.muted";

const key = (actorId: string) => actorId.trim().toLowerCase();

function readMuted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(MUTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]).map(key) : []);
  } catch {
    return new Set();
  }
}

export function useVoiceChat(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  you: string | null,
  /** People connected to the room right now — everyone who could be listening. */
  roomPeople: string[],
): VoiceChat {
  const [on, setOnState] = useState(false);
  const [others, setOthers] = useState<string[]>([]);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [trouble, setTrouble] = useState<string | null>(null);
  const [muted, setMutedState] = useState<Set<string>>(() => readMuted());

  const microphone = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  /** Candidates that arrived before the description they belong to. */
  const waiting = useRef(new Map<string, RTCIceCandidateInit[]>());
  const sounds = useRef(new Map<string, HTMLAudioElement>());
  const retries = useRef(new Map<string, number>());
  const live = useRef({ on, you, others, roomPeople });
  live.current = { on, you, others, roomPeople };

  const drop = useCallback((actorId: string) => {
    const id = key(actorId);
    peers.current.get(id)?.close();
    peers.current.delete(id);
    waiting.current.delete(id);
    const sound = sounds.current.get(id);
    if (sound) {
      sound.srcObject = null;
      sound.remove();
      sounds.current.delete(id);
    }
    setStreams((before) => {
      if (![...before.keys()].some((name) => key(name) === id)) return before;
      const next = new Map(before);
      for (const name of [...next.keys()]) if (key(name) === id) next.delete(name);
      return next;
    });
  }, []);

  const dialsTo = useCallback((actorId: string) => {
    const { on: talking, you: me, others: talkers } = live.current;
    if (!me) return false;
    const themTalking = talkers.some((name) => key(name) === key(actorId));
    return shouldDial(me, actorId, talking, themTalking);
  }, []);

  const callRef = useRef<(actorId: string) => Promise<void>>(async () => {});

  const connectionTo = useCallback(
    (actorId: string): RTCPeerConnection => {
      const id = key(actorId);
      const existing = peers.current.get(id);
      if (existing) return existing;
      const peer = new RTCPeerConnection(ICE);
      peers.current.set(id, peer);
      const mine = microphone.current;
      if (mine) for (const track of mine.getTracks()) peer.addTrack(track, mine);
      else peer.addTransceiver("audio", { direction: "recvonly" });

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
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        let sound = sounds.current.get(id);
        if (!sound) {
          sound = document.createElement("audio");
          sound.autoplay = true;
          // Muted on purpose: the scene plays this voice positioned. The element
          // is only here to make the stream flow at all.
          sound.muted = true;
          sounds.current.set(id, sound);
        }
        sound.srcObject = stream;
        setStreams((before) => {
          if (before.get(actorId) === stream) return before;
          const next = new Map(before);
          next.set(actorId, stream);
          return next;
        });
        void sound.play().catch(() => undefined);
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState !== "failed") return;
        drop(actorId);
        // TRY AGAIN rather than giving up on the conversation. Only the side
        // that dials retries, so a retry cannot collide with one from the other.
        if (!dialsTo(actorId)) return;
        const tries = (retries.current.get(id) ?? 0) + 1;
        retries.current.set(id, tries);
        if (tries > 3) {
          setTrouble(`Could not reach ${actorId} after several tries. Their network may block direct calls.`);
          return;
        }
        window.setTimeout(() => {
          if (dialsTo(actorId) && !peers.current.has(id)) void callRef.current(actorId);
        }, RETRY_MS * tries);
      };
      return peer;
    },
    [dialsTo, drop, send],
  );

  const flushWaiting = useCallback(async (actorId: string, peer: RTCPeerConnection) => {
    const id = key(actorId);
    const queued = waiting.current.get(id) ?? [];
    waiting.current.delete(id);
    for (const candidate of queued) {
      await peer.addIceCandidate(candidate).catch(() => undefined);
    }
  }, []);

  const call = useCallback(
    async (actorId: string) => {
      const peer = connectionTo(actorId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({ type: "voice", to: actorId, signal: { kind: "offer", sdp: offer.sdp ?? "" } });
    },
    [connectionTo, send],
  );
  callRef.current = call;

  const handle = useCallback(
    async (from: string, signal: VoiceSignal) => {
      const id = key(from);
      if (signal.kind === "offer") {
        // A fresh offer replaces whatever was there: the other side restarted.
        if (peers.current.has(id)) drop(from);
        const peer = connectionTo(from);
        await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await flushWaiting(from, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: "voice", to: from, signal: { kind: "answer", sdp: answer.sdp ?? "" } });
        return;
      }
      const peer = peers.current.get(id);
      if (signal.kind === "answer") {
        if (!peer) return;
        await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        retries.current.delete(id);
        await flushWaiting(from, peer);
        return;
      }
      const candidate: RTCIceCandidateInit = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid ?? undefined,
        sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
      };
      // EARLY CANDIDATES WAIT for their description instead of being lost.
      if (!peer || !peer.remoteDescription) {
        waiting.current.set(id, [...(waiting.current.get(id) ?? []), candidate]);
        return;
      }
      await peer.addIceCandidate(candidate).catch(() => undefined);
    },
    [connectionTo, drop, flushWaiting, send],
  );

  /** Dial everyone this person should be dialling and is not connected to. */
  const dialEveryone = useCallback(() => {
    const { you: me, roomPeople: people, others: talkers } = live.current;
    if (!me) return;
    const everyone = new Map<string, string>();
    for (const name of [...people, ...talkers]) everyone.set(key(name), name);
    for (const [id, name] of everyone) {
      if (id === key(me) || peers.current.has(id)) continue;
      if (dialsTo(name)) void call(name).catch(() => setTrouble(`Could not call ${name}.`));
    }
  }, [call, dialsTo]);

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "welcome") {
        setOthers(message.voice);
        live.current.others = message.voice;
        dialEveryone();
        return;
      }
      if (message.type === "voicePresence") {
        if (live.current.you && key(message.actorId) === key(live.current.you)) return;
        const next = message.on
          ? live.current.others.some((name) => key(name) === key(message.actorId))
            ? live.current.others
            : [...live.current.others, message.actorId]
          : live.current.others.filter((name) => key(name) !== key(message.actorId));
        live.current.others = next;
        setOthers(next);
        retries.current.delete(key(message.actorId));
        // Their role changed. If the call between us is now mine to make, start
        // it over. If it is theirs, keep what we have: their fresh offer, which
        // follows this announcement on the same socket, replaces it — dropping
        // here would throw away an offer that had already arrived. The one case
        // with nobody to dial is both of us silent, and then there is nothing
        // to keep.
        if (dialsTo(message.actorId)) {
          drop(message.actorId);
          void call(message.actorId).catch(() => undefined);
        } else if (!message.on && !live.current.on) {
          drop(message.actorId);
        }
        return;
      }
      if (message.type === "voice") {
        void handle(message.from, message.signal).catch(() =>
          setTrouble(`Could not set up audio with ${message.from}.`),
        );
      }
    });
  }, [call, dialEveryone, dialsTo, drop, handle, subscribe]);

  // Somebody arrived in the room, or left it.
  const roomKey = roomPeople.map(key).sort().join(",");
  useEffect(() => {
    const present = new Set(roomPeople.map(key));
    for (const id of [...peers.current.keys()]) {
      const stillTalking = live.current.others.some((name) => key(name) === id);
      if (!present.has(id) && !stillTalking) drop(id);
    }
    dialEveryone();
    // roomKey stands in for roomPeople: the same set in a new array is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, dialEveryone, drop]);

  const setOn = useCallback(
    (next: boolean) => {
      setTrouble(null);
      if (!next) {
        for (const track of microphone.current?.getTracks() ?? []) track.stop();
        microphone.current = null;
        live.current.on = false;
        setOnState(false);
        // Every connection carried my microphone; start them over as a listener.
        for (const id of [...peers.current.keys()]) drop(id);
        send({ type: "voicePresence", on: false });
        return;
      }
      void (async () => {
        try {
          microphone.current = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch {
          setTrouble("The microphone was refused, so nobody can hear you.");
          return;
        }
        live.current.on = true;
        setOnState(true);
        // Connections set up while I only listened carry no microphone. Start
        // them over, now as the one talking.
        for (const id of [...peers.current.keys()]) drop(id);
        send({ type: "voicePresence", on: true });
        dialEveryone();
      })();
    },
    [dialEveryone, drop, send],
  );

  const setMuted = useCallback((actorId: string, mute: boolean) => {
    setMutedState((before) => {
      const next = new Set(before);
      if (mute) next.add(key(actorId));
      else next.delete(key(actorId));
      try {
        window.localStorage.setItem(MUTED_KEY, JSON.stringify([...next]));
      } catch {
        // Kept for this visit only.
      }
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      for (const id of [...peers.current.keys()]) drop(id);
      for (const track of microphone.current?.getTracks() ?? []) track.stop();
      microphone.current = null;
    },
    [drop],
  );

  return { on, others, streams, muted, setMuted, trouble, setOn };
}
