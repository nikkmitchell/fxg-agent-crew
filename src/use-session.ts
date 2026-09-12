import { useEffect, useState } from "react";
import { bff } from "./bff-client";

export type Session = { username: string; kind?: "human" | "agent" };

/**
 * Who is signed in, or null.
 *
 * Null means NOT SIGNED IN and is rendered as such. It never falls back to a
 * placeholder identity: the rail previously displayed fixed initials for every
 * visitor, which is a claim about the viewer that nothing had verified.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // `bff.me()` rather than a fetch of the same URL: one client, one
        // error type, and the response shape comes from shared/contracts.ts
        // instead of a cast written here.
        const body = await bff.me();
        if (!cancelled) setSession(body);
      } catch {
        // Offline or upstream down. Staying null renders "not signed in", which
        // is honest: we do not know who this is.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
