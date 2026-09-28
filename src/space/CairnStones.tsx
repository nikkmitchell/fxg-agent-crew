import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { applyCairnEvent, emptyCairn, stoneHeights, type Cairn } from "../../shared/cairn";
import { onCairnChange } from "./cairn-events";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE CAIRN (shared/cairn.ts): a flat base stone on the left of the room with
 * a pile of loose stones beside it. Tap the pile and a stone goes on top of the
 * cairn, for everyone, settling with its own tilt; tap the top stone to lift it
 * off. It stays, and grows over days.
 */

export const CAIRN_AT = { x: -4.5, z: 5.9 } as const;
const BASE = 0.12;
const TONES = ["#6f6a62", "#57534d", "#807a70", "#4a4743"] as const;

export function CairnStones() {
  const [cairn, setCairn] = useState<Cairn>(emptyCairn);
  const current = useRef(cairn);
  current.current = cairn;
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(() => {
    space.cairn().then((answer) => {
      current.current = answer.cairn;
      setCairn(answer.cairn);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onCairnChange((event) => {
        const next = applyCairnEvent(current.current, event);
        if (next) {
          current.current = next;
          setCairn(next);
        } else read();
      }),
    [read],
  );

  const heights = useMemo(() => stoneHeights(cairn.stones), [cairn]);
  const change = (action: "add" | "lift") => {
    setNote(null);
    space.changeCairn(action === "add" ? { action, seed: Math.random() } : { action }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "It would not balance."));
  };
  const facing = Math.atan2(ROOM.spawn.x - CAIRN_AT.x, ROOM.spawn.z - CAIRN_AT.z);

  return (
    <group position={[CAIRN_AT.x, 0, CAIRN_AT.z]}>
      {/* The flat base stone. */}
      <mesh position={[0, BASE / 2, 0]} scale={[0.26, BASE / 2, 0.22]} raycast={() => null}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color="#5f5a53" roughness={0.95} />
      </mesh>
      {/* The stones people have stacked; the top one lifts off at a tap. */}
      {cairn.stones.map((stone, index) => {
        const top = index === cairn.stones.length - 1;
        return (
          <mesh
            key={index}
            position={[stone.dx, BASE + heights[index], stone.dz]}
            rotation={[0.08 * Math.sin(stone.turn * 3), stone.turn, 0.08 * Math.cos(stone.turn * 2)]}
            scale={[stone.size, stone.size * 0.55, stone.size * 0.85]}
            onClick={top ? (event) => { event.stopPropagation(); change("lift"); } : undefined}
            raycast={top ? undefined : () => null}
          >
            <sphereGeometry args={[1, 14, 8]} />
            <meshStandardMaterial color={TONES[stone.tone % TONES.length]} roughness={0.9} flatShading />
          </mesh>
        );
      })}
      {/* The pile of loose stones: tap it to add one. */}
      <group
        position={[Math.cos(facing) * 0.4, 0, -Math.sin(facing) * 0.4]}
        onClick={(event) => {
          event.stopPropagation();
          change("add");
        }}
      >
        {[[0, 0.04, 0, 0.06], [0.07, 0.03, 0.04, 0.045], [-0.05, 0.03, 0.05, 0.05], [0.02, 0.08, 0.02, 0.04]].map(([x, y, z, s], i) => (
          <mesh key={i} position={[x, y, z]} scale={[s, s * 0.6, s * 0.85]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color={TONES[i % TONES.length]} roughness={0.9} flatShading />
          </mesh>
        ))}
      </group>
      <Text position={[0, 0.9 + cairn.stones.length * 0.06, 0]} rotation={[0, facing, 0]} fontSize={0.04} color="#d8d2c4" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
        {note ?? (cairn.stones.length ? `cairn · ${cairn.stones.length} stones · tap the pile to add one` : "CAIRN · tap the pile to place the first stone")}
      </Text>
    </group>
  );
}
