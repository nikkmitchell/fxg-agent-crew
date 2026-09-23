export const JOINED_ROOM_PAGE_SIZE = 3;

export function joinedRoomSelectionPage<T extends { roomName: string }>(
  rooms: readonly T[],
  selectedRoomName: string | null,
  pageSize = JOINED_ROOM_PAGE_SIZE,
): number {
  const selectedIndex = rooms.findIndex((room) => room.roomName === selectedRoomName);
  return selectedIndex < 0 ? 0 : Math.floor(selectedIndex / Math.max(1, Math.floor(pageSize)));
}

/** Split an arbitrarily long destination name into readable, lossless pages. */
export function roomNamePages(roomName: string, pageSize = 36): string[] {
  const characters = Array.from(roomName);
  const size = Math.max(1, Math.floor(pageSize));
  if (characters.length === 0) return [""];
  const pages: string[] = [];
  for (let at = 0; at < characters.length; at += size) {
    pages.push(characters.slice(at, at + size).join(""));
  }
  return pages;
}

export function joinedRoomPage<T>(rooms: readonly T[], requestedPage: number, pageSize = JOINED_ROOM_PAGE_SIZE) {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rooms.length / size));
  const pageIndex = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1));
  const start = pageIndex * size;
  return {
    pageIndex,
    pageCount,
    rooms: rooms.slice(start, start + size),
    hasPrevious: pageIndex > 0,
    hasNext: pageIndex + 1 < pageCount,
  };
}

export function joinedRoomChoiceLabel(
  roomName: string,
  current: boolean,
  ordinal: number,
): string {
  // Preserve the actual destination name. WristButton wraps onto two lines;
  // clipping the middle can make distinct rooms look like the same target.
  return `${current ? "✓" : "·"} ${ordinal}. ${roomName}`;
}
