import { useEffect, useRef, useState } from "react";
import { bff } from "../bff-client";
import type { Message, RoomSummary } from "../../shared/contracts";

/**
 * The WebHarness room, read through saha.ing.
 *
 * NO LOGIN IN THIS PAGE, which is the point. `LiveRoomPanel` signs in to
 * WebHarness from the browser, and Nikk hit the consequence in a headset: the
 * Chat panel was a login form, and there is no way to complete one wearing an
 * Aura. saha.ing already holds each person's WebHarness token SERVER-SIDE,
 * keyed by the session cookie, and proxies the room — so being signed in to
 * saha.ing is already being signed in to the room.
 *
 * THROUGH `bff-client`, NOT `fetch`. The first version of this file hand-rolled
 * the same two requests, and paid for it immediately: it read `entry.name` off
 * the room list where the field is `roomName`, so it told somebody standing in
 * five rooms that they were in none. `RoomSummary` in shared/contracts.ts types
 * that field, so the bug could not have compiled against the client that was
 * already here. It also ignored `cursor` and `mayHaveEarlier`, which the server
 * has been sending all along — and `mayHaveEarlier` is the answer to the
 * "why is there no history in the headset" question I had Inkstone chasing.
 *
 * READ ONLY. Posting still belongs to `LiveRoomPanel`; a reply box you cannot
 * type into is worse than no reply box, and nobody has a keyboard in a headset.
 */
export type RoomMessage = Message;

export type RoomFeed = {
  /** Rooms this session has already joined; discovery never joins implicitly. */
  rooms: RoomSummary[];
  loadingRooms: boolean;
  refreshRooms: () => void;
  room: string | null;
  loadingMessages: boolean;
  messages: RoomMessage[];
  /** Null while it is working. A sentence when the feed is not what it seems. */
  trouble: string | null;
  /** A failed refresh leaves the last confirmed room list visible. */
  roomsTrouble: string | null;
  /**
   * True when there is older conversation above the first page that was never
   * fetched. The server says so; it is not inferred from the count.
   */
  mayHaveEarlier: boolean;
};

/**
 * Keep the tail: enough to read back through on the wall, which scrolls now
 * (ChatPanel3D). The wall lays out every kept message on each paint, so this
 * is not unbounded.
 */
const KEEP = 80;
const EVERY_MS = 5_000;

/** Resolve against confirmed membership, never against a remembered name alone. */
export function resolveJoinedRoom(
  rooms: RoomSummary[],
  selectedRoom: string | null,
  preferred: string,
): string | null {
  const requested = selectedRoom?.trim();
  if (requested) return rooms.find((entry) => entry.roomName === requested)?.roomName ?? null;
  return rooms.find((entry) => entry.roomName === preferred)?.roomName ?? rooms[0]?.roomName ?? null;
}

export function useRoomFeed(
  enabled: boolean,
  preferred = "saha.ing",
  selectedRoom: string | null = null,
): RoomFeed {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomListRevision, setRoomListRevision] = useState(0);
  const [roomListTrouble, setRoomListTrouble] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [mayHaveEarlier, setMayHaveEarlier] = useState(false);
  const cursor = useRef<number | undefined>(undefined);

  // The list is refreshed independently of the selected conversation. A new
  // array of the same rooms must not tear down the message timer or transcript.
  const resolvedRoom = resolveJoinedRoom(rooms, selectedRoom, preferred);
  const listReady = !loadingRooms || rooms.length > 0;
  const listUnavailable = Boolean(roomListTrouble && rooms.length === 0);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const controller = new AbortController();
    setLoadingRooms(true);
    setRoomListTrouble(null);
    void bff.rooms(controller.signal).then((joined) => {
      if (stopped) return;
      setRooms(joined);
      setRoomListTrouble(null);
    }).catch(() => {
      if (!stopped) setRoomListTrouble("Your joined rooms could not be loaded. You may need to sign in again.");
    }).finally(() => {
      if (!stopped) setLoadingRooms(false);
    });
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled, roomListRevision]);

  useEffect(() => {
    if (!enabled || !listReady || listUnavailable) return;
    let stopped = false;
    // Declared out here so the effect's own cleanup can clear it. Returning a
    // cleanup from the async function below would do nothing at all — React
    // never sees it — and the poll would outlive the component.
    let timer: number | undefined;

    const read = async (name: string, initial = false) => {
      // wait=0: a poll on a timer, not a long poll. A held connection per panel
      // per person is not worth five seconds of freshness, and a long poll
      // abandoned when the tab sleeps looks like a hang.
      const page = await bff.messages(name, { wait: 0, afterId: cursor.current });
      if (stopped) return;
      if (page.messages.length > 0) {
        cursor.current = page.cursor ?? page.messages[page.messages.length - 1].id;
        setMessages((before) => [...before, ...page.messages].slice(-KEEP));
      } else if (page.cursor !== null && page.cursor !== undefined) {
        cursor.current = page.cursor;
      }
      // Only the first page can say this; later polls are not the start of
      // anything and leave the flag alone.
      if (initial && page.mayHaveEarlier !== undefined) setMayHaveEarlier(page.mayHaveEarlier);
      setTrouble(null);
      if (initial) setLoadingMessages(false);
    };

    setMessages([]);
    setLoadingMessages(true);
    setMayHaveEarlier(false);
    setRoom(null);
    setTrouble(null);
    cursor.current = undefined;

    const name = resolvedRoom;
    if (selectedRoom?.trim() && !name) {
      setTrouble("That room is not in your joined rooms. Choose a room from the list.");
      setLoadingMessages(false);
      return () => { stopped = true; };
    }
    if (!name) {
      setTrouble("You are not in any WebHarness room, so there is nothing to show here.");
      setLoadingMessages(false);
      return () => { stopped = true; };
    }

    setRoom(name);
    void (async () => {
      try {
        await read(name, true);
        if (stopped) return;
        timer = window.setInterval(() => {
          void read(name).catch(() =>
            // KEEP WHAT WE HAVE. Blanking on one failed poll would read as the
            // room having gone silent, which is a different and more alarming
            // thing than a dropped request.
            setTrouble("The room stopped answering, so this may be behind."),
          );
        }, EVERY_MS);
      } catch {
        if (!stopped) {
          setTrouble("The room could not be read. You may need to sign in again.");
          setLoadingMessages(false);
        }
      }
    })();

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [enabled, listReady, listUnavailable, resolvedRoom, selectedRoom]);

  return {
    rooms,
    loadingRooms,
    refreshRooms: () => setRoomListRevision((revision) => revision + 1),
    room: room === resolvedRoom ? room : null,
    loadingMessages: room === resolvedRoom ? loadingMessages : true,
    messages: room === resolvedRoom ? messages : [],
    trouble,
    roomsTrouble: roomListTrouble,
    mayHaveEarlier,
  };
}
