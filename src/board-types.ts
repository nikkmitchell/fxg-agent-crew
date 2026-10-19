import type { Status } from "../shared/board-rules.js";
import type { TaskFreshness } from "../shared/board-freshness.js";

/**
 * The board as the UI holds it: cards, comments and projects, as the board API
 * (saha.ing's own database, ADR-002) hands them over.
 *
 * These were the types of src/event-core.ts, the reducer that folded `crew-event`
 * chat messages into a board before the cutover of 2026-09-10. The reducer had no
 * caller left and went on 2026-10-20; the shapes the UI draws stayed, here.
 */
export type TaskKind = "decision" | "build";

/** The board's columns: shared/board-rules.ts has the one list. */
export type TaskStatus = Status;

export type CrewTask = {
  id: string;
  projectId?: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  points: number;
  /** Persistent creation time, supplied by the board API when available. */
  createdAt?: string;
  /**
   * What this card actually means, in prose.
   *
   * A title has to fit in a column, so it compresses until it is a label rather
   * than a statement — "Fix Project Auto Update" tells you nothing about what
   * was broken or what finishing looks like. Everything that context used to go
   * into ended up in comments, where it sits below whatever was said most
   * recently and is read as chatter rather than as the brief.
   *
   * OPTIONAL, and absent means nobody has written one. That is rendered as an
   * explicit invitation to write it, never as an empty panel that reads like a
   * loading failure.
   */
  description?: string;
  blocker?: string;
  /**
   * Whether finishing this card means a DECISION was reached or a THING WAS
   * BUILT.
   *
   * The board previously showed nine tasks, eight of them "done", while nothing
   * ran. Every one was a decision, and "done" was read — reasonably — as "this
   * works". A human asked "how do I test this?" precisely because the board had
   * told him there was something to test.
   *
   * For a product whose rule is that the screen may only say what it can prove,
   * a done column that conflates decided with built is the wrong claim to leave
   * standing.
   *
   * OPTIONAL ON PURPOSE. Absent means nobody has said which, and that is
   * reported as unspecified rather than defaulted. Guessing "decision" for
   * existing cards would relabel other people's work retroactively on an
   * assumption, which is the same error in a smaller costume.
   */
  kind?: TaskKind;
  /**
   * 1 is most urgent, 5 least. Optional, and ABSENT MEANS UNSET — not lowest.
   *
   * The distinction matters because the point of this field is agents choosing
   * what to do next without being told. Defaulting unset cards to the bottom
   * would quietly bury every card nobody has triaged, which is exactly the work
   * most likely to need a human's attention.
   */
  priority?: number;
  owners?: string[];
  acceptedBy?: string[];
  comments?: TaskComment[];
  links?: Array<{ label: string; href: string }>;
  images?: Array<{ label: string; href: string }>;
  /** When the card last changed at all, for tucking away cards finished long ago. */
  updatedAt?: string;
  /** Present when the card moved or was created recently. See shared/board-freshness.ts. */
  fresh?: TaskFreshness;
};

export type TaskComment = { id: string; author: string; body: string; createdAt: string };

export type CrewProject = {
  id: string;
  name: string;
  summary: string;
  goals: string[];
  steps: Array<{ id: string; title: string; status: "not_started" | "in_progress" | "done" }>;
};
