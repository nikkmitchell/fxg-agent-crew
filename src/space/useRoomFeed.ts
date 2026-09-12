import { useEffect, useRef, useState } from "react";
import { base } from "../router";

/**
 * The WebHarness room, read through saha.ing.
 *
 * NO LOGIN IN THIS PAGE, which is the whole point. `LiveRoomPanel` signs in to
 * WebHarness from the browser, and Nikk hit the consequence in a headset: the
 * Chat panel was a login form, and there is no way to complete one while you
 * are wearing an Aura. saha.ing already holds each person's WebHarness token
 * SERVER-SIDE, keyed by the session cookie, and proxies the room through
 * `/bff/rooms/:room/messages` — so being signed in to saha.ing is already being
 * signed in to the room, and this needs no second credential and no form.
 *
 * READ ONLY, deliberately. Posting from a panel inside a headset needs a
 * keyboard nobody has yet; this is the feed, and the point of it is watching
 * what everyone is saying while you are standing in the room.
 */
export type RoomMessage = {
  id: number;
  username: string;
  createdAt: string;
  content: string;
};

export type RoomFeed = {
  room: string | null;
  messages: RoomMessage[];
  /** Null while it is working. A sentence when the feed is not what it seems. */
  trouble: string | null;
  /** When the last successful read landed, for saying how stale this is. */
  readAt: number | null;
};

/** Keep the tail. A headset panel cannot scroll, so older is wasted texture. */
const KEEP = 40;
const EVERY_MS = 5_000;

export function useRoomFeed(enabled: boolean, preferred = "saha.ing"): RoomFeed {
  const [room, setRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const cursor = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const pickRoom = async (): Promise<string | null> => {
      const response = await fetch(`${base}/bff/rooms`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`rooms ${response.status}`);
      // `roomName`, not `name`. The upstream shape is what WebHarness returns
      // and saha.ing passes through unchanged; reading `name` found undefined
      // on every room and reported "you are not in any room" to somebody
      // standing in five of them.
      const body = (await response.json()) as { roomName?: string }[] | { rooms?: { roomName?: string }[] };
      const list = Array.isArray(body) ? body : (body.rooms ?? []);
      const names = list.map((entry) => entry.roomName).filter(Boolean) as string[];
      // The room Nikk means by "our normal chat" if it is there, and otherwise
      // whichever one they are actually in — guessing a name that does not
      // exist would show an empty panel with no explanation.
      return names.find((name) => name === preferred) ?? names[0] ?? null;
    };

    const read = async (name: string) => {
      // wait=0: this is a poll on a timer, not a long poll. A held connection
      // per panel per person is not worth five seconds of freshness, and a
      // long poll that is abandoned when the tab sleeps looks like a hang.
      const url = `${base}/bff/rooms/${encodeURIComponent(name)}/messages?wait=0${
        cursor.current === undefined ? "" : `&afterId=${cursor.current}`
      }`;
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`messages ${response.status}`);
      const body = (await response.json()) as { messages?: RoomMessage[] };
      const page = body.messages ?? [];
      if (stopped) return;
      if (page.length > 0) {
        cursor.current = page[page.length - 1].id;
        setMessages((before) => [...before, ...page].slice(-KEEP));
      }
      setTrouble(null);
      setReadAt(Date.now());
    };

    // The timer is declared OUT HERE so the effect's own cleanup can clear it.
    // Returning a cleanup from inside the async function below would do
    // nothing at all — React never sees it — and the poll would outlive the
    // component, one extra request every five seconds for the life of the tab.
    let timer: number | undefined;

    void (async () => {
      try {
        const name = await pickRoom();
        if (stopped) return;
        if (!name) {
          setTrouble("You are not in any WebHarness room, so there is nothing to show here.");
          return;
        }
        setRoom(name);
        await read(name);
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
        if (!stopped) setTrouble("The room could not be read. You may need to sign in again.");
      }
    })();

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [enabled, preferred]);

  return { room, messages, trouble, readAt };
}
