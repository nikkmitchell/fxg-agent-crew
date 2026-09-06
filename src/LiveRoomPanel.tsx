import { FormEvent, useEffect, useState } from "react";
import { useWebharnessRoom } from "./use-webharness-room";
import { summariseCrewEvent } from "./crew-event-summary";

/**
 * One message. Board events are posted into this room as fenced JSON — that is
 * the durable log and it belongs there — but a person reading the room should
 * see what changed, not a payload. The original stays one click away, because
 * the raw event is the record and the summary is only an interpretation.
 */
function MessageBody({ message }: { message: { id: number; username: string; createdAt: string; content: string; streaming?: boolean } }) {
  const summary = summariseCrewEvent(message.content);

  return (
    <article className={message.streaming ? "is-streaming" : ""}>
      <header><strong>{message.username}</strong><time>{message.createdAt}</time></header>
      {summary ? (
        <>
          <p className="crew-event-headline">{summary.headline}</p>
          <details className="crew-event-raw">
            <summary>Show the recorded event</summary>
            <pre>{summary.raw}</pre>
          </details>
        </>
      ) : (
        <p>{message.content}</p>
      )}
      {message.streaming && <small>writing…</small>}
    </article>
  );
}

export function LiveRoomPanel({ onClose }: { onClose: () => void }) {
  const { state, login, logout, selectRoom, retry, sendMessage, retryMessage } = useWebharnessRoom();

  /**
   * Anything the server has not confirmed yet. Acknowledged items drop off:
   * once a message is in the transcript, a receipt for it is duplicate noise.
   */
  const unsent = state.outbox.filter((item) => item.state !== "acknowledged");

  /**
   * Tracked as state rather than read at render time, because navigator.onLine
   * is not reactive — React has no reason to re-render when it flips, so a
   * value read during render can be stale on screen.
   */
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    void login({ username: username.trim(), password });
    setPassword("");
  };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    sendMessage(message);
    setMessage("");
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
          {/*
            * Presence is a disclosure, not a permanent band.
            *
            * This panel stacked header + status + presence above the message
            * list — roughly 190px of fixed chrome. On a phone the keyboard
            * takes most of what is left, so the messages collapsed to nothing
            * while typing: "I'm in chat and while typing it doesn't even show
            * messages". The count stays visible because it is one line; the
            * avatars are behind a toggle because they are not.
            */}
          <details className="room-presence">
            <summary>
              <span>{state.room?.onlineCount ?? 0} online</span>
              <small>Who</small>
            </summary>
            <div className="room-presence-list">
              {state.room?.onlineUsers.length
                ? state.room.onlineUsers.map((user) => (
                    <i key={user.username} title={user.username}>{user.username.slice(0, 2).toUpperCase()}</i>
                  ))
                : <p>Nobody else is here right now.</p>}
            </div>
          </details>

          {(state.phase === "reconnecting" || state.errorCode === "ROOM_ARCHIVED" || state.errorCode === "NOT_A_MEMBER") && (
            <div className="room-callout" role="status">
              <strong>{state.errorCode === "ROOM_ARCHIVED" ? "This room has ended" : state.errorCode === "NOT_A_MEMBER" ? "History is unavailable" : "Connection interrupted"}</strong>
              <p>{state.notice ?? (state.stale ? "Keeping the last confirmed messages visible." : "No cached messages yet.")}</p>
              {state.phase === "reconnecting" && <button onClick={retry}>Retry now</button>}
            </div>
          )}

          <div className="room-messages" aria-label="Room transcript">
            {state.messages.length === 0 ? <div className="room-empty"><p>No messages loaded yet.</p></div> : state.messages.map((message) => (
              <MessageBody key={message.id} message={message} />
            ))}
          </div>

          {/*
            * The outbox lives OUTSIDE the composer.
            *
            * It used to be inside the form, which only renders while connected —
            * so a message you queued went invisible the moment the connection
            * dropped, which is precisely when you most want to know it still
            * exists. It was never lost, but the screen stopped saying so, and a
            * message you cannot see is one you assume was eaten.
            *
            * Every pending item is listed. The old slice(-2) silently hid the
            * third onwards: a truncation with nothing on screen admitting it.
            */}
          {unsent.length > 0 && (
            <ul className="outbox" aria-label="Messages not yet confirmed">
              {unsent.map((item) => (
                <li className={`outbox-receipt outbox-receipt--${item.state}`} key={item.clientId}>
                  <span>{item.state}</span><p>{item.content}</p>
                  {/*
                    * A FAILED send is never retried automatically, and the copy
                    * here says so. The first version of this line promised it
                    * "will retry when the connection returns"; I induced the
                    * failure, reconnected, and watched it sit there — the flush
                    * on reconnect only picks up QUEUED items.
                    *
                    * The behaviour is right and the words were wrong. A send
                    * that failed for an unknown reason may already have been
                    * stored upstream before the error came back, so re-sending
                    * it without being asked risks a duplicate nobody chose.
                    * The person decides; we just have to say that plainly.
                    *
                    * Retry needs the browser online, so offline it is stated
                    * rather than offered — a button that silently does nothing
                    * reads as the app ignoring you.
                    */}
                  {item.state === "failed" && (
                    online
                      ? <button type="button" onClick={() => retryMessage(item.clientId)}>Retry</button>
                      : <em>not sent · retry once you are back online</em>
                  )}
                  {/* Queued items DO flush by themselves; verified by inducing it. */}
                  {item.state === "queued" && !online ? <em>waiting for the connection · will send itself</em> : null}
                </li>
              ))}
            </ul>
          )}

          {state.phase === "connected" && (
            <form className="room-composer" onSubmit={submitMessage}>
              <label htmlFor="room-message">Message the room</label>
              <div><textarea id="room-message" maxLength={2000} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a confirmed room message…" /><button type="submit">Send</button></div>
              <small>{message.length} / 2000</small>
            </form>
          )}

          <footer className="room-readonly-note">
            <span>{state.phase === "read_only" ? "Viewing confirmed history" : "Live transcript"}</span>
            <button onClick={() => void logout()}>Sign out</button>
          </footer>
        </>
      )}
    </aside>
  );
}
