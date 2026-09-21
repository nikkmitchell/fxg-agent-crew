import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD, cardAt, layOutBoard, uvFromPanelPoint, type BoardCard, type CardPlace } from "../../shared/board-3d";
import { CARD_INK, CARD_PX, paintCard } from "../../shared/card-paint";
import { applyPending, intentOf, settlePending, type BoardIntent, type PendingMove } from "../../shared/board-actions";
import { canTransition } from "../../shared/board-rules";
import { carrying, stepGesture, type Gesture, type PointerSource, type SurfaceEvent, type SurfaceHit } from "../../shared/surface-input";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";
import { claimPointer } from "./pointer-claim";

/**
 * The work board, drawn in the room.
 *
 * THIS IS THE PANEL THAT REPLACES BOTH OLD ONES. The desktop had an iframe,
 * which is live but makes the whole WebGL canvas deaf to the mouse; a headset
 * had a photograph taken by the server every fifteen seconds. Neither was
 * editable, and they could not be the same thing. This is WebGL in both, so it
 * is one component with one behaviour and the canvas gets its pointers back.
 *
 * WHAT IS HERE AND WHAT IS NOT: the geometry, the painting, the gesture machine
 * and the meaning of a drop all live in `shared/` and are tested without a
 * renderer. This file is the part that genuinely needs three — meshes,
 * textures, and turning R3F pointer events into `SurfaceEvent`. Keeping that
 * boundary is why any of it can be tested at all.
 *
 * WHY R3F POINTER EVENTS RATHER THAN A RAYCASTER OF OUR OWN: @react-three/xr
 * drives these same handlers from controllers and tracked hands, so one set of
 * handlers serves a mouse, a controller and a hand. That is goal 4, and it is
 * free as long as nothing here asks which device it was.
 */

const CARD_ASPECT = CARD_PX.height / CARD_PX.width;

