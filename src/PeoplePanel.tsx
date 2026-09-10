import { useCallback, useEffect, useState } from "react";
import type { CrewTask } from "./event-core";
import type { ActorProfile, Ownership } from "./profiles";
import type { Membership } from "./membership";
import { BoardError, board, toCrewProject, toCrewTask, toProfile } from "./board-client";
import type { CrewProject } from "./event-core";
import { People } from "./People";
import type { Session } from "./use-session";


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
      if (cause instanceof BoardError && cause.status === 401) {
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
   * Publish one event, then RE-READ THE LOG rather than patching local state.
   *
   * The reducer can refuse what the transport accepted — a 201 means the message
   * was stored, not that the projection took it. Optimistically showing the new
   * profile would put a change on screen that the log may have rejected, which
   * is the exact failure this product exists to avoid.
   */
  /**
   * Publish one intent through the board API.
   *
   * This still posted a crew-event fence to /bff/project-events after the
   * cutover, which by then did nothing. A profile edit or an ownership claim
   * would have appeared to succeed — the request returned 201, the fence
   * reached the room, and the board never saw it. Silent, and exactly the
   * class of failure the cutover detector exists to catch in AGENTS while I
   * had left it in our own UI.
   *
   * The old payload shapes are kept at the call sites because they are how the
   * People surface thinks; the translation lives here, in one place.
   */
  const publish = useCallback(
    async (payload: unknown) => {
      const intent = payload as Record<string, any>;
      if (intent.type === "profile.upserted") {
        const { actorId: _ignored, ...profile } = intent.profile as Record<string, unknown>;
        // actorId is dropped rather than sent: the server takes the acting
        // identity from the session, and a field that is ignored is better
        // removed than left to look meaningful.
        await board.profile(profile);
      } else if (intent.type === "ownership.acted") {
        await board.actOnOwnership(intent.agentActorId, intent.ownerActorId, intent.action);
      } else {
        throw new Error(`no board endpoint for ${String(intent.type)}`);
      }
      await load();
    },
    [load],
  );

  if (state === "loading") return <p className="muted-note">Reading the log…</p>;
  if (state === "signed_out") return <p className="muted-note">Sign in to see who is working on what.</p>;
  if (state === "error" || !data) {
    return (
      <p className="project-error" role="alert">
        Could not read the log, so this page is empty rather than partial.
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
      onPublish={publish}
    />
  );
}
