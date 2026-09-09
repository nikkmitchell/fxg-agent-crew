import { summariseCrewEvent, type CrewEventSummary } from "./crew-event-summary";
import type { Message } from "../shared/contracts";

/**
 * Fold adjacent machine exhaust into one line a person can skip.
 *
 * The transition graph makes this structural rather than a matter of anyone
 * being noisy: backlog to done is not a legal move, so closing one stale card
 * costs four messages, and reconciling a board costs dozens. One wake contained
 * 49 messages, nearly all of them one-line transitions. A human scrolling for
 * judgement has to wade through every one.
 *
 * WHAT THIS IS NOT. It is not deletion, and it is not a filter. WebHarness is
 * the only durable store we have, and every original message stays in the
 * transcript, in order, one disclosure away. A reader who wants the raw record
 * still gets all of it; a reader who wants the conversation stops paying for
 * the bookkeeping.
 *
 * ADJACENT ONLY. A run is broken by anything a person said, so folding can
 * never swallow human words or reorder them against the machine events around
 * them. That is the difference between summarising exhaust and hiding a reply.
 */

export type TranscriptEntry =
  | { kind: "message"; message: Message }
  | {
      kind: "collapsed";
      /** Every original message in the run, unchanged and in order. */
      messages: Message[];
      author: string;
      /** The card or project the run is about, when it is about one. */
      subject?: string;
      /** One line describing the whole run. */
      headline: string;
      summaries: CrewEventSummary[];
    };

/**
 * How far apart two events can be and still be one action.
 *
 * Five minutes. Long enough to cover an agent working through a card at
 * conversational speed, short enough that this morning's close and this
 * afternoon's do not merge into one misleading line.
 */
export const COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

/** Below this a run is already one or two lines and folding only adds a click. */
const MIN_RUN = 3;

type Candidate = { message: Message; summary: CrewEventSummary };

function isExhaust(message: Message): Candidate | null {
  if (message.streaming) return null;
  const summary = summariseCrewEvent(message.content);
  // A quoted example is a person teaching, not bookkeeping. Folding it away
  // would hide the explanation and keep the noise, which is backwards.
  if (!summary || summary.quoted) return null;
  return { message, summary };
}

const at = (message: Message) => Date.parse(message.createdAt) || 0;

function sameRun(previous: Candidate, next: Candidate): boolean {
  return (
    previous.message.username === next.message.username &&
    previous.summary.subject === next.summary.subject &&
    Math.abs(at(next.message) - at(previous.message)) <= COLLAPSE_WINDOW_MS
  );
}

export function collapseTranscript(messages: Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let run: Candidate[] = [];

  const flush = () => {
    if (run.length >= MIN_RUN) {
      entries.push({
        kind: "collapsed",
        messages: run.map((item) => item.message),
        author: run[0].message.username,
        ...(run[0].summary.subject ? { subject: run[0].summary.subject } : {}),
        headline: describeRun(run),
        summaries: run.map((item) => item.summary),
      });
    } else {
      // Too short to be worth a disclosure: show them as they were.
      for (const item of run) entries.push({ kind: "message", message: item.message });
    }
    run = [];
  };

  for (const message of messages) {
    const candidate = isExhaust(message);
    if (!candidate) {
      flush();
      entries.push({ kind: "message", message });
      continue;
    }
    if (run.length && !sameRun(run[run.length - 1], candidate)) flush();
    run.push(candidate);
  }
  flush();
  return entries;
}

/**
 * One sentence for a run of events.
 *
 * States the path rather than the count. "moved it through assigned → in
 * progress → review → done" is what a reader wants to know; "made 6 changes"
 * makes them expand it to find out whether anything happened.
 */
function describeRun(run: Candidate[]): string {
  const subject = run[0].summary.subject ?? "the board";
  const path = run
    .filter((item) => item.summary.eventType === "task.transitioned" && item.summary.to)
    .map((item) => item.summary.to as string);
  const comments = run.filter((item) => item.summary.eventType === "task.commented").length;
  const edits = run.filter((item) => item.summary.eventType === "task.upserted").length;

  const parts: string[] = [];
  if (path.length) parts.push(`moved ${subject} ${path.map(readable).join(" → ")}`);
  // Name the card when nothing else in the sentence does. "edited the card,
  // left 5 comments" is a summary that makes you open it to find out which
  // card — which is the click this whole thing exists to save.
  const named = path.length ? "the card" : subject;
  if (edits) parts.push(edits === 1 ? `edited ${named}` : `edited ${named} ${edits} times`);
  if (comments) {
    const on = path.length || edits ? "" : ` on ${subject}`;
    parts.push(`left ${comments === 1 ? "a comment" : `${comments} comments`}${on}`);
  }

  // Nothing recognised is still worth reporting honestly, rather than folding
  // it into a confident sentence about events this code does not understand.
  if (!parts.length) return `${run.length} board events on ${subject}`;
  return parts.join(", ");
}

const words: Record<string, string> = {
  backlog: "to backlog",
  assigned: "to assigned",
  in_progress: "to in progress",
  blocked: "to blocked",
  review: "to review",
  done: "to done",
};

const readable = (status: string, index: number) =>
  index === 0 ? (words[status] ?? `to ${status}`) : (words[status] ?? `to ${status}`).replace(/^to /, "");
