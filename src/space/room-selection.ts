import { useCallback, useEffect, useState } from "react";

export const DEFAULT_WEBHARNESS_ROOM = "saha.ing";
const REMEMBERED_ROOM_KEY = "saha.roomLobby.lastRoom";
const ACTIVE_ROOM_KEY = "saha.roomLobby.activeRoom";
const ROOM_PREFERENCE_HISTORY_KEY = "__sahaRoomPreference";

const cleanRoomName = (value: string | null | undefined) => value?.trim() || null;

export function roomSelectionFrom(
  search: string,
  rememberedRoom: string | null,
  urlRoomIsPreference = false,
) {
  const params = new URLSearchParams(search);
  const urlRoom = cleanRoomName(params.get("room"));
  const isPreference = urlRoomIsPreference || params.get("room-preference") === "1";
  return {
    requestedRoom: isPreference ? null : urlRoom,
    preferredRoom: isPreference ? urlRoom ?? cleanRoomName(rememberedRoom) : cleanRoomName(rememberedRoom),
  };
}

export function isRoomPreferenceHistoryState(state: unknown): boolean {
  return !!state && typeof state === "object" && ROOM_PREFERENCE_HISTORY_KEY in state
    && (state as Record<string, unknown>)[ROOM_PREFERENCE_HISTORY_KEY] === true;
}

export function roomHistoryState(state: unknown, isPreference: boolean): Record<string, unknown> {
  const next = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  if (isPreference) next[ROOM_PREFERENCE_HISTORY_KEY] = true;
  else delete next[ROOM_PREFERENCE_HISTORY_KEY];
  return next;
}

export function roomSelectionFromStorage(value: string | null): {
  requestedRoom: string | null;
  preferredRoom: string | null;
} | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("requestedRoom" in parsed) || !("preferredRoom" in parsed)) return null;
    const requested = parsed.requestedRoom;
    const preferred = parsed.preferredRoom;
    if (requested !== null && typeof requested !== "string") return null;
    if (preferred !== null && typeof preferred !== "string") return null;
    return {
      requestedRoom: cleanRoomName(requested),
      preferredRoom: cleanRoomName(preferred),
    };
  } catch {
    return null;
  }
}

export function roomUrlForSelection(currentHref: string, roomName: string | null): string {
  const url = new URL(currentHref);
  if (roomName) url.searchParams.set("room", roomName);
  else url.searchParams.delete("room");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function roomUrlWithoutPreferenceMarker(currentHref: string): string {
  const url = new URL(currentHref);
  url.searchParams.delete("room-preference");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shouldSyncRoomHistory(
  currentHref: string,
  nextHref: string,
  currentState: unknown,
  nextIsPreference: boolean,
): boolean {
  return currentHref !== nextHref || isRoomPreferenceHistoryState(currentState) !== nextIsPreference;
}

export function shouldNormalizePreferredRoomUrl(
  currentHref: string,
  roomName: string,
  requestedRoom: string | null,
  historyState: unknown,
): boolean {
  if (requestedRoom !== null || !isRoomPreferenceHistoryState(historyState)) return false;
  return new URL(currentHref).searchParams.get("room") !== roomName;
}

export function shouldRememberRoom(
  loadingRooms: boolean,
  feedRoom: string | null,
  resolvedRoom: string | null,
  requestedRoom: string | null,
): boolean {
  return !loadingRooms && !requestedRoom && !!feedRoom && feedRoom === resolvedRoom;
}

export function roomNavigationForChoice(
  currentHref: string,
  currentRoom: string | null,
  nextRoom: string,
): { replace: string | null; push: string | null } {
  const currentUrl = new URL(currentHref);
  const requestedRoom = cleanRoomName(currentUrl.searchParams.get("room"));
  let replace: string | null = null;

  // Make the room already on screen the back-button destination before the
  // first explicit switch adds its own history entry.
  if (!requestedRoom && currentRoom && currentRoom !== nextRoom) {
    currentUrl.searchParams.set("room", currentRoom);
    replace = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  }

  const nextUrl = replace ? new URL(replace, currentHref) : new URL(currentHref);
  let push: string | null = null;
  if (cleanRoomName(nextUrl.searchParams.get("room")) !== nextRoom) {
    nextUrl.searchParams.set("room", nextRoom);
    push = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  }
  return { replace, push };
}

function readRememberedRoom(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return cleanRoomName(window.localStorage.getItem(REMEMBERED_ROOM_KEY));
  } catch {
    return null;
  }
}

function readCurrentSelection() {
  if (typeof window === "undefined") return { requestedRoom: null, preferredRoom: null };
  return roomSelectionFrom(
    window.location.search,
    readRememberedRoom(),
    isRoomPreferenceHistoryState(window.history.state),
  );
}

function saveRememberedRoom(roomName: string): void {
  try {
    window.localStorage.setItem(REMEMBERED_ROOM_KEY, roomName);
  } catch {
    // Room selection still works when browser storage is disabled.
  }
}

function publishRoomSelection(requestedRoom: string | null, preferredRoom: string | null): void {
  try {
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    // sessionStorage is shared by same-origin frames in this tab, but not by
    // unrelated tabs. Room history therefore coordinates the embedded lobby
    // and its 3D scene without disturbing another tab's explicit deep link.
    window.sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ requestedRoom, preferredRoom, nonce }));
  } catch {
    // The current view still changes; only sibling same-origin views miss the update.
  }
}

