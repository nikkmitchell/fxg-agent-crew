import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import {
  EMPTY_MINDFULNESS,
  MINDFULNESS_CANVAS,
  chooseMindfulness,
  mindfulnessTargetAt,
  nextMindfulness,
  paintMindfulness,
  writeMindfulnessNote,
  clearMindfulnessNote,
  type MindfulnessScreen,
  type MindfulnessView,
  type SharedMindfulnessCard,
} from "../../shared/mindfulness";
import type { ServerMessage } from "../../shared/space-wire";
import { space } from "../space-client";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";
import { claimPointer } from "./pointer-claim";
import { Typing3D } from "./Typing3D";

/** A slim, walk-up page between the room's book and candle shelf. */
/**
 * On the open floor at the left, between the sand garden and the dome, turned
 * to face the arrival point. (First placed at (0.15, 3.45), which is where
 * Nightjar's incense stand went; moved by Sill when merging.)
 */
export const MINDFULNESS_PANEL_AT: [number, number, number] = [-3.3, 0, 4.1];
const PANEL_WIDTH = 1.28;
const PANEL_HEIGHT = 0.8;
const noRaycast = () => undefined;

export function MindfulnessPanel({ subscribe }: {
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}) {
  const [view, setView] = useState<MindfulnessView>(EMPTY_MINDFULNESS);
  const [screen, setScreen] = useState<MindfulnessScreen>("practice");
  const [cards, setCards] = useState<SharedMindfulnessCard[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pressed = useRef<string | null>(null);
  const plate = useRef<THREE.Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  const { canvas, texture } = useMemo(() => makeInkCanvas(MINDFULNESS_CANVAS.width, MINDFULNESS_CANVAS.height), []);
  const painted = useMemo(() => paintMindfulness(view, (text, size) => {
    const context = canvas.getContext("2d");
    return context ? measureWith(context)(text, size) : text.length * size * 0.56;
  }, {
    screen,
    cards,
    cardIndex: index,
    hasOlder: older !== null || index < cards.length - 1,
    hasNewer: index > 0,
    notice,
  }), [canvas, cards, index, notice, older, screen, view]);

  useEffect(() => {
    drawInk(canvas, painted.ink);
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, invalidate, painted, texture]);
  useEffect(() => () => texture.dispose(), [texture]);

  const loadLatest = useCallback(async () => {
    const page = await space.mindfulnessPage();
    setCards(page.cards);
    setOlder(page.older);
    setIndex(0);
  }, []);

  useEffect(() => {
    let live = true;
    void loadLatest().catch((error: unknown) => {
      if (live) setNotice(error instanceof Error ? error.message : "The room page could not be loaded.");
    });
    const unsubscribe = subscribe((message) => {
      if (message.type !== "mindfulnessPageChanged") return;
      // A shared page change is a small invalidation, not a broadcast of
      // somebody's writing. Every viewer refetches with their own delete bit.
      void loadLatest().catch((error: unknown) => {
        if (live) setNotice(error instanceof Error ? error.message : "The room page could not be refreshed.");
      });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [loadLatest, subscribe]);

  const pointTarget = (event: ThreeEvent<PointerEvent>): string | null => {
    if (!plate.current) return null;
    const local = plate.current.worldToLocal(event.point.clone());
    const x = ((local.x / PANEL_WIDTH) + 0.5) * MINDFULNESS_CANVAS.width;
    const y = (0.5 - local.y / PANEL_HEIGHT) * MINDFULNESS_CANVAS.height;
    return mindfulnessTargetAt(painted.targets, x, y);
  };

  const share = async () => {
    if (!view.note.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { card } = await space.shareMindfulnessCard(view.note);
      setCards((current) => [card, ...current.filter((one) => one.id !== card.id)].slice(0, 12));
      setIndex(0);
      setOlder(null);
      setView(EMPTY_MINDFULNESS);
      setScreen("room-page");
      // Refresh the cursor too: a new card can shift the oldest card onto the
      // next page. The posted card remains visible if this follow-up read fails.
      void loadLatest().catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That card could not be shared. Your words remain here privately.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const card = cards[index];
    if (!card?.mine || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await space.removeMindfulnessCard(card.id);
      setCards((current) => current.filter((one) => one.id !== card.id));
      setIndex((current) => Math.max(0, Math.min(current, cards.length - 2)));
      setScreen("room-page");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your card could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  const olderCard = async () => {
    if (index < cards.length - 1) {
      setIndex((current) => current + 1);
      return;
    }
    if (older === null || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const page = await space.mindfulnessPage(older);
      setCards((current) => [...current, ...page.cards]);
      setOlder(page.older);
      if (page.cards.length) setIndex((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Older cards could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const onTarget = (id: string) => {
    setNotice(null);
    if (busy) return;
    if (id.startsWith("choose:")) {
      const choice = id.slice("choose:".length) as MindfulnessView["id"];
      if (choice) setView(chooseMindfulness(view, choice));
      return;
    }
    if (id === "home" || id === "page-back") {
      setView(EMPTY_MINDFULNESS);
      setScreen("practice");
    } else if (id === "open-page") {
      setScreen("room-page");
    } else if (id === "page-add") {
      setView({ id: "bright-spot", step: 0, complete: false, note: "" });
      setScreen("practice");
    } else if (id === "back") {
      setView({ ...view, step: Math.max(0, view.step - 1), complete: false });
    } else if (id === "next") {
      setView(nextMindfulness(view));
    } else if (id === "write") {
      setWriting(true);
    } else if (id === "review-share") {
      setScreen("share-preview");
    } else if (id === "cancel-share") {
      setScreen("practice");
    } else if (id === "confirm-share") {
      void share();
    } else if (id === "remove-card") {
      setScreen("remove-preview");
    } else if (id === "cancel-remove") {
      setScreen("room-page");
    } else if (id === "confirm-remove") {
      void remove();
    } else if (id === "clear") {
      setView(clearMindfulnessNote(view));
    } else if (id === "page-newer") {
      setIndex((current) => Math.max(0, current - 1));
    } else if (id === "page-older") {
      void olderCard();
    }
  };

  return (
    <group position={MINDFULNESS_PANEL_AT} rotation-y={1.0}>
      {/* A quiet wood stand: the canvas is readable from a chair or while walking. */}
      <mesh position={[0, 0.48, 0]} raycast={noRaycast}>
        <boxGeometry args={[0.075, 0.96, 0.075]} />
        <meshStandardMaterial color="#503a2a" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.055, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.34, 0.4, 0.11, 20]} />
        <meshStandardMaterial color="#594231" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.39, -0.012]} raycast={noRaycast}>
        <boxGeometry args={[PANEL_WIDTH + 0.065, PANEL_HEIGHT + 0.065, 0.045]} />
        <meshStandardMaterial color="#503a2a" roughness={0.88} />
      </mesh>
      <mesh
        ref={plate}
        position={[0, 1.39, 0.014]}
        onPointerDown={(event) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          pressed.current = pointTarget(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          const from = pressed.current;
          pressed.current = null;
          const to = pointTarget(event);
          if (from && from === to) onTarget(from);
        }}
        onPointerLeave={() => { pressed.current = null; }}
      >
        <planeGeometry args={[PANEL_WIDTH, PANEL_HEIGHT]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {writing && (
        <Typing3D
          prompt="Write one sentence. It stays private unless you review and confirm sharing."
          initial={view.note}
          limit={240}
          position={[0, 0.88, 0.72]}
          scale={1}
          onCancel={() => setWriting(false)}
          onDone={(text) => {
            setView((current) => writeMindfulnessNote(current, text));
            setWriting(false);
          }}
        />
      )}
      {busy && <Text position={[0, 1.86, 0.04]} fontSize={0.026} color="#fff1d6" raycast={noRaycast}>SAVING THE PAGE…</Text>}
    </group>
  );
}
