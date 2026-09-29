import * as THREE from "three";
import type { KitPerson } from "../../shared/space-kit";
import type { SahaRoom } from "./connect";

/**
 * EVERYONE ELSE, DRAWN: a figure per person with their name, where they
 * stand and facing where they look, their hands when they send them, and a
 * bubble for what they say. Simple shapes on purpose, in each person's own
 * colour: they read at any distance and cost a handful of draws.
 */

const SAY_MS = 9000;

type Figure = {
  root: THREE.Group;
  head: THREE.Mesh;
  body: THREE.Group;
  torso: THREE.Mesh;
  legs: THREE.Mesh;
  name: THREE.Sprite;
  left: THREE.Mesh;
  right: THREE.Mesh;
  bubble: THREE.Sprite | null;
  bubbleUntil: number;
  target: THREE.Vector3 | null;
  quat: THREE.Quaternion | null;
  hl: THREE.Vector3 | null;
  hr: THREE.Vector3 | null;
};

export function label(text: string, background = "rgba(20,23,28,.72)"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.font = "600 44px system-ui, sans-serif";
  const width = Math.min(500, context.measureText(text).width + 40);
  context.fillStyle = background;
  context.beginPath();
  if (context.roundRect) context.roundRect((512 - width) / 2, 12, width, 72, 30);
  else context.rect((512 - width) / 2, 12, width, 72);
  context.fill();
  context.fillStyle = background.startsWith("rgba(255") ? "#14171c" : "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 49, 480);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(0.8, 0.15, 1);
  return sprite;
}

function disposeSprite(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

export function drawOthers(room: SahaRoom, scene: THREE.Scene): { update: (now: number) => void; figures: Map<string, Figure> } {
  const figures = new Map<string, Figure>();
  const pendingSay = new Map<string, { text: string; until: number }>();
  const forward = new THREE.Vector3();

  const material = (color: string) => {
    // Emissive, so a figure is visible in a scene that has no lights.
    const colour = new THREE.Color(color);
    return new THREE.MeshStandardMaterial({ color: colour, emissive: colour.clone().multiplyScalar(0.35), roughness: 0.6 });
  };

  const figureFor = (person: KitPerson): Figure => {
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
  };

  const dispose = (figure: Figure) => {
    scene.remove(figure.root);
    figure.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const each of materials) {
        (each as THREE.MeshStandardMaterial).map?.dispose();
        each.dispose();
      }
    });
  };

  const showSay = (figure: Figure, text: string, until: number) => {
    if (figure.bubble) {
      figure.root.remove(figure.bubble);
      disposeSprite(figure.bubble);
    }
    figure.bubble = label(text.length > 40 ? `${text.slice(0, 39)}…` : text, "rgba(255,255,255,.92)");
    figure.root.add(figure.bubble);
    figure.bubbleUntil = until;
  };

  room.on("people", () => {
    for (const person of room.others()) {
      let figure = figures.get(person.id);
      if (!figure) {
        figure = figureFor(person);
        figures.set(person.id, figure);
        // A line can arrive before its speaker's figure does (somebody speaks
        // the moment they arrive): shown now that the figure is here.
        const said = pendingSay.get(person.id);
        pendingSay.delete(person.id);
        if (said && said.until > performance.now()) showSay(figure, said.text, said.until);
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
    const until = performance.now() + SAY_MS;
    const figure = figures.get(message.id);
    if (figure) showSay(figure, message.text, until);
    else pendingSay.set(message.id, { text: message.text, until });
  });

  const update = (now: number) => {
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
      // Down to the floor (y = 0) from just under the head.
      const below = Math.max(0.3, figure.root.position.y - 0.16);
      const torso = Math.min(0.55, below * 0.4);
      const legs = Math.max(0.05, below - torso);
      figure.body.position.set(0, -0.16, 0);
      figure.torso.scale.y = torso / 0.55;
      figure.torso.position.set(0, -torso / 2, 0);
      figure.legs.scale.y = legs;
      figure.legs.position.set(0, -torso - legs / 2, 0);
      figure.name.position.set(0, 0.3, 0);
      for (const [mesh, at] of [[figure.left, figure.hl], [figure.right, figure.hr]] as const) {
        mesh.visible = at !== null;
        if (at) mesh.position.copy(at).sub(figure.root.position);
      }
      if (figure.bubble) {
        figure.bubble.position.set(0, 0.48, 0);
        if (now > figure.bubbleUntil) {
          figure.root.remove(figure.bubble);
          disposeSprite(figure.bubble);
          figure.bubble = null;
        }
      }
    }
  };

  return { update, figures };
}
