import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { makeChatCanvas, paintChat } from "./chat-texture";
import { useRoomFeed } from "./useRoomFeed";

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
 */
export function ChatPanel3D({ station }: { station: Station }) {
  const feed = useRoomFeed(true);
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

  const { position, width, height, rotationY } = station.surface;
  return (
    <mesh position={[position.x, position.y, position.z]} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[width, height]} />
      {/* Unlit, like the photographs beside it: a scene light falling across
          one panel and not the others would read as a rendering fault. */}
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
