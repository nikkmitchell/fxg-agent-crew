import { useEffect } from "react";
import {
  roomHistoryState,
  roomUrlForSelection,
  shouldNormalizePreferredRoomUrl,
  shouldRememberRoom,
  useRoomSelection,
} from "./space/room-selection";
import { resolveJoinedRoom, useRoomFeed } from "./space/useRoomFeed";

/**
 * The joined WebHarness rooms, to browse and read.
 *
 * THIS TAB USED TO BE A BUTTON. It said a sentence about Live Rooms and offered
 * "Open chat", which opened an overlay — fine while the only way in was a
 * click, and useless the moment the Chat panel in the 3D room became an iframe
 * of this tab: Nikk got a panel whose entire content was a button that opened
 * something he could not reach, and then a WebHarness login form he could not
 * complete wearing an Aura.
 *
 * So this reads each joined room through saha.ing's own proxy, which uses the
 * WebHarness token already held server-side against your session. No second
 * sign-in, no form, nothing to click.
 *
 * READ ONLY. Posting still lives in the overlay, because a reply box you cannot
 * type into is worse than no reply box, and nobody has a keyboard in a headset.
 */
export function ChatFeed({
  roomIdentity,
  onOpenRoomControls,
}: {
  roomIdentity: string | null;
  onOpenRoomControls?: () => void;
}) {
  const selection = useRoomSelection();
  const feed = useRoomFeed(
    true,
    selection.preferredRoom,
    selection.requestedRoom,
    roomIdentity,
  );

  // Persist only a selection confirmed by this account's current room list.
  // While a selection changes, the feed can still show the previous room for
  // one render; writing that stale value back would undo the new choice.
  useEffect(() => {
    const expected = resolveJoinedRoom(feed.rooms, selection.preferredRoom, selection.requestedRoom);
    if (feed.room && shouldRememberRoom(
      feed.loadingRooms,
      feed.room,
      expected.roomName,
      selection.requestedRoom,
    )) {
      if (shouldNormalizePreferredRoomUrl(
        window.location.href,
        feed.room,
        selection.requestedRoom,
        window.history.state,
      )) {
        window.history.replaceState(
          roomHistoryState(window.history.state, true),
          "",
          roomUrlForSelection(window.location.href, feed.room),
        );
      }
      selection.rememberRoom(feed.room);
    }
  }, [feed.loadingRooms, feed.room, feed.rooms, selection.preferredRoom, selection.rememberRoom, selection.requestedRoom]);

  const chooseRoom = (roomName: string) => {
    selection.chooseRoom(roomName, feed.room);
  };

  return (
    <section className="room-lobby" aria-label="Room lobby">
      <aside className="room-lobby-list">
        <header>
          <div>
            <p className="eyebrow">LOBBY</p>
            <h2>Your rooms</h2>
          </div>
          {!feed.loadingRooms ? <span>{feed.rooms.length}</span> : null}
          <button type="button" onClick={feed.refreshRooms} disabled={feed.loadingRooms}>
            {feed.loadingRooms ? "Refreshing…" : "Refresh"}
          </button>
        </header>
        {feed.loadingRooms ? (
          <p className="muted-note">{feed.rooms.length ? "Refreshing your rooms…" : "Finding your rooms…"}</p>
        ) : null}
        {feed.roomsTrouble ? <p role="status">{feed.roomsTrouble}</p> : null}
        {!feed.loadingRooms && feed.rooms.length === 0 && !feed.trouble && !feed.roomsTrouble ? (
          <p className="muted-note">No joined rooms are available for this account yet.</p>
        ) : null}
        <nav aria-label="Your joined rooms">
          {feed.rooms.map((room) => (
            <button
              key={room.roomName}
              type="button"
              className={feed.room === room.roomName ? "is-selected" : ""}
              aria-pressed={feed.room === room.roomName}
              onClick={() => chooseRoom(room.roomName)}
            >
              <span>
                <strong>{room.roomName}</strong>
                <small>{room.ownerName ? `By ${room.ownerName}` : `${room.visibility} room`}</small>
              </span>
              {room.unreadCount ? <b>{room.unreadCount} new</b> : null}
            </button>
          ))}
        </nav>
      </aside>

      <section className="chat-feed" aria-label="Selected room conversation">
        <header className="room-lobby-feed-header">
          <div>
            <p className="eyebrow">ROOM CHAT</p>
            <h2>{feed.room ?? "Choose a room"}</h2>
          </div>
          {onOpenRoomControls ? (
            <button type="button" onClick={onOpenRoomControls}>Open room controls</button>
          ) : null}
        </header>

        {feed.room && feed.loadingMessages && feed.messages.length === 0 && !feed.trouble ? (
          <p className="muted-note">Reading the room…</p>
        ) : null}
        {feed.room && !feed.loadingMessages && feed.messages.length === 0 && !feed.trouble ? (
          <p className="muted-note">No messages in this room yet.</p>
        ) : null}

        {feed.mayHaveEarlier ? (
          <p className="room-history-edge">Showing recent messages. Earlier room history is not loaded here.</p>
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

        {/* SAID RATHER THAN IMPLIED. A feed that has quietly stopped updating
            and a room where nobody is talking look exactly alike. */}
        {feed.trouble ? <p role="status">{feed.trouble}</p> : null}
      </section>
    </section>
  );
}
