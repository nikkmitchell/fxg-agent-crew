import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  AGENT_SCREEN,
  SCREEN_LIMITS,
  agentScreenPose,
  agentScreenShown,
  screenLabel,
  screenPlacement,
  screenSize,
  type ScreenSummary,
} from "../../shared/screens";
import type { WirePerson } from "../../shared/space-wire";
import { makeLabelTexture } from "./label-texture";

/**
 * Everybody's shared screen: a person's in a row above the panels, an agent's
 * in front of the agent while it works (see AgentScreen).
 *
 * Nikk: "inside of the our saha.ing room it could display that on a virtual
 * screen, and could also display everyone elses." Each person sharing gets one
 * screen showing the latest picture of theirs, refreshed about once a second.
 *
 * DRAWN IN BOTH THE WINDOW AND THE HEADSET. The panels are live pages in a
 * window and photographs in a headset because DOM is not composited into an
 * immersive frame. A screen is a texture on a plane either way, so it is the
 * same thing in both, and nobody has to take a headset off to see it.
 *
 * NOTHING AT ALL WHEN NOBODY IS SHARING. An empty frame labelled "no screens"
 * would be a permanent sign above the boards for a feature most of the time
 * idle.
 */

/** The decoded picture's own size is kept, because an agent's screen and a wall screen are sized differently. */
type Shown = { texture: THREE.Texture; imageWidth: number; imageHeight: number; seq: number };

function useSharedScreens(base: string): { screens: ScreenSummary[]; shown: Map<string, Shown> } {
  const [screens, setScreens] = useState<ScreenSummary[]>([]);
  const [shown, setShown] = useState<Map<string, Shown>>(new Map());
  const held = useRef<Map<string, Shown>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let list: ScreenSummary[];
      try {
        const response = await fetch(`${base}/bff/space/screens`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        list = ((await response.json()) as { screens: ScreenSummary[] }).screens;
      } catch {
        return;
      }
      if (cancelled) return;
      setScreens(list);

      // Forget and free anybody who has stopped sharing. A texture kept for a
      // screen nobody is showing is a megabyte of GPU memory per person, held
      // for as long as somebody wears the headset.
      const live = new Set(list.map((screen) => screen.actorId));
      let changed = false;
      for (const [actorId, entry] of held.current) {
        if (!live.has(actorId)) {
          entry.texture.dispose();
          held.current.delete(actorId);
          changed = true;
        }
      }
      if (changed) setShown(new Map(held.current));

      for (const screen of list) {
        // ONLY WHEN THERE IS A NEW FRAME, and never two fetches for one person
        // at once — a slow network would otherwise stack requests a second
        // apart until the tab fell over.
        if (held.current.get(screen.actorId)?.seq === screen.seq) continue;
        if (inFlight.current.has(screen.actorId)) continue;
        inFlight.current.add(screen.actorId);
        void (async () => {
          try {
            const response = await fetch(
              // The sequence number makes every frame its own address, which
              // Nikk asked for alongside no-store: "Otherwise browsers/CDNs may
              // happily give your XR app the previous image."
              `${base}/bff/space/screens/${encodeURIComponent(screen.actorId)}/frame?v=${screen.seq}`,
              { credentials: "same-origin", cache: "no-store" },
            );
            if (!response.ok || cancelled) return;
            /**
             * DECODED THROUGH AN <img>, NOT createImageBitmap — the same choice
             * StillPanel made after a Quest drew its photographs upside down:
             * WebGL's flip flag is not specified to apply to an ImageBitmap,
             * and browsers disagree about it. The object URL is revoked once
             * decoded so a screen refreshing every second does not leak one a
             * second.
             */
            const url = URL.createObjectURL(await response.blob());
            let image: HTMLImageElement;
            try {
              image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const element = new Image();
                element.onload = () => resolve(element);
                element.onerror = () => reject(new Error("the frame could not be decoded"));
                element.src = url;
              });
            } finally {
              URL.revokeObjectURL(url);
            }
            if (cancelled) return;
            const texture = new THREE.Texture(image);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = true;
            texture.needsUpdate = true;
            held.current.get(screen.actorId)?.texture.dispose();
            held.current.set(screen.actorId, {
              texture,
              imageWidth: image.naturalWidth,
              imageHeight: image.naturalHeight,
              seq: screen.seq,
            });
            setShown(new Map(held.current));
          } catch {
            // One missed frame is not worth a sentence in the room; the next
            // one is a second away.
          } finally {
            inFlight.current.delete(screen.actorId);
          }
        })();
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), SCREEN_LIMITS.intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [base]);

  useEffect(
    () => () => {
      for (const entry of held.current.values()) entry.texture.dispose();
      held.current.clear();
    },
    [],
  );

  return { screens, shown };
}

