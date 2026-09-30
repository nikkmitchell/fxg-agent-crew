import * as THREE from "three";
import { camera, previewTicks, renderer, rig, scene, useKitMovement } from "./preview-room";
import type { JoinOptions, JoinedRoom } from "./kit";
import { natureLevel, type NatureKind } from "../shared/nature-retreat";
import { NatureRetreatView } from "./space/nature-retreat-view";
import { createRainApproach } from "./space/rain-stone";

const kind: NatureKind = document.documentElement.dataset.experience === "fireflies" ? "fireflies" : "sakura";
const place = new NatureRetreatView(kind, { x: 0, z: 0 });
scene.add(place.group);
scene.background = new THREE.Color(kind === "sakura" ? "#151520" : "#060e12");
const approach = createRainApproach(); approach.material.uniforms.uFade.value = 1; scene.add(approach);
const review = new URLSearchParams(location.search).get("review");
if (review === "center") {
  camera.position.set(0, 1.6, .9); camera.rotation.set(kind === "sakura" ? .22 : -.03, .1, 0);
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const status = document.querySelector<HTMLElement>("#status")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
let audible = false, soundBusy = false;
const soundName = kind === "sakura" ? "the blossom breeze" : "the quiet night";
const toggleSound = async () => {
  if (soundBusy) return;
  soundBusy = true;
  if (audible) { place.mute(); audible = false; } else audible = await place.enableSound();
  sound.textContent = audible ? "Return to silence" : `Listen to ${soundName}`;
  sound.setAttribute("aria-pressed", String(audible)); soundBusy = false;
};
sound.addEventListener("click", () => { void toggleSound(); });
renderer.xr.addEventListener("sessionstart", () => { if (!audible) void toggleSound(); });
let room: JoinedRoom | null = null;
if (location.pathname.startsWith("/s/")) {
  try {
    const kitURL = "/kit/saha.js";
    const { joinSaha } = await import(/* @vite-ignore */ kitURL) as { joinSaha: (options: JoinOptions) => JoinedRoom };
    room = joinSaha({ scene, camera, renderer, player: rig, voice: false, vrButton: false,
      buttons: [{ label: `${kind === "sakura" ? "Blossom" : "Night"} sound on / off`, onPress: () => { void toggleSound(); } }] });
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
    document.querySelector("#error")!.textContent = `The shared room could not connect. The local experience still works: ${error instanceof Error ? error.message : String(error)}`;
  }
}
previewTicks.add((eye, delta) => {
  const distance = Math.hypot(eye.x, eye.z);
  place.update(natureLevel(distance), delta, reduced.matches);
  const message = distance <= 1.6 ? kind === "sakura" ? "Let the petals pass. There is nothing to do." : "Stand quietly. Let your eyes find the little lights."
    : distance < 5 ? "The place is gently coming into view." : "Follow the scattered stones. Take your time.";
  if (status.textContent !== message) status.textContent = message;
});
window.addEventListener("pagehide", () => {
  room?.leave(); place.dispose(); approach.geometry.dispose(); approach.material.dispose();
}, { once: true });
