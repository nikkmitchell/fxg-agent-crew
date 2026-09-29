import * as THREE from "three";

/**
 * A DOOR TO ANOTHER SPACE (Sill's plan for spaces, C): "openDoor(space, at) is
 * a door in any room that takes you to another space, staying in VR, ticket
 * included".
 *
 *   const door = room.openDoor("xr.instruments", [2, 0, -3], { facing: -0.6 });
 *
 * Walk through it, point at it and press, or click it: you go to
 * saha.ing/go/<space>, which knows who you are, makes your ticket and sends
 * you in as yourself (server/spaces/routes.ts). Going from inside VR, within
 * the one site, is what lets the headset browser keep you in VR on the other
 * side (shared/session-granted.ts). Where it cannot, you press Enter VR there.
 */

export type DoorOptions = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  /** The rig you move with, whose position walking through is measured by. */
  player: THREE.Object3D;
  /** saha.ing itself; the page's own origin when omitted. */
  server?: string;
  /** The space it leads to, by name: "xr.instruments". */
  space: string;
  /** Where the door stands on the floor, in metres. */
  at: [number, number, number];
  /** Which way it faces, turned about the vertical (radians); 0 faces +z. */
  facing?: number;
  /** Written over the door; the space's name unless you say otherwise. */
  title?: string;
  /** Instead of going there, for a page that wants to do something first. */
  onEnter?: (address: string) => void;
};

export type Door = { group: THREE.Group; address: string; update: () => void; close: () => void };

export const DOOR_WIDTH = 1.1;
export const DOOR_HEIGHT = 2.2;
/** How close to the middle of the doorway counts as walking through it. */
export const WALK_THROUGH = 0.35;

const SPACE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Where a door to `space` sends you. Only a space's name is accepted, so a door can only ever lead into a space. */
export function doorAddress(space: string, server: string): string {
  if (!SPACE_NAME.test(space)) throw new Error(`saha.js: openDoor needs a space's name, like "xr.instruments", not ${JSON.stringify(space)}`);
  return `${server.replace(/\/$/, "")}/go/${encodeURIComponent(space.toLowerCase())}`;
}

/**
 * Whether someone standing at (x, z) is in the doorway: inside its width and
 * within WALK_THROUGH of its plane. The door's own frame: `at`, turned by `facing`.
 */
export function inDoorway(x: number, z: number, at: [number, number, number], facing: number): boolean {
  const dx = x - at[0];
  const dz = z - at[2];
  const across = dx * Math.cos(facing) - dz * Math.sin(facing);
  const through = dx * Math.sin(facing) + dz * Math.cos(facing);
  return Math.abs(across) <= DOOR_WIDTH / 2 && Math.abs(through) <= WALK_THROUGH;
}

function signTexture(title: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  const glow = context.createLinearGradient(0, 0, 0, canvas.height);
  glow.addColorStop(0, "rgba(59,130,246,0.85)");
  glow.addColorStop(1, "rgba(20,23,28,0.55)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 56px system-ui, sans-serif";
  context.fillText(title, canvas.width / 2, 150, canvas.width - 40);
  context.font = "400 34px system-ui, sans-serif";
  context.fillStyle = "#dbe7ff";
  context.fillText("walk through, or point and press", canvas.width / 2, 230, canvas.width - 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function openDoor(options: DoorOptions): Door {
  const { scene, camera, renderer, player } = options;
  const server = options.server ?? (typeof location !== "undefined" ? location.origin : "https://saha.ing");
  const address = doorAddress(options.space, server);
  const facing = options.facing ?? 0;
  const title = options.title ?? options.space;

  const group = new THREE.Group();
  group.name = `saha:door ${options.space}`;
  group.position.set(...options.at);
  group.rotation.y = facing;
  scene.add(group);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.7 });
  const post = new THREE.BoxGeometry(0.1, DOOR_HEIGHT, 0.12);
  const lintel = new THREE.BoxGeometry(DOOR_WIDTH + 0.2, 0.12, 0.12);
  for (const x of [-(DOOR_WIDTH / 2 + 0.05), DOOR_WIDTH / 2 + 0.05]) {
    const side = new THREE.Mesh(post, frameMaterial);
    side.position.set(x, DOOR_HEIGHT / 2, 0);
    group.add(side);
  }
  const top = new THREE.Mesh(lintel, frameMaterial);
  top.position.set(0, DOOR_HEIGHT + 0.06, 0);
  group.add(top);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_WIDTH, DOOR_HEIGHT),
    new THREE.MeshBasicMaterial({ map: signTexture(title), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  sign.name = "saha:door-way";
  sign.position.y = DOOR_HEIGHT / 2;
  group.add(sign);

  let gone = false;
  const enter = () => {
    if (gone) return;
    gone = true;
    (options.onEnter ?? ((to: string) => location.assign(to)))(address);
  };

  // Pointing at it (a controller's ray, or a pinch) and pressing.
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rays = [0, 1].map((index) => renderer.xr.getController(index));
  const onSelect = (event: { target: THREE.Object3D }) => {
    event.target.getWorldPosition(origin);
    direction.set(0, 0, -1).applyQuaternion(event.target.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(origin, direction);
    if (raycaster.intersectObject(sign, false).length) enter();
  };
  for (const ray of rays) ray.addEventListener("select", onSelect as never);

  // Clicking it with a mouse or a finger on a screen.
  const pointer = new THREE.Vector2();
  const onClick = (event: MouseEvent) => {
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(sign, false).length) enter();
  };
  renderer.domElement.addEventListener("click", onClick);

  // Walking through it. Not on arrival: someone who starts in the doorway
  // must step out of it first, or a page that puts you there would bounce you.
  let outside = !inDoorway(player.position.x, player.position.z, options.at, facing);
  const update = () => {
    const inside = inDoorway(player.position.x, player.position.z, options.at, facing);
    if (inside && outside) enter();
    if (!inside) outside = true;
  };

  return {
    group,
    address,
    update,
    close: () => {
      for (const ray of rays) ray.removeEventListener("select", onSelect as never);
      renderer.domElement.removeEventListener("click", onClick);
      scene.remove(group);
      post.dispose();
      lintel.dispose();
      frameMaterial.dispose();
      sign.geometry.dispose();
      (sign.material as THREE.MeshBasicMaterial).map?.dispose();
      (sign.material as THREE.MeshBasicMaterial).dispose();
    },
  };
}
