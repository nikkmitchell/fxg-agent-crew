import { base } from "./router";

/**
 * Reload the page when the server is running a newer build.
 *
 * Nikk, from a headset: "is it possible to force an auto refresh... when the
 * servers restarted... and then everyone will be up to speed and we won't have
 * to... go and refresh". Every deploy ended with "reload to get it", and a
 * headset is the worst place to be asked to reload.
 *
 * WHAT COUNTS AS NEWER: THE PAGE ITSELF. The hashed files index.html loads
 * (`/assets/index-…js` and the rest) change exactly when the page's code does.
 * The page remembers the first set it sees and reloads when that changes. A
 * development server serves source, not hashed assets, so it never reloads
 * anybody.
 *
 * It asked `/bff/build` for the deployed commit until 2026-10-20. That needs a
 * session, so a signed-out page (the sign-in page left open, a visitor) got a
 * 401 every 15 seconds for ever (1,278 in four days) and never reloaded at all,
 * and a deploy that changed only the server reloaded every headset for nothing.
 *
 * NOT WHILE SOMEBODY IS MID-SENTENCE. A reload throws away a recording in
 * progress and anything typed and not sent, and losing what somebody said is
 * worse than running yesterday's page for another minute. So it waits while:
 *   - something has called `holdReload` — the microphone, while recording
 *   - any text field holds an edit: its value differs from what it loaded with
 *   - something has called `holdDraft` — the headset keyboard, holding words
 *     that live in no text box on the page
 *
 * A PAGE NOBODY IS LOOKING AT reloads while the microphone is held, because a
 * page that has gone away is not recording anything anybody is still saying.
 * Written words are the exception: a draft outlives the tab being hidden, and
 * somebody who typed half a message, took the headset off and came back to an
 * empty box would rightly call that losing their words.
 *
 * AND A LIVE HEADSET SESSION IS THE OTHER EXCEPTION — the one this had wrong,
 * and it threw somebody out of the room every time they tried to type.
 *
 * Baiwei, testing the headset keyboard: every tap on the text box dropped him
 * out of the room. The keyboard was innocent and so was the input; the sequence
 * was this. Quest Browser shows its system keyboard, THE DOCUMENT GOES HIDDEN,
 * `visibilitychange` schedules a check 500 ms later, the check finds the newer
 * build every one of today's deploys left waiting — and a hidden page reloads,
 * holds and all. A reload ends an immersive session. The room disappears, and
 * from inside the headset it looks exactly like being kicked out for typing.
 *
 * "Hidden" was standing in for "nobody is there", and in a headset that is
 * simply not what it means: the document can go hidden while the wearer is
 * standing in the room looking at it. So a session beats hiding. Nothing
 * reloads a page that is presenting a session to somebody, for any reason, and
 * `updateWaiting` offers them the new build instead.
 */

const holds = new Set<string>();
const drafts = new Set<string>();
const sessions = new Set<string>();

/**
 * WHETHER A NEW VERSION IS WAITING, for anybody who needs to offer it.
 *
 * A headset session is never reloaded from under its wearer (see the
 * "xr-session" hold), and the consequence took an afternoon to show itself:
 * Nikk stayed in the headset for an hour and a half and therefore never
 * received three fixes that were live the whole time, including the one for
 * the bug he kept reporting. Holding the reload was right; leaving him with no
 * way to take it was not.
 *
 * So the poller publishes what it knows and the headset menu offers a row.
 * Taking it is the wearer's choice, at a moment of their choosing.
 */
const watchers = new Set<(waiting: boolean) => void>();
let waiting = false;

export function updateWaiting(): boolean {
  return waiting;
}

export function watchUpdate(listener: (waiting: boolean) => void): () => void {
  watchers.add(listener);
  listener(waiting);
  return () => watchers.delete(listener);
}

function setWaiting(next: boolean): void {
  if (waiting === next) return;
  waiting = next;
  for (const listener of watchers) listener(next);
}

/** Reload now, whoever is asking. The one place that decides how. */
export function reloadNow(): void {
  window.location.reload();
}

/** Keep the page from reloading while `on` — e.g. while the mic is recording. */
export function holdReload(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else holds.delete(reason);
}

