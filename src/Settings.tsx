import { ProjectChooser } from "./ProjectChooser";

/**
 * Settings, which for now is one thing: which project the board tabs show.
 *
 * It moved here because it is a setting, not a task. It used to be a dropdown
 * at the top of the Board tab, where it took a line of the page on every visit
 * to answer a question most people answer once a day.
 *
 * THE RISK OF MOVING IT is that it becomes unfindable, so the rail button
 * carries the project's NAME rather than only a cog — you can see what is
 * selected without opening anything, which is most of what the old dropdown was
 * actually for.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  return (
    <aside className="settings-panel" aria-label="Settings">
      <header>
        <h2>Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">×</button>
      </header>
      <ProjectChooser />
    </aside>
  );
}
