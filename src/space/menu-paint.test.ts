import { describe, expect, it } from "vitest";
import { wrapTwo } from "./menu-paint";

/** Ten pixels a character: easy to reason about widths. */
const measure = (text: string) => text.length * 10;

describe("menu labels wrap to a second line instead of an ellipsis (Nikk 7447)", () => {
  it("keeps a label that fits on one line", () => {
    expect(wrapTwo(measure, "Review Studio", 200)).toEqual(["Review Studio"]);
  });

  it("puts the rest on a second line, words whole", () => {
    // Nikk's screenshot: "Review Studio · main: f..." was cut on one line.
    expect(wrapTwo(measure, "Review Studio · main: feature", 200)).toEqual(["Review Studio ·", "main: feature"]);
  });

  it("breaks a word wider than the line between letters, and loses none of it", () => {
    const lines = wrapTwo(measure, "branch:review-support-and-more", 150);
    expect(lines).toEqual(["branch:review-s", "upport-and-more"]);
    expect(lines.join("")).toBe("branch:review-support-and-more");
  });

  it("ends the second line in an ellipsis only when two lines are not enough", () => {
    const lines = wrapTwo(measure, "one two three four five six seven", 100);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines.every((line) => measure(line) <= 100)).toBe(true);
  });
});
