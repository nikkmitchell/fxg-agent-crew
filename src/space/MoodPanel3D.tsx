import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MOOD, isMoodAdd, layOutMood, moodAddControlOf, moodItemAt, moodMove, uvOfMoodPoint, type MoodItem, type MoodPlace } from "../../shared/mood-3d";
import { Text } from "@react-three/drei";
import { CARD_INK } from "../../shared/card-paint";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";
import { notePixels, paintNote } from "../../shared/mood-paint";
import { claimPointer } from "./pointer-claim";

/**
 * The mood board, drawn in the room.
 *
 * IT WAS A PHOTOGRAPH. The server screenshotted the website every fifteen
 * seconds and hung the picture on the wall, which meant it was always slightly
 * out of date, could not be touched, and showed a scrollbar. Nikk: "now it is
 * just images from the website, that's does not work good".
 *
 * PICTURES ARE REAL TEXTURES and notes are drawn like cards, so the board reads
 * at the resolution of the panel rather than at the resolution of a screenshot
 * of a browser window.
 *
 * MOVING AN ITEM SAVES IT IN PIXELS, because that is what the board is stored
 * in and what the website will read back. See `moodMove`.
 */

/** One picture. Split out because `useLoader` suspends, and only this should. */
function Picture({ place, held }: { place: MoodPlace; held: boolean }) {
  const texture = useLoader(THREE.TextureLoader, place.item.src as string);
  return (
    <meshBasicMaterial map={texture} toneMapped={false} transparent opacity={held ? 0.82 : 1} />
  );
}

function Written({ place }: { place: MoodPlace }) {
  // Shaped like the item, so nothing written on it is stretched — see
  // `notePixels` and the rule in `label-aspect.test.ts`.
  const px = useMemo(() => notePixels(place.item), [place.item.w, place.item.h]);
  const { canvas, texture } = useMemo(() => makeInkCanvas(px.width, px.height), [px.width, px.height]);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, paintNote(place.item, measureWith(context)));
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, place.item]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <meshBasicMaterial map={texture} transparent toneMapped={false} />;
}

export function MoodPanel3D({
  items,
  surface,
  onMove,
  onSay,
  onAdd,
}: {
  items: MoodItem[];
  surface: { width: number; height: number };
  onMove: (itemId: string, at: { x: number; y: number }) => Promise<void>;
  onSay: (message: string) => void;
  /** Somebody pressed the strip and wants to write a note. */
  onAdd: () => void;
}) {
  const plate = useRef<THREE.Group>(null);
  const [held, setHeld] = useState<{ id: string; from: { x: number; y: number } } | null>(null);
  /** Where a held item has been dragged to, before the server has agreed. */
  const [nudged, setNudged] = useState<Record<string, { x: number; y: number }>>({});

  const shown = useMemo(
    () => items.map((item) => (nudged[item.id] ? { ...item, ...nudged[item.id] } : item)),
    [items, nudged],
  );
  const size = useMemo(
    () => ({ ...MOOD, width: surface.width, height: surface.height }),
    [surface.width, surface.height],
  );
  const layout = useMemo(() => layOutMood(shown, size), [shown, size]);
  const addBox = useMemo(() => moodAddControlOf(layout, size), [layout, size]);

  const uvOf = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const group = plate.current;
      if (!group) return null;
      const local = group.worldToLocal(event.point.clone());
      return uvOfMoodPoint(layout, local);
    },
    [layout],
  );

  /** The add strip a press started on, so a press that slides off makes nothing. */
  const pressedAdd = useRef(false);

  const onDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    const uv = uvOf(event);
    if (!uv) return;
    // THE STRIP IS ASKED FIRST and swallows the press: it sits below the
    // fitted board, so nothing is under it to pick up anyway.
    if (isMoodAdd(layout, uv, size)) {
      pressedAdd.current = true;
      return;
    }
    const place = moodItemAt(layout, uv);
    if (place) setHeld({ id: place.item.id, from: uv });
  };

  const onMoveEvent = (event: ThreeEvent<PointerEvent>) => {
    if (!held) return;
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    const uv = uvOf(event);
    const item = shown.find((one) => one.id === held.id);
    if (!uv || !item) return;
    setNudged((current) => ({ ...current, [held.id]: moodMove(layout, item, held.from, uv) }));
  };

  const onUp = (event: ThreeEvent<PointerEvent>) => {
    if (pressedAdd.current) {
      pressedAdd.current = false;
      event.stopPropagation();
      const uv = uvOf(event);
      if (uv && isMoodAdd(layout, uv, size)) onAdd();
      return;
    }
    if (!held) return;
    event.stopPropagation();
    const at = nudged[held.id];
    const id = held.id;
    setHeld(null);
    if (!at) return;
    void onMove(id, at)
      .catch((error: unknown) => {
        // PUT IT BACK. An item that stays where the server would not accept it
        // is an arrangement everybody else cannot see.
        setNudged((current) => {
          const rest = { ...current };
          delete rest[id];
          return rest;
        });
        onSay(error instanceof Error ? error.message : "that could not be moved");
      });
  };

  return (
    <group ref={plate}>
      <mesh onPointerDown={onDown} onPointerMove={onMoveEvent} onPointerUp={onUp} onPointerLeave={() => setHeld(null)}>
        <planeGeometry args={[layout.width, layout.height]} />
        <meshBasicMaterial color={CARD_INK.paper} toneMapped={false} />
      </mesh>

      {/* WRITE SOMETHING AND PIN IT UP. Along the foot, full width, so it does
          not move as the board is re-fitted around whatever is on it. */}
      <group position={[addBox.x, addBox.y, 0.004]}>
        <mesh>
          <planeGeometry args={[addBox.width - 0.02, addBox.height - 0.02]} />
          <meshBasicMaterial color={CARD_INK.paperHeld} transparent opacity={0.75} toneMapped={false} />
        </mesh>
        <Text
          position={[0, 0, 0.002]}
          fontSize={addBox.height * 0.36}
          color={CARD_INK.muted}
          anchorX="center"
          anchorY="middle"
          maxWidth={addBox.width * 0.8}
        >
          +  write a note
        </Text>
      </group>

      {layout.places.map((place, index) => (
        <mesh
          key={place.item.id}
          // BACK TO FRONT in a hair of depth each, so the order people arranged
          // is the order the room draws — z-fighting otherwise picks its own.
          position={[place.x, place.y, 0.002 + index * 0.0006 + (held?.id === place.item.id ? 0.04 : 0)]}
          onPointerDown={onDown}
          onPointerMove={onMoveEvent}
          onPointerUp={onUp}
        >
          <planeGeometry args={[place.width, place.height]} />
          {place.item.kind === "image" && place.item.src ? (
            /*
              SUSPENSE PER PICTURE, not one around the board.
              
              `useLoader` suspends while a texture downloads. Without a boundary
              that suspension climbs until it finds one, and the nearest one is
              outside the scene — so a single slow image would blank the whole
              room until it arrived. Per picture, the rest of the board draws
              immediately and each frame fills in as it lands.
              
              The fallback is the paper the panel is made of, so a picture that
              has not arrived looks like a gap rather than like a hole.
            */
            <Suspense fallback={<meshBasicMaterial color={CARD_INK.paperHeld} toneMapped={false} />}>
              <Picture place={place} held={held?.id === place.item.id} />
            </Suspense>
          ) : (
            <Written place={place} />
          )}
        </mesh>
      ))}
    </group>
  );
}
