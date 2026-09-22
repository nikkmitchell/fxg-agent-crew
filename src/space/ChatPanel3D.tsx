import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { makeChatCanvas, paintChat } from "./chat-texture";
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
 */
export function ChatPanel3D({ station, feed }: { station: Station; feed: RoomFeed }) {
  const { canvas, texture } = useMemo(() => makeChatCanvas(), []);
  // On demand: a room set to redraw only when something happens still has to
  // redraw when a message lands, and nothing else in the scene has moved.
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    paintChat(canvas, texture, {
      messages: feed.messages,
      room: feed.room,
      trouble: feed.trouble,
    });
    invalidate();
  }, [canvas, texture, feed.messages, feed.room, feed.trouble, invalidate]);

  useEffect(() => () => texture.dispose(), [texture]);

  // Drawn at its own origin; the <Movable> around it owns the position.
  const { width, height } = station.surface;
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      {/* Unlit, like the photographs beside it: a scene light falling across
          one panel and not the others would read as a rendering fault. */}
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
