import { base } from "./router";

/**
 * Reload the page when the server is running a newer build.
 *
 * Nikk, from a headset: "is it possible to force an auto refresh... when the
 * servers restarted... and then everyone will be up to speed and we won't have
 * to... go and refresh". Every deploy ended with "reload to get it", and a
 * headset is the worst place to be asked to reload.
 *
 * WHAT COUNTS AS NEWER. `/bff/build` names the commit the release script
 * deployed. The page remembers the first one it sees and reloads when that
 * changes. A server not started by the release script reports no commit, so a
 * development server never reloads anybody.
 *
 * NOT WHILE SOMEBODY IS MID-SENTENCE. A reload throws away a recording in
 * progress and anything typed and not sent, and losing what somebody said is
 * worse than running yesterday's page for another minute. So it waits while:
 *   - something has called `holdReload` — the microphone, while recording
 *   - any text field holds an edit: its value differs from what it loaded with
 * A page nobody is looking at reloads at once; it has nothing to lose.
 */

const holds = new Set<string>();

/** Keep the page from reloading while `on` — e.g. while the mic is recording. */
export function holdReload(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else holds.delete(reason);
}

export type ReloadState = {
  /** The commit this page loaded against, or null if the server did not say. */
  loadedWith: string | null;
  /** The commit the server reports now. */
  serverHas: string | null;
  held: boolean;
  unsentText: boolean;
  hidden: boolean;
};

export function reloadDecision(state: ReloadState): "reload" | "wait" | "nothing" {
  if (!state.loadedWith || !state.serverHas || state.loadedWith === state.serverHas) return "nothing";
  if (state.hidden) return "reload";
  return state.held || state.unsentText ? "wait" : "reload";
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

const CHECK_MS = 15_000;
const RETRY_WHILE_WAITING_MS = 2_000;

export function startUpdateReload(options: {
  fetchCommit?: () => Promise<string | null>;
  reload?: () => void;
} = {}): () => void {
  const fetchCommit = options.fetchCommit ?? (async () => {
    const response = await fetch(`${base}/bff/build`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { commit?: string | null };
    return body.commit ?? null;
  });
  const reload = options.reload ?? (() => window.location.reload());
  let loadedWith: string | null = null;
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
      // Signed out, or a server with no record: nothing to compare against.
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
      unsentText: hasUnsentText(textFieldsOnPage()),
      hidden: document.visibilityState === "hidden",
    });
    if (decision === "reload") {
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
