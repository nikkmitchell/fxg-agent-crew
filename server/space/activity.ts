import type { DatabaseSync } from "node:sqlite";
import { NOT_A_PERSON, actorKey } from "../../shared/space-layout.js";
import {
  destinationFor,
  destinationForRead,
  restingPlace,
  type AuditRow,
  type PanelPlaces,
} from "./destinations.js";
import type { Presence } from "./presence.js";

/**
 * What makes agents move.
 *
 * The `audit` table is already a complete, ordered record of who did what. This
 * reads it forward from the last row it saw and sends the actor to wherever
 * that action happened. Authenticated reads can additionally declare which
 * half of the combined project payload they are consulting. Nothing is
 * inferred: a write has an audit row; a read carries a bounded `view` value.
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

/**
 * How long an AGENT stays at a panel once it has got there.
 *
 * Nikk, watching from a headset: "you stand at the board for way too long...
 * when you're working you should go back to your space and then take out your
 * screen share... you should just go up to the board, place your tasks on the
 * board, and then return". Two minutes turned an agent filing a card into an
 * agent loitering at the board, with its screen hidden the whole time.
 *
 * COUNTED FROM ARRIVAL, not from the action, because the walk over takes a
 * different time from every desk. Long enough to see it arrive, face the board
 * and read the label saying what it did; then it walks home and its screen
 * opens again. Every further action it takes there starts the count over.
 * People keep ATTENTION_MS, and an agent that never arrives is still sent home
 * by it.
 */
export const AGENT_AT_PANEL_MS = 8_000;

export class Activity {
  /** The highest audit id already acted on. Rows before it are history. */
  private lastSeenId = 0;
  /** Cached actor kinds. Rarely changes, and re-read when we have no answer. */
  private readonly kinds = new Map<string, "human" | "agent" | null>();
  private readonly sentAt = new Map<string, number>();
  /** When an agent sent somewhere was first seen standing there. */
  private readonly arrivedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly presence: Presence,
    private readonly now: () => number = Date.now,
    /**
     * Where each panel's standing place currently is.
     *
     * Read at the moment a row is mapped, not cached: somebody can drag the
     * board between one tick and the next, and an agent that then walks to
     * where the board used to be makes the room's central claim false in the
     * most confusing possible way — the label above their head would still say
     * "commented on a card".
     *
     * Defaults to the untouched arc so a caller that has no panel store (every
     * existing test) behaves exactly as before.
     */
    private readonly panelPlaces: () => PanelPlaces = () => ({}),
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
      if (NOT_A_PERSON.has(actorKey(row.actorId))) continue;
      const destination = destinationFor(row, this.panelPlaces());
      // An action this room has nothing to say about leaves everyone where they
      // are. It does not send them to a default corner.
      if (!destination) continue;
      this.presence.sendTo(
        row.actorId,
        this.kindOf(row.actorId),
        destination.at,
        destination.because,
        destination.facing,
      );
      this.sentAt.set(actorKey(row.actorId), this.now());
      this.arrivedAt.delete(actorKey(row.actorId));
    }

    this.sendStaleHome();
    return rows.length;
  }

  /**
   * Place an authenticated reader at the surface they explicitly asked to see.
   * This is ephemeral evidence, not a database mutation, so it is deliberately
   * absent from `audit` while sharing the same destination and expiry rules.
   */
  observeRead(
    actorId: string,
    kind: "human" | "agent" | null,
    view: "tasks" | "mood",
  ): void {
    if (NOT_A_PERSON.has(actorKey(actorId))) return;
    const destination = destinationForRead(view, this.panelPlaces());
    this.presence.sendTo(actorId, kind, destination.at, destination.because, destination.facing);
    this.sentAt.set(actorKey(actorId), this.now());
    this.arrivedAt.delete(actorKey(actorId));
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
    const key = actorKey(actorId);
    const cached = this.kinds.get(key);
    if (cached) return cached;
    const row = this.db.prepare("SELECT kind FROM actors WHERE id = ?").get(actorId) as
      | { kind: "human" | "agent" | null }
      | undefined;
    const kind = row?.kind ?? null;
    if (kind) this.kinds.set(key, kind);
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
    const now = this.now();
    const cutoff = now - ATTENTION_MS;
    for (const [key, at] of this.sentAt) {
      const occupant = this.presence.find(key);
      if (!occupant) {
        this.sentAt.delete(key);
        this.arrivedAt.delete(key);
        continue;
      }
      if (at > cutoff) {
        if (occupant.kind !== "agent") continue;
        const there = Math.hypot(occupant.at.x - occupant.heading.x, occupant.at.z - occupant.heading.z) < 0.05;
        if (!there) {
          this.arrivedAt.delete(key);
          continue;
        }
        const arrived = this.arrivedAt.get(key) ?? now;
        this.arrivedAt.set(key, arrived);
        if (now - arrived < AGENT_AT_PANEL_MS) continue;
      }
      this.sentAt.delete(key);
      this.arrivedAt.delete(key);
      /**
       * Somebody who drives their own avatar walks themselves.
       *
       * NOT `connected`, which is what this checked, and which kept agents at
       * the board for good: an agent that holds a socket open to watch the
       * room is connected, so it was never sent home. Sill stood at the board
       * with its screen hidden until Nikk asked why. The rule is the one
       * `sendTo` enforces — a connected person, never an agent.
       */
      if (occupant.connected && occupant.kind !== "agent") continue;
      const home = restingPlace(occupant.actorId);
      this.presence.sendTo(occupant.actorId, occupant.kind, home.at, home.because, home.facing);
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
