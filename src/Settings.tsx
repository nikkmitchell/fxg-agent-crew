import { useEffect, useState } from "react";
import { board } from "./board-client";
import { useCurrentProject } from "./current-project";

/**
 * Settings, which for now is one thing: which project the board tabs show.
 *
 * It moved here because it is a setting, not a task. It used to be a dropdown
 * at the top of the Board tab, where it took a line of the page on every visit
 * to answer a question most people answer once a day.
 *
 * THE RISK OF MOVING IT is that it becomes unfindable, so the rail button
 * carries the project's NAME rather than only a cog — you can see what is
 * selected without opening anything, which is most of what the old dropdown was
 * actually for.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, choose] = useCurrentProject();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { projects: list } = (await board.projects()) as { projects: { id: string; name: string }[] };
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
    <aside className="settings-panel" aria-label="Settings">
      <header>
        <h2>Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">×</button>
      </header>

      <section>
        <h3>Project</h3>
        <p className="muted-note">
          Which project the Board, Mood boards and My work tabs show. It does not change what
          anyone else sees.
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
    </aside>
  );
}
