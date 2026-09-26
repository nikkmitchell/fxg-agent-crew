import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { CHAT_DRAG_SLOP, clampScroll, wheelScroll } from "../../shared/chat-scroll";
import { CHAT_CANVAS_HEIGHT, makeChatCanvas, paintChat, type ChatExtent } from "./chat-texture";
import { claimPointer } from "./pointer-claim";
import type { RoomFeed } from "./useRoomFeed";

/**
 * The chat panel, in a headset.
 *
 * THIS WAS THE FIRST PANEL DRAWN RATHER THAN PHOTOGRAPHED, and it was drawn
 * because it had to be: the server's renderer holds no WebHarness token, so the
 * picture it took was of the sentence saying the room could not be read. Every
 * panel works this way now, and this one is no longer the exception.
 *
 * Mounted in both rooms, like the rest.
 *
 * The feed is PASSED IN rather than read here. This used to call `useRoomFeed`
 * itself while the scene called it too, which meant two timers and two cursors
 * polling the same conversation.
 *
 * IT SCROLLS (Nikk, 4936): drag the wall down to read back, up to come back, or
 * use a mouse wheel. The scroll is this viewer's alone, never sent anywhere,
 * and it goes back to the newest message whenever a new one arrives.
 */
export function ChatPanel3D({ station, feed }: { station: Station; feed: RoomFeed }) {
  const { canvas, texture } = useMemo(() => makeChatCanvas(), []);
  // On demand: a room set to redraw only when something happens still has to
  // redraw when a message lands, and nothing else in the scene has moved.
  const invalidate = useThree((state) => state.invalidate);
  const [scroll, setScroll] = useState(0);
  const extent = useRef<ChatExtent>({ content: 0, view: 0 });
  const drag = useRef<{ fromV: number; start: number; moving: boolean } | null>(null);

  // BACK TO THE NEWEST when somebody says something: the id of the last
  // message changing is "something new", a re-render of the same feed is not.
  const newest = feed.messages[feed.messages.length - 1]?.id;
  useEffect(() => setScroll(0), [newest]);

  useEffect(() => {
    extent.current = paintChat(canvas, texture, {
      messages: feed.messages,
      room: feed.room,
      trouble: feed.trouble,
      scroll,
    });
    invalidate();
  }, [canvas, texture, feed.messages, feed.room, feed.trouble, scroll, invalidate]);

  useEffect(() => () => texture.dispose(), [texture]);

  const clamp = (up: number) => clampScroll(up, extent.current.content, extent.current.view);
  const vOf = (event: ThreeEvent<PointerEvent>) => event.uv?.y ?? null;

  // Drawn at its own origin; the <Movable> around it owns the position.
  const { width, height } = station.surface;
  return (
    <mesh
      onPointerDown={(event) => {
        const v = vOf(event);
        if (v === null) return;
        event.stopPropagation();
        // The native event still bubbles to the page, where drag-to-look
        // listens: without this, reading back also swings the camera.
        claimPointer(event.nativeEvent);
        drag.current = { fromV: v, start: scroll, moving: false };
        (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const d = drag.current, v = vOf(event);
        if (!d || v === null) return;
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        // A shaky press is a press, not a scroll.
        if (!d.moving && Math.abs(v - d.fromV) < CHAT_DRAG_SLOP) return;
        d.moving = true;
        setScroll(clamp(d.start + (d.fromV - v) * CHAT_CANVAS_HEIGHT));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        event.stopPropagation();
        drag.current = null;
        (event.target as { releasePointerCapture?: (id: number) => void } | null)?.releasePointerCapture?.(event.pointerId);
      }}
      onPointerLeave={() => { drag.current = null; }}
      onWheel={(event) => {
        event.stopPropagation();
        setScroll((up) => wheelScroll(up, event.deltaY, extent.current.view, extent.current.content));
      }}
    >
      <planeGeometry args={[width, height]} />
      {/* Unlit, like the photographs beside it: a scene light falling across
          one panel and not the others would read as a rendering fault. */}
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
