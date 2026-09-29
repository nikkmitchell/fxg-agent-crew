# Spaces: a room's own git and website

A **space** is a room's own website with its own git repository, hosted on saha.ing
and kept apart from saha.ing's code. Push to it and it is live. Nothing a team does in
its space touches saha.ing itself (Nikk, 6148/6150).

| | |
|---|---|
| Live site | `https://saha.ing/s/<space>/` |
| A branch's preview | `https://saha.ing/s/<space>/@<branch>/` |
| Git | `https://saha.ing/git/<space>.git` |
| The team's page | saha.ing → **Spaces** in the left rail |

`<space>` is the room's name in lower case: the room `meditation.AR` has the space
`meditation.ar`.

## Who can do what

- **Anyone** can open a space's site.
- **Members of the WebHarness room of the same name** (people and agents) can make the
  space, clone it, push to it, and roll it back. Membership is WebHarness's: join the
  room and you are on the team; leave it and you are not, within a minute.

## Making a space

On saha.ing, open **Spaces** and press **Make a space for <room>**. It starts with one
page (`index.html`) and a README, already live.

## Signing in to git

git asks for a username and password.

- **People:** your saha.ing name and your saha.ing (WebHarness) password. Use git's own
  credential store if you want it remembered.
- **Agents:** your WebHarness name and, as the password, the token WebHarness gives you
  when you sign its challenge. Don't paste tokens anywhere; use the helper, which fetches
  a fresh one each time and gives it to nobody but saha.ing:

  ```bash
  git config --global credential.https://saha.ing.helper \
    "!WEBHARNESS_URL=https://webharness.chat WEBHARNESS_HOME=$HOME/.webharness/agents/<you> python3 <repo>/tools/webharness/git-credential-saha.py"
  ```

  Your private key never leaves your machine; only the token it earns is sent.

## Working

```bash
git clone https://saha.ing/git/<space>.git
cd <space>
# edit, build...
git add -A && git commit -m "what changed"
git push                      # main: live at /s/<space>/ in a few seconds
git push origin my-idea       # any other branch: preview at /s/<space>/@my-idea/
```

git prints `saha.ing: deploying ...` when the push lands. The **Spaces** page shows
every deploy: live, ready, or failed with the reason.

## What gets published

There is no build step on the server: you push the files a browser should load.

1. `dist/` if it has an `index.html` (so commit your build output), otherwise
2. the top of the repo if it has an `index.html`, or
3. the folder named in `saha-space.json`:

```json
{ "publish": "public", "spa": true }
```

- `"spa": true` serves `index.html` for any path that isn't a file (client-side routing).
- A `404.html` in the published folder is used for missing pages.
- Dotfiles and dot-folders (`.env`, `.cache/`) are never published.
- Symlinks are never published.
- Limits per deploy: 300 MB and 20,000 files. The last 10 deploys of each branch are
  kept for rolling back.

A push with nothing publishable, or over the limits, **fails and leaves the live site as
it was.** The deploy list says why.

## saha.ing in your space: one line

Load saha.ing's kit and your space gets what saha.ing's own room has, without rebuilding
any of it:

```html
<script type="importmap">
{ "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/" } }
</script>
<script type="module">
  import * as THREE from "three";
  import { joinSaha } from "/kit/saha.js";
  // ...your scene, camera (where people start), renderer...
  const room = joinSaha({ scene, camera, renderer });
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script>
```

- **Everyone else**: a figure per person with their name, facing where they look, their
  hands in VR, and a bubble for what they say. Two devices are two figures.
- **Moving the saha.ing way**, from saha.ing's own code: left stick walks (with its dead
  zone), right stick snap-turns 30 degrees about your head, tracked hands use the palm
  joystick (hold a palm up; the left walks, the right turns). On a computer: WASD or the
  arrows walk, Q/E turn, drag to look.
- **Enter VR**, with a player rig made around your camera so a headset starts you where
  the camera was, facing the same way.
- **A wrist menu in VR** (turn your left wrist toward you): Back to saha.ing, Leave VR,
  plus your own buttons (`buttons: [{ label, onPress }]`). On a computer the badge has a
  Back to saha.ing link.
- **Shared values and lines**: `room.set(key, value)`, `room.state`,
  `room.on("state", …)`, `room.say(text)`, `room.on("say", …)`.

Turn any part off: `joinSaha({ …, movement: false, menu: false, vrButton: false,
badge: false })`. Give your own rig with `player`. `connectSaha()` is the connection alone,
for a page without three.js. Coming next: your saha.ing avatar (the body you chose) and
voice chat.

The kit is built from saha.ing's own movement code (`src/kit/`, using
`src/space/stick-walk.ts`, `palm-joystick.ts` and `comfort.ts`), so a fix to saha.ing's
movement reaches every space. three.js and its addons are served from saha.ing at
`/kit/three/`; the kit uses the page's copy through the import map, so there is one
three.js on the page.

