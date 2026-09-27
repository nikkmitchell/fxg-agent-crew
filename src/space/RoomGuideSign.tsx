import { Text } from "@react-three/drei";
import { ROOM_GUIDE, arrowTo, stepsTo } from "../../shared/room-guide";

/**
 * THE ROOM GUIDE SIGN (shared/room-guide.ts): a standing board just ahead of
 * where people arrive, listing what the room holds and which way each is, so
 * nobody has to stumble on the tea table behind them or the rain in the far
 * corner. Arrows are from the arrival point, facing the orb.
 */
export const SIGN_AT: [number, number, number] = [-0.95, 0, 5.55];
const noRaycast = () => undefined;

export function RoomGuideSign() {
  const lines = ROOM_GUIDE.map((one) => `${one.name} · ${one.what} · ${arrowTo(one)}, ${stepsTo(one)} steps`);
  return <group position={SIGN_AT} rotation-y={0.95}>
    <mesh position={[0, 0.55, -0.02]} raycast={noRaycast}>
      <boxGeometry args={[0.04, 1.1, 0.04]} />
      <meshStandardMaterial color="#4a3223" roughness={0.9} />
    </mesh>
    <group position={[0, 1.35, 0]}>
      <mesh raycast={noRaycast}>
        <planeGeometry args={[0.95, 0.9]} />
        <meshBasicMaterial color="#10181c" transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <Text position={[0, 0.39, 0.002]} fontSize={0.036} color="#f2d59a" raycast={noRaycast}>WHAT IS HERE</Text>
      <Text position={[0, 0.345, 0.002]} fontSize={0.017} color="#9fb6c9" raycast={noRaycast}>directions from where you arrive, facing the orb · look up for the star map</Text>
      <Text position={[-0.44, 0.31, 0.002]} anchorX="left" anchorY="top" fontSize={0.02} lineHeight={1.5} maxWidth={0.88} color="#eefaf7" raycast={noRaycast}>
        {lines.join("\n")}
      </Text>
    </group>
  </group>;
}
