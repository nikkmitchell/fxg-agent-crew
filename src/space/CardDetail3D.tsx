import { useEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DETAIL_PX, isDetailClose, isDetailComment, paintDetail, type TaskDetail } from "../../shared/card-detail";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";
import { claimPointer } from "./pointer-claim";

/**
 * A card pulled off the board, with everything the card could not hold.
 *
 * Nikk: "tasks should even be able to be pulled off the board to have a copied
 * version of that task with much more details in it's own panel."
 *
 * A COPY, AND THE CARD STAYS PUT. Pulling a card off to read it must not take
 * it out of the column it belongs in — somebody else looking at the board would
 * watch work disappear. The board is unchanged; this is a second view.
 *
 * IN FRONT OF THE BOARD, NOT SOMEWHERE ELSE IN THE ROOM. It is about a card you
 * were just looking at, so it opens where you are already looking. It is a
 * child of the board's own group, which means it inherits the panel's position,
 * angle and scale for free — including, importantly, the scale: a person who
 * made the board bigger to read it wants this bigger too.
 *
 * WHAT IT SAYS is decided by `card-detail.ts` and tested without a canvas. This
 * is the mesh, the texture and the one press that closes it.
 */

/**
 * Panel size in metres, at the board's own scale.
 *
 * The aspect is taken from the bitmap rather than chosen again here, because a
 * panel whose shape disagrees with its texture stretches every word on it.
 */
const DETAIL_WIDTH = 1.45;
const DETAIL = { width: DETAIL_WIDTH, height: (DETAIL_PX.height / DETAIL_PX.width) * DETAIL_WIDTH } as const;

export function CardDetail3D({
  task,
  onClose,
  onComment,
  at,
}: {
  task: TaskDetail;
  onClose: () => void;
  onComment: () => void;
  /** Where to hang it, in the board's frame. */
  at: [number, number, number];
}) {
  const { canvas, texture } = useMemo(() => makeInkCanvas(DETAIL_PX.width, DETAIL_PX.height), []);
  const invalidate = useThree((state) => state.invalidate);
  const surface = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, paintDetail(task, measureWith(context)));
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, task]);

  useEffect(() => () => texture.dispose(), [texture]);

  const press = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    // Or reading a task would swing the camera round the room.
    claimPointer(event.nativeEvent);
    if (!event.uv) return;
    // SAFE TO USE `event.uv` HERE, unlike on the board: this panel is ONE mesh,
    // so its uv is the panel's uv and nothing else can report a different
    // frame. The board needed the point because its cards are separate meshes.
    const uv = { x: event.uv.x, y: event.uv.y };
    if (isDetailClose(uv)) return onClose();
    if (isDetailComment(uv)) return onComment();
  };

  return (
    <group position={at}>
      {/* A back face a shade darker, so the panel reads as a thing in front of
          the board rather than a stain on it. */}
      <mesh position={[0, 0, -0.004]}>
        <planeGeometry args={[DETAIL.width + 0.03, DETAIL.height + 0.03]} />
        <meshBasicMaterial color="#2b3245" transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh ref={surface} onPointerDown={press}>
        <planeGeometry args={[DETAIL.width, DETAIL.height]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
