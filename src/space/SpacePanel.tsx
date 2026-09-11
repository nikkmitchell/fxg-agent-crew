import { Suspense, lazy, useEffect, useState } from "react";
import { Identity } from "../Identity";
import { useSpaceSocket } from "./useSpaceSocket";

/**
 * The Space tab.
 *
 * THE LAZY BOUNDARY IS NOT OPTIONAL. Three.js is roughly four times the size of
 * this entire app, and nobody reading the task board should download a renderer
 * to do it. `Scene` is the only module that imports three, and it is only
 * imported from here, behind `lazy` — measured after each build rather than
 * assumed, because the way this breaks is silent: one stray top-level import
 * pulls the whole thing back into the main chunk and everything still works.
 */
const Scene = lazy(() => import("./Scene"));

/**
 * The scene ignores CSS, so reduced motion has to be asked for directly.
 *
 * `src/styles.css` turns animation off globally with a media query, which a
 * requestAnimationFrame loop does not see at all. Without this the 3D tab would
 * quietly break a promise the rest of the app keeps.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function SpacePanel() {
  const [entered, setEntered] = useState(false);
  const systemPrefersReduced = useReducedMotion();
  /**
   * The system preference is the DEFAULT, not the verdict.
   *
   * Someone who is fine with a slow room but not with a spinning one, or who
   * turned the OS setting on years ago for something else, should be able to
   * decide here. It also makes the behaviour checkable: a media query cannot be
   * toggled from outside the browser, so without this control the reduced path
   * could only ever be read, never watched.
   */
  const [reducedOverride, setReducedOverride] = useState<boolean | null>(null);
  const reducedMotion = reducedOverride ?? systemPrefersReduced;
  const connection = useSpaceSocket(entered);

  if (!entered) {
    return (
      <section className="space-intro">
        <p>
          A room you can walk around, with everyone who is currently connected standing in it.
          Positions are live and are not stored: close the tab and you leave, restart the server
          and the room is empty, because after a restart nobody knows where anyone was standing.
        </p>
        <p className="muted-note">
          The boards on the walls are empty frames for now. Cards and images go on them in a later
          stage — an empty frame is true, and a frame with invented cards in it would not be.
        </p>
        {systemPrefersReduced ? (
          <p className="muted-note">
            Your system asks for reduced motion, so the room will redraw only when something
            happens rather than continuously. Other people will snap between positions instead of
            walking. You can change that once you are inside.
          </p>
        ) : null}
        <p className="muted-note">
          Entering downloads about half a megabyte of 3D code, which is why it is not loaded until
          you ask. Walk with W A S D or the arrow keys; drag to look around.
        </p>
        <button type="button" className="primary-action" onClick={() => setEntered(true)}>
          Enter the room
        </button>
      </section>
    );
  }

  const status = connection.status;

  return (
    <section className="space-panel">
      <div className="space-canvas">
        <Suspense fallback={<p className="muted-note">Loading the room…</p>}>
          <Scene connection={connection} reducedMotion={reducedMotion} />
        </Suspense>
        {status.state !== "open" ? (
          <div className="space-overlay">
            {status.state === "connecting" ? <p>Connecting…</p> : null}
            {status.state === "refused" ? (
              <p>
                The room refused the connection: {status.reason}. Nothing is being shown, which is
                better than a room that looks empty when it is not.
              </p>
            ) : null}
            {status.state === "closed" ? (
              <p>
                Disconnected.{" "}
                {status.retryInSeconds === null
                  ? "Reconnecting."
                  : `Reconnecting in about ${status.retryInSeconds}s.`}{" "}
                Anyone still in the room is no longer being drawn.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="space-roster">
        <h2>In the room</h2>
        <label className="space-setting">
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedOverride(event.currentTarget.checked)}
          />
          <span>
            Redraw only when something happens
            {reducedOverride === null && systemPrefersReduced ? " (your system asks for this)" : ""}
          </span>
        </label>
        {status.state === "open" ? (
          <p className="muted-note">You are {status.you}.</p>
        ) : null}
        {connection.roster.length === 0 ? (
          <p className="muted-note">
            Nobody — including you, until the connection is open.
          </p>
        ) : (
          <ul>
            {connection.roster.map((person) => (
              <li key={person.actorId}>
                <Identity username={person.actorId} kind={person.kind ?? undefined} showName />
                {person.because ? (
                  <em className="space-because">{person.because}</em>
                ) : null}
                {person.connected ? null : (
                  // Said in words, not only by a fainter ring in the scene. A
                  // dimmed outline is not something anyone can read reliably,
                  // and the difference between "watching the room" and "put
                  // there by something they did" is worth stating.
                  <em className="space-offline">no live connection</em>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted-note">
          Someone marked <em>no live connection</em> is not watching the room — they are standing
          where something they did puts them, and the line above says what that was. No reason
          means we have no recent record of them acting, which is not the same as idle.
        </p>
      </aside>
    </section>
  );
}
