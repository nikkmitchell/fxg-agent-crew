import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { READINGS } from "../../shared/guided";
import { ROOM_GUIDE, arrowTo, stepsTo } from "../../shared/room-guide";
import * as THREE from "three";
import { TOGGLEABLE } from "../../shared/room-pieces";
import { space } from "../space-client";

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
  // In Mandarin for a browser set to Chinese: the room is used from Shanghai.
  const id = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "welcome-zh" : "welcome";
  const lines = READINGS[id].lines;
  const read = (index: number) => {
    audio.current?.pause();
    if (index >= lines.length) { setLine(null); audio.current = null; return; }
    setLine(index);
    const next = new Audio(`${base.current}/bff/space/readings/${id}/${index}/audio`);
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

export function RoomGuideSign({ hidden }: { hidden: ReadonlySet<string> }) {
  const welcome = useWelcome();
  const down = useRef<number | null>(null);
  return <group position={SIGN_AT} rotation-y={0.95}>
    {/* THE POST STOPS UNDER THE BOARD, and stands behind it. Nikk
        (2026-09-28): the post "flickers". When the board grew for the toggles
        its face landed exactly on the post's front face (both at z = 0), and
        two surfaces in one place flicker. Board bottom: 1.35 - 0.18 - 0.63. */}
    <mesh position={[0, 0.29, -0.035]} raycast={noRaycast}>
      <boxGeometry args={[0.04, 0.58, 0.04]} />
      <meshStandardMaterial color="#4a3223" roughness={0.9} />
    </mesh>
    <group position={[0, 1.35, 0]}>
      <mesh position={[0, -0.18, 0]} raycast={noRaycast}>
        <planeGeometry args={[1.5, 1.26]} />
        <meshBasicMaterial color="#10181c" transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <Text position={[0, 0.39, 0.002]} fontSize={0.036} color="#f2d59a" raycast={noRaycast}>WHAT IS HERE</Text>
      <Text position={[0, 0.345, 0.002]} fontSize={0.017} color="#9fb6c9" raycast={noRaycast}>tap a row to turn it on or off for everyone here · directions from where you arrive</Text>
      {/* HEAR THE WELCOME, again. */}
      <group position={[0.55, 0.39, 0.004]}
        onPointerDown={(event) => { event.stopPropagation(); down.current = event.pointerId; }}
        onPointerUp={(event) => { if (down.current !== event.pointerId) return; event.stopPropagation(); down.current = null; welcome.replay(); }}>
        <mesh><planeGeometry args={[0.28, 0.05]} /><meshBasicMaterial color="#f2d59a" transparent opacity={0.15} depthWrite={false} /></mesh>
        <Text position-z={0.002} fontSize={0.018} color="#f2d59a" raycast={noRaycast}>HEAR THE WELCOME</Text>
      </group>
      {welcome.text && <Text position={[0, 0.56, 0.004]} fontSize={0.028} maxWidth={1.1} textAlign="center" color="#fff6e0" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">{welcome.text}</Text>}
      {/* THE TOGGLES (Nikk, 2026-09-28): every piece, on or off for the whole room. */}
      <ToggleList hidden={hidden} />
    </group>
  </group>;
}

const LIST = { width: 1.44, height: 0.92, y: -0.15, columns: 2 } as const;
const PX_PER_M = 1000;
const ROWS = Math.ceil(TOGGLEABLE.length / LIST.columns);

/** Which row of the list a point on it is, from its uv; null between rows or off the end. */
export function rowAt(u: number, v: number): number | null {
  const column = Math.min(LIST.columns - 1, Math.floor(u * LIST.columns));
  const row = Math.floor((1 - v) * ROWS);
  const index = column * ROWS + row;
  return row >= 0 && row < ROWS && index < TOGGLEABLE.length ? index : null;
}

/**
 * The list as ONE canvas texture on one plane: forty-odd rows as separate
 * texts and buttons would be a hundred draws standing next to where everyone
 * arrives. A tap finds its row from where it landed.
 */
function ToggleList(props: { hidden: ReadonlySet<string> }) {
  const hidden = props.hidden;
  const [note, setNote] = useState<string | null>(null);
  const canvas = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = LIST.width * PX_PER_M;
    element.height = LIST.height * PX_PER_M;
    return element;
  }, []);
  const texture = useMemo(() => {
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 4;
    return made;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const columnWidth = canvas.width / LIST.columns;
    const rowHeight = canvas.height / ROWS;
    TOGGLEABLE.forEach((name, index) => {
      const column = Math.floor(index / ROWS);
      const row = index % ROWS;
      const x = column * columnWidth + 10;
      const y = row * rowHeight;
      const shown = !hidden.has(name);
      // The pill: lit when shown.
      context.fillStyle = shown ? "#5fbf8f" : "#3a4448";
      context.beginPath();
      context.roundRect(x, y + rowHeight * 0.22, 46, rowHeight * 0.56, rowHeight * 0.28);
      context.fill();
      context.fillStyle = "#eefaf7";
      context.beginPath();
      context.arc(shown ? x + 46 - rowHeight * 0.28 : x + rowHeight * 0.28, y + rowHeight / 2, rowHeight * 0.22, 0, Math.PI * 2);
      context.fill();
      const guide = ROOM_GUIDE.find((one) => one.name === name);
      context.font = `600 ${Math.round(rowHeight * 0.5)}px system-ui, sans-serif`;
      context.fillStyle = shown ? "#eefaf7" : "#7d8a8f";
      context.textBaseline = "middle";
      context.fillText(name, x + 58, y + rowHeight / 2);
      if (guide) {
        const width = context.measureText(name).width;
        context.font = `${Math.round(rowHeight * 0.4)}px system-ui, sans-serif`;
        context.fillStyle = shown ? "#9fb6c9" : "#5d696d";
        context.fillText(`${guide.what} · ${arrowTo(guide)}, ${stepsTo(guide)} steps`, x + 66 + width, y + rowHeight / 2, columnWidth - width - 90);
      }
    });
    texture.needsUpdate = true;
  }, [hidden, canvas, texture]);

  const toggle = (index: number | null) => {
    if (index === null) return;
    const name = TOGGLEABLE[index];
    setNote(null);
    space.togglePieces({ name, shown: hidden.has(name) }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "The board did not answer."));
  };
  const all = (shown: boolean) => {
    setNote(null);
    space.togglePieces({ all: shown }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "The board did not answer."));
  };
  return <group>
    <mesh position={[0, LIST.y, 0.002]} onClick={(event) => { event.stopPropagation(); if (event.uv) toggle(rowAt(event.uv.x, event.uv.y)); }}>
      <planeGeometry args={[LIST.width, LIST.height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
    {([["SHOW ALL", true, -0.5], ["HIDE ALL", false, -0.22]] as const).map(([label, shown, x]) =>
      <group key={label} position={[x, 0.39, 0.004]} onClick={(event) => { event.stopPropagation(); all(shown); }}>
        <mesh><planeGeometry args={[0.2, 0.05]} /><meshBasicMaterial color="#9fe0c0" transparent opacity={0.15} depthWrite={false} /></mesh>
        <Text position-z={0.002} fontSize={0.018} color="#bfeedd" raycast={noRaycast}>{label}</Text>
      </group>)}
    {note ? <Text position={[0, LIST.y - LIST.height / 2 - 0.03, 0.004]} fontSize={0.018} color="#f2b09a" raycast={noRaycast}>{note}</Text> : null}
    <Text position={[0.62, LIST.y - LIST.height / 2 - 0.03, 0.004]} fontSize={0.016} color="#9fb6c9" raycast={noRaycast}>{`${TOGGLEABLE.length - hidden.size} of ${TOGGLEABLE.length} shown`}</Text>
  </group>;
}
