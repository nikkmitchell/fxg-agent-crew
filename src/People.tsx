import type { CrewTask } from "./event-core";
import type { ActorProfile, Ownership } from "./profiles";
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
}: {
  tasks: CrewTask[];
  profiles: ActorProfile[];
  ownerships: Ownership[];
  session: Session | null;
}) {
  const actors = actorsFrom(tasks, profiles, ownerships, session);

  if (actors.length === 0) {
    return (
      <section className="people">
        <p className="muted-note">
          Nobody has published a profile, owned a task or written a comment yet, so there is nothing
          here. This list is built from what the board can prove, not from a roster.
        </p>
      </section>
    );
  }

  return (
    <section className="people">
      <p className="muted-note">
        Built from the durable log — a declared profile, a task owned, or a comment written. Nobody
        appears because they were mentioned.
      </p>

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
                <Identity username={actor.username} kind={actor.kind} size={40} showName />
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
