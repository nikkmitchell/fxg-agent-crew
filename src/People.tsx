import { useState } from "react";
import type { CrewTask } from "./board-types";
import type { ActorProfile, Ownership } from "./profiles";
import { Identity } from "./Identity";
import type { Session } from "./use-session";
import { groupByLineage } from "./lineage";
import type { Membership } from "./membership";
import { base } from "./router";

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

const ownershipWords: Record<Ownership["state"], string> = {
  pending: "claimed, awaiting the agent's confirmation",
  verified: "confirmed by both sides",
  revoked: "ended",
};

export function People({
  tasks,
  profiles,
  ownerships,
  memberships = [],
  projects = [],
  session,
  onOwnership,
}: {
  tasks: CrewTask[];
  profiles: ActorProfile[];
  ownerships: Ownership[];
  /**
   * Shown BESIDE ownership on purpose.
   *
   * The rule this whole surface exists to teach — operating an agent grants it
   * no project authority — is only legible if a reader can see that ownership
   * and membership are two different lists. Rendering one and not the other
   * left the rule as a sentence in a footnote.
   */
  memberships?: Membership[];
  projects?: Array<{ id: string; name: string }>;
  session: Session | null;
  /** Claim, confirm or end who operates an agent. Absent when the page is read-only, e.g. in a test. */
  onOwnership?: (agentActorId: string, ownerActorId: string, action: "declare" | "confirm" | "revoke") => Promise<void>;
}) {
  const actors = actorsFrom(tasks, profiles, ownerships, session);
  const [actionError, setActionError] = useState("");

  /**
   * Ask for one ownership change.
   *
   * The request carries WHAT WAS ASKED FOR, never the resulting state. Whether
   * it is allowed is decided by the server from the signed-in caller, so a
   * claimant cannot confirm their own claim by writing the other side's id into
   * the body. These buttons cannot grant anything; they can only ask.
   */
  const act = async (agentActorId: string, ownerActorId: string, action: "declare" | "confirm" | "revoke") => {
    if (!onOwnership) return;
    setActionError("");
    try {
      await onOwnership(agentActorId, ownerActorId, action);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not save");
    }
  };

  /**
   * ONE PLACE TO EDIT A PROFILE, and it is /profiles (Kerf, 2026-10-14). This
   * page had a second editor that knew nothing of the personality written on
   * /profiles, and saving it erased that. This page is who works on what.
   */
  const editor = session ? (
    <p className="profile-edit-open">
      <a className="text-button" href={`${base}/profiles`}>Edit your profile on People</a>
    </p>
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

  /**
   * One person or one instrument, rendered identically.
   *
   * Same markup either way, deliberately: an agent is not a lesser kind of
   * participant, it is a participant with a person answerable for it. The only
   * difference is where it sits and a line saying whose it is.
   */
  const renderActor = (actor: Actor) => {
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
                {/*
                  * The editor collected a time zone and nothing ever rendered
                  * it. That is worse than not asking: the value went into the
                  * durable log, where it stays through every replay forever, to
                  * be displayed nowhere. Storing something with no purpose is
                  * the part that needed fixing, not the missing row.
                  */}
                {actor.profile?.timeZone ? (
                  <>
                    <dt>Time zone</dt>
                    <dd>{actor.profile.timeZone}</dd>
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
                  * Membership is the thing that actually grants anything, so it
                  * sits directly above ownership, which grants nothing. Absent
                  * is stated rather than left blank: "in no project" is a fact,
                  * and an empty row would read as "we did not check".
                  */}
                <dt>Projects</dt>
                <dd>
                  {(() => {
                    const mine = memberships.filter((m) => m.actorId === actor.username && m.active);
                    if (mine.length === 0) return <span className="unknown">in no project</span>;
                    return mine
                      .map((m) => {
                        const name = projects.find((p) => p.id === m.projectId)?.name ?? m.projectId;
                        return m.roles.length ? `${name} (${m.roles.join(", ")})` : `${name} — no role stated`;
                      })
                      .join(" · ");
                  })()}
                </dd>

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
              {(canDeclareOwner || canConfirm || canRevoke) && onOwnership && session ? (
                <p className="person-actions">
                  {canDeclareOwner ? (
                    <>
                      <span>You can claim this agent as yours.</span>
                      {/*
                        * A claim is a REQUEST. It lands as pending and stays
                        * pending until the agent itself confirms — saying an
                        * agent is yours does not make it so, which is the same
                        * boundary the rest of this system holds.
                        */}
                      <button type="button" onClick={() => act(actor.username, session.username, "declare")}>
                        Claim as mine
                      </button>
                    </>
                  ) : null}
                  {canConfirm && actor.ownedBy ? (
                    <>
                      <span>Someone has claimed you.</span>
                      <button type="button" onClick={() => act(actor.username, actor.ownedBy!.ownerActorId, "confirm")}>
                        Confirm
                      </button>
                      {/* Declining is a revoke: there is no third state, and a
                          claim you refuse should not linger as pending. */}
                      <button type="button" onClick={() => act(actor.username, actor.ownedBy!.ownerActorId, "revoke")}>
                        Decline
                      </button>
                    </>
                  ) : null}
                  {canRevoke && !canConfirm && actor.ownedBy ? (
                    <button type="button" onClick={() => act(actor.username, actor.ownedBy!.ownerActorId, "revoke")}>
                      End this link
                    </button>
                  ) : null}
                </p>
              ) : null}

              {actor.owns.length > 0 ? (
                <ul className="person-tasks">
                  {actor.owns.slice(0, 6).map((task) => (
                    <li key={task.id}>
                      <a href={`${base}/board#task-${task.id}`}>{task.title}</a>
                      <span>{task.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
    );
  };

  return (
    <section className="people">
      <p className="muted-note">
        Built from the board — a profile, a task owned, or a comment written. Nobody appears
        because they were mentioned.
      </p>

      {editor}

      {actionError ? <p className="project-error" role="alert">{actionError}</p> : null}



      <ul className="people-list">
        {/*
          * Lineage, not leaderboard.
          *
          * A flat list of every name gives a reader no way to tell that six of
          * the eight belong to two people. Agents on a CONFIRMED ownership link
          * sit under the person answerable for them; a pending claim does not
          * nest, because a claim is a request and drawing it as a fact here
          * would undo the pending state that profiles.ts exists to enforce.
          */}
        {groupByLineage(actors).map((group) => (
          <li key={group.root.username} className="lineage">
            <ul className="lineage-list">
              {renderActor(group.root)}
              {group.instruments.map((instrument) => renderActor(instrument))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="people-note">
        <strong>Operating an agent is not authority over a project.</strong> An agent needs its own
        explicit project membership; being someone's instrument grants it nothing. Nothing on this
        page grants anything — it is a view.
      </p>
    </section>
  );
}
