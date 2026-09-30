import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { SKY_REFERENCE, skyProximity } from "../shared/earth-sky";
import { EarthSkyClock } from "./space/earth-sky-clock";

const CLEARING = { x: 0, z: -6 };
const referenceMode = new URLSearchParams(location.search).get("night") === "reference";
const status = document.querySelector<HTMLElement>("#status")!;
const metrics = document.querySelector<HTMLElement>("#metrics")!;
const referenceNote = document.querySelector<HTMLElement>("#reference")!;
const note = document.querySelector<HTMLElement>("#note")!;
window.addEventListener("error", (event) => { document.querySelector("#error")!.textContent = event.message; });

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1520");
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 150);
const rig = new THREE.Group();
camera.position.set(0, 1.6, 2);
// Direct review viewpoint for QA screenshots only; normal entry begins on the path.
if (new URLSearchParams(location.search).get("review") === "clearing") camera.position.z = CLEARING.z;
camera.rotation.order = "YXZ";
camera.rotation.x = .12;
rig.add(camera);
scene.add(rig);
const clock = new EarthSkyClock(SKY_REFERENCE, !referenceMode);
scene.add(clock.view.group);
referenceNote.textContent = referenceMode
  ? `${SKY_REFERENCE.label} · reference night advancing at real speed.`
  : "Hangzhou · actual UTC time · north is straight along the path. This sets celestial orientation; no horizon clips the sphere.";

// Preview shell only: a stable ground plane and an unobtrusive walkable path.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: "#131e23" }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const path = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 7), new THREE.MeshBasicMaterial({ color: "#283239" }));
path.rotation.x = -Math.PI / 2;
path.position.set(0, .003, -1.7);
scene.add(path);
const circle = new THREE.Mesh(new THREE.CircleGeometry(1.8, 64), new THREE.MeshBasicMaterial({ color: "#29333b" }));
circle.rotation.x = -Math.PI / 2;
circle.position.set(CLEARING.x, .005, CLEARING.z);
scene.add(circle);
// Low boundary facets give depth without a ceiling or a wall across the sky.
const boundary = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshBasicMaterial({ color: "#1b272e" }), 18);
const matrix = new THREE.Matrix4();
for (let i = 0; i < 18; i++) {
  const angle = i / 18 * Math.PI * 2;
  const height = .35 + (i % 4) * .12;
  matrix.makeScale(2.2, height, 1.8).setPosition(Math.sin(angle) * 13, height / 2, Math.cos(angle) * 13 - 3);
  boundary.setMatrixAt(i, matrix);
}
scene.add(boundary);
const shell = [floor, path, circle, boundary];
for (const mesh of shell) {
  mesh.renderOrder = 0;
  (mesh.material as THREE.MeshBasicMaterial).transparent = true;
}

const keys = new Set<string>();
window.addEventListener("keydown", (event) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault(); keys.add(event.code);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!drag || renderer.xr.isPresenting) return;
  camera.rotation.y -= (event.clientX - drag.x) * .004;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (event.clientY - drag.y) * .004, -1.4, 1.4);
  drag = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener("pointerup", () => { drag = null; });
renderer.domElement.addEventListener("pointercancel", () => { drag = null; });
renderer.domElement.addEventListener("wheel", (event) => {
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - event.deltaY * .002, -1.4, 1.4);
}, { passive: true });
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
renderer.xr.addEventListener("sessionstart", () => { note.hidden = true; keys.clear(); });
renderer.xr.addEventListener("sessionend", () => { note.hidden = false; });

const eye = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
const skyForward = new THREE.Vector3();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
for (const [selector, kind] of [["#meteor", "meteor"], ["#bolide", "bolide"]] as const) {
  document.querySelector(selector)?.addEventListener("click", () => {
    const active = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    active.getWorldDirection(skyForward);
    clock.view.previewMeteor(kind, skyForward);
  });
}
const up = new THREE.Vector3(0, 1, 0);
const yawRotation = new THREE.Quaternion();
const timer = new THREE.Timer();
let snapReady = true, lastStatus = "", lastMetrics = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const delta = Math.min(timer.getDelta(), .05);
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  activeCamera.getWorldPosition(eye);
  activeCamera.getWorldDirection(forward);
  forward.y = 0; forward.normalize(); right.crossVectors(forward, up).normalize();
  let walk = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  let strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  if (!renderer.xr.isPresenting) {
    camera.rotation.y += (Number(keys.has("ArrowLeft")) - Number(keys.has("ArrowRight"))) * delta;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + (Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown"))) * delta, -1.4, 1.4);
  }
  let turn = 0;
  for (const source of renderer.xr.getSession()?.inputSources ?? []) {
    const axes = source.gamepad?.axes;
    if (!axes) continue;
    const x = axes.length >= 4 ? axes[2] : axes[0];
    const y = axes.length >= 4 ? axes[3] : axes[1];
    if (source.handedness === "left") { strafe += Math.abs(x) > .15 ? x : 0; walk -= Math.abs(y) > .15 ? y : 0; }
    if (source.handedness === "right") turn = x;
  }
  if (Math.abs(turn) < .25) snapReady = true;
  if (Math.abs(turn) > .65 && snapReady) {
    snapReady = false;
    const radians = -Math.sign(turn) * Math.PI / 6;
    // Turn around the head's floor position, not the rig origin.
    rig.position.sub(eye); rig.position.applyAxisAngle(up, radians).add(eye);
    yawRotation.setFromAxisAngle(up, radians); rig.quaternion.premultiply(yawRotation);
  }
  move.copy(forward).multiplyScalar(walk).addScaledVector(right, strafe);
  if (move.lengthSq() > 1) move.normalize();
  rig.position.addScaledVector(move, delta * 1.4);
  rig.updateMatrixWorld(true);
  activeCamera.getWorldPosition(eye);
  const distance = Math.hypot(eye.x - CLEARING.x, eye.z - CLEARING.z);
  const target = skyProximity(distance);
  activeCamera.getWorldDirection(skyForward);
  clock.view.update(eye, target, delta, clock.advance(), reduced.matches, skyForward);
  // A local, immersive clearing. The path fades back in as you leave, without
  // navigating, moving the person, or changing anything for another viewer.
  for (const mesh of shell) {
    (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - clock.view.visibility;
    mesh.visible = clock.view.visibility < .999;
  }
  const message = distance <= 1.8 ? "You are in the sky clearing. Look around and above." : distance < 5 ? "The sky is beginning to appear." : "The sky waits at the clearing.";
  if (message !== lastStatus) { status.textContent = lastStatus = message; }
  renderer.render(scene, camera);
  if (timer.getElapsed() - lastMetrics > 1) {
    lastMetrics = timer.getElapsed();
    metrics.textContent = `${clock.view.sky.stars.length.toLocaleString()} catalogue stars · ${renderer.info.render.calls} scene draw calls · ${Math.round(target * 100)}% target visibility`;
  }
});
// The preview deliberately has no ticket, socket, model endpoint or shared-state writes.
window.addEventListener("pagehide", () => {
  renderer.setAnimationLoop(null); clock.view.dispose();
  timer.dispose();
  for (const mesh of [floor, path, circle, boundary]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  renderer.dispose();
}, { once: true });
