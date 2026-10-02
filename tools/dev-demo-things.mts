/**
 * A DEMO SPACE OF THINGS for the local room harness (dev-room-harness.mts),
 * on the contract (saha/1, docs/things/DESIGN.md): one item, one environment
 * and one space that composes them with a script, so the Library has
 * something to bring in without WebHarness or a push. They are also the
 * smallest working example of each kind.
 */
import type { StarterFile } from "../server/spaces/git.ts";

const orb = `// AN ITEM: a glowing orb. Press it and it takes the next colour, for everyone, with a chime from where it stands.
import * as THREE from "three";
import { defineItem } from "saha";

const COLOURS = ["#6fb3ff", "#ff8a65", "#9ccc65", "#ffd54f", "#ba68c8"];

export default defineItem({
  name: "Glowing orb",
  size: [0.4, 1.3, 0.4],
  shared: { colour: COLOURS[0] },
  setup(ctx) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 16), new THREE.MeshStandardMaterial({ emissive: "#1a2a44" }));
    ball.position.y = 1.1;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, 0.95, 16), new THREE.MeshStandardMaterial({ color: "#5a5f68" }));
    stand.position.y = 0.475;
    ctx.root.add(ball, stand);

    // A click, a trigger along a ray, or a fingertip: the next colour, decided once, by whoever pressed.
    ctx.input.press(ball, () => {
      const now = ctx.state.get("colour");
      const next = COLOURS[(COLOURS.indexOf(now) + 1) % COLOURS.length];
      ctx.state.set("colour", next);
      ctx.net.moment("chime", { colour: next });
    });
    // Drawn from the shared value: right at once for anyone arriving late, or after a push.
    ctx.state.watch("colour", (colour) => ball.material.color.set(colour ?? COLOURS[0]));

    // Everyone hears the chime from the orb; the presser at once.
    const voice = ctx.audio.at(ball, { refDistance: 1.2 });
    ctx.net.onMoment("chime", ({ colour }) => {
      const audio = ctx.audio.context;
      const pitch = 440 * 2 ** (COLOURS.indexOf(colour) / 5);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = pitch;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 1.2);
      osc.connect(gain).connect(voice);
      osc.start();
      osc.stop(audio.currentTime + 1.3);
    });

    ctx.frame((dt, t) => (ball.position.y = 1.1 + Math.sin(t * 1.5) * 0.04));
  },
});
`;

const dusk = `// AN ENVIRONMENT: a forest at dusk. Its sky and fog are the room's only while it is all around you.
import * as THREE from "three";
import { defineEnvironment } from "saha";

export default defineEnvironment({
  name: "Dusk forest",
  size: [70, 8, 70],
  env: { background: "#2b2140", fog: { color: "#2b2140", near: 10, far: 70 }, far: 200 },
  setup(ctx) {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(35, 64), new THREE.MeshStandardMaterial({ color: "#36452f" }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ctx.root.add(ground);
    const bark = new THREE.MeshStandardMaterial({ color: "#5b4636" });
    const leaves = new THREE.MeshStandardMaterial({ color: "#2f5d3a", flatShading: true });
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i += 1) {
      const r = 7 + random() * 27, a = random() * Math.PI * 2, h = 2 + random() * 3;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h * 0.4, 8), bark);
      trunk.position.y = h * 0.2;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, h * 0.8, 8), leaves);
      crown.position.y = h * 0.8;
      tree.add(trunk, crown);
      tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      ctx.root.add(tree);
    }
    ctx.root.add(new THREE.HemisphereLight("#ffd6a5", "#1b1b2f", 0.9));
  },
});
`;

const plaza = `// A SPACE: the dusk forest with three orbs, and a script. Make all three the same colour and night falls,
// for everyone, and a fourth orb appears; change one and it is evening again.
import { defineSpace } from "saha";

const ROW = ["left", "middle", "right"];

export default defineSpace({
  name: "Plaza",
  size: [70, 8, 70],
  scenes: { list: ["evening", "night"], initial: "evening" },
  things: {
    forest: { ref: "dusk", surround: true },
    left: { ref: "orb", at: [-1.5, 0, -2.5] },
    middle: { ref: "orb", at: [0, 0, -2.5] },
    right: { ref: "orb", at: [1.5, 0, -2.5] },
    lantern: { ref: "orb", at: [0, 0, -4.5], scale: 1.6, in: ["night"] },
  },
  setup(ctx) {
    // Decided once, by whoever pressed (their chime is "mine"), never by every copy at once.
    const decide = () => {
      const colours = ROW.map((key) => ctx.things[key].state.get("colour") ?? "#6fb3ff");
      const scene = colours.every((colour) => colour === colours[0]) ? "night" : "evening";
      if (scene !== ctx.scene) ctx.state.set("scene", scene);
    };
    for (const key of ROW) ctx.things[key].onMoment("chime", (_, info) => info.mine && decide());
  },
});
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
