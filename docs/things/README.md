# Things: items, environments and spaces, live in saha.ing

Things are what you build in a space's git that saha.ing can bring into any room, live. There are
three kinds:

- An **item** stands where you put it, and people move it, place it and use it, like the Go table.
  Examples are a butterfly, an instrument or a video panel.
- An **environment** surrounds the room in place of its own scenery. Examples are a forest, a
  nightclub or a theatre.
- A **space** is items, an environment and a script that ties them together. It opens all around
  you, full size, or as a model on a plinth in front of you.

In a room, open **Settings → Library**, pick a space, and bring a thing in. A push to its branch
reloads it for everyone within seconds; what it has decided (`ctx.state`) survives the reload.

This page is how to write one. The whole design, with the reasons, is in [DESIGN.md](DESIGN.md)
(contract `saha/1`).

## The smallest thing

```js
// things/lamp.js
import * as THREE from "three";
import { defineItem } from "saha";

export default defineItem({
  name: "Lamp",
  size: [0.3, 1.2, 0.3],                      // metres: its carry handle, and how small a model is made
  shared: { lit: false },                     // shared values, and their defaults
  setup(ctx) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
    bulb.position.y = 1;
    ctx.root.add(bulb);
    // A click, a trigger along a ray, a pinch or a fingertip: decided once, by whoever pressed.
    ctx.input.press(bulb, () => ctx.state.set("lit", !ctx.state.get("lit")));
    // Runs now, then on every change from anyone: right for late arrivals and after a push.
    ctx.state.watch("lit", (lit) => bulb.material.emissive.set(lit ? "#ffd27a" : "#000"));
  },
});
```

List it in `saha-pieces.json` at the top of the repo:

```json
{ "pieces": [
  { "id": "lamp",   "name": "Lamp",         "item": "things/lamp.js" },
  { "id": "forest", "name": "Forest",       "environment": "things/forest.js" },
  { "id": "evening","name": "An evening",   "space": "things/evening.js" }
] }
```

`"three"` and `"saha"` are given to your module by the page it runs in. In a room, `"three"` is the
room's own three.js, so your meshes and the room's renderer are one three.js.

## The rules

1. One ES module per thing, `export default defineItem(...)`, `defineEnvironment(...)` or
   `defineSpace(...)`. It may import only `"three"`, `"three/addons/..."`, `"saha"` and its own
   files, which load from the same deploy.
2. Nothing happens at the top of the module: no listeners, no AudioContext, no timers, no fetch.
   Each push loads a new copy of the module, and anything started at the top would run once per
   push.
3. Draw only under `ctx.root`. Never touch the renderer, the camera, the room's scene,
   `window`/`document` listeners or `setAnimationLoop`. Use `ctx` for all of them.
4. Positions are your thing's own metres: the floor is y = 0, and +Z points toward whoever placed
   it. saha.ing places, carries, turns and scales `ctx.root`.
5. Anything shared or sent is JSON: a value or a moment's data up to 4096 characters as JSON, under
   a name of letters, digits and `_ . : / -` (up to 64). Anything bigger belongs in a file
   (`ctx.assets`). A write that cannot travel is refused, with a line on your badge.
6. What you register through `ctx` is undone for you when the thing goes. Anything else you made
   goes in the `dispose()` you return from setup.
7. Never close the AudioContext and never connect to `context.destination`. Play into
   `ctx.audio.out`, or `ctx.audio.at(object)` for sound that comes from an object.

## What ctx gives you

