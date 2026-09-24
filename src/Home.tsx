import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { RoomSummary } from "../shared/contracts";
import { ApiError } from "./api-request";
import { bff } from "./bff-client";
import { pathForTab } from "./router";
import { useHeadsetAvailable } from "./space/useHeadsetAvailable";

type ListedRoom = { room: RoomSummary; joined: boolean };
type Action = "enter" | "join" | "create" | null;
const sameRoom = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function roomActionError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The room did not answer. Please try again.";
  switch (error.code) {
    case "ROOM_NOT_FOUND": return "No room has that name. Check the spelling; joining never creates a room.";
    case "ROOM_ALREADY_EXISTS": return "A room already has that name. Use Join by name instead.";
    case "ROOM_UNEXPECTEDLY_CREATED": return "WebHarness unexpectedly created a room during the join. Its 3D space was not opened. Check the name before continuing.";
    case "ROOM_PASSWORD_REQUIRED":
    case "ROOM_PASSWORD_INCORRECT": return "This room needs a password. Check it with the owner and try again.";
    case "ROOM_ARCHIVED": return "That room has ended. Choose another room.";
    case "NOT_A_MEMBER": return "Join this room before entering its 3D space.";
    case "SESSION_EXPIRED": return "Your session ended. Sign in again, then retry.";
    case "UPSTREAM_UNAVAILABLE": return "WebHarness is not answering. We cannot confirm whether anything changed; refresh your rooms before retrying.";
    default: return error.message || "The room action did not complete.";
  }
}

/**
 * A single front door. Join, create, and enter are deliberately distinct:
 * WebHarness's join-or-create API must never turn a typo into a new room.
 */
