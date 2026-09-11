/**
 * What fills the space while the room is arriving.
 *
 * It was four words of body text in the corner of a black rectangle, which on a
 * headset — where the download is a megabyte over whatever wifi is in the room —
 * looked identical to nothing happening at all.
 *
 * The line it shows is the REAL stage, not a script of invented ones. There are
 * only two things it can be waiting for and it says which: the 3D code, then
 * the room itself. No fake percentage, because nothing here knows one.
 */
export function RoomLoading({ what }: { what: string }) {
  return (
    <div className="room-loading" role="status" aria-live="polite">
      <div className="room-loading-mark" aria-hidden="true">
        <span />
        <span />
      </div>
      <p className="room-loading-title">Entering the room</p>
      <p className="room-loading-what">{what}</p>
    </div>
  );
}
