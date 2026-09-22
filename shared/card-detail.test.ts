import { describe, expect, it } from "vitest";
import { COMMENTS_SHOWN, DETAIL_CLOSE, DETAIL_MOVES, DETAIL_PX, detailMoveAt, isDetailClose, isDetailComment, paintDetail, type TaskDetail } from "./card-detail.js";
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
    /**
     * No "no description", no "0 comments", no "not blocked".
     *
     * This used to assert the word "comment" was absent entirely, which was a
     * proxy for "no empty-state filler" and stopped being one the moment the
     * panel grew a "write a comment" control. An INVITATION is not filler: it
     * is the thing you came here to do. What must stay absent is a COUNT of
     * nothing, so that is what this now says.
     */
    const words = said(paintDetail(task(), measure));
    expect(words).not.toContain("0 comment");
    expect(words).not.toContain("comments");
    expect(words).not.toContain("Blocked");
  });

  it("is deterministic", () => {
    expect(paintDetail(task(), measure)).toEqual(paintDetail(task(), measure));
  });
});

describe("closing it", () => {
  it("has a close control, and it says so in words", () => {
    // A bare glyph in a headset is a guess. The word costs nothing.
    expect(said(paintDetail(task(), measure))).toContain("close");
  });

  it("answers yes in the corner and no everywhere a person reads", () => {
    expect(isDetailClose({ x: 0.95, y: 0.95 })).toBe(true);
    for (const point of [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.95 }, { x: 0.95, y: 0.4 }, { x: 0, y: 0 }]) {
      expect(isDetailClose(point), `${point.x},${point.y} should not close it`).toBe(false);
    }
  });

  it("does not sit on top of the title", () => {
    // The corner is empty by construction, but the title is the one thing that
    // must never be under the close control — you would shut the panel trying
    // to read it.
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    const detail = paintDetail(task({ title: long }), measure);
    const titles = detail.filter((i) => i.kind === "text" && i.text.startsWith("word"));
    for (const item of titles) {
      const onCloseRow = item.y <= (1 - DETAIL_CLOSE.v0) * DETAIL_PX.height;
      const inCloseColumn = item.x >= DETAIL_CLOSE.u0 * DETAIL_PX.width;
      expect(onCloseRow && inCloseColumn).toBe(false);
    }
  });
});

describe("writing a comment on it", () => {
  it("offers it in words", () => {
    expect(said(paintDetail(task(), measure))).toContain("write a comment");
  });

  it("offers it even on a task nobody has said anything about", () => {
    // The empty case is exactly when somebody is most likely to be first.
    expect(said(paintDetail(task({ comments: [] }), measure))).toContain("write a comment");
  });

  it("answers along the bottom and nowhere else", () => {
    expect(isDetailComment({ x: 0.5, y: 0.02 })).toBe(true);
    expect(isDetailComment({ x: 0.02, y: 0.02 })).toBe(true);
    for (const point of [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.95 }, { x: 0.5, y: 0.2 }]) {
      expect(isDetailComment(point), `${point.x},${point.y}`).toBe(false);
    }
  });

  it("does not overlap the close control", () => {
    // Two controls sharing a pixel is one control nobody can reach.
    for (const uv of [{ x: 0.95, y: 0.95 }, { x: 0.5, y: 0.01 }]) {
      expect(isDetailClose(uv) && isDetailComment(uv)).toBe(false);
    }
  });
});

describe("moving it from the panel you pulled it off into", () => {
  const moves = ["in_progress", "blocked", "done"];
  const band = (DETAIL_MOVES.v0 + DETAIL_MOVES.v1) / 2;

  it("OFFERS THE MOVES, so reading a card and acting on it are one place", () => {
    // Pulling a card off to read it is exactly when you decide it is done, and
    // the only way to say so was to close the panel, find the card again among
    // six columns, and drag it.
    const words = said(paintDetail(task({ moves }), measure));
    expect(words).toContain("move it to");
    expect(words).toContain("Doing");
    expect(words).toContain("Done");
  });

  it("uses the board's words for a status, not the database's", () => {
    // "in_progress" is not what the column above the card says.
    const words = said(paintDetail(task({ moves: ["in_progress"] }), measure));
    expect(words).toContain("Doing");
    expect(words).not.toContain("in_progress");
  });

  it("finds the chip under a point, left to right", () => {
    expect(detailMoveAt({ x: 0.1, y: band }, moves)).toBe("in_progress");
    expect(detailMoveAt({ x: 0.5, y: band }, moves)).toBe("blocked");
    expect(detailMoveAt({ x: 0.9, y: band }, moves)).toBe("done");
  });

  it("answers nothing above or below the strip", () => {
    // The description is above it and the comment control is below.
    expect(detailMoveAt({ x: 0.5, y: 0.5 }, moves)).toBeNull();
    expect(detailMoveAt({ x: 0.5, y: 0.02 }, moves)).toBeNull();
  });

  it("is SILENT when there is nothing legal to do", () => {
    // A chip that refuses when pressed is worse than a chip that is not there.
    expect(detailMoveAt({ x: 0.5, y: band }, [])).toBeNull();
    expect(said(paintDetail(task({ moves: [] }), measure))).not.toContain("move it to");
  });

  it("does not overlap the comment strip or the close control", () => {
    const mid = { x: 0.5, y: band };
    expect(isDetailComment(mid)).toBe(false);
    expect(isDetailClose(mid)).toBe(false);
  });

  it("keeps its chips inside the panel however many there are", () => {
    for (const many of [["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d", "e"]]) {
      for (const item of paintDetail(task({ moves: many }), measure)) {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x).toBeLessThanOrEqual(DETAIL_PX.width);
        expect(item.y).toBeLessThanOrEqual(DETAIL_PX.height);
      }
    }
  });
});
