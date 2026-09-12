import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { makeChatCanvas, paintChat } from "./chat-texture";
import type { RoomFeed } from "./useRoomFeed";

/**
 * The chat panel, in a headset.
 *
 * The other three panels are photographs from the server. This one cannot be:
 * the server's renderer holds no WebHarness token, so the picture it takes is
 * of the sentence saying the room could not be read. This draws the same
 * messages into a canvas from the viewer's own session instead — which makes it
 * the one panel in a session that is genuinely live rather than seconds old.
 *
 * Mounted only inside a session. In a window the real DOM panel is better in
 * every way: selectable, scrollable, and it does not cost a texture upload
 * every time somebody speaks.
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
