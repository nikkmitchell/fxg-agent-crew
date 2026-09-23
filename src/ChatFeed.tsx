import { useEffect, useState } from "react";
import { useRoomFeed } from "./space/useRoomFeed";

const ROOM_MEMORY_KEY = "saha.roomLobby.lastRoom";

const roomFromUrl = () => new URLSearchParams(window.location.search).get("room")?.trim() || null;
const rememberedRoom = () => {
  try {
    return window.localStorage.getItem(ROOM_MEMORY_KEY)?.trim() || null;
  } catch {
    return null;
  }
};

const rememberRoom = (roomName: string) => {
  try {
    window.localStorage.setItem(ROOM_MEMORY_KEY, roomName);
  } catch {
    // Room switching still works when storage is disabled; it simply will not
    // be the default the next time the lobby opens.
  }
};

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
export function ChatFeed({ onOpenRoomControls }: { onOpenRoomControls?: () => void }) {
  const [selectedRoom, setSelectedRoom] = useState(() =>
    typeof window === "undefined" ? null : roomFromUrl() ?? rememberedRoom(),
  );
  const feed = useRoomFeed(true, "saha.ing", selectedRoom);

  useEffect(() => {
    const syncFromUrl = () => {
      const roomName = roomFromUrl() ?? rememberedRoom();
      setSelectedRoom(roomName);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // Give the default room a stable, linkable URL too. The first room is a
  // convenience for a new visitor; from this point on the address says which
  // conversation is actually on screen.
  useEffect(() => {
    if (selectedRoom || !feed.room) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("room")?.trim()) return;
    url.searchParams.set("room", feed.room);
    rememberRoom(feed.room);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [feed.room, selectedRoom]);

  useEffect(() => {
    if (selectedRoom && feed.room === selectedRoom) rememberRoom(selectedRoom);
  }, [feed.room, selectedRoom]);

  const chooseRoom = (roomName: string) => {
    if (feed.room === roomName) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomName);
    rememberRoom(roomName);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSelectedRoom(roomName);
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
