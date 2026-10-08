/**
 * THE ROOM'S MENU, OPENED FROM THE PAGE (Nikk: "the menu settings button ... in the top right hand corner of the
 * non VR 3d window"). The button is HTML beside the canvas; the menu is RoomControls', in the scene. This is the
 * one wire between them.
 */
const listeners = new Set<() => void>();
export const requestRoomMenu = (): void => {
  for (const listener of listeners) listener();
};
export const onRoomMenuRequest = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Close the menu: the room changed under it (Mica 7513: after a door, it stayed open and too close). */
const closers = new Set<() => void>();
export const closeRoomMenu = (): void => {
  for (const closer of closers) closer();
};
export const onRoomMenuClose = (listener: () => void): (() => void) => {
  closers.add(listener);
  return () => closers.delete(listener);
};