/** URL requests are strict; remembered rooms are only a best-effort preference. */
export function useRoomSelection() {
  const [selection, setSelection] = useState(readCurrentSelection);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("room-preference") === "1") {
      window.history.replaceState(
        roomHistoryState(window.history.state, true),
        "",
        roomUrlWithoutPreferenceMarker(window.location.href),
      );
    }

    const syncLocation = () => {
      const locationSelection = readCurrentSelection();
      setSelection(locationSelection);
      publishRoomSelection(locationSelection.requestedRoom, locationSelection.preferredRoom);
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === REMEMBERED_ROOM_KEY) {
        // A room in a locally-created history entry is a preference scoped to
        // this navigation path; another tab must not silently change it.
        if (!isRoomPreferenceHistoryState(window.history.state)) {
          setSelection((current) => ({ ...current, preferredRoom: cleanRoomName(event.newValue) }));
        }
        return;
      }
      if (event.key !== ACTIVE_ROOM_KEY) return;
      let sessionStorage: Storage;
      try {
        sessionStorage = window.sessionStorage;
      } catch {
        return;
      }
      if (event.storageArea !== sessionStorage) return;
      const nextSelection = roomSelectionFromStorage(event.newValue);
      if (!nextSelection) return;
      const selectedRoom = nextSelection.requestedRoom ?? nextSelection.preferredRoom;
      const nextHref = roomUrlForSelection(window.location.href, selectedRoom);
      const nextIsPreference = nextSelection.requestedRoom === null && selectedRoom !== null;
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (shouldSyncRoomHistory(currentHref, nextHref, window.history.state, nextIsPreference)) {
        window.history.replaceState(
          roomHistoryState(window.history.state, nextIsPreference),
          "",
          nextHref,
        );
      }
      setSelection(nextSelection);
    };

    window.addEventListener("popstate", syncLocation);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("storage", syncStorage);
    };
  }, [selection.requestedRoom]);

  const rememberRoom = useCallback((roomName: string) => {
    const cleaned = cleanRoomName(roomName);
    if (!cleaned) return;
    saveRememberedRoom(cleaned);
    const nextSelection = { requestedRoom: selection.requestedRoom, preferredRoom: cleaned };
    publishRoomSelection(nextSelection.requestedRoom, nextSelection.preferredRoom);
    setSelection(nextSelection);
  }, [selection.requestedRoom]);

  const chooseRoom = useCallback((roomName: string, currentRoom: string | null) => {
    const cleaned = cleanRoomName(roomName);
    if (!cleaned) return;

    const navigation = roomNavigationForChoice(window.location.href, currentRoom, cleaned);
    if (navigation.replace) {
      window.history.replaceState(roomHistoryState(window.history.state, true), "", navigation.replace);
    }
    if (navigation.push) {
      window.history.pushState(roomHistoryState(window.history.state, true), "", navigation.push);
    }

    const promotingCurrentLink = !navigation.replace && !navigation.push && selection.requestedRoom === cleaned;
    if (promotingCurrentLink) {
      window.history.replaceState(
        roomHistoryState(window.history.state, true),
        "",
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    }
    const locallySelected = !!navigation.replace || !!navigation.push || promotingCurrentLink
      || isRoomPreferenceHistoryState(window.history.state);
    const requestedRoom = locallySelected ? null : selection.requestedRoom;

    saveRememberedRoom(cleaned);
    publishRoomSelection(requestedRoom, cleaned);
    setSelection({ requestedRoom, preferredRoom: cleaned });
  }, [selection.requestedRoom]);

  return {
    requestedRoom: selection.requestedRoom,
    preferredRoom: selection.preferredRoom ?? DEFAULT_WEBHARNESS_ROOM,
    rememberRoom,
    chooseRoom,
  };
}