| | |
|---|---|
| `ctx.root` | your place: a THREE.Group |
| `ctx.mode` | `"item"`, `"model"` (a space as a miniature) or `"full"` (all around you) |
| `ctx.scale` | world metres per local metre |
| `ctx.frame(fn(dt, t))` | every frame; dt is at most 0.1 s |
| `ctx.state.get / set / watch` | shared values, last write wins, kept; `watch` runs at once |
| `ctx.net.moment(name, data)` / `ctx.net.onMoment(name, fn(data, info))` | a moment for every copy, yours first (`info.mine`), never kept |
| `ctx.input.press(object, fn, { poke })` | a click, ray, pinch or fingertip; `poke: false` leaves fingertips to strikes |
| `ctx.input.strike(object, fn(e))` | a hand or controller coming onto it; `e.strength` 0–1; a click counts 0.7 |
| `ctx.input.keys("1234", fn(key, down))` | keys, only while your thing has focus |
| (not yet) | `ctx.input.drag`, `grab`, `hover`, `buttons` are planned; for now use `press`, `tips` and `hands` |
| `ctx.input.tips` | each hand's tip in your frame: `{ hand, position, previous, velocity }` |
| `ctx.input.hands` | tracked hands only: `{ hand, joints }`, each joint (WebXR names: `wrist`, `thumb-tip`, `index-finger-tip`, …) in your frame. Only joints the headset reports this frame; empty for controllers, on a computer, in a miniature, and once disposed. For pinches and finger drums. |
| `ctx.haptics.pulse(hand, strength, ms)` | a buzz in that controller |
| `ctx.audio.context / out / at(object) / buffer(url) / workletNode(url, name)` | sound; a url is beside your module, and a worklet may import its own files |
| `ctx.assets.url / texture / gltf / json / bytes` | files beside your module; glTF may be meshopt-, Draco- or KTX2-compressed |
| `ctx.env.set({ background, fog, far })` | the room's surroundings, only while you fill them; yours is a layer, taken away with you |
| `ctx.viewer` | where the person looking is, in your frame, and how far away |
| `ctx.people.me` | who is looking |
| `ctx.things.<key>` | a space's parts: `api`, `state`, `onMoment`, `root` |
| `ctx.problem(text)` | a line on your thing's badge, for whoever is building |
| `ctx.questions.ask({ prompt, near })` / `ctx.questions.list({ mine, limit, cursor })` | a visitor's question as a card on your space's board, written in the room's own panel; see [Questions](#questions-a-visitor-asks-the-board-answers) |
| `ctx.ui.button(label, { width, height, tone, onPress })` / `ctx.ui.card({ title, text, width, height })` / `ctx.ui.pages(text, { width, height })` / `ctx.ui.ink` | your own controls and text in the settings menu's look, with the room's hover and pressed feedback; see [Controls and text](#controls-and-text-in-the-platforms-look) |

From `setup` you may return `{ api: { ... } }` (what a space can call), `save()` (handed to the next
version as `ctx.hot.data`) and `dispose()`.

**Who decides.** Input handlers run on the device of the person doing it. A moment runs on every
copy. So make a shared decision (`ctx.state.set`) in an input handler, or in a moment handler only
when `info.mine` is true, never in code that runs on every copy.

## An environment

```js
import * as THREE from "three";
import { defineEnvironment } from "saha";

export default defineEnvironment({
  name: "Dusk forest",
  size: [70, 8, 70],
  env: { background: "#2b2140", fog: { color: "#2b2140", near: 10, far: 70 }, far: 200 },
  setup(ctx) {
    // ...the ground, the trees, its own lights under ctx.root...
    // In a model (ctx.mode === "model") the sky and fog are left alone: they are only the room's while you surround it.
  },
});
```

## A space: parts, scenes and a script

```js
import { defineSpace } from "saha";

export default defineSpace({
  name: "Plaza",
  size: [70, 8, 70],
  scenes: { list: ["evening", "night"], initial: "evening" },   // the scene is the shared value "scene"
  things: {
    forest: { ref: "dusk", surround: true },                    // its environment
    drums: { ref: "xr.instruments/drums-thing", at: [0, 0, -1.5], turn: 20 },   // from another space
    lantern: { ref: "orb", at: [0, 0, -4], in: ["night"] },     // only in that scene
  },
  setup(ctx) {
    // A drum hit by whoever played it moves everyone to night.
    ctx.things.drums.onMoment("hit", (_, info) => info.mine && ctx.state.set("scene", "night"));
  },
});
```

A `ref` is `"id"` (this space, the same deploy), `"space/id"` (that space's followed branch) or
`"space/id@branch"`. A part from another space follows that branch: when it deploys, the space
loads again with it.

A part's key (`forest`, `drums` above) is lowercase letters, digits, `-` and `_`, up to 32, and
spaces nest three deep at most: each part's id is `<space>/<key>`, and that is what travels.

What the space hears of its parts (`ctx.things.<key>.onMoment`, `.state.watch`) is the space's own:
it carries on while a part is swapped or remounted, and ends when the space goes.

## A finished space: publish an experience for people to visit

When a space (or an environment) is ready to be visited rather than worked on, publish it. It becomes a
saha.ing room of its own, on the room selector's first tab, **Finished spaces**, apart from the
**Work rooms**.

1. Build it as a space: its items, its environment, its script, its scenes. Everything above applies.
   A finished space is exactly what you see when you bring it in at full size.
2. Push, and try it at full size from the Library until it is right. Keep it light: everyone who visits
   downloads all of it (the Library warns above 20 MB).
3. In the Library, on the space: **Publish as finished space**, and give it a title (its room's name).
   In the headset the Library's Spaces section has a publish row that uses the space's own name.
4. It is **pinned to that version**. Pushing again changes the work branch, not the finished space.
   To bring it up to date, enter it and press **Update to the newest version** in the window's panel
   (or `POST /bff/finished/<room>/update`); anyone who may use its source can. Old versions of a branch
   are cleared after ten newer pushes, but never the one a finished space is pinned to.
5. **When the work moves to another branch** (a feature branch merged into the team's), move the finished
   space with it: `POST /bff/finished/<room>/update` with `{ "branch": "<the new branch>" }`. It keeps its
   room, title and people, pins that branch's live version, and from then on Update follows that branch.
   A branch that does not list the thing, or has nothing live, is refused and nothing changes.

Inside a finished space the work controls are gone: no work panels, no Library, no ⚙ on things, and its
things cannot be moved or taken away. People, avatars, voice and everything your thing does with `ctx`
work as usual. Feedback sent with a thing's Feedback button lands on its space's page.

`GET /bff/finished` lists them all: `{ room, title, space, branch, entry, deploy, by, at }`.

## Controls and text in the platform's look

Buttons and text panels that look and answer like the settings menu (Mica 7331, Baiwei 7333): the same dark
glass, palette and font, and the room's own hover and pressed feedback, which a thing cannot draw for
itself because it is never told where a pointer is. Use them for controls and reading; keep your own
materials for the things in your world (shelves, books, instruments).

```js
const read = ctx.ui.button("Read source", { width: 0.45, onPress: () => openSource() });
read.object.position.set(0, 0.91, 0.18);
shelf.add(read.object);                               // anywhere you like: it is yours to place

const ask = ctx.ui.button("Ask a question", { width: 0.46, tone: "accent", onPress: askQuestion });
const detail = ctx.ui.card({ title: book.title, text: book.summary, width: 1.15, height: 0.88 });

const pages = ctx.ui.pages(longText, { width: 1.28, height: 1.1 });   // each page fits a card this size
const reader = ctx.ui.card({ title: `${book.title} · 1/${pages.length}`, text: pages[0], width: 1.28, height: 1.1 });
reader.set({ title: `${book.title} · 2/${pages.length}`, text: pages[1] });
```

- **A button** is `width` by `height` metres (0.25 by 0.09 unless you say), a plane facing +Z, drawn and pressed
  from the front only. `tone: "accent"` for the one thing to do here, `"danger"` for what cannot be undone,
  `disabled: true` greys it and ignores presses. It lights under a ray or the mouse, flashes when pressed,
  and calls `onPress` for a click, a ray, a pinch or a fingertip. `set({ label, tone, disabled, onPress })`
  changes it in place.
- **A card** is the menu's dark glass with a title and text. The text is set as large as fits, down to a
  readable least; `card.fits` is false when it still did not fit (it then ends in an ellipsis). Your line
  breaks are kept. `set({ title, text })` changes it in place.
- **`ctx.ui.pages(text, { width, height })`** splits long reading into pages that each fit a card of that size at
  the menu's text size (`title: false` for a card without a title). Page with your own Earlier/Later buttons.
- **`ctx.ui.ink`** and **`ctx.ui.font`** are the menu's palette and font, for anything you still draw yourself.
- Every part is seen by you alone (selection and reading stay each visitor's own), and goes when your thing
  does. Make a part again to change its size.

## Questions: a visitor asks, the board answers

A thing can let visitors ask its space something (the Library's question lectern, Mica 7319). The question
becomes a card on a project's board, in the asker's name, and answers are kept beside the card.

```js
const asked = await ctx.questions.ask({ prompt: "Ask the Library", near: lecternTop });
if (asked.ok) showWaiting(asked.question);          // the card: asked.question.id
else if (asked.why !== "cancelled") ctx.problem(asked.message);

let page = await ctx.questions.list({ limit: 10 });   // newest first
for (const q of page.questions) {
  // q.text as asked; q.card.status and q.card.owners [{ id, accepted }], the board's own;
  // q.answer: the newest revision, or null: { revision, by, at, body, refs: [{ resource, version, url? }] }
}
if (page.next) page = await ctx.questions.list({ limit: 10, cursor: page.next });   // the page after
```

- **The room writes, not your thing.** `ask` opens the room's own writing panel (3D keys, the Quest keyboard
  and its dictation, a desktop keyboard) near `near`, or in front of the person. It says where the
  question goes and under whose name; they review it and press Send. Your thing never sees the keys.
  It resolves once: `{ ok: true, question }`, or `{ ok: false, why, message }` with `why` one of
  `cancelled`, `signed-out`, `no-intake`, `too-many`, `busy` (another panel is open), `removed` (your
  thing was taken away, which closes its panel), `not-here` (a page with no room) or `failed`.
- **Lists come a page at a time**, newest first: 30 unless `limit` says, 100 at most. `next` is where the
  following page starts (pass it back as `cursor`); it is null on the last page. Nothing is capped
  overall, and a question asked meanwhile lands on page one without shifting the page you are on.
  Over HTTP: `GET /bff/space/questions?item=<item>&mine=1&limit=&cursor=` gives `{ space, project, questions, next }`.
- **A resend is the same question.** The panel has one request key; sending again after a dropped
  connection returns the card already made.
- **Where questions go: an intake.** Nothing goes anywhere until a manager of a project who also made the
  space says so: `PUT /bff/board/projects/<project>/question-intake` with `{ "space": "<space>" }`
  (`board.py intake <project> <space>`). Until then `ask` and `list` say `no-intake`. The intake lets a
  visitor add exactly one thing to that board, a new backlog card nobody owns; it makes them no member.
  Five questions per person per space in ten minutes.
- **Taken is the board's word.** A card's owners say `accepted: true` only when they accepted it; claimed
  is not accepted. `questionStanding()` in `shared/questions.ts` puts it in words.
- **Answers** are revisions beside the card, never edits: `POST /bff/questions/<card>/answers` with
  `{ "body", "refs": [{ "resource", "version", "url"? }], "after": <revision you read, 0 at first> }`
  (`board.py answer <card> <answer.json>`). At least one source, each with its exact version; a url must be
  https. Answering takes a role a manager gave you on the project (entering its room enrols you with
  none). An answer written from an older revision is refused; every revision stays
  (`GET /bff/questions/<card>` has them all). Answering does not move the card.
- **References are data.** Nothing fetches or runs what an answer names.

## TypeScript and vite

Build each thing as a module with `three` and `saha` left external (`rollupOptions.external`), into
the folder your space publishes. Keep asset paths relative to the module:
`new URL("./scans/rock.glb", import.meta.url)` or `ctx.assets.url("scans/rock.glb")`.

## What is next

These are phase 1. Ordered actions and models (`ctx.act`), streams, grab, a thing's own website
with avatars, and finished rooms come next; see DESIGN.md's build plan.
