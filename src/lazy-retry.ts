import { lazy, type ComponentType } from "react";

/**
 * A PART OF THE PAGE FETCHED WHEN FIRST NEEDED, ASKED FOR AGAIN IF THE FETCH
 * DROPS. Where our people are, a request can be reset or lost on the way, and
 * a lazily loaded chunk that did not arrive failed for good: Nikk's room page
 * went to the whole-app error screen because the headset controls' chunk did
 * not arrive (client error log, 2026-10-12).
 *
 * ASKING THE SAME ADDRESS AGAIN DOES NOTHING. The browser remembers a module
 * that failed to load and fails every later import of it at once, without a
 * request (measured in Chrome: one request, however many retries). So a retry
 * asks for the file the error names under a slightly different address,
 * `?retry=1`, which the browser treats as a new module and fetches.
 *
 * The parts that use this also have an error boundary of their own, so giving
 * up costs that part, not the page.
 */
const FAILED_MODULE = /Failed to fetch dynamically imported module:\s*(\S+)|error loading dynamically imported module:\s*(\S+)|Importing a module script failed/i;

export function failedModuleUrl(error: unknown): string | null {
  const match = error instanceof Error ? FAILED_MODULE.exec(error.message) : null;
  const url = match?.[1] ?? match?.[2] ?? null;
  return url && /^https?:\/\//.test(url) ? url : null;
}

const withRetry = (url: string, attempt: number) => `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}`;

export function retrying<T>(
  load: () => Promise<T>,
  options: { waits?: readonly number[]; pick?: (module: Record<string, unknown>) => T; importUrl?: (url: string) => Promise<Record<string, unknown>> } = {},
): () => Promise<T> {
  const waits = options.waits ?? [600, 2000];
  const importUrl = options.importUrl ?? ((url: string) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>);
  const pick = options.pick ?? ((module: Record<string, unknown>) => module as T);
  return async () => {
    let failed: string | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return failed ? pick(await importUrl(withRetry(failed, attempt))) : await load();
      } catch (error) {
        if (attempt >= waits.length) throw error;
        failed = failedModuleUrl(error) ?? failed;
        await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
      }
    }
  };
}

/** React.lazy over `retrying`. `pick` turns the module the file holds into { default: Component }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetrying<C extends ComponentType<any>>(load: () => Promise<{ default: C }>, pick?: (module: Record<string, unknown>) => { default: C }) {
  return lazy(retrying(load, { pick }));
}
