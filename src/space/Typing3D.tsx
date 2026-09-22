import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { CARD_INK } from "../../shared/card-paint";
import { canTranscribe, createSayRecorder, type SayRecorder } from "./say-recorder";
import { openNativeInput, type NativeInput } from "./native-input";
import { claimPointer } from "./pointer-claim";
import { Text } from "@react-three/drei";
import { emptyTyping, press, type Typing } from "../../shared/keyboard-3d";
import { Keyboard3D } from "./Keyboard3D";

/**
 * Write something, in the room.
 *
 * ONE COMPONENT FOR BOTH ROOMS, and both ways of typing at once: the 3D
 * keyboard for a headset, where there is no DOM to type into, and the real
 * keyboard for a desktop, where pretending there isn't one would be silly. A
 * person at a desk can use either and does not have to be told which.
 *
 * WHAT IS BEING WRITTEN IS SHOWN ABOVE THE KEYS. In a headset you cannot glance
 * at a field somewhere else on screen, because there is no somewhere else.
 *
 * THE HARDWARE LISTENER IS ON `window` AND DELIBERATELY GREEDY while this is
 * open: if it is on screen, it is what you are typing into. It stops the keys
 * reaching the walk controls, which would otherwise send you wandering across
 * the room while you wrote a title with a `w` in it.
 *
 * THREE WAYS IN, ONE FIELD. Nikk: "we want to allow for speach to text here, or
 * to use the native text input (so then we can have speach to text on quest)".
 *
 *   the 3D keys        always there, and the only thing that works inside an
 *                      immersive session, where there is no DOM at all
 *   SPEAK              the room already writes speech down — whisper on the box,
 *                      the same path the press-to-speak button uses. This is the
 *                      one that actually suits a headset: no aiming.
 *   system keyboard    a real, focused DOM input. A headset's own keyboard has
 *                      a dictation button on it; ours cannot. Outside an
 *                      immersive session that is the best text entry on the
 *                      device, so it is offered rather than reimplemented.
 *
 * Each is OFFERED ONLY WHEN IT WILL WORK, asked rather than assumed — a control
 * that can only apologise is worse than one that is not there.
 */
