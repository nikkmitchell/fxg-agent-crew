import { useRoomFeed } from "./space/useRoomFeed";

/**
 * The WebHarness room, to read.
 *
 * THIS TAB USED TO BE A BUTTON. It said a sentence about Live Rooms and offered
 * "Open chat", which opened an overlay — fine while the only way in was a
 * click, and useless the moment the Chat panel in the 3D room became an iframe
 * of this tab: Nikk got a panel whose entire content was a button that opened
 * something he could not reach, and then a WebHarness login form he could not
 * complete wearing an Aura.
 *
 * So this reads the room through saha.ing's own proxy, which uses the
 * WebHarness token already held server-side against your session. No second
 * sign-in, no form, nothing to click.
 *
 * READ ONLY. Posting still lives in the overlay, because a reply box you cannot
 * type into is worse than no reply box, and nobody has a keyboard in a headset.
 */
export function ChatFeed() {
  const feed = useRoomFeed(true);

  return (
    <section className="chat-feed" aria-label="The room's chat">
      {feed.room ? <p className="muted-note">{feed.room}</p> : null}

      {feed.messages.length === 0 && !feed.trouble ? (
        <p className="muted-note">Reading the room…</p>
      ) : null}

      <ol>
        {feed.messages.map((message) => (
          <li key={message.id}>
            <p>
              <strong>{message.username}</strong>
              <time>{message.createdAt}</time>
            </p>
            <p className="chat-feed-body">{message.content}</p>
          </li>
        ))}
      </ol>

      {/* SAID RATHER THAN IMPLIED. A feed that has quietly stopped updating and
          a room where nobody is talking look exactly alike, and only one of
          them is a problem. */}
      {feed.trouble ? <p role="status">{feed.trouble}</p> : null}
    </section>
  );
}
