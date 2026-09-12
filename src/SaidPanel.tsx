import { useEffect, useState } from "react";
import { Transcript } from "./space/Transcript";
import { space } from "./space-client";
import type { Utterance } from "../shared/voice";

/**
 * The room's conversation, on its own page.
 *
 * WHY IT IS NOT THE ROOM'S RAIL. This is what hangs on the arc as the Chat
 * panel, and a panel is an iframe of this app: if it opened the presence socket
 * the way the rail does, it would join the room as a second copy of you — two
 * occupants with one name, fighting over one position. So it reads the durable
 * record over HTTP instead, which is the same rows the socket broadcasts.
 *
 * POLLED, not pushed, and the delay is stated on the page. Six seconds is slow
 * enough to cost nothing and fast enough that you can watch something you just
 * said arrive — which is the entire reason this panel exists.
 */
const EVERY_MS = 6_000;
const KEEP = 60;

export function SaidPanel() {
  const [heard, setHeard] = useState<Utterance[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    const read = async () => {
      try {
        const body = await space.said(KEEP);
        if (stopped) return;
        setFailed(false);
        // Oldest first: the server hands back newest-first because that is the
        // cheap query, and a conversation reads downward.
        setHeard([...body.utterances].reverse());
      } catch {
        // KEEP WHAT WE HAVE and say the reading stopped. Blanking the panel on
        // one failed poll would look like everybody had gone quiet, which is a
        // different and much more alarming thing than a dropped request.
        if (!stopped) setFailed(true);
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="said-panel">
      {heard === null && !failed ? <p className="muted-note">Reading the room…</p> : null}
      {heard !== null ? (
        <Transcript
          heard={heard}
          emptyNote="Nothing has been said in the room yet. What you say there arrives here."
        />
      ) : null}
      {failed ? (
        <p className="muted-note">
          {heard === null
            ? "The conversation could not be read."
            : "Showing the last of it: the room stopped answering, so this may be behind."}
        </p>
      ) : (
        <p className="muted-note">Re-read every {EVERY_MS / 1000} seconds.</p>
      )}
    </section>
  );
}
