import { describe, expect, it } from "vitest";
import { taskAgeStamp } from "./task-age";

const now = Date.parse("2026-09-24T12:00:00Z");

describe("taskAgeStamp", () => {
  it("shows short elapsed time for recent tasks", () => {
    expect(taskAgeStamp("2026-09-24T11:58:00Z", now)?.relative).toBe("2m ago");
  });

  it("makes old cards easy to recognize", () => {
    expect(taskAgeStamp("2026-09-20T12:00:00Z", now)?.relative).toBe("4d ago");
    expect(taskAgeStamp("2026-08-10T12:00:00Z", now)?.relative).toBe("1mo ago");
    expect(taskAgeStamp("2025-08-20T12:00:00Z", now)?.relative).toBe("1y ago");
  });

  it("keeps the exact local date available and handles unusable timestamps safely", () => {
    expect(taskAgeStamp("2026-09-24T10:00:00Z", now)?.absolute).toBeTruthy();
    expect(taskAgeStamp("not a date", now)).toBeNull();
    expect(taskAgeStamp(undefined, now)).toBeNull();
  });

  it("does not show a negative age for a slightly future timestamp", () => {
    expect(taskAgeStamp("2026-09-24T12:01:00Z", now)?.relative).toBe("just now");
  });
});