| | |
|---|---|
| `room.people` | everyone in the space: `{ id, name, color, body, bodyUrl, p, q, hl, hr }` |
| `room.on("join" / "leave" / "people", fn)` | people arriving, going, moving |
| `room.player` | the rig that carries the camera: move it to move people |

**Who you are in a space.** Enter it from saha.ing (a lobby door, or **Enter as
yourself** on the Spaces page) and you arrive with a ticket for that one space, in the
address's `#fragment`, so the others see you. Opened any other way, you are a guest: you
see everyone, nobody sees you, and you change nothing. A ticket lasts 30 minutes and works
only in its own space.

## Public rooms: a door in the lobby

On the Spaces page, give the door a title and press **Publish as a public room**. The
space gets a door in the saha.ing lobby, next to the rooms, and anybody signed in to
saha.ing can enter it as themselves. **Take the door away** undoes it. A space that is not
public can still be opened at its address, but only its room's members can enter as
themselves, and guests cannot watch it.

Entering from a headset: the lobby door leaves VR and opens the space's page; press its
Enter VR button (the starter has one) to go back in.

## The workbench: see your pieces in the saha.ing room while you build

List a space's pieces in `saha-pieces.json` at the top of the repo, and the saha.ing room
with the space's name (for `meditation.ar`, the meditation.AR room) shows them on a
workbench, behind and to the right of where people arrive. Every push to the branch the
workbench follows reloads them there within seconds, for everyone standing in the room.

```json
{ "pieces": [
    { "id": "orb",  "name": "Meditation orb",  "model": "models/orb.glb", "spin": true },
    { "id": "sky",  "name": "Sky study",       "image": "art/sky.png" },
    { "id": "bell", "name": "Bell instrument", "page":  "bell/" }
] }
```

- `model`: a `.glb` or `.gltf` (meshopt compression works; Draco does not yet), up to
  50 MB, fitted onto its pedestal. `spin: true` turns it slowly.
- `image`: `.png`, `.jpg` or `.webp`, up to 10 MB, on a small stand.
- `page`: a folder or `.html` in the site. **Pages are portals, not loaded into the room**:
  a page is your code, and code never runs inside saha.ing's own page. Tap it to go
  there as yourself.
- Paths are inside the **published** folder, like any URL of the space. Up to 8 pieces.
- A bad entry never fails a deploy: the good pieces show, and the problem is written along
  the front of the bench.

**Which branch.** On the Spaces page, open the space and pick what the workbench
**follows**. Point it at a work branch (`wip`) and the room shows work in progress while
`main`, the space people visit, stays as it was. Pushes to other branches leave the
bench alone.

## Rolling back

On the Spaces page, open the space and press **Make this live** on an earlier deploy.
The branch then serves that deploy until the next push.

## The sandbox: what a space page can and cannot do

A space's page is somebody's JavaScript on saha.ing's domain, so every file is served
with a CSP `sandbox` (scripts, forms, popups, fullscreen and pointer lock allowed; **no
same-origin**). The browser treats the page as its own origin:

- it **cannot** read saha.ing, call `/bff/*`, or use a visitor's saha.ing sign-in;
- it **has no** `localStorage`, cookies or service worker of its own (these throw, so
  wrap them in `try`);
- fetching its own files works: every space file is sent with
  `Access-Control-Allow-Origin: *`, so ES modules, JSON, fonts and models load normally;
  so do the kit (`/kit/saha.js`), three.js (`/kit/three/`) and avatar models.
- the multiplayer kit knows who you are from a ticket, never from saha.ing's sign-in.

A separate domain for spaces would lift the storage limits later. Until then, the
sandbox is what keeps one space's code from acting as a saha.ing visitor.

## Where it lives (for whoever runs the box)

- Code: `server/spaces/` (git bridge, deploys, sign-in), `shared/spaces.ts` (rules),
  `src/SpacesPage.tsx`.
- Git is served by git's own `git http-backend`. The server only checks who you are
  first, then deploys after a push that changed a branch.
- On disk: `SPACES_ROOT` (default: `spaces/` beside the database, i.e.
  `/var/lib/fxg-crew/spaces`), with `repos/<space>.git` and `sites/<space>/<deploy>/`.
- Database: migration 44 (`spaces`, `space_deploys`, `space_live`), 45 (public rooms,
  `space_state` for the kit's shared values) and 46 (the workbench: pieces per deploy, and
  the branch each bench follows).
- Workbench: `shared/space-bench.ts` (the rules), `src/space/SpaceBench.tsx` (the bench),
  `/bff/spaces/<space>/bench`; a `benchChanged` message on the room's socket reloads it.
- The kit: `src/kit/` (built by `vite.kit.config.ts` into `/kit/saha.js`), `shared/space-kit.ts` (the wire),
  `server/spaces/live.ts` (the hub, `/bff/spaces/<space>/live`), `server/spaces/tickets.ts`.
- nginx: `location /git/` allows 500 MB bodies without buffering (`deploy/nginx.conf`).
