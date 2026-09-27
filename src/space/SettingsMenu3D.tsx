import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { MENU, hitMenu, layOutMenu, menuPixel, menuSignature, type MenuLayout, type MenuModel } from "./menu-layout";
import { paintMenu } from "./menu-paint";

/**
 * The headset settings menu, in the room: one plane with the whole menu
 * painted on it. See menu-layout.ts for why it is one panel.
 *
 * A ray, a pinch or a fingertip all arrive here as pointer events on the one
 * mesh; the point they hit is turned back into canvas pixels and looked up
 * in the layout's targets. Hovering lights the row under the pointer, which is
 * how you can tell, from two metres away, what a pinch is about to press.
 */

/** Two presses of one target this close together are one press arriving twice (ray and touch). */
const REPEAT_MS = 300;

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return { canvas, texture };
}

export function SettingsMenu3D({ model, position = [0, 0, 0] }: { model: MenuModel; position?: [number, number, number] }) {
  const layout = layOutMenu(model);
  const latest = useRef<MenuLayout>(layout);
  latest.current = layout;
  const [hover, setHover] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const lastPress = useRef<{ id: string; at: number } | null>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  // One canvas per size. The height never changes (5445); the width changes
  // with how many columns a tab has.
  const surface = useMemo(() => makeCanvas(layout.width, layout.height), [layout.width, layout.height]);
  useEffect(() => () => surface.texture.dispose(), [surface]);

  const signature = menuSignature(layout, hover, pressed);
  useEffect(() => {
    const context = surface.canvas.getContext("2d");
    if (!context) return;
    paintMenu(context, latest.current, hover, pressed);
    surface.texture.needsUpdate = true;
    invalidate();
    // The signature is the whole picture; the layout itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, signature, invalidate]);

  useEffect(() => {
    if (!pressed) return;
    const timer = setTimeout(() => setPressed(null), 160);
    return () => clearTimeout(timer);
  }, [pressed]);

  const targetAt = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const node = mesh.current;
    if (!node) return null;
    const local = node.worldToLocal(event.point.clone());
    const pixel = menuPixel(latest.current, local);
    return hitMenu(latest.current, pixel.x, pixel.y);
  };

  const width = layout.width / MENU.pxPerMetre;
  const height = layout.height / MENU.pxPerMetre;

  return (
    <mesh
      ref={mesh}
      position={position}
      onPointerMove={(event) => {
        event.stopPropagation();
        const id = targetAt(event)?.id ?? null;
        if (id !== hover) setHover(id);
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(event) => {
        event.stopPropagation();
        const target = targetAt(event);
        if (!target) return;
        const now = performance.now();
        if (lastPress.current && lastPress.current.id === target.id && now - lastPress.current.at < REPEAT_MS) return;
        lastPress.current = { id: target.id, at: now };
        setPressed(target.id);
        target.onTap();
      }}
    >
      <planeGeometry args={[width, height]} />
      {/* alphaTest: the rounded corners are see-through, and must not hide what is behind them. */}
      <meshBasicMaterial map={surface.texture} transparent alphaTest={0.02} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** The menu's size in metres, for placing things around it. */
export function menuSizeMetres(layout: Pick<MenuLayout, "width" | "height">) {
  return { width: layout.width / MENU.pxPerMetre, height: layout.height / MENU.pxPerMetre };
}
