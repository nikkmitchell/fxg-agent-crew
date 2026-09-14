import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SCREEN_LIMITS, screenPlacement, screenSize, type ScreenSummary } from "../../shared/screens";
import { makeLabelTexture } from "./label-texture";

/**
 * Everybody's shared screen, in a row above the panels.
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

type Shown = { texture: THREE.Texture; width: number; height: number; seq: number };

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
            const size = screenSize(image.naturalWidth, image.naturalHeight);
            held.current.get(screen.actorId)?.texture.dispose();
            held.current.set(screen.actorId, { texture, width: size.width, height: size.height, seq: screen.seq });
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

function ScreenLabel({ actorId, width }: { actorId: string; width: number }) {
  const height = 0.2;
  const texture = useMemo(
    () => makeLabelTexture(`${actorId}'s screen`, { pixelsPerLine: 56, lines: 1, aspect: width / height }),
    [actorId, width],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <mesh raycast={() => null}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function Screen({ entry, actorId }: { entry: Shown; actorId: string }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  // Going from no map to a map needs a shader recompile, and nothing else asks
  // for one. See StillPanel for the afternoon this cost the first time.
  useEffect(() => {
    if (materialRef.current) materialRef.current.needsUpdate = true;
  }, [entry.texture]);

  return (
    <group>
      {/* A thin dark bezel, so a screen showing a white page still reads as a
          screen against a pale wall or passthrough rather than a floating sheet. */}
      <mesh position={[0, 0, -0.005]} raycast={() => null}>
        <planeGeometry args={[entry.width + 0.05, entry.height + 0.05]} />
        <meshBasicMaterial color="#111318" />
      </mesh>
      <mesh raycast={() => null}>
        <planeGeometry args={[entry.width, entry.height]} />
        <meshBasicMaterial ref={materialRef} map={entry.texture} toneMapped={false} />
      </mesh>
      {/* ABOVE THE SCREEN, not below it. Below, the name sat in the gap between
          the screen and the top of the board panel and crowded both. */}
      <group position={[0, entry.height / 2 + 0.14, 0]}>
        <ScreenLabel actorId={actorId} width={Math.max(entry.width * 0.6, 1.2)} />
      </group>
    </group>
  );
}

export function ScreenWall({ base }: { base: string }) {
  const { screens, shown } = useSharedScreens(base);
  // Placed by the list the server gave, in its stable order, but only people
  // whose first frame has actually decoded — a bezel around nothing is not a
  // screen.
  const ready = screens.filter((screen) => shown.has(screen.actorId));
  return (
    <group>
      {ready.map((screen, index) => {
        const entry = shown.get(screen.actorId);
        if (!entry) return null;
        const place = screenPlacement(index, ready.length);
        return (
          <group
            key={screen.actorId}
            position={[place.position.x, place.position.y, place.position.z]}
            rotation={[0, place.rotationY, 0]}
          >
            <Screen entry={entry} actorId={screen.actorId} />
          </group>
        );
      })}
    </group>
  );
}
