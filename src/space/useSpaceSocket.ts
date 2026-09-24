import type { Meditation } from "../../shared/meditation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  ClientMessage,
  Placement,
  Pose,
  ServerMessage,
  Showing,
  WirePerson,
} from "../../shared/space-wire";
import type { Utterance } from "../../shared/voice";
import type { Vec3 } from "../../shared/space-layout";
import { mergeRoomItems, withFresher, type RoomItem } from "../../shared/room-items";
import { base } from "../router";
import { backoff } from "../backoff";
import { space } from "../space-client";

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
  /** Apply a table as the server just answered with it. Never goes backwards. */
  applyRoomItem: (item: RoomItem) => void;
  /** Take a deleted table out now, rather than waiting on a socket that may be reconnecting. */
  removeRoomItem: (id: string) => void;
  status: SpaceStatus;
  /** Live positions, read every frame by the renderer. Never a React state. */
  peopleRef: RefObject<WirePerson[]>;
  /**
   * Who is here, updated when the SET changes — not when they move. Carries
   * `connected` because a figure placed by activity and a person watching the
   * room are different things, and the roster is where that gets said in words.
   */
  roster: {
    actorId: string;
    kind: "human" | "agent" | null;
    connected: boolean;
    because: string | null;
    /**
     * The body they chose, or null if they have not chosen one.
     *
     * NOT OPTIONAL HERE, though it is on the wire. `WirePerson.body` may be
     * absent because a server that predates the feature never sent it; this
     * roster is built in this file and always sets it, so an optional field
     * would invite a caller to handle a case that cannot happen.
     */
    body: string | null;
  }[];
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
  /** The newest utterance received live on the socket. History never enters here. */
  liveUtterance: Utterance | null;
  /** Where every panel hangs. Empty until the socket says; see the note above. */
  places: Placement[];
  /**
   * Which panels the room has open, or null until the room has said.
   *
   * NULL IS NOT "NONE". Before the socket answers we do not know, and showing
   * an empty arc would be a claim — the same distinction `showing` makes for
   * the project nobody has chosen.
   */
  openPanels: string[] | null;
  /**
   * What the room is showing, as everybody in it sees it.
   *
   * Carried on the socket rather than fetched, so a change one person makes
   * reaches the rest of the room at once — which is the only reason it is
   * shared state instead of a setting.
   */
  showing: Showing;
  /** The room's shared breathing session; null until it has been read. */
  meditation: Meditation | null;
  setMeditation: (session: Meditation) => void;
  roomItems: RoomItem[];
  /**
   * Listen to every frame the server sends, raw.
   *
   * For things this hook deliberately does not interpret — voice signalling is
   * the only one — so that the room's own state stays about who is here and
   * where they are. Returns the function that stops listening.
   */
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
};

/** How much of the conversation to keep in memory. Older lines are on the server. */
const HEARD_LIMIT = 60;

const socketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${base}/bff/space/socket`;
};

/**
 * Backoff, capped low: somebody is standing in a room waiting for this to come
 * back. `attemptRef` counts retries already made, so the first one is number 1.
 */
const retryDelayMs = (retriesSoFar: number) => backoff(retriesSoFar + 1, 30_000);

export function useSpaceSocket(enabled: boolean): SpaceConnection {
  const [status, setStatus] = useState<SpaceStatus>({ state: "connecting" });
  const [heard, setHeard] = useState<Utterance[]>([]);
  const [liveUtterance, setLiveUtterance] = useState<Utterance | null>(null);
  /**
   * Where the panels hang, which is shared and can change under you.
   *
   * Empty until `welcome` arrives. The scene falls back to the computed arc
   * while it is, so the room draws itself on the first frame rather than
   * appearing empty and then filling in.
   */
  const [places, setPlaces] = useState<Placement[]>([]);
  const [openPanels, setOpenPanels] = useState<string[] | null>(null);
  const [showing, setShowing] = useState<Showing>({
    projectId: null,
    boardId: null,
    setBy: null,
    setAt: null,
  });
  const [roomItems, setRoomItems] = useState<RoomItem[]>([]);
  /** The room's breathing session. Null until fetched; the socket keeps it current. */
  const [meditation, setMeditation] = useState<Meditation | null>(null);
  /**
   * Anybody who wants every frame, as it arrives.
   *
   * A ref rather than state: adding a listener must not re-open the socket, and
   * a set that changed identity on every render would do exactly that.
   */
  const listeners = useRef(new Set<(message: ServerMessage) => void>());
  const [roster, setRoster] = useState<SpaceConnection["roster"]>([]);
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
      /**
       * The body they chose. React state rather than a per-frame read, because
       * swapping a model is remounting several megabytes: it must happen when
       * the choice changes and never once a tick. Rare, like `because`.
       */
      body: string | null;
    }[];
    const rosterOf = (people: WirePerson[]): Roster =>
      people
        .map((person) => ({
          actorId: person.actorId,
          kind: person.kind,
          connected: person.connected,
          because: person.because,
          body: person.body ?? null,
        }))
        .sort((a, b) => a.actorId.localeCompare(b.actorId));
    const sameRoster = (a: Roster, b: Roster) =>
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.actorId === b[index].actorId &&
          entry.kind === b[index].kind &&
          entry.connected === b[index].connected &&
          entry.because === b[index].because &&
          entry.body === b[index].body,
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
        // Anything that wants the raw stream gets it first and unfiltered —
        // voice signalling is the only user today and it is deliberately not
        // interpreted here, because this hook's job is who is in the room.
        for (const listener of listeners.current) listener(message);
        if (message.type === "voice" || message.type === "voicePresence" || message.type === "touched") return;
        if (message.type === "refused") {
          setStatus({ state: "refused", reason: message.reason });
          return;
        }
        if (message.type === "panelMoved") {
          // Somebody dragged a panel. Replaced by id rather than appended:
          // this is a position, not an event, and the newest one is the only
          // one worth keeping.
          setPlaces((previous) => [
            ...previous.filter((place) => place.id !== message.panel.id),
            message.panel,
          ]);
          return;
        }
        if (message.type === "panelsOpen") {
          // WHICH PANELS EXIST IS SHARED NOW, so this arrives the same way a
          // move does. A position rather than an event: the frame carries the
          // whole set, so only the newest answer matters and a missed frame
          // cannot leave this drifting from the room.
          setOpenPanels(message.open);
          return;
        }
        if (message.type === "showing") {
          // Somebody changed what is on the wall. A position, not an event:
          // only the newest answer matters.
          setShowing(message.showing);
          return;
        }
        if (message.type === "meditation") {
          // The breath itself is worked out on each device from this; see
          // shared/meditation.ts. Only the newest session matters.
          setMeditation((current) => (current && current.revision > message.meditation.revision ? current : message.meditation));
          return;
        }
        if (message.type === "roomItems") {
          // Merged, never taken at face value: an older broadcast can land after
          // a newer answer has already been applied. See mergeRoomItems.
          setRoomItems((current) => mergeRoomItems(current, message.items));
          return;
        }
        if (message.type === "said") {
          // Appended rather than replacing: an utterance is an event, and the
          // list is a transcript. Capped so a room left open all day does not
          // grow without limit.
          setHeard((previous) => [...previous, message.utterance].slice(-HEARD_LIMIT));
          setLiveUtterance(message.utterance);
          return;
        }
        peopleRef.current = message.people;
        setRoster((previous) => {
          const next = rosterOf(message.people);
          return sameRoster(previous, next) ? previous : next;
        });
        if (message.type === "welcome") {
          setStatus({ state: "open", you: message.you });
          setPlaces(message.panels);
          setShowing(message.showing);
          setRoomItems((current) => mergeRoomItems(current, message.items));
        }
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
        const { utterances } = await space.said(HEARD_LIMIT);
        if (disposed) return;
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

  const subscribe = useCallback((listener: (message: ServerMessage) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  /**
   * Apply a table as the server just answered with it, without waiting for the
   * socket — which, in a headset on a flaky link, may not deliver it for a long
   * time, and until it does every change to that table is refused as stale.
   */
  const applyRoomItem = useCallback((item: RoomItem) => setRoomItems((current) => withFresher(current, item)), []);
  const removeRoomItem = useCallback((id: string) => setRoomItems((current) => current.filter((item) => item.id !== id)), []);

  return {
    applyRoomItem,
    removeRoomItem,
    status,
    peopleRef,
    roster,
    send,
    onSnapshot,
    heard,
    liveUtterance,
    places,
    openPanels,
    showing,
    roomItems,
    meditation,
    setMeditation,
    subscribe,
  };
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
