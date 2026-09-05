import { useCallback, useEffect, useState } from "react";
import type { CrewTask } from "./event-core";
import type { ActorProfile, Ownership } from "./profiles";
import { People } from "./People";
import type { Session } from "./use-session";

const PROJECT_ROOM = "AgentParty";

/**
 * Loads the board so People can be derived from it.
 *
 * People is a projection of work that already happened, not a separate roster —
 * so it reads the same durable state everything else does rather than
 * introducing a second store of who exists. A roster would immediately begin
 * disagreeing with the board.
 */
export function PeoplePanel({ session }: { session: Session | null }) {
  const [data, setData] = useState<{ tasks: CrewTask[]; profiles: ActorProfile[]; ownerships: Ownership[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed_out" | "error">("loading");

  const load = useCallback(async () => {
    const response = await fetch(
      `${import.meta.env.BASE_URL}bff/projects?room=${encodeURIComponent(PROJECT_ROOM)}`,
      { credentials: "include" },
    );
    if (response.status === 401) {
      setState("signed_out");
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as {
      tasks?: CrewTask[];
      profiles?: ActorProfile[];
      ownerships?: Ownership[];
    };
    setData({ tasks: body.tasks ?? [], profiles: body.profiles ?? [], ownerships: body.ownerships ?? [] });
    setState("ready");
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
  const publish = useCallback(
    async (payload: unknown) => {
      const response = await fetch(`${import.meta.env.BASE_URL}bff/project-events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: PROJECT_ROOM, payload }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not save (${response.status})`);
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
      session={session}
      onPublish={publish}
    />
  );
}
