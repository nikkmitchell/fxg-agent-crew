import { useEffect, useState } from "react";
import { LiveRoomPanel } from "./LiveRoomPanel";
import { DEFAULT_TAB, TABS, type Tab, pathForTab, tabFromPath } from "./router";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { BuildPanel } from "./BuildPanel";
import { Identity } from "./Identity";
import { PeoplePanel } from "./PeoplePanel";
import { useSession } from "./use-session";

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
  people: { label: "People", glyph: "grid" },
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
  const session = useSession();

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
      {/*
        * Six navigation buttons sit before the content on every load. Without
        * this, reaching the page a keyboard user came for costs six tab presses
        * every single time — and the cost is paid by exactly the people for whom
        * each press is most expensive.
        *
        * Visible on focus rather than always: it is a shortcut for people who
        * need it, and hiding it entirely (display:none, or a positive tabindex
        * trick) is what makes most skip links non-functional.
        */}
      <a className="skip-link" href="#workroom">Skip to content</a>

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
        {/*
          * Was hardcoded "NM" — the same initials for every visitor, an identity
          * this page had never checked. It now shows whoever is actually signed
          * in, or a signed-out mark when nobody is.
          */}
        <span className="rail-identity">
          <Identity username={session?.username} kind={session?.kind} size={32} />
        </span>
      </aside>

      <main className="workroom" id="workroom" tabIndex={-1}>
        {/*
          * One line, not two blocks.
          *
          * This screen previously stacked four headers before any content: a
          * breadcrumb, a display-size tab title, a project label with its
          * select, and the project name again at display size. On a laptop the
          * board began below the fold of its own container. The rail already
          * shows which tab is active and the document title carries it too, so
          * the h1 stays for structure but stops behaving like a poster.
          */}
        <header className="tab-header">
          <h1>{TAB_META[tab].label}</h1>
          <p className="eyebrow">saha / mission control</p>
        </header>

        {tab === "projects" || tab === "overview" || tab === "board" || tab === "mine" ? <ProjectWorkspace tab={tab} /> : null}

        {tab === "people" ? <PeoplePanel session={session} /> : null}

        {tab === "build" ? <BuildPanel /> : null}

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
