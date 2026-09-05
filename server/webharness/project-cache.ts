import type { Message } from "../../shared/contracts.js";
import { adaptMessages } from "./adapter.js";
import { SERVER_MAX_PAGE, drainPages } from "./drain-pages.js";
import { initialCrewState, reduceCrewEvent, type CrewState } from "../../src/event-core.js";
import type { WebharnessClient } from "./client.js";
import { loadMemo, saveMemo } from "./memo-store.js";

/**
 * Incremental replay of a room's project log.
 *
 * WHY: every board load replayed the room from message zero. AgentParty is the
 * room the team actually talks in, so the cost grew with conversation volume,
 * not with project activity — measured at 7.2s, then 9.2s, with one 30s
 * timeout. The busier the team, the slower the board, until it stops loading.
 *
 * WHAT THIS IS: a memo of a pure fold. Reduction over the event stream is a
 * fold, so folding the next page into the previous result is identical to
 * folding the whole stream again. The cache is therefore discardable: it is
 * never a second source of truth, and WebHarness remains the only durable
 * store.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD: tokens, session ids, usernames-as-
 * credentials, or anything else private. Only reduced public state and a
 * message id. Each request still supplies its own caller's token, and the
 * authority check still runs over adapted events exactly as it did before, so
 * a cached fold cannot smuggle in a mutation its author was not permitted to
 * make.
 *
 * ON RESTART: nothing is persisted, so a fresh process does the honest full
 * replay. A cache that survived a deploy would be a claim about history that
 * nobody verified.
 */

/**
 * Page size for replay.
 *
 * WebHarness accepts up to 200 and SILENTLY RETURNS AN EMPTY PAGE above it —
 * limit=500 answers with zero messages and no error. Measured, not assumed.
 *
 * That is a trap for this loop specifically: an empty page is how it detects
 * the end of history, so a page size over the cap would make it stop on the
 * FIRST request and return an empty board as though the replay were complete.
 * The board would look finished and be empty, which is the failure this file
 * already throws to avoid in the other direction.
 *
 * So this constant may not exceed SERVER_MAX_PAGE, and a test asserts it.
 * 200 rather than 50 cuts a ~680-message room from 14 upstream round trips to
 * 4.
 */
const PAGE_LIMIT = SERVER_MAX_PAGE;
const MAX_REJECTED = 50;

export type ProjectProjection = {
  projects: unknown[];
  tasks: unknown[];
  profiles: unknown[];
  ownerships: unknown[];
  memberships: unknown[];
  projectCreators: Record<string, string>;
  rejected: Array<{ reason: string }>;
  /** True when this answer came from a full replay rather than an increment. */
  fullReplay: boolean;
};

type Entry = {
  state: CrewState;
  lastId: number;
  rejected: Array<{ reason: string }>;
};

export class ProjectStateCache {
  private readonly entries = new Map<string, Entry>();
  /**
   * One refresh per room at a time.
   *
   * Two concurrent loads would each read from the same cursor and each fold
   * the same messages, or worse, interleave and advance the cursor past events
   * the other had not folded. Sharing the in-flight promise makes concurrent
   * callers observe one consistent refresh instead of racing it.
   */
  private readonly inFlight = new Map<string, Promise<ProjectProjection>>();

  constructor(
    private readonly client: Pick<WebharnessClient, "request">,
    /** Test seam. Production passes nothing and gets the real page size. */
    private readonly pageLimit: number = PAGE_LIMIT,
    /**
     * Where a memo may persist across restarts, and the commit that would make
     * it trustworthy. Both absent (the default, and every test) means the old
     * behaviour exactly: nothing survives a restart.
     */
    private readonly durable?: { stateDir: string; commit: string | null },
  ) {}

  /** Testing/inspection only: how far this room has been folded. */
  cursorFor(room: string): number | undefined {
    return this.entries.get(room)?.lastId;
  }

  async read(
    room: string,
    token: string,
    canMutateProject: (username: string, roomName: string) => boolean,
  ): Promise<ProjectProjection> {
    const existing = this.inFlight.get(room);
    if (existing) return existing;

    const run = this.refresh(room, token, canMutateProject).finally(() => {
      this.inFlight.delete(room);
    });
    this.inFlight.set(room, run);
    return run;
  }

  private async refresh(
    room: string,
    token: string,
    canMutateProject: (username: string, roomName: string) => boolean,
  ): Promise<ProjectProjection> {
    // In-memory first; then a memo from a previous process, but only if the
    // SAME COMMIT wrote it. Different code means a fold computed by a different
    // program, which is worth nothing.
    let cached = this.entries.get(room);
    if (!cached && this.durable) {
      const memo = loadMemo(this.durable.stateDir, room, this.durable.commit);
      if (memo) cached = { state: memo.state, lastId: memo.lastId, rejected: [] };
    }
    const startFrom = cached?.lastId ?? 0;

    // Traversal lives in drainPages, not here. Three readers in this project
    // each re-implemented "read every page" and each got a different part of it
    // wrong; this one no longer has its own copy to get wrong.
    const { items: messages, lastId } = await drainPages<Message>({
      fetchPage: async (afterId, limit) => {
        const response = await this.client.request<{ messages?: Message[] }>(
          `/api/rooms/${encodeURIComponent(room)}/messages?afterId=${afterId}&wait=0&limit=${limit}`,
          { token },
        );
        return Array.isArray(response.messages) ? response.messages : [];
      },
      idOf: (message) => message.id,
      startAfter: startFrom,
      pageLimit: this.pageLimit,
    });

    const adapted = adaptMessages(messages, { roomName: room, canMutateProject });
    const state = adapted.events.reduce(reduceCrewEvent, cached?.state ?? initialCrewState);
    const rejected = [...(cached?.rejected ?? []), ...adapted.rejected, ...state.rejectedEvents].slice(
      -MAX_REJECTED,
    );

    this.entries.set(room, { state, lastId, rejected });
    if (this.durable) {
      saveMemo(this.durable.stateDir, { commit: this.durable.commit ?? "", room, lastId, state });
    }

    return {
      projects: Object.values(state.projects),
      tasks: Object.values(state.tasks),
      // Declared profiles and ownership links. These are public room state, not
      // credentials: the profile validator refuses anything sensitive before it
      // can reach the log, so there is nothing here to withhold at read time.
      profiles: Object.values(state.profiles),
      ownerships: Object.values(state.ownerships),
      memberships: state.memberships,
      projectCreators: state.projectCreators,
      rejected,
      fullReplay: startFrom === 0,
    };
  }
}
