import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CrewProject, CrewTask } from "./event-core";
import type { Tab } from "./router";
import { recentActivity } from "./recent-activity";
import { describeProgress, kindLabel } from "./task-kind";
import { BOARD_COLUMNS, calculateProjectProgress } from "./project-model";
import { byPriority, nextUnclaimed, priorityLabel } from "./priority";
import { ROLES, canManageMembership, membersOf, type Membership, type Role } from "./membership";
import { Identity } from "./Identity";
import type { ActorProfile } from "./profiles";
import { BoardError, board, toCrewProject, toCrewTask, toProfile } from "./board-client";
import { MoodBoard, type Board } from "./MoodBoard";
import { briefBudget, describeBudget } from "../shared/message-budget";


type ProjectState = {
  projects: CrewProject[];
  tasks: CrewTask[];
  memberships?: Membership[];
  projectCreators?: Record<string, string>;
  profiles?: ActorProfile[];
};
type Me = { username: string; kind?: "human" | "agent" };

/** An error that kept the server's machine-readable code, not just its prose. */
class RequestFailed extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "RequestFailed";
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The code is retained so callers can distinguish "you are signed out"
    // from "this failed". Matching on the prose would break the moment the
    // wording changed.
    throw new RequestFailed(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
      typeof body.code === "string" ? body.code : undefined,
    );
  }
  return body as T;
}

/**
 * The brief editor, which knows what it can actually save.
 *
 * It used to invite 4000 characters into a textarea and find out at save time
 * that the transport carries 2000 — so the way a writer learned about the limit
 * was by losing an afternoon's writing to a 400. `maxLength={4000}` was worse
 * than nothing: it silently stopped accepting keystrokes at a number that was
 * not the real limit, so the writer saw neither the wall they hit nor the one
 * still coming.
 *
 * The budget is MEASURED against the exact encoder the BFF uses, not estimated,
 * and recomputed on every keystroke because the cost of a character depends on
 * the character — a quote or a newline costs two.
 */
function BriefForm({
  task,
  busy,
  onSave,
}: {
  task: CrewTask;
  busy: boolean;
  onSave: (task: CrewTask, description: string) => void | Promise<void>;
}) {
  const [text, setText] = useState(task.description ?? "");
  const budget = briefBudget(task as unknown as Record<string, unknown>, text);
  const said = describeBudget(budget);

  return (
    <form
      className="task-brief-form"
      onSubmit={(event) => {
        event.preventDefault();
        // Belt and braces: the button is disabled too, but a form can still be
        // submitted from the keyboard in some browsers, and the failure here is
        // losing what someone wrote.
        if (!budget.fits) return;
        void onSave(task, text);
      }}
    >
      <label htmlFor={`brief-${task.id}`}>
        What does this card mean, and what does finishing it look like?
      </label>
      <textarea
        id={`brief-${task.id}`}
        name="description"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={`brief-budget-${task.id}`}
        aria-invalid={budget.fits ? undefined : true}
      />
      {/*
        * aria-live so the warning reaches someone who is typing rather than
        * looking at it. Polite rather than assertive: it should be there when
        * they pause, not interrupt them mid-sentence.
        */}
      <p
        id={`brief-budget-${task.id}`}
        className={`brief-budget brief-budget--${said.tone}`}
        aria-live="polite"
      >
        {said.text}
      </p>
      <button disabled={busy || !budget.fits}>
        {task.description ? "Update brief" : "Write brief"}
      </button>
    </form>
  );
}

