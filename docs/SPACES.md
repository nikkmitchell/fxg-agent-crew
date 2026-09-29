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

## Making it multiplayer

Load saha.ing's kit and everyone who enters the space sees everyone else: a figure per
person with their name, where they are and facing where they look, in a headset too.

```html
<script type="importmap">
{ "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/" } }
</script>
<script type="module">
  import * as THREE from "three";
  import { joinSaha } from "/kit/saha.js";
  // ...your scene, camera, renderer...
  const room = joinSaha({ THREE, scene, camera, renderer });
</script>
```

A new space's starter page already does this. three.js and its addons (VRButton,
GLTFLoader, ...) are served from saha.ing at `/kit/three/`, so no outside CDN is needed.

What `room` gives you:

| | |
|---|---|
| `room.people` | everyone in the space: `{ id, name, color, body, bodyUrl, p, q }` |
| `room.on("join" / "leave" / "people", fn)` | people arriving, going, moving |
| `room.set(key, value)` / `room.state` / `room.on("state", (key, value, by) => …)` | shared values every visitor sees alike, remembered by the space (JSON, 4 KB each, 200 keys) |
| `room.say(text)` / `room.on("say", fn)` | a short line, shown over the speaker's head |
| `joinSaha({ …, hands: [left, right] })` | send two Object3Ds as hands |
| `connectSaha({ … })` | the same connection without three.js, for any page |

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
- Database: migration 44 (`spaces`, `space_deploys`, `space_live`) and 45 (public rooms,
  `space_state` for the kit's shared values).
- Multiplayer: `public/kit/saha.js` (the kit), `shared/space-kit.ts` (the wire),
  `server/spaces/live.ts` (the hub, `/bff/spaces/<space>/live`), `server/spaces/tickets.ts`.
- nginx: `location /git/` allows 500 MB bodies without buffering (`deploy/nginx.conf`).
