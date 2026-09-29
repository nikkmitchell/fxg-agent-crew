import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import type { Comfort } from "../space/comfort";
import { connectSaha, type ConnectOptions, type SahaRoom } from "./connect";
import { drawOthers } from "./figures";
import { createMovement } from "./movement";
import { createWristMenu, type MenuButton } from "./menu";
import { createVoice } from "./voice";
import { openScreen, type Screen, type ScreenOptions } from "./screen";
import { openDoor, type Door, type DoorOptions } from "./door";
import { enterWhenGranted } from "../../shared/session-granted";

/**
 * saha.ing FOR SPACES.   https://saha.ing/kit/saha.js
 *
 * One call gives a space page what saha.ing's own room has, so a new page does
 * not redo any of it (Nikk, 2026-09-29), unless it says otherwise:
 *
 *   <script type="importmap">
 *   { "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/" } }
 *   </script>
 *   <script type="module">
 *     import * as THREE from "three";
 *     import { joinSaha } from "/kit/saha.js";
 *     const room = joinSaha({ scene, camera, renderer });
 *   </script>
 *
 * - everyone else in the space, by name, with hands and what they say;
 * - moving the saha.ing way: thumbsticks, snap turn, the palm joystick, and
 *   WASD with drag-to-look on a computer (src/kit/movement.ts);
 * - an Enter VR button, and a wrist menu in VR: back to saha.ing, leave VR;
 * - shared values and spoken lines (room.set, room.on("state"), room.say).
 *
 * Turn any of it off: joinSaha({ ..., movement: false, menu: false,
 * vrButton: false, badge: false }). connectSaha() is the connection alone.
 *
 * Built from saha.ing's own code (src/kit/, using src/space/stick-walk.ts,
 * palm-joystick.ts and comfort.ts), so a fix to saha.ing's movement reaches
 * every space.
 */

export { connectSaha, type SahaRoom } from "./connect";
export { openScreen, type Screen, type ScreenOptions } from "./screen";
export { openDoor, type Door, type DoorOptions } from "./door";

const POSE_EVERY_MS = 100;

export type JoinOptions = ConnectOptions & {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** The rig that carries the camera; made for you when the camera has none. */
  player?: THREE.Object3D;
  movement?: boolean;
  menu?: boolean;
  vrButton?: boolean;
  /** Voice chat (listening automatic, microphone by choice). */
  voice?: boolean;
  badge?: boolean;
  comfort?: Comfort;
  /** Extra wrist-menu buttons, after the kit's own. */
  buttons?: MenuButton[];
  /** Accepted for pages written before the kit brought its own three.js; unused. */
  THREE?: unknown;
  /** Accepted for older pages that passed their own hand objects; the kit sends hands itself now. */
  hands?: unknown;
};

export type JoinedRoom = SahaRoom & {
  player: THREE.Object3D;
  /** Any space or web page on a panel in this room: see screen.ts. */
  openScreen: (url: string, at: [number, number, number], options?: Partial<Omit<ScreenOptions, "scene" | "camera" | "renderer" | "url" | "at">>) => Screen;
  /** A door to another space, walked through or pointed at: see door.ts. */
  openDoor: (space: string, at: [number, number, number], options?: Partial<Omit<DoorOptions, "scene" | "camera" | "renderer" | "player" | "space" | "at">>) => Door;
};

/** The camera's rig, making one around it if the page gave the camera none. */
function rigFor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, given?: THREE.Object3D): THREE.Object3D {
  if (given) return given;
  if (camera.parent && camera.parent !== scene) return camera.parent;
  const player = new THREE.Group();
  player.name = "saha:player";
  // Stand where the camera stood, facing where it faced; the camera keeps its
  // height inside the rig, which is also where a headset puts the head.
  const facing = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  player.position.set(camera.position.x, 0, camera.position.z);
  player.rotation.y = facing.y;
  camera.position.set(0, camera.position.y || 1.6, 0);
  camera.rotation.set(facing.x, 0, 0);
  scene.add(player);
  player.add(camera);
  return player;
}

