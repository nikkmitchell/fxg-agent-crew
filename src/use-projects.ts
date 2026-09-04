import { useCallback, useEffect, useState } from "react";
import { bff, type ProjectState } from "./bff-client";
import type { CrewProject, CrewTask } from "./event-core";

/**
 * Live project state for a room.
 *
 * There is no local cache of projects and no optimistic insert. After a
 * successful write we re-read from the server, because the only claim worth
 * making on screen is "the log has this" — and an optimistic row would show a
 * project that exists nowhere if the append silently failed. That is precisely
 * the create -> refresh -> still present criterion, so the UI should not be
 * able to fake passing it.
 */

export const PROJECT_ROOM = "AgentParty";

export type ProjectsPhase = "loading" | "ready" | "signed_out" | "forbidden" | "error";

export type ProjectsView = {
  phase: ProjectsPhase;
  projects: CrewProject[];
  tasks: CrewTask[];
  /** Events the server refused. Surfaced rather than swallowed. */
  rejected: Array<{ eventId?: string; reason: string }>;
  error?: string;
};

const initial: ProjectsView = { phase: "loading", projects: [], tasks: [], rejected: [] };

export function useProjects() {
  const [view, setView] = useState<ProjectsView>(initial);

  const load = useCallback(async () => {
    try {
      const state: ProjectState = await bff.projects(PROJECT_ROOM);
      setView({
        phase: "ready",
        projects: state.projects ?? [],
        tasks: state.tasks ?? [],
        rejected: state.rejected ?? [],
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = (error as { message?: string })?.message;
      if (code === "SESSION_EXPIRED") {
        setView({ ...initial, phase: "signed_out" });
        return;
      }
      // REPLAY_TRUNCATED is surfaced as an error rather than shown as an empty
      // or partial board. An incomplete board that looks complete is worse than
      // a visible failure.
      setView({ ...initial, phase: "error", error: message ?? code ?? "could not load projects" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createProject = useCallback(
    async (project: CrewProject) => {
      await bff.projectEvent(PROJECT_ROOM, { type: "project.upserted", project });
      // Re-read rather than inserting locally: the screen should show what the
      // log actually contains.
      await load();
    },
    [load],
  );

  const createTask = useCallback(
    async (task: CrewTask & { projectId: string }) => {
      await bff.projectEvent(PROJECT_ROOM, { type: "task.upserted", task });
      await load();
    },
    [load],
  );

  return { view, reload: load, createProject, createTask };
}
