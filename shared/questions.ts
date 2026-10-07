import type { Status } from "./board-rules.js";

/**
 * QUESTIONS ASKED IN A SPACE, ANSWERED ON A PROJECT'S BOARD (Mica 7319, Baiwei:
 * the Library's question lectern).
 *
 * A visitor asks in the room; the question becomes a card on the board of the
 * project the space's questions go to (an INTAKE, which that project's manager
 * grants). Whoever takes the card says so on the board, as for any card. An
 * answer is kept beside the card, not in it: revisions, each with its author
 * and the exact sources it rests on. Board status is not answer evidence, and
 * an answer does not move the card.
 *
 * References are data. Nothing that reads them fetches or runs what they name;
 * a skill in the Library is something to read about, not something an answer
 * can make happen.
 */

export const QUESTION_LIMITS = {
  /** What a visitor can say in one question: a sentence or a short paragraph. */
  text: { min: 3, max: 2000 },
  /** One answer: a page, not a book. */
  body: { min: 1, max: 20_000 },
  /** At least one source, and few enough to read (Mica, 7322: an answer names its sources). */
  refs: { min: 1, max: 24 },
  /** A resource id or a version: a catalog id or a git revision, never a document. */
  field: 200,
  url: 2000,
  /** One page of a list: 30 unless asked, never more than 100. Nothing is capped overall: walk the pages (Mica, 7323). */
  page: { default: 30, max: 100 },
  /** Questions per person per space in a window: enough to ask, too few to flood a board. */
  perWindow: 5,
  windowMs: 10 * 60_000,
} as const;

/** One source an answer rests on: which resource, at which exact version, and where to read it. */
export type AnswerRef = { resource: string; version: string; url?: string };

export type QuestionAnswer = {
  revision: number;
  by: string;
  at: string;
  body: string;
  refs: AnswerRef[];
};

/** A question as a Thing and an agent read it. The card's fields are the board's own, never inferred. */
export type Question = {
  /** The board card's id: there is no other question id. */
  id: string;
  project: string;
  space: string;
  /** As it was asked. The card's title and brief can be edited; this cannot. */
  text: string;
  askedBy: string;
  askedAt: string;
  card: {
    status: Status;
    /** Assigned and accepted are different states (task_owners.accepted). */
    owners: { id: string; accepted: boolean }[];
    updatedAt: string;
  };
  /** The newest revision, or null while nobody has answered. */
  answer: QuestionAnswer | null;
};

/** One page of questions, newest first, and where the next page starts: null on the last. */
export type QuestionPage = { questions: Question[]; next: string | null };

/**
 * Where a page starts: just after this question, in newest-first order (when it
 * was asked, then its card id, so equal times still have one order). New
 * questions land on page one, so they never shift a page somebody is reading.
 * Opaque to a thing: pass `next` back as `cursor`.
 */
export const questionCursor = (question: { askedAt: string; id: string }): string => `${question.askedAt}~${question.id}`;

export function readQuestionCursor(value: unknown): { askedAt: string; id: string } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([A-Za-z0-9._-]{1,200})$/.exec(value);
  return match ? { askedAt: match[1], id: match[2] } : null;
}

/** A page size: whole, at least 1, at most the page maximum; the default when not given or not a number. */
export const pageSize = (value: unknown): number => {
  const asked = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(asked) ? Math.max(1, Math.min(QUESTION_LIMITS.page.max, Math.floor(asked))) : QUESTION_LIMITS.page.default;
};

/** What a request key may be: made by the host, one per opened form, so a resent question is the same question. */
export const isRequestKey = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);

/** The words of a question, tidied; or why they cannot be one. */
export function questionText(value: unknown): { text: string } | { problem: string } {
  if (typeof value !== "string") return { problem: "a question is text" };
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length < QUESTION_LIMITS.text.min) return { problem: "that is too short to be a question" };
  if (text.length > QUESTION_LIMITS.text.max) {
    return { problem: `a question can be ${QUESTION_LIMITS.text.max.toLocaleString()} characters; that is ${text.length.toLocaleString()}` };
  }
  return { text };
}

/** The card's title: the question's first line, short enough for a board column. */
export function questionTitle(text: string): string {
  const first = text.split("\n")[0].trim();
  return `Question: ${first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first}`;
}

const plain = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * An answer's references, checked; or the first thing wrong with them. Each
 * names a resource and its exact version (Mica, 7322: reject malformed
 * ref/resource/version data); a url, if given, is an https address to read.
 */
export function answerRefs(value: unknown): { refs: AnswerRef[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: "refs is a list of { resource, version, url? }" };
  if (value.length < QUESTION_LIMITS.refs.min) return { problem: "an answer names at least one source: { resource, version }" };
  if (value.length > QUESTION_LIMITS.refs.max) return { problem: `an answer can name ${QUESTION_LIMITS.refs.max} sources` };
  const refs: AnswerRef[] = [];
  for (const [index, raw] of value.entries()) {
    const at = `source ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problem: `${at} is not { resource, version, url? }` };
    const { resource, version, url, ...rest } = raw as Record<string, unknown>;
    if (Object.keys(rest).length) return { problem: `${at} has fields a source does not have: ${Object.keys(rest).join(", ")}` };
    if (!plain(resource) || resource.length > QUESTION_LIMITS.field) return { problem: `${at} needs a resource id (up to ${QUESTION_LIMITS.field} characters)` };
    if (!plain(version) || version.length > QUESTION_LIMITS.field) return { problem: `${at} needs the exact version it rests on (up to ${QUESTION_LIMITS.field} characters)` };
    if (/[\u0000-\u001f]/.test(resource + version)) return { problem: `${at}: a resource id and version are one line each` };
    const ref: AnswerRef = { resource: resource.trim(), version: version.trim() };
    if (url !== undefined) {
      let parsed: URL | null = null;
      try {
        parsed = typeof url === "string" && url.length <= QUESTION_LIMITS.url ? new URL(url) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== "https:") return { problem: `${at}: url must be an https address` };
      ref.url = parsed.href;
    }
    refs.push(ref);
  }
  return { refs };
}

/** An answer's words, checked. */
export function answerBody(value: unknown): { body: string } | { problem: string } {
  if (typeof value !== "string" || value.trim().length < QUESTION_LIMITS.body.min) return { problem: "an answer needs words" };
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (body.length > QUESTION_LIMITS.body.max) {
    return { problem: `an answer can be ${QUESTION_LIMITS.body.max.toLocaleString()} characters; that is ${body.length.toLocaleString()}` };
  }
  return { body };
}

/**
 * Where a question stands, in words, from the card's own fields. "Submitted"
 * and "accepted" stay different (Mica, 7322): a card someone was given and has
 * not agreed to is not one they took.
 */
export function questionStanding(question: Pick<Question, "card" | "answer">): string {
  const accepted = question.card.owners.filter((owner) => owner.accepted).map((owner) => owner.id);
  const assigned = question.card.owners.filter((owner) => !owner.accepted).map((owner) => owner.id);
  const answered = question.answer ? `answered (revision ${question.answer.revision})` : null;
  if (question.card.status === "done") return answered ?? "closed without an answer";
  if (answered) return answered;
  if (accepted.length) return `taken by ${accepted.join(", ")}`;
  if (assigned.length) return `assigned to ${assigned.join(", ")}, not yet accepted`;
  return "submitted, waiting for someone to take it";
}
