import * as THREE from "three";
import { addPreviewShell, camera, previewTicks, renderer, rig, scene, useKitMovement } from "./sky-preview";
import type { JoinOptions, JoinedRoom } from "./kit";
import { retreatLevel } from "../shared/rain-retreat";
import { RainRetreatView } from "./space/rain-retreat-view";

const AT = { x: 5, z: .5 };
const retreat = new RainRetreatView(AT);
scene.add(retreat.group);
const bend = new THREE.CubicBezierCurve3(new THREE.Vector3(0, .004, 1), new THREE.Vector3(2, .004, -.4),
  new THREE.Vector3(3.5, .004, 1.5), new THREE.Vector3(AT.x, .004, AT.z));
const geometry = new THREE.BufferGeometry(), positions: number[] = [], triangles: number[] = [];
for (let i = 0; i <= 24; i++) {
  const point = bend.getPoint(i / 24), tangent = bend.getTangent(i / 24);
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(.55);
  positions.push(point.x - side.x, point.y, point.z - side.z, point.x + side.x, point.y, point.z + side.z);
  if (i < 24) { const p = i * 2; triangles.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
}
geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(triangles);
const branch = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#283239", side: THREE.DoubleSide }));
addPreviewShell(branch);
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
    useKitMovement();
  } catch (error) {
    document.querySelector("#error")!.textContent = `The shared room could not connect. This preview still works locally: ${error instanceof Error ? error.message : String(error)}`;
  }
}
previewTicks.add((eye, delta, sky) => {
  const distance = Math.hypot(eye.x - AT.x, eye.z - AT.z);
  retreat.update(retreatLevel(distance) * (1 - sky), delta, reduced.matches);
  const message = sky > .99 ? "You are in the sky clearing. Look in every direction."
    : distance <= 1.6 ? "A dry place in the rain. Take your time."
      : distance < 4.6 ? "The rain is gently coming into view."
        : "One path leads to rain; the other leads to stars.";
  if (status.textContent !== message) status.textContent = message;
});
window.addEventListener("pagehide", () => { room?.leave(); retreat.dispose(); }, { once: true });
