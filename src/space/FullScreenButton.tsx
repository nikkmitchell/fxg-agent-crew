import { useEffect, useState, type RefObject } from "react";

/**
 * FULL SCREEN FOR THE ROOM'S WINDOW (Nikk 7448). It fills the screen with the
 * 3D view's own box, so ⚙ Settings comes along in its corner; Esc or the same
 * button brings the page back. Hidden where the browser cannot do it (an
 * iPhone's Safari has no element full screen).
 */
export function FullScreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [target]);
  if (typeof document === "undefined" || !document.fullscreenEnabled) return null;
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void target.current?.requestFullscreen().catch(() => undefined);
  };
  return (
    <button type="button" className="space-menu-button" onClick={toggle} aria-pressed={full}>
      {full ? "Exit full screen" : "⛶ Full screen"}
    </button>
  );
}
