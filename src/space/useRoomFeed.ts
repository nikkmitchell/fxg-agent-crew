import { useEffect, useRef, useState } from "react";
import { bff } from "../bff-client";
import type { Message } from "../../shared/contracts";

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
  room: string | null;
  messages: RoomMessage[];
  /** Null while it is working. A sentence when the feed is not what it seems. */
  trouble: string | null;
  /**
   * True when there is older conversation above the first page that was never
   * fetched. The server says so; it is not inferred from the count.
   */
  mayHaveEarlier: boolean;
};

/** Keep the tail. A headset panel cannot scroll, so older is wasted texture. */
const KEEP = 40;
const EVERY_MS = 5_000;

export function useRoomFeed(enabled: boolean, preferred = "saha.ing"): RoomFeed {
  const [room, setRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [mayHaveEarlier, setMayHaveEarlier] = useState(false);
  const cursor = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Declared out here so the effect's own cleanup can clear it. Returning a
    // cleanup from the async function below would do nothing at all — React
    // never sees it — and the poll would outlive the component.
    let timer: number | undefined;

    const pickRoom = async (): Promise<string | null> => {
      const rooms = await bff.rooms();
      // The room Nikk means by "our normal chat" if it is there, and otherwise
      // whichever one they are actually in — guessing a name that does not
      // exist would show an empty panel with no explanation.
      return rooms.find((entry) => entry.roomName === preferred)?.roomName
        ?? rooms[0]?.roomName
        ?? null;
    };

    const read = async (name: string) => {
      // wait=0: a poll on a timer, not a long poll. A held connection per panel
      // per person is not worth five seconds of freshness, and a long poll
      // abandoned when the tab sleeps looks like a hang.
      const page = await bff.messages(name, { wait: 0, afterId: cursor.current });
      if (stopped) return;
      if (page.messages.length > 0) {
        cursor.current = page.cursor ?? page.messages[page.messages.length - 1].id;
        setMessages((before) => [...before, ...page.messages].slice(-KEEP));
      }
      // Only the first page can say this; later polls are not the start of
      // anything and leave the flag alone.
      if (page.mayHaveEarlier !== undefined) setMayHaveEarlier(page.mayHaveEarlier);
      setTrouble(null);
    };

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

  return { room, messages, trouble, mayHaveEarlier };
}
