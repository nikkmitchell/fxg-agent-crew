/**
 * A THING'S DOOR TO ANOTHER ROOM (ctx.rooms.go; Mica, open-source-library-b2425a2a): the room page switches rooms
 * in place, keeping the page and the headset session, exactly as the lobby's doors do (SpacePanel's switchRoom).
 * The engine asks; the page goes. One wire, so neither has to know the other.
 */
type Go = (room: string) => Promise<void>;
let going: Go | null = null;

export const provideRoomGo = (go: Go | null): (() => void) => {
  going = go;
  return () => {
    if (going === go) going = null;
  };
};

export const requestRoomGo = (room: string): Promise<void> =>
  going ? going(room) : Promise.reject(Object.assign(new Error("This page cannot change rooms."), { why: "not-here" }));