/** One card's mesh, with its own texture, repainted only when it changes. */
function Card({
  place,
  held,
  refused,
  onPointer,
}: {
  place: CardPlace;
  held: boolean;
  refused: boolean;
  onPointer: (type: SurfaceEvent["type"], event: ThreeEvent<PointerEvent>) => void;
}) {
  const { canvas, texture } = useMemo(() => makeInkCanvas(CARD_PX.width, CARD_PX.height), []);
  const invalidate = useThree((state) => state.invalidate);

  // REPAINTED ON CHANGE, NOT PER FRAME. Thirty cards uploading a texture every
  // frame is how a headset halves its rate.
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, paintCard(place.card, measureWith(context), refused ? "refused" : held ? "held" : "resting"));
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, place.card, place.card.title, place.card.status, place.card.assigneeId, place.card.commentCount, held, refused]);

  useEffect(() => () => texture.dispose(), [texture]);

  const height = place.width * CARD_ASPECT;
  return (
    <mesh
      position={[place.x, place.y, held ? 0.06 : 0.004]}
      onPointerDown={(event) => onPointer("down", event)}
      onPointerMove={(event) => onPointer("move", event)}
      onPointerUp={(event) => onPointer("up", event)}
    >
      <planeGeometry args={[place.width, Math.min(height, place.height)]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

export type BoardPanel3DProps = {
  panelId: string;
  cards: readonly BoardCard[];
  /** Ask the server. Returning a rejected promise puts the card back. */
  onMove: (cardId: string, to: string) => Promise<unknown>;
  /** Open a card's own panel — the copy with more in it than the card shows. */
  onOpen: (cardId: string) => void;
  /** A card released off every panel: pull it out into the room. */
  onPullOff: (cardId: string) => void;
  /** Say something the person needs to read, like a refusal. */
  onSay: (message: string) => void;
  /** The panel this board is drawn on, in metres. The board fills it. */
  surface: { width: number; height: number };
  now?: () => number;
};

export function BoardPanel3D({
  panelId,
  cards,
  onMove,
  onOpen,
  onPullOff,
  onSay,
  surface,
  now = Date.now,
}: BoardPanel3DProps) {
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  const [pending, setPending] = useState<PendingMove[]>([]);
  const [refusedCard, setRefusedCard] = useState<string | null>(null);
  const grabbed = useRef<string | null>(null);
  /** The board's own frame, which every pointer position is resolved against. */
  const board = useRef<THREE.Group>(null);

  // The server's cards with any un-acknowledged move laid on top, and guesses
  // retired as soon as the server catches up. See board-actions.
  useEffect(() => {
    setPending((current) => {
      const settled = settlePending(current, cards, now());
      return settled.length === current.length ? current : settled;
    });
  }, [cards, now]);

  const shown = useMemo(() => applyPending(cards, pending), [cards, pending]);
  /**
   * LAID OUT TO THE PANEL IT IS ON, not to a fixed rectangle.
   *
   * This drew itself at a hard-coded 2.4 × 1.5 on a surface that is 4.0 × 2.5,
   * so the board used sixty per cent of its own panel and the rest was blank
   * cream. Worse, making the panel bigger made the blank part bigger: the one
   * thing a person does when they cannot read a card had no effect on the cards.
   *
   * Feeding the surface through means a taller panel genuinely fits more cards
   * per column — `layOutBoard` works that out from the height it is given — so
   * resizing is a real answer to a crowded column rather than a magnifier.
   */
  const layout = useMemo(
    () => layOutBoard(shown, { ...BOARD, width: surface.width, height: surface.height }),
    [shown, surface.width, surface.height],
  );

  const held = carrying(gesture);
  const heldCardId = held ? grabbed.current : null;

  const cardOfHit = useCallback(
    (hit: SurfaceHit): BoardCard | null => {
      // The grabbed card is remembered rather than looked up again: by the time
      // a drop lands, the pointer is over a different card entirely.
      if (hit === held && grabbed.current) return shown.find((c) => c.id === grabbed.current) ?? null;
      return cardAt(layout, { x: hit.u, y: hit.v })?.card ?? null;
    },
    [held, layout, shown],
  );

  const act = useCallback(
    (intent: BoardIntent) => {
      if (intent.kind === "open") return onOpen(intent.cardId);
      if (intent.kind === "pullOff") return onPullOff(intent.cardId);
      if (intent.kind === "refused") {
        // SAID BEFORE IT SNAPS BACK. A card that returns with no explanation
        // reads as a broken drag rather than a rule.
        setRefusedCard(intent.cardId);
        onSay(intent.why);
        window.setTimeout(() => setRefusedCard(null), 1200);
        return;
      }
      if (intent.kind !== "move") return;
      const move: PendingMove = { cardId: intent.cardId, to: intent.to as PendingMove["to"], at: now() };
      setPending((current) => [...current.filter((m) => m.cardId !== move.cardId), move]);
      void onMove(intent.cardId, intent.to).catch((error: unknown) => {
        // The server refused after all: drop the guess and say why, rather than
        // leaving the card somewhere it never went.
        setPending((current) => current.filter((m) => m.cardId !== move.cardId));
        onSay(error instanceof Error ? error.message : "that move was refused");
      });
    },
    [now, onMove, onOpen, onPullOff, onSay],
  );

  const onPointer = useCallback(
    (type: SurfaceEvent["type"], event: ThreeEvent<PointerEvent>) => {
      const surface = board.current;
      if (!surface) return;
      event.stopPropagation();
      // `stopPropagation` stops R3F's own dispatch; the native event still
      // bubbles out to the container, where drag-to-look is listening. Without
      // this, dragging a card from `review` to `done` also swings the camera.
      claimPointer(event.nativeEvent);

      /**
       * FROM THE POINT, NOT FROM `event.uv`.
       *
       * This read `event.uv` directly, and it was wrong in a way that made the
       * whole board inert: uv is PER MESH. On the board's own background it is
       * the board's uv, which is what everything below expects — but on a card
       * it is that card's own 0..1, so pressing a card in `review` reported a
       * position somewhere near the middle of the board. `cardAt` then found
       * nothing, every drag ended as "none", and nothing happened at all. No
       * error, no refusal; the board simply did not respond, and a mouse and a
       * hand were equally ignored.
       *
       * The intersection POINT is the same world position whichever mesh the
       * ray struck first. Put it in the board's own frame and ask once.
       */
      const local = surface.worldToLocal(event.point.clone());
      const uv = uvFromPanelPoint(layout, local);
      const hit: SurfaceHit = { panelId, u: uv.x, v: uv.y };
      // ONE SOURCE NAME FOR EVERYTHING. Nothing below may branch on it; it
      // exists so two hands do not fight over one card.
      const source: PointerSource = event.pointerType === "mouse" ? "mouse" : "hand";
      if (type === "down") grabbed.current = cardAt(layout, { x: hit.u, y: hit.v })?.card.id ?? null;
      const stepped = stepGesture(gesture, { type, source, hit, at: now() } as SurfaceEvent);
      setGesture(stepped.state);
      if (stepped.outcome) {
        act(intentOf(stepped.outcome, layout, cardOfHit, canTransition));
        grabbed.current = null;
      }
    },
    [act, cardOfHit, gesture, layout, now, panelId],
  );

  // A pointer that leaves the whole panel mid-drag must not strand the card.
  const onLeave = useCallback(() => {
    const stepped = stepGesture(gesture, { type: "move", source: "mouse", hit: null, at: now() });
    setGesture(stepped.state);
  }, [gesture, now]);

  return (
    <group ref={board}>
      {/* The board itself. Also the drop target for "anywhere but a card". */}
      <mesh
        onPointerMove={(event) => onPointer("move", event)}
        onPointerUp={(event) => onPointer("up", event)}
        onPointerLeave={onLeave}
      >
        <planeGeometry args={[layout.width, layout.height]} />
        <meshBasicMaterial color={CARD_INK.paper} toneMapped={false} />
      </mesh>

      {layout.columns.map((column) => (
        <ColumnHeading key={column.status} label={column.label} count={column.count} x={column.x} width={column.width} top={layout.height / 2} />
      ))}

      {layout.cards.map((place) => (
        <Card
          key={place.card.id}
          place={place}
          held={heldCardId === place.card.id}
          refused={refusedCard === place.card.id}
          onPointer={onPointer}
        />
      ))}
    </group>
  );
}

/** A column's name and how many are in it, painted once per change. */
function ColumnHeading({
  label,
  count,
  x,
  width,
  top,
}: {
  label: string;
  count: number;
  x: number;
  width: number;
  top: number;
}) {
  const { canvas, texture } = useMemo(() => makeInkCanvas(256, 64), []);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, [
      { kind: "text", x: 8, y: 40, text: label, size: 30, fill: CARD_INK.ink, weight: "bold" },
      { kind: "text", x: 8 + measureWith(context)(label, 30) + 12, y: 40, text: String(count), size: 26, fill: CARD_INK.muted },
    ]);
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, label, count]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[x, top - BOARD.padding - BOARD.headerHeight / 2, 0.004]}>
      <planeGeometry args={[width, width * 0.25]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}
