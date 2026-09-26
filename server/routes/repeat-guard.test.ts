import { describe, expect, it } from "vitest";
import { RepeatGuard, repeatKey } from "./repeat-guard.js";

/** 4962/4965 and 4963/4964: the same words, posted twice, by accident. */
describe("the same words, once", () => {
  const key = repeatKey("Nikk2", "saha.ing", "hello");

  it("posts once and answers a repeat within the window with the first result", async () => {
    let clock = 0, posts = 0;
    const guard = new RepeatGuard<string>(() => clock);
    const send = async () => `message ${++posts}`;
    expect(await guard.once(key, send)).toEqual({ result: "message 1", repeated: false });
    clock = 60_000;
    expect(await guard.once(key, send)).toEqual({ result: "message 1", repeated: true });
    expect(posts).toBe(1);
  });

  it("lets it through again once the window has passed: saying it twice on purpose still works", async () => {
    let clock = 0, posts = 0;
    const guard = new RepeatGuard<string>(() => clock);
    await guard.once(key, async () => `m${++posts}`);
    clock = 91_000;
    await guard.once(key, async () => `m${++posts}`);
    expect(posts).toBe(2);
  });

  it("a second copy that arrives while the first is still going waits for it, not a second post", async () => {
    let release!: (value: string) => void, posts = 0;
    const guard = new RepeatGuard<string>(() => 0);
    const first = guard.once(key, () => { posts++; return new Promise<string>((resolve) => { release = resolve; }); });
    const second = guard.once(key, async () => { posts++; return "second"; });
    release("first");
    expect(await first).toEqual({ result: "first", repeated: false });
    expect(await second).toEqual({ result: "first", repeated: true });
    expect(posts).toBe(1);
  });

  it("a repeat after a FAILED post is a real retry and goes through", async () => {
    let posts = 0;
    const guard = new RepeatGuard<string>(() => 0);
    await expect(guard.once(key, async () => { posts++; throw new Error("502"); })).rejects.toThrow("502");
    expect(await guard.once(key, async () => { posts++; return "retried"; })).toEqual({ result: "retried", repeated: false });
    expect(posts).toBe(2);
  });

  it("is per person, per room, per exact words", () => {
    expect(repeatKey("Nikk2", "saha.ing", "hi")).not.toBe(repeatKey("baiwei2", "saha.ing", "hi"));
    expect(repeatKey("Nikk2", "saha.ing", "hi")).not.toBe(repeatKey("Nikk2", "meditation.AR", "hi"));
    expect(repeatKey("Nikk2", "saha.ing", "hi")).not.toBe(repeatKey("Nikk2", "saha.ing", "hi!"));
  });
});
