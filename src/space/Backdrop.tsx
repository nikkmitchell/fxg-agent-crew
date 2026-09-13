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


export function WristButton({
  label,
  x = 0,
  y,
  width = WRIST_BUTTON.width,
  height = WRIST_BUTTON.height,
  /** Bigger text for a label that is a symbol rather than a sentence. */
  glyph = false,
  tone = "normal",
  onTap,
}: {
  label: string;
  x?: number;
  y: number;
  width?: number;
  height?: number;
  glyph?: boolean;
  tone?: "normal" | "muted" | "live";
  onTap: () => void;
}) {
  const texture = useMemo(
    () => makeLabelTexture(label, { pixelsPerLine: glyph ? 84 : 38, lines: glyph ? 1 : 2 }),
    [label, glyph],
  );
  const colour = tone === "live" ? "#6f86c9" : tone === "muted" ? "#2a2f3a" : "#1b2231";
  return (
    <group position={[x, y, 0]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onTap();
        }}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={colour} transparent opacity={0.9} side={THREE.DoubleSide} />
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
