import { useEffect, useState } from "react";
import { LiveRoomPanel } from "./LiveRoomPanel";
import { ProjectBoard } from "./ProjectBoard";
import { DEFAULT_TAB, TABS, type Tab, pathForTab, tabFromPath } from "./router";
import type { CrewTask } from "./event-core";

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
  board: { label: "Board", glyph: "stack" },
  rooms: { label: "Rooms", glyph: "chat" },
  activity: { label: "Activity", glyph: "clock" },
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

  // Real tasks, once something produces them. Empty is the honest default:
  // there is no persistence yet, so there is nothing to show.
  const [tasks] = useState<CrewTask[]>([]);

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
          <Empty
            title="No projects yet."
            because="Nothing has been created here, and this screen will not invent one to look busy."
            next="Project creation and persistence are in progress. When a project is created it appears here and survives a refresh — that is the test."
          />
        ) : null}

        {tab === "board" ? (
          tasks.length === 0 ? (
            <Empty
              title="No tasks yet."
              because="The board renders real tasks only. There are none, so it is empty."
              next="Tasks will appear once a project exists to hold them."
            />
          ) : (
            <ProjectBoard tasks={tasks} agents={[]} />
          )
        ) : null}

        {tab === "rooms" ? (
          <section className="tab-rooms">
            <p>
              Live Rooms is real data — the same rooms, messages and people as the chat itself.
              It is the one part of this screen that has always been true.
            </p>
            <button type="button" className="primary-action" onClick={() => setLiveRoomOpen(true)}>
              Open Live Rooms
            </button>
          </section>
        ) : null}

        {tab === "activity" ? (
          <Empty
            title="No activity yet."
            because="This feed will be derived from real room events, not scripted ones. The previous version replayed a fixed script and presented it as history."
            next="It fills in once events are persisted and read back."
          />
        ) : null}
      </main>

      {liveRoomOpen ? <LiveRoomPanel onClose={() => setLiveRoomOpen(false)} /> : null}
    </div>
  );
}
