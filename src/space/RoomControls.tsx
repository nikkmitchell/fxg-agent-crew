import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { base } from "../router";
import { WRIST_BUTTON, WristButton } from "./Backdrop";
import { createSpeechInput, speechCapabilities, type SpeechInput } from "./speech";
import { planVoice, type VoiceDestination } from "./voice-routing";
import type { VoiceChat } from "./useVoiceChat";

/**
 * The room's controls, in front of you at body level.
 *
 * NOT ON A HAND. Two attempts lived on the left wrist and both were wrong.
 * Nikk, on the first: "almost impossible to use" — three matchbox panels
 * stacked on a hand that is also the thing you point with. On the second, which
 * folded them behind one button: "the UI is terrible... nothing to do with the
 * left hand, we don't want it following that at all."
 *
 * He is right, and the reason is worth writing down so nobody puts it back: to
 * press a button on your own hand you must hold that hand still, look at it,
 * and point at it with the other one. A control that moves whenever you move
 * the limb you aim with is a control you chase. Anything mounted on a hand has
 * to be worth that, and a settings menu is not.
 *
 * So it sits where a belt buckle would: a little in front of you, below your
 * head, following where you are and which way you are facing but NOT your
 * hands and not your head's pitch. Look down and it is there; walk and it comes
 * with you; wave and it does not move at all.
 *
 * WHY IN 3D AT ALL: the page is DOM, and DOM is not composited into an
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

/**
 * Where the panel sits relative to you.
 *
 * `AHEAD` is how far in front, `HEIGHT` is how far off the floor — absolute,
 * not relative to the head, so it stays at your waist whether you are standing
 * or sitting forward. `EASE` is how quickly it catches up when you turn: it
 * lags deliberately, because a panel welded to your gaze can never be looked
 * away from, and one that snaps is worse than one that drifts.
 */
const AHEAD = 0.62;
const HEIGHT = 1.02;
const EASE = 0.12;
/** Past this much turn it starts following. Below it, stay put. */
const SLACK = 0.5;

export function RoomControls({
  /**
   * Where the player is and which way they are facing, read fresh each frame.
   *
   * A function rather than a value: this is read at frame rate and a prop would
   * mean re-rendering the whole panel ninety times a second to move one group.
   */
  anchor,
  /** Who the room thinks you are, for the group-chat line. */
  you,
  /** Which WebHarness room to post into, when there is one. */
  groupRoom,
  passthrough,
  passthroughAvailable,
  blendMode,
  onTogglePassthrough,
  voice,
}: {
  anchor: () => { at: { x: number; z: number }; yaw: number } | null;
  you: string | null;
  groupRoom: string | null;
  passthrough: boolean;
  passthroughAvailable: boolean;
  blendMode: string | null;
  onTogglePassthrough: () => void;
  /** Live voice between people in the room, owned above the session. */
  voice: VoiceChat;
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

  const facing = useRef<number | null>(null);

  /**
   * The panel follows you, driven per frame rather than through React: a head
   * moves at headset frame rate and routing that through state would re-render
   * this tree ninety times a second to move one group.
   *
   * It follows your POSITION immediately and your DIRECTION lazily, and only
   * once you have turned past a few tens of degrees. Turning your head to look
   * at something must not drag the menu across your view — you would never be
   * able to look away from it — but walking away from it and leaving it behind
   * would be worse.
   */
  useFrame(() => {
    const node = group.current;
    const body = anchor();
    if (!node) return;
    node.visible = body !== null;
    if (!body) return;

    if (facing.current === null) facing.current = body.yaw;
    // Shortest way round, so turning past a half-circle does not send the panel
    // the long way about.
    let delta = body.yaw - facing.current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > SLACK) facing.current += delta * EASE;

    const yaw = facing.current;
    node.position.set(
      body.at.x - Math.sin(yaw) * AHEAD,
      HEIGHT,
      body.at.z - Math.cos(yaw) * AHEAD,
    );
    node.rotation.set(0, yaw, 0);
  });

  const step = WRIST_BUTTON.height + WRIST_BUTTON.gap;
  const rows: { label: string; tone?: "normal" | "muted" | "live"; onTap: () => void }[] = [];

  if (!open) {
    // STOP IS ALWAYS ONE TAP, never behind a menu. Inkstone's review: an
    // always-on microphone needs an immediate stop, and "tap to open, then find
    // the right button" is not immediate when what you want is to stop talking
    // to a room. So while it is listening the folded panel IS the stop control,
    // and the settings move to a second row under it.
    if (listening) {
      rows.push({
        label: alwaysOn ? "Stop — sending as you speak" : "Stop listening",
        tone: "live",
        onTap: () => input.current?.stop(),
      });
    }
    rows.push({
      label: listening ? "Settings" : alwaysOn ? "Settings — speech set to auto-send" : "Settings",
      tone: "normal",
      onTap: () => setOpen(true),
    });
  } else {
    rows.push({ label: "Close", onTap: () => setOpen(false) });

    // TALKING OUT LOUD comes first, above dictation, because it is the thing
    // somebody standing next to another person wants: to be heard by them,
    // rather than to have their words typed into a room.
    rows.push({
      label: voice.on
        ? voice.others.length > 0
          ? `Talking — you hear ${voice.others.join(", ")}`
          : "Talking — nobody else has theirs on"
        : "Talk out loud",
      tone: voice.on ? "live" : "normal",
      onTap: () => voice.setOn(!voice.on),
    });

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

  const said = notice ?? voice.trouble;
  if (said) {
    rows.push({ label: said, tone: "muted", onTap: () => setNotice(null) });
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
