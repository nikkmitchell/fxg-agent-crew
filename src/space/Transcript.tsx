import type { Utterance } from "../../shared/voice";

/**
 * What has been said in the room.
 *
 * SHARED BY THE RAIL AND BY THE CHAT PANEL, which is why it lives in its own
 * file. The rail feeds it from the live socket; the panel feeds it from the
 * durable record over HTTP, because a panel is an iframe and an iframe opening
 * its own presence socket would put a second copy of you in the room.
 */
export function Transcript({
  heard,
  emptyNote,
}: {
  heard: Utterance[];
  /** Shown instead of nothing when there is nothing. Omit to render nothing. */
  emptyNote?: string;
}) {
  if (heard.length === 0) return emptyNote ? <p className="muted-note">{emptyNote}</p> : null;
  // Newest last, like a conversation. The list is capped upstream.
  return (
    <section className="space-transcript" aria-label="What has been said">
      <h2>Said</h2>
      <ol>
        {heard.map((utterance) => (
          <li key={utterance.id}>
            <p>
              <strong>{utterance.actorId}</strong>
              {utterance.to ? <span className="space-said-to"> to {utterance.to}</span> : null}
              {/* A transcript is a GUESS about what somebody said, and typed
                  text is not. Marked, so a reader can tell which they are
                  reading rather than having to assume. */}
              {utterance.source === "voice" ? (
                // "voice", not "heard". Inkstone's review: heard describes what
                // the LISTENER did, and the thing being marked is where the
                // words came from. When recognition gave a confidence it is
                // shown outright rather than hidden in a tooltip — a transcript
                // the machine was 62% sure of is worth reading differently.
                <span
                  className="space-said-heard"
                  title="Transcribed from a microphone, so it is a guess at what was said"
                >
                  {utterance.confidence === null
                    ? "voice"
                    : `voice ${Math.round(utterance.confidence * 100)}%`}
                </span>
              ) : null}
            </p>
            {utterance.say ? <p className="space-said">{utterance.say}</p> : null}
            {/* WHETHER THE DETAIL IS FOLDED DEPENDS ON WHETHER IT IS THE MESSAGE.
                An utterance with a `say` has already told you what it is about,
                so its detail is elaboration and folds away. An utterance with
                NO `say` — which is every typed message, because the voice
                controls put written words in `detail` so they are not read
                aloud — has nothing else in it. Folding that showed the room a
                name and the word "Detail", and you had to click to find out
                whether anything had been said to you at all. */}
            {utterance.detail ? (
              utterance.say ? (
                <details>
                  <summary>Detail</summary>
                  <p>{utterance.detail}</p>
                </details>
              ) : (
                <p className="space-said-written">{utterance.detail}</p>
              )
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
