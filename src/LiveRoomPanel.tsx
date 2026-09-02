import { FormEvent, useState } from "react";
import { useWebharnessRoom } from "./use-webharness-room";

export function LiveRoomPanel({ onClose }: { onClose: () => void }) {
  const { state, login, logout, selectRoom, retry } = useWebharnessRoom();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    void login({ username: username.trim(), password });
    setPassword("");
  };

  const connectionLabel = {
    checking_session: "Checking session",
    signed_out: "Signed out",
    loading_rooms: "Loading rooms",
    selecting_room: "Choose a room",
    connecting: "Connecting",
    connected: "Live",
    reconnecting: "Reconnecting",
    read_only: "Read only",
  }[state.phase];

  return (
    <aside className="live-room-panel" aria-label="WebHarness rooms" aria-live="polite">
      <header className="live-room-header">
        <div>
          <p>LIVE COORDINATION</p>
          <h2>{state.roomName ?? "WebHarness"}</h2>
        </div>
        <button onClick={onClose} aria-label="Close live room">×</button>
      </header>

      <div className={`connection-banner connection-banner--${state.phase}`}>
        <span aria-hidden="true" />
        <strong>{connectionLabel}</strong>
        {state.stale && <small>Saved activity shown</small>}
      </div>

      {state.phase === "checking_session" && <div className="room-empty"><i /><p>Restoring your secure session…</p></div>}

      {state.phase === "signed_out" && (
        <form className="room-login" onSubmit={submitLogin}>
          <p>Use your existing human WebHarness account. Agent signing keys never enter this form.</p>
          <label htmlFor="room-username">Username</label>
          <input id="room-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          <label htmlFor="room-password">Password</label>
          <input id="room-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {state.errorCode && <div className="room-error" role="alert">{state.errorCode === "INVALID_CREDENTIALS" ? "Those credentials were not accepted." : "Your session ended. Sign in again."}</div>}
          <button type="submit">Sign in securely</button>
        </form>
      )}

      {state.phase === "loading_rooms" && <div className="room-empty"><i /><p>Finding your rooms…</p></div>}

      {state.phase === "selecting_room" && (
        <div className="room-picker">
          <div className="room-section-title"><span>YOUR ROOMS</span><small>{state.rooms.length}</small></div>
          {state.rooms.length === 0 ? <p className="room-note">No rooms are available for this account.</p> : state.rooms.map((room) => (
            <button key={room.roomName} onClick={() => selectRoom(room.roomName)}>
              <span><strong>{room.roomName}</strong><small>Owned by {room.ownerName}</small></span>
              <b>{room.unreadCount ? `${room.unreadCount} new` : "Open"}</b>
            </button>
          ))}
          <button className="room-logout" onClick={() => void logout()}>Sign out</button>
        </div>
      )}

      {state.roomName && state.phase !== "selecting_room" && state.phase !== "signed_out" && (
        <>
          <div className="room-presence">
            <span>{state.room?.onlineCount ?? 0} online</span>
            <div>{state.room?.onlineUsers.slice(0, 5).map((user) => <i key={user.username} title={user.username}>{user.username.slice(0, 2).toUpperCase()}</i>)}</div>
          </div>

          {(state.phase === "reconnecting" || state.errorCode === "ROOM_ARCHIVED" || state.errorCode === "NOT_A_MEMBER") && (
            <div className="room-callout" role="status">
              <strong>{state.errorCode === "ROOM_ARCHIVED" ? "This room has ended" : state.errorCode === "NOT_A_MEMBER" ? "History is unavailable" : "Connection interrupted"}</strong>
              <p>{state.notice ?? (state.stale ? "Keeping the last confirmed messages visible." : "No cached messages yet.")}</p>
              {state.phase === "reconnecting" && <button onClick={retry}>Retry now</button>}
            </div>
          )}

          <div className="room-messages" aria-label="Room transcript">
            {state.messages.length === 0 ? <div className="room-empty"><p>No messages loaded yet.</p></div> : state.messages.map((message) => (
              <article key={message.id} className={message.streaming ? "is-streaming" : ""}>
                <header><strong>{message.username}</strong><time>{message.createdAt}</time></header>
                <p>{message.content}</p>
                {message.streaming && <small>writing…</small>}
              </article>
            ))}
          </div>

          <footer className="room-readonly-note">
            <span>{state.phase === "read_only" ? "Viewing confirmed history" : "Live transcript"}</span>
            <button onClick={() => void logout()}>Sign out</button>
          </footer>
        </>
      )}
    </aside>
  );
}

