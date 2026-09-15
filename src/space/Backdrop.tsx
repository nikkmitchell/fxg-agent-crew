import { useMemo } from "react";
import * as THREE from "three";
import { makeLabelTexture } from "./label-texture";

/**
 * Black void, or the room you are actually standing in.
 *
 * WHY THIS IS A SPHERE AND NOT A SETTING. Whether a headset shows passthrough
 * is fixed when the session starts: an `immersive-ar` session blends what the
 * cameras see behind whatever we draw, an `immersive-vr` session does not, and
 * nothing can change that without ending the session and asking again. Ending
 * it means the room disappearing and coming back, which is a horrible answer to
 * "I would rather not see my kitchen".
 *
 * So the session is always `immersive-ar` where the device has it, and the
 * black void is a thing we DRAW: a sphere around the room, painted on the
 * inside. Hiding it shows the room you are in; showing it is the void. The
 * toggle is instant and costs one draw call.
 */
export function VoidSphere() {
  // Inside the camera's far plane (60) and outside the room's far corner
  // (~15m), so it encloses everything without being clipped away.
  return (
    <mesh>
      <sphereGeometry args={[26, 24, 16]} />
      <meshBasicMaterial color="#0b0d12" side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

/**
 * One button on the wrist panel.
 *
 * A plain mesh with an `onClick`, which in a session means a controller ray or
 * a pinch — the same gesture that works everything else, so there is nothing
 * new to learn and nothing that needs a thumbstick.
 */
export const WRIST_BUTTON = { width: 0.3, height: 0.075, gap: 0.012 } as const;

/**
 * A rectangle with rounded corners, centred on the origin.
 *
 * ROUNDED LIKE A PHONE'S ICONS. Nikk: "make them have kind of the rounded edges
 * like on the iPhone... rounded corners". About a fifth of the shorter side,
 * which reads as a soft square on the hip controls and as a gently rounded pill
 * on a long menu row, from the same rule.
 */
export function roundedRect(width: number, height: number, radius = Math.min(width, height) * 0.22): THREE.Shape {
  const r = Math.min(radius, width / 2, height / 2);
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function WristButton({
  label,
  x = 0,
  y,
  width = WRIST_BUTTON.width,
  height = WRIST_BUTTON.height,
  /** Bigger text for a label that is a symbol rather than a sentence. */
  glyph = false,
  tone = "normal",
  /** How many lines a sentence may wrap to. */
  lines = 2,
  onTap,
}: {
  label: string;
  x?: number;
  y: number;
  width?: number;
  height?: number;
  glyph?: boolean;
  tone?: "normal" | "muted" | "live" | "danger";
  lines?: number;
  onTap: () => void;
}) {
  /**
   * THE TEXTURE IS SHAPED LIKE THE BUTTON, which it was not before.
   *
   * Both meshes below are `width x height`, and the label used to be drawn on a
   * fixed 4:1 canvas whatever that shape was. The gear is square, so its glyph
   * arrived squeezed to a quarter of its width — the "stretched" settings icon.
   */
  const texture = useMemo(
    () =>
      makeLabelTexture(label, {
        // A symbol fills about half the button's height, whatever its shape:
        // 84 pixels was sized for the old wide talk bar, and on a square icon
        // it left a small glyph lost in the middle of the button.
        pixelsPerLine: glyph ? Math.round(Math.min(512, 512 / (width / height)) * 0.48) : 38,
        lines: glyph ? 1 : lines,
        aspect: width / height,
        // Light text straight onto the dark button, with room between lines.
        color: tone === "muted" ? "#c9cedb" : "#f4f6fb",
        halo: false,
        lineSpacing: 1.22,
      }),
    [label, glyph, width, height, tone, lines],
  );
  const shape = useMemo(() => roundedRect(width, height), [width, height]);
  const colour =
    tone === "live" ? "#5b74c4" : tone === "danger" ? "#b4433e" : tone === "muted" ? "#252a35" : "#1b2231";
  return (
    <group position={[x, y, 0]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onTap();
        }}
      >
        <shapeGeometry args={[shape, 6]} />
        <meshBasicMaterial color={colour} transparent opacity={0.92} side={THREE.DoubleSide} />
      </mesh>
      {texture ? (
        <mesh position={[0, 0, 0.001]} raycast={() => null}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * A heading above a group of buttons, and the slab behind the group.
 *
 * WHY THE SETTINGS ARE IN BOXES AT ALL. They used to be a single column, which
 * at eight or ten rows became a strip running from your chin to your knees —
 * Nikk, from inside a headset: "the in VR settings are almost unusable... have
 * it set up in seperate boxes." A column is also the reason the board choices
 * could not be reached: they were at the bottom of it, below the floor.
 *
 * The slab is not decoration. Against passthrough — somebody's actual room —
 * floating text has no ground to sit on and is genuinely hard to read.
 */
export function ButtonBox({
  title,
  x,
  y = 0,
  width,
  height,
  children,
}: {
  title: string;
  x: number;
  y?: number;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const texture = useMemo(() => makeLabelTexture(title, { pixelsPerLine: 34, lines: 1 }), [title]);
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, -height / 2 + 0.06, -0.01]} raycast={() => null}>
        <planeGeometry args={[width + 0.04, height + 0.12]} />
        <meshBasicMaterial color="#0e1118" transparent opacity={0.82} side={THREE.DoubleSide} />
      </mesh>
      {texture ? (
        <mesh position={[0, 0.11, 0]} raycast={() => null}>
          <planeGeometry args={[width, 0.075]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      ) : null}
      {children}
    </group>
  );
}
