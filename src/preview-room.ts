import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";

/** Neutral walking/XR shell. It loads no experience, catalogue or room state. */
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
export const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1520");
export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 150);
camera.position.set(0, 1.6, 5.5);
camera.rotation.order = "YXZ";
camera.rotation.x = -.18;
export const rig = new THREE.Group();
rig.add(camera); scene.add(rig);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: "#131e23" }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const path = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4), new THREE.MeshBasicMaterial({ color: "#283239" }));
path.rotation.x = -Math.PI / 2; path.position.set(0, .003, 3.7); scene.add(path);
export const previewTicks = new Set<(eye: THREE.Vector3, delta: number) => void>();
const keys = new Set<string>();
let kitMovement = false;
export function useKitMovement(): void { kitMovement = true; keys.clear(); }
window.addEventListener("error", (event) => { document.querySelector("#error")!.textContent = event.message; });
window.addEventListener("keydown", (event) => {
  if (kitMovement) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault(); keys.add(event.code);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (kitMovement) return;
  drag = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!drag || kitMovement || renderer.xr.isPresenting) return;
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
renderer.xr.addEventListener("sessionstart", () => {
  rig.position.add(camera.position.clone().setY(0).applyQuaternion(rig.quaternion));
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  document.querySelector<HTMLElement>("#note")!.hidden = true; keys.clear();
});
renderer.xr.addEventListener("sessionend", () => {
  camera.position.set(0, 1.6, 0); camera.rotation.set(0, 0, 0);
  document.querySelector<HTMLElement>("#note")!.hidden = false;
});
const eye = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0), yawRotation = new THREE.Quaternion();
const timer = new THREE.Timer();
let snapReady = true, lastMetrics = 0;
renderer.setAnimationLoop(() => {
  timer.update(); const delta = Math.min(timer.getDelta(), .05);
  const active = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  active.getWorldPosition(eye); active.getWorldDirection(forward);
  if (!kitMovement) {
    forward.y = 0; forward.normalize(); right.crossVectors(forward, up).normalize();
    let walk = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    let strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    if (!renderer.xr.isPresenting) {
      camera.rotation.y += (Number(keys.has("ArrowLeft")) - Number(keys.has("ArrowRight"))) * delta;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + (Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown"))) * delta, -1.4, 1.4);
    }
    let turn = 0;
    for (const source of renderer.xr.getSession()?.inputSources ?? []) {
      const axes = source.gamepad?.axes; if (!axes) continue;
      const x = axes.length >= 4 ? axes[2] : axes[0], y = axes.length >= 4 ? axes[3] : axes[1];
      if (source.handedness === "left") { strafe += Math.abs(x) > .15 ? x : 0; walk -= Math.abs(y) > .15 ? y : 0; }
      if (source.handedness === "right") turn = x;
    }
    if (Math.abs(turn) < .25) snapReady = true;
    if (Math.abs(turn) > .65 && snapReady) {
      snapReady = false; const radians = -Math.sign(turn) * Math.PI / 6;
      rig.position.sub(eye).applyAxisAngle(up, radians).add(eye);
      yawRotation.setFromAxisAngle(up, radians); rig.quaternion.premultiply(yawRotation);
    }
    move.copy(forward).multiplyScalar(walk).addScaledVector(right, strafe);
    if (move.lengthSq() > 1) move.normalize();
    rig.position.addScaledVector(move, delta * 1.4);
  }
  rig.updateMatrixWorld(true); active.getWorldPosition(eye);
  for (const tick of previewTicks) tick(eye, delta);
  renderer.render(scene, camera);
  if (timer.getElapsed() - lastMetrics > 1) {
    lastMetrics = timer.getElapsed();
    document.querySelector("#metrics")!.textContent = `${renderer.info.render.calls} scene draw calls`;
  }
});
window.addEventListener("pagehide", () => {
  renderer.setAnimationLoop(null); timer.dispose();
  for (const mesh of [floor, path]) { mesh.geometry.dispose(); mesh.material.dispose(); }
  renderer.dispose();
}, { once: true });
