import { useEffect, useState } from "react";
import { LiveRoomPanel } from "./LiveRoomPanel";
import { DEFAULT_TAB, TABS, type Tab, pathForTab, tabFromPath } from "./router";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { BuildPanel } from "./BuildPanel";
import { Identity } from "./Identity";
import { PeoplePanel } from "./PeoplePanel";
import { SpacePanel } from "./space/SpacePanel";
import { Settings } from "./Settings";
import { useCurrentProject } from "./current-project";
import { useSession } from "./use-session";
import { board } from "./board-client";

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

function Glyph({ name }: { name: "grid" | "stack" | "clock" | "chat" | "image" | "room" | "cog" }) {
  const paths = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    // A room seen in perspective: a floor plane with walls rising from it. The
    // only tab whose contents are a place rather than a list.
    room: "M3 20h18M5 20V9l7-5 7 5v11M10 20v-6h4v6",
    // A cog. Settings is where the project switcher went, so this icon has to
    // read as "preferences" rather than as another view of the work.
    cog: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.4 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
    stack: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    chat: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z",
    // A framed picture with a horizon, rather than another abstract square —
    // this rail is already four squares deep and the mood board is the one tab
    // whose contents are pictures.
    image: "M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6",
  };
  return (
    <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TAB_META: Record<Tab, { label: string; glyph: "grid" | "stack" | "clock" | "chat" | "image" | "room" | "cog" }> = {
  projects: { label: "Projects", glyph: "grid" },
  overview: { label: "Overview", glyph: "grid" },
  board: { label: "Board", glyph: "stack" },
  mood: { label: "Mood boards", glyph: "image" },
  mine: { label: "My work", glyph: "grid" },
  people: { label: "People", glyph: "grid" },
  room: { label: "The room", glyph: "room" },
  build: { label: "Build", glyph: "clock" },
  chat: { label: "Chat", glyph: "chat" },
};

/**
 * What a tab actually shows.
 *
 * Shared by the full screen and by `?embed=1`, so a panel in the room and the
 * tab it came from cannot drift into showing different things — which is the
 * entire reason the room embeds the real tabs instead of drawing its own
 * version of them.
 */
function TabContent({
  tab,
  session,
  embedded,
  onOpenChat,
}: {
  tab: Tab;
  session: ReturnType<typeof useSession>;
  /** True inside an iframe panel. The room refuses to contain itself. */
  embedded: boolean;
  onOpenChat: () => void;
}) {
  return (
    <>
      {tab === "projects" || tab === "overview" || tab === "board" || tab === "mood" || tab === "mine" ? (
        <ProjectWorkspace tab={tab} />
      ) : null}

      {tab === "people" ? <PeoplePanel session={session} /> : null}

      {/* A room inside a panel inside the room: each copy would open its own
          socket and render its own panels, recursively, until the tab died.
          Refused with a sentence rather than by rendering nothing. */}
      {tab === "room" ? (
        embedded ? (
          <p className="muted-note">The room cannot be shown inside itself.</p>
        ) : (
          <SpacePanel />
        )
      ) : null}

      {tab === "build" ? <BuildPanel /> : null}

      {tab === "chat" ? (
        <section className="tab-rooms">
          <p>
            Live Rooms is real data — the same rooms, messages and people as the chat itself.
            It is the one part of this screen that has always been true.
          </p>
          <button type="button" className="primary-action" onClick={onOpenChat}>
            Open chat
          </button>
        </section>
      ) : null}
    </>
  );
}

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectId] = useCurrentProject();
  const [projectName, setProjectName] = useState("");
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

  /**
   * The selected project's NAME, for the Settings button.
   *
   * Looked up rather than stored alongside the id: a name can be edited, and a
   * cached copy would sit in the rail showing what the project used to be
   * called. Failure is silent and shows no name — the button still works, it
   * just says less.
   */
  useEffect(() => {
    if (!projectId) {
      setProjectName("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { projects } = (await board.projects()) as { projects: { id: string; name: string }[] };
        if (!cancelled) setProjectName(projects.find((p) => p.id === projectId)?.name ?? "");
      } catch {
        if (!cancelled) setProjectName("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * `?embed=1` renders the tab's CONTENT and nothing else.
   *
   * The room at /room hangs the real Board, Mood boards and People tabs in
   * floating panels, which are same-origin iframes of this site. Without this
   * each panel would carry its own navigation rail, its own header and its own
   * skip link — three copies of the furniture, inside a room that already is
   * the navigation.
   *
   * It is the SAME app with the SAME session and the same routes. Nothing is
   * exposed here that /board does not already expose to the same person; the
   * only thing removed is chrome.
   */
  const embedded = new URLSearchParams(window.location.search).get("embed") === "1";

  if (embedded) {
    return (
      <main className="app-embed" id="workroom">
        <TabContent tab={tab} session={session} embedded onOpenChat={() => setLiveRoomOpen(true)} />
        {liveRoomOpen ? <LiveRoomPanel onClose={() => setLiveRoomOpen(false)} /> : null}
      </main>
    );
  }

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
        {/*
          * THE PROJECT'S NAME, not only a cog.
          *
          * Moving the switcher into Settings was the request; making it
          * undiscoverable would be the failure. Showing what is selected on the
          * button itself does most of what the old dropdown did — you can see
          * which project you are looking at without opening anything.
          */}
        <button
          type="button"
          className={`rail-button rail-settings${settingsOpen ? " is-active" : ""}`}
          aria-label={projectName ? `Settings — project: ${projectName}` : "Settings"}
          title={projectName ? `Settings — ${projectName}` : "Settings"}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Glyph name="cog" />
          {projectName ? <small>{projectName}</small> : null}
        </button>

        <span className="rail-identity">
          <Identity username={session?.username} kind={session?.kind} size={32} />
        </span>
      </aside>

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}

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

        <TabContent tab={tab} session={session} embedded={false} onOpenChat={() => setLiveRoomOpen(true)} />

      </main>

      {liveRoomOpen ? <LiveRoomPanel onClose={() => setLiveRoomOpen(false)} /> : null}
    </div>
  );
}
