import type { SahaRoom } from "../connect";
import type { PieceHost, PieceHostOptions } from "./host";

/**
 * A LIVE PIECE'S SHARED VALUES AND MOMENTS LIVE IN ITS SPACE'S HUB, filed
 * under the piece: p/<piece>/<key>. So the drums in the saha.ing room and the
 * drums in xr.instruments' own page are one set of drums: a hit in either is
 * heard in both, and the tempo set in one is the tempo in the other.
 */
export const pieceKey = (piece: string, key: string): string => `p/${piece}/${key}`;

/** This piece's values, out of the space's whole state. */
export function pieceState(state: Record<string, unknown>, piece: string): Record<string, unknown> {
  const prefix = pieceKey(piece, "");
  return Object.fromEntries(Object.entries(state).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
}

type Room = Pick<SahaRoom, "set" | "emit" | "on" | "you">;

/**
 * Connect a piece's host to the space's hub: what it shares goes out under its
 * name, and what everyone else changes comes back to it. Returns the share to
 * give the host, and `attach(host)`, which returns the unsubscribe.
 */
export function pieceSync(room: Room, piece: string): { share: PieceHostOptions["share"]; attach: (host: Pick<PieceHost, "receiveState" | "receiveEvent">) => () => void } {
  const prefix = pieceKey(piece, "");
  // What this page last set, so the hub's echo of it (the hub tells everyone,
  // the sender too) is not played to the piece a second time.
  const mine = new Map<string, string>();
  return {
    share: {
      set: (key, value) => {
        mine.set(key, JSON.stringify(value ?? null));
        room.set(pieceKey(piece, key), value);
      },
      emit: (name, data) => room.emit(pieceKey(piece, name), data),
    },
    attach: (host) => {
      const offState = room.on("state", (key, value, by) => {
        if (!key.startsWith(prefix)) return;
        const own = key.slice(prefix.length);
        if (by === room.you?.name && mine.get(own) === JSON.stringify(value ?? null)) {
          mine.delete(own);
          return;
        }
        host.receiveState(own, value, by);
      });
      const offEvent = room.on("event", (name, data, from) => {
        if (name.startsWith(prefix)) host.receiveEvent(name.slice(prefix.length), data, from);
      });
      return () => {
        offState();
        offEvent();
      };
    },
  };
}
