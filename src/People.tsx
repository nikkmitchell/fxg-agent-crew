import { type FormEvent, useState } from "react";
import type { CrewTask } from "./event-core";
import { type ActorProfile, type Ownership, checkProfile } from "./profiles";
import { Identity } from "./Identity";
import type { Session } from "./use-session";

export type Actor = {
  username: string;
  kind?: "human" | "agent";
  profile?: ActorProfile;
  owns: CrewTask[];
  awaitingAcceptance: CrewTask[];
  comments: number;
  /** The link where this actor is the AGENT, if any. */
  ownedBy?: Ownership;
  /** Links where this actor is the OWNER. */
  ownerOf: Ownership[];
};

/**
 * Everyone the board has actual evidence of.
 *
 * Built from what the durable log proves: a declared profile, ownership of a
 * task, or an authored comment. Nobody is listed for being mentioned, and no
 * profile is invented — an empty People tab would be a true statement about a
 * board nobody had touched.
 */
export function actorsFrom(
  tasks: CrewTask[],
  profiles: ActorProfile[],
  ownerships: Ownership[],
  session: Session | null,
): Actor[] {
  const byName = new Map<string, Actor>();

  const ensure = (username: string): Actor => {
    let actor = byName.get(username);
    if (!actor) {
      const profile = profiles.find((p) => p.actorId === username);
      actor = {
        username,
        // Kind comes from a DECLARED profile, or from the session for the
        // viewer themselves. It is never inferred from the shape of a name:
        // guessing "agent" because a username contains "claude" is exactly the
        // confident inference this product refuses.
        kind: profile?.kind ?? (session?.username === username ? session.kind : undefined),
        profile,
        owns: [],
        awaitingAcceptance: [],
        comments: 0,
        ownedBy: ownerships.find((o) => o.agentActorId === username && o.state !== "revoked"),
        ownerOf: ownerships.filter((o) => o.ownerActorId === username && o.state !== "revoked"),
      };
      byName.set(username, actor);
    }
    return actor;
  };

  for (const profile of profiles) ensure(profile.actorId);
  for (const link of ownerships) {
    if (link.state === "revoked") continue;
    ensure(link.agentActorId);
    ensure(link.ownerActorId);
  }
  for (const task of tasks) {
    for (const owner of task.owners ?? []) {
      const actor = ensure(owner);
      actor.owns.push(task);
      if (!(task.acceptedBy ?? []).includes(owner)) actor.awaitingAcceptance.push(task);
    }
    for (const comment of task.comments ?? []) ensure(comment.author).comments += 1;
  }

  return [...byName.values()].sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Edit your own profile — and only your own.
 *
 * profiles.ts has said since it was written that "the UI half is not here",
 * which meant a profile could only be declared by hand-writing an event into
 * the chat room. Everything below is that missing half.
 *
 * TWO THINGS THIS FORM DOES NOT DO.
 *
 * It does not offer to edit anyone else. The reducer refuses a profile whose
 * actorId is not the event's authenticated author, so a form for someone else
 * could only ever produce a refusal; not rendering it is the honest version.
 *
 * It does not merge. The form is loaded with the current profile and submits
 * the whole statement, because the reducer replaces rather than merges — a
 * field left blank here is a field you are declaring you do not publish.
 */
function ProfileEditor({
  actorId,
  kind,
  current,
  onPublish,
}: {
  actorId: string;
  kind: "human" | "agent" | undefined;
  current: ActorProfile | undefined;
  onPublish: (payload: unknown) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Kind is not editable and not guessable. It comes from the session, and
  // without it there is nothing honest to submit — declaring yourself human or
  // agent on a hunch is the one field a wrong guess would make a lie.
  if (kind === undefined) {
    return (
      <p className="muted-note">
        The server has not told this page whether you are a person or an agent, so there is nothing
        safe to publish. A profile has to say which, and guessing is not an option here.
      </p>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => {
      const raw = String(data.get(key) ?? "").trim();
      return raw.length > 0 ? raw : undefined;
    };
    const displayName = value("displayName");
    if (!displayName) {
      setError("A display name is required — it is what everyone else sees.");
      return;
    }

    const profile: ActorProfile = {
      actorId,
      kind,
      displayName,
      ...(value("bio") ? { bio: value("bio") } : {}),
      ...(value("coarseLocation") ? { coarseLocation: value("coarseLocation") } : {}),
      ...(value("timeZone") ? { timeZone: value("timeZone") } : {}),
      ...(kind === "agent" && value("model") ? { model: value("model") } : {}),
      ...(kind === "agent" && value("runtime") ? { runtime: value("runtime") } : {}),
    };

    // Checked here so the refusal is readable, and checked again by the server,
    // which is the one that counts. A client-side check is a courtesy, never a
    // boundary.
    const checked = checkProfile(profile);
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onPublish({ type: "profile.upserted", profile: checked.value });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <p className="profile-edit-open">
        <button type="button" onClick={() => setOpen(true)}>
          {current ? "Edit your profile" : "Publish your profile"}
        </button>
        {current ? null : <span className="muted-note">You have not published one yet.</span>}
      </p>
    );
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <h3>Your profile</h3>
      <p className="muted-note">
        This replaces your previous profile rather than merging into it. Anything you clear is
        something you are declaring you no longer publish.
      </p>

      <label>
        Display name
        <input name="displayName" defaultValue={current?.displayName ?? actorId} maxLength={120} required />
      </label>

      <label>
        Bio
        <textarea name="bio" defaultValue={current?.bio ?? ""} maxLength={600} rows={3} />
      </label>

      <label>
        Location
        <input name="coarseLocation" defaultValue={current?.coarseLocation ?? ""} maxLength={120} placeholder="A city or region" />
      </label>

      <label>
        Time zone
        <input name="timeZone" defaultValue={current?.timeZone ?? ""} maxLength={120} placeholder="Asia/Taipei" />
      </label>

      {kind === "agent" ? (
        <>
          <label>
            Model
            <input name="model" defaultValue={current?.model ?? ""} maxLength={120} />
          </label>
          <label>
            Runtime
            <input name="runtime" defaultValue={current?.runtime ?? ""} maxLength={120} />
          </label>
        </>
      ) : null}

      {/*
        * Said before anyone types, not after they are refused. The storage rule
        * is that a profile carrying one of these is rejected ENTIRELY rather
        * than quietly stripped, so the cost of finding out late is losing the
        * whole submission.
        */}
      <p className="profile-warning">
        A precise location, an address, a hostname, a key or a token will be refused outright — the
        whole profile, not just that field. Once something is in the log it is in every replay
        forever, so it is never accepted in the first place.
      </p>

      {error ? <p className="project-error" role="alert">{error}</p> : null}

      <p className="profile-form-actions">
        <button type="submit" disabled={busy}>{busy ? "Publishing…" : "Publish"}</button>
        <button type="button" onClick={() => { setOpen(false); setError(""); }} disabled={busy}>Cancel</button>
      </p>
    </form>
  );
}

const ownershipWords: Record<Ownership["state"], string> = {
  pending: "claimed, awaiting the agent's confirmation",
  verified: "confirmed by both sides",
  revoked: "ended",
};

export function People({
  tasks,
  profiles,
  ownerships,
  session,
  onPublish,
}: {
  tasks: CrewTask[];
  profiles: ActorProfile[];
  ownerships: Ownership[];
  session: Session | null;
  /** Absent when the page is rendered read-only, e.g. in a test. */
  onPublish?: (payload: unknown) => Promise<void>;
}) {
  const actors = actorsFrom(tasks, profiles, ownerships, session);
  const mine = session ? profiles.find((profile) => profile.actorId === session.username) : undefined;

  /*
   * Offered to the signed-in actor only. There is no form for editing anybody
   * else, because the reducer refuses a profile whose actorId is not the
   * event's author — a control that could only ever produce a refusal is worse
   * than no control.
   */
  const editor =
    session && onPublish ? (
      <ProfileEditor actorId={session.username} kind={session.kind} current={mine} onPublish={onPublish} />
    ) : null;

  if (actors.length === 0) {
    return (
      <section className="people">
        <p className="muted-note">
          Nobody has published a profile, owned a task or written a comment yet, so there is nothing
          here. This list is built from what the board can prove, not from a roster.
        </p>
        {/* Still offered: publishing yours is one of the three things that would
            end this empty state, so the page should not be a dead end. */}
        {editor}
      </section>
    );
  }

  return (
    <section className="people">
      <p className="muted-note">
        Built from the durable log — a declared profile, a task owned, or a comment written. Nobody
        appears because they were mentioned.
      </p>

      {editor}

      <ul className="people-list">
        {actors.map((actor) => {
          const canDeclareOwner = session?.kind === "human" && actor.kind === "agent" && !actor.ownedBy;
          const canConfirm = actor.ownedBy?.state === "pending" && session?.username === actor.username;
          const canRevoke =
            actor.ownedBy !== undefined &&
            (session?.username === actor.username || session?.username === actor.ownedBy.ownerActorId);

          return (
            <li key={actor.username}>
              <div className="person-head">
                <Identity username={actor.username} kind={actor.kind} displayName={actor.profile?.displayName} size={40} showName />
                {actor.username === session?.username ? <span className="person-you">you</span> : null}
              </div>

              {actor.profile?.bio ? <p className="person-bio">{actor.profile.bio}</p> : null}

              <dl className="person-facts">
                {actor.profile?.coarseLocation ? (
                  <>
                    <dt>Location</dt>
                    <dd>{actor.profile.coarseLocation}</dd>
                  </>
                ) : null}
                {actor.profile?.model ? (
                  <>
                    <dt>Model</dt>
                    <dd>{actor.profile.model}{actor.profile.runtime ? ` · ${actor.profile.runtime}` : ""}</dd>
                  </>
                ) : null}

                <dt>Owns</dt>
                <dd>{actor.owns.length === 0 ? "no tasks" : `${actor.owns.length} task${actor.owns.length === 1 ? "" : "s"}`}</dd>

                {actor.awaitingAcceptance.length > 0 ? (
                  <>
                    <dt>Not yet accepted</dt>
                    <dd>{actor.awaitingAcceptance.length} — assigned, but not agreed to</dd>
                  </>
                ) : null}

                <dt>Comments</dt>
                <dd>{actor.comments}</dd>

                {/*
                  * Explicit ownership status, never a blank. An absent row reads
                  * as "nobody owns this agent", which is a different claim from
                  * "nobody has said".
                  */}
                {actor.kind === "agent" ? (
                  <>
                    <dt>Operated by</dt>
                    <dd className={actor.ownedBy ? `ownership ownership--${actor.ownedBy.state}` : "unknown"}>
                      {actor.ownedBy
                        ? `${actor.ownedBy.ownerActorId} — ${ownershipWords[actor.ownedBy.state]}`
                        : "nobody has claimed this agent"}
                    </dd>
                  </>
                ) : null}

                {actor.ownerOf.length > 0 ? (
                  <>
                    <dt>Operates</dt>
                    <dd>{actor.ownerOf.map((o) => o.agentActorId).join(", ")}</dd>
                  </>
                ) : null}
              </dl>

              {/*
                * Management controls appear only for the person entitled to use
                * them. Showing a disabled button to everyone else advertises an
                * action they cannot take and invites a refusal they will read as
                * a fault.
                */}
              {canDeclareOwner || canConfirm || canRevoke ? (
                <p className="person-actions">
                  {canDeclareOwner ? <span>You can claim this agent as yours.</span> : null}
                  {canConfirm ? <span>Someone has claimed you — confirm or decline.</span> : null}
                  {canRevoke ? <span>You can end this link.</span> : null}
                </p>
              ) : null}

              {actor.owns.length > 0 ? (
                <ul className="person-tasks">
                  {actor.owns.slice(0, 6).map((task) => (
                    <li key={task.id}>
                      <a href={`${import.meta.env.BASE_URL}board#task-${task.id}`}>{task.title}</a>
                      <span>{task.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="people-note">
        <strong>Operating an agent is not authority over a project.</strong> An agent needs its own
        explicit project membership; being someone's instrument grants it nothing. Nothing on this
        page grants anything — it is a view.
      </p>
    </section>
  );
}
