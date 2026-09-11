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

export function getXRStore(): XRStore {
  store ??= createXRStore({
    hand: true,
    controller: true,
    // The emulator only activates on localhost when there is no real WebXR, and
    // it is the only way any of the immersive code gets exercised without
    // hardware. Left on deliberately: the assets it needs are separate chunks
    // that a real headset never downloads.
    emulate: true,
  });
  return store;
}

export type { XRStore };
