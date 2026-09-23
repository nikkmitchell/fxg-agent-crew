import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { CARD_INK } from "../../shared/card-paint";
import { canTranscribe, createSayRecorder, type SayRecorder } from "./say-recorder";
import { openNativeInput, type NativeInput } from "./native-input";
import { claimPointer } from "./pointer-claim";
import { Text } from "@react-three/drei";
import { emptyTyping, press, type Key, type Typing } from "../../shared/keyboard-3d";
import { backspaceIn, charAtPoint, dictateInto, tapAt, typeInto, type DraftEdit, type Span } from "../../shared/draft-edit";

/** What is being typed, plus where: a caret, and a word selected by tapping it (shared/draft-edit.ts). */
type Editing = Typing & { caret: number; selected: Span | null };

const atEnd = (text: string): Editing => ({ ...emptyTyping(text), caret: text.length, selected: null });
const draftOf = (t: Editing): DraftEdit => ({ text: t.text, caret: t.caret, selected: t.selected });

/**
 * The text grows UPWARD from just above the buttons, and the panel with it, so
 * a long spoken message is all visible and never runs into the keys. A card
 * title looks as it always did: one line where the one line always was.
 */
const TEXT_BOTTOM = 0.1485;
const PANEL_BOTTOM = 0.06;
/** Smaller type for a long message, so a spoken paragraph fits at arm's length. */
const textSize = (length: number) => (length <= 120 ? 0.036 : Math.max(0.022, 0.036 * Math.sqrt(120 / length)));
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
  const [typing, setTyping] = useState<Editing>(() => atEnd(initial));
  /** How tall the text came out, as troika laid it out — the panel is sized to it. */
  const [textHeight, setTextHeight] = useState(0.043);
  /** Where troika put each character, for the band behind a lit word. */
  const [layout, setLayout] = useState<ArrayLike<number> | null>(null);
  const shown = useRef<THREE.Mesh & { textRenderInfo?: { caretPositions?: ArrayLike<number> } }>(null);
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

  /**
   * Every change to the words goes through here: a key, ⌫, speech, from the 3D
   * keys or the real keyboard alike. Functional, and through `latest`, for the
   * same reason as above — a burst of keys must never edit a stale draft.
   */
  const edit = useCallback((change: (draft: DraftEdit) => DraftEdit, releaseShift = false) => {
    setTyping((t) => {
      const d = change(draftOf(t));
      const next: Editing = { ...t, text: d.text, caret: d.caret, selected: d.selected, shifted: releaseShift ? false : t.shifted };
      latest.current = next;
      return next;
    });
  }, []);

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

  const settle = (next: Editing) => {
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
      if (event.key === "Backspace") return edit((d) => backspaceIn(d));
      if (event.key.length !== 1) return;
      edit((d) => typeInto(d, event.key, limit));
    };
    // Capture, so this wins over the room's own walk and look handlers.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const write = useCallback((words: string) => {
    // APPENDED at the end, as it always was: somebody who typed half a title
    // and then spoke the rest meant both halves. With a word selected, it
    // REPLACES that word — saying it again is how a misheard word is fixed.
    edit((d) => dictateInto(d, words, limit));
  }, [edit, limit]);

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
    /**
     * OPENED EMPTY, AND WHAT IT TAKES DOWN GOES WHERE THE CARET OR THE LIT
     * WORD IS. It used to be handed the whole text — and inside a headset's
     * session Meta documents that the first key press of each keyboard session
     * "overwrites the entire existing value" (system-keyboard.ts), so one key
     * would wipe a spoken paragraph. The input is also one invisible pixel, so
     * editing inside it was blind anyway. This way the keyboard's own
     * microphone can re-dictate one tapped word.
     */
    const base = draftOf(latest.current);
    const merged = (typed: string): DraftEdit =>
      !typed ? base : base.selected ? typeInto(base, typed, limit) : dictateInto(base, typed, limit);
    native.current = openNativeInput({
      value: "",
      label: prompt,
      onChange: (typed) => {
        const d = merged(typed);
        setTyping((t) => {
          const next: Editing = { ...t, text: d.text, caret: d.caret, selected: d.selected };
          latest.current = next;
          return next;
        });
      },
      onDone: (typed) => {
        native.current = null;
        const trimmed = merged(typed).text.trim();
        if (trimmed) onDone(trimmed);
        else onCancel();
      },
      onCancel: () => {
        native.current = null;
      },
    });
  }, [limit, onCancel, onDone, prompt]);

  /**
   * THE WHOLE TEXT, with a caret where typing will go — or, when a word has
   * been tapped, that word lit instead. A caret inside the text is a character
   * of the display, so a tap after it maps back one place.
   */
  const caretAt = typing.selected ? null : Math.max(0, Math.min(typing.caret, typing.text.length));
  const display = caretAt === null ? typing.text : `${typing.text.slice(0, caretAt)}▏${typing.text.slice(caretAt)}`;
  /**
   * THE LIT WORD, as a band behind it rather than a colour on it: troika's
   * colorRanges drew the word DARKER than its neighbours on this material,
   * which reads as "gone" rather than "chosen". The band comes from the same
   * character layout the tap is read from, so it sits exactly on the word.
   */
  const band = (() => {
    const chosen = typing.selected;
    if (!chosen || !layout || layout.length < chosen.end * 4) return null;
    const left = layout[chosen.start * 4];
    const right = layout[(chosen.end - 1) * 4 + 1];
    const bottom = layout[chosen.start * 4 + 2];
    const top = layout[chosen.start * 4 + 3];
    return { x: (left + right) / 2, y: (bottom + top) / 2, width: Math.abs(right - left) + 0.012, height: Math.abs(top - bottom) + 0.006 };
  })();
  const promptY = Math.max(0.225, TEXT_BOTTOM + textHeight + 0.034);
  const panelTop = promptY + 0.035;

  const tapText = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    const mesh = shown.current;
    const layout = mesh?.textRenderInfo?.caretPositions;
    if (!mesh || !layout) return;
    const local = mesh.worldToLocal(event.point.clone());
    const at = charAtPoint(layout, local.x, local.y);
    if (at === null) return;
    const index = caretAt !== null && at > caretAt ? at - 1 : at;
    setTyping((t) => {
      const d = tapAt(draftOf(t), Math.min(index, t.text.length));
      const next: Editing = { ...t, caret: d.caret, selected: d.selected };
      latest.current = next;
      return next;
    });
  };

  const onKey = (key: Key) => {
    switch (key.action) {
      case "backspace":
        return edit((d) => backspaceIn(d));
      case "space":
        return edit((d) => typeInto(d, " ", limit));
      case "shift":
      case "symbols":
      case "enter":
      case "cancel":
        return settle(press(latest.current, key) as Editing);
      default:
        return edit((d) => typeInto(d, key.value, limit), true);
    }
  };

  return (
    <group position={position} scale={scale}>
      <mesh position={[0, (PANEL_BOTTOM + panelTop) / 2, -0.006]}>
        <planeGeometry args={[0.72, panelTop - PANEL_BOTTOM]} />
        <meshBasicMaterial color="#14161d" transparent opacity={0.94} toneMapped={false} />
      </mesh>
      <Text position={[-0.33, promptY, 0]} fontSize={0.028} color="#9a978f" anchorX="left" anchorY="middle">
        {prompt}
      </Text>
      <Text
        ref={shown}
        position={[-0.33, TEXT_BOTTOM, 0]}
        fontSize={textSize(typing.text.length)}
        color="#f2efe6"
        anchorX="left"
        anchorY="bottom"
        maxWidth={0.66}
        onSync={(troika: { textRenderInfo?: { blockBounds?: number[]; caretPositions?: ArrayLike<number> } }) => {
          const bounds = troika.textRenderInfo?.blockBounds;
          if (bounds) setTextHeight(Math.max(0.043, bounds[3] - bounds[1]));
          setLayout(troika.textRenderInfo?.caretPositions ?? null);
        }}
        onPointerDown={tapText}
      >
        {/* A caret, so an empty field looks ready rather than broken. */}
        {display}
      </Text>
      {band ? (
        <mesh position={[-0.33 + band.x, TEXT_BOTTOM + band.y, -0.002]}>
          <planeGeometry args={[band.width, band.height]} />
          <meshBasicMaterial color="#d99a2b" transparent opacity={0.55} toneMapped={false} />
        </mesh>
      ) : null}
      <Text position={[0.33, 0.1, 0]} fontSize={0.022} color="#6f6b63" anchorX="right" anchorY="middle">
        {typing.selected
          ? "type, speak or ⌫ to change the lit word"
          : `${typing.text.length}/${limit} · ${typing.text ? "tap a word to fix it · " : ""}done to save`}
      </Text>
      {/*
        THE TWO WAYS IN THAT ARE NOT KEYS. Side by side above the keyboard,
        because they are alternatives to it rather than part of it.
      */}
      <WayIn
        x={-0.235}
        width={0.22}
        shown={canSpeak}
        label={phase === "recording" ? "listening — stop" : phase === "writing" ? "writing…" : "speak"}
        lit={phase !== "idle"}
        onPress={speak}
      />
      <WayIn x={0} width={0.22} shown label="system keyboard" onPress={useSystemKeyboard} />
      {/*
        SAVE, OUT WHERE IT CAN BE HIT.
        
        There is a "done" key in the bottom row of the keyboard and I missed it
        twice while testing — with coordinates I had worked out from the layout.
        A key among forty keys is the wrong shape for the one action that ends
        the whole interaction, and it is worse in a headset, where the keys are
        the fiddliest thing on the panel. This is the same size as the other two
        and sits with them.
        
        AN EMPTY FIELD STILL MEANS "CHANGED MY MIND", the same as pressing done
        on one — so this cannot create a card called "".
      */}
      <WayIn
        x={0.235}
        width={0.22}
        shown
        lit={latest.current.text.trim().length > 0}
        label={latest.current.text.trim() ? "save" : "close"}
        onPress={() => settle({ ...latest.current, done: true })}
      />

      <Keyboard3D typing={typing} onChange={(next) => settle(next as Editing)} onKey={onKey} position={[0, -0.09, 0]} />
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
  width = 0.33,
  lit = false,
  onPress,
}: {
  x: number;
  label: string;
  shown: boolean;
  width?: number;
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
        <planeGeometry args={[width, 0.045]} />
        <meshBasicMaterial color={lit ? CARD_INK.accent : "#2b3245"} toneMapped={false} />
      </mesh>
      <Text position={[0, 0, 0.002]} fontSize={0.019} color="#e9e6de" anchorX="center" anchorY="middle" maxWidth={width * 0.9}>
        {label}
      </Text>
    </group>
  );
}
