import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD, addAt, addControlOf, cardAt, columnAt, columnPlateOf, layOutBoard, uvFromPanelPoint, type BoardCard, type BoardColumn, type CardPlace } from "../../shared/board-3d";
import { Text } from "@react-three/drei";
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

  return (
    <mesh
      position={[place.x, place.y, held ? 0.06 : 0.006]}
      onPointerDown={(event) => onPointer("down", event)}
      onPointerMove={(event) => onPointer("move", event)}
      onPointerUp={(event) => onPointer("up", event)}
    >
      {/*
        THE PLANE THE LAYOUT ASKED FOR, unclamped.
        
        This was `Math.min(place.width * CARD_ASPECT, place.height)`, and the
        clamp was doing the damage: the layout gave cards a flat 0.16m height
        while the texture is two to one, so on a four-metre board every card was
        drawn on a 4:1 plane and its text squashed to half its height. The
        layout now derives a card's height from its width, so the plane and the
        bitmap agree by construction and there is nothing left to clamp.
      */}
      <planeGeometry args={[place.width, place.height]} />
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
  /** Somebody pressed "add" on a column and wants to write a title. */
  onAddTask: (status: string) => void;
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
  onAddTask,
  now = Date.now,
}: BoardPanel3DProps) {
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  const [pending, setPending] = useState<PendingMove[]>([]);
  const [refusedCard, setRefusedCard] = useState<string | null>(null);
  /**
   * WHAT THE BOARD JUST SAID, DRAWN ON THE BOARD.
   *
   * `onSay` puts a refusal in the page's rail beside the canvas. That is fine
   * at a desk and INVISIBLE IN A HEADSET, where there is no rail and no DOM at
   * all — so "a card cannot go from Backlog to Done" was a sentence only half
   * the room could read, which is the two-rooms problem wearing a small hat. It
   * still goes to the rail, because somebody at a desk may be looking there;
   * it is also drawn here, where the refusal happened.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const grabbed = useRef<string | null>(null);
  /** The board's own frame, which every pointer position is resolved against. */
  const board = useRef<THREE.Group>(null);
  /**
   * The add control a press started on.
   *
   * PRESS AND RELEASE ON THE SAME CONTROL, like any other button. Firing on the
   * press alone would mean a press that slid off still made a card, and a card
   * you did not mean to make has to be noticed before it can be removed.
   */
  const pressedAdd = useRef<string | null>(null);

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
  const size = useMemo(
    () => ({ ...BOARD, width: surface.width, height: surface.height }),
    [surface.width, surface.height],
  );
  const layout = useMemo(() => layOutBoard(shown, size), [shown, size]);

  const held = carrying(gesture);
  const heldCardId = held ? grabbed.current : null;

  /**
   * WHERE THE CARD WOULD LAND IF YOU LET GO NOW.
   *
   * Dragging lifted the card and told you nothing else, so the drop was a
   * guess — and `columnAt` is deliberately FORGIVING, snapping to the nearest
   * column rather than requiring you to be inside one, which makes the guess
   * harder rather than easier: the card can land in a column your pointer is
   * not over. Lighting that column while you hold it turns the forgiveness
   * from something that surprises you into something you can see.
   */
  const landingOn =
    gesture.kind === "dragging" && gesture.over
      ? columnAt(layout, { x: gesture.over.u, y: gesture.over.v })?.status ?? null
      : null;

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
        setNotice(intent.why);
        window.setTimeout(() => setRefusedCard(null), 1200);
        // Longer than the card's own flash: the card snapping back is the
        // signal that something was refused, and the sentence is the reason —
        // which you go looking for after you notice the snap.
        window.setTimeout(() => setNotice(null), 4200);
        return;
      }
      if (intent.kind !== "move") return;
      const move: PendingMove = { cardId: intent.cardId, to: intent.to as PendingMove["to"], at: now() };
      setPending((current) => [...current.filter((m) => m.cardId !== move.cardId), move]);
      void onMove(intent.cardId, intent.to).catch((error: unknown) => {
        // The server refused after all: drop the guess and say why, rather than
        // leaving the card somewhere it never went.
        setPending((current) => current.filter((m) => m.cardId !== move.cardId));
        const why = error instanceof Error ? error.message : "that move was refused";
        onSay(why);
        setNotice(why);
        window.setTimeout(() => setNotice(null), 4200);
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

      // THE ADD CONTROLS ARE ASKED FIRST, and they swallow the press entirely:
      // a press on one is not the start of a drag, and letting the gesture
      // machine also see it would arm a drag that has nothing to carry.
      const onAdd = addAt(layout, { x: hit.u, y: hit.v }, size);
      if (type === "down" && onAdd) {
        pressedAdd.current = onAdd.status;
        return;
      }
      if (pressedAdd.current !== null) {
        if (type === "up") {
          const started = pressedAdd.current;
          pressedAdd.current = null;
          if (onAdd && onAdd.status === started) onAddTask(started);
        }
        return;
      }

      if (type === "down") grabbed.current = cardAt(layout, { x: hit.u, y: hit.v })?.card.id ?? null;
      const stepped = stepGesture(gesture, { type, source, hit, at: now() } as SurfaceEvent);
      setGesture(stepped.state);
      if (stepped.outcome) {
        act(intentOf(stepped.outcome, layout, cardOfHit, canTransition));
        grabbed.current = null;
      }
    },
    [act, cardOfHit, gesture, layout, now, onAddTask, panelId, size],
  );

  // A pointer that leaves the whole panel mid-drag must not strand the card.
  const onLeave = useCallback(() => {
    const stepped = stepGesture(gesture, { type: "move", source: "mouse", hit: null, at: now() });
    setGesture(stepped.state);
  }, [gesture, now]);

  return (
    <group ref={board}>
      {/*
        The board itself. Also the drop target for "anywhere but a card", and
        the thing that hears a press on an add strip.
        
        IT NEEDS `onPointerDown` TOO, which it did not have. Only the cards
        listened for a press, because only a card can be picked up — but the add
        strips are drawn in front of this mesh and carry no handlers of their
        own, so R3F passes their presses down to here. With no `onPointerDown`
        the press simply vanished: the strip was drawn, it was the right size,
        the hit-test agreed it had been hit, and pressing it did nothing at all.
      */}
      <mesh
        onPointerDown={(event) => onPointer("down", event)}
        onPointerMove={(event) => onPointer("move", event)}
        onPointerUp={(event) => onPointer("up", event)}
        onPointerLeave={onLeave}
      >
        <planeGeometry args={[layout.width, layout.height]} />
        <meshBasicMaterial color={CARD_INK.paper} toneMapped={false} />
      </mesh>

      {/* WHAT THE BOARD JUST SAID, over the columns and in front of them, so it
          is legible from wherever you are standing when it appears. */}
      {notice ? (
        <group position={[0, layout.height / 2 - BOARD.padding - BOARD.headerHeight * 1.9, 0.08]}>
          <mesh>
            <planeGeometry args={[layout.width * 0.7, BOARD.headerHeight * 1.5]} />
            <meshBasicMaterial color={CARD_INK.refused} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0, 0.002]}
            fontSize={BOARD.headerHeight * 0.5}
            color="#fdf9f2"
            anchorX="center"
            anchorY="middle"
            maxWidth={layout.width * 0.64}
            textAlign="center"
          >
            {notice}
          </Text>
        </group>
      ) : null}

      {/* The lanes, drawn under everything, so the eye has a column to follow
          and an empty one still has a shape. */}
      {layout.columns.map((column) => {
        const plate = columnPlateOf(layout, column, size);
        const landing = landingOn === column.status;
        return (
          <mesh key={`plate-${column.status}`} position={[plate.x, plate.y, 0.001]}>
            <planeGeometry args={[plate.width, plate.height]} />
            <meshBasicMaterial
              color={landing ? CARD_INK.accent : CARD_INK.paperHeld}
              transparent
              opacity={landing ? 0.3 : 0.55}
              toneMapped={false}
            />
          </mesh>
        );
      })}

      {layout.columns.map((column) => (
        <ColumnHeading key={column.status} label={column.label} count={column.count} x={column.x} width={column.width} top={layout.height / 2} />
      ))}

      {/* ONE IN EVERY COLUMN. Work does not always start in the backlog, and a
          single "new task" button would have to ask which column afterwards. */}
      {layout.columns.map((column) => (
        <AddControl key={`add-${column.status}`} box={addControlOf(layout, column, size)} column={column} />
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

/**
 * The "add a card here" control in a column header.
 *
 * DRAWN, NOT PRESSED, HERE. Its position comes from `addControlOf` and the
 * press is handled by the panel's own pointer handler, so the thing you can hit
 * and the thing you can see are the same rectangle by construction rather than
 * by two pieces of arithmetic agreeing.
 */
function AddControl({ box, column }: { box: { x: number; y: number; width: number; height: number }; column: BoardColumn }) {
  return (
    <group position={[box.x, box.y, 0.006]}>
      <mesh>
        <planeGeometry args={[box.width - 0.01, box.height - 0.01]} />
        {/* Dashed-outline energy without a dashed outline: a panel a shade off
            the paper, so it reads as a place a card could go rather than as a
            card that is already there. */}
        <meshBasicMaterial color={CARD_INK.paperHeld} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      {/*
        BOUNDED, because a label with no width runs into the next column.
        
        drei's Text lays out freely unless it is told not to, and the strips sit
        side by side with a hair between them — so "add to Backlog" ran straight
        through "add to Assigned" and the foot of the board read as one long
        smear. `maxWidth` is the whole fix; the smaller size is so the common
        case does not need to wrap at all.
      */}
      <Text
        position={[0, 0, 0.002]}
        fontSize={box.height * 0.2}
        color={CARD_INK.muted}
        anchorX="center"
        anchorY="middle"
        maxWidth={box.width * 0.86}
        textAlign="center"
      >
        {`+  add to ${column.label}`}
      </Text>
    </group>
  );
}
