import { useEffect, useState } from "react";
import { board } from "./board-client";
import { useCurrentProject } from "./current-project";

/**
 * Which project the board tabs are showing.
 *
 * LIFTED OUT OF Settings because the room needs it too. In the room the three
 * panels ARE the board tabs, so "which project" decides what is hanging on the
 * arc in front of you — and walking out of the room to a settings page to
 * change it, then walking back, is exactly the kind of errand a space is
 * supposed to remove. One component, two places, no chance of the two drifting
 * into different answers.
 *
 * The choice is this browser's, not the room's: `current-project.ts` keeps it
 * in localStorage and nobody else sees it change.
 */
export function ProjectChooser({ heading }: { heading?: string }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, choose] = useCurrentProject();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { projects: list } = (await board.projects()) as {
          projects: { id: string; name: string }[];
        };
        if (!cancelled) setProjects(list);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h3>{heading ?? "Project"}</h3>
      <p className="muted-note">
        Which project the Board, Mood boards and My work tabs show. It does not change what anyone
        else sees.
      </p>

      {failed ? (
        // Not an empty list: "no projects" and "we could not ask" look
        // identical and only one of them is your fault.
        <p className="muted-note">The projects could not be read. What is selected is unchanged.</p>
      ) : projects === null ? (
        <p className="muted-note">Reading projects…</p>
      ) : projects.length === 0 ? (
        <p className="muted-note">There are no projects yet.</p>
      ) : (
        <ul className="settings-projects">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={project.id === selected ? "is-selected" : ""}
                aria-current={project.id === selected ? "true" : undefined}
                onClick={() => choose(project.id)}
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
