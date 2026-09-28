import { useEffect, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { READINGS } from "../../shared/guided";
import { ROOM_GUIDE, arrowTo, stepsTo } from "../../shared/room-guide";

/**
 * THE ROOM GUIDE SIGN (shared/room-guide.ts): a standing board just ahead of
 * where people arrive, listing what the room holds and which way each is, so
 * nobody has to stumble on the tea table behind them or the rain in the far
 * corner. Arrows are from the arrival point, facing the orb.
 */
export const SIGN_AT: [number, number, number] = [-0.95, 0, 5.55];
const noRaycast = () => undefined;

/** Remembered per browser, so the welcome is spoken to a first visit only. */
const WELCOMED = "meditation-welcomed";

/**
 * THE WELCOME. With some thirty things in the room, a first visit is a lot
 * to take in; four short lines, read in the room's voice a few seconds after
 * arriving, say where to start. Once per browser, and again on request.
 */
function useWelcome() {
  const [line, setLine] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const base = useRef("");
  const lines = READINGS.welcome.lines;
  const read = (index: number) => {
    audio.current?.pause();
    if (index >= lines.length) { setLine(null); audio.current = null; return; }
    setLine(index);
    const next = new Audio(`${base.current}/bff/space/readings/welcome/${index}/audio`);
    audio.current = next;
    next.onended = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 1200); };
    next.onerror = () => { window.setTimeout(() => { if (audio.current === next) read(index + 1); }, 5000); };
    void next.play().catch(() => undefined);
  };
  useEffect(() => {
    let timer = 0;
    void import("../router").then((router) => {
      base.current = router.base;
      let seen = true;
      try { seen = localStorage.getItem(WELCOMED) === "yes"; } catch { /* no storage: do not insist */ }
      if (!seen) {
        timer = window.setTimeout(() => {
          try { localStorage.setItem(WELCOMED, "yes"); } catch { /* per-viewer only */ }
          read(0);
        }, 4000);
      }
    }).catch(() => undefined);
    return () => { window.clearTimeout(timer); audio.current?.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { line, text: line === null ? null : lines[line], replay: () => read(0) };
}

export function RoomGuideSign() {
  const welcome = useWelcome();
  const down = useRef<number | null>(null);
  const lines = ROOM_GUIDE.map((one) => `${one.name} · ${one.what} · ${arrowTo(one)}, ${stepsTo(one)} steps`);
  return <group position={SIGN_AT} rotation-y={0.95}>
    <mesh position={[0, 0.55, -0.02]} raycast={noRaycast}>
      <boxGeometry args={[0.04, 1.1, 0.04]} />
      <meshStandardMaterial color="#4a3223" roughness={0.9} />
    </mesh>
    <group position={[0, 1.35, 0]}>
      <mesh raycast={noRaycast}>
        <planeGeometry args={[1.5, 0.9]} />
        <meshBasicMaterial color="#10181c" transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <Text position={[0, 0.39, 0.002]} fontSize={0.036} color="#f2d59a" raycast={noRaycast}>WHAT IS HERE</Text>
      <Text position={[0, 0.345, 0.002]} fontSize={0.017} color="#9fb6c9" raycast={noRaycast}>directions from where you arrive, facing the orb · look up for the star map</Text>
      {/* HEAR THE WELCOME, again. */}
      <group position={[0.55, 0.39, 0.004]}
        onPointerDown={(event) => { event.stopPropagation(); down.current = event.pointerId; }}
        onPointerUp={(event) => { if (down.current !== event.pointerId) return; event.stopPropagation(); down.current = null; welcome.replay(); }}>
        <mesh><planeGeometry args={[0.28, 0.05]} /><meshBasicMaterial color="#f2d59a" transparent opacity={0.15} depthWrite={false} /></mesh>
        <Text position-z={0.002} fontSize={0.018} color="#f2d59a" raycast={noRaycast}>HEAR THE WELCOME</Text>
      </group>
      {welcome.text && <Text position={[0, 0.56, 0.004]} fontSize={0.028} maxWidth={1.1} textAlign="center" color="#fff6e0" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">{welcome.text}</Text>}
      {/* TWO COLUMNS: one list outgrew the board and ran off its foot into
          the air once the room passed thirty pieces. */}
      {[lines.slice(0, Math.ceil(lines.length / 2)), lines.slice(Math.ceil(lines.length / 2))].map((column, index) =>
        <Text key={index} position={[-0.72 + index * 0.73, 0.31, 0.002]} anchorX="left" anchorY="top" fontSize={0.017} lineHeight={1.45} maxWidth={0.7} color="#eefaf7" raycast={noRaycast}>
          {column.join("\n")}
        </Text>)}
    </group>
  </group>;
}
