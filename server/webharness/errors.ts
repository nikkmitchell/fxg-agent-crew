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
 * All markers below are now OBSERVED, not documented. They were captured by
 * driving a local WebHarness instance into each failure state:
 *   403 "尚未加入该房间"  — reading a room never joined
 *   403 "需要房间密码"    — joining a private password room with no password
 *   403 "房间密码错误"    — joining it with the wrong password
 *   404 "房间不存在，请先创建或加入"
 *   401 "签名验证失败" / "challenge 不存在或已过期"
 *
 * Ordering matters: "房间密码错误" also contains 密码, so the incorrect-password
 * check must precede the password-required one or every wrong attempt would
 * re-prompt as though nothing had been typed.
 *
 * Matching stays substring-based and every branch still FAILS SAFE: an
 * unrecognised 403 becomes NOT_A_MEMBER (a read-only screen) rather than being
 * guessed into MUTED or a password prompt. A confident wrong state in front of
 * a human is worse than a vaguer correct one.
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
    // Incorrect must be tested before required: "房间密码错误" contains 密码,
    // so the looser check would swallow it and re-prompt as if the user had
    // typed nothing.
    if (has(detail, "密码错误", "incorrect password", "wrong password")) {
      return { code: "ROOM_PASSWORD_INCORRECT", status: 403, detail };
    }
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

  // Kept for correctness, but NOTE: upstream cannot currently reach this.
  //
  // Archiving sets archived_at and ended_at together, and the room lookup
  // filters `archived_at IS NULL`, so an archived room is never found and the
  // 410 "房间已结束" branch is unreachable — verified by reading app/main.py on a
  // local instance and by observing a real archive return 404.
  //
  // The consequence is that we CANNOT distinguish "this room was archived" from
  // "no such room" at this endpoint, so an archived room surfaces as
  // ROOM_NOT_FOUND. That is worse UX than saying "this room ended, history is in
  // archives", but claiming ROOM_ARCHIVED on a 404 would be guessing, and a
  // confident wrong state is worse than an honest vague one. If upstream fixes
  // the lookup, this branch starts working with no change here.
  if (status === 410) {
    return { code: "ROOM_ARCHIVED", status: 410, detail };
  }

  if (status === 400) {
    return { code: "BAD_REQUEST", status: 400, detail };
  }

  return { code: "UPSTREAM_UNAVAILABLE", status: 502, detail };
}
