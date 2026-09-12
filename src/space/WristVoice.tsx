import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { base } from "../router";
import { makeLabelTexture } from "./label-texture";
import { createSpeechInput, speechCapabilities, type SpeechInput } from "./speech";
import { planVoice, type VoiceDestination } from "./voice-routing";

/**
 * Talking, from inside the headset.
 *
 * Nikk: "lets make it jus float over the left hand, and I can set it so that my
 * audio is sent to people in the room, or also to agents... and i need to be
 * able to access these while in webXR. that is the key space where people will
 * be using the immersive room."
 *
 * WHY THIS EXISTS AT ALL, rather than the controls on the page: the page is
 * DOM, and DOM is not composited into an immersive frame. Every control
 * Inkstone built is there and invisible the moment you put the headset on. So
 * the parts you need while standing in the room are rebuilt here in 3D: a
 * microphone, a switch for who hears it, and the words it heard.
 *
 * IT STILL WAITS FOR YOU TO SEND IT. Inkstone's rule — recognition never sends
 * on its own — matters more here, not less: a transcript is a guess, this one
 * can go to the group chat under your name, and you cannot hear what actually
 * went out. The review step is one pinch instead of a text box, which is the
 * most a headset allows, and it is not optional.
 *
 * WHAT I CANNOT VERIFY: whether the Web Speech API works at all inside an
 * immersive session on a Quest or an Aura. The JavaScript keeps running, and
 * microphone permission belongs to the page rather than the session, so it
 * should. Nobody has tried it. If the microphone button does nothing, that is
 * the first thing to suspect and it is worth telling me rather than working
 * around.
 */

/** Where the panel sits relative to the wrist: above it, tilted toward the face. */
const OFFSET = new THREE.Vector3(0, 0.14, -0.02);
const PANEL = { width: 0.26, height: 0.075 } as const;

type Row = { key: string; label: string; onTap: () => void; muted?: boolean };

function Button({
  row,
  y,
  width = PANEL.width,
}: {
  row: Row;
  y: number;
  width?: number;
}) {
  const label = useMemo(
    () => makeLabelTexture(row.label, { pixelsPerLine: 40, lines: 2 }),
    [row.label],
  );
  return (
    <group position={[0, y, 0]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          row.onTap();
        }}
      >
        <planeGeometry args={[width, PANEL.height]} />
        <meshBasicMaterial
          color={row.muted ? "#2a2f3a" : "#1b2231"}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {label ? (
        <mesh position={[0, 0, 0.001]} raycast={() => null}>
          <planeGeometry args={[width, PANEL.height]} />
          <meshBasicMaterial map={label} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

export function WristVoice({
  /** The left wrist in room space, or null when that hand is not tracked. */
  wrist,
  /** Who the room thinks you are, for the group-chat line. */
  you,
  /** Which WebHarness room to post into, when there is one. */
  groupRoom,
}: {
  wrist: { p: { x: number; y: number; z: number }; q: THREE.Quaternion } | null;
  you: string | null;
  groupRoom: string | null;
}) {
  const group = useRef<THREE.Group>(null);
  const [destination, setDestination] = useState<VoiceDestination>("room");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<SpeechInput | null>(null);
  const capabilities = useMemo(() => speechCapabilities(), []);

  useEffect(() => {
    if (!capabilities.recognition) return;
    input.current = createSpeechInput({
      onPhase: (phase) => setListening(phase === "listening"),
      onInterim: (text) => setHeard(text),
      onFinal: (result) => {
        setHeard(result.text);
        confidence.current = result.confidence;
        setNotice("Pinch Send, or speak again.");
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => input.current?.dispose();
  }, [capabilities.recognition]);

  const confidence = useRef<number | undefined>(undefined);

  const send = useCallback(() => {
    if (sending) return;
    const plan = planVoice(heard, destination, {
      confidence: confidence.current,
      speaker: you ?? undefined,
    });
    if (plan.refused) {
      setNotice(plan.refused);
      return;
    }
    setSending(true);
    void (async () => {
      const failures: string[] = [];
      for (const post of plan.posts) {
        try {
          if (post.to === "room") {
            const response = await fetch(`${base}/bff/space/utterances`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                say: post.say,
                source: "voice",
                ...(post.confidence !== undefined ? { confidence: post.confidence } : {}),
              }),
            });
            if (!response.ok) failures.push("the room");
          } else {
            if (!groupRoom) {
              failures.push("the group chat (no room)");
              continue;
            }
            const response = await fetch(
              `${base}/bff/rooms/${encodeURIComponent(groupRoom)}/messages`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: post.content }),
              },
            );
            if (!response.ok) failures.push("the group chat");
          }
        } catch {
          failures.push(post.to === "room" ? "the room" : "the group chat");
        }
      }
      setSending(false);
      // NAMED INDIVIDUALLY. "Sent" when both landed, and when one did not, WHICH
      // one — being told your words reached the agents when they did not is the
      // kind of quiet failure this product exists to not have.
      if (failures.length === 0) {
        setHeard("");
        confidence.current = undefined;
        setNotice(destination === "room" ? "Sent to the room." : "Sent to the room and the chat.");
      } else {
        setNotice(`Did not reach ${failures.join(" or ")}. Your words are still here.`);
      }
    })();
  }, [destination, groupRoom, heard, sending, you]);

  // The panel rides the wrist. Driven per frame rather than through React,
  // because a hand moves at headset frame rate and routing that through state
  // would re-render this tree ninety times a second to move one group.
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

  const rows: Row[] = [
    capabilities.recognition
      ? {
          key: "mic",
          label: listening ? "Listening — pinch to stop" : "Speak",
          onTap: () => (listening ? input.current?.stop() : input.current?.start()),
        }
      : {
          key: "mic",
          label: "This headset has no speech recognition",
          onTap: () => setNotice("There is no microphone available to this browser."),
          muted: true,
        },
    {
      key: "to",
      label: destination === "room" ? "To: the room" : "To: the room and the chat",
      onTap: () =>
        setDestination((current) => (current === "room" ? "room-and-agents" : "room")),
    },
    {
      key: "send",
      label: sending ? "Sending…" : heard ? `Send: ${heard}` : "Nothing heard yet",
      onTap: send,
      muted: !heard || sending,
    },
  ];

  return (
    <group ref={group} visible={false}>
      {rows.map((row, index) => (
        <Button key={row.key} row={row} y={-index * (PANEL.height + 0.012)} />
      ))}
      {notice ? (
        <Button
          key="notice"
          row={{ key: "notice", label: notice, onTap: () => setNotice(null), muted: true }}
          y={-rows.length * (PANEL.height + 0.012)}
        />
      ) : null}
    </group>
  );
}
