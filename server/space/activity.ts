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
import type { AgentHome } from "../../shared/agent-home.js";
import { REVEAL_CAP_MS } from "../../shared/board-freshness.js";

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
  /**
   * Board changes waiting for their agent to reach the board, by audit id.
   * See shared/board-freshness.ts: the card moves when the agent arrives.
   */
  private readonly pendingReveal = new Map<number, { key: string; sentAt: number }>();
  /** When each of those was shown, kept a few minutes for boards still polling. */
  private readonly revealed = new Map<number, number>();
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
    /** Agents' saved homes, where they walk back to. See homes.ts. */
    private readonly homeOf: (actorId: string) => AgentHome | null = () => null,
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

  /**
   * Put the agents back in the room after a restart.
   *
   * WHY THIS IS NEEDED AT ALL. Presence lives in the server process, so a
   * deploy empties the room. People and headsets reconnect by themselves and
   * come straight back; an agent does not. It arrives by declaring itself once,
   * works quietly, and is simply gone the next time anybody looks — with no way
   * of noticing. Nikk asked twice in one afternoon why he could not see
   * Plumbline, and the second time the answer was this. Sill deploys many times
   * a day, so every agent was falling out of the room repeatedly and the room
   * was showing them as absent. Absent is a claim, and it was not true.
   *
   * AGENTS ONLY — Sill's rule, and the whole design. A person's position was
   * OBSERVED, by a headset, and after a restart we genuinely do not know it any
   * more; an empty spot is the truth and the room is right to forget. An
   * agent's position was never observed: it is derived from the audit trail, so
   * rebuilding it invents nothing that was not already inferred. Forgetting
   * something you can still derive is not honesty, only loss.
   *
   * NOT A REPLAY. `catchUp` deliberately starts from the END of the audit table
   * so boot does not march every actor through months of work in a few seconds.
   * This reads BACKWARD instead, taking only each agent's most recent row that
   * maps anywhere, and places it there standing still. One position per agent,
   * no motion, nothing re-enacted.
   *
   * An agent with no mapped history still comes back, at its home or its desk.
   * It has signed in, it is an agent, and it is somewhere — which is the state
   * a new agent is in for its whole first hour.
   */
  rehydrate(): void {
    const agents = this.db
      .prepare("SELECT id FROM actors WHERE kind = 'agent' ORDER BY id")
      .all() as { id: string }[];

    for (const { id } of agents) {
      if (NOT_A_PERSON.has(actorKey(id))) continue;

      // Far enough back to pass over recent rows this room has nothing to say
      // about — a profile edit, say — without reading a whole history.
      const rows = this.db
        .prepare(
          `SELECT id, actor_id AS actorId, action, entity, entity_id AS entityId, at
             FROM audit WHERE actor_id = ? ORDER BY id DESC LIMIT 50`,
        )
        .all(id) as unknown as (AuditRow & { at: string })[];

      const places = this.panelPlaces();
      let restored = false;
      for (const row of rows) {
        const destination = destinationFor(row, places, this.homeOf);
        if (!destination) continue;
        // The time of the ACTION, not of this boot, so an agent that last did
        // something yesterday settles into sleeping rather than standing up and
        // thinking hard because the server happened to restart.
        const actedAt = Date.parse(row.at);
        this.presence.restore(
          row.actorId,
          destination.at,
          destination.because,
          destination.facing,
          Number.isNaN(actedAt) ? null : actedAt,
        );
        restored = true;
        break;
      }
      if (!restored) this.presence.restore(id, null, null, null, null);
    }
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
      const destination = destinationFor(row, this.panelPlaces(), this.homeOf);
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
      // An AGENT walking to a panel: hold the card change until it gets there.
      // A person moves themselves, so theirs shows at once.
      // Not when nobody has the room open: then nothing walks (the room only
      // steps figures while somebody is connected) and there is no arrival
      // for anybody to see, so holding the card back would only delay the
      // board for people reading it in a window.
      const occupant = this.presence.find(row.actorId);
      const watched = this.presence.everyone().some((someone) => someone.connected && someone.kind !== "agent");
      if (row.entity === "task" && destination.because !== null && occupant?.kind === "agent" && watched) {
        this.pendingReveal.set(row.id, { key: actorKey(row.actorId), sentAt: this.now() });
      }
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
        this.reveal(key, arrived);
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
      const home = restingPlace(occupant.actorId, this.homeOf(occupant.actorId));
      this.presence.sendTo(occupant.actorId, occupant.kind, home.at, home.because, home.facing);
    }
  }

  /** Show every change this agent was carrying, now that it has reached the board. */
  private reveal(key: string, at: number): void {
    for (const [auditId, pending] of this.pendingReveal) {
      if (pending.key !== key) continue;
      this.pendingReveal.delete(auditId);
      this.revealed.set(auditId, Math.max(at, pending.sentAt));
    }
  }

  /**
   * When the room should show the board change recorded as `auditId`, or null
   * while its agent is still on the way. Anything not being held — a person's
   * change, an old one, one from before a restart — shows at the moment it
   * was made. Nothing is held longer than REVEAL_CAP_MS.
   */
  revealAt(auditId: number, at: string, actorId?: string): string | null {
    const now = this.now();
    for (const [id, shownAt] of this.revealed) {
      if (now - shownAt > 5 * 60_000) this.revealed.delete(id);
    }
    // A change whose agent never arrived, long past the cap: forget it rather
    // than keep it for the lifetime of the process. Anything this old reveals
    // at the moment it was made, which is what dropping it here says.
    for (const [id, pending] of this.pendingReveal) {
      if (now - pending.sentAt > 5 * 60_000) this.pendingReveal.delete(id);
    }
    const shown = this.revealed.get(auditId);
    if (shown !== undefined) return new Date(shown).toISOString();
    // NOT YET READ. The poller picks rows up every half second, and a board
    // read in between used to be told "shown" — so a card jumped to its new
    // column, back to its old one when the row was mapped, and forward again
    // on arrival. Unread and recent means "not decided yet".
    // Only for an agent: a person's own new card should not blink out of the
    // board they just added it to.
    if (
      auditId > this.lastSeenId &&
      now - Date.parse(at) < REVEAL_CAP_MS &&
      actorId !== undefined &&
      this.presence.find(actorId)?.kind === "agent"
    ) {
      return null;
    }
    const pending = this.pendingReveal.get(auditId);
    if (pending) {
      if (now - pending.sentAt < REVEAL_CAP_MS) return null;
      this.pendingReveal.delete(auditId);
      const capped = pending.sentAt + REVEAL_CAP_MS;
      this.revealed.set(auditId, capped);
      return new Date(capped).toISOString();
    }
    return at;
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
