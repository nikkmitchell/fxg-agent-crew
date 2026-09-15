import { enterRoom } from "./xr-store";
import type { Comfort } from "./comfort";

/**
 * The button that puts you in the room.
 *
 * ABOVE THE VIEW, IN THE MIDDLE. Nikk: "make the enter in your headset button
 * ... above the 3d view and in the middle of the screen". It used to be the top
 * of the side column, which in a headset's browser is a narrow strip off to the
 * right of the thing you came to enter — the one button that matters, placed
 * where you look last.
 *
 * Behind the same lazy boundary as the scene — it imports the XR store, and
 * anything that does belongs outside the main bundle.
 */
export function EnterHeadsetButton({ inHeadset }: { inHeadset: boolean }) {
  return (
    <button type="button" className="primary-action space-enter-headset" onClick={() => void enterRoom()}>
      {inHeadset ? "You are in the room" : "Enter in your headset"}
    </button>
  );
}

/** The headset's one setting that matters, and how to move, beside the view. */
export default function HeadsetControls({
  comfort,
  setComfort,
}: {
  comfort: Comfort;
  setComfort: (update: (current: Comfort) => Comfort) => void;
}) {
  return (
    <div className="space-headset">
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
        Left stick walks and right stick turns where there are sticks. On hands, hold a palm up
        for a second and push the ball that appears: left hand walks, right hand turns. Pinch to
        teleport is off unless you turn it on in the headset&rsquo;s settings menu. A button by
        your left hip switches passthrough off for a black void and back on again.
      </p>
    </div>
  );
}
