import { isPreviewableBranch } from "./spaces.js";

/**
 * TESTER FEEDBACK, KEPT WITH THE SPACE (Nikk, 6577 and 6597: a checklist in the
 * spaces so humans tick what agents need checked and add their feedback, and
 * "it should be shared to the page, so agents can see it there, instead of
 * needing to be copied to chat").
 *
 * A space page sends a report with the visitor's entry ticket
 * (room.submitFeedback in src/kit/connect.ts). saha.ing stores it against the
 * space and branch, shows it on the Spaces page, and hands it to agents through
 * GET /bff/spaces/<space>/feedback, so the people who built the thing read what
 * the testers said where the thing lives.
 */

export const FEEDBACK_LIMITS = {
  items: 60,
  label: 200,
  note: 1000,
  summary: 2000,
  device: 80,
  /** Reports one person may send to one space in an hour. */
  perHour: 20,
  /** Reports returned at most by a listing. */
  list: 100,
  /** The request body, in characters. */
  body: 32_000,
} as const;

export const FEEDBACK_STATUSES = ["passed", "needs-work", "not-tested"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackItem = { id: string; label: string; status: FeedbackStatus; note: string };
export type FeedbackReport = {
  branch: string;
  device: string;
  summary: string;
  items: FeedbackItem[];
  /**
   * The exact deploy this is about, when the page knows it (a pinned page, a
   * finished space). The server checks it belongs to the space, and otherwise
   * records the branch's live deploy at the moment the report arrived.
   */
  deploy?: string | null;
};
export type StoredFeedback = FeedbackReport & { id: string; by: string; at: string };

/** Plain text, no control characters, trimmed and cut to length. */
const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, limit) : "";

/**
 * A report a page sent, checked; null when there is nothing in it to keep or it
 * names a branch that could not exist. Nothing here is trusted: every field is
 * cut down to size, and a bad item is left out rather than refusing the rest.
 */
export function readFeedback(raw: unknown): FeedbackReport | null {
  if (!raw || typeof raw !== "object") return null;
  const report = raw as Record<string, unknown>;
  const branch = typeof report.branch === "string" && report.branch ? report.branch : "main";
  if (branch !== "main" && !isPreviewableBranch(branch)) return null;
  const items: FeedbackItem[] = [];
  for (const each of Array.isArray(report.items) ? report.items.slice(0, FEEDBACK_LIMITS.items) : []) {
    const item = (each ?? {}) as Record<string, unknown>;
    const id = typeof item.id === "string" && /^[A-Za-z0-9_.:-]{1,40}$/.test(item.id) ? item.id : "";
    const label = text(item.label, FEEDBACK_LIMITS.label);
    const status = FEEDBACK_STATUSES.find((each) => each === item.status);
    if (!id || !label || !status) continue;
    items.push({ id, label, status, note: text(item.note, FEEDBACK_LIMITS.note) });
  }
  const summary = text(report.summary, FEEDBACK_LIMITS.summary);
  if (items.length === 0 && !summary) return null;
  const deploy = typeof report.deploy === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(report.deploy) ? report.deploy : null;
  return { branch, device: text(report.device, FEEDBACK_LIMITS.device), summary, items, deploy };
}
