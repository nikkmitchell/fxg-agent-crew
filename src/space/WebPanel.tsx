import { Html } from "@react-three/drei";
import { useMemo } from "react";
import type { Station } from "../../shared/space-layout";

/**
 * A real tab, hanging in space.
 *
 * THIS IS AN IFRAME, not a picture of one. It is the same app at the same URL
 * with the same session, so it updates itself, it is interactive, and there is
 * no second rendering of the board to keep in step with the first. The previous
 * version drew cards as rectangles from a projection of the database, which
 * meant every change to the board was two changes — and the wall still looked
 * like a wall of rectangles.
 *
 * HOW IT WORKS, because it is not obvious: drei's `Html transform` puts a real
 * DOM element into the page and drives it with a CSS 3D transform matched to
 * the camera. The browser composites it with the WebGL canvas. That is why it
 * can be live and clickable, and it is also exactly why it CANNOT appear in a
 * headset — an immersive session presents the WebGL framebuffer alone, and no
 * DOM is composited into it. See docs/HEADSET-CHECKS.md.
 */

/**
 * CSS pixels per metre.
 *
 * The iframe is laid out at a real page size and then scaled down, rather than
 * given a tiny viewport. A 4.2m panel at 320 px/m is 1344 px wide, which is a
 * normal desktop width — so the tab inside lays out the way it does on a laptop
 * instead of collapsing into its mobile breakpoint.
 */
const PIXELS_PER_METRE = 320;

/**
 * drei's own pixels-per-world-unit, which it does not expose.
 *
 * `Html` in transform mode builds its CSS matrix with
 * `1 / ((distanceFactor || 10) / 400)` — so with `distanceFactor` left alone,
 * one world unit is 40 CSS pixels. Our `scale` has to undo that to get the
 * panel to the size we actually asked for in metres.
 *
 * Getting this wrong is not subtle in one direction and invisible in the
 * other: the first attempt ignored it and rendered every panel seven pixels
 * wide. If a drei upgrade changes the constant, the panels will be obviously,
 * uniformly the wrong size rather than slightly off.
 */
const DREI_PIXELS_PER_UNIT = 40;

export function WebPanel({ station, base }: { station: Station; base: string }) {
  const width = Math.round(station.surface.width * PIXELS_PER_METRE);
  const height = Math.round(station.surface.height * PIXELS_PER_METRE);

  // Stable across re-renders: changing an iframe's src reloads the page inside
  // it, which would throw away scroll position and any half-typed comment.
  const src = useMemo(() => `${base}/${station.tab}?embed=1`, [base, station.tab]);

  return (
    <group
      position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
      rotation={[0, station.surface.rotationY, 0]}
    >
      {/* A thin backing plane behind the DOM. Without it a panel has no edges
          in the void and its white page bleeds into nothing. */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[station.surface.width + 0.12, station.surface.height + 0.12]} />
        <meshBasicMaterial color="#1c1f26" />
      </mesh>

      <Html
        transform
        // Turns the pixel-sized wrapper above back into the metres we asked
        // for: drei draws it at DREI_PIXELS_PER_UNIT px per world unit, so the
        // panel is `width * PIXELS_PER_METRE` px wide and needs shrinking by
        // exactly this much to end up `width` metres across.
        scale={DREI_PIXELS_PER_UNIT / PIXELS_PER_METRE}
        // Keep the DOM behind the canvas's own occlusion rules off: avatars are
        // WebGL and panels are DOM, and the browser cannot depth-test between
        // them. Panels are placed in front of where people stand instead.
        occlude={false}
        style={{ width, height, pointerEvents: "auto" }}
      >
        <div className="space-panel-frame" style={{ width, height }}>
          <div className="space-panel-title">{station.label}</div>
          <iframe
            title={station.label}
            src={src}
            style={{ width, height: height - 34, border: 0, display: "block", background: "#fbfaf6" }}
          />
        </div>
      </Html>
    </group>
  );
}
