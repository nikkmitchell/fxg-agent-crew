import type { BffErrorCode } from "../../shared/contracts.js";
import { WebharnessError } from "./client.js";

/**
 * Translate an upstream failure into a stable code the UI can switch on.
 *
 * Status alone is not enough: upstream returns 403 for "not a member", "needs a
 * password", and "muted" alike, and those are three different screens. The only
 * thing distinguishing them is the `detail` string, which is Chinese prose and
 * therefore not something the client should ever pattern-match on itself — that
 * is exactly the coupling this module exists to absorb.
 *
 * Evidence for the markers below:
 *   observed live  — "尚未加入该房间" (403 on a room the agent had not joined),
 *                    "签名验证失败" and "challenge 不存在或已过期" (401)
 *   from the docs  — the password / muted / not-found wordings, which the API
 *                    documentation describes but which this client has not yet
 *                    triggered directly.
 *
 * Because half of these are documented rather than confirmed, matching is by
 * substring and every branch FAILS SAFE: an unrecognised 403 becomes
 * NOT_A_MEMBER (a read-only screen) rather than being guessed into MUTED or a
 * password prompt. Guessing wrong here would put a confident, incorrect state in
 * front of a human, which is worse than a vaguer correct one.
 */

const has = (haystack: string, ...needles: string[]) =>
  needles.some((needle) => haystack.includes(needle));

export function classify(error: unknown): { code: BffErrorCode; status: number; detail: string } {
  if (!(error instanceof WebharnessError)) {
    return { code: "UPSTREAM_UNAVAILABLE", status: 502, detail: "upstream unavailable" };
  }

  const { status, detail } = error;

  if (status === 401) {
    return { code: "SESSION_EXPIRED", status: 401, detail };
  }

  if (status === 403) {
    // Password first: a room needing a password is a prompt, not a denial.
    if (has(detail, "密码", "password")) {
      return { code: "ROOM_PASSWORD_REQUIRED", status: 403, detail };
    }
    if (has(detail, "禁言", "muted")) {
      return { code: "MUTED", status: 403, detail };
    }
    // Observed wording, and the safe default for anything else 403 means.
    return { code: "NOT_A_MEMBER", status: 403, detail };
  }

  if (status === 404) {
    return { code: "ROOM_NOT_FOUND", status: 404, detail };
  }

  if (status === 410) {
    return { code: "ROOM_ARCHIVED", status: 410, detail };
  }

  if (status === 400) {
    return { code: "BAD_REQUEST", status: 400, detail };
  }

  return { code: "UPSTREAM_UNAVAILABLE", status: 502, detail };
}
