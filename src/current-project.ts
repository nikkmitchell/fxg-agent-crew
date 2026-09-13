import { useEffect, useState } from "react";

/**
 * Which project the board tabs are showing.
 *
 * ONE VALUE, IN ONE PLACE. It used to live in ProjectWorkspace's own state,
 * which was fine while the only way to change it was a dropdown inside that
 * component. It is now changed from Settings, in the rail, which is a different
 * part of the tree — and two copies of "the current project" is the kind of
 * thing that shows up as the Board tab and the Mood boards tab disagreeing
 * about which project you are looking at.
 *
 * Deliberately not a context or a store library: it is one string, and the
 * subscription is four lines.
 */

const KEY = "saha-project";

const listeners = new Set<(id: string) => void>();

/**
 * A project named in the URL wins, for this page only.
 *
 * WHY THIS EXISTS: the room shows the same project to everybody in it, and the
 * room's panels are iframes of these very tabs. Without this, a panel would
 * show whatever the VIEWER last picked at their own desk — so two people
 * standing at the same wall would see different boards on it, which is the one
 * thing the shared choice exists to prevent.
 *
 * NOT WRITTEN BACK TO localStorage, deliberately. Being shown a project in the
 * room is not the same as choosing it, and having the room quietly rewrite
 * somebody's own setting would mean leaving the room changed what their desk
 * shows. Read `?project=` as "show me this now", not "this is my choice".
 */
function projectInUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("project");
  } catch {
    return null;
  }
}

export function currentProject(): string {
  const named = projectInUrl();
  if (named) return named;
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    // A browser with site data blocked. The tabs still work; the choice just
    // does not survive a reload, which is better than refusing to render.
    return "";
  }
}

export function chooseProject(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // See above. The in-memory value below is what this session actually uses.
  }
  for (const listener of listeners) listener(id);
}

/** The current project, re-rendering whoever asked when it changes. */
export function useCurrentProject(): [string, (id: string) => void] {
  const [id, setId] = useState(currentProject);
  useEffect(() => {
    listeners.add(setId);
    // Another tab of the same site changing it. Without this, two windows drift
    // apart and each insists it is right.
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setId(event.newValue ?? "");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setId);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [id, chooseProject];
}
