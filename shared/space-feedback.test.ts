import { describe, expect, it } from "vitest";
import { FEEDBACK_LIMITS, readFeedback } from "./space-feedback";

describe("a tester's report", () => {
  const item = { id: "fps", label: "Stays smooth", status: "passed", note: "72 fps" };
  it("keeps the items and notes a page sent", () => {
    expect(readFeedback({ branch: "mica-sky", device: "Quest 3", summary: "Lovely", items: [item] })).toEqual({ branch: "mica-sky", device: "Quest 3", summary: "Lovely", items: [item], deploy: null });
  });
  it("defaults to main, and refuses a branch that could not exist", () => {
    expect(readFeedback({ summary: "x" })?.branch).toBe("main");
    expect(readFeedback({ branch: "../etc", summary: "x" })).toBeNull();
    expect(readFeedback({ branch: "a b", summary: "x" })).toBeNull();
  });
  it("needs something in it, and drops a bad item without refusing the rest", () => {
    expect(readFeedback({ items: [] })).toBeNull();
    expect(readFeedback(null)).toBeNull();
    const read = readFeedback({ items: [item, { id: "bad id!", label: "x", status: "passed" }, { id: "s", label: "y", status: "meh" }, { id: "z", label: "", status: "passed" }] });
    expect(read?.items).toEqual([item]);
  });
  it("cuts every field to size and strips control characters", () => {
    const read = readFeedback({ summary: `  hello\u0007\u0000 ${"x".repeat(5000)}`, device: "d".repeat(500), items: [{ id: "n", label: "l", status: "needs-work", note: "n".repeat(5000) }] });
    expect(read?.summary.length).toBe(FEEDBACK_LIMITS.summary);
    expect(read?.summary.startsWith("hello x")).toBe(true);
    expect(read?.device.length).toBe(FEEDBACK_LIMITS.device);
    expect(read?.items[0].note.length).toBe(FEEDBACK_LIMITS.note);
  });
  it("keeps at most the allowed number of items", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ id: `i${index}`, label: "l", status: "passed" }));
    expect(readFeedback({ items: many })?.items).toHaveLength(FEEDBACK_LIMITS.items);
  });
});
