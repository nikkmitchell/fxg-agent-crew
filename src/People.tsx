import type { CrewTask } from "./event-core";
import { Identity } from "./Identity";
import type { Session } from "./use-session";

export type Actor = {
  username: string;
  kind?: "human" | "agent";
  /** Tasks this actor owns, whether or not they have accepted them. */
  owns: CrewTask[];
  /** Tasks they own but have not accepted — assigned is not the same as taken on. */
  awaitingAcceptance: CrewTask[];
  comments: number;
};

/**
 * Everyone the board has actual evidence of.
 *
 * Built only from what the durable log already proves: someone owns a task, or
 * someone wrote a comment. Nobody is listed because they were mentioned, and no
 * profile is created speculatively — an empty People tab would be a true
 * statement about a board nobody had touched.
 */
export function actorsFrom(tasks: CrewTask[], session: Session | null): Actor[] {
  const byName = new Map<string, Actor>();

  const ensure = (username: string): Actor => {
    let actor = byName.get(username);
    if (!actor) {
      actor = {
        username,
        // Kind is known ONLY for the signed-in viewer, because that is the one
        // identity the server has told us about. Everyone else is unknown
        // rather than guessed — inferring "agent" from a name containing
        // "claude" would be exactly the kind of confident inference this
        // product exists to refuse.
        kind: session?.username === username ? session.kind : undefined,
        owns: [],
        awaitingAcceptance: [],
        comments: 0,
      };
      byName.set(username, actor);
    }
    return actor;
  };

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
 * The People tab.
 *
 * What it deliberately does NOT show: who owns which agent. Nothing in the
 * durable log records that relationship yet, so every ownership line would be
 * invented. The tab says so rather than leaving a blank that reads as "nobody".
 */
export function People({ tasks, session }: { tasks: CrewTask[]; session: Session | null }) {
  const actors = actorsFrom(tasks, session);

  if (actors.length === 0) {
    return (
      <section className="people">
        <p className="muted-note">
          Nobody has owned a task or written a comment yet, so there is nothing here to show. This
          list is built from what the board can prove, not from a roster.
        </p>
      </section>
    );
  }

  return (
    <section className="people">
      <p className="muted-note">
        Built from the durable log: someone owns a task, or someone wrote a comment. Nobody appears
        because they were mentioned.
      </p>

      <ul className="people-list">
        {actors.map((actor) => (
          <li key={actor.username}>
            <div className="person-head">
              <Identity username={actor.username} kind={actor.kind} size={40} showName />
              {actor.username === session?.username ? <span className="person-you">you</span> : null}
            </div>

            <dl className="person-facts">
              <dt>Owns</dt>
              <dd>{actor.owns.length === 0 ? "nothing" : `${actor.owns.length} task${actor.owns.length === 1 ? "" : "s"}`}</dd>

              {actor.awaitingAcceptance.length > 0 ? (
                <>
                  <dt>Not yet accepted</dt>
                  <dd>
                    {actor.awaitingAcceptance.length} — assigned, but they have not agreed to it
                  </dd>
                </>
              ) : null}

              <dt>Comments</dt>
              <dd>{actor.comments}</dd>

              <dt>Owned by</dt>
              {/*
                * The relationship Inkstone's architecture calls for, which the
                * log does not record yet. Shown as unknown rather than omitted,
                * because an absent row reads as "nobody owns this agent" and
                * that is a claim we cannot make.
                */}
              <dd className="unknown">not recorded yet</dd>
            </dl>

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
        ))}
      </ul>

      <p className="people-note">
        Ownership of an agent by a human would never grant that agent project authority — an agent
        needs its own explicit membership. Nothing on this page grants anything; it is a view.
      </p>
    </section>
  );
}
