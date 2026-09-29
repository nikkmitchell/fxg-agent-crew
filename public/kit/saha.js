/**
 * saha.ing multiplayer, for spaces.   https://saha.ing/kit/saha.js
 *
 * Put this in a space's page and it is multiplayer: everyone in the space
 * sees everyone else, by name, where they are and which way they face. It
 * also gives the space a small shared state every visitor sees alike, and
 * short spoken lines. See docs/SPACES.md in saha.ing.
 *
 *   import * as THREE from "https://saha.ing/kit/three/three.module.js";
 *   import { joinSaha } from "https://saha.ing/kit/saha.js";
 *   // ...your scene, camera and renderer...
 *   const room = joinSaha({ THREE, scene, camera, renderer });
 *   room.on("state", (key, value) => ...);  room.set("lamp", "on");
 *
 * WHO YOU ARE: enter the space from saha.ing (a lobby door, or the Spaces
 * page) and you arrive with a ticket, so others see you. Opened any other way
 * you are a guest: you see everyone, nobody sees you, and you change nothing.
 *
 * No dependencies. Works with whatever three.js the page already uses.
 */

const RECONNECT_MS = [1000, 2000, 4000, 8000, 15000];
const POSE_EVERY_MS = 100;

/** The ticket saha.ing put in the #fragment (and then take it out of the address bar). */
function takeTicket(href) {
  const url = new URL(href);
  const match = /(?:^#|&)saha=([^&]+)/.exec(url.hash);
  if (!match) return null;
  const ticket = decodeURIComponent(match[1]);
  try {
    // Out of the address bar, so it is not copied into a link and shared.
    const rest = url.hash.replace(/(^#|&)saha=[^&]+/, "$1").replace(/^#&?$/, "");
    history.replaceState(history.state, "", url.pathname + url.search + rest);
  } catch {
    /* a sandboxed page may not rewrite its URL; the ticket still works */
  }
  return ticket;
}

/**
 * The connection alone, for any page, three.js or not.
 * Returns a room: { you, guest, people, state, on, pose, set, say, leave, others }.
 */
export function connectSaha(options = {}) {
  const href = options.href ?? (typeof location !== "undefined" ? location.href : "");
  const page = new URL(href);
  const server = (options.server ?? page.origin).replace(/\/$/, "");
  const space = options.space ?? (/^\/s\/([^/]+)/.exec(page.pathname) || [])[1];
  if (!space) throw new Error("saha.js: not inside a space (/s/<space>/); pass { space }");
  const ticket = options.ticket !== undefined ? options.ticket : typeof location !== "undefined" ? takeTicket(href) : null;
  const Socket = options.WebSocket ?? globalThis.WebSocket;

  const listeners = new Map();
  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error("saha.js listener", error);
      }
    }
  };

  let socket = null;
  let attempt = 0;
  let left = false;

  const room = {
    space,
    /** You, as others see you; null while connecting and for guests. */
    you: null,
    /** True when watching without a ticket. */
    guest: ticket === null,
    connected: false,
    /** Everyone in the space (you included), by id. */
    people: new Map(),
    /** The shared values, as every visitor sees them. */
    state: {},
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    /** Everyone but you. */
    others() {
      return [...room.people.values()].filter((person) => person.id !== room.you?.id);
    },
    /** Where you are: p [x,y,z] metres, q [x,y,z,w]; hands optional. */
    pose(p, q, hl = null, hr = null) {
      send({ t: "pose", p, q, hl, hr });
    },
    /** Set a shared value everyone sees (null removes it). JSON, up to 4 KB. */
    set(key, value) {
      send({ t: "set", k: key, v: value === undefined ? null : value });
    },
    /** A short line, shown over your head to everyone. */
    say(text) {
      send({ t: "say", text: String(text) });
    },
    leave() {
      left = true;
      socket?.close();
    },
  };

  function send(message) {
    if (room.guest || !socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  }

  function connect() {
    if (left) return;
    const url = `${server.replace(/^http/, "ws")}/bff/spaces/${encodeURIComponent(space)}/live${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`;
    socket = new Socket(url);
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (message.t === "hello") {
        room.you = message.you;
        room.guest = message.guest;
        room.state = message.state ?? {};
        room.connected = true;
        setPeople(message.people ?? []);
        emit("ready", room);
        emit("connection", true);
      } else if (message.t === "people") {
        setPeople(message.people ?? []);
      } else if (message.t === "set") {
        if (message.v === null) delete room.state[message.k];
        else room.state[message.k] = message.v;
        emit("state", message.k, message.v, message.by);
      } else if (message.t === "say") {
        emit("say", message);
      } else if (message.t === "refused") {
        emit("refused", message.why);
      }
    };
    socket.onclose = (event) => {
      const was = room.connected;
      room.connected = false;
      if (was) emit("connection", false);
      // 4403/4404: not public, or no such space. Trying again will not help.
      if (left || event.code === 4403 || event.code === 4404) return;
      setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
    };
    socket.onerror = () => {};
  }

  function setPeople(list) {
    const seen = new Set();
    for (const person of list) {
      seen.add(person.id);
      const had = room.people.has(person.id);
      room.people.set(person.id, person);
      if (!had) emit("join", person);
    }
    for (const [id, person] of room.people) {
      if (!seen.has(id)) {
        room.people.delete(id);
        emit("leave", person);
      }
    }
    emit("people", [...room.people.values()]);
  }

  connect();
  return room;
}

