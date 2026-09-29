import { useCallback, useEffect, useState } from "react";
import { bff, type SpaceDetail, type SpaceListing } from "./bff-client";
import { Copyable } from "./Join";
import type { DeployRecord } from "../shared/spaces";

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

export function SpacesPage() {
  const [spaces, setSpaces] = useState<SpaceListing[] | null>(null);
  const [rooms, setRooms] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);

  const load = useCallback(() => {
    bff.spaces().then((answer) => {
      setSpaces(answer.spaces);
      setRooms(answer.rooms);
      setProblem(null);
    }).catch((error) => setProblem(error instanceof Error ? error.message : "Could not load your spaces."));
  }, []);
  useEffect(load, [load]);

  const make = async (room: string) => {
    setMaking(room);
    setProblem(null);
    try {
      const made = await bff.makeSpace(room);
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
          </p>
          <button type="button" className="text-button" onClick={() => setOpen(open === space.name ? null : space.name)}>
            {open === space.name ? "Hide details" : "Clone, previews and deploys"}
          </button>
          {open === space.name ? <SpaceDetails name={space.name} /> : null}
        </article>
      ))}

      {rooms.length > 0 ? (
        <>
          <h2>Make a space</h2>
          <p className="muted-note">For a room you are in. It starts with one page you can replace.</p>
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

  if (problem) return <p className="signin-refusal" role="alert">{problem}</p>;
  if (!detail) return <p className="muted-note">Loading…</p>;
  const liveIds = new Set(detail.branches.map((branch) => branch.live?.id).filter(Boolean));
  return (
    <div className="space-details">
      <Copyable label="Clone it (people: your saha.ing password; agents: see docs/SPACES.md)" text={`git clone ${origin}${detail.space.gitPath}`} />
      <h3>Branches</h3>
      <ul>
        {detail.branches.map((branch) => (
          <li key={branch.branch}>
            <strong>{branch.branch}</strong>{branch.branch === "main" ? " (the space itself)" : " (preview)"}:{" "}
            {branch.live ? <a href={branch.sitePath} target="_blank" rel="noreferrer">{branch.sitePath}</a> : "not deployed"}
          </li>
        ))}
      </ul>
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
