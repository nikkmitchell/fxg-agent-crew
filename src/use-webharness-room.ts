import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LoginRequest } from "../shared/contracts";
import { bff, BffRequestError } from "./bff-client";
import { initialConnectionState, reduceConnection } from "./connection-state";

export const retryDelay = (attempt: number) => Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 15_000);

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
      .then(({ username, kind }) => {
        dispatch({ type: "SESSION_READY", username, kind });
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
        try {
          const page = await bff.messages(roomName, { afterId: cursor, wait: 25, signal: controller.signal });
          if (controller.signal.aborted) return;
          cursor = page.cursor ?? cursor;
          attempt = 0;
          dispatch({ type: "MESSAGES_RECEIVED", messages: page.messages, cursor: page.cursor });
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
      const { username, kind } = await bff.login(credentials);
      dispatch({ type: "LOGIN_SUCCEEDED", username, kind });
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

  useEffect(() => {
    if (state.phase !== "connected" || !navigator.onLine) return;
    for (const item of state.outbox) {
      if (item.state === "queued") void sendOne(item.clientId, item.content);
    }
  }, [sendOne, state.outbox, state.phase]);

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
