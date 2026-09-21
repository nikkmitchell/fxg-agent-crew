import { describe, expect, it } from "vitest";
import { COMMENTS_SHOWN, DETAIL_PX, paintDetail, type TaskDetail } from "./card-detail.js";
import type { Ink } from "./card-paint.js";

const measure = (text: string, size: number) => text.length * size * 0.55;
const texts = (ink: Ink[]) => ink.flatMap((i) => (i.kind === "text" ? [i.text] : []));
const said = (ink: Ink[]) => texts(ink).join("   ");

const task = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  id: "t1",
  title: "Session player: pause, resume, end",
  status: "in_progress",
  ...over,
});

describe("the card you pull off the board", () => {
  it("shows more than the card does", () => {
    // The entire reason the panel exists.
    const detail = paintDetail(
      task({ description: "Long enough that a card would elide it.", assigneeId: "Sill", comments: [{ author: "Nikk2", body: "start here" }] }),
      measure,
    );
    const words = said(detail);
    expect(words).toContain("Session player");
    expect(words).toContain("Long enough");
    expect(words).toContain("Sill");
    expect(words).toContain("start here");
  });

  it("gives the title room instead of eliding at three lines", () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    const detail = paintDetail(task({ title: long }), measure);
    const titleLines = texts(detail).filter((t) => t.startsWith("word"));
    expect(titleLines.length).toBeGreaterThan(3);
  });

  it("puts a blocker ABOVE the description and in the refusal colour", () => {
    // If something is blocked, that sentence is the most useful thing here.
    const detail = paintDetail(task({ blocker: "waiting on audio licence", description: "the body" }), measure);
    const blockerAt = detail.findIndex((i) => i.kind === "text" && i.text.includes("Blocked"));
    const bodyAt = detail.findIndex((i) => i.kind === "text" && i.text.includes("the body"));
    expect(blockerAt).toBeGreaterThan(-1);
    expect(blockerAt).toBeLessThan(bodyAt);
    const blocker = detail[blockerAt];
    expect(blocker.kind === "text" && blocker.fill).not.toBe("#222321");
  });

  it("shows comments NEWEST first", () => {
    // Pulling a card off a wall to read its oldest remark is not what anybody
    // wants.
    const detail = paintDetail(
      task({ comments: [
        { author: "a", body: "oldest" },
        { author: "b", body: "middle" },
        { author: "c", body: "newest" },
      ] }),
      measure,
    );
    const words = said(detail);
    expect(words.indexOf("newest")).toBeLessThan(words.indexOf("oldest"));
  });

  it("says how many it did not show rather than pretending", () => {
    const comments = Array.from({ length: COMMENTS_SHOWN + 4 }, (_, i) => ({ author: `p${i}`, body: `c${i}` }));
    const words = said(paintDetail(task({ comments }), measure));
    expect(words).toContain("4 older");
  });

  it("counts one comment as a comment", () => {
    expect(said(paintDetail(task({ comments: [{ author: "a", body: "b" }] }), measure))).toContain("1 comment");
  });

  it("keeps everything inside the panel even when crowded", () => {
    // Anything drawn past the bitmap is simply not there.
    const detail = paintDetail(
      task({
        title: Array.from({ length: 40 }, () => "title").join(" "),
        description: Array.from({ length: 200 }, () => "body").join(" "),
        blocker: Array.from({ length: 40 }, () => "blocked").join(" "),
        comments: Array.from({ length: 40 }, (_, i) => ({ author: `person${i}`, body: `remark ${i} `.repeat(20) })),
      }),
      measure,
    );
    for (const item of detail) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(DETAIL_PX.width);
      expect(item.y).toBeLessThanOrEqual(DETAIL_PX.height);
    }
  });

  it("is quiet when there is nothing to say", () => {
    // No "no description", no "0 comments".
    const words = said(paintDetail(task(), measure));
    expect(words).not.toContain("comment");
    expect(words).not.toContain("Blocked");
  });

  it("is deterministic", () => {
    expect(paintDetail(task(), measure)).toEqual(paintDetail(task(), measure));
  });
});
