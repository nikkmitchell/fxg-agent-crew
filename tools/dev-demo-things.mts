/**
 * A DEMO SPACE OF THINGS for the local room harness (dev-room-harness.mts):
 * one item, one environment and one space, so the Library has something to
 * bring in without WebHarness or a push. They are also the smallest examples
 * of each kind (src/space/modules/run-module.ts has the contract).
 */
import type { StarterFile } from "../server/spaces/git.ts";

const orb = `// AN ITEM: a glowing orb. Press it and it changes colour, for everyone.
export default function orb({ scene, THREE, room, saha }) {
  const colours = ["#6fb3ff", "#ff8a65", "#9ccc65", "#ffd54f", "#ba68c8"];
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 32, 16),
    new THREE.MeshStandardMaterial({ color: room.state.colour ?? colours[0], emissive: "#1a2a44" }),
  );
  ball.position.y = 1.1;
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, 0.95, 16), new THREE.MeshStandardMaterial({ color: "#5a5f68" }));
  stand.position.y = 0.475;
  scene.add(ball, stand);
  saha.onPress(ball, () => {
    const now = room.state.colour ?? colours[0];
    room.set("colour", colours[(colours.indexOf(now) + 1) % colours.length]);
  });
  room.on("state", (key, value) => {
    if (key === "colour" && value) ball.material.color.set(value);
  });
  return { update: (dt, t) => (ball.position.y = 1.1 + Math.sin(t * 1.5) * 0.04) };
}
`;

const dusk = `// AN ENVIRONMENT: a forest at dusk. Its sky and fog only when it is all around you.
export default function dusk({ scene, THREE, saha }) {
  if (saha.mode === "full") {
    saha.world.background = new THREE.Color("#2b2140");
    saha.world.fog = new THREE.Fog("#2b2140", 10, 70);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: "#36452f" }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const bark = new THREE.MeshStandardMaterial({ color: "#5b4636" });
  const leaves = new THREE.MeshStandardMaterial({ color: "#2f5d3a", flatShading: true });
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i += 1) {
    const r = 7 + random() * 28, a = random() * Math.PI * 2, h = 2 + random() * 3;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h * 0.4, 8), bark);
    trunk.position.y = h * 0.2;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, h * 0.8, 8), leaves);
    crown.position.y = h * 0.4 + h * 0.4;
    tree.add(trunk, crown);
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(tree);
  }
  scene.add(new THREE.HemisphereLight("#ffd6a5", "#1b1b2f", 0.9));
}
`;

const plaza = `// A SPACE: the dusk forest with three orbs in a row, composed from the other two.
import dusk from "./dusk.js";
import orb from "./orb.js";

export default function plaza(options) {
  const { scene, THREE } = options;
  dusk(options);
  const orbs = [-1.5, 0, 1.5].map((x, i) => {
    const spot = new THREE.Group();
    spot.position.set(x, 0, -2.5);
    scene.add(spot);
    // Each orb its own colour: its values are filed under its own name.
    const room = {
      ...options.room,
      get state() { return { colour: options.room.state["orb" + i] }; },
      set: (key, value) => options.room.set("orb" + i, value),
      on: (event, fn) => options.room.on(event, (key, value, by) => key === "orb" + i && fn("colour", value, by)),
    };
    return orb({ ...options, scene: spot, room });
  });
  return { update: (dt, t) => orbs.forEach((one) => one.update?.(dt, t)) };
}
`;

export const DEMO_THINGS: StarterFile[] = [
  { path: "index.html", content: "<!doctype html><title>Demo things</title><h1>Demo things</h1><p>Open them from the Library in a saha.ing room.</p>\n" },
  { path: "orb.js", content: orb },
  { path: "dusk.js", content: dusk },
  { path: "plaza.js", content: plaza },
  {
    path: "saha-pieces.json",
    content: JSON.stringify({ pieces: [
      { id: "orb", name: "Glowing orb", item: "orb.js" },
      { id: "dusk", name: "Dusk forest", environment: "dusk.js" },
      { id: "plaza", name: "Plaza", space: "plaza.js" },
    ] }, null, 2),
  },
];