function ScreenLabel({ text, width, height = 0.2 }: { text: string; width: number; height?: number }) {
  const texture = useMemo(
    () => makeLabelTexture(text, { pixelsPerLine: 56, lines: 1, aspect: width / height }),
    [text, width, height],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  // Two planes back to back for the same reason as ScreenFace: one plane drawn
  // double-sided reads backwards from behind.
  return (
    <group>
      <mesh raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * The picture, readable from BOTH sides and mirrored from neither.
 *
 * Nikk: "let's make their screens double-sided so you can see it from either
 * side... not like mirrored on the other side but... the texture is being
 * displayed on both sides". A single plane drawn double-sided shows its back
 * as a mirror image — every word backwards. So it is two planes back to back,
 * the rear one turned half a turn, each showing the same picture the right way
 * round to whoever is looking at it.
 */
function ScreenFace({ texture, width, height }: { texture: THREE.Texture; width: number; height: number }) {
  const front = useRef<THREE.MeshBasicMaterial>(null);
  const back = useRef<THREE.MeshBasicMaterial>(null);
  // Going from no map to a map needs a shader recompile, and nothing else asks
  // for one. See StillPanel for the afternoon this cost the first time.
  useEffect(() => {
    if (front.current) front.current.needsUpdate = true;
    if (back.current) back.current.needsUpdate = true;
  }, [texture]);
  return (
    <group>
      {/* A dark bezel, visible from both sides, so a screen showing a white
          page still reads as a screen against a pale wall or passthrough. */}
      <mesh raycast={() => null}>
        <boxGeometry args={[width + 0.05, height + 0.05, 0.02]} />
        <meshBasicMaterial color="#111318" />
      </mesh>
      <mesh position={[0, 0, 0.011]} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={front} map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.011]} rotation={[0, Math.PI, 0]} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={back} map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function WallScreen({ entry, label }: { entry: Shown; label: string }) {
  const size = screenSize(entry.imageWidth, entry.imageHeight);
  return (
    <group>
      <ScreenFace texture={entry.texture} width={size.width} height={size.height} />
      {/* ABOVE THE SCREEN, not below it, where the name crowded the top of the
          board panel. Both names when somebody shared it for an agent. */}
      <group position={[0, size.height / 2 + 0.14, 0]}>
        <ScreenLabel
          text={label}
          width={label.includes("shared by") ? Math.max(size.width, 2.2) : Math.max(size.width * 0.6, 1.2)}
        />
      </group>
    </group>
  );
}

/**
 * An agent's screen, in front of the agent, only while it is working there.
 *
 * Where the agent is and what it is doing are read every frame from the live
 * room rather than from React state, because they change on every snapshot and
 * a re-render ten times a second to move one screen would be waste. It pops in
 * and out by scale rather than blinking, so a screen appearing reads as the
 * agent opening it — and snaps instead when reduced motion is asked for.
 */
function AgentScreen({
  actorId,
  entry,
  label,
  peopleRef,
  reducedMotion,
}: {
  actorId: string;
  entry: Shown;
  label: string;
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const scale = useRef(0);
  const size = screenSize(entry.imageWidth, entry.imageHeight, AGENT_SCREEN);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    const key = actorId.toLowerCase();
    const person = (peopleRef.current ?? []).find((candidate) => candidate.actorId.toLowerCase() === key);
    const wanted = person && agentScreenShown(person) ? 1 : 0;
    if (person) {
      const pose = agentScreenPose(person.at, person.facing);
      node.position.set(pose.position.x, pose.position.y, pose.position.z);
      node.rotation.set(0, pose.rotationY, 0);
    }
    scale.current = reducedMotion
      ? wanted
      : scale.current + (wanted - scale.current) * Math.min(1, delta * 9);
    if (Math.abs(wanted - scale.current) < 0.005) scale.current = wanted;
    node.visible = scale.current > 0.01;
    node.scale.setScalar(Math.max(scale.current, 0.001));
  });

  return (
    <group ref={group} visible={false}>
      <ScreenFace texture={entry.texture} width={size.width} height={size.height} />
      <group position={[0, size.height / 2 + 0.1, 0]}>
        <ScreenLabel text={label} width={Math.max(size.width, label.includes("shared by") ? 1.6 : 0.9)} height={0.13} />
      </group>
    </group>
  );
}

export function ScreenWall({
  base,
  peopleRef,
  reducedMotion,
}: {
  base: string;
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  const { screens, shown } = useSharedScreens(base);
  // Only people whose first frame has actually decoded — a bezel around
  // nothing is not a screen.
  const ready = screens.filter((screen) => shown.has(screen.actorId));
  /**
   * AGENTS' SCREENS GO TO THE AGENT; EVERYONE ELSE'S STAY IN THE ROW.
   *
   * Nikk asked for agents' screens to stop floating above everybody. A
   * person's screen is left in the row on purpose: a screen hung in front of
   * somebody wearing a headset would sit in their own line of sight, and an
   * actor whose kind was never declared might be a person.
   *
   * An agent is one if the server's list says so, or failing that the live
   * room does (read at each render, which the one-second refresh provides). An
   * agent's screen never falls back to the row: while the agent is not in the
   * room there is nobody to put it in front of, so it simply does not show.
   */
  const agentIds = new Set(
    (peopleRef.current ?? []).filter((person) => person.kind === "agent").map((person) => person.actorId.toLowerCase()),
  );
  const isAgent = (screen: ScreenSummary) => screen.kind === "agent" || agentIds.has(screen.actorId.toLowerCase());
  const row = ready.filter((screen) => !isAgent(screen));
  const agents = ready.filter(isAgent);

  return (
    <group>
      {row.map((screen, index) => {
        const entry = shown.get(screen.actorId);
        if (!entry) return null;
        const place = screenPlacement(index, row.length);
        return (
          <group
            key={screen.actorId}
            position={[place.position.x, place.position.y, place.position.z]}
            rotation={[0, place.rotationY, 0]}
          >
            <WallScreen entry={entry} label={screenLabel(screen)} />
          </group>
        );
      })}
      {agents.map((screen) => {
        const entry = shown.get(screen.actorId);
        if (!entry) return null;
        return (
          <AgentScreen
            key={screen.actorId}
            actorId={screen.actorId}
            entry={entry}
            label={screenLabel(screen)}
            peopleRef={peopleRef}
            reducedMotion={reducedMotion}
          />
        );
      })}
    </group>
  );
}
