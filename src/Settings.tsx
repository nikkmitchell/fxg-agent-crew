import { useState } from "react";
import { bff } from "./bff-client";
import { MyScreenSettings } from "./MyScreenSettings";
import { ProjectChooser } from "./ProjectChooser";

/**
 * Settings: who you are signed in as, Me (my screen), and which project the
 * board tabs show.
 *
 * It moved here because it is a setting, not a task. It used to be a dropdown
 * at the top of the Board tab, where it took a line of the page on every visit
 * to answer a question most people answer once a day.
 *
 * THE RISK OF MOVING IT is that it becomes unfindable, so the rail button
 * carries the project's NAME rather than only a cog — you can see what is
 * selected without opening anything, which is most of what the old dropdown was
 * actually for.
 *
 * SIGN OUT LIVES HERE (Nikk, 2026-10-14). The site had none: the only one was
 * inside the chat overlay, so somebody who wanted to switch accounts, or whose
 * WebHarness sign-in had expired, had no way out short of clearing cookies.
 */
export function Settings({ you, onClose, onSignedOut }: { you: string | null; onClose: () => void; onSignedOut: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const signOut = async () => {
    setLeaving(true);
    setTrouble(null);
    try {
      await bff.logout();
      onSignedOut();
    } catch {
      setLeaving(false);
      setTrouble("saha.ing did not answer, so you are still signed in. Try again.");
    }
  };
  return (
    <aside className="settings-panel" aria-label="Settings">
      <header>
        <h2>Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">×</button>
      </header>
      {you ? (
        <div className="settings-account">
          <p>Signed in as <strong>{you}</strong></p>
          <button type="button" onClick={() => void signOut()} disabled={leaving}>{leaving ? "Signing out…" : "Sign out"}</button>
          {trouble ? <p className="muted-note" role="alert">{trouble}</p> : null}
        </div>
      ) : null}
      <MyScreenSettings you={you} />
      <ProjectChooser />
    </aside>
  );
}
