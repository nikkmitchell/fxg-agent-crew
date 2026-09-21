import { useMemo, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { CARD_INK } from "../../shared/card-paint";
import { KEY, buildKeyboard, emptyTyping, press, type Key, type Typing } from "../../shared/keyboard-3d";
import { claimPointer } from "./pointer-claim";

/**
 * A keyboard you can reach, drawn in the room.
 *
 * WHY IT EXISTS: an immersive session has no DOM, so there is no input to type
 * into and no system keyboard to raise. Without this, "add a task" and "write a
 * comment" are things you can only do in a window — which is the two-rooms
 * problem again, in the one place it would be most obvious.
 *
 * IT IS THE SAME KEYBOARD IN BOTH. On a desktop the hardware keyboard is
 * better and `Typing3D` below listens for it as well, but the on-screen one
 * still works with a mouse, so nothing has to be explained twice and nothing
 * can drift.
 *
 * The layout, the hit-testing and what a press MEANS live in
 * `shared/keyboard-3d.ts` and are tested without a renderer. This draws it.
 */

function KeyCap({ item, onPress }: { item: Key; onPress: (key: Key) => void }) {
  const [down, setDown] = useState(false);
  const action = item.action !== undefined;
  return (
    <group position={[item.x, item.y, 0]}>
      <mesh
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          claimPointer(event.nativeEvent);
          setDown(true);
          // ON PRESS, NOT ON RELEASE. Typing wants the letter the moment the
          // key goes down; waiting for the release makes a keyboard feel slow
          // in a way people describe as "laggy" rather than "deliberate".
          onPress(item);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setDown(false);
        }}
        onPointerLeave={() => setDown(false)}
      >
        <planeGeometry args={[item.width, item.height]} />
        <meshBasicMaterial
          color={down ? CARD_INK.accent : action ? "#2b3245" : "#3a4256"}
          toneMapped={false}
        />
      </mesh>
      <Text
        position={[0, 0, 0.002]}
        fontSize={action ? item.height * 0.3 : item.height * 0.45}
        color={down ? "#ffffff" : "#e9e6de"}
        anchorX="center"
        anchorY="middle"
      >
        {item.label}
      </Text>
    </group>
  );
}

export function Keyboard3D({
  typing,
  onChange,
  position = [0, 0, 0],
}: {
  typing: Typing;
  onChange: (next: Typing) => void;
  position?: [number, number, number];
}) {
  const board = useMemo(() => buildKeyboard(typing.mode, typing.shifted), [typing.mode, typing.shifted]);
  return (
    <group position={position}>
      {/* A backing plate, so the keys read as one object rather than as
          floating tiles with the room showing between them. */}
      <mesh position={[0, -board.height / 2 + KEY.size / 2 + KEY.gap, -0.004]}>
        <planeGeometry args={[board.width + KEY.gap * 3, board.height + KEY.gap * 3]} />
        <meshBasicMaterial color="#14161d" transparent opacity={0.94} toneMapped={false} />
      </mesh>
      {board.keys.map((item) => (
        <KeyCap key={`${item.value}-${item.x}-${item.y}`} item={item} onPress={(key) => onChange(press(typing, key))} />
      ))}
    </group>
  );
}

export const startTyping = emptyTyping;