export function Typing3D({
  prompt,
  initial = "",
  onDone,
  onCancel,
  position = [0, 0, 0],
  limit = 280,
  scale = 3.2,
}: {
  /** What this is for — "New card in Review", "Comment". */
  prompt: string;
  initial?: string;
  onDone: (text: string) => void;
  onCancel: () => void;
  position?: [number, number, number];
  limit?: number;
  /**
   * How big to draw it, in the parent's units.
   *
   * THE KEYS HAVE TO BE WORTH AIMING AT. The layout is in metres that suit a
   * headset at arm's length — about 63cm across — and hung on a four-metre
   * board that is itself often scaled up, which left the whole keyboard at
   * about a sixth of the board's width and every key a few pixels across. Same
   * mistake as the first "add" control, one component along.
   */
  scale?: number;
}) {
  const [typing, setTyping] = useState<Typing>(() => emptyTyping(initial));
  /** idle, listening, or waiting for the words to come back. */
  const [phase, setPhase] = useState<"idle" | "recording" | "writing">("idle");
  /**
   * ASKED, NOT ASSUMED. The button must not replace a working keyboard with a
   * recorder that can only apologise — the same rule the room's press-to-speak
   * button already follows.
   */
  const [canSpeak, setCanSpeak] = useState(false);
  const recorder = useRef<SayRecorder | null>(null);
  const native = useRef<NativeInput | null>(null);
  /**
   * The latest text, for the key handler.
   *
   * THE CLOSURE IS NOT GOOD ENOUGH HERE. Keys can arrive faster than React
   * re-renders — a paste, a fast typist, or a test driving the keyboard — and
   * every handler in such a burst closes over the SAME `typing`. The letters
   * survived that, because they use the functional form of `setTyping`; Enter
   * did not, because it built `{ ...typing, done: true }` from the stale value.
   * So a title typed quickly and saved with Enter arrived EMPTY, and an empty
   * title means "changed my mind" — the card was silently never made.
   */
  const latest = useRef(typing);
  latest.current = typing;

  useEffect(() => {
    let live = true;
    void canTranscribe().then((yes) => {
      if (live) setCanSpeak(yes);
    });
    return () => {
      live = false;
    };
  }, []);

  // Let go of the microphone and the DOM input when this closes. A held
  // microphone is a light on somebody's headset; a stray focused input steals
  // every key in the room.
  useEffect(
    () => () => {
      recorder.current?.dispose();
      native.current?.close();
    },
    [],
  );

  const settle = (next: Typing) => {
    if (next.cancelled) return onCancel();
    if (next.done) {
      const text = next.text.trim();
      // AN EMPTY TITLE IS A CANCEL, not a card called "". Pressing done on an
      // empty field means you changed your mind.
      return text ? onDone(text) : onCancel();
    }
    setTyping(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /**
       * A REAL TEXT FIELD ON THE PAGE WINS.
       *
       * This listener is deliberately greedy, and greedy was one step too far:
       * the room's own page has a "write to the room" box beside the canvas, and
       * while a card was being named every letter typed into that box was being
       * swallowed here instead. Somebody would be mid-sentence to the room and
       * watch their words vanish into a card title they could not see.
       */
      const focused = document.activeElement;
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return onCancel();
      if (event.key === "Enter") return settle({ ...latest.current, done: true });
      if (event.key === "Backspace") {
        setTyping((t) => {
          const next = { ...t, text: t.text.slice(0, -1) };
          latest.current = next;
          return next;
        });
        return;
      }
      if (event.key.length !== 1) return;
      setTyping((t) => {
        const next = t.text.length >= limit ? t : { ...t, text: t.text + event.key };
        latest.current = next;
        return next;
      });
    };
    // Capture, so this wins over the room's own walk and look handlers.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const write = useCallback((words: string) => {
    const text = words.trim();
    if (!text) return;
    setTyping((t) => {
      // APPENDED, NOT REPLACED. Somebody who typed half a title and then spoke
      // the rest meant both halves.
      const joined = t.text ? `${t.text} ${text}` : text;
      const next = { ...t, text: joined.slice(0, limit) };
      latest.current = next;
      return next;
    });
  }, [limit]);

  const speak = useCallback(() => {
    if (!recorder.current) {
      recorder.current = createSayRecorder({ onPhase: setPhase, onTrouble: () => setPhase("idle") });
    }
    const it = recorder.current;
    if (it.recording()) {
      void it.finish().then(write).catch(() => setPhase("idle"));
      return;
    }
    void it.start().catch(() => setPhase("idle"));
  }, [write]);

  const useSystemKeyboard = useCallback(() => {
    native.current?.close();
    native.current = openNativeInput({
      value: latest.current.text,
      label: prompt,
      onChange: (text) => {
        setTyping((t) => {
          const next = { ...t, text };
          latest.current = next;
          return next;
        });
      },
      onDone: (text) => {
        native.current = null;
        const trimmed = text.trim();
        if (trimmed) onDone(trimmed);
        else onCancel();
      },
      onCancel: () => {
        native.current = null;
      },
    });
  }, [onCancel, onDone, prompt]);

  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.16, -0.006]}>
        <planeGeometry args={[0.72, 0.2]} />
        <meshBasicMaterial color="#14161d" transparent opacity={0.94} toneMapped={false} />
      </mesh>
      <Text position={[-0.33, 0.225, 0]} fontSize={0.028} color="#9a978f" anchorX="left" anchorY="middle">
        {prompt}
      </Text>
      <Text
        position={[-0.33, 0.17, 0]}
        fontSize={0.036}
        color="#f2efe6"
        anchorX="left"
        anchorY="middle"
        maxWidth={0.66}
      >
        {/* A caret, so an empty field looks ready rather than broken. */}
        {`${typing.text}▏`}
      </Text>
      <Text position={[0.33, 0.1, 0]} fontSize={0.022} color="#6f6b63" anchorX="right" anchorY="middle">
        {`${typing.text.length}/${limit} · done to save, esc to drop it`}
      </Text>
      {/*
        THE TWO WAYS IN THAT ARE NOT KEYS. Side by side above the keyboard,
        because they are alternatives to it rather than part of it.
      */}
      <WayIn
        x={-0.18}
        shown={canSpeak}
        label={phase === "recording" ? "listening — press to stop" : phase === "writing" ? "writing it down…" : "speak"}
        lit={phase !== "idle"}
        onPress={speak}
      />
      <WayIn x={0.18} shown label="system keyboard" onPress={useSystemKeyboard} />

      <Keyboard3D typing={typing} onChange={settle} position={[0, -0.09, 0]} />
    </group>
  );
}

export { press };

/**
 * One of the alternatives to the keys.
 *
 * Deliberately plain: these are not keys, and making them look like keys would
 * invite somebody to hunt for them among the letters.
 */
function WayIn({
  x,
  label,
  shown,
  lit = false,
  onPress,
}: {
  x: number;
  label: string;
  shown: boolean;
  lit?: boolean;
  onPress: () => void;
}) {
  if (!shown) return null;
  return (
    <group position={[x, -0.035, 0]}>
      <mesh
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          onPress();
        }}
      >
        <planeGeometry args={[0.33, 0.045]} />
        <meshBasicMaterial color={lit ? CARD_INK.accent : "#2b3245"} toneMapped={false} />
      </mesh>
      <Text position={[0, 0, 0.002]} fontSize={0.022} color="#e9e6de" anchorX="center" anchorY="middle" maxWidth={0.3}>
        {label}
      </Text>
    </group>
  );
}
