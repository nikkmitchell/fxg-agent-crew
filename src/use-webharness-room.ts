import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LoginRequest } from "../shared/contracts";
import { bff, BffRequestError } from "./bff-client";
import { initialConnectionState, reduceConnection } from "./connection-state";

export const retryDelay = (attempt: number) => Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 15_000);

/**
 * A floor on how often we may ask for messages.
 *
 * The loop assumes the server honours `wait=25` and holds the connection. When
 * something in the path does not — a proxy that terminates long polls, a
 * gateway that buffers, a server that ignores the parameter — every request
 * returns instantly and the loop reissues it instantly. Measured against a
 * stand-in that ignores `wait`: over a hundred thousand requests from one idle
 * tab, throttled only by the speed of the network.
 *
 * Nobody would notice locally. In front of a real server it is one client
 * quietly generating a denial of service, and the only symptom on this end is
 * a fan.
 *
 * 500ms rather than something larger: an empty response should still be rare,
 * so this must not add latency to the normal case, only bound the abnormal one.
 */
export const MIN_POLL_INTERVAL_MS = 500;

const errorCode = (error: unknown) => error instanceof BffRequestError ? error.code : "UPSTREAM_UNAVAILABLE";

const waitForRetry = (delay: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, delay);
  signal.addEventListener("abort", () => {
    window.clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

export function useWebharnessRoom() {
  const [state, dispatch] = useReducer(reduceConnection, initialConnectionState);
  const [run, setRun] = useState(0);
  const selectedRoomRef = useRef<string | undefined>(undefined);

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    try {
      dispatch({ type: "ROOMS_LOADED", rooms: await bff.rooms(signal) });
    } catch (error) {
      dispatch({ type: "POLL_FAILED", code: errorCode(error) });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    bff.me(controller.signal)
      .then(({ username }) => {
        dispatch({ type: "SESSION_READY", username });
        return loadRooms(controller.signal);
      })
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: "SESSION_MISSING" });
      });
    return () => controller.abort();
  }, [loadRooms]);

  useEffect(() => {
    const offline = () => dispatch({ type: "BROWSER_OFFLINE" });
    const online = () => {
      dispatch({ type: "BROWSER_ONLINE" });
      setRun((value) => value + 1);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    const roomName = selectedRoomRef.current;
    if (!roomName) return;
    const controller = new AbortController();

    const connect = async () => {
      let cursor: number | undefined;
      let attempt = 0;
      try {
        const detail = await bff.room(roomName, controller.signal);
        if (controller.signal.aborted) return;
        dispatch({ type: "ROOM_CONNECTED", room: detail });

        const initial = await bff.messages(roomName, { wait: 0, signal: controller.signal });
        if (controller.signal.aborted) return;
        cursor = initial.cursor ?? 0;
        dispatch({ type: "MESSAGES_RECEIVED", messages: initial.messages, cursor: initial.cursor });
      } catch (error) {
        if (!controller.signal.aborted) dispatch({ type: "POLL_FAILED", code: errorCode(error) });
        return;
      }

      while (!controller.signal.aborted) {
        if (!navigator.onLine) {
          await waitForRetry(1_000, controller.signal).catch(() => undefined);
          continue;
        }
        const startedAt = Date.now();
        try {
          const page = await bff.messages(roomName, { afterId: cursor, wait: 25, signal: controller.signal });
          if (controller.signal.aborted) return;
          cursor = page.cursor ?? cursor;
          attempt = 0;
          dispatch({ type: "MESSAGES_RECEIVED", messages: page.messages, cursor: page.cursor });
          // See MIN_POLL_INTERVAL_MS. A poll that returns immediately must not
          // be reissued immediately.
          const elapsed = Date.now() - startedAt;
          if (elapsed < MIN_POLL_INTERVAL_MS) {
            await waitForRetry(MIN_POLL_INTERVAL_MS - elapsed, controller.signal).catch(() => undefined);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          const code = errorCode(error);
          dispatch({ type: "POLL_FAILED", code });
          if (!(error instanceof BffRequestError) || !error.retryable) return;
          attempt += 1;
          await waitForRetry(retryDelay(attempt), controller.signal).catch(() => undefined);
        }
      }
    };

    void connect();
    return () => controller.abort();
  }, [run]);

  const login = useCallback(async (credentials: LoginRequest) => {
    dispatch({ type: "LOGIN_STARTED" });
    try {
      const { username } = await bff.login(credentials);
      dispatch({ type: "LOGIN_SUCCEEDED", username });
      await loadRooms();
    } catch (error) {
      dispatch({ type: "LOGIN_FAILED", code: errorCode(error) });
    }
  }, [loadRooms]);

  const logout = useCallback(async () => {
    try {
      await bff.logout();
    } finally {
      selectedRoomRef.current = undefined;
      dispatch({ type: "LOGGED_OUT" });
      setRun((value) => value + 1);
    }
  }, []);

  const selectRoom = useCallback((roomName: string) => {
    selectedRoomRef.current = roomName;
    dispatch({ type: "ROOM_SELECTED", roomName });
    setRun((value) => value + 1);
  }, []);

  const sendOne = useCallback(async (clientId: string, content: string) => {
    const roomName = selectedRoomRef.current;
    if (!roomName) return;
    dispatch({ type: "MESSAGE_SENDING", clientId });
    try {
      const message = await bff.sendMessage(roomName, content);
      dispatch({ type: "MESSAGE_ACKNOWLEDGED", clientId, message });
    } catch (error) {
      dispatch({ type: "MESSAGE_FAILED", clientId, code: errorCode(error) });
    }
  }, []);

  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2_000 || !selectedRoomRef.current) return;
    const clientId = crypto.randomUUID();
    dispatch({ type: "MESSAGE_QUEUED", clientId, content: trimmed });
    if (navigator.onLine) void sendOne(clientId, trimmed);
  }, [sendOne]);

  const retryMessage = useCallback((clientId: string) => {
    const item = state.outbox.find((candidate) => candidate.clientId === clientId);
    if (item && navigator.onLine) void sendOne(item.clientId, item.content);
  }, [sendOne, state.outbox]);

  /**
   * Send anything queued, whenever sending becomes possible again.
   *
   * `state.online` is in the dependencies, and that is the whole fix. This used
   * to watch only `state.phase`, on the assumption that losing the network
   * would move it to "reconnecting" and regaining it would move it back — so
   * the return to "connected" was the signal to flush.
   *
   * It does not work that way when the browser reports offline while the
   * connection still functions: flaky wifi, a captive portal, a lid closed and
   * reopened, or simply a spurious `offline` event. The poll kept succeeding,
   * every response reset phase to "connected", and by the time the `online`
   * event arrived there was no transition left to observe. The queued message
   * stayed queued — under a receipt that said "waiting for the connection ·
   * will send itself".
   *
   * Reproduced in a browser: 45 seconds after coming back online, still queued,
   * zero copies delivered, and the reassuring line gone from the screen. Losing
   * a message is bad; telling someone it is on its way and then not sending it
   * is worse, because they stop watching for it.
   */
  useEffect(() => {
    if (state.phase !== "connected" || !state.online) return;
    for (const item of state.outbox) {
      if (item.state === "queued") void sendOne(item.clientId, item.content);
    }
  }, [sendOne, state.outbox, state.phase, state.online]);

  const retry = useCallback(() => {
    dispatch({ type: "RETRY_REQUESTED" });
    if (selectedRoomRef.current) {
      setRun((value) => value + 1);
    } else {
      void loadRooms();
    }
  }, [loadRooms]);

  return { state, login, logout, selectRoom, retry, sendMessage, retryMessage };
}
