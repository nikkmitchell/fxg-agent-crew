# One room: native data panels, one interaction layer, desktop and XR

Nikk's brief, 2026-09-21:

> "a full redo of the data display in the room, in 3d as well as XR for mood
> board, work board, chat, and anything else. now it is just images from the
> website, that does not work good because it's formatted weird, updates slowly,
> isn't editable, and many problems... make the 3d browser based room view to be
> the same as webXR, just with browser controls... make sure everything doable in
> webxr is now doable in the 3d space, and make sure that it is all one single
> code, so there is no separate ways of them."

This is that brief, sharpened into something buildable and checkable.

---

## The one fact that explains the whole mess

There are two rooms today because **the desktop panels are iframes**.

`src/space/WebPanel.tsx` hangs the real app in the scene with drei's
`Html transform`. It is live and clickable — and `occlude="blending"` sets
`pointer-events: none` on the WebGL canvas so those iframes stay clickable.
`Movable.tsx` says it outright:

> "which means NO 3D object can ever receive a pointer there. I wrote a 3D drag
> bar first, watched it do nothing, and found the canvas dead to the mouse."

So the desktop cannot have 3D interaction while it has iframes, and a headset
cannot have iframes at all — an immersive session presents the WebGL framebuffer
alone, with no DOM. Hence `StillPanel`: a screenshot taken by a headless browser
on the server every 15 seconds, which is the "images from the website" Nikk is
complaining about, and every one of its faults follows from being a photograph.

**Removing the iframe is not a detail of this work. It is the work.** Once
panels are drawn in WebGL, the canvas receives pointers again, one interaction
layer serves both modes, and "everything doable in webxr is doable in the 3d
space" stops being a thing to maintain and becomes a thing that is true because
there is only one implementation.

The precedent already exists: `ChatPanel3D` paints live messages from the
viewer's own session into a canvas texture, because the server's renderer holds
no token and photographs an error page. It is the only panel that is genuinely
live in a headset today. Everything below generalises it.

---

## What "done" means

Each goal has a check that can fail. A goal with no failing check is not done,
it is hoped for.

### G1. No panel is a photograph

`StillPanel` and `WebPanel` are gone from the room. Every panel draws from data
the viewer's own session fetched.

- **Check:** no import of `StillPanel` or `WebPanel` in `Scene.tsx`; the
  stills endpoint is not called by the room; a card edited on the website
  appears in the room within one feed tick, not 15 seconds.

### G2. One scene, two input devices

`Scene.tsx` and `Immersive.tsx` render the *same* panel components. The only
difference between desktop and headset is which input adapter is mounted and
whether the camera is driven by WebXR.

- **Check:** the set of panel components mounted is identical in both modes —
  asserted by a test over the component tree, not by reading.
- **Check:** every interaction below has exactly one implementation, invoked by
  both adapters. Grep for a second copy and find none.

### G3. Pointing works the same way in both

One ray, three sources: mouse, XR controller, tracked hand. A panel receives
`onPointerDown/Move/Up` with a UV coordinate and does not know which produced
it.

- **Check:** a unit test drives a panel through the adapter with a synthetic
  ray and asserts the same result for all three sources.

### G4. The work board is usable

- a task can be **dragged between columns**, and the move persists
- a task can be **added** from inside the room
- a **comment** can be added to a task
- a task can be **pulled off the board** into its own detail panel, which is a
  copy showing much more than the card does
- **Check:** each is exercised against a real server in the harness, and the
  change is read back from a fresh session.

### G5. The mood board is usable

Items can be moved, added and opened, with the same interaction vocabulary as
the work board. Nothing on the mood board needs its own gesture.

### G6. Panels move and resize smoothly

Movement and resizing are frame-rate independent and continuous, with no
snap-back, in both modes, driven by the same code.

- **Check:** a test drives a drag at 15fps and at 120fps and asserts the panel
  lands in the same place.

### G7. It is one codebase

No file contains a branch of the form "if in a headset, do X, else do Y" for
anything a person can *do*. Mode may choose an input adapter and a camera rig;
it may not choose a feature.

- **Check:** a test greps the space directory for headset conditionals outside
  the adapter and the camera rig, and fails on a new one.

---

## Order of work

Each phase ends shippable. The room keeps working throughout — this is a live
site with people in it, and a big-bang rewrite that is broken for a day is worse
than a slower one that is never broken.

1. **A panel surface.** One component that draws a data-driven panel into the
   scene and reports pointer hits as UV. Chat moves onto it first, because
   `ChatPanel3D` already proves the shape and has the least to lose.
2. **The input adapter.** Mouse, controller and hand all produce the same ray
   events. Desktop stops being pointer-dead: this is where the iframe leaves.
3. **The work board, read-only.** Columns and cards as real objects, live data.
4. **The work board, editable.** Drag between columns, add, comment, pull off.
5. **The mood board**, on the same primitives.
6. **Delete the old paths.** Stills renderer, `WebPanel`, `StillPanel`, and the
   duplicated interaction code. A thing kept "just in case" is a second
   implementation that will drift.

---

## Decisions taken, so they are not re-litigated mid-build

- **Cards are objects, not pixels on a painted board.** A card must be able to
  leave the board and hang in the air; that is Nikk's "pulled off the board"
  and it is impossible for a region of a texture.
- **Text is a texture per card**, repainted when its content changes, not every
  frame. `chat-texture.ts` already does this and has a test.
- **The server is the authority.** A drag moves the card optimistically and
  reconciles from the feed; a refusal snaps it back and says why. The room has
  been bitten before by a client that believed itself.
- **No new renderer for card content.** One function turns a task into a
  painted card, used by both modes, so a card cannot look like two things.

---

## What this does not include

Named so nobody assumes otherwise:

- **The website's own pages are untouched.** This is the room, not `/board`.
- **Presence is not keyed by room yet** — see `roomAtDefault`. Unrelated, still
  open.
- **A headset witness is still required at the end.** None of these checks can
  see what a Quest sees, and this project has been wrong about that before.