/**
 * Multiplayer for a three.js scene in one call: everyone else appears as a
 * figure with their name, where they are and facing where they look, and
 * your own camera is sent to them. Works in a headset too (the camera is the
 * headset). Pass `hands: [leftObject3D, rightObject3D]` to send hands as well.
 */
export function joinSaha(options) {
  const { THREE, scene, camera, renderer = null, hands = null, badge = true } = options;
  if (!THREE || !scene || !camera) throw new Error("saha.js: joinSaha needs { THREE, scene, camera }");
  const room = connectSaha(options);
  const figures = new Map();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const hand = new THREE.Vector3();
  const forward = new THREE.Vector3();
  let lastPose = 0;

  function label(text, background = "rgba(20,23,28,.72)") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.font = "600 44px system-ui, sans-serif";
    const width = Math.min(500, context.measureText(text).width + 40);
    context.fillStyle = background;
    context.beginPath();
    (context.roundRect ? context.roundRect((512 - width) / 2, 12, width, 72, 30) : context.rect((512 - width) / 2, 12, width, 72));
    context.fill();
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 256, 49, 480);
    const texture = new THREE.CanvasTexture(canvas);
    if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(0.8, 0.15, 1);
    return sprite;
  }

  function material(color) {
    // Emissive, so a figure is visible in a scene that has no lights.
    const colour = new THREE.Color(color);
    return new THREE.MeshStandardMaterial({ color: colour, emissive: colour.clone().multiplyScalar(0.35), roughness: 0.6 });
  }

  function figureFor(person) {
    const root = new THREE.Group();
    root.name = `saha:${person.id}`;
    const skin = material(person.color);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), skin);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.3 }));
    visor.position.set(0, 0.02, -0.12);
    head.add(visor);
    // A torso of fixed size under the head, and legs that reach the floor.
    const body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.13, 0.55, 20), skin);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 1, 16), skin);
    body.add(torso, legs);
    const name = label(person.name);
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    const right = left.clone();
    left.visible = right.visible = false;
    root.add(head, body, name, left, right);
    scene.add(root);
    return { root, head, body, torso, legs, name, left, right, bubble: null, bubbleUntil: 0, target: null, quat: null, hl: null, hr: null };
  }

  function dispose(figure) {
    scene.remove(figure.root);
    figure.root.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.map?.dispose?.();
      object.material?.dispose?.();
    });
  }

  room.on("people", () => {
    for (const person of room.others()) {
      let figure = figures.get(person.id);
      if (!figure) {
        figure = figureFor(person);
        figures.set(person.id, figure);
      }
      if (person.p) figure.target = new THREE.Vector3(...person.p);
      if (person.q) figure.quat = new THREE.Quaternion(...person.q);
      figure.hl = person.hl ? new THREE.Vector3(...person.hl) : null;
      figure.hr = person.hr ? new THREE.Vector3(...person.hr) : null;
    }
    for (const [id, figure] of figures) {
      if (!room.people.has(id) || id === room.you?.id) {
        dispose(figure);
        figures.delete(id);
      }
    }
  });

  room.on("say", (message) => {
    const figure = figures.get(message.id);
    if (!figure) return;
    if (figure.bubble) {
      figure.root.remove(figure.bubble);
      figure.bubble.material.map.dispose();
      figure.bubble.material.dispose();
    }
    figure.bubble = label(message.text.length > 40 ? `${message.text.slice(0, 39)}…` : message.text, "rgba(255,255,255,.92)");
    figure.root.add(figure.bubble);
    figure.bubbleUntil = performance.now() + 6000;
  });

  function update() {
    const now = performance.now();
    if (now - lastPose >= POSE_EVERY_MS && room.connected && !room.guest) {
      lastPose = now;
      camera.getWorldPosition(position);
      camera.getWorldQuaternion(quaternion);
      const handAt = (object) => (object ? (object.getWorldPosition(hand), [hand.x, hand.y, hand.z]) : null);
      room.pose([position.x, position.y, position.z], [quaternion.x, quaternion.y, quaternion.z, quaternion.w], handAt(hands?.[0]), handAt(hands?.[1]));
    }
    for (const figure of figures.values()) {
      if (!figure.target) {
        figure.root.visible = false;
        continue;
      }
      figure.root.visible = true;
      // The root is at the head; smooth toward where the server last said.
      figure.root.position.lerp(figure.target, 0.25);
      if (figure.quat) figure.head.quaternion.slerp(figure.quat, 0.25);
      // The body stands upright under the head and turns with its facing.
      forward.set(0, 0, -1).applyQuaternion(figure.head.quaternion);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) figure.body.rotation.y = Math.atan2(-forward.x, -forward.z);
      // Down to the floor (y = 0) from just under the head, so a figure
      // stands rather than floats, and sits lower when its head is lower.
      const below = Math.max(0.3, figure.root.position.y - 0.16);
      const torso = Math.min(0.55, below * 0.4);
      const legs = Math.max(0.05, below - torso);
      figure.body.position.set(0, -0.16, 0);
      figure.torso.scale.y = torso / 0.55;
      figure.torso.position.set(0, -torso / 2, 0);
      figure.legs.scale.y = legs;
      figure.legs.position.set(0, -torso - legs / 2, 0);
      figure.name.position.set(0, 0.3, 0);
      for (const [mesh, at] of [[figure.left, figure.hl], [figure.right, figure.hr]]) {
        mesh.visible = at !== null;
        if (at) mesh.position.copy(at).sub(figure.root.position);
      }
      if (figure.bubble) {
        figure.bubble.position.set(0, 0.48, 0);
        if (now > figure.bubbleUntil) {
          figure.root.remove(figure.bubble);
          figure.bubble.material.map.dispose();
          figure.bubble.material.dispose();
          figure.bubble = null;
        }
      }
    }
  }

  // Run every frame the page draws, in a headset too: wrap renderer.render
  // when we have the renderer; otherwise the browser's animation frames.
  if (renderer && typeof renderer.render === "function") {
    const render = renderer.render.bind(renderer);
    renderer.render = (s, c) => {
      update();
      render(s, c);
    };
  } else {
    const loop = () => {
      update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  if (badge && typeof document !== "undefined") {
    const tag = document.createElement("div");
    tag.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:999px;background:rgba(20,23,28,.78);color:#fff;font:600 12px/1.2 system-ui,sans-serif;pointer-events:none";
    const show = () => {
      const count = room.people.size;
      tag.textContent = !room.connected
        ? "saha.ing · connecting…"
        : room.guest
          ? `saha.ing · watching · ${count} here · enter from saha.ing to be seen`
          : `saha.ing · ${count} here`;
    };
    for (const event of ["people", "connection", "ready"]) room.on(event, show);
    show();
    (document.body ? Promise.resolve() : new Promise((resolve) => addEventListener("DOMContentLoaded", resolve, { once: true }))).then(() => document.body.appendChild(tag));
  }

  room.figures = figures;
  return room;
}
