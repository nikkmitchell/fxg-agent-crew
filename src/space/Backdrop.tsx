import { useMemo } from "react";
import * as THREE from "three";
import { makeLabelTexture } from "./label-texture";

/**
 * Black void, or the room you are actually standing in.
 *
 * WHY THIS IS A SPHERE AND NOT A SETTING. Whether a headset shows passthrough
 * is fixed when the session starts: an `immersive-ar` session blends what the
 * cameras see behind whatever we draw, an `immersive-vr` session does not, and
 * nothing can change that without ending the session and asking again. Asking
 * again means the room disappearing and coming back, which is a horrible answer
 * to "I would rather not see my kitchen".
 *
 * So the session is always `immersive-ar` where the device has it, and the
 * black void is a thing we DRAW: a sphere around the room, painted on the
 * inside. Hiding it shows the kitchen; showing it is the void Nikk asked for
 * originally. The toggle is instant and costs one draw call.
 *
 * On a device with no passthrough at all the sphere changes nothing — the
 * session is black behind it either way — and the button says so rather than
 * pretending to have done something.
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
 * The switch, within reach.
 *
 * It hangs off the player rather than sitting somewhere in the room, because a
 * control you have to walk back to is a control you do not use. Down and to the
 * left, roughly where you would wear a watch: out of the way of the boards,
 * found by looking down.
 *
 * It is a plain mesh with an `onClick`, which in a session means a controller
 * ray or a pinch — the same gesture that works everything else, so there is
 * nothing new to learn and nothing that needs a thumbstick.
 */
export function PassthroughButton({
  passthrough,
  supported,
  onToggle,
}: {
  passthrough: boolean;
  /** False when the session is not one that can show passthrough at all. */
  supported: boolean;
  onToggle: () => void;
}) {
  const label = useMemo(() => {
    const text = !supported
      ? "No passthrough here"
      : passthrough
        ? "Passthrough — tap for void"
        : "Black void — tap for passthrough";
    return makeLabelTexture(text, { pixelsPerLine: 38, lines: 2 });
  }, [passthrough, supported]);

  return (
    <group position={[-0.28, 0.95, -0.42]} rotation={[-0.5, 0.35, 0]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          if (supported) onToggle();
        }}
      >
        <planeGeometry args={[0.3, 0.075]} />
        <meshBasicMaterial
          color={supported ? "#1b2231" : "#2a2a2a"}
          transparent
          opacity={0.88}
          side={THREE.DoubleSide}
        />
      </mesh>
      {label ? (
        <mesh position={[0, 0, 0.001]} raycast={() => null}>
          <planeGeometry args={[0.3, 0.075]} />
          <meshBasicMaterial map={label} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}
