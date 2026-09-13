import { describe, expect, test } from "vitest";
import { SHOULDER_LIMIT, shoulderYaw, wrapAngle } from "./shoulder-turn";

const near = (a: number, b: number) => expect(wrapAngle(a - b)).toBeCloseTo(0, 10);

describe("shoulderYaw", () => {
  test("a glance leaves the shoulders alone", () => {
    expect(shoulderYaw(0, 0.5)).toBe(0);
    expect(shoulderYaw(0, -0.5)).toBe(0);
  });

  test("exactly at the limit is still a glance", () => {
    expect(shoulderYaw(0, SHOULDER_LIMIT)).toBe(0);
  });

  test("past the limit the body follows, and only by the excess", () => {
    // Head a quarter-turn beyond the limit: the body moves that quarter-turn
    // and no more, so the head ends up exactly at the limit rather than ahead.
    const head = SHOULDER_LIMIT + 0.4;
    const body = shoulderYaw(0, head);
    near(body, 0.4);
    near(wrapAngle(head - body), SHOULDER_LIMIT);
  });

  test("it follows the other way too", () => {
    const head = -SHOULDER_LIMIT - 0.4;
    const body = shoulderYaw(0, head);
    near(body, -0.4);
    near(wrapAngle(head - body), -SHOULDER_LIMIT);
  });

  test("looking straight behind you turns the body halfway, not all the way", () => {
    // The case Nikk described: head turned 180°. The body comes round far
    // enough that the head sits at its limit — it does not swing to face the
    // same way, which would look like the person spinning on the spot.
    const body = shoulderYaw(0, Math.PI);
    near(Math.abs(wrapAngle(Math.PI - body)), SHOULDER_LIMIT);
  });

  test("the wrap-around does not send the body the long way", () => {
    // Body just under a half-turn, head just over it: a few degrees apart.
    const body = shoulderYaw(Math.PI - 0.05, -Math.PI + 0.05);
    expect(body).toBe(Math.PI - 0.05);
  });

  test("a body already turned keeps its own frame of reference", () => {
    const body = shoulderYaw(1.2, 1.2 + SHOULDER_LIMIT + 0.3);
    near(body, 1.5);
  });
});

describe("wrapAngle", () => {
  test("brings any angle into one turn", () => {
    near(wrapAngle(Math.PI * 5), Math.PI);
    expect(wrapAngle(0)).toBe(0);
    expect(Math.abs(wrapAngle(Math.PI * 2))).toBeLessThan(1e-10);
  });
});
