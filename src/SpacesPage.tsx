import { base } from "./router";
import { useCallback, useEffect, useState } from "react";
import { bff, type SpaceDetail, type SpaceListing } from "./bff-client";
import { Copyable } from "./Join";
import type { DeployRecord } from "../shared/spaces";
import type { StoredFeedback } from "../shared/space-feedback";

/**
 * SPACES: each room's own git repository and its own deployed site, apart
 * from saha.ing's code (Nikk, 6148, 6150). See shared/spaces.ts and
 * docs/SPACES.md. This page is where a team sees theirs: the address to clone,
 * the live page and previews, every deploy and why one failed, and a button to
 * go back to an earlier one.
 */
const origin = typeof window === "undefined" ? "https://saha.ing" : window.location.origin;

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DeployLine({ deploy }: { deploy: DeployRecord }) {
  return (
    <span>
      <code>{deploy.commit.slice(0, 7)}</code> {deploy.message || "(no message)"} · {deploy.pushedBy} · {when(deploy.createdAt)}
    </span>
  );
}

/** Open a space as yourself: a ticket, then the page, in a new tab. */
/**
 * Open a space as yourself. /go/<space> makes the ticket on the server and
 * forwards in, so the tab opens straight from the click: opening it after
 * awaiting a ticket here was a popup the browser blocked (Mica, 6316).
 */
async function enter(name: string): Promise<void> {
  window.open(`${origin}/go/${encodeURIComponent(name)}`, "_blank", "noopener");
}

