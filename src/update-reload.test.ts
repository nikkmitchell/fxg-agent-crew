import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasUnsentText, holdReload, reloadDecision, startUpdateReload, updateWaiting } from "./update-reload";

const state = (over: Partial<Parameters<typeof reloadDecision>[0]> = {}) => ({
  loadedWith: "aaa", serverHas: "aaa", held: false, unsentText: false, hidden: false, ...over,
});

describe("reloading after a deploy", () => {
  it("does nothing while the server runs the build this page loaded with", () => {
    expect(reloadDecision(state())).toBe("nothing");
  });

  it("reloads once the server runs a newer build", () => {
    // Nikk: "can we have it do a forced reset and then everyone will be up to speed".
    expect(reloadDecision(state({ serverHas: "bbb" }))).toBe("reload");
  });

  it("never reloads against a server that does not say which build it runs", () => {
    // A development server: no DEPLOYED_COMMIT, no commit, no reload loop.
    expect(reloadDecision(state({ loadedWith: null, serverHas: null }))).toBe("nothing");
  });

  it("waits while the microphone is recording, rather than throwing away what is being said", () => {
    expect(reloadDecision(state({ serverHas: "bbb", held: true }))).toBe("wait");
  });

  it("waits while a message has been typed and not sent", () => {
    expect(reloadDecision(state({ serverHas: "bbb", unsentText: true }))).toBe("wait");
  });

  it("reloads a page nobody is looking at, even mid-recording", () => {
    // A page that has gone away is not recording anything anybody is still saying.
    expect(reloadDecision(state({ serverHas: "bbb", held: true, hidden: true }))).toBe("reload");
  });

  it("keeps written words even on a page nobody is looking at", () => {
    // Typed half a message, took the headset off, came back to an empty box:
    // that is losing somebody's words, whether they were watching or not.
    expect(reloadDecision(state({ serverHas: "bbb", unsentText: true, hidden: true }))).toBe("wait");
  });
});

describe("noticing unsent text", () => {
  const field = (over: Record<string, unknown> = {}) => ({
    tagName: "TEXTAREA", type: "textarea", value: "", defaultValue: "", disabled: false, readOnly: false, ...over,
  });

  it("sees a field somebody has typed into", () => {
    expect(hasUnsentText([field(), field({ tagName: "INPUT", type: "text" })])).toBe(false);
    expect(hasUnsentText([field({ value: "please deploy" })])).toBe(true);
  });

  it("does not mistake a form that loaded with saved text for an unsent edit", () => {
    // The profile form's bio loads filled in; that is not something to lose.
    expect(hasUnsentText([field({ value: "my saved bio", defaultValue: "my saved bio" })])).toBe(false);
  });

  it("sees a draft in a field React controls, where the loaded value moves with the text", () => {
    // React keeps defaultValue equal to value for these, so comparing the two
    // reloaded over a typed message.
    expect(hasUnsentText([field({ value: "please deploy", defaultValue: "please deploy", controlled: true })])).toBe(true);
    expect(hasUnsentText([field({ value: "", defaultValue: "", controlled: true })])).toBe(false);
  });

  it("ignores checkboxes, and fields nobody can type in", () => {
    expect(hasUnsentText([field({ tagName: "INPUT", type: "checkbox", value: "on" })])).toBe(false);
    expect(hasUnsentText([field({ value: "shown, not editable", readOnly: true })])).toBe(false);
  });
});

describe("offering a new version instead of forcing it", () => {
  /**
   * Nikk spent ninety minutes in a headset without receiving the fix for the
   * bug he was reporting, because a live session is never reloaded from under
   * its wearer. The poller has to SAY a version is waiting so the menu can
   * offer it.
   *
   * The page's globals are stubbed rather than jsdom'd: this file is otherwise
   * pure, and the poller only needs a page that has no text fields and is
   * visible.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      querySelectorAll: () => [],
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says a version is waiting only while something holds the reload back", async () => {
    let commit = "aaa";
    let reloaded = false;
    holdReload("xr-session", true);
    const stop = startUpdateReload({ fetchCommit: async () => commit, reload: () => { reloaded = true; } });
    await vi.advanceTimersByTimeAsync(1);
    expect(updateWaiting(), "same build, nothing waiting").toBe(false);

    commit = "bbb";
    await vi.advanceTimersByTimeAsync(16_000);
    expect(updateWaiting(), "a newer build, held by the session").toBe(true);
    expect(reloaded, "and not taken from under the wearer").toBe(false);

    holdReload("xr-session", false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reloaded, "the session ended, so it reloads").toBe(true);
    expect(updateWaiting(), "nothing is waiting once it has been taken").toBe(false);
    stop();
  });
});
