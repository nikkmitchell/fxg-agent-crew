import { useCallback, useEffect, useState } from "react";
import type { CrewTask } from "./board-types";
import type { ActorProfile, Ownership } from "./profiles";
import type { Membership } from "./membership";
import { board, toCrewProject, toCrewTask, toProfile } from "./board-client";
import type { CrewProject } from "./board-types";
import { People } from "./People";
import type { Session } from "./use-session";
import { ApiError } from "./api-request";


/**
 * Loads the board so People can be derived from it.
 *
 * People is a projection of work that already happened, not a separate roster —
 * so it reads the same durable state everything else does rather than
 * introducing a second store of who exists. A roster would immediately begin
 * disagreeing with the board.
 */
export function PeoplePanel({ session }: { session: Session | null }) {
  const [data, setData] = useState<{
    tasks: CrewTask[];
    profiles: ActorProfile[];
    ownerships: Ownership[];
    memberships: Membership[];
    projects: CrewProject[];
  } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed_out" | "error">("loading");

  const load = useCallback(async () => {
    try {
      // The database, not a fold of the room. People, ownership and membership
      // are rows now; the tasks come with whichever project is open, because
      // this surface only needs them to say who owns what.
      const [people, list] = await Promise.all([board.people(), board.projects()]);
      const projects = (list.projects ?? []) as Array<Record<string, unknown>>;
      const details = await Promise.all(
        projects.map((project) => board.project(String(project.id))),
      );

      setData({
        tasks: details.flatMap((detail) =>
          ((detail?.tasks ?? []) as Array<Record<string, unknown>>).map(toCrewTask)) as CrewTask[],
        profiles: (people.actors ?? []).map((row) => toProfile(row as Record<string, unknown>)) as ActorProfile[],
        ownerships: (people.ownerships ?? []) as Ownership[],
        memberships: (people.memberships ?? []) as Membership[],
        projects: projects.map((row) => toCrewProject(row)) as CrewProject[],
      });
      setState("ready");
    } catch (cause) {
      // A 401 is "sign in", not "something broke". Conflating them sends
      // someone looking for a fault that is really a session.
      if (cause instanceof ApiError && cause.status === 401) {
        setState("signed_out");
        return;
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    void load().catch(() => setState("error"));
  }, [load]);

  /**
   * Ask the server for one ownership change, then read the people again rather
   * than patching local state: the server can refuse, and a change shown before
   * it answered could be one that never happened.
   */
  const actOnOwnership = useCallback(
    async (agentActorId: string, ownerActorId: string, action: "declare" | "confirm" | "revoke") => {
      await board.actOnOwnership(agentActorId, ownerActorId, action);
      await load();
    },
    [load],
  );

  if (state === "loading") return <p className="muted-note">Reading who works on what…</p>;
  if (state === "signed_out") return <p className="muted-note">Sign in to see who is working on what.</p>;
  if (state === "error" || !data) {
    return (
      <p className="project-error" role="alert">
        Could not read who works on what, so this page is empty rather than partial.
      </p>
    );
  }

  return (
    <People
      tasks={data.tasks}
      profiles={data.profiles}
      ownerships={data.ownerships}
      memberships={data.memberships}
      projects={data.projects}
      session={session}
      onOwnership={actOnOwnership}
    />
  );
}
