import { camera, previewTicks, renderer, rig, scene, useKitMovement } from "./preview-room";
import type { JoinOptions, JoinedRoom } from "./kit";
import { retreatLevel } from "../shared/rain-retreat";
import { RainRetreatView } from "./space/rain-retreat-view";
import { createRainApproach } from "./space/rain-stone";

const AT = { x: 0, z: 0 };
const retreat = new RainRetreatView(AT);
scene.add(retreat.group);
const approach = createRainApproach();
approach.material.uniforms.uFade.value = 1;
scene.add(approach);
const review = new URLSearchParams(location.search).get("review");
if (review === "rain") {
  camera.position.set(AT.x, 1.6, AT.z + 2.3); camera.rotation.set(-.15, 0, 0);
}
if (review === "seat") { camera.position.set(AT.x, 1.1, AT.z); camera.rotation.set(-.35, .7, 0); }
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const status = document.querySelector<HTMLElement>("#status")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
let audible = false, soundBusy = false;
const toggleRain = async () => {
  if (soundBusy) return;
  soundBusy = true;
  if (audible) { retreat.mute(); audible = false; }
  else audible = await retreat.enableSound();
  sound.textContent = audible ? "Quiet the rain" : "Listen to the rain";
  sound.setAttribute("aria-pressed", String(audible));
  soundBusy = false;
};
sound.addEventListener("click", () => { void toggleRain(); });
// XR entry is a user gesture. The wrist menu can quiet the rain at any time.
renderer.xr.addEventListener("sessionstart", () => { if (!audible) void toggleRain(); });
let room: JoinedRoom | null = null;
if (location.pathname.startsWith("/s/")) {
  try {
    const kitURL = "/kit/saha.js";
    const { joinSaha } = await import(/* @vite-ignore */ kitURL) as { joinSaha: (options: JoinOptions) => JoinedRoom };
    room = joinSaha({ scene, camera, renderer, player: rig, voice: false, vrButton: false,
      buttons: [{ label: "Rain sound on / off", onPress: () => { void toggleRain(); } }] });
    // The generic guest badge goes to main. Keep this review branch on entry.
    const branch = /^\/s\/[^/]+\/@([^/]+)\//.exec(location.pathname)?.[1];
    if (branch) {
      const entry = new URL(`/go/${encodeURIComponent(room.space)}`, location.origin);
      entry.searchParams.set("branch", decodeURIComponent(branch));
      for (const link of document.querySelectorAll<HTMLAnchorElement>("a")) {
        const target = new URL(link.href);
        if (target.origin === entry.origin && target.pathname === entry.pathname) link.href = entry.href;
      }
    }
    useKitMovement();
  } catch (error) {
    document.querySelector("#error")!.textContent = `The shared room could not connect. This preview still works locally: ${error instanceof Error ? error.message : String(error)}`;
  }
}
previewTicks.add((eye, delta) => {
  const distance = Math.hypot(eye.x - AT.x, eye.z - AT.z);
  retreat.update(retreatLevel(distance), delta, reduced.matches);
  const message = distance <= 1.6 ? "A dry place in the rain. Take your time."
      : distance < 4.6 ? "The rain is gently coming into view."
        : "Follow the short path into the rain.";
  if (status.textContent !== message) status.textContent = message;
});
window.addEventListener("pagehide", () => {
  room?.leave(); retreat.dispose(); approach.geometry.dispose(); approach.material.dispose();
}, { once: true });