/**
 * Words somebody has written and not sent that are in no text box on the page —
 * the headset keyboard's draft. Kept like typed text, not like a recording.
 */
export function holdDraft(reason: string, on: boolean): void {
  if (on) drafts.add(reason);
  else drafts.delete(reason);
}

/**
 * A session being presented to somebody — a headset in the room.
 *
 * Stronger than `holdReload`, and the difference is the whole of the bug above:
 * this one also beats a hidden page, because a reload ENDS a session and a
 * hidden document does not mean an empty headset.
 */
export function holdSession(reason: string, on: boolean): void {
  if (on) sessions.add(reason);
  else sessions.delete(reason);
}

/**
 * Whether a headset session is being presented on this page.
 *
 * Read by the panel's voice so it does not speak over the immersive room's:
 * `SpacePanel` renders `VoiceControls` unconditionally and `RoomControls`
 * mounts inside the session, so during a headset session BOTH are alive and
 * both were reading utterances aloud. That was survivable while only lines
 * addressed to you were spoken; now that the room is audible to everybody it
 * would be a double on every line.
 */
export function inSession(): boolean {
  return sessions.size > 0;
}

export type ReloadState = {
  /** The commit this page loaded against, or null if the server did not say. */
  loadedWith: string | null;
  /** The commit the server reports now. */
  serverHas: string | null;
  held: boolean;
  unsentText: boolean;
  hidden: boolean;
  /** A session is being presented to somebody: a headset is in the room. */
  inSession?: boolean;
};

export function reloadDecision(state: ReloadState): "reload" | "wait" | "nothing" {
  if (!state.loadedWith || !state.serverHas || state.loadedWith === state.serverHas) return "nothing";
  // Before the hidden check, deliberately: a reload ends the session, and the
  // document goes hidden while the wearer is still standing in the room.
  if (state.inSession) return "wait";
  if (state.unsentText) return "wait";
  if (state.hidden) return "reload";
  return state.held ? "wait" : "reload";
}

export type TextField = {
  tagName: string;
  type?: string;
  value: string;
  defaultValue: string;
  disabled: boolean;
  readOnly: boolean;
  /** Whether React drives this field's value (a `value` prop) rather than the DOM. */
  controlled?: boolean;
};

/**
 * Whether any text field holds something somebody typed and has not sent.
 *
 * TWO KINDS OF FIELD. A plain form field is compared with the value it LOADED
 * with, not with empty: the profile form opens with a saved bio in it, and
 * that is not something to lose. A field React controls cannot be read that
 * way — React keeps `defaultValue` in step with `value` as you type, so the
 * comparison always said "nothing unsent", and the first version of this
 * reloaded straight over a typed message in the harness. Every controlled field
 * here is a draft that starts empty and empties on send, so for those, any
 * text at all is unsent.
 */
export function hasUnsentText(fields: Iterable<TextField>): boolean {
  for (const field of fields) {
    if (field.tagName === "INPUT" && !["text", "search", "url", "email", ""].includes(field.type ?? "")) continue;
    if (field.disabled || field.readOnly) continue;
    if (field.controlled ? field.value.trim() !== "" : field.value !== field.defaultValue) return true;
  }
  return false;
}

/** React records a node's current props under a `__reactProps$…` key. */
const isControlled = (node: Element): boolean => {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactProps$")) {
      const props = (node as unknown as Record<string, { value?: unknown } | undefined>)[key];
      return props?.value !== undefined;
    }
  }
  return false;
};

const textFieldsOnPage = (): TextField[] =>
  Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input"), (node) => ({
    tagName: node.tagName,
    type: node.type,
    value: node.value,
    defaultValue: node.defaultValue,
    disabled: node.disabled,
    readOnly: node.readOnly,
    controlled: isControlled(node),
  }));

/**
 * Which build a copy of index.html loads: its hashed script and stylesheet
 * files, in order. null when it loads none, which is a development server.
 */
