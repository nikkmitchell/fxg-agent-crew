import type { Message } from "../../shared/contracts.js";
import { adaptMessages } from "./adapter.js";
import { initialCrewState, reduceCrewEvent, type CrewState } from "../../src/event-core.js";
import type { WebharnessClient } from "./client.js";

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

const PAGE_LIMIT = 50;
const MAX_PAGES = 200;
const MAX_REJECTED = 50;

export type ProjectProjection = {
  projects: unknown[];
  tasks: unknown[];
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
    const cached = this.entries.get(room);
    const startFrom = cached?.lastId ?? 0;
    const messages: Message[] = [];
    let afterId = startFrom;
    let complete = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.client.request<{ messages?: Message[] }>(
        `/api/rooms/${encodeURIComponent(room)}/messages?afterId=${afterId}&wait=0&limit=${this.pageLimit}`,
        { token },
      );
      const batch = Array.isArray(response.messages) ? response.messages : [];
      if (batch.length === 0) {
        complete = true;
        break;
      }
      messages.push(...batch);
      const next = batch.reduce((highest, message) => Math.max(highest, message.id), afterId);
      if (next <= afterId) throw new Error("project replay cursor did not advance");
      afterId = next;
      if (batch.length < this.pageLimit) {
        complete = true;
        break;
      }
    }

    // Ran out of guard with history still unread. Throwing keeps the previous
    // cache intact internally, but the CALLER gets an error rather than a
    // board that is missing its oldest projects while looking complete.
    if (!complete) throw new Error(`project replay exceeded ${MAX_PAGES * this.pageLimit} messages`);

    const adapted = adaptMessages(messages, { roomName: room, canMutateProject });
    const state = adapted.events.reduce(reduceCrewEvent, cached?.state ?? initialCrewState);
    const rejected = [...(cached?.rejected ?? []), ...adapted.rejected, ...state.rejectedEvents].slice(
      -MAX_REJECTED,
    );

    this.entries.set(room, { state, lastId: afterId, rejected });

    return {
      projects: Object.values(state.projects),
      tasks: Object.values(state.tasks),
      rejected,
      fullReplay: startFrom === 0,
    };
  }
}
