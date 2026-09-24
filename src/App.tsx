import { useEffect, useState } from "react";
import { LiveRoomPanel } from "./LiveRoomPanel";
import { Home } from "./Home";
import { DEFAULT_TAB, RAIL, TABS, type Tab, pathForTab, tabFromPath } from "./router";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { BuildPanel } from "./BuildPanel";
import { Identity } from "./Identity";
import { PeoplePanel } from "./PeoplePanel";
import { SpacePanel } from "./space/SpacePanel";
import { Settings } from "./Settings";
import { SaidPanel } from "./SaidPanel";
import { ChatFeed } from "./ChatFeed";
import { useCurrentProject } from "./current-project";
import { useViewer } from "./use-session";
import SignIn, { CannotTell } from "./SignIn";
import { Join } from "./Join";
import { ProfilesPage } from "./ProfilesPage";
import { board } from "./board-client";
import { bff } from "./bff-client";
import { startUpdateReload } from "./update-reload";

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
  home: { label: "Home", glyph: "room" },
  projects: { label: "Projects", glyph: "grid" },
  overview: { label: "Overview", glyph: "grid" },
  board: { label: "Work", glyph: "stack" },
  mood: { label: "Mood boards", glyph: "image" },
  mine: { label: "My work", glyph: "grid" },
  people: { label: "People", glyph: "grid" },
  room: { label: "The room", glyph: "room" },
  build: { label: "Build", glyph: "clock" },
  said: { label: "Said in the room", glyph: "clock" },
  chat: { label: "Rooms", glyph: "chat" },
  join: { label: "Joining", glyph: "room" },
  profiles: { label: "People", glyph: "grid" },
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
  onEnterRoom,
  onReturnToLobby,
  roomStartsEntered,
}: {
  tab: Tab;
  session: { username: string; kind?: "human" | "agent" } | null;
  /** True inside an iframe panel. The room refuses to contain itself. */
  embedded: boolean;
  onOpenChat: (roomName: string) => void;
  /** Home's button: go to the room AND start loading it, rather than landing
      on a second "Enter the room" button. One click from the door to the 3D. */
  onEnterRoom: (roomName: string) => Promise<void>;
  /** Leave the active room view and return to the room directory. */
  onReturnToLobby: () => void;
  /** True when we arrived here by pressing Enter on the front door. */
  roomStartsEntered: boolean;
}) {
  return (
    <>
      {/* THE FRONT DOOR. Not shown inside a room panel: a panel whose content
          is a button that leaves the room is worse than no panel. */}
      {tab === "home" ? (
        embedded ? (
          <p className="muted-note">The room&rsquo;s front door is not shown inside the room.</p>
        ) : (
          <Home onEnter={onEnterRoom} />
        )
      ) : null}

      {tab === "projects" || tab === "overview" || tab === "board" || tab === "mood" || tab === "mine" ? (
        <ProjectWorkspace tab={tab} />
      ) : null}

      {tab === "people" ? <PeoplePanel session={session} /> : null}
      {tab === "profiles" ? <ProfilesPage me={session?.username ?? null} /> : null}

      {/* A room inside a panel inside the room: each copy would open its own
          socket and render its own panels, recursively, until the tab died.
          Refused with a sentence rather than by rendering nothing. */}
      {tab === "room" ? (
        embedded ? (
          <p className="muted-note">The room cannot be shown inside itself.</p>
        ) : (
          <SpacePanel startEntered={roomStartsEntered} onReturnToLobby={onReturnToLobby} />
        )
      ) : null}

      {tab === "build" ? <BuildPanel /> : null}

      {tab === "said" ? <SaidPanel /> : null}

      {/* THE ROOM ITSELF, not a button that opens it.
          This tab used to be a sentence and an "Open chat" button, which was
          fine while the only way in was a click — but the Chat panel in the 3D
          room is an iframe of this tab, and a panel whose whole content is a
          button that opens an overlay you cannot reach is worse than no panel.
          The overlay still exists for the button in the rail elsewhere. */}
      {tab === "chat" ? <ChatFeed username={session?.username ?? ""} onOpenRoomControls={embedded ? undefined : onOpenChat} /> : null}
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
  const [roomControlsRoom, setRoomControlsRoom] = useState<string | null>(null);
  const viewer = useViewer();

  // A deploy reloads every open page once it is safe to — see update-reload.ts.
  useEffect(() => startUpdateReload(), []);

  // Back/forward must work. Without this the URL changes and the view does
  // not, which is worse than having no routing at all.
  useEffect(() => {
    const onPop = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /**
   * Pressing Enter on the front door.
   *
   * Goes to the room AND tells it to start loading, so the door is one click
   * from the 3D view rather than one click from a second Enter button.
   *
   * IT STAYS SET FOR THE REST OF THE VISIT, and that is deliberate rather than
   * a leak. Having once said you want to be in the room, stepping out to the
   * board and back should put you back in it — and by then the megabyte is in
   * the browser cache, so the reason the room asks before loading has already
   * been paid. A FRESH PAGE LOAD of /room still gets the room's own intro,
   * because this is component state and starts false; I checked that rather
   * than assuming it.
   */
  const [roomStartsEntered, setRoomStartsEntered] = useState(false);
  const enterRoom = async (roomName: string) => {
    await bff.enterSpaceRoom(roomName);
    setRoomStartsEntered(true);
    go("room");
  };
  const openChat = (roomName: string) => {
    setRoomControlsRoom(roomName);
    setLiveRoomOpen(true);
  };

  const go = (next: Tab) => {
    if (next === "home") setRoomStartsEntered(false);
    setTab(next);
    window.history.pushState({}, "", pathForTab(next));
  };
  const returnToLobby = () => go("home");

  useEffect(() => {
    document.title = `${TAB_META[tab].label} — Mission Control`;
  }, [tab]);

  /**
   * The session the rest of the app draws from.
   *
   * Derived rather than passed straight through, because below this point the
   * gate has already guaranteed there is one — but the panels take a nullable
   * session and there is no reason to make them all change for that.
   */
  const session = viewer.status === "signed-in" ? viewer.session : null;

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

  /**
   * THE GATE, in front of BOTH the embedded and the full render.
   *
   * Nikk asked for it everywhere on saha.ing, and everywhere has to include the
   * panels the room hangs on its walls — those are same-origin iframes of this
   * same app, so an ungated embed would be a signed-out Board inside a room.
   * In practice the room cannot be reached without a session anyway, which is
   * why gating it costs nothing and leaving it ungated would only ever show
   * somebody an emptier version of the truth.
   *
   * AFTER EVERY HOOK. React requires the same hooks in the same order on every
   * render, so the returns have to sit below all of them — not beside
   * `useViewer` where they would read better.
   *
   * `checking` DRAWS NOTHING rather than drawing the sign-in for a moment.
   * Flashing a password field at somebody who turns out to be signed in trains
   * them to type a password whenever the page is slow, which is the habit worth
   * least in a product whose premise is that you can trust who said what.
   */
  /**
   * BEFORE THE GATE, AND THAT IS THE WHOLE POINT.
   *
   * Every other tab waits for `viewer` and answers `<SignIn />` to a stranger.
   * A JOINING page behind a sign-in is a door locked from the inside: the only
   * people who need it are the ones who cannot get past it. Nikk onboards
   * agents by pasting a prompt into a fresh session — no account, no cookie, no
   * checkout — so this has to render for somebody the server has never heard of.
   *
   * It is also above `checking`, which draws nothing while the viewer resolves.
   * This page needs no session at all, so making a stranger wait on a lookup
   * whose answer it does not use would be a blank screen for no reason.
   */
  if (tab === "join") return <Join />;

  if (viewer.status === "checking") {
    return <main className="signin" id="workroom" aria-busy="true" />;
  }
  if (viewer.status === "anonymous") {
    return <SignIn onSignedIn={viewer.recheck} />;
  }
  if (viewer.status === "unreachable") {
    return <CannotTell why={viewer.why} onRetry={viewer.recheck} />;
  }

  if (embedded) {
    return (
      <main className="app-embed" id="workroom">
        <TabContent
          tab={tab}
          session={session}
          embedded
          onOpenChat={openChat}
          onEnterRoom={enterRoom}
          onReturnToLobby={returnToLobby}
          roomStartsEntered={roomStartsEntered}
        />
        {liveRoomOpen ? <LiveRoomPanel preferredRoom={roomControlsRoom} onClose={() => setLiveRoomOpen(false)} /> : null}
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
          {RAIL.map((name) => (
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
        {tab !== "home" ? <header className="tab-header">
          <h1>{TAB_META[tab].label}</h1>
          <p className="eyebrow">saha / mission control</p>
        </header> : null}

        <TabContent
          tab={tab}
          session={session}
          embedded={false}
          onOpenChat={openChat}
          onEnterRoom={enterRoom}
          onReturnToLobby={returnToLobby}
          roomStartsEntered={roomStartsEntered}
        />

      </main>

      {liveRoomOpen ? <LiveRoomPanel preferredRoom={roomControlsRoom} onClose={() => setLiveRoomOpen(false)} /> : null}
    </div>
  );
}