export function buildOfPage(html: string): string | null {
  // Only this site's own files: a path from the root (under any base path), never another
  // origin or a scheme. A browser extension that puts its own …/assets/x.js into the head
  // must not make the page look like a different build (Nightjar's review, 2026-10-22).
  const files = [...html.matchAll(/(?:src|href)=["'](\/(?!\/)(?:[^"':]*\/)?assets\/[^"':]+\.(?:js|css))["']/g)].map((found) => found[1]!);
  return files.length > 0 ? [...new Set(files)].sort().join(" ") : null;
}

/**
 * THE BUILD THIS DOCUMENT WAS SERVED WITH, read when this module first runs.
 *
 * It used to be whatever the first check fetched, which is the server's build
 * at that moment, not the page's. A tab the browser brought back from its cache
 * days later (Baiwei's and Nikk's, 2026-10-22, running a build from 10-12)
 * fetched today's page, took today's build as its own, and never reloaded. Its
 * room chunk had been pruned after a week, so the room failed to load:
 * "Failed to fetch dynamically imported module".
 *
 * Read at module evaluation, before anything renders: a lazy import adds
 * modulepreload and stylesheet links to the head, and those are not in the
 * served page, so reading the head later would differ from the server's copy
 * of the same build.
 */
const SERVED_WITH = typeof document !== "undefined" && document.documentElement
  ? buildOfPage(document.documentElement.outerHTML)
  : null;

/**
 * ONE AUTOMATIC RELOAD PER BUILD. If a page reloaded for a build and still does
 * not match it (a proxy serving a stale index.html, or the document read wrong),
 * reloading again would loop for ever. The second time it offers the update
 * instead, like a headset does.
 */
const TRIED_KEY = "saha.update-reload.tried";
const triedBefore = (build: string): boolean => {
  try { return sessionStorage.getItem(TRIED_KEY) === build; } catch { return false; }
};
/**
 * Whether the try was written down. If it cannot be (storage refused), nothing
 * would stop the reloaded page reloading again, so the caller offers instead
 * (Mica's review, 2026-10-22: 3 reloads out of 3 with storage denied).
 */
const markTried = (build: string): boolean => {
  try {
    sessionStorage.setItem(TRIED_KEY, build);
    return sessionStorage.getItem(TRIED_KEY) === build;
  } catch {
    return false;
  }
};

const CHECK_MS = 15_000;
const RETRY_WHILE_WAITING_MS = 2_000;

export function startUpdateReload(options: {
  fetchCommit?: () => Promise<string | null>;
  reload?: () => void;
  /** The build this page runs; read from the served document unless a test says. */
  pageBuild?: string | null;
} = {}): () => void {
  const fetchCommit = options.fetchCommit ?? (async () => {
    // The page as the server would serve it now: public, so signed out works too.
    const response = await fetch(`${base}/`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    return buildOfPage(await response.text());
  });
  const reload = options.reload ?? (() => window.location.reload());
  // null on a development server, and then the first check's answer stands in.
  let loadedWith: string | null = options.pageBuild !== undefined ? options.pageBuild : SERVED_WITH;
  let serverHas: string | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), ms);
  };

  const check = async () => {
    try {
      const commit = await fetchCommit();
      // A development server: nothing to compare against.
      if (commit) {
        loadedWith ??= commit;
        serverHas = commit;
      }
    } catch {
      // The server restarting is exactly when this fails. Try again shortly.
    }
    const decision = reloadDecision({
      loadedWith,
      serverHas,
      held: holds.size > 0,
      unsentText: drafts.size > 0 || hasUnsentText(textFieldsOnPage()),
      hidden: document.visibilityState === "hidden",
      inSession: sessions.size > 0,
    });
    // Already reloaded once for this build and still behind it, or unable to write the
    // try down so that the next page could tell: offer, never loop.
    const looping = decision === "reload" && serverHas !== null && (triedBefore(serverHas) || !markTried(serverHas));
    // "wait" means there IS a newer build and something is holding it back.
    setWaiting(decision === "wait" || looping);
    if (decision === "reload" && !looping) {
      stopped = true;
      reload();
      return;
    }
    schedule(decision === "wait" ? RETRY_WHILE_WAITING_MS : CHECK_MS);
  };

  // Soon after the page comes back into view or back online — which is when
  // somebody who took the headset off returns to a room that was redeployed.
  const soon = () => schedule(500);
  document.addEventListener("visibilitychange", soon);
  window.addEventListener("online", soon);
  void check();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", soon);
    window.removeEventListener("online", soon);
  };
}
