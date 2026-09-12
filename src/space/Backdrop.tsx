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
  y,
  tone = "normal",
  onTap,
}: {
  label: string;
  y: number;
  tone?: "normal" | "muted" | "live";
  onTap: () => void;
}) {
  const texture = useMemo(
    () => makeLabelTexture(label, { pixelsPerLine: 38, lines: 2 }),
    [label],
  );
  const colour = tone === "live" ? "#6f86c9" : tone === "muted" ? "#2a2f3a" : "#1b2231";
  return (
    <group position={[0, y, 0]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onTap();
        }}
      >
        <planeGeometry args={[WRIST_BUTTON.width, WRIST_BUTTON.height]} />
        <meshBasicMaterial color={colour} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      {texture ? (
        <mesh position={[0, 0, 0.001]} raycast={() => null}>
          <planeGeometry args={[WRIST_BUTTON.width, WRIST_BUTTON.height]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}
