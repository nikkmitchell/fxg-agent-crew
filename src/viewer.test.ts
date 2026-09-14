import { describe, expect, it } from "vitest";
import { ApiError } from "./api-request";
import { mustSignIn, signInRefusal, viewerFromFailure } from "./viewer";

/**
 * The rules the gate must not break.
 *
 * Asserted against the derivation rather than the DOM, because there is no
 * renderer configured in this suite. The gate's whole job is a decision, so the
 * decision is what is tested.
 */
describe("who the gate thinks the viewer is", () => {
  it("asks for a password when the server says the session is gone", () => {
    const viewer = viewerFromFailure(
      new ApiError("not signed in", 401, "SESSION_EXPIRED", true),
    );
    expect(viewer).toEqual({ status: "anonymous" });
    expect(mustSignIn(viewer)).toBe(true);
  });

  it("DOES NOT ask for a password when it simply could not reach the server", () => {
    // The whole reason this module exists. A network failure used to be
    // indistinguishable from being signed out, and a gate built on that would
    // demand a password from somebody already signed in every time the wifi
    // dropped — then send them to WebHarness to fix a problem that was ours.
    const viewer = viewerFromFailure(new TypeError("Failed to fetch"));
    expect(viewer.status).toBe("unreachable");
    expect(mustSignIn(viewer)).toBe(false);
  });

  it("does not ask for a password when our own server is broken", () => {
    const viewer = viewerFromFailure(
      new ApiError("upstream unavailable", 502, "UPSTREAM_UNAVAILABLE"),
    );
    expect(viewer.status).toBe("unreachable");
    expect(mustSignIn(viewer)).toBe(false);
  });

  it("honours the server's own reauth judgement, not just the status number", () => {
    // `reauth` is the server saying "signing in again would help". If it ever
    // says that with a status other than 401, the gate should listen rather
        // than wait for this file to be taught the new number.
    const viewer = viewerFromFailure(new ApiError("token rejected", 419, "SESSION_EXPIRED", true));
    expect(viewer).toEqual({ status: "anonymous" });
  });

  it("keeps the server's sentence when it cannot act on the refusal", () => {
    // The sentence was written for a person and says what to do next.
    const viewer = viewerFromFailure(new ApiError("this host is being drained", 503, "DRAINING"));
    expect(viewer).toEqual({ status: "unreachable", why: "this host is being drained" });
  });

  it("says it could not reach us when there is no status at all", () => {
    expect(viewerFromFailure(new TypeError("NetworkError"))).toEqual({
      status: "unreachable",
      why: "could not reach saha.ing",
    });
  });
});

describe("what a refused sign-in says", () => {
  it("names WebHarness as where the account lives", () => {
    // Somebody who has never had a WebHarness account needs telling that,
    // rather than being left retrying a password that never existed.
    const said = signInRefusal(new ApiError("invalid credentials", 401, "INVALID_CREDENTIALS", true));
    expect(said).toMatch(/WebHarness/);
  });

  it("does not blame the password when the upstream was down", () => {
    // Saying "wrong password" when WebHarness was unreachable is a false
    // statement about the person, and they will act on it.
    const said = signInRefusal(new ApiError("upstream unavailable", 502, "UPSTREAM_UNAVAILABLE"));
    expect(said).not.toMatch(/did not accept/);
    expect(said).toMatch(/could not reach WebHarness/);
  });

  it("passes through a refusal it has no special wording for", () => {
    expect(signInRefusal(new ApiError("that account is suspended", 403, "SUSPENDED")))
      .toBe("that account is suspended");
  });

  it("says something useful when the fetch itself failed", () => {
    expect(signInRefusal(new TypeError("Failed to fetch"))).toMatch(/could not reach saha\.ing/i);
  });
});
