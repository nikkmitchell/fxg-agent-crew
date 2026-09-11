import { useCallback, useEffect, useState } from "react";
import type { Surfaces } from "../../shared/space-surfaces";

/**
 * What is on the walls, refetched when the board changes.
 *
 * Polled rather than pushed: this changes when somebody edits the board, which
 * is rare next to somebody taking a step. Putting it on the 10Hz socket would
 * send a board's worth of cards ten times a second to say nothing happened.
 *
 * Ten seconds is the compromise. A card moved lane appears on the wall within
 * ten seconds of the agent that moved it walking over to the board — which is
 * close enough to read as one event, and slow enough that a room left open all
 * day costs six requests a minute.
 */
const REFRESH_MS = 10_000;

export type SurfacesState =
  | { state: "loading" }
  | { state: "ready"; surfaces: Surfaces }
  /** Said out loud rather than rendered as an empty board. */
  | { state: "failed"; reason: string };

export function useSurfaces(enabled: boolean, projectId?: string) {
  const [state, setState] = useState<SurfacesState>({ state: "loading" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
      try {
        const response = await fetch(`${base}/bff/space/surfaces${query}`, {
          credentials: "same-origin",
          signal,
        });
        if (!response.ok) {
          setState({
            state: "failed",
            reason: response.status === 401 ? "you are signed out" : `the server answered ${response.status}`,
          });
          return;
        }
        setState({ state: "ready", surfaces: (await response.json()) as Surfaces });
      } catch (error) {
        // An aborted fetch is a component unmounting, not a failure.
        if ((error as { name?: string }).name === "AbortError") return;
        setState({ state: "failed", reason: "the walls could not be read" });
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled, load]);

  return { state, reload: () => void load() };
}
