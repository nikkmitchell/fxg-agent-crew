import type { DatabaseSync } from "node:sqlite";
import { actorKey } from "../../shared/space-layout.js";
import { AVATAR_POSTURES, type AvatarPosture } from "../../shared/avatar-motion.js";

/**
 * The postures agents have DECLARED, kept across a restart.
 *
 * Everything else about presence is in memory on purpose (see presence.ts): a
 * restarted room honestly does not know where anyone is standing. A declared
 * posture is different. It is something an agent said about itself — "I am
 * working" — and nothing about a deploy makes it less true. Losing it put every
 * agent back to sleep on every deploy, and a sleeping agent's shared screen is
 * hidden. Nikk, twice in ten minutes: "now neither of your screens are
 * showing".
 *
 * Forgotten at exactly the moments presence stops honouring the declaration in
 * memory — the agent's next action takes its posture back — and after
 * `DECLARED_POSTURE_TTL_MS` regardless, so an agent that declared "thinking"
 * and then went away does not come back from a restart days later still
 * claiming to be working.
 */
export const DECLARED_POSTURE_TTL_MS = 12 * 60 * 60 * 1000;

export type PostureMemory = {
  remember(actorId: string, posture: AvatarPosture): void;
  forget(actorId: string): void;
  recall(actorId: string): AvatarPosture | null;
};

export class DeclaredPostures implements PostureMemory {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  remember(actorId: string, posture: AvatarPosture): void {
    this.database
      .prepare(
        `INSERT INTO declared_postures (actor_key, actor_id, posture, declared_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (actor_key) DO UPDATE SET actor_id = excluded.actor_id, posture = excluded.posture, declared_at = excluded.declared_at`,
      )
      .run(actorKey(actorId), actorId, posture, this.now());
  }

  forget(actorId: string): void {
    this.database.prepare("DELETE FROM declared_postures WHERE actor_key = ?").run(actorKey(actorId));
  }

  recall(actorId: string): AvatarPosture | null {
    const row = this.database
      .prepare("SELECT posture, declared_at AS declaredAt FROM declared_postures WHERE actor_key = ?")
      .get(actorKey(actorId)) as { posture: string; declaredAt: number } | undefined;
    if (!row) return null;
    if (row.declaredAt < this.now() - DECLARED_POSTURE_TTL_MS) {
      this.forget(actorId);
      return null;
    }
    // Read back through the same list the route validates against, so a value
    // from an older build that no longer exists is not handed to a renderer.
    return (AVATAR_POSTURES as readonly string[]).includes(row.posture) ? (row.posture as AvatarPosture) : null;
  }
}
