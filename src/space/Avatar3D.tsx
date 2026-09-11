import { useMemo } from "react";
import * as THREE from "three";
import { avatarRecipe } from "../avatar";
import { makeLabelTexture } from "./label-texture";
import { BODY_HEIGHT, bodySpec, ringIsBroken } from "./avatar-shape";

/**
 * A person, in three dimensions.
 *
 * Built from the SAME `avatarRecipe` as the tile on the People page, so the
 * figure across the room and the mark beside a comment are recognisably one
 * identity. No second art pipeline, nothing to keep in sync by hand.
 *
 * WHAT THE FIGURE IS ALLOWED TO SAY, unchanged from `Identity.tsx`:
 * shape carries kind — a round body is a human, a square-shouldered one an
 * agent, and an actor whose kind we were never told gets neither. It gets a
 * broken ring at its feet, which is the 3D equivalent of the dashed outline,
 * and it must READ as unknown rather than quietly defaulting to human. Three of
 * the five actors in the live database are in exactly that state.
 *
 * Colour and motif still say nothing. They are identity, not status.
 */

export type Avatar3DProps = {
  actorId: string;
  kind: "human" | "agent" | null;
  /** True while a live socket is attached. Agents placed by activity have none. */
  connected: boolean;
  /**
   * What put them here, in the server's words. Null means we have no recent
   * evidence — which is NOT idle, and is therefore shown as nothing at all
   * rather than as a label saying so.
   */
  because: string | null;
};

/** The name, cached per actor. */
function useNameTexture(actorId: string): THREE.CanvasTexture | null {
  return useMemo(() => makeLabelTexture(actorId), [actorId]);
}

const HEAD_RADIUS = 0.17;
export const EYE_HEIGHT = 1.62;

export function Avatar3D({ actorId, kind, connected, because }: Avatar3DProps) {
  const recipe = useMemo(() => avatarRecipe(actorId), [actorId]);
  const nameTexture = useNameTexture(actorId);
  // Keyed on the sentence, so the texture is rebuilt when the reason changes
  // and not on any other render.
  const becauseTexture = useMemo(
    () => (because ? makeLabelTexture(because, { pixelsPerLine: 44 }) : null),
    [because],
  );

  // Shape carries kind — the rule itself lives in ./avatar-shape.ts so it can
  // be tested without standing up a renderer.
  const body = useMemo(() => {
    const spec = bodySpec(kind);
    return spec.shape === "boxy"
      ? new THREE.BoxGeometry(spec.width, BODY_HEIGHT, spec.depth)
      : new THREE.CylinderGeometry(spec.radiusTop, spec.radiusBottom, BODY_HEIGHT, spec.segments);
  }, [kind]);

  return (
    <group>
      <mesh geometry={body} position={[0, BODY_HEIGHT / 2 + 0.08, 0]} castShadow>
        <meshStandardMaterial color={recipe.paper} roughness={0.75} />
      </mesh>

      {/* The motif band. Decoration, and the only thing the accent colour is
          used for — exactly as on the 2D tile. */}
      <mesh position={[0, BODY_HEIGHT * 0.78, 0]}>
        <torusGeometry args={[kind === "agent" ? 0.3 : 0.28, 0.035, 8, 24]} />
        <meshStandardMaterial color={recipe.accent} roughness={0.5} />
      </mesh>

      <mesh position={[0, BODY_HEIGHT + 0.08 + HEAD_RADIUS, 0]} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 20, 16]} />
        <meshStandardMaterial color={recipe.paper} roughness={0.7} />
      </mesh>

      {/* Which way they are facing, shown on the figure itself. Without this a
          cylinder gives no clue, and "who is looking at the board" is one of
          the few things this room exists to make visible. */}
      <mesh position={[0, BODY_HEIGHT + 0.08 + HEAD_RADIUS, HEAD_RADIUS * 0.92]}>
        <boxGeometry args={[0.14, 0.05, 0.02]} />
        <meshStandardMaterial color={recipe.ink} roughness={0.4} />
      </mesh>

      {/* The floor ring. Solid for a declared kind; broken for one we were
          never given. The gaps are the dashed outline from the 2D avatar,
          carried across so the two pictures make the same claim. */}
      {ringIsBroken(kind) ? (
        [0, 1, 2, 3, 4, 5].map((index) => (
          <mesh
            key={index}
            position={[0, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, (index * Math.PI) / 3]}
          >
            <ringGeometry args={[0.38, 0.44, 12, 1, 0, Math.PI / 5]} />
            <meshBasicMaterial color={recipe.accent} side={THREE.DoubleSide} />
          </mesh>
        ))
      ) : (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.44, 32]} />
          <meshBasicMaterial
            color={recipe.accent}
            side={THREE.DoubleSide}
            // A figure with no live socket is a placement derived from activity,
            // not someone looking at the room. Drawn fainter, and said in text
            // in the roster beside the scene — the dimming alone is not a claim
            // anybody could read reliably.
            transparent
            opacity={connected ? 1 : 0.45}
          />
        </mesh>
      )}

      {/* Why they are standing here, under their name. Absent when we do not
          know, because an empty label is honest and "idle" would not be. */}
      {becauseTexture ? (
        <sprite position={[0, BODY_HEIGHT + 0.34, 0]} scale={[1.0, 0.25, 1]}>
          <spriteMaterial map={becauseTexture} transparent depthWrite={false} />
        </sprite>
      ) : null}

      {/* The name, always facing the reader. A figure you cannot identify is
          decoration. */}
      {nameTexture ? (
        <sprite position={[0, BODY_HEIGHT + 0.52, 0]} scale={[1.1, 0.275, 1]}>
          <spriteMaterial map={nameTexture} transparent depthWrite={false} />
        </sprite>
      ) : (
        <sprite position={[0, BODY_HEIGHT + 0.62, 0]} scale={[0.5, 0.5, 1]}>
          <spriteMaterial color={recipe.ink} />
        </sprite>
      )}
    </group>
  );
}
