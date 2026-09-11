import { getXRStore } from "./xr-store";
import type { Comfort } from "./comfort";

/**
 * The button that puts you in the room, and the one setting that matters.
 *
 * Behind the same lazy boundary as the scene — it imports the XR store, and
 * anything that does belongs outside the main bundle.
 */
export default function HeadsetControls({
  comfort,
  setComfort,
  inHeadset,
}: {
  comfort: Comfort;
  setComfort: (update: (current: Comfort) => Comfort) => void;
  inHeadset: boolean;
}) {
  return (
    <div className="space-headset">
      <button type="button" className="primary-action" onClick={() => void getXRStore().enterVR()}>
        {inHeadset ? "You are in the room" : "Enter in your headset"}
      </button>
      <label className="space-setting">
        <input
          type="checkbox"
          checked={comfort.turn === "smooth"}
          onChange={(event) =>
            setComfort((current) => ({
              ...current,
              turn: event.currentTarget.checked ? "smooth" : "snap",
            }))
          }
        />
        <span>
          Smooth turning instead of snap. Smoother to look at, and the most common cause of motion
          sickness — try snap first.
        </span>
      </label>
      <p className="muted-note">
        Left stick walks, right stick turns. This is the one part of the room nobody has tested on
        hardware; if it behaves oddly that is worth reporting rather than working around.
      </p>
    </div>
  );
}
