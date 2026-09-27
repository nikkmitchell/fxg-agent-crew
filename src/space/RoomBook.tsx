import { Text } from "@react-three/drei";
import type { SessionRecord } from "../../shared/meditation";

/**
 * THE ROOM'S BOOK: a standing page beside the tree listing the latest
 * sessions held here, newest at the top ("21:04 · ARRIVE · 3 min · 2
 * together"). Part of the room remembering (Nightjar's prompt); no names are
 * kept, only how many. Times are in the reader's own clock.
 */
export const BOOK_AT: [number, number, number] = [-1.25, 0, 3.5];
const noRaycast = () => undefined;

export function bookLine(record: SessionRecord, locale?: string): string {
  const when = new Date(record.at);
  const day = when.toLocaleDateString(locale, { weekday: "short" });
  const time = when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const who = record.people === 1 ? "alone" : `${record.people} together`;
  return `${day} ${time} · ${record.what} · ${record.minutes} min · ${who}`;
}

export function RoomBook({ history }: { history: SessionRecord[] }) {
  const lines = [...history].reverse();
  return <group position={BOOK_AT} rotation-y={0.4}>
    {/* A slim stand and a tilted page. */}
    <mesh position={[0, 0.5, 0]} raycast={noRaycast}>
      <boxGeometry args={[0.04, 1, 0.04]} />
      <meshStandardMaterial color="#4a3223" roughness={0.9} />
    </mesh>
    <group position={[0, 1.12, 0.02]} rotation-x={-0.25}>
      <mesh raycast={noRaycast}>
        <planeGeometry args={[0.62, 0.5]} />
        <meshStandardMaterial color="#efe6d2" roughness={0.95} />
      </mesh>
      <Text position={[0, 0.2, 0.002]} fontSize={0.03} color="#3a2a1c" raycast={noRaycast}>THE ROOM'S BOOK</Text>
      <Text position={[0, 0.15, 0.002]} fontSize={0.016} color="#6b5642" raycast={noRaycast}>sessions held here, newest first</Text>
      <Text position={[-0.28, 0.11, 0.002]} anchorX="left" anchorY="top" fontSize={0.019} lineHeight={1.45} maxWidth={0.56} color="#3a2a1c" raycast={noRaycast}>
        {lines.length === 0 ? "Nothing written yet. The first session here will be the first line." : lines.map((one) => bookLine(one)).join("\n")}
      </Text>
    </group>
  </group>;
}
