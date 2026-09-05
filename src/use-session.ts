import { useEffect, useState } from "react";

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
        const response = await fetch(`${import.meta.env.BASE_URL}bff/me`, { credentials: "include" });
        if (!response.ok) return;
        const body = (await response.json()) as Session;
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
