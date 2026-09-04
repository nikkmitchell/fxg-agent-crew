import { type FormEvent, useEffect, useState } from "react";
import { LiveRoomPanel } from "./LiveRoomPanel";
import { ProjectBoard } from "./ProjectBoard";
import { DEFAULT_TAB, TABS, type Tab, pathForTab, tabFromPath } from "./router";
import { useProjects } from "./use-projects";

/**
 * Mission Control.
 *
 * This screen used to render demo.ts: four real people's names attached to
 * invented statuses, a scripted progress bar, and a fabricated activity feed.
 * That file is gone rather than gated behind a flag, because a flag leaves the
 * fabricated data in the bundle and one wrong default puts real names under a
 * live indicator again. It has nearly shipped here once already.
 *
 * The consequence is that most tabs below are EMPTY until the persistence work
 * lands. That is deliberate. An empty tab that says why is true; a populated
 * tab that invents its contents is the exact failure this product exists to
 * avoid. If a tab is blank, the feature is not built yet — read it that way.
 *
 * Live Rooms is real today and always was.
 */

function Glyph({ name }: { name: "grid" | "stack" | "clock" | "chat" }) {
  const paths = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    stack: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    chat: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z",
  };
  return (
    <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TAB_META: Record<Tab, { label: string; glyph: "grid" | "stack" | "clock" | "chat" }> = {
  projects: { label: "Projects", glyph: "grid" },
  overview: { label: "Overview", glyph: "grid" },
  board: { label: "Board", glyph: "stack" },
  mine: { label: "My work", glyph: "grid" },
  build: { label: "Build", glyph: "clock" },
  chat: { label: "Chat", glyph: "chat" },
};

/**
 * An empty state that explains itself.
 *
 * Every one of these says what is missing and what will fill it, so a blank
 * screen is information rather than an apparent bug. "Nothing here yet" with
 * no reason is indistinguishable from a failed fetch.
 */
function Empty({ title, because, next }: { title: string; because: string; next?: string }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{because}</p>
      {next ? <p className="empty-next">{next}</p> : null}
    </section>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() =>
    typeof window === "undefined" ? DEFAULT_TAB : tabFromPath(window.location.pathname),
  );
  const [liveRoomOpen, setLiveRoomOpen] = useState(false);

  const { view, createProject } = useProjects();
  const tasks = view.tasks;
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submitProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createProject({
        id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48),
        name: name.trim(),
        summary: summary.trim(),
        goals: [],
        steps: [],
      });
      setName("");
      setSummary("");
    } catch (error) {
      // Shown, not swallowed. A create that failed must not look like one that
      // worked — that is the whole point of re-reading instead of inserting.
      setCreateError((error as { message?: string })?.message ?? "could not create the project");
    } finally {
      setCreating(false);
    }
  };

  // Back/forward must work. Without this the URL changes and the view does
  // not, which is worse than having no routing at all.
  useEffect(() => {
    const onPop = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    window.history.pushState({}, "", pathForTab(next));
  };

  useEffect(() => {
    document.title = `${TAB_META[tab].label} — Mission Control`;
  }, [tab]);

  return (
    <div className="app-shell">
      <aside className="utility-rail" aria-label="Workspace navigation">
        <button className="brand-mark" aria-label="Saha home">F<span>/</span>X</button>
        <nav className="rail-nav" aria-label="Sections">
          {TABS.map((name) => (
            <button
              key={name}
              className={`rail-button${tab === name ? " is-active" : ""}`}
              aria-label={TAB_META[name].label}
              title={TAB_META[name].label}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => go(name)}
            >
              <Glyph name={TAB_META[name].glyph} />
            </button>
          ))}
        </nav>
        <button className="rail-avatar" aria-label="Operator profile">NM</button>
      </aside>

      <main className="workroom">
        <header className="tab-header">
          <p className="eyebrow">SAHA <span>/</span> MISSION CONTROL</p>
          <h1>{TAB_META[tab].label}</h1>
        </header>

        {tab === "projects" ? (
          <section className="projects-tab">
            {view.phase === "loading" ? <p className="muted-note">Reading the project log…</p> : null}

            {view.phase === "signed_out" ? (
              <Empty
                title="Not signed in."
                because="Projects are read from the room's durable log, which needs an authenticated session."
                next="Open Chat and sign in, then come back."
              />
            ) : null}

            {view.phase === "error" ? (
              <div className="room-error" role="alert">
                <strong>Could not load projects.</strong>
                <p>{view.error}</p>
                <p>Nothing is shown rather than a partial list — an incomplete board that looks complete is worse than a visible failure.</p>
              </div>
            ) : null}

            {view.phase === "ready" ? (
              <>
                {view.projects.length === 0 ? (
                  <p className="muted-note">No projects yet. Creating one below writes it to the room log; it survives a refresh or it never existed.</p>
                ) : (
                  <ul className="project-list">
                    {view.projects.map((project) => (
                      <li key={project.id}>
                        <strong>{project.name}</strong>
                        {project.summary ? <p>{project.summary}</p> : null}
                        <small>
                          {tasks.filter((task) => (task as { projectId?: string }).projectId === project.id).length} tasks
                          {project.steps.length ? ` · ${project.steps.length} steps` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}

                <form className="project-create" onSubmit={submitProject}>
                  <h2>New project</h2>
                  <label htmlFor="project-name">Name</label>
                  <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
                  <label htmlFor="project-summary">Summary</label>
                  <input id="project-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
                  {createError ? <p className="room-error" role="alert">{createError}</p> : null}
                  <button type="submit" className="primary-action" disabled={creating || !name.trim()}>
                    {creating ? "Writing to the log…" : "Create project"}
                  </button>
                </form>

                {view.rejected.length > 0 ? (
                  <details className="rejected-events">
                    <summary>{view.rejected.length} event(s) the server refused</summary>
                    <ul>{view.rejected.map((item, index) => <li key={index}>{item.reason}</li>)}</ul>
                  </details>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {tab === "overview" ? (
          <Empty
            title="No project selected."
            because="Overview summarises one project: its goals, its five to ten headline steps, how far those steps have got, and a live feed of what has changed. No project exists to summarise."
            next="The live feed lives here rather than in a tab of its own, and each entry clicks through to the item it came from."
          />
        ) : null}

        {tab === "board" ? (
          tasks.length === 0 ? (
            <Empty
              title="No tasks yet."
              because="The board renders real tasks only, and there are none."
              next="Cards will carry owners, comments, links and images, and will need accepting: an assigned task nobody has agreed to is shown as waiting, not as work in progress. Unowned tasks can be claimed."
            />
          ) : (
            <ProjectBoard tasks={tasks} agents={[]} />
          )
        ) : null}

        {tab === "mine" ? (
          <Empty
            title="Nothing assigned to you."
            because="This tab shows only the tasks you own — accepted or still waiting on your acceptance."
            next="A selector under the profile picture will switch to anyone else's view, so you can see what a person actually has on."
          />
        ) : null}

        {tab === "build" ? (
          <Empty
            title="Build status is not wired up yet."
            because="Branches, commits and their check results are not being read from anywhere. Showing a green tick here without that would be the exact lie this screen exists to avoid."
            next="It will report the deployed commit alongside the branch it came from, so a deploy that is ahead of the mainline is visible rather than discovered later."
          />
        ) : null}

        {tab === "chat" ? (
          <section className="tab-rooms">
            <p>
              Live Rooms is real data — the same rooms, messages and people as the chat itself.
              It is the one part of this screen that has always been true.
            </p>
            <button type="button" className="primary-action" onClick={() => setLiveRoomOpen(true)}>
              Open chat
            </button>
          </section>
        ) : null}

      </main>

      {liveRoomOpen ? <LiveRoomPanel onClose={() => setLiveRoomOpen(false)} /> : null}
    </div>
  );
}
