import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LIST_PX, paintList, type ListRow } from "../../shared/list-paint";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";

/**
 * Who is here, and what has been said — drawn rather than photographed.
 *
 * ONE COMPONENT FOR BOTH, because both are a heading and a column of short
 * entries. Two components would be two panels that slowly stopped looking like
 * the same room.
 *
 * NOTHING TO PRESS. These are for reading. The board and the mood board are
 * where things are moved; giving a transcript a drag would only compete with
 * the drag that moves the panel.
 */
export function ListPanel3D({
  title,
  rows,
  surface,
  empty,
  newestLast = false,
  leadWithSecondary = false,
}: {
  title: string;
  rows: ListRow[];
  surface: { width: number; height: number };
  empty?: string;
  /** True for anything that grows: the end is the part worth showing. */
  newestLast?: boolean;
  /** True for a transcript, which reads "who, then what". */
  leadWithSecondary?: boolean;
}) {
  const { canvas, texture } = useMemo(() => makeInkCanvas(LIST_PX.width, LIST_PX.height), []);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, paintList(title, rows, measureWith(context), { empty, newestLast, leadWithSecondary }));
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, title, rows, empty, newestLast, leadWithSecondary]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh>
      <planeGeometry args={[surface.width, surface.height]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
