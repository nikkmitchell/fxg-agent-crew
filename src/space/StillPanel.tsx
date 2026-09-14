import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Station } from "../../shared/space-layout";
import { makeLabelTexture } from "./label-texture";
import { GROWING_PANELS, grownPanel } from "../../shared/panel-growth";

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

type Shot = { texture: THREE.Texture; ageSeconds: number; imageWidth: number; imageHeight: number } | null;

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

        /**
         * DECODED THROUGH AN <img>, NOT createImageBitmap.
         *
         * The first version made an ImageBitmap and wrapped it in a
         * CanvasTexture. That renders the right way up in desktop Chrome and
         * came out rotated 180° in a Quest headset — WebGL's
         * UNPACK_FLIP_Y_WEBGL is specified as having no effect on ImageBitmap
         * sources, so whether the picture ends up flipped is left to the
         * driver, and the two browsers disagree. I could not have found this in
         * the flat view: I looked, and it was correct there.
         *
         * An HTMLImageElement is the path three.js is built around, the one the
         * mood board images already use here, and flipY behaves the same
         * everywhere. The object URL is revoked once decoded so a panel
         * refreshing every fifteen seconds does not leak one per cycle.
         */
        const blobUrl = URL.createObjectURL(await response.blob());
        let image: HTMLImageElement;
        try {
          image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("the photograph could not be decoded"));
            element.src = blobUrl;
          });
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
        if (cancelled) return;

        const texture = new THREE.Texture(image);
        texture.colorSpace = THREE.SRGBColorSpace;
        // Said outright rather than left to the default, because the default is
        // exactly what differed between the two browsers.
        texture.flipY = true;
        texture.needsUpdate = true;
        // Freed explicitly. A new texture every fifteen seconds for as long as
        // somebody wears the headset is a leak that ends in a crash.
        previous.current?.dispose();
        previous.current = texture;
        setProblem(null);
        setShot({ texture, ageSeconds, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight });
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

/**
 * How long a photograph counts as current.
 *
 * The renderer takes a fresh set every fifteen seconds, so anything inside
 * this is as live as a still can be and saying its age tells you nothing you
 * would act on. Past it, something has stopped: the renderer, the session, or
 * the machine — and then the age is the most useful thing on the panel.
 */
const FRESH_SECONDS = 45;

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
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  // See the comment on the material below: going from no map to a map needs a
  // shader recompile, and nothing else asks for one.
  useEffect(() => {
    if (materialRef.current) materialRef.current.needsUpdate = true;
  }, [shot]);

  /**
   * How old, in words a person can read at a glance.
   *
   * It printed raw seconds, which is fine at 5s and meaningless at 46294 — and
   * the stale case is exactly when the number matters, because the renderer
   * sleeps when nobody is looking and the FIRST thing a headset sees can be
   * hours old until the next cycle lands. "photograph, 46294s old" is a number
   * nobody converts in their head while wearing a headset.
   */
  const ageInWords = (seconds: number): string => {
    if (seconds < 90) return `${seconds}s old`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} min old`;
    const hours = Math.round(seconds / 3600);
    if (hours < 36) return `${hours} hours old`;
    return `${Math.round(hours / 24)} days old`;
  };


  const caption = useMemo(() => {
    /**
     * NO NAME UNDER THE PANEL. Every panel used to be captioned with what it
     * was — "Mood boards — photograph, 12 seconds old" — under a picture of a
     * mood board. Nikk: "can you adjust the UI so it no longer has the text
     * below each board where it says like mood board." He is right: the panel
     * shows what it is, and a label repeating it is furniture.
     *
     * WHAT IS KEPT IS THE PART THAT IS NOT REDUNDANT. A panel in a headset is
     * a photograph, not the live page, and how old it is cannot be seen by
     * looking at it. So the caption is now silent while the picture is current
     * and speaks only when it has something to say: a stale photograph, or a
     * reason there is none. A still that has quietly stopped updating and a
     * room where nothing is happening look identical, and only one of them is
     * a problem.
     *
     * SHORT. The texture is one line squeezed to fit its canvas, so a long
     * sentence arrives as condensed mush — which is what "unclear text" looked
     * like in the headset.
     */
    const text = problem
      ? problem
      : shot
        ? shot.ageSeconds > FRESH_SECONDS
          ? `not updating — ${ageInWords(shot.ageSeconds)}`
          : null
        : "loading";
    return text ? makeLabelTexture(text, { pixelsPerLine: 48 }) : null;
  }, [problem, shot]);

  /**
   * THE TASK BOARD'S PHOTOGRAPH IS AS TALL AS THE BOARD (the renderer takes the
   * whole page), so the plane takes the picture's shape and grows upward. See
   * shared/panel-growth.ts. Every other panel keeps its set shape.
   */
  const panel = grownPanel(
    station.surface.height,
    GROWING_PANELS.has(station.id) && shot && shot.imageWidth > 0
      ? station.surface.width * (shot.imageHeight / shot.imageWidth)
      : null,
  );

  return (
    <group
      /* Placed by the <Movable> around it — see the note in WebPanel. */
    >
      <group position={[0, panel.lift, 0]}>
      <mesh>
        <planeGeometry args={[station.surface.width, panel.height]} />
        {/*
          ONE MATERIAL, NOT TWO BRANCHES, and both of the things below are
          load-bearing. The first version swapped between two <meshBasicMaterial>
          elements — which React reconciles as the SAME instance, so it kept the
          placeholder's dark colour and never recompiled its shader. The result
          was a panel that stayed black forever while the caption underneath it
          cheerfully reported a five-second-old photograph.

          - `color` must go WHITE once there is a map. A material's colour
            multiplies its texture, so the placeholder's #141822 turned any
            photograph into near-black.
          - `needsUpdate` must be set when a map first appears. three compiles
            USE_MAP into the shader; assigning `.map` to a material that was
            built without one does not recompile it on its own.
        */}
        <meshBasicMaterial
          ref={materialRef}
          map={shot?.texture ?? null}
          color={shot ? "#ffffff" : "#141822"}
          toneMapped={false}
        />
      </mesh>

      {/* Captioned UNDER the frame, so it never covers the thing it describes.
          4:1, MATCHING THE TEXTURE. makeLabelTexture draws into a 512x128
          canvas; a 3.36 x 0.26 plane is nearly 13:1, so every caption was
          squashed to a third of its width and read as unclear smudging rather
          than as words. */}
      {caption ? (
        <mesh position={[0, -panel.height / 2 - 0.3, 0.01]}>
          <planeGeometry args={[2.4, 0.6]} />
          <meshBasicMaterial map={caption} transparent />
        </mesh>
      ) : null}
      </group>
    </group>
  );
}
