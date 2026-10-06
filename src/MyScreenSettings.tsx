import { base } from "./router";
import { canShareScreen, setMyScreenShown, startScreenShare, stopScreenShare, useScreenShare } from "./space/screen-share";

/**
 * ME: MY SCREEN, in the website's settings (Nikk, 7227: "so long as I am logged
 * into Saha.ing I should be able to screenshare (add it as an option under me
 * in the settings, a toggle)"). No room needs entering first. The same two
 * toggles are under Me in the room's own menu in a headset.
 */
export function MyScreenSettings() {
  const share = useScreenShare();
  const on = share.sharing || share.starting;
  const capable = canShareScreen();
  return (
    <section className="settings-me" aria-label="Me">
      <h3>Me</h3>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={on}
          disabled={!capable && !on}
          onChange={() => void (on ? stopScreenShare() : startScreenShare(base))}
        />
        <span>Share my screen</span>
        <small className="muted-note">
          {!capable ? "This browser cannot share a screen." : share.starting ? "Choose what to share…" : share.sharing ? "On: your rooms can see it." : "Off"}
        </small>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={share.shown} onChange={() => setMyScreenShown(!share.shown)} />
        <span>Show my screen in the room</span>
        <small className="muted-note">Opens in front of you there; drag its top bar to move it.</small>
      </label>
      {share.problem ? <p className="muted-note">{share.problem}</p> : null}
    </section>
  );
}
