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

### When git is reset before it can log in

From some networks, git, curl and Python get "connection reset" from saha.ing before any
login prompt, while browsers and Node get through (something on the route filters the TLS
hello that names saha.ing). Then run the bridge, which forwards git through Node with the
certificate checked as usual:

```sh
node tools/saha-git-bridge.mjs          # keep it running; listens on 127.0.0.1:18480 only
git config --global url."http://127.0.0.1:18480/git/".insteadOf https://saha.ing/git/
```

Every `https://saha.ing/git/...` command now goes through it. The credential helper answers
for the bridge too. Stop using it with
`git config --global --unset url."http://127.0.0.1:18480/git/".insteadOf`.

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

- **Everyone else, in their own saha.ing body**: the VRM each person chose in saha.ing's
  wardrobe, where they stand and facing where they look, their name above, their hands in
  VR, and a bubble for what they say. A simple figure in their colour stands in until the
  body loads (or if it cannot). Two devices are two figures.
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
for a page without three.js. Coming next: voice chat.

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
| `room.emit(name, data)` / `room.on("event", (name, data, from) => …)` | a moment for everyone else in the space right now, never kept: a note struck, a door opened (1 KB, 30 a second) |

**Who you are in a space.** Enter it from saha.ing (a lobby door, or **Enter as
yourself** on the Spaces page) and you arrive with a ticket for that one space, in the
address's `#fragment`, so the others see you. Opened any other way, you are a guest: you
see everyone, nobody sees you, and you change nothing. A ticket lasts 30 minutes and works
only in its own space.

## A screen: another space, or any page, in your room

    const room = joinSaha({ scene, camera, renderer });
    const screen = room.openScreen("/s/xr.instruments/", [0, 1.4, -2], { facing: 0, width: 1.6, height: 0.9 });
    // later: screen.close();

(Or `import { openScreen } from "/kit/saha.js"` and pass `{ scene, camera, renderer, url, at }` yourself.)

- **On a computer** it is the real page, live: an iframe placed in the scene, so people click, type and scroll in it where it stands. It is drawn over the 3D view, so something walking in front of it does not hide it.
- **In a headset** no browser can draw a web page inside VR, so it is a panel with the page's name. Pointing at it and pressing goes there (a saha.ing space keeps you in VR through the door where the browser allows it). Pass `onOpen` to do something else.
- Only `http(s)` addresses; anything else is refused. The page runs sandboxed, never as your page.
- Every screen has a title bar with the page's name and **Go there**.
- **Known limit:** saha.ing sends `frame-ancestors 'self'`, and a space page's sandboxed origin never counts as "self", so a saha.ing page cannot be framed inside ANOTHER SPACE's page. The screen knows this before trying and shows a card ("can't be shown inside a space yet") with Go there, instead of an empty frame. Screens on saha.ing's own pages, and of other sites, show the page live.

## A door: into another space, staying in VR

    const door = room.openDoor("xr.instruments", [2, 0, -3], { facing: -0.6, title: "XR Instruments" });
    // later: door.close();

Walk through it, point at it and press, or click it. It sends you to `saha.ing/go/<space>`, which knows who you are, makes your ticket and forwards you in as yourself: same name, body and voice. Not signed in, or not allowed into a private space, you arrive as a guest. Going from inside VR, within the one site, lets the headset browser keep you in VR on the other side where it can. Someone who ARRIVES standing in the doorway has to step out before it takes them anywhere. A door only leads into a space, by its name; pass `onEnter` to do something first.

## Reading the code: the Spaces page

Open a space on the Spaces page and press **Browse the code**: pick a branch, see its files (and read any of them), see its commits, and open a commit to see what it changed, as a diff. Members only, read only. Binary files and files over 512 KB are named, not shown; a diff over 200 KB is cut and says so. Symlinks and submodules are never listed, the same rule the deploys use.

The API behind it, for agents: `GET /bff/spaces/<space>/code/tree?ref=`, `.../code/file?ref=&path=`, `.../code/log?ref=` and `.../code/commit?ref=<sha>`. `ref` is a branch name or a commit id, and nothing else is accepted.

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

## Merging a branch without the command line

On the Spaces page, open a space's details: each branch has **Merge into main**. saha.ing
merges it on the box (a fast-forward when main has not moved, a merge commit when both
changed), and main deploys. If both branches changed the same lines, nothing changes and the
page names the files: merge them with git on your branch, push, and press it again.
`POST /bff/spaces/<space>/merge {"from": "<branch>"}` does the same for agents.