export function joinSaha(options: JoinOptions): JoinedRoom {
  const { scene, camera, renderer } = options;
  if (!scene || !camera || !renderer) throw new Error("saha.js: joinSaha needs { scene, camera, renderer }");
  const room = connectSaha(options) as JoinedRoom;
  const player = rigFor(scene, camera, options.player);
  room.player = player;
  const server = (options.server ?? new URL(options.href ?? location.href).origin).replace(/\/$/, "");
  room.openScreen = (url, at, extra) => openScreen({ server, ...extra, scene, camera, renderer, url, at });
  const doors = new Set<Door>();
  room.openDoor = (space, at, extra) => {
    const door = openDoor({ server, ...extra, scene, camera, renderer, player, space, at });
    const close = door.close;
    const kept: Door = { ...door, close: () => { doors.delete(kept); close(); } };
    doors.add(kept);
    return kept;
  };

  // Arriving from VR through a door: straight back into VR where the browser
  // allows it (shared/session-granted.ts), with the same features VRButton asks for.
  renderer.xr.enabled = true;
  enterWhenGranted(async () => {
    const xr = navigator.xr;
    if (!xr) return;
    const session = await xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"] });
    await renderer.xr.setSession(session);
  });

  if (options.vrButton !== false) {
    const add = () => document.body.appendChild(VRButton.createButton(renderer));
    if (document.body) add();
    else addEventListener("DOMContentLoaded", add, { once: true });
  }

  // Your hands, seen by others: whichever controller or tracked hand is which.
  const handOf = new Map<XRHandedness, THREE.Object3D>();
  for (const index of [0, 1]) {
    const grip = renderer.xr.getControllerGrip(index);
    player.add(grip);
    const mark = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshStandardMaterial({ color: 0xeef0f3, emissive: 0x333333 }));
    grip.add(mark);
    const ray = renderer.xr.getController(index);
    ray.addEventListener("connected", (event: { data?: XRInputSource }) => {
      if (event.data?.handedness) handOf.set(event.data.handedness, grip);
    });
    ray.addEventListener("disconnected", () => {
      for (const [side, object] of handOf) if (object === grip) handOf.delete(side);
    });
  }

  const leaveVr = () => renderer.xr.getSession()?.end();
  // Leave WHILE STILL IN VR: a browser that hands the headset to the next page
  // only does so for a navigation made from inside a session.
  const backToSaha = () => location.assign(`${server}/`);

  // Bodies: plain files at /avatars/, or a space route that needs this page's ticket.
  const ticketOf = () => room.ticket;
  const others = drawOthers(room, scene, (url) => {
    const absolute = url.startsWith("/") ? `${server}${url}` : url;
    const ticket = ticketOf();
    return url.startsWith("/bff/") && ticket ? `${absolute}?ticket=${encodeURIComponent(ticket)}` : absolute;
  });
  const movement = options.movement === false ? null : createMovement({ renderer, player, camera, comfort: options.comfort });
  const voice = options.voice === false ? null : createVoice(room, { server, send: (message) => room.send(message), onSignal: (listener) => room.on("signal", listener) });
  const menu = options.menu === false ? null : createWristMenu({ renderer, player, camera });
  let voiceNote: string | null = null;
  const toggleTalking = async () => {
    if (!voice) return;
    const result = await voice.setTalking(!voice.talking());
    voiceNote = result.ok ? null : result.why;
    buttons();
    showBadge();
  };
  const buttons = () =>
    menu?.setButtons([
      { label: "Back to saha.ing", onPress: backToSaha },
      ...(voice && !voice.blocked() ? [{ label: voice.talking() ? "Microphone off" : "Microphone on", onPress: () => void toggleTalking() }] : []),
      { label: "Leave VR", onPress: leaveVr },
      ...(options.buttons ?? []),
    ]);
  buttons();
  let showBadge = () => undefined as void;

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const hand = new THREE.Vector3();
  const handAt = (object: THREE.Object3D | undefined): [number, number, number] | null => {
    if (!object || !renderer.xr.isPresenting) return null;
    object.getWorldPosition(hand);
    return [hand.x, hand.y, hand.z];
  };
  let lastPose = 0;
  let lastFrame = performance.now();

  const update = () => {
    const now = performance.now();
    const delta = (now - lastFrame) / 1000;
    lastFrame = now;
    movement?.update(delta);
    menu?.update();
    if (now - lastPose >= POSE_EVERY_MS && room.connected && !room.guest) {
      lastPose = now;
      camera.getWorldPosition(position);
      camera.getWorldQuaternion(quaternion);
      room.pose([position.x, position.y, position.z], [quaternion.x, quaternion.y, quaternion.z, quaternion.w], handAt(handOf.get("left")), handAt(handOf.get("right")));
    }
    others.update(now);
    for (const door of doors) door.update();
  };

  // Run every frame the page draws, in a headset too.
  const render = renderer.render.bind(renderer);
  renderer.render = (target: THREE.Object3D, view: THREE.Camera) => {
    update();
    render(target, view);
  };

  if (options.badge !== false && typeof document !== "undefined") {
    const tag = document.createElement("div");
    tag.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:10px;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(20,23,28,.78);color:#fff;font:600 12px/1.2 system-ui,sans-serif";
    const text = document.createElement("span");
    const back = document.createElement("a");
    back.textContent = "Back to saha.ing";
    back.href = `${server}/`;
    back.target = "_top";
    back.style.cssText = "color:#9cc3ff;text-decoration:none";
    const mic = document.createElement("button");
    mic.style.cssText = "border:0;border-radius:999px;padding:3px 9px;background:#2d6cdf;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer";
    mic.addEventListener("click", () => void toggleTalking());
    // A guest (a reload, a pasted link) is one click from being themselves:
    // /go/<space> makes a fresh ticket when they are signed in to saha.ing.
    // The ticket is kept out of the address bar on purpose, so a copied link
    // never carries who you are (connect.ts takeTicket).
    const enter = document.createElement("a");
    enter.textContent = "Enter as yourself";
    enter.href = `${server}/go/${encodeURIComponent(room.space)}`;
    enter.target = "_top";
    enter.style.cssText = "color:#9cc3ff;text-decoration:none";
    tag.append(text, ...(voice ? [mic] : []), enter, back);
    const show = () => {
      const count = room.people.size;
      const talkers = [...room.people.values()].filter((person) => person.voice).length;
      text.textContent = !room.connected
        ? "saha.ing · connecting…"
        : room.guest
          ? `saha.ing · watching · ${count} here`
          : `saha.ing · ${count} here${talkers ? ` · ${talkers} talking` : ""}${voiceNote ? ` · ${voiceNote}` : ""}`;
      mic.hidden = room.guest || !room.connected;
      enter.hidden = !room.guest;
      mic.textContent = voice?.talking() ? "Mic off" : "Mic on";
      mic.title = voice?.blocked() ?? "";
    };
    showBadge = show;
    for (const event of ["people", "connection", "ready"] as const) room.on(event as "ready", show);
    room.on("refused", (why) => {
      text.textContent = `saha.ing · ${why}`;
    });
    show();
    const add = () => document.body.appendChild(tag);
    if (document.body) add();
    else addEventListener("DOMContentLoaded", add, { once: true });
  }

  return room;
}
