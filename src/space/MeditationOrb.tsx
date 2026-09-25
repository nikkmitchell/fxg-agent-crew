import { useEffect, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  MINUTES, PATTERNS, PATTERN_IDS, PHASE_WORDS, breathAt, clockOffset, clockText, doneLine,
  type Meditation, type MeditationChange,
} from "../../shared/meditation";
import { space } from "../space-client";
import { bell, cueFor, phaseCue } from "./breath-sound";

/**
 * The breathing orb. Nikk (4649): "the full AR meditation experience".
 *
 * BUILT FOR PASSTHROUGH. The room opens as `immersive-ar`, so behind this is
 * the person's own room. The orb is light, not an object: additive glow shells
 * and no solid surface, so it floats in a real room without hiding it.
 *
 * Where it stands: a step and a half in from the door (spawn, z 6.2), well in
 * front of the Go tables (z 1.8) and the walls, at eye height, facing the door.
 */
export const ORB_AT: [number, number, number] = [0, 1.5, 4.7];
const SMALL = 0.16;
const LARGE = 0.34;

const noRaycast = () => undefined;

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Calm teal on the in-breath, warm on the hold, soft violet going out. */
const PHASE_COLOUR = { in: "#8fe3d6", hold: "#f2d59a", out: "#b9a8ff", rest: "#9fb6c9" } as const;

