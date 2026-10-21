import * as THREE from "three";

/**
 * A controller pointed at this mesh and pressed (WebXR's select), for the kit's
 * door and screen, which each wired this up word for word until 2026-10-21.
 * Controllers only send select during a WebXR session, so there is nothing to
 * check about where the viewer is; a click handles a flat screen. Returns the
 * way to stop listening.
 */
export function onPointedSelect(renderer: THREE.WebGLRenderer, target: THREE.Object3D, act: () => void): () => void {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rays = [0, 1].map((index) => renderer.xr.getController(index));
  const onSelect = (event: { target: THREE.Object3D }) => {
    event.target.getWorldPosition(origin);
    direction.set(0, 0, -1).applyQuaternion(event.target.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(origin, direction);
    if (raycaster.intersectObject(target, false).length) act();
  };
  for (const ray of rays) ray.addEventListener("select", onSelect as never);
  return () => {
    for (const ray of rays) ray.removeEventListener("select", onSelect as never);
  };
}