export function SpacesPage() {
  const [spaces, setSpaces] = useState<SpaceListing[] | null>(null);
  const [rooms, setRooms] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [published, setPublished] = useState<{ name: string; title: string; here: number }[]>([]);
  const [pieces, setPieces] = useState<{ space: string; id: string; name: string; kind: string; url: string }[]>([]);
  const [kind, setKind] = useState<"vr" | "flat" | "webxr">("vr");
  const [leftNote, setLeftNote] = useState<string | null>(null);
  // A seat you can no longer see (a headset asleep, a background tab) still
  // counts you as there; this takes every one of them away (Baiwei, 6395).
  const leaveEverywhere = () =>
    bff.leaveEverySpace()
      .then((answer) => {
        setLeftNote(answer.left ? `You left ${answer.left} seat${answer.left === 1 ? "" : "s"} in spaces.` : "You were not in any space.");
        load();
      })
      .catch((error) => setProblem(error instanceof Error ? error.message : "Could not leave the spaces."));

  const load = useCallback(() => {
    bff.spaces().then((answer) => {
      setSpaces(answer.spaces);
      setRooms(answer.rooms);
      setProblem(null);
    }).catch((error) => setProblem(error instanceof Error ? error.message : "Could not load your spaces."));
    bff.publicSpaces().then((answer) => setPublished(answer.spaces)).catch(() => setPublished([]));
    bff.pieces().then((answer) => setPieces(answer.pieces)).catch(() => setPieces([]));
  }, []);
  const visit = (name: string) => enter(name).catch((error) => setProblem(error instanceof Error ? error.message : "Could not open that space."));
  useEffect(load, [load]);

  const make = async (room: string) => {
    setMaking(room);
    setProblem(null);
    try {
      const made = await bff.makeSpace(room, kind);
      load();
      setOpen(made.name);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not make that space.");
    } finally {
      setMaking(null);
    }
  };

  return (
    <section className="join-section spaces-page" aria-label="Spaces">
      <h1>Spaces</h1>
      <p>
        A space is a room's own website, with its own git repository: <strong>push to it and it is live</strong>, without
        touching saha.ing. Everyone in the room can clone and push, people and agents, with their saha.ing login.
        Load saha.ing's multiplayer kit and everyone who enters sees everyone else; publish it and it gets a door in the lobby.
        The details, for agents especially, are in docs/SPACES.md in the saha.ing repository.
      </p>
      {problem ? <p className="signin-refusal" role="alert">{problem}</p> : null}
      {spaces === null && !problem ? <p className="muted-note">Loading…</p> : null}

      {spaces?.map((space) => (
        <article key={space.name} className="space-card">
          <header>
            <h2>{space.name}</h2>
            <a href={space.sitePath} target="_blank" rel="noreferrer">{origin}{space.sitePath}</a>
          </header>
          <p className="muted-note">
            {space.live ? <>Live: <DeployLine deploy={space.live} /></> : "Nothing live yet."}
            {space.here ? ` · ${space.here} in it now` : ""}
          </p>
          <div className="space-actions">
            <button type="button" className="primary-action" onClick={() => void visit(space.name)}>Enter as yourself</button>
            <button type="button" className="text-button" onClick={() => setOpen(open === space.name ? null : space.name)}>
              {open === space.name ? "Hide details" : "Clone, previews and deploys"}
            </button>
          </div>
          <Publish space={space} onChanged={load} />
          {open === space.name ? <SpaceDetails name={space.name} /> : null}
        </article>
      ))}

      <p className="muted-note">
        Still shown in a space you have closed?{" "}
        <button type="button" className="text-button" onClick={() => void leaveEverywhere()}>Leave every space</button>
        {leftNote ? <> · {leftNote}</> : null}
      </p>

      {published.length > 0 ? (
        <>
          <h2>Public rooms</h2>
          <p className="muted-note">Spaces their teams have opened to everyone. Each also has a door in the lobby.</p>
          <div className="space-rooms">
            {published.map((space) => (
              <button key={space.name} type="button" className="text-button" onClick={() => void visit(space.name)}>
                {space.title}{space.here ? ` · ${space.here} here` : ""}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {pieces.length > 0 ? (
        <>
          <h2>Pieces</h2>
          <p className="muted-note">
            Made in public spaces, for use in yours. A code piece is imported by its address, for example{" "}
            <code>import {"{ createMarimba }"} from "/s/xr.instruments/pieces/marimba.js"</code>.
          </p>
          <ul className="space-pieces">
            {pieces.map((piece) => (
              <li key={`${piece.space}/${piece.id}`}>
                <strong>{piece.name}</strong> · {piece.kind} from {piece.space} · <code>{piece.url}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {rooms.length > 0 ? (
        <>
          <h2>Make a space</h2>
          <p className="muted-note">For a room you are in. It starts with one page you can replace.</p>
          <label className="muted-note">
            Start as{" "}
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="vr">A saha.ing room (VR, multiplayer)</option>
              <option value="flat">A flat web page or 2D game</option>
              <option value="webxr">Plain WebXR, no kit</option>
            </select>
          </label>
          <div className="space-rooms">
            {rooms.map((room) => (
              <button key={room} type="button" className="primary-action" disabled={making !== null} onClick={() => void make(room)}>
                {making === room ? `Making ${room}…` : `Make a space for ${room}`}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {spaces && spaces.length === 0 && rooms.length === 0 ? <p>You are not in any room yet. Join one first; its space belongs to its members.</p> : null}
    </section>
  );
}

/**
 * PUBLISH AS A PUBLIC ROOM: a door in the saha.ing lobby, and anybody signed
 * in may enter as themselves. Taking it back removes the door; the site itself
 * stays at its address, as every space's does.
 */
function Publish({ space, onChanged }: { space: SpaceListing; onChanged: () => void }) {
  const [title, setTitle] = useState(space.title ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (isPublic: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await bff.publishSpace(space.name, isPublic, title.trim() || undefined);
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not change that.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-publish">
      {space.public ? (
        <p>
          <strong>Public room</strong>: its lobby door reads “{space.title ?? space.name}”.{" "}
          <button type="button" className="text-button" disabled={busy} onClick={() => void save(false)}>Take the door away</button>
        </p>
      ) : (
        <p>
          <label>
            Door title{" "}
            <input value={title} maxLength={48} placeholder={space.name} onChange={(event) => setTitle(event.target.value)} />
          </label>{" "}
          <button type="button" className="text-button" disabled={busy || !space.live} onClick={() => void save(true)}>
            Publish as a public room
          </button>
          {!space.live ? <span className="muted-note"> (push something live first)</span> : null}
        </p>
      )}
      {problem ? <p className="signin-refusal" role="alert">{problem}</p> : null}
    </div>
  );
}

/**
 * THE WORKBENCH (shared/space-bench.ts): which branch the saha.ing room of
 * this space's name shows on its bench. A work branch lets the team see
 * pieces in the room while main, the public space, stays as it is.
 */
function BenchBranch({ name, current, branches, onChanged }: { name: string; current: string; branches: string[]; onChanged: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (branch: string) => {
    try {
      await bff.benchBranch(name, branch);
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not change that.");
    }
  };
  const options = [...new Set(["main", ...branches, current])];
  return (
    <div className="space-publish">
      <h3>Workbench in the room</h3>
      <p className="muted-note">
        List pieces in <code>saha-pieces.json</code> (3D models, pictures, pages) and they stand on a bench in the {name} room
        on saha.ing, updated within seconds of every push to the branch you pick here. See docs/SPACES.md.
      </p>
      <label>
        Follows{" "}
        <select value={current} onChange={(event) => void choose(event.target.value)}>
          {options.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select>
      </label>
      {problem ? <p className="signin-refusal" role="alert">{problem}</p> : null}
    </div>
  );
}

const STATUS_WORDS = { passed: "Passed", "needs-work": "Needs work", "not-tested": "Not tested" } as const;

/** What testers said about this space, newest first: the checklist answers and notes they sent from inside it. */
function TesterFeedback({ name }: { name: string }) {
  const [reports, setReports] = useState<StoredFeedback[] | null>(null);
  useEffect(() => {
    bff.spaceFeedback(name).then((answer) => setReports(answer.feedback)).catch(() => setReports([]));
  }, [name]);
  if (reports === null || reports.length === 0) return null;
  return (
    <>
      <h3>Tester feedback</h3>
      <ul className="space-feedback">
        {reports.map((report) => (
          <li key={report.id}>
            <strong>{report.by}</strong> on <code>{report.branch}</code>
            {/* The exact version it was about, openable as it was then (Mica, 7265). */}
            {report.deploy ? <> at <a href={`${base}/s/${name}/~${report.deploy}/`} target="_blank" rel="noopener noreferrer"><code>{report.deploy}</code></a></> : null}
            {report.device ? ` · ${report.device}` : ""} · {when(report.at.replace(" ", "T") + (report.at.endsWith("Z") ? "" : "Z"))}
            {report.summary ? <p>{report.summary}</p> : null}
            {report.items.length > 0 ? (
              <ul>
                {report.items.map((item) => (
                  <li key={item.id} data-status={item.status}>
                    <span>{STATUS_WORDS[item.status]}</span> {item.label}
                    {item.note ? <em> — {item.note}</em> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function SpaceDetails({ name }: { name: string }) {
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    bff.space(name).then(setDetail).catch((error) => setProblem(error instanceof Error ? error.message : "Could not load this space."));
  }, [name]);
  useEffect(load, [load]);

  const makeLive = async (deploy: DeployRecord) => {
    try {
      await bff.makeLive(name, deploy.id);
      load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not switch.");
    }
  };

  const [merging, setMerging] = useState<string | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const merge = async (from: string) => {
    setMerging(from);
    setMerged(null);
    try {
      const result = await bff.mergeBranch(name, from);
      setMerged(result.how === "already" ? `main already has everything in ${from}.` : `${from} is merged into main, which is deploying now.`);
      load();
    } catch (error) {
      setMerged(error instanceof Error ? error.message : "Could not merge.");
    } finally {
      setMerging(null);
    }
  };

  if (problem) return <p className="signin-refusal" role="alert">{problem}</p>;
  if (!detail) return <p className="muted-note">Loading…</p>;
  const liveIds = new Set(detail.branches.map((branch) => branch.live?.id).filter(Boolean));
  return (
    <div className="space-details">
      <Copyable label="Clone it (people: your saha.ing password; agents: see docs/SPACES.md)" text={`git clone ${origin}${detail.space.gitPath}`} />
      <BenchBranch name={name} current={detail.space.benchBranch ?? "main"} branches={detail.branches.map((branch) => branch.branch)} onChanged={load} />
      <h3>Branches</h3>
      <ul>
        {detail.branches.map((branch) => (
          <li key={branch.branch}>
            <strong>{branch.branch}</strong>{branch.branch === "main" ? " (the space itself)" : " (preview)"}:{" "}
            {branch.live ? <a href={branch.sitePath} target="_blank" rel="noreferrer">{branch.sitePath}</a> : "not deployed"}
            {branch.branch !== "main" ? (
              <>
                {" "}
                <button type="button" className="text-button" disabled={merging !== null} onClick={() => void merge(branch.branch)}>
                  {merging === branch.branch ? "Merging…" : "Merge into main"}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {merged ? <p className="muted-note" role="status">{merged}</p> : null}
      <SpaceCode name={name} branches={detail.branches.map((branch) => branch.branch)} />
      <TesterFeedback name={name} />
      <h3>Deploys</h3>
      <ol className="space-deploys">
        {detail.deploys.map((deploy) => (
          <li key={deploy.id} data-status={deploy.status}>
            <span className="space-deploy-status">{liveIds.has(deploy.id) ? "LIVE" : deploy.status}</span>{" "}
            <span className="space-deploy-branch">{deploy.branch}</span> <DeployLine deploy={deploy} />
            {deploy.problem ? <div className="space-deploy-problem">{deploy.problem}</div> : null}
            {deploy.status === "ready" && !liveIds.has(deploy.id) ? (
              <button type="button" className="text-button" onClick={() => void makeLive(deploy)}>Make this live on {deploy.branch}</button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * THE CODE BROWSER (Sill's plan, F): a space's files, commits and diffs, for
 * its members, read only (server/spaces/routes.ts, /code/*). Closed until
 * opened, so the Spaces page stays light.
 */
function SpaceCode({ name, branches }: { name: string; branches: string[] }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(branches.includes("main") ? "main" : branches[0] ?? "main");
  const [files, setFiles] = useState<{ path: string; size: number }[] | null>(null);
  const [commits, setCommits] = useState<{ sha: string; author: string; at: string; message: string }[] | null>(null);
  const [shown, setShown] = useState<{ title: string; body: string; kind: "file" | "diff" } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : "Could not read the code.");

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setShown(null);
    bff.codeTree(name, ref).then((answer) => setFiles(answer.files)).catch(fail);
    bff.codeLog(name, ref).then((answer) => setCommits(answer.commits)).catch(fail);
  }, [open, name, ref]);

  const showFile = (path: string) =>
    bff.codeFile(name, ref, path).then((file) =>
      setShown({
        title: `${file.path} at ${ref}`,
        kind: "file",
        body: file.binary ? `(a binary file, ${file.size} bytes)` : file.text ?? `(too big to show here: ${file.size} bytes; clone the space to read it)`,
      })).catch(fail);
  const showCommit = (sha: string) =>
    bff.codeCommit(name, sha).then((commit) =>
      setShown({
        title: `${commit.sha.slice(0, 7)} ${commit.message} (${commit.author})`,
        kind: "diff",
        body: (commit.files.map((file) => `${file.path}  +${file.added ?? "bin"} -${file.removed ?? "bin"}`).join("\n") + "\n\n" + commit.patch + (commit.cut ? "\n… (cut: the rest is too long to show here)" : "")),
      })).catch(fail);

  if (!open) {
    return (
      <p>
        <button type="button" className="text-button" onClick={() => setOpen(true)}>Browse the code</button>
      </p>
    );
  }
  return (
    <div className="space-code">
      <h3>
        Code{" "}
        <select value={ref} onChange={(event) => setRef(event.target.value)} aria-label="Branch">
          {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select>{" "}
        <button type="button" className="text-button" onClick={() => setOpen(false)}>Close</button>
      </h3>
      {problem ? <p className="signin-refusal" role="alert">{problem}</p> : null}
      <div className="space-code-columns">
        <div>
          <h4>Files{files ? ` (${files.length})` : ""}</h4>
          <ul className="space-code-list">
            {(files ?? []).map((file) => (
              <li key={file.path}>
                <button type="button" className="text-button" onClick={() => void showFile(file.path)}>{file.path}</button>{" "}
                <span className="muted-note">{file.size} B</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Commits</h4>
          <ul className="space-code-list">
            {(commits ?? []).map((commit) => (
              <li key={commit.sha}>
                <button type="button" className="text-button" onClick={() => void showCommit(commit.sha)}>
                  <code>{commit.sha.slice(0, 7)}</code> {commit.message}
                </button>{" "}
                <span className="muted-note">{commit.author}, {new Date(commit.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {shown ? (
        <div className="space-code-view">
          <h4>{shown.title}</h4>
          <pre className={shown.kind === "diff" ? "space-code-diff" : undefined}>
            {shown.kind === "diff"
              ? shown.body.split("\n").map((line, index) => (
                  <span key={index} data-line={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : undefined}>{line}{"\n"}</span>
                ))
              : shown.body}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
