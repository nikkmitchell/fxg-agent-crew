import type { DatabaseSync } from "node:sqlite";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { destinationFor, restingPlace, type AuditRow } from "./destinations.js";
import type { Presence } from "./presence.js";

/**
 * What makes agents move.
 *
 * The `audit` table is already a complete, ordered record of who did what. This
 * reads it forward from the last row it saw and sends the actor to wherever
 * that action happened. Nothing new is recorded and nothing is inferred: if the
 * room shows Plumbline at the task board, there is a row saying Plumbline
 * touched a card, and you can go and read it.
 *
 * WHY POLLING RATHER THAN A HOOK IN BoardStore. A callback fired inside the
 * write transaction would put the room on the critical path of every board
 * write — and worse, would move someone for a change that then rolled back.
 * Reading committed rows afterwards cannot show a refused write, which is the
 * property worth having.
 */

/** How often to look for new rows. Below human reaction time; far above SQLite's cost. */
export const POLL_MS = 500;

/**
 * How long an action keeps someone where it put them.
 *
 * After this they walk back to their desk, which says "no recent evidence"
 * rather than "idle". Two minutes is long enough to see somebody arrive and
 * notice them there, short enough that the room is not a record of yesterday.
 */
export const ATTENTION_MS = 120_000;

export class Activity {
  /** The highest audit id already acted on. Rows before it are history. */
  private lastSeenId = 0;
  /** Cached actor kinds. Rarely changes, and re-read when we have no answer. */
  private readonly kinds = new Map<string, "human" | "agent" | null>();
  private readonly sentAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly presence: Presence,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Start from the end of the table, not the beginning.
   *
   * On boot the whole history is already in there. Replaying it would march
   * every actor through months of work in a few seconds — a room full of
   * motion that is not happening. The room begins still, and that is true.
   */
  catchUp(): void {
    const row = this.db.prepare("SELECT MAX(id) AS id FROM audit").get() as { id: number | null };
    this.lastSeenId = row.id ?? 0;
  }

  /** Read whatever is new and move people accordingly. Returns rows applied. */
  step(): number {
    const rows = this.db
      .prepare(
        `SELECT id, actor_id AS actorId, action, entity, entity_id AS entityId
           FROM audit WHERE id > ? ORDER BY id ASC LIMIT 200`,
      )
      .all(this.lastSeenId) as unknown as AuditRow[];

    for (const row of rows) {
      this.lastSeenId = Math.max(this.lastSeenId, row.id);
      if (NOT_A_PERSON.has(row.actorId)) continue;
      const destination = destinationFor(row);
      // An action this room has nothing to say about leaves everyone where they
      // are. It does not send them to a default corner.
      if (!destination) continue;
      this.presence.sendTo(row.actorId, this.kindOf(row.actorId), destination.at, destination.because);
      this.sentAt.set(row.actorId, this.now());
    }

    this.sendStaleHome();
    return rows.length;
  }

  /**
   * The kind the DATABASE knows, not a blank.
   *
   * Passing null here put "kind unknown" under Plumbline's name while the
   * actors table said `agent` — an invented unknown, which is worse than most
   * mistakes in this room: the dashed outline exists to mark actors nobody has
   * ever declared, and it means nothing if it also marks ones we simply did not
   * bother to look up.
   *
   * A miss is re-read rather than cached, because null here is genuinely "not
   * declared yet" and that can change the moment somebody fills in a profile.
   */
  private kindOf(actorId: string): "human" | "agent" | null {
    const cached = this.kinds.get(actorId);
    if (cached) return cached;
    const row = this.db.prepare("SELECT kind FROM actors WHERE id = ?").get(actorId) as
      | { kind: "human" | "agent" | null }
      | undefined;
    const kind = row?.kind ?? null;
    if (kind) this.kinds.set(actorId, kind);
    return kind;
  }

  /**
   * Walk people back to their desks once their reason has gone cold.
   *
   * The walk back matters: a figure that vanishes from the board and reappears
   * at a desk reads as a glitch, and a figure that stands at the board forever
   * claims an activity that stopped an hour ago.
   */
  private sendStaleHome(): void {
    const cutoff = this.now() - ATTENTION_MS;
    for (const [actorId, at] of this.sentAt) {
      if (at > cutoff) continue;
      this.sentAt.delete(actorId);
      const occupant = this.presence.find(actorId);
      if (!occupant) continue;
      // Somebody with a live socket walks themselves. `sendTo` enforces that
      // too — this is the cheap check, not the guarantee.
      if (occupant.connected) continue;
      const home = restingPlace(actorId);
      this.presence.sendTo(actorId, occupant.kind, home.at, home.because);
    }
  }

  start(): void {
    if (this.timer) return;
    this.catchUp();
    this.timer = setInterval(() => {
      try {
        this.step();
      } catch (error) {
        // A failed read must not kill the interval. The room going quiet is a
        // far better failure than the process falling over, and the next tick
        // picks up from the same watermark.
        this.onError?.(error);
      }
    }, POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Set by the server so a read failure reaches the log rather than nowhere. */
  onError?: (error: unknown) => void;

  /** For tests: what the watermark is now. */
  get watermark(): number {
    return this.lastSeenId;
  }
}
