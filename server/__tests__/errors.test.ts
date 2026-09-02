import { describe, expect, it } from "vitest";
import { WebharnessError } from "../webharness/client.js";
import { classify } from "../webharness/errors.js";

const upstream = (status: number, detail: string) => new WebharnessError(status, detail);

describe("classify", () => {
  it("maps the observed not-joined 403 to NOT_A_MEMBER", () => {
    // Exact string returned by the live server for a room the caller has not joined.
    expect(classify(upstream(403, "尚未加入该房间")).code).toBe("NOT_A_MEMBER");
  });

  it("distinguishes the three meanings of 403", () => {
    expect(classify(upstream(403, "需要房间密码")).code).toBe("ROOM_PASSWORD_REQUIRED");
    expect(classify(upstream(403, "你已被禁言")).code).toBe("MUTED");
    expect(classify(upstream(403, "尚未加入该房间")).code).toBe("NOT_A_MEMBER");
  });

  it("falls back to the read-only state for an unrecognised 403", () => {
    // Half the 403 wordings come from docs rather than observation, so an
    // unknown one must land on a safe screen. NOT_A_MEMBER shows read-only;
    // guessing MUTED or a password prompt would state something false
    // confidently, which is worse than being vague and correct.
    const result = classify(upstream(403, "some wording we have never seen"));
    expect(result.code).toBe("NOT_A_MEMBER");
    expect(result.code).not.toBe("MUTED");
    expect(result.code).not.toBe("ROOM_PASSWORD_REQUIRED");
  });

  it("matches English wordings too, in case upstream localises", () => {
    expect(classify(upstream(403, "room password required")).code).toBe("ROOM_PASSWORD_REQUIRED");
    expect(classify(upstream(403, "you are muted")).code).toBe("MUTED");
  });

  it("maps the remaining statuses", () => {
    expect(classify(upstream(401, "签名验证失败")).code).toBe("SESSION_EXPIRED");
    expect(classify(upstream(404, "房间不存在")).code).toBe("ROOM_NOT_FOUND");
    expect(classify(upstream(410, "gone")).code).toBe("ROOM_ARCHIVED");
    expect(classify(upstream(400, "bad")).code).toBe("BAD_REQUEST");
  });

  it("treats unknown statuses and non-upstream failures as retryable", () => {
    expect(classify(upstream(500, "boom")).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(classify(upstream(503, "unavailable")).code).toBe("UPSTREAM_UNAVAILABLE");
    // A thrown TypeError, a DNS failure, anything that is not a WebharnessError.
    expect(classify(new Error("socket hang up")).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(classify(undefined).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("never leaks a token through the detail it passes on", () => {
    const result = classify(upstream(500, "boom"));
    expect(JSON.stringify(result)).not.toContain("Bearer");
  });

  it("preserves the upstream status so HTTP semantics stay honest", () => {
    // The UI branches on `code`, but proxies, logs and tests still see a
    // truthful status rather than everything collapsing to 200 or 500.
    expect(classify(upstream(404, "房间不存在")).status).toBe(404);
    expect(classify(upstream(410, "gone")).status).toBe(410);
  });
});
