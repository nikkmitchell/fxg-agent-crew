import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { makeLabelTexture } from "./label-texture";

/**
 * A photograph of the real page, for inside a headset.
 *
 * A session draws 3D only, so the live panel cannot be there. This is the same
 * page, rendered by a headless browser on the server every few seconds and hung
 * as a texture. Not a second renderer: nothing here knows what a card looks
 * like, so it cannot drift from the page everyone else uses.
 *
 * IT SAYS WHAT IT IS. A still is seconds old and cannot be touched, and a board
 * that is quietly stale is worse than one that is obviously a picture — so the
 * frame is captioned with its age rather than being allowed to pass for live.
 */

/** How often to fetch a newer photograph. Matches the renderer's own cadence. */
const REFRESH_MS = 15_000;

type Shot = { texture: THREE.Texture; ageSeconds: number } | null;

function useStill(tab: string, base: string, active: boolean): { shot: Shot; problem: string | null } {
  const [shot, setShot] = useState<Shot>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const previous = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${base}/bff/space/stills/${tab}.png`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 503) {
          // Asking is what wakes the renderer, so this is normal for the first
          // few seconds rather than a fault.
          if (!cancelled) setProblem("waiting for the first photograph…");
          return;
        }
        if (!response.ok) {
          if (!cancelled) setProblem(`the server answered ${response.status}`);
          return;
        }
        const ageSeconds = Number(response.headers.get("x-still-age-seconds") ?? "0");
        const bitmap = await createImageBitmap(await response.blob());
        if (cancelled) {
          bitmap.close();
          return;
        }
        const texture = new THREE.CanvasTexture(bitmap as unknown as HTMLCanvasElement);
        texture.colorSpace = THREE.SRGBColorSpace;
        // Freed explicitly. A new texture every fifteen seconds for as long as
        // somebody wears the headset is a leak that ends in a crash.
        previous.current?.dispose();
        previous.current = texture;
        setProblem(null);
        setShot({ texture, ageSeconds });
      } catch {
        if (!cancelled) setProblem("could not reach the server");
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab, base, active]);

  useEffect(() => () => previous.current?.dispose(), []);

  return { shot, problem };
}

export function StillPanel({
  station,
  base,
  active,
}: {
  station: Station;
  base: string;
  active: boolean;
}) {
  const { shot, problem } = useStill(station.tab, base, active);

  const caption = useMemo(() => {
    const text = problem
      ? `${station.label} — ${problem}`
      : shot
        ? `${station.label} — a photograph, ${shot.ageSeconds}s old. Use it in a browser window.`
        : `${station.label} — loading`;
    return makeLabelTexture(text, { pixelsPerLine: 34 });
  }, [station.label, problem, shot]);

  return (
    <group
      position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
      rotation={[0, station.surface.rotationY, 0]}
    >
      <mesh>
        <planeGeometry args={[station.surface.width, station.surface.height]} />
        {shot ? (
          <meshBasicMaterial map={shot.texture} toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#141822" />
        )}
      </mesh>

      {/* Captioned UNDER the frame, so it never covers the thing it describes. */}
      {caption ? (
        <mesh position={[0, -station.surface.height / 2 - 0.18, 0.01]}>
          <planeGeometry args={[station.surface.width * 0.8, 0.26]} />
          <meshBasicMaterial map={caption} transparent />
        </mesh>
      ) : null}
    </group>
  );
}