## Tester feedback: a checklist that reports back to the space

A page in a space can ask a human tester to go through a checklist and have the answer
land with the space, where the people and agents building it read it, instead of being
copied into chat. The tester must have entered as themselves (the ticket identifies them):

```js
const sent = await room.submitFeedback({
  device: "Quest 3",
  summary: "Comfortable overall.",
  items: [
    { id: "fps", label: "Stays smooth", status: "passed", note: "72 fps" },        // passed | needs-work | not-tested
    { id: "fade", label: "Fades when I walk away", status: "needs-work", note: "a little abrupt" },
  ],
});   // { ok: true, id } or { ok: false, why }
const reports = await room.feedback();   // what testers said about this branch, newest first
```

`branch` defaults to the preview branch the page is served from. Reports are also listed on
the Spaces page (under a space's details, "Tester feedback"), and agents read them with their
usual sign-in: `GET /bff/spaces/<space>/feedback?branch=<branch>` (members of the room; or
any page holder of a ticket for that space). Limits: 60 items, 1000 characters per note,
20 reports per person per space per hour.

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
- Backups: `deploy/backup.sh` (the `fxg-backup` timer, four times a day) makes one
  `git bundle --all` per repo, every branch and its whole history, into
  `/var/backups/fxg-crew/spaces/<stamp>/<space>.bundle`. It keeps 28 runs (seven days),
  and `--verify` checks every bundle. A repo that won't bundle is named, and the run
  fails, but the other repos are still bundled. Sites aren't backed up because a push
  rebuilds them. `deploy/backup-spaces.test.sh` tests the round trip.

  **To restore one space**, as root (the example restores `xr.instruments`):

  ```bash
  ls -1dt /var/backups/fxg-crew/spaces/*/ | head -3      # the newest runs
  B=/var/backups/fxg-crew/spaces/<stamp>/xr.instruments.bundle
  R=/var/lib/fxg-crew/spaces/repos/xr.instruments.git
  [ -e "$R" ] && mv "$R" "$R.broken-$(date +%s)"         # keep whatever was there
  git clone --mirror "$B" "$R"                            # a bare repo, every branch
  git --git-dir="$R" remote remove origin                 # it should not point at the bundle
  chown -R fxgcrew:fxgcrew "$R"
  systemctl restart fxg-crew
  ```

  A bundle carries branches and history but not the repo's config or hook, so on
  every start the server gives each repo its push settings and hook again
  (`prepareAllRepos` in `server/spaces/git.ts`). Without that restart, pushes to the
  restored repo are refused. The space's row in the database is untouched. If the
  sites were lost too, the next push to a branch deploys it again; an empty commit
  (`git commit --allow-empty -m redeploy`) is enough. To look inside a bundle without
  touching the box, `git clone <bundle> somewhere`.
- Database: migration 44 (`spaces`, `space_deploys`, `space_live`), 45 (public rooms,
  `space_state` for the kit's shared values) and 46 (the workbench: pieces per deploy, and
  the branch each bench follows).
- Workbench: `shared/space-bench.ts` (the rules), `src/space/SpaceBench.tsx` (the bench),
  `/bff/spaces/<space>/bench`; a `benchChanged` message on the room's socket reloads it.
- The kit: `src/kit/` (built by `vite.kit.config.ts` into `/kit/saha.js`), `shared/space-kit.ts` (the wire),
  `server/spaces/live.ts` (the hub, `/bff/spaces/<space>/live`), `server/spaces/tickets.ts`.
- nginx: `location /git/` allows 500 MB bodies without buffering (`deploy/nginx.conf`).

## Items that follow you

A space can give the person in it an item, and every space they enter afterwards sees it:

```js
room.give({ name: "Red mallet", url: "/s/xr.instruments/pieces/marimba.js", data: { color: "red" } });
room.on("items", (items) => { /* [{ id, name, from, url, data, at }] */ });
room.items;          // what they carry right now
room.takeBack(id);   // only the space that gave an item can take it back
```

`url` names the piece that draws the item (a `/s/...` address from the catalogue), so another
space can import that piece and show it. Up to 100 items per person, 2 KB of `data` each.
Guests carry nothing.
