import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CrewProject, CrewTask } from "./event-core";
import type { Tab } from "./router";
import { recentActivity } from "./recent-activity";
import { describeProgress, kindLabel } from "./task-kind";
import { BOARD_COLUMNS } from "./project-model";

const PROJECT_ROOM = "AgentParty";

type ProjectState = { projects: CrewProject[]; tasks: CrewTask[] };
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

export function ProjectWorkspace({ tab }: { tab: Extract<Tab, "projects" | "overview" | "board" | "mine"> }) {
  const [state, setState] = useState<ProjectState>({ projects: [], tasks: [] });
  const [me, setMe] = useState<Me | null>(null);
  const [viewedUsername, setViewedUsername] = useState("");
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("saha-project") ?? "");
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
  /** Task named by the URL hash, so a jump from the feed opens the right card. */
  const [hashTaskId, setHashTaskId] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#task-/, ""),
  );

  const load = useCallback(async () => {
    try {
      const [projects, current] = await Promise.all([
        json<ProjectState>(`${import.meta.env.BASE_URL}bff/projects?room=${encodeURIComponent(PROJECT_ROOM)}`),
        json<Me>(`${import.meta.env.BASE_URL}bff/me`),
      ]);
      setState(projects);
      setMe(current);
      setViewedUsername((username) => username || current.username);
      setSelectedId((currentId) => currentId || projects.projects[0]?.id || "");
      setError("");
      setSignedOut(false);
    } catch (cause) {
      const code = cause instanceof RequestFailed ? cause.code : undefined;
      if (code === "SESSION_EXPIRED") {
        setSignedOut(true);
        setError("");
        return;
      }
      setSignedOut(false);
      setError(cause instanceof Error ? cause.message : "Could not load projects");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const append = async (payload: unknown) => {
    setBusy(true);
    setError("");
    try {
      await json(`${import.meta.env.BASE_URL}bff/project-events`, {
        method: "POST",
        body: JSON.stringify({ room: PROJECT_ROOM, payload }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
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
    await append({
      type: "task.commented",
      taskId,
      comment: {
        // Author and time are in the id so a retry after a timed-out write
        // resolves to the same comment rather than a duplicate.
        id: `${taskId}-${me.username}-${Date.now().toString(36)}`,
        author: me.username,
        body: body.trim(),
        createdAt: new Date().toISOString(),
      },
    });
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
    await append({
      type: "project.upserted",
      project: {
        id, name, summary, goals: [goal],
        steps: stepTitles.map((title, index) => ({ id: `${id}-step-${index + 1}`, title, status: "not_started" })),
      },
    });
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
    if (!title) return setError("Task title is required.");
    await append({
      type: "task.upserted",
      task: {
        id: `${selected.id}-task-${Date.now().toString(36)}`,
        projectId: selected.id,
        title,
        status: owner ? "assigned" : "backlog",
        points: 1,
        // Omitted entirely when unspecified, rather than sent as a default. The
        // field's purpose is to stop the board claiming what nobody told it.
        ...(kind === "decision" || kind === "build" ? { kind } : {}),
        owners: owner ? [owner] : [],
        acceptedBy: [], comments: [], links: [], images: [],
      },
    });
    event.currentTarget.reset();
  };

  const updateTask = async (task: CrewTask, action: "claim" | "accept" | "start") => {
    if (!me?.username) return setError("Sign in before changing task ownership.");
    const username = me.username;
    const owners = action === "claim" ? [username] : task.owners ?? [];
    if (action !== "claim" && !owners.includes(username)) {
      return setError("Only an assigned owner can accept or start this task.");
    }
    const acceptedBy = action === "accept"
      ? Array.from(new Set([...(task.acceptedBy ?? []), username]))
      : task.acceptedBy ?? [];
    await append({
      type: "task.upserted",
      task: {
        ...task,
        owners,
        assigneeId: owners[0],
        acceptedBy,
        status: action === "start" ? "in_progress" : "assigned",
      },
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
                      {task.owners?.length ? task.owners.join(", ") : "unassigned"}
                      {task.owners?.length && !task.acceptedBy?.length ? " · not yet accepted" : ""}
                    </p>

                    <details className="task-detail" open={hashTaskId === task.id}>
                      <summary>
                        {(task.comments?.length ?? 0) === 0
                          ? "No discussion yet"
                          : `${task.comments!.length} comment${task.comments!.length === 1 ? "" : "s"}`}
                      </summary>

                      {task.comments?.map((comment) => (
                        <div className="task-comment" key={comment.id}>
                          <p className="task-comment-meta">
                            <b>{comment.author}</b>
                            <time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 16).replace("T", " ")}</time>
                          </p>
                          <p className="task-comment-body">{comment.body}</p>
                        </div>
                      ))}

                      {task.links?.length ? (
                        <ul className="task-links">
                          {task.links.map((link) => (
                            <li key={link.href}>
                              <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>
                            </li>
                          ))}
                        </ul>
                      ) : null}

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
    <section className="project-workspace" aria-busy={busy}>
      {error ? <p className="project-error" role="alert">{error}</p> : null}

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
      {state.projects.length ? (
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
            <h2>{selected.name}</h2>
            <p className="kind-progress">{describeProgress(tasks)}</p>
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
              const items = tasks.filter((task) => task.status === column.status);
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
                      <form className="add-card" onSubmit={createTask}>
                        <input name="title" placeholder="New task…" required aria-label="New task title" />
                        <input name="owner" placeholder="Owner (optional)" aria-label="Owner username" />
                        <select name="kind" defaultValue="" aria-label="Task kind">
                          <option value="">Kind: unspecified</option>
                          <option value="decision">Kind: decision</option>
                          <option value="build">Kind: build</option>
                        </select>
                        <button disabled={busy}>Add card</button>
                      </form>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
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
