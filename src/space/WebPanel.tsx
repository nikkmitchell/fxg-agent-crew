import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROWING_PANELS, grownPanel, naturalHeight } from "../../shared/panel-growth";
import type { Station } from "../../shared/space-layout";
import { isRoomPreferenceHistoryState } from "./room-selection";

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

export function WebPanel({
  station,
  base,
  project,
}: {
  station: Station;
  base: string;
  /**
   * The project the ROOM is showing, which is not the viewer's own choice.
   *
   * Passed into the page rather than left to the iframe's own localStorage: two
   * people standing at the same wall must see the same board on it, and without
   * this each would see whichever project they last picked at their desk.
   */
  project: string | null;
}) {
  const width = Math.round(station.surface.width * PIXELS_PER_METRE);
  /**
   * HOW TALL THE PAGE INSIDE IS, for the panel that grows (see
   * shared/panel-growth.ts). Read from the embedded page itself — it is the
   * same origin — every second and a half, which is quicker than the board
   * refreshes.
   */
  const frame = useRef<HTMLIFrameElement>(null);
  const grows = GROWING_PANELS.has(station.id);
  const [contentPx, setContentPx] = useState<number | null>(null);
  useEffect(() => {
    if (!grows) return;
    const measure = () => {
      const doc = frame.current?.contentDocument;
      const page = doc?.querySelector(".app-embed") as HTMLElement | null;
      if (!doc || !page) return;
      // Less the stretch the board adds to fill its window: see naturalHeight.
      const spare = Array.from(doc.querySelectorAll<HTMLElement>(".column-cards"), (cards) => {
        const style = doc.defaultView?.getComputedStyle(cards);
        const padding = style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0;
        const kids = Array.from(cards.children, (kid) => kid.getBoundingClientRect());
        const content = kids.length
          ? Math.max(...kids.map((box) => box.bottom)) - Math.min(...kids.map((box) => box.top))
          : 0;
        return cards.clientHeight - Math.max(60, content + padding);
      });
      const next = Math.ceil(naturalHeight(page.scrollHeight, spare));
      setContentPx((previous) => (previous !== null && Math.abs(previous - next) < 8 ? previous : next));
    };
    const timer = window.setInterval(measure, 1500);
    return () => window.clearInterval(timer);
  }, [grows]);
  const TITLE_PX = 34;
  const panel = grownPanel(
    station.surface.height,
    grows && contentPx !== null ? (contentPx + TITLE_PX) / PIXELS_PER_METRE : null,
  );
  const height = Math.round(panel.height * PIXELS_PER_METRE);

  // Stable across re-renders: changing an iframe's src reloads the page inside
  // it, which would throw away scroll position and any half-typed comment.
  // Changing the PROJECT is the one case where reloading is right — the panel
  // is meant to be showing something else now.
  const src = useMemo(
    () => {
      const query = new URLSearchParams({ embed: "1" });
      if (project) query.set("project", project);
      if (station.id === "chat") {
        const room = new URLSearchParams(window.location.search).get("room")?.trim();
        if (room) {
          query.set("room", room);
          if (isRoomPreferenceHistoryState(window.history.state)) query.set("room-preference", "1");
        }
      }
      return `${base}/${station.tab}?${query.toString()}`;
    },
    [base, station.id, station.tab, project],
  );

  return (
    <group
      /* NO POSITION HERE. The panel is drawn at its own origin and placed by
         the <Movable> around it, which owns the live position — panels can be
         dragged, so their place is shared state and not a constant in the
         layout any more. Positioning here as well would place them twice. */
    >
      {/* A thin backing plane behind the DOM. Without it a panel has no edges
          in the void and its white page bleeds into nothing. */}
      <group position={[0, panel.lift, 0]}>
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[station.surface.width + 0.12, panel.height + 0.12]} />
        <meshBasicMaterial color="#1c1f26" />
      </mesh>

      <Html
        transform
        // Turns the pixel-sized wrapper above back into the metres we asked
        // for: drei draws it at DREI_PIXELS_PER_UNIT px per world unit, so the
        // panel is `width * PIXELS_PER_METRE` px wide and needs shrinking by
        // exactly this much to end up `width` metres across.
        scale={DREI_PIXELS_PER_UNIT / PIXELS_PER_METRE}
        // WITHOUT THIS, A PANEL PAINTS OVER EVERYONE.
        //
        // The DOM and the WebGL canvas are separate layers and the browser
        // cannot depth-test between them, so by default the panels drew on top
        // of every figure — including ones standing in front of them, who came
        // out sliced in half by a rectangle.
        //
        // "blending" puts the canvas above the DOM and renders an invisible
        // depth-writing plane where the panel is, so the canvas is transparent
        // over the panel except where geometry is actually nearer. Per-pixel,
        // and correct from any angle.
        //
        // The cost is that drei sets `pointer-events: none` on the canvas, so
        // the look-around drag can no longer listen there — see Scene.tsx.
        occlude="blending"
        style={{ width, height, pointerEvents: "auto" }}
      >
        <div className="space-panel-frame" style={{ width, height }}>
          <div className="space-panel-title">{station.label}</div>
          <iframe
            ref={frame}
            title={station.label}
            src={src}
            style={{ width, height: height - 34, border: 0, display: "block", background: "#fbfaf6" }}
          />
        </div>
      </Html>
      </group>
    </group>
  );
}