export function Home({ onEnter }: { onEnter: (roomName: string) => Promise<void> }) {
  const headset = useHeadsetAvailable();
  const [joined, setJoined] = useState<RoomSummary[]>([]);
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<{ joined?: string; public?: string }>({});
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [action, setAction] = useState<Action>(null);
  const [pendingJoinRoom, setPendingJoinRoom] = useState<string | null>(null);
  const [focusJoinedRoom, setFocusJoinedRoom] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [reviewed, setReviewed] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [mine, publicList] = await Promise.allSettled([bff.rooms(), bff.publicRooms()]);
    if (mine.status === "fulfilled") setJoined(mine.value);
    if (publicList.status === "fulfilled") setPublicRooms(publicList.value);
    setErrors({
      ...(mine.status === "rejected" ? { joined: "Your room list could not be refreshed; any rooms below are from the last successful check." } : {}),
      ...(publicList.status === "rejected" ? { public: "Public rooms could not be refreshed; any rooms below are from the last successful check." } : {}),
    });
    if (mine.status === "fulfilled" || publicList.status === "fulfilled") setCheckedAt(Date.now());
    setLoading(false);
    return mine.status === "fulfilled" ? mine.value : null;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const discoverable = useMemo(() =>
    publicRooms.filter((room) => !joined.some((mine) => sameRoom(mine.roomName, room.roomName))), [joined, publicRooms]);
  const all: ListedRoom[] = [
    ...joined.map((room) => ({ room, joined: true })),
    ...discoverable.map((room) => ({ room, joined: false })),
  ];
  const chosen = all.find((item) => selected && sameRoom(item.room.roomName, selected))
    ?? all.find((item) => item.joined && sameRoom(item.room.roomName, "lobby"))
    ?? all.find((item) => item.joined && sameRoom(item.room.roomName, "saha.ing"))
    ?? all.find((item) => item.joined)
    ?? all.find((item) => sameRoom(item.room.roomName, "lobby"))
    ?? all[0] ?? null;
  useEffect(() => {
    if (!focusJoinedRoom || !chosen?.joined || notice?.kind !== "success") return;
    primaryActionRef.current?.focus();
    setFocusJoinedRoom(false);
  }, [chosen?.joined, focusJoinedRoom, notice]);
  const choose = (roomName: string) => {
    setSelected(roomName);
    setNotice(null);
    // On a narrow screen the selected room sits above the directory, so bring
    // its action back into view after a different room is chosen below it.
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailsRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      }));
    }
  };

  const join = async (name: string, password?: string, fromNameForm = false) => {
    const roomName = name.trim();
    if (!roomName || action) return;
    setNotice(null);
    setAction("join");
    setPendingJoinRoom(roomName);
    try {
      const result = await bff.joinRoom(roomName, password);
      setSelected(result.roomName);
      setJoinOpen(false);
      setJoinPassword("");
      const listed = await refresh();
      const visible = listed?.some((room) => sameRoom(room.roomName, result.roomName));
      setNotice(visible
        ? { kind: "success", text: (result.joined ? "Joined " : "Already a member of ") + result.roomName + ". Choose Enter to step inside." }
        : { kind: "error", text: "The join was accepted, but your room list has not confirmed it yet. Refresh rooms before entering." });
      if (visible && fromNameForm) setFocusJoinedRoom(true);
    } catch (error) {
      setNotice({ kind: "error", text: roomActionError(error) });
      if (error instanceof ApiError && (error.code === "ROOM_PASSWORD_REQUIRED" || error.code === "ROOM_PASSWORD_INCORRECT")) {
        setJoinName(roomName);
        setJoinOpen(true);
      }
    } finally {
      setAction(null);
      setPendingJoinRoom(null);
    }
  };

  const enter = async () => {
    if (!chosen?.joined || action) return;
    setNotice(null);
    setAction("enter");
    try {
      await onEnter(chosen.room.roomName);
    } catch (error) {
      setNotice({ kind: "error", text: roomActionError(error) });
    } finally {
      setAction(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const roomName = createName.trim();
    if (!roomName || action) return;
    if (!reviewed) { setReviewed(true); return; }
    setNotice(null);
    setAction("create");
    try {
      const result = await bff.createRoom(roomName, visibility);
      setSelected(result.roomName);
      setCreateOpen(false);
      setReviewed(false);
      const listed = await refresh();
      const visible = listed?.some((room) => sameRoom(room.roomName, result.roomName));
      setNotice(visible
        ? { kind: "success", text: "Created " + result.roomName + ". You are its first member; invite people before expecting company." }
        : { kind: "error", text: "The room was created, but your room list has not confirmed it yet. Refresh rooms before entering." });
    } catch (error) {
      setNotice({ kind: "error", text: roomActionError(error) });
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="home room-front" aria-label="Room lobby">
      <div className="room-front-intro">
        <p className="eyebrow">SAHA / ROOMS</p>
        <h1>Find your place.</h1>
        <p>Your own front door: choose how you look, then choose where to go. Enter a room you belong to, join an existing one, or deliberately create a new one.</p>
        <a className="room-front-avatar-link" href={pathForTab("profiles")}>Choose your avatar <span aria-hidden="true">↗</span></a>
      </div>
      <div className="room-front-layout">
        <div className="room-front-directory" id="room-directory">
          <div className="room-front-directory-head">
            <div><h2>Rooms</h2><p>Membership and public discovery are shown separately.</p></div>
            <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
          {offline ? <p className="room-front-warning" role="status">This device reports that it is offline. The lists may be out of date.</p> : null}
          {loading && all.length === 0 ? <p className="room-front-empty" role="status">Finding your rooms…</p> : null}
          {errors.joined ? <p className="room-front-warning" role="status">{errors.joined}</p> : null}
          {errors.public ? <p className="room-front-warning" role="status">{errors.public}</p> : null}
          {checkedAt && !loading ? <p className="room-front-freshness">Checked {new Date(checkedAt).toLocaleTimeString()}</p> : null}
          <div className="room-front-list-group">
            <h3>Your rooms <span>{joined.length}</span></h3>
            {joined.map((room) => <RoomOption key={room.roomName} room={room} joined selected={sameRoom(chosen?.room.roomName ?? "", room.roomName)} onChoose={() => choose(room.roomName)} />)}
            {!joined.length && !loading && !errors.joined ? <p className="room-front-empty">You have not joined a room yet. Explore public rooms or join one by name.</p> : null}
          </div>
          <div className="room-front-list-group">
            <h3>Explore public rooms <span>{discoverable.length}</span></h3>
            {discoverable.map((room) => <RoomOption key={room.roomName} room={room} joined={false} selected={sameRoom(chosen?.room.roomName ?? "", room.roomName)} onChoose={() => choose(room.roomName)} />)}
            {!discoverable.length && !loading && !errors.public ? <p className="room-front-empty">No other public rooms are listed. Private rooms can be joined by exact name.</p> : null}
          </div>
        </div>
        <div className="room-front-details" ref={detailsRef}>
          {chosen ? <>
            <div className="room-front-selected-head">
              <span className="room-front-status">{chosen.joined ? "YOUR ROOM" : "PUBLIC ROOM"}</span>
              <h2>{chosen.room.roomName}</h2>
              <p>{chosen.room.purpose || "No room description is available yet."}</p>
            </div>
            <dl className="room-front-facts">
              <div><dt>Access</dt><dd>{chosen.joined ? "You are a member" : "Join to enter"}</dd></div>
              {chosen.room.ownerName ? <div><dt>Created by</dt><dd>{chosen.room.ownerName}</dd></div> : null}
              <div><dt>Visibility</dt><dd>{chosen.room.visibility === "private" ? "Private" : "Public"}</dd></div>
            </dl>
            {chosen.joined
              ? <button ref={primaryActionRef} type="button" className="primary-action room-front-primary" disabled={action !== null} onClick={() => void enter()}>{action === "enter" ? "Opening the room…" : "Enter " + chosen.room.roomName}</button>
              : <button ref={primaryActionRef} type="button" className="primary-action room-front-primary" disabled={action !== null} onClick={() => void join(chosen.room.roomName)}>{action === "join" ? "Joining…" : "Join " + chosen.room.roomName}</button>}
            <p className="room-front-capability">
              {headset === true ? "The 3D room opens first. Then choose Enter in your headset above the view."
                : headset === false ? "No headset detected here. You can enter in a browser with a mouse, keyboard or touch."
                  : "Checking headset support. The room also works in a browser window."}
            </p>
          </> : <div className="room-front-selected-head"><span className="room-front-status">NO ROOM SELECTED</span><h2>Start somewhere.</h2><p>Join a room by name or create a new one for your group.</p></div>}
          {notice ? <p className={notice.kind === "error" ? "room-front-error" : "room-front-success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
          {pendingJoinRoom ? <p className="room-front-pending" role="status" aria-live="polite">Joining {pendingJoinRoom}…</p> : null}
          <div className="room-front-other-actions">
            <button type="button" aria-expanded={joinOpen} onClick={() => { setJoinOpen(!joinOpen); setCreateOpen(false); setNotice(null); }}>Join by name</button>
            <button type="button" aria-expanded={createOpen} onClick={() => { setCreateOpen(!createOpen); setJoinOpen(false); setNotice(null); }}>Create a room</button>
          </div>
          {joinOpen ? <form className="room-front-form" onSubmit={(event) => { event.preventDefault(); void join(joinName, joinPassword || undefined, true); }}>
            <h3>Join an existing room</h3><p>Use its exact name. If it does not exist, we tell you; this never creates a room.</p>
            <label>Room name<input autoComplete="off" maxLength={64} required value={joinName} onChange={(event) => setJoinName(event.target.value)} /></label>
            <label>Password, if the owner gave you one<input type="password" autoComplete="off" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} /></label>
            <button type="submit" disabled={action !== null || !joinName.trim()}>{action === "join" ? "Joining…" : "Join existing room"}</button>
          </form> : null}
          {createOpen ? <form className="room-front-form" onSubmit={(event) => void create(event)}>
            <h3>Create a new room</h3><p>A new room starts with only you in it. This is not joining someone else.</p>
            <label>New room name<input autoComplete="off" maxLength={64} required value={createName} onChange={(event) => { setCreateName(event.target.value); setReviewed(false); }} /></label>
            <label>Visibility<select value={visibility} onChange={(event) => { setVisibility(event.target.value as "public" | "private"); setReviewed(false); }}><option value="public">Public — listed for discovery</option><option value="private">Private — invite by name</option></select></label>
            {reviewed ? <p className="room-front-review" role="status">You are about to create <strong>{createName.trim()}</strong> as a <strong>{visibility}</strong> room. Check the spelling.</p> : null}
            <button type="submit" disabled={action !== null || !createName.trim()}>{action === "create" ? "Creating…" : reviewed ? "Confirm: create " + createName.trim() : "Review new room"}</button>
          </form> : null}
        </div>
      </div>
    </section>
  );
}

function RoomOption({ room, joined, selected, onChoose }: { room: RoomSummary; joined: boolean; selected: boolean; onChoose: () => void }) {
  return <button type="button" className={"room-front-option" + (selected ? " is-selected" : "")} aria-pressed={selected} onClick={onChoose}>
    <span className="room-front-option-mark" aria-hidden="true">{room.roomName.slice(0, 1).toUpperCase()}</span>
    <span className="room-front-option-copy"><strong>{room.roomName}</strong><small>{joined ? "Member" : "Public · not joined"}{room.purpose ? " · " + room.purpose : ""}</small></span>
    <span className="room-front-option-arrow" aria-hidden="true">↗</span>
  </button>;
}
