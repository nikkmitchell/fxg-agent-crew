import { useEffect, useRef, useState, type RefObject } from "react";
import type { ClientMessage, Pose, ServerMessage, WirePerson } from "../../shared/space-wire";
import type { Utterance } from "../../shared/voice";
import type { Vec3 } from "../../shared/space-layout";

/**
 * The room's connection.
 *
 * Deliberately NOT a React state update per frame: the server sends ten
 * snapshots a second, and re-rendering the tree that often would make the 3D
 * scene stutter for no benefit — nothing in the DOM changes when someone takes
 * a step. Positions land in a ref the render loop reads; React state carries
 * only what the DOM actually shows, which is the connection status and the list
 * of who is here.
 */

export type SpaceStatus =
  | { state: "connecting" }
  | { state: "open"; you: string }
  /** Refused with a reason the server gave. Shown, not swallowed. */
  | { state: "refused"; reason: string }
  /** Dropped. `retryInSeconds` is null while a retry is already in flight. */
  | { state: "closed"; retryInSeconds: number | null };

export type SpaceConnection = {
  status: SpaceStatus;
  /** Live positions, read every frame by the renderer. Never a React state. */
  peopleRef: RefObject<WirePerson[]>;
  /**
   * Who is here, updated when the SET changes — not when they move. Carries
   * `connected` because a figure placed by activity and a person watching the
   * room are different things, and the roster is where that gets said in words.
   */
  roster: { actorId: string; kind: "human" | "agent" | null; connected: boolean; because: string | null }[];
  send: (message: ClientMessage) => void;
  /** Bumped whenever a snapshot arrives, for a scene that renders on demand. */
  onSnapshot: RefObject<(() => void) | null>;
  /**
   * What has been said since this client connected, oldest first.
   *
   * React state rather than a ref: unlike a position, an utterance is meant to
   * be read, so something has to re-render when one arrives.
   */
  heard: Utterance[];
};

/** How much of the conversation to keep in memory. Older lines are on the server. */
const HEARD_LIMIT = 60;

const socketUrl = (): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${base}/bff/space/socket`;
};

/** Backoff, capped. A tab left open overnight must not hammer the server. */
const retryDelayMs = (attempt: number) => Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));

export function useSpaceSocket(enabled: boolean): SpaceConnection {
  const [status, setStatus] = useState<SpaceStatus>({ state: "connecting" });
  const [heard, setHeard] = useState<Utterance[]>([]);
  const [roster, setRoster] = useState<
    { actorId: string; kind: "human" | "agent" | null; connected: boolean; because: string | null }[]
  >([]);
  const peopleRef = useRef<WirePerson[]>([]);
  const onSnapshot = useRef<(() => void) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;

    /**
     * The roster changes when someone joins or leaves, and not when they take a
     * step — so it is compared rather than replaced. Setting it every snapshot
     * would re-render the whole panel ten times a second to show the same list.
     */
    type Roster = {
      actorId: string;
      kind: "human" | "agent" | null;
      connected: boolean;
      /** Changes when somebody acts — rare enough to belong in React state. */
      because: string | null;
    }[];
    const rosterOf = (people: WirePerson[]): Roster =>
      people
        .map((person) => ({
          actorId: person.actorId,
          kind: person.kind,
          connected: person.connected,
          because: person.because,
        }))
        .sort((a, b) => a.actorId.localeCompare(b.actorId));
    const sameRoster = (a: Roster, b: Roster) =>
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.actorId === b[index].actorId &&
          entry.kind === b[index].kind &&
          entry.connected === b[index].connected &&
          entry.because === b[index].because,
      );

    const connect = () => {
      if (disposed) return;
      setStatus({ state: "connecting" });
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        // A heartbeat well inside the server's 45s silence limit. Standing
        // still is not the same as being gone.
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
        }, 15_000);
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "refused") {
          setStatus({ state: "refused", reason: message.reason });
          return;
        }
        if (message.type === "said") {
          // Appended rather than replacing: an utterance is an event, and the
          // list is a transcript. Capped so a room left open all day does not
          // grow without limit.
          setHeard((previous) => [...previous, message.utterance].slice(-HEARD_LIMIT));
          return;
        }
        peopleRef.current = message.people;
        setRoster((previous) => {
          const next = rosterOf(message.people);
          return sameRoster(previous, next) ? previous : next;
        });
        if (message.type === "welcome") setStatus({ state: "open", you: message.you });
        onSnapshot.current?.();
      });

      const giveUp = () => {
        window.clearInterval(pingTimer);
        if (disposed) return;
        setStatus((previous) => {
          // A refusal is a reason; do not overwrite it with a generic close.
          if (previous.state === "refused") return previous;
          return { state: "closed", retryInSeconds: Math.round(retryDelayMs(attemptRef.current) / 1000) };
        });
        peopleRef.current = [];
        setRoster([]);
        retryTimer = window.setTimeout(connect, retryDelayMs(attemptRef.current));
        attemptRef.current += 1;
      };

      socket.addEventListener("close", giveUp);
      socket.addEventListener("error", () => socket.close());
    };

    /**
     * WHAT WAS SAID BEFORE WE ARRIVED.
     *
     * The socket carries utterances as events, and an event you were not
     * connected for is one you never hear about. I told Inkstone exactly this
     * when freezing the contract — "on reconnect, refetch with GET; do not
     * assume the socket backfills" — and then did not do it here, so the
     * transcript was empty for anyone who joined after somebody spoke.
     *
     * Merged rather than replacing: a message can arrive on the socket while
     * this request is in flight, and dropping it would lose the newest line of
     * a conversation, which is the one most worth having.
     */
    void (async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const response = await fetch(`${base}/bff/space/utterances?limit=${HEARD_LIMIT}`, {
          credentials: "same-origin",
        });
        if (!response.ok || disposed) return;
        const { utterances } = (await response.json()) as { utterances: Utterance[] };
        setHeard((live) => {
          const seen = new Set(live.map((one) => one.id));
          return [...utterances.filter((one) => !seen.has(one.id)), ...live]
            .sort((a, b) => a.id - b.id)
            .slice(-HEARD_LIMIT);
        });
      } catch {
        // The room still works without the backlog; it just starts from now.
      }
    })();

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(pingTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  const send = (message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  return { status, peopleRef, roster, send, onSnapshot, heard };
}

/**
 * A move, rate-limited to the server's tick. Sending faster changes nothing.
 *
 * The "standing still" shortcut only applies when NOTHING is tracked. Once a
 * head is being reported, a person standing perfectly still on the floor is
 * still looking around, and suppressing those frames freezes their head for
 * everyone else while they are plainly moving it.
 */
export function makeMoveSender(send: (message: ClientMessage) => void, minIntervalMs = 100) {
  let lastSent = 0;
  let lastAt: Vec3 | null = null;
  let lastFacing = Number.NaN;
  return (
    at: Vec3,
    facing: number,
    tracked?: { head?: Pose; hands?: { left: Pose | null; right: Pose | null } },
  ) => {
    const now = performance.now();
    if (now - lastSent < minIntervalMs) return;
    const still =
      !tracked?.head &&
      !tracked?.hands &&
      lastAt !== null &&
      Math.abs(lastAt.x - at.x) < 0.01 &&
      Math.abs(lastAt.z - at.z) < 0.01 &&
      Math.abs(lastFacing - facing) < 0.01;
    if (still) return;
    lastSent = now;
    lastAt = { ...at };
    lastFacing = facing;
    send({ type: "move", at, facing, ...tracked });
  };
}
