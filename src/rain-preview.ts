import * as THREE from "three";
import { addPreviewShell, previewTicks, renderer, scene } from "./sky-preview";
import { retreatLevel } from "../shared/rain-retreat";
import { RainRetreatView } from "./space/rain-retreat-view";

const AT = { x: 5, z: .5 };
const retreat = new RainRetreatView(AT);
scene.add(retreat.group);
const branch = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 5.4), new THREE.MeshBasicMaterial({ color: "#283239" }));
branch.rotation.x = -Math.PI / 2; branch.rotation.z = -Math.PI / 2 + .1;
branch.position.set(2.5, .003, .25);
addPreviewShell(branch);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const status = document.querySelector<HTMLElement>("#status")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
let audible = false;
sound.addEventListener("click", async () => {
  if (audible) { retreat.mute(); audible = false; }
  else audible = await retreat.enableSound();
  sound.textContent = audible ? "Quiet the rain" : "Listen to the rain";
  sound.setAttribute("aria-pressed", String(audible));
});
renderer.xr.addEventListener("sessionstart", () => { void retreat.enableSound(); });
previewTicks.add((eye, delta, sky) => {
  const distance = Math.hypot(eye.x - AT.x, eye.z - AT.z);
  retreat.update(retreatLevel(distance) * (1 - sky), delta, reduced.matches);
  const message = sky > .99 ? "You are in the sky clearing. Look in every direction."
    : distance <= 1.6 ? "A dry place in the rain. Take your time."
      : distance < 4.6 ? "The rain is gently coming into view."
        : "One path leads to rain; the other leads to stars.";
  if (status.textContent !== message) status.textContent = message;
});
window.addEventListener("pagehide", () => retreat.dispose(), { once: true });