export function ProjectWorkspace({ tab }: { tab: Extract<Tab, "projects" | "overview" | "board" | "mood" | "mine"> }) {
  const [state, setState] = useState<ProjectState>({ projects: [], tasks: [] });
  const [me, setMe] = useState<Me | null>(null);
  const [viewedUsername, setViewedUsername] = useState("");
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("saha-project") ?? "");
  /**
   * The selected project, readable from inside `load` without making `load`
   * depend on it. A dependency there would tear down and rebuild the polling
   * effect on every project switch, which is how a poll loop ends up restarting
   * more often than it polls.
   */
  const [boards, setBoards] = useState<Board[]>([]);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /**
   * Signed out is a distinct state from failed.
   *
   * Rendering the create form to a signed-out visitor offers an action that is
   * guaranteed to 401. An interface should not invite you to do something it
   * knows will not work.
   */
  const [signedOut, setSignedOut] = useState(false);
  /** When the view was last confirmed against the server, and whether it has drifted. */
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  /** Whether we have ever succeeded, so a first failure still shows an error. */
  const hasLoadedRef = useRef(false);
  /** Task named by the URL hash, so a jump from the feed opens the right card. */
  const [hashTaskId, setHashTaskId] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#task-/, ""),
  );

  const load = useCallback(async () => {
    try {
      // saha.ing's own database, not a fold of the chat room. See ADR-002.
      const [list, people, current] = await Promise.all([
        board.projects(),
        board.people(),
        json<Me>(`${import.meta.env.BASE_URL}bff/me`),
      ]);
      // One project's cards are fetched with the project, so switching projects
      // is one request rather than a re-fold of everything.
      const wanted = selectedIdRef.current || (list.projects[0]?.id as string | undefined);
      const detail = wanted ? await board.project(wanted) : null;

      const projects: ProjectState = {
        projects: list.projects.map((row) => toCrewProject(row as Record<string, unknown>)),
        tasks: ((detail?.tasks ?? []) as Array<Record<string, unknown>>).map(toCrewTask) as CrewTask[],
        memberships: (people.memberships ?? []) as Membership[],
        profiles: (people.actors ?? []).map((row) => toProfile(row as Record<string, unknown>)) as ActorProfile[],
      };
      setBoards((detail?.boards ?? []) as Board[]);
      setState(projects);
      setMe(current);
      setViewedUsername((username) => username || current.username);
      setSelectedId((currentId) => currentId || projects.projects[0]?.id || "");
      setError("");
      setSignedOut(false);
      setLastUpdated(new Date());
      setStale(false);
      hasLoadedRef.current = true;
    } catch (cause) {
      const code = cause instanceof RequestFailed ? cause.code : undefined;
      if (code === "SESSION_EXPIRED") {
        setSignedOut(true);
        setError("");
        return;
      }
      setSignedOut(false);
      // A failed BACKGROUND refresh must not blank a screen that already holds
      // good data — but it must not let that data pass as current either. The
      // view stays and is marked stale with the time it was last confirmed, so
      // a reader can see both what they have and how old it is.
      //
      // Only a failure with nothing to show becomes an error.
      setStale(true);
      if (!hasLoadedRef.current) {
        setError(cause instanceof Error ? cause.message : "Could not load projects");
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Keep an open view current without a manual refresh.
   *
   * Three of us post events at this board and a reader had to reload to see any
   * of them — which is how someone ends up acting on a stale picture, and how
   * one agent claimed a task that had already been completed.
   *
   * Polling is only affordable because a warm read is now under a second; on the
   * old full-replay path this would have been a self-inflicted load problem
   * rather than a feature.
   *
   * Paused when the tab is hidden. A background tab that keeps polling costs the
   * server real work for a screen nobody is looking at, and a phone pays for it
   * in battery.
   */
  useEffect(() => {
    let timer: number | undefined;

    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, 15_000);
    };
    const onVisibility = () => {
      // Refresh immediately on return rather than waiting out the interval: the
      // first thing someone does after switching back is read the screen.
      if (document.visibilityState === "visible") void load();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    const sync = () => setHashTaskId(window.location.hash.replace(/^#task-/, ""));
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  // Scroll to the card once it exists. Deferred to a frame so the details
  // element has opened first, or the browser scrolls to the collapsed height.
  useEffect(() => {
    if (!hashTaskId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`task-${hashTaskId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hashTaskId, tab]);
  useEffect(() => { if (selectedId) localStorage.setItem("saha-project", selectedId); }, [selectedId]);

  const selected = state.projects.find((project) => project.id === selectedId);
  const tasks = state.tasks.filter((task) => task.projectId === selectedId);

  /**
   * What the durable log says about an actor — nothing more.
   *
   * An actor with no profile stays UNKNOWN rather than being assumed human.
   * Guessing here would put a "human" label on every agent that has not
   * declared itself, which is the one direction that actively misleads, and
   * this board is mostly agents.
   */
  const actorProfile = useCallback(
    (actorId: string) => state.profiles?.find((profile) => profile.actorId === actorId),
    [state.profiles],
  );
  const actorMark = useCallback(
    (actorId: string, size: number, showName = false) => {
      const profile = actorProfile(actorId);
      return <Identity username={actorId} kind={profile?.kind} displayName={profile?.displayName} size={size} showName={showName} />;
    },
    [actorProfile],
  );
  const workOwners = useMemo(() => {
    const usernames = new Set<string>();
    if (me?.username) usernames.add(me.username);
    for (const task of tasks) {
      for (const owner of task.owners ?? []) usernames.add(owner);
      if (task.assigneeId) usernames.add(task.assigneeId);
    }
    return Array.from(usernames).sort((a, b) => a.localeCompare(b));
  }, [tasks, me?.username]);
  const viewedTasks = useMemo(
    () => tasks.filter((task) => task.owners?.includes(viewedUsername) || task.assigneeId === viewedUsername),
    [tasks, viewedUsername],
  );
  useEffect(() => {
    if (viewedUsername && !workOwners.includes(viewedUsername)) setViewedUsername(me?.username ?? workOwners[0] ?? "");
  }, [me?.username, viewedUsername, workOwners]);

  /**
   * Run one write, then reload.
   *
   * Replaces `append`, which posted a crew-event fence. The difference is not
   * cosmetic: a fence was a message whose effect you discovered by re-reading
   * the room, and this is a request that either happened or did not, with the
   * server saying which — and saying it in words meant for a person.
   */
  const write = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (cause) {
      // The server's refusal is a sentence, not a code. Keeping it is the
      // difference between "you are not a member of saha; treat this as a
      // request pending a manager" and "Could not save".
      setError(cause instanceof BoardError ? cause.message : cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Append one comment. Deliberately task.commented rather than re-sending the
   * card: two people commenting at once must not overwrite each other, and the
   * whole card plus every prior comment does not fit in one 2000-character
   * durable message.
   */
  const addComment = async (taskId: string, body: string) => {
    if (!me?.username || !body.trim()) return;
    // The server assigns the id, the author and the order now. It knows who is
    // authenticated, and it knows what arrived first — both of which the client
    // was previously asserting about itself.
    await write(() => board.comment(taskId, body.trim()));
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const summary = String(data.get("summary") ?? "").trim();
    const goal = String(data.get("goal") ?? "").trim();
    const stepTitles = String(data.get("steps") ?? "").split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 10);
    if (!name || !summary || !goal || stepTitles.length === 0) return setError("Name, summary, goal, and at least one step are required.");
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    await write(() => board.createProject({ id, name, summary, goals: [goal] }));
    setSelectedId(id);
    event.currentTarget.reset();
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return setError("Select a project first.");
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const owner = String(data.get("owner") ?? "").trim();
    const kind = String(data.get("kind") ?? "").trim();
    const priority = Number(data.get("priority")) || undefined;
    if (!title) return setError("Task title is required.");
    await write(() => board.createTask({
      projectId: selected.id,
      title,
      // Omitted entirely when unspecified rather than sent as a default. The
      // field exists to stop the board claiming what nobody told it, and the
      // column is nullable for the same reason.
      ...(kind === "decision" || kind === "build" ? { kind } : {}),
      ...(priority ? { priority } : {}),
      ...(owner ? { owners: [owner] } : {}),
    }));
    event.currentTarget.reset();
  };

  /**
   * Which tab is open, per card. Defaults to the brief.
   *
   * Discussion used to be the only thing here, which meant the newest remark
   * sat where the brief belongs. What a card MEANS should not be something you
   * reach by scrolling past what someone said about it this afternoon.
   */
  const [openTab, setOpenTab] = useState<Record<string, "brief" | "discussion" | "links">>({});
  const tabOf = (taskId: string) => openTab[taskId] ?? "brief";

  /**
   * Save a description.
   *
   * task.upserted REPLACES the stored card, so the whole task is sent with the
   * one field changed. Sending only the description would silently drop owners,
   * comments and status — an edit that looks like a small one and is not.
   */
  /**
   * Strip the discussion off a card before sending it.
   *
   * task.upserted replaces the stored card, so this used to re-send every
   * comment on every edit — and a card's comments outgrow a 2000-character
   * durable message after about the third one. Eleven cards had already passed
   * that point: claiming them, accepting them, renaming them or writing a brief
   * all failed with a 400, because the discussion was riding along in a payload
   * that had nothing to do with it. Sending the card without comments instead
   * silently deleted them. There was no third option until the reducer learned
   * that an omitted `comments` means unchanged.
   *
   * So: never send them. Comments travel as task.commented, one at a time,
   * which is also the only shape where two people commenting at once do not
   * erase each other.
   */
  const withoutDiscussion = (task: CrewTask): Omit<CrewTask, "comments"> => {
    const { comments: _discussion, ...card } = task;
    return card;
  };

  const saveDescription = async (task: CrewTask, description: string) => {
    const trimmed = description.trim();
    // null means CLEARED, undefined means not mentioned. The API keeps those
    // apart, so a brief someone deleted is deleted and a brief nobody touched
    // survives an unrelated edit.
    await write(() => board.updateTask(task.id, { description: trimmed || null }));
  };

  const updateTask = async (task: CrewTask, action: "claim" | "accept" | "start") => {
    if (!me?.username) return setError("Sign in before changing task ownership.");
    // Ownership and status are separate calls because they are separate rules.
    // Folding them into one "upsert" is what let an illegal move ride along
    // with an ownership change; the server refuses each on its own terms now.
    await write(async () => {
      if (action === "start") {
        await board.transition(task.id, "in_progress");
        return;
      }
      await board.ownership(task.id, action === "claim" ? "claim" : "accept");
    });
  };

  /**
   * One card, rendered identically wherever it appears.
   *
   * The board and My work had drifted into two renderings of the same thing:
   * the board showed a full card, My work showed a status and a title and
   * nothing you could act on. So your own page was the one place you could not
   * claim, accept, start or comment on your own work, which is backwards.
   *
   * Defined here rather than in its own file because it closes over the
   * mutation handlers and the signed-in identity; lifting it out would mean
   * threading six props through for no gain.
   */
  const renderCard = (task: CrewTask) => (
    <article className="task-card" id={`task-${task.id}`} key={task.id}>
                    <h4>{task.title}</h4>

                    <p className="card-meta">
                      <span className={`kind-chip kind-chip--${kindLabel(task.kind)}`}>{kindLabel(task.kind)}</span>
                      {task.comments?.length ? <span className="card-count">{task.comments.length} 💬</span> : null}
                    </p>

                    <p className="card-owner">
                      {task.owners?.length ? (
                        <>
                          <span className="owner-marks">{task.owners.map((owner) => <span key={owner}>{actorMark(owner, 22)}</span>)}</span>
                          <span>{task.owners.join(", ")}</span>
                        </>
                      ) : (
                        <span className="card-unassigned">unassigned</span>
                      )}
                      {task.owners?.length && !task.acceptedBy?.length ? <span className="card-unaccepted">not yet accepted</span> : null}
                    </p>

                    <details className="task-detail" open={hashTaskId === task.id}>
                      <summary>
                        {task.description ? "Brief" : "No brief yet"}
                        {(task.comments?.length ?? 0) > 0 ? ` · ${task.comments!.length} comment${task.comments!.length === 1 ? "" : "s"}` : ""}
                      </summary>

                      {/*
                        * Tabs, so a card can carry what it MEANS separately from
                        * what people said about it. Real buttons in a tablist
                        * rather than styled divs: this has to be reachable from
                        * a keyboard, and a div cannot be.
                        */}
                      <div className="task-tabs" role="tablist" aria-label={`${task.title} detail`}>
                        {([
                          ["brief", "Brief"],
                          ["discussion", `Discussion${task.comments?.length ? ` (${task.comments.length})` : ""}`],
                          ["links", `Links${task.links?.length ? ` (${task.links.length})` : ""}`],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            id={`tab-${id}-${task.id}`}
                            aria-selected={tabOf(task.id) === id}
                            aria-controls={`panel-${id}-${task.id}`}
                            className={tabOf(task.id) === id ? "task-tab task-tab--on" : "task-tab"}
                            onClick={() => setOpenTab((current) => ({ ...current, [task.id]: id }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {tabOf(task.id) === "brief" ? (
                        <div className="task-panel" role="tabpanel" id={`panel-brief-${task.id}`} aria-labelledby={`tab-brief-${task.id}`}>
                          {task.description ? (
                            <p className="task-description">{task.description}</p>
                          ) : (
                            /*
                             * An explicit invitation, not an empty panel. Blank
                             * space here reads as a card that failed to load
                             * rather than one nobody has written a brief for.
                             */
                            <p className="muted-note">
                              Nobody has written a brief for this card yet.{me ? " You can." : ""}
                            </p>
                          )}
                          {me ? <BriefForm task={task} busy={busy} onSave={saveDescription} /> : null}
                        </div>
                      ) : null}

                      {tabOf(task.id) === "links" ? (
                        <div className="task-panel" role="tabpanel" id={`panel-links-${task.id}`} aria-labelledby={`tab-links-${task.id}`}>
                          {task.links?.length ? (
                            <ul className="task-links">
                              {task.links.map((link) => (
                                <li key={link.href}>
                                  <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted-note">No links on this card.</p>
                          )}
                        </div>
                      ) : null}

                      {tabOf(task.id) === "discussion" ? (
                      <div className="task-panel" role="tabpanel" id={`panel-discussion-${task.id}`} aria-labelledby={`tab-discussion-${task.id}`}>
                      {(task.comments?.length ?? 0) === 0 ? <p className="muted-note">No discussion yet.</p> : null}
                      {task.comments?.map((comment) => (
                        <div className="task-comment" key={comment.id}>
                          <p className="task-comment-meta">
                            {actorMark(comment.author, 20)}
                            <b>{comment.author}</b>
                            <time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 16).replace("T", " ")}</time>
                          </p>
                          <p className="task-comment-body">{comment.body}</p>
                        </div>
                      ))}

                      {me ? (
                        <form
                          className="task-comment-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = event.currentTarget;
                            const value = String(new FormData(form).get("body") ?? "");
                            void addComment(task.id, value).then(() => form.reset());
                          }}
                        >
                          <label htmlFor={`comment-${task.id}`}>Add a comment</label>
                          <textarea id={`comment-${task.id}`} name="body" rows={3} required />
                          <button disabled={busy}>Comment</button>
                        </form>
                      ) : null}
                      </div>
                      ) : null}
                    </details>

                    <div className="task-actions">
                      {!task.owners?.length ? <button disabled={busy || !me} onClick={() => void updateTask(task, "claim")}>Claim</button> : null}
                      {task.owners?.includes(me?.username ?? "") && !task.acceptedBy?.includes(me?.username ?? "")
                        ? <button disabled={busy} onClick={() => void updateTask(task, "accept")}>Accept</button> : null}
                      {task.acceptedBy?.includes(me?.username ?? "") && task.status === "assigned"
                        ? <button disabled={busy} onClick={() => void updateTask(task, "start")}>Start</button> : null}
                    </div>
                  </article>
  );

  return (
    <section className={`project-workspace${tab === "board" || tab === "mood" ? " project-workspace--wide" : ""}`} aria-busy={busy}>
      {error ? <p className="project-error" role="alert">{error}</p> : null}

      {/*
        * Freshness, stated rather than assumed.
        *
        * A screen that silently stops updating looks identical to one where
        * nothing has happened — which is precisely how a reader acts on a stale
        * picture. When a refresh fails we keep the data and say when it was last
        * confirmed, instead of blanking the view or letting it pass as current.
        */}
      {!signedOut && lastUpdated ? (
        <p className={`freshness${stale ? " freshness--stale" : ""}`} role="status" aria-live="polite">
          {stale ? (
            <>
              Not updating — showing what was last confirmed at{" "}
              <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString()}</time>.
              <button type="button" onClick={() => void load()}>Try now</button>
            </>
          ) : (
            <>
              Updating automatically · last confirmed{" "}
              <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString()}</time>
            </>
          )}
        </p>
      ) : null}

      {signedOut ? (
        <div className="signin-callout" role="status">
          <strong>Sign in to see and change projects.</strong>
          <p>
            Projects are read from the room's durable log, which needs an authenticated session.
            Nothing is shown here rather than an empty board, because an empty board and a
            signed-out one look identical and mean different things.
          </p>
          <p className="signin-hint">Open <b>Chat</b> and sign in, then return to this tab.</p>
        </div>
      ) : null}
      {state.projects.length && tab !== "board" ? (
        <label className="project-picker">Project
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      ) : null}

      {tab === "projects" && !signedOut ? (
        <div className="project-grid">
          <div><h2>Projects</h2>{state.projects.map((project) => (
            <button className="project-row" key={project.id} onClick={() => setSelectedId(project.id)}>
              <strong>{project.name}</strong><span>{project.summary}</span>
            </button>
          ))}</div>
          {/* Hidden rather than disabled when signed out: a disabled form still
              advertises an action, and the honest message is "sign in", not
              "this button does nothing". */}
          <form className="project-form" onSubmit={createProject}>
            <h2>Create project</h2>
            <label>Name<input name="name" required /></label>
            <label>Summary<textarea name="summary" required /></label>
            <label>Main goal<textarea name="goal" required /></label>
            <label>Headline steps <small>One per line, 1–10</small><textarea name="steps" required /></label>
            <button disabled={busy}>Create and persist</button>
          </form>
        </div>
      ) : null}

      {tab === "overview" && !signedOut && selected ? <div className="project-overview">
        <p className="eyebrow">PROJECT OVERVIEW</p><h2>{selected.name}</h2><p>{selected.summary}</p>
        {/* Split by kind, never one combined number: a single "8 of 9 done"
            is what let this board imply a working product when every finished
            card was a decision. */}
        <p className="kind-progress">{describeProgress(tasks)}</p>

        <h3>Goals</h3><ul>{selected.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
        <h3>Steps</h3><ol>{selected.steps.map((step) => <li key={step.id} data-status={step.status}>{step.title}</li>)}</ol>

        {/*
          * Live updates, derived from the comments already loaded rather than
          * fetched separately: a second source for a fact we hold would drift
          * from the first.
          *
          * It shows COMMENTS, not every change. A status transition carries no
          * author or timestamp in the projected state, so including it would
          * mean inventing one of them — and a feed that guessed who moved a
          * card is worse than one that only reports what it can attribute.
          * The heading says so rather than implying completeness.
          */}
        {(() => {
          const memberships = state.memberships ?? [];
          const members = membersOf(memberships, selected.id);
          const creator = state.projectCreators?.[selected.id];
          const canManage =
            me !== null && canManageMembership(memberships, selected.id, me.username, creator);

          return (
            <>
              <h3>Members</h3>
              {members.length === 0 ? (
                <p className="muted-note">
                  Nobody has been added to this project yet.{" "}
                  {creator ? (
                    <>Only <b>{creator}</b>, who created it, can add the first member.</>
                  ) : (
                    // No recorded creator means the bootstrap is closed. Saying
                    // so is better than an empty list that looks like a bug.
                    <>No creator was recorded for this project, so nobody can seed its membership.</>
                  )}
                </p>
              ) : (
                <ul className="member-list">
                  {members.map((member) => (
                    <li key={member.actorId}>
                      <b>{member.actorId}</b>
                      <span className="member-roles">{member.roles.join(", ")}</span>
                      <small>added by {member.grantedBy}</small>
                    </li>
                  ))}
                </ul>
              )}

              {/* Only rendered for someone who may actually do it. */}
              {canManage ? (
                <form
                  className="member-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    const actorId = String(data.get("actorId") ?? "").trim();
                    const roles = ROLES.filter((role) => data.getAll("roles").includes(role)) as Role[];
                    if (!actorId || roles.length === 0) {
                      setError("A member needs a name and at least one role.");
                      return;
                    }
                    void write(() => board.membership(selected.id, actorId, "grant", roles))
                      .then(() => form.reset());
                  }}
                >
                  <label>
                    Add a member
                    <input name="actorId" placeholder="username" aria-label="Member username" />
                  </label>
                  <fieldset>
                    <legend>Roles</legend>
                    {ROLES.map((role) => (
                      <label key={role} className="role-option">
                        <input type="checkbox" name="roles" value={role} /> {role}
                      </label>
                    ))}
                  </fieldset>
                  <button disabled={busy}>Add to project</button>
                </form>
              ) : (
                <p className="muted-note">
                  Membership is managed by this project's managers. Being assigned a card does not make you a
                  member, and operating an agent gives that agent nothing here.
                </p>
              )}
            </>
          );
        })()}

        <h3>Recent discussion</h3>
        {recentActivity(tasks).length === 0 ? (
          <p className="muted-note">Nothing has been discussed on this project yet.</p>
        ) : (
          <ul className="activity-feed">
            {recentActivity(tasks).map((entry) => (
              <li key={`${entry.taskId}-${entry.at}-${entry.author}`}>
                <button
                  type="button"
                  onClick={() => {
                    // Takes you to the item it came from, which is the point of
                    // the feed: reading about a change and finding it are one
                    // action, not two.
                    // A real navigation, not local state: the Board is a URL,
                    // so jumping to a card is linkable and survives a refresh
                    // like every other location in this app.
                    setSelectedId(selected.id);
                    const target = `${import.meta.env.BASE_URL}board#task-${entry.taskId}`;
                    window.history.pushState({}, "", target);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                >
                  <span className="activity-meta">
                    <b>{entry.author}</b>
                    <span>on {entry.taskTitle}</span>
                    <time dateTime={entry.at}>{entry.at.slice(0, 16).replace("T", " ")}</time>
                  </span>
                  <span className="activity-excerpt">{entry.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted-note">Shows discussion only. Status changes are not attributable to a person in the stored state, so they are not invented here.</p>
      </div> : null}

      {tab === "board" && !signedOut && selected ? (
        <div className="board">
          <header className="board-bar">
            <label className="board-project">
              <span>Project</span>
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            {/* Two different questions, both shown: how much is decided versus
                built, and how much of the weighted work is finished. Neither
                answers the other. */}
            {(() => {
              // The point of priorities: an agent should be able to see what to
              // pick up without asking. Absent when nothing is free, because
              // "everything is taken" is a real answer rather than a blank.
              const next = nextUnclaimed(tasks);
              return next ? (
                <a className="next-up" href={`${import.meta.env.BASE_URL}board#task-${next.id}`}>
                  Next unclaimed: <b>{next.title}</b>
                  {next.priority !== undefined ? <span> · {priorityLabel(next.priority)}</span> : <span> · untriaged</span>}
                </a>
              ) : null;
            })()}
            <p className="kind-progress">
              {describeProgress(tasks)}
              {tasks.length ? ` · ${calculateProjectProgress(tasks).percent}% of points done` : ""}
            </p>
          </header>

          {/*
            * Columns by status, not one long list.
            *
            * A flat list makes you read every card to answer "what is in
            * review?" — the question a board exists to answer at a glance.
            * Empty columns are kept rather than hidden: a stage with nothing in
            * it is information, and a board whose shape changes as work moves
            * is harder to read than one that stays still.
            */}
          <div className="board-columns">
            {BOARD_COLUMNS.map((column) => {
              // Most urgent first, untriaged last but not treated as lowest.
              const items = byPriority(tasks.filter((task) => task.status === column.status));
              return (
                <section
                  className="board-column"
                  key={column.status}
                  aria-label={`${column.label}, ${items.length} ${items.length === 1 ? "card" : "cards"}`}
                >
                  <header className="column-head">
                    <h3>{column.label}</h3>
                    <span className="column-count">{items.length}</span>
                  </header>

                  <div className="column-cards">
                    {items.map((task) => renderCard(task))}

                    {column.status === "backlog" ? (
                      <details className="add-card-wrap">
                      <summary>+ Add card</summary>
                      <form className="add-card" onSubmit={createTask}>
                        <input name="title" placeholder="New task…" required aria-label="New task title" />
                        <input name="owner" placeholder="Owner (optional)" aria-label="Owner username" />
                        <select name="priority" defaultValue="" aria-label="Priority">
                          <option value="">Priority: unset</option>
                          <option value="1">1 · now</option>
                          <option value="2">2 · next</option>
                          <option value="3">3 · soon</option>
                          <option value="4">4 · later</option>
                          <option value="5">5 · someday</option>
                        </select>
                        <select name="kind" defaultValue="" aria-label="Task kind">
                          <option value="">Kind: unspecified</option>
                          <option value="decision">Kind: decision</option>
                          <option value="build">Kind: build</option>
                        </select>
                        <button disabled={busy}>Add card</button>
                      </form>
                      </details>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>

        </div>
      ) : null}

      {tab === "mood" && !signedOut && selected ? (
        <div className="mood-tab">
          {/*
            * Its own tab rather than a strip under the board.
            *
            * A mood board is something you look AT for a while — you sit with
            * it, move things around, compare two references. Under the kanban
            * it was permanently below the fold, and any time you scrolled to it
            * you had six columns of cards above you competing for the same
            * attention. Different activity, different place.
            */}
          <p className="muted-note">
            References, palette and tone for <strong>{selected.name}</strong>. Images live on saha.ing —
            drop them here, or use Add images.
          </p>

          {boards.length === 0 ? (
            <p className="empty-note">
              No mood boards on this project yet.{me?.username ? " Make one below." : ""}
            </p>
          ) : null}

          {boards.map((moodBoard) => (
            <MoodBoard
              key={moodBoard.id}
              board={moodBoard}
              canEdit={Boolean(me?.username)}
              onChanged={() => void load()}
            />
          ))}

          {me?.username ? (
            <form
              className="moodboard-new"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const name = String(new FormData(form).get("name") ?? "").trim();
                if (!name) return;
                void write(() => board.createBoard(selected.id, name)).then(() => form.reset());
              }}
            >
              <label htmlFor="new-moodboard">Add a mood board</label>
              <input id="new-moodboard" name="name" placeholder="References, palette, tone…" maxLength={120} />
              <button disabled={busy}>Create</button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === "mine" && !signedOut ? <div>
        <p className="eyebrow">{me?.username ?? "NOT SIGNED IN"}{me?.kind ? ` / ${me.kind.toUpperCase()}` : ""}</p>
        <h2>{viewedUsername === me?.username ? "My work" : `${viewedUsername}'s work`}</h2>
        <label className="project-picker">View work for
          <select value={viewedUsername} onChange={(event) => setViewedUsername(event.target.value)}>
            {workOwners.map((username) => <option key={username} value={username}>{username === me?.username ? `${username} (me)` : username}</option>)}
          </select>
        </label>
        {viewedTasks.length ? (
          <div className="my-work-cards">{viewedTasks.map((task) => renderCard(task))}</div>
        ) : (
          <p className="muted-note">No tasks assigned to this identity.</p>
        )}
      </div> : null}
    </section>
  );
}
