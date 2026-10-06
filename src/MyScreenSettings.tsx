import { base } from "./router";
import { setMyScreen, useMyScreenLive, useScreenShare } from "./space/screen-share";

/**
 * ME: MY SCREEN, in the website's settings. One toggle (Nikk, 7244): Show my
 * screen opens it in front of you in the room and, where this browser can,
 * shares it; "not sharing" is said here, never as an empty screen in the room.
 * Being signed in is enough: no room needs entering first (7227). The same
 * toggle is under Me in the room's own menu in a headset.
 */
export function MyScreenSettings({ you }: { you: string | null }) {
  const share = useScreenShare();
  useMyScreenLive(base, you);
  const live = share.live || share.sharing;
  return (
    <section className="settings-me" aria-label="Me">
      <h3>Me</h3>
      <label className="toggle-row">
        <input type="checkbox" checked={share.shown} onChange={() => setMyScreen(!share.shown, base)} />
        <span>Show my screen</span>
        <small className="muted-note">
          {share.starting ? "Choose what to share…" : live ? "Sharing: your rooms can see it." : "Opens it in front of you in the room, and shares this screen."}
        </small>
      </label>
      {share.problem ? <p className="muted-note">{share.problem}</p> : null}
      {!live && !share.starting ? (
        <p className="muted-note">
          Not sharing. Go to <a href={`${base}/share`} target="_blank" rel="noopener noreferrer">saha.ing/share</a> to share your screen.
        </p>
      ) : null}
    </section>
  );
}
