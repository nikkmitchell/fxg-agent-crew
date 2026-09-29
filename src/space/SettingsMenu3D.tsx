import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { MENU, hitMenu, layOutMenu, menuPixel, menuSignature, type MenuLayout, type MenuModel } from "./menu-layout";
import { paintMenu } from "./menu-paint";
import { NO_OFFSET, clampOffset, type MenuOffset } from "./menu-move";
import { claimPointer } from "./pointer-claim";

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
  /**
   * Where you have put the menu, relative to where it opens (menu-move.ts).
   * FORGOTTEN WHEN IT CLOSES (Nikk, 6215: "Every time you open the menu, the
   * position should be reset, so it's right in front of you"): moving it is
   * for while it is open.
   */
  const [offset, setOffset] = useState<MenuOffset>(NO_OFFSET);
  /**
   * A MOVE IN PROGRESS, held at arm's length (Nikk, 6213: "move it on all
   * three axes ... move it further away or closer, like allow full
   * movement"). The menu keeps the distance along your pointer it was grabbed
   * at and goes where the pointer goes, up, down and sideways; the stick or
   * the mouse wheel pushes it away or pulls it in. It moves WITH the pointer,
   * from where you grabbed it, never jumping to where you happen to aim.
   */
  const carrying = useRef<{ distance: number; grab: THREE.Vector3; pointer: number; ray: THREE.Ray } | null>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const facing = useMemo(() => new THREE.Vector3(), []);

  /** Put the menu so the grabbed point is `distance` along `ray`. */
  const carryTo = (ray: THREE.Ray) => {
    const held = carrying.current;
    const node = mesh.current;
    if (!held || !node?.parent) return;
    held.ray.copy(ray);
    const centre = ray.at(held.distance, new THREE.Vector3()).add(held.grab);
    const local = node.parent.worldToLocal(centre);
    setOffset(clampOffset({ x: local.x - position[0], y: local.y - position[1], z: local.z - position[2] }));
    invalidate();
  };

  // Every frame: face whoever is looking (Nikk, 6213: "always be pointing at
  // you"), and while carrying, let a thumbstick push the menu away or pull it in.
  useFrame((_, delta) => {
    const node = mesh.current;
    if (!node) return;
    camera.getWorldPosition(facing);
    node.lookAt(facing);
    const held = carrying.current;
    if (!held) return;
    let push = 0;
    for (const source of gl.xr.getSession()?.inputSources ?? []) {
      const y = source.gamepad?.axes[3] ?? 0;
      if (Math.abs(y) > 0.2) push = -y;
    }
    if (push !== 0) {
      held.distance = Math.max(0.3, held.distance * (1 + push * delta * 1.5));
      carryTo(held.ray);
    }
  });

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
      position={[position[0] + offset.x, position[1] + offset.y, position[2] + offset.z]}
      onPointerDown={(event) => {
        if (targetAt(event)?.id !== "move") return;
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        const node = mesh.current;
        if (!node) return;
        // Where the menu's centre is from the point you took hold of.
        const centre = node.getWorldPosition(new THREE.Vector3());
        carrying.current = {
          distance: event.ray.origin.distanceTo(event.point),
          grab: centre.sub(event.point),
          pointer: event.pointerId,
          ray: event.ray.clone(),
        };
        // Keep the moves coming when the ray slips off the menu mid-carry.
        (event.target as unknown as Element | null)?.setPointerCapture?.(event.pointerId);
        setPressed("move");
      }}
      onPointerUp={(event) => {
        const held = carrying.current;
        if (!held || held.pointer !== event.pointerId) return;
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        carrying.current = null;
        (event.target as unknown as Element | null)?.releasePointerCapture?.(event.pointerId);

      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const held = carrying.current;
        if (held && held.pointer === event.pointerId) {
          carryTo(event.ray);
          return;
        }
        const id = targetAt(event)?.id ?? null;
        if (id !== hover) setHover(id);
      }}
      onPointerLeave={() => setHover(null)}
      onWheel={(event) => {
        const held = carrying.current;
        if (!held) return;
        event.stopPropagation();
        // Mouse wheel while holding: away or closer.
        held.distance = Math.max(0.3, held.distance * (event.deltaY > 0 ? 1.08 : 1 / 1.08));
        carryTo(held.ray);
      }}
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
