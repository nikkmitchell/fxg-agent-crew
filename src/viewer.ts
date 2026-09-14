import { ApiError } from "./api-request";

/** Who the server says this browser is. Defined here because `Viewer` is built
 * from it and the two would otherwise import each other. */
export type Session = { username: string; kind?: "human" | "agent" };

/**
 * Who the browser is, as four separate answers rather than two.
 *
 * `useSession` used to return `Session | null`, and null meant BOTH "nobody is
 * signed in" and "I could not find out" — it caught every error and returned
 * null with a comment saying that staying null "is honest: we do not know who
 * this is". Honest for a rail that draws a signed-out mark, and not honest
 * enough for a gate: a gate that treats null as signed-out puts a sign-in page
 * in front of a signed-in person the moment the network hiccups, and asks them
 * for a password because we could not reach our own server. That is the room's
 * own rule about not saying what we were not told, applied to the viewer.
 *
 * So `anonymous` is a THING THE SERVER SAID — a 401, which /bff/me returns with
 * code SESSION_EXPIRED and `reauth: true` — and `unreachable` is everything we
 * failed to establish. Only the first one is allowed to ask for a password.
 */
export type Viewer =
  | { status: "checking" }
  | { status: "signed-in"; session: Session }
  | { status: "anonymous" }
  | { status: "unreachable"; why: string };

/**
 * What a failed `/bff/me` means.
 *
 * THE FIRST READER OF `ApiError.reauth`, whose own comment says "Nothing reads
 * this yet. It is carried rather than dropped because the server goes to the
 * trouble of distinguishing 'your session expired' from 'you may not do that'".
 * This is that distinction being spent: the server's judgement that signing in
 * again would help is what decides whether we show a sign-in page, in
 * preference to our guess from the status number.
 */
export function viewerFromFailure(error: unknown): Viewer {
  if (error instanceof ApiError) {
    // 401 is the ordinary signed-out case. `reauth` is honoured on its own too,
    // so a server that starts saying "sign in again" with a different status
    // does not have to wait for this file to be updated.
    if (error.status === 401 || error.reauth) return { status: "anonymous" };
    // A refusal we did not expect on this route. The server's own sentence is
    // kept verbatim — it was written for a person — rather than replaced with
    // "something went wrong", which tells nobody what to do next.
    return { status: "unreachable", why: error.message };
  }
  // No status at all: DNS, TLS, offline, a proxy that never answered. We know
  // nothing about who this is, which is not the same as knowing they are out.
  return { status: "unreachable", why: "could not reach saha.ing" };
}

/**
 * What to say when a sign-in attempt is refused.
 *
 * Separated from the component so the wording is checkable without a DOM, and
 * separated from `viewerFromFailure` because the two answer different
 * questions: that one decides whether to ask, this one decides what to say when
 * the asking failed.
 */
export function signInRefusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_CREDENTIALS") {
      // NOT "invalid username or password". The account lives on WebHarness,
      // not here, and a person who has never had one needs to be told that
      // rather than left retrying a password that was never going to work.
      return "WebHarness did not accept that. These are your WebHarness credentials — the same ones the chat uses.";
    }
    if (error.retryable) {
      // Explicitly not about the password. Telling somebody their credentials
      // were wrong when the upstream was down is the same false statement as
      // showing a sign-in page to somebody already signed in.
      return "saha.ing could not reach WebHarness to check that. Your details were probably fine; try again shortly.";
    }
    return error.message;
  }
  return "Could not reach saha.ing to sign in.";
}

/** Whether the gate should stand in front of the app. */
export function mustSignIn(viewer: Viewer): boolean {
  return viewer.status === "anonymous";
}
