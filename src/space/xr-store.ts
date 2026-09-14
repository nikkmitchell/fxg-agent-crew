import { createXRStore, type XRStore } from "@react-three/xr";

/**
 * One XR store for the page.
 *
 * A singleton rather than a `useMemo`, because two modules behind the lazy
 * boundary need the SAME store — the scene, which renders the session, and the
 * headset controls, which start it. Re-creating it would drop a live session,
 * which in a headset means the room disappearing mid-sentence.
 *
 * Created on first use so that importing this module does not touch WebXR.
 */
let store: XRStore | null = null;

/**
 * PINCH TO TELEPORT, OFF UNLESS SOMEBODY TURNS IT ON.
 *
 * Nikk, once the palm joystick worked: "remove the pinch to teleport but...
 * keep it in... add it into the settings and have it be off by default... if
 * you're on hand controls it's the palm up movement". A pinch is also how you
 * press things, so a teleport arc on the left hand fired when it was not
 * wanted — the "very finicky" that started the joystick.
 *
 * HANDS ONLY. A controller's teleport is a deliberate trigger pull, and a
 * controller has a thumbstick besides; neither was the complaint.
 *
 * Remembered in this browser, because it is a preference about one person's
 * hands, not about the room.
 */
const PINCH_TELEPORT_KEY = "saha.pinch-teleport";

function readPinchTeleport(): boolean {
  try {
    return window.localStorage.getItem(PINCH_TELEPORT_KEY) === "on";
  } catch {
    return false;
  }
}

const handOptions = { model: true, pinchTeleport: readPinchTeleport() };

export function pinchTeleportEnabled(): boolean {
  return handOptions.pinchTeleport;
}

export function getXRStore(): XRStore {
  store ??= createXRStore({
    /**
     * TELEPORT ON THE LEFT HAND AND THE LEFT CONTROLLER.
     *
     * Not a preference — the XREAL Aura has no thumbstick, so smooth locomotion
     * left Nikk standing in one place unable to move at all. A teleport arc
     * needs only the gesture every headset has: a pinch, or a trigger.
     *
     * LEFT ONLY, matching the stick it stands in for, so the right hand keeps a
     * plain ray for pointing at things. `default: true` leaves every other
     * input source exactly as it was.
     */
    hand: { left: { teleportPointer: handOptions.pinchTeleport }, default: true },
    controller: { left: { teleportPointer: true }, default: true },
    /**
     * QUEST SYSTEM KEYBOARD INPUT.
     *
     * The keyboard itself only needs a real DOM input to be focused, but the
     * review card can also be composited over an XR session on browsers that
     * support the optional DOM Overlay feature. Keep the request explicit:
     * RoomControls contains that textarea now, so this is no longer a library
     * default we happen to benefit from.
     */
    domOverlay: true,
    /**
     * The emulator only activates on localhost when there is no real WebXR, and
     * it is the only way any of the immersive code gets exercised without
     * hardware. Left on deliberately: the assets it needs are separate chunks
     * that a real headset never downloads.
     *
     * WITHOUT ITS SYNTHETIC ROOMS. They are five furnished environments —
     * `music_room` alone is 2 MB — meant for people who have no scene of their
     * own to stand in, and we have one.
     *
     * THAT IS THE ONLY CLAIM MADE HERE. The emulated view is currently black,
     * and switching the rooms off did NOT fix it: `@iwer/devui` bundles its own
     * copy of three.js and throws `onBuild is not a function` on every frame
     * against three 0.186. So the emulator still cannot show what a session
     * looks like, and nothing below this line has been seen rather than
     * reasoned about. What the emulator DID prove is in `enterRoom`.
     */
    emulate: { type: "metaQuest3", syntheticEnvironment: false },
  });
  return store;
}

/**
 * Go in, in whichever mode this headset can actually offer.
 *
 * WHY NOT JUST `enterVR`. An `immersive-vr` session is opaque by definition:
 * the compositor shows nothing behind what we draw. So on the Aura, where Nikk
 * pressed our button, the room appeared in a black void — while on the Quest,
 * where the browser's own offer had asked for `immersive-ar`, the same build
 * showed the room over the actual living room. One build, two behaviours, and
 * the difference was entirely in what the session had been asked for.
 *
 * `immersive-ar` first, therefore, and `immersive-vr` when the device has no
 * such thing. Whether the passthrough is then VISIBLE is a separate question
 * answered inside the scene, by a sphere that can be switched off — see
 * `Backdrop.tsx`. Asking for the blendable session costs nothing on a headset
 * that cannot blend.
 *
 * THIS MUCH IS MEASURED, against the emulated Quest 3 in a desktop browser:
 * pressing the button now calls `requestSession("immersive-ar")`, and the
 * session that comes back reports `environmentBlendMode: "alpha-blend"` —
 * the blending Aura was not getting. What it looks like through the lenses is
 * still Nikk's to say.
 */
export async function enterRoom(): Promise<void> {
  const xr = getXRStore();
  // ASK FOR IT RATHER THAN ASKING ABOUT IT.
  //
  // The first version checked `isSessionSupported("immersive-ar")` first and
  // only then requested one. On the XREAL Aura that check is the thing that
  // failed — Nikk got teleport, which is session-independent, and a black void,
  // which is what an `immersive-vr` fallback looks like. A device that answers
  // "no" to the question and "yes" to the request is a device the question was
  // lying about, and requesting costs one rejected promise to find out.
  try {
    if (await xr.enterAR()) return;
  } catch {
    // Genuinely no AR. Fall through rather than leaving somebody outside.
  }
  await xr.enterVR();
}

export type { XRStore };

/**
 * Show or hide the hand and controller models.
 *
 * WHY THIS IS A SETTING. Nikk records from inside the headset, and the rendered
 * hands sit in front of whatever he is recording: "sometimes they get in the
 * way of in headset recording". Nothing else can move them out of shot — they
 * are drawn where his hands actually are.
 *
 * ONLY THE MODEL GOES. The teleport pointer on the left, the ray on the right
 * and every pinch and trigger keep working exactly as before, because those are
 * separate options on the same input source. Hiding the mesh must not quietly
 * take away the ability to press things, which would be a far worse trade than
 * the one being asked for.
 *
 * Every option is restated each time, from `handOptions`. `setHand` REPLACES
 * the implementation, so anything left out is switched off — hiding the hands
 * must not also switch off the teleport somebody chose to turn on.
 */
export function showHandModels(shown: boolean): void {
  handOptions.model = shown;
  applyHandOptions();
}

/** Turn pinch-to-teleport on the left hand on or off, and remember the choice. */
export function setPinchTeleport(on: boolean): void {
  handOptions.pinchTeleport = on;
  try {
    window.localStorage.setItem(PINCH_TELEPORT_KEY, on ? "on" : "off");
  } catch {
    // A private window keeps the choice for this session only.
  }
  applyHandOptions();
}

function applyHandOptions(): void {
  const xr = getXRStore();
  xr.setHand({ model: handOptions.model, teleportPointer: handOptions.pinchTeleport }, "left");
  xr.setHand({ model: handOptions.model }, "right");
  xr.setController({ model: handOptions.model, teleportPointer: true }, "left");
  xr.setController({ model: handOptions.model }, "right");
}
