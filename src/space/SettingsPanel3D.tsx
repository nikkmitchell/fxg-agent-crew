import { useEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  SETTINGS,
  settingsPixels,
  layOutSettings,
  paintSettings,
  settingAt,
  type SettingsItem,
} from "../../shared/settings-3d";
import { drawInk, makeInkCanvas, measureWith } from "./ink-canvas";
import { claimPointer } from "./pointer-claim";

/**
 * The settings panel, in the room.
 *
 * ONE SURFACE, BOTH ROOMS. What used to be here was a wrist menu that only
 * exists inside a headset, so a desktop had no way to change what the room was
 * showing — I proved that by seeding a project, opening the room and finding
 * the board empty with nothing anywhere that could point it at one.
 *
 * ON PRESS-AND-RELEASE, like the add strips and for the same reason: a press
 * that slides off should not change what everybody in the room is looking at.
 */
export function SettingsPanel3D({
  items,
  surface,
  onPress,
}: {
  items: SettingsItem[];
  surface: { width: number; height: number };
  onPress: (id: string) => void;
}) {
  /**
   * The bitmap is shaped like the panel, not a fixed rectangle. A texture on a
   * plane of a different aspect is stretched, not letterboxed — see
   * `settingsPixels`, and the note in `label-aspect.test.ts` that states the
   * rule this component was breaking.
   */
  const px = useMemo(
    () => settingsPixels({ width: surface.width, height: surface.height }),
    [surface.width, surface.height],
  );
  const { canvas, texture } = useMemo(() => makeInkCanvas(px.width, px.height), [px.width, px.height]);
  const invalidate = useThree((state) => state.invalidate);
  const plate = useRef<THREE.Mesh>(null);
  const pressed = useRef<string | null>(null);

  const layout = useMemo(
    () => layOutSettings(items, { ...SETTINGS, width: surface.width, height: surface.height }),
    [items, surface.width, surface.height],
  );

  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawInk(canvas, paintSettings(layout, measureWith(context)));
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, layout]);

  useEffect(() => () => texture.dispose(), [texture]);

  const at = (event: ThreeEvent<PointerEvent>): string | null => {
    const mesh = plate.current;
    if (!mesh) return null;
    // From the POINT, in this panel's own frame — the same rule the board had to
    // learn. One mesh here, but the rule costs nothing and cannot be wrong.
    const local = mesh.worldToLocal(event.point.clone());
    return settingAt(layout, { x: local.x / layout.width + 0.5, y: local.y / layout.height + 0.5 });
  };

  return (
    <group>
      <mesh
        ref={plate}
        onPointerDown={(event) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          pressed.current = at(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          const started = pressed.current;
          pressed.current = null;
          const ending = at(event);
          if (started && ending === started) onPress(started);
        }}
        onPointerLeave={() => {
          pressed.current = null;
        }}
      >
        <planeGeometry args={[surface.width, surface.height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