function OrbButton({ label, at, onTap, width = 0.26, selected = false }: {
  label: string; at: [number, number, number]; onTap: () => void; width?: number; selected?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const colour = selected ? "#f2d59a" : "#dff6f2";
  const height = 0.085;
  const stroke = 0.004;
  return <group position={at} onClick={(event) => { event.stopPropagation(); onTap(); }}
    onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
    {/* The whole button is a target; only a hint of fill until pointed at. */}
    <mesh><planeGeometry args={[width, height]} /><meshBasicMaterial color={colour} transparent opacity={hover ? 0.2 : selected ? 0.1 : 0.02} depthWrite={false} /></mesh>
    {[[0, height / 2, width, stroke], [0, -height / 2, width, stroke], [width / 2, 0, stroke, height], [-width / 2, 0, stroke, height]].map(([x, y, w, h], index) =>
      <mesh key={index} position={[x, y, 0.001]} raycast={noRaycast}><planeGeometry args={[w, h]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>)}
    <Text position-z={0.002} fontSize={0.034} color={colour} raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">{label}</Text>
  </group>;
}

export function MeditationOrb({ meditation, onMeditation, reducedMotion }: {
  meditation: Meditation;
  /** Apply the session as the server just answered with it. */
  onMeditation: (session: Meditation) => void;
  reducedMotion: boolean;
}) {
  const { invalidate } = useThree();
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.CanvasTexture | null>(null);
  glow.current ??= glowTexture();
  /** Server clock minus ours, so every device reads the same breath. */
  const offset = useRef(0);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [, redraw] = useState(0);

  useEffect(() => {
    let alive = true;
    const sent = Date.now();
    space.meditation().then((answer) => {
      if (!alive) return;
      offset.current = clockOffset(answer.now, sent, Date.now());
      onMeditation(answer.meditation);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [onMeditation]);

  const change = (body: MeditationChange) => {
    setTrouble(null);
    const sent = Date.now();
    space.meditate({ ...body, revision: meditation.revision }).then((answer) => {
      offset.current = clockOffset(answer.now, sent, Date.now());
      onMeditation(answer.meditation);
    }).catch((error: { message?: string }) => {
      // Say why, then catch up: a refusal usually means the session moved on.
      setTrouble(error?.message ?? "That did not work. Try again.");
      const again = Date.now();
      space.meditation().then((answer) => {
        offset.current = clockOffset(answer.now, again, Date.now());
        onMeditation(answer.meditation);
      }).catch(() => undefined);
    });
  };

  const now = () => Date.now() + offset.current;
  const breath = breathAt(meditation, now());
  const phaseKey = breath.state === "breathing" ? breath.phase : "rest";
  // Text changes once a second at most; the orb itself moves every frame.
  const lastSecond = useRef("");
  /** Tones on or off, for this person only: a room can be quiet for one and not another. */
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem("orb-sound") !== "off"; } catch { return true; }
  });
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const lastBreath = useRef<ReturnType<typeof breathAt> | null>(null);

  useFrame(() => {
    const at = breathAt(meditation, now());
    const fullness = at.state === "breathing" ? at.fullness : at.state === "idle" ? 0.35 : 0;
    const colour = new THREE.Color(PHASE_COLOUR[at.state === "breathing" ? at.phase : "rest"]);
    const radius = SMALL + (LARGE - SMALL) * (reducedMotion ? Math.round(fullness) : fullness);
    core.current?.scale.setScalar(radius);
    (core.current?.material as THREE.MeshBasicMaterial | undefined)?.color.copy(colour);
    halo.current?.scale.setScalar(radius * 5.2);
    (halo.current?.material as THREE.SpriteMaterial | undefined)?.color.copy(colour);
    if (ring.current && at.state === "breathing") {
      // Grows from the left end: scaled, then shifted so its left edge stays put.
      const through = Math.max(0.001, 1 - at.remaining / (meditation.minutes * 60));
      ring.current.scale.x = through;
      ring.current.position.x = -0.4 + 0.4 * through;
    }
    const cue = cueFor(lastBreath.current, at);
    lastBreath.current = at;
    if (cue && soundRef.current) (cue === "bell" ? bell() : phaseCue(cue));
    const second = at.state === "breathing" ? `${at.phase}${at.secondsLeft}${Math.ceil(at.remaining)}${at.paused}` : at.state;
    if (second !== lastSecond.current) { lastSecond.current = second; redraw((n) => n + 1); }
    // The scene draws on demand; a breath is motion, so keep asking while it runs.
    if (at.state === "breathing" && !at.paused) invalidate();
  });

  const running = breath.state === "breathing";
  const [x, y, z] = ORB_AT;

  return <group position={[x, y, z]}>
    <mesh ref={core} raycast={noRaycast}>
      <sphereGeometry args={[1, 48, 32]} />
      <meshBasicMaterial color={PHASE_COLOUR[phaseKey]} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    <sprite ref={halo} raycast={noRaycast}>
      <spriteMaterial map={glow.current} color={PHASE_COLOUR[phaseKey]} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>

    {/* The words sit above; the controls hang below, facing the door. */}
    <Text position={[0, 0.52, 0]} fontSize={0.085} color="#eefaf7" raycast={noRaycast} outlineWidth={0.004} outlineColor="#0b1418">
      {breath.state === "breathing" ? (breath.paused ? "PAUSED" : `${PHASE_WORDS[breath.phase]}  ${breath.secondsLeft}`)
        : breath.state === "done" ? "WELL DONE" : "BREATHE TOGETHER"}
    </Text>
    <Text position={[0, 0.43, 0]} fontSize={0.038} color="#cfe7e3" raycast={noRaycast} outlineWidth={0.002} outlineColor="#0b1418">
      {breath.state === "breathing" ? `${clockText(breath.remaining)} left · ${PATTERNS[meditation.pattern].label}`
        : breath.state === "done" ? doneLine(meditation)
        : `${PATTERNS[meditation.pattern].label} · ${meditation.minutes} MIN`}
    </Text>

    {/* How far through the session: a thin line that fills left to right. */}
    {running && <group position={[0, -0.42, 0]}>
      <mesh raycast={noRaycast}><planeGeometry args={[0.8, 0.006]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.15} depthWrite={false} /></mesh>
      <mesh ref={ring} raycast={noRaycast} position-z={0.001}>
        <planeGeometry args={[0.8, 0.008]} /><meshBasicMaterial color="#8fe3d6" toneMapped={false} />
      </mesh>
    </group>}

    <group position={[0, -0.52, 0.02]}>
      {running
        ? <>
          <OrbButton label={breath.paused ? "RESUME" : "PAUSE"} at={[-0.15, 0, 0]} onTap={() => change({ action: breath.paused ? "resume" : "pause" })} />
          <OrbButton label="END" at={[0.15, 0, 0]} onTap={() => change({ action: "end" })} />
        </>
        : <>
          {PATTERN_IDS.map((id, index) => <OrbButton key={id} label={PATTERNS[id].label} width={0.3}
            at={[(index - 1) * 0.32, 0.1, 0]} selected={meditation.pattern === id} onTap={() => change({ action: "settings", pattern: id })} />)}
          {MINUTES.map((minutes, index) => <OrbButton key={minutes} label={`${minutes} MIN`} width={0.14}
            at={[(index - 1.5) * 0.16, 0, 0]} selected={meditation.minutes === minutes} onTap={() => change({ action: "settings", minutes })} />)}
          <OrbButton label={breath.state === "done" ? "AGAIN" : "START"} width={0.4} at={[0, -0.1, 0]} onTap={() => change({ action: "start" })} />
        </>}
      <OrbButton label={sound ? "SOUND ON" : "SOUND OFF"} width={0.2} at={[0.52, running ? 0 : -0.1, 0]} selected={sound} onTap={() => {
        const next = !sound;
        setSound(next);
        try { localStorage.setItem("orb-sound", next ? "on" : "off"); } catch { /* per-viewer only */ }
      }} />
      {trouble && <Text position={[0, -0.18, 0]} fontSize={0.026} color="#ffb4a6" raycast={noRaycast}>{trouble}</Text>}
    </group>
  </group>;
}
