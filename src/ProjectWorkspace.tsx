import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CrewProject, CrewTask } from "./event-core";
import type { Tab } from "./router";

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
    if (!title) return setError("Task title is required.");
    await append({
      type: "task.upserted",
      task: {
        id: `${selected.id}-task-${Date.now().toString(36)}`,
        projectId: selected.id,
        title,
        status: owner ? "assigned" : "backlog",
        points: 1,
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
        <h3>Goals</h3><ul>{selected.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
        <h3>Steps</h3><ol>{selected.steps.map((step) => <li key={step.id} data-status={step.status}>{step.title}</li>)}</ol>
      </div> : null}

      {tab === "board" && !signedOut && selected ? <div className="project-grid">
        <div><h2>{selected.name} board</h2>{tasks.length ? tasks.map((task) => (
          <article className="task-row" key={task.id}>
            <span>{task.status.replace("_", " ")}</span><h3>{task.title}</h3>
            <p>{task.owners?.length ? `Owner: ${task.owners.join(", ")}` : "Unassigned · available to claim"}</p>
            {task.acceptedBy?.length ? <p>Accepted by: {task.acceptedBy.join(", ")}</p> : null}
            <div className="task-actions">
              {!task.owners?.length ? <button disabled={busy || !me} onClick={() => void updateTask(task, "claim")}>Claim task</button> : null}
              {task.owners?.includes(me?.username ?? "") && !task.acceptedBy?.includes(me?.username ?? "")
                ? <button disabled={busy} onClick={() => void updateTask(task, "accept")}>Accept assignment</button> : null}
              {task.acceptedBy?.includes(me?.username ?? "") && task.status === "assigned"
                ? <button disabled={busy} onClick={() => void updateTask(task, "start")}>Start work</button> : null}
            </div>
          </article>
        )) : <p>No tasks yet.</p>}</div>
        <form className="project-form" onSubmit={createTask}><h2>Add task</h2><label>Task<input name="title" required /></label><label>Owner username <small>Optional</small><input name="owner" /></label><button disabled={busy}>Add to board</button></form>
      </div> : null}

      {tab === "mine" && !signedOut ? <div>
        <p className="eyebrow">{me?.username ?? "NOT SIGNED IN"}{me?.kind ? ` / ${me.kind.toUpperCase()}` : ""}</p>
        <h2>{viewedUsername === me?.username ? "My work" : `${viewedUsername}'s work`}</h2>
        <label className="project-picker">View work for
          <select value={viewedUsername} onChange={(event) => setViewedUsername(event.target.value)}>
            {workOwners.map((username) => <option key={username} value={username}>{username === me?.username ? `${username} (me)` : username}</option>)}
          </select>
        </label>
        {viewedTasks.length ? viewedTasks.map((task) => <article className="task-row" key={task.id}><span>{task.status}</span><h3>{task.title}</h3></article>) : <p>No tasks assigned to this identity.</p>}
      </div> : null}
    </section>
  );
}
