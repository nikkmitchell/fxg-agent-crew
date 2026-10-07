import type { Status } from "./board-rules.js";

/**
 * REVIEW ROUNDS (Review Studio; Mica 7347, 7350, 7368; Skein 7352). A round
 * asks people and agents to try ONE exact version of one thing, beside an
 * optional exact baseline, against a checklist. It is a board card on the
 * candidate's own project, so taking it is the board's own claim and accept,
 * and availability is never claimed: "invited" is an owner who has not
 * accepted. Findings are feedback reports on the space, at the deploy that was
 * reviewed, so they land where the space's other evidence does.
 *
 * NO BRANCH-LIVE FALLBACK anywhere: a target is space + entry + mode + exact
 * deploy, and a missing one fails rather than showing whatever is live.
 */

export const REVIEW_LIMITS = {
  title: 120,
  checklist: { items: 20, item: 200 },
  finding: { min: 3, max: 4000 },
  /** Findings per person per round in an hour. */
  perHour: 30,
  page: { default: 30, max: 100 },
} as const;

export type ReviewMode = "item" | "full" | "model";
export type ReviewVariant = "candidate" | "baseline";

export type ReviewRound = {
  /** The board card's id. */
  id: string;
  project: string;
  title: string;
  space: string;
  entry: string;
  mode: ReviewMode;
  candidate: { deploy: string };
  baseline: { deploy: string } | null;
  checklist: string[];
  card: { status: Status; owners: { id: string; accepted: boolean }[] };
  findings: number;
  by: string;
  at: string;
};

export type ReviewFinding = {
  id: string;
  round: string;
  by: string;
  at: string;
  variant: ReviewVariant;
  deploy: string;
  text: string;
};

export type Page<T> = { items: T[]; next: string | null };

const DEPLOY = /^[A-Za-z0-9_-]{1,64}$/;
const SPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENTRY = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type RoundInput = {
  project: string;
  space: string;
  entry: string;
  mode: ReviewMode;
  candidate: string;
  baseline: string | null;
  checklist: string[];
  title: string;
};

/** A request to publish a round, checked in shape; whether the deploys are real is the server's next question. */
export function readRound(raw: unknown): { round: RoundInput } | { problem: string } {
  if (!raw || typeof raw !== "object") return { problem: "a round is { project, space, entry, mode, candidate, baseline?, checklist, title }" };
  const r = raw as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const project = str(r.project);
  const space = str(r.space);
  const entry = str(r.entry);
  const mode = r.mode;
  const candidate = str(r.candidate);
  const baseline = r.baseline === undefined || r.baseline === null || r.baseline === "" ? null : str(r.baseline);
  const title = str(r.title);
  if (!project) return { problem: "say which project's board the round goes on" };
  if (!SPACE.test(space)) return { problem: "space is a space's name" };
  if (!ENTRY.test(entry)) return { problem: "entry is the thing's id in saha-pieces.json" };
  if (mode !== "item" && mode !== "full" && mode !== "model") return { problem: 'mode is "item", "full" or "model"' };
  if (!DEPLOY.test(candidate)) return { problem: "candidate is an exact deploy id" };
  if (baseline !== null && !DEPLOY.test(baseline)) return { problem: "baseline, if given, is an exact deploy id" };
  if (baseline === candidate) return { problem: "the baseline and the candidate are the same deploy" };
  if (!title || title.length > REVIEW_LIMITS.title) return { problem: `a round needs a title of up to ${REVIEW_LIMITS.title} characters` };
  if (!Array.isArray(r.checklist)) return { problem: "checklist is a list of short things to check" };
  const checklist = r.checklist.map(str).filter(Boolean);
  if (checklist.length > REVIEW_LIMITS.checklist.items) return { problem: `a checklist has at most ${REVIEW_LIMITS.checklist.items} items` };
  if (checklist.some((item) => item.length > REVIEW_LIMITS.checklist.item)) return { problem: `each checklist item is at most ${REVIEW_LIMITS.checklist.item} characters` };
  return { round: { project, space, entry, mode, candidate, baseline, checklist, title } };
}

export function findingText(value: unknown): { text: string } | { problem: string } {
  if (typeof value !== "string") return { problem: "a finding is text" };
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length < REVIEW_LIMITS.finding.min) return { problem: "that is too short to be a finding" };
  if (text.length > REVIEW_LIMITS.finding.max) return { problem: `a finding can be ${REVIEW_LIMITS.finding.max.toLocaleString()} characters` };
  return { text };
}

/** Where a newest-first page starts: just after this one (time, then id). Opaque to callers. */
export const pageCursor = (at: string, id: string): string => `${at}~${id}`;
export function readPageCursor(value: unknown): { at: string; id: string } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([A-Za-z0-9._-]{1,200})$/.exec(value);
  return match ? { at: match[1], id: match[2] } : null;
}
