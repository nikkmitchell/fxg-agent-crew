---
name: looking-at-the-room
description: Check a change you can see — the 3D room, a panel, the board, a profile, the lobby — in a local copy of saha.ing before shipping it, without a headset. Use when about to write "not checked", "nobody has seen this" or "I could not verify" about anything visual or interactive; when a control seems not to respond in testing; or when proving that something animates, moves or saves. Covers starting the dev-room harness, signing in as anyone, why it must be rebuilt AND restarted, how to drive the room from a browser, and what it cannot tell you.
---

# Looking at the room without a headset

"I could not check it" is not an answer for a rendering change while
`tools/dev-room-harness.mts` sits in the repository. It is saha.ing's real
server and real pages, on loopback, with an in-memory database and people
already signed in. It refuses to run anywhere else, so it is safe.

## Start it

```bash
pnpm run -s build                                    # it serves dist/, not src/
PORT=4190 HARNESS_PEOPLE=nikk,<you> pnpm exec tsx tools/dev-room-harness.mts
```

- **It serves the BUILT pages.** Build first, every time. It prints a loud
  warning when `dist/` is older than the code; believe it. (An agent once tuned
  a particle effect against an avatar's own markings, because `dist/` predated
  the change.)
- **Restart it after every build.** It fixes its list of assets at start-up: a
  rebuilt page loads, its new script 404s, and you get a blank page with no
  error anywhere. A restart empties the room, so make your test items again
  through the API.
- **Sign in as anyone it made** at `http://localhost:4190/dev/as/<name>`, and
  stand in a room with `?room=lobby`. No password is involved: it is the
  harness's own loopback door. `HARNESS_PEOPLE` makes everyone it names an
  agent; leave it unset for the default two people (nikk, Wren) and two agents
  (Plumbline, Inkstone). The port defaults to 4174.
- In Claude Code's desktop app, run it through `preview_start` with a config in
  the **primary** working directory's `.claude/launch.json` (the browser pane
  reads that one, not a worktree's).

## Drive it

- **Click meshes with real clicks** (`left_click`, `left_click_drag`, or
  Playwright's mouse). Those reach the 3D scene. Synthetic `PointerEvent`s do
  not: the scene raycasts from `offsetX/offsetY`, which a constructed event
  leaves at 0.
- **Key presses from the browser tool may not reach the page.** Typing into a
  focused text box works; anything listening for `keydown` needs a
  `KeyboardEvent` dispatched from page JavaScript.
- **To look closely at something, move IT, not the camera**: PATCH the item's
  position through the API, then wait for it to glide there. A bigger window
  gives you more pixels.
- **Read the SERVER back after every gesture**, not the screen: snapshot
  `/bff/board/projects/<id>` (or whatever you changed) before and diff after. A
  status that changed is proof; a screenshot is an opinion.
- **Patching `window.fetch` sees nothing inside the room**: `requestJson` sends
  `/bff` calls down the room's open socket. To tell "my click missed" from "the
  handler did nothing", push to a temporary `window.__trace` in the handler,
  rebuild, restart, and take it out before committing.
- **A control you cannot hit is a finding**, not a testing problem: three
  times a control missed by coordinates worked out from the layout was
  genuinely too small for a controller ray.

## Prove it

- **Movement**: two screenshots seconds apart, and "identical" is a real
  answer. `toDataURL` on a WebGL canvas is always black: it is not evidence.
- **Geometry the pixels will not settle**: assert it on the source, as
  `src/space/grab-face.test.ts` does. The test suite has no renderer.
- **Saving**: change it, reload, and read it back.

## What it cannot tell you

It is a desktop browser, not a headset. It settles layout, framing, animation,
data and whether a control works with a mouse. It settles nothing about a
Quest: comfort, hand tracking, reach, legibility at arm's length, sound in a
headset. Say that in those words, and add a row to
[docs/HEADSET-CHECKS.md](../../../docs/HEADSET-CHECKS.md) for a person to run.
