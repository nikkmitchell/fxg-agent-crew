import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { base } from "../router";
import { WRIST_BUTTON, WristButton } from "./Backdrop";
import { createSpeechInput, speechCapabilities, type SpeechInput } from "./speech";
import { planVoice, type VoiceDestination } from "./voice-routing";

/**
 * Everything you need on your wrist, behind one button.
 *
 * THE FIRST VERSION PUT THREE PANELS THERE AT ONCE and Nikk's verdict was
 * "almost impossible to use": three targets the size of a matchbox, stacked,
 * riding a hand that is also the thing you point with. So there is one button
 * now — the same one that was already there for passthrough — and everything
 * else unfolds from it when you tap it, and folds away again.
 *
 * WHY ON THE WRIST AT ALL: the page is DOM, and DOM is not composited into an
 * immersive frame. Every control Inkstone built is present and invisible the
 * moment the headset goes on. These are the ones you need while standing up.
 *
 * ALWAYS-ON SPEECH IS OPT-IN AND OFF BY DEFAULT. Nikk asked for it directly —
 * "i want speach to be able to be left just on, so every message after it
 * finishes recording is automatically sent" — and it is genuinely the only way
 * to hold a conversation without a keyboard. It also removes the review step
 * that Inkstone and I agreed on for good reasons: a transcript is a guess, and
 * with the switch set to the group chat it is a guess published under your
 * name. So it is a deliberate choice, made twice (turn the mode on, then turn
 * the microphone on), and the button says what it will do before it does it.
 */

/** Where the panel sits relative to the wrist: above it, tilted toward the face. */
const OFFSET = new THREE.Vector3(0, 0.14, -0.02);

export function WristVoice({
  /** The left wrist in room space, or null when that hand is not tracked. */
  wrist,
  /** Who the room thinks you are, for the group-chat line. */
  you,
  /** Which WebHarness room to post into, when there is one. */
  groupRoom,
  passthrough,
  passthroughAvailable,
  blendMode,
  onTogglePassthrough,
}: {
  wrist: { p: { x: number; y: number; z: number }; q: THREE.Quaternion } | null;
  you: string | null;
  groupRoom: string | null;
  passthrough: boolean;
  passthroughAvailable: boolean;
  blendMode: string | null;
  onTogglePassthrough: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<VoiceDestination>("room");
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<SpeechInput | null>(null);
  const confidence = useRef<number | undefined>(undefined);
  const capabilities = useMemo(() => speechCapabilities(), []);

  // Read by the recognition callbacks, which are created once and would
  // otherwise close over the first value of everything they touch.
  const live = useRef({ alwaysOn, destination, groupRoom, you });
  live.current = { alwaysOn, destination, groupRoom, you };

  const post = useCallback(async (transcript: string) => {
    const { destination: to, groupRoom: room, you: me } = live.current;
    const plan = planVoice(transcript, to, { confidence: confidence.current, speaker: me ?? undefined });
    if (plan.refused) {
      setNotice(plan.refused);
      return;
    }
    setSending(true);
    const failures: string[] = [];
    for (const item of plan.posts) {
      try {
        if (item.to === "room") {
          const response = await fetch(`${base}/bff/space/utterances`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              say: item.say,
              source: "voice",
              ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
            }),
          });
          if (!response.ok) failures.push("the room");
        } else if (!room) {
          failures.push("the group chat (no room)");
        } else {
          const response = await fetch(`${base}/bff/rooms/${encodeURIComponent(room)}/messages`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: item.content }),
          });
          if (!response.ok) failures.push("the group chat");
        }
      } catch {
        failures.push(item.to === "room" ? "the room" : "the group chat");
      }
    }
    setSending(false);
    // NAMED INDIVIDUALLY. Being told your words reached the agents when they
    // did not is the quiet failure this product exists not to have.
    if (failures.length === 0) {
      setHeard("");
      confidence.current = undefined;
      setNotice(to === "room" ? "Sent to the room." : "Sent to the room and the chat.");
    } else {
      setNotice(`Did not reach ${failures.join(" or ")}. Your words are still here.`);
    }
  }, []);

  useEffect(() => {
    if (!capabilities.recognition) return;
    input.current = createSpeechInput({
      onPhase: (phase) => setListening(phase === "listening"),
      onInterim: setHeard,
      onFinal: (result) => {
        setHeard(result.text);
        confidence.current = result.confidence;
        if (live.current.alwaysOn) {
          void post(result.text);
          // Straight back to listening, so a conversation does not need a tap
          // between every sentence. Recognition ends itself on each utterance.
          window.setTimeout(() => input.current?.start(), 250);
        } else {
          setNotice("Tap Send, or speak again.");
        }
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => input.current?.dispose();
  }, [capabilities.recognition, post]);

  // The panel rides the wrist, driven per frame rather than through React: a
  // hand moves at headset frame rate and routing that through state would
  // re-render this tree ninety times a second to move one group.
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    node.visible = wrist !== null;
    if (!wrist) return;
    node.position.set(wrist.p.x, wrist.p.y, wrist.p.z);
    node.quaternion.copy(wrist.q);
    node.translateX(OFFSET.x);
    node.translateY(OFFSET.y);
    node.translateZ(OFFSET.z);
  });

  const step = WRIST_BUTTON.height + WRIST_BUTTON.gap;
  const rows: { label: string; tone?: "normal" | "muted" | "live"; onTap: () => void }[] = [];

  if (!open) {
    rows.push({
      label: listening ? "Listening — tap to open" : "Settings",
      tone: listening ? "live" : "normal",
      onTap: () => setOpen(true),
    });
  } else {
    rows.push({ label: "Close", onTap: () => setOpen(false) });

    rows.push(
      capabilities.recognition
        ? {
            label: listening ? "Stop listening" : alwaysOn ? "Start talking" : "Speak once",
            tone: listening ? "live" : "normal",
            onTap: () => (listening ? input.current?.stop() : input.current?.start()),
          }
        : {
            label: "This headset has no speech recognition",
            tone: "muted",
            onTap: () => setNotice("There is no microphone available to this browser."),
          },
    );

    rows.push({
      label: alwaysOn ? "Sending as you speak" : "Review each one before sending",
      tone: alwaysOn ? "live" : "normal",
      onTap: () => setAlwaysOn((on) => !on),
    });

    rows.push({
      label: destination === "room" ? "To: the room" : "To: the room and the chat",
      onTap: () => setDestination((d) => (d === "room" ? "room-and-agents" : "room")),
    });

    if (!alwaysOn) {
      rows.push({
        label: sending ? "Sending…" : heard ? `Send: ${heard}` : "Nothing heard yet",
        tone: !heard || sending ? "muted" : "normal",
        onTap: () => void post(heard),
      });
    }

    rows.push({
      label: !passthroughAvailable
        ? `No passthrough — this headset says: ${blendMode ?? "nothing yet"}`
        : passthrough
          ? "Passthrough — tap for void"
          : "Black void — tap for passthrough",
      tone: passthroughAvailable ? "normal" : "muted",
      onTap: () => passthroughAvailable && onTogglePassthrough(),
    });
  }

  if (notice) {
    rows.push({ label: notice, tone: "muted", onTap: () => setNotice(null) });
  }

  return (
    <group ref={group} visible={false}>
      {rows.map((row, index) => (
        <WristButton
          key={`${index}-${row.label}`}
          label={row.label}
          tone={row.tone}
          y={-index * step}
          onTap={row.onTap}
        />
      ))}
    </group>
  );
}
