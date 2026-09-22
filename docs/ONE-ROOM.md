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

## The goals, numbered

Each is done when its check passes. Struck through when landed.

| # | goal | check that can fail |
| --- | --- | --- |
| ~~1~~ | ~~Board geometry, pure and testable~~ | ~~drawn place == picked-up place~~ **DONE f1b44dc** |
| 2 | Card painter: one function, task → texture | same task paints identically twice; long titles wrap, never overflow |
| 3 | Panel surface: a mesh that reports pointer hits as UV | synthetic ray at a card's centre returns that card |
| 4 | Input adapter: mouse, controller, hand → one ray event | same synthetic input gives the same result from all three |
| 5 | Remove the iframe; canvas receives pointers on desktop | no `Html transform` in the room; a 3D object gets a desktop click |
| 6 | Work board renders live data, both modes | a card edited on the site appears within one feed tick |
| 7 | Drag a card between columns, persisted | drag review→done, read back from a fresh session |
| 8 | Illegal moves refused in the air, with the server's rule | backlog→done shows refused while dragging, snaps back |
| 9 | Add a task from inside the room | created via room, appears on the site |
| 10 | Comment on a task from inside the room | comment via room, read back fresh |
| 11 | Pull a card off the board into its own detail panel | detail shows more than the card; board keeps its copy |
| 12 | Mood board on the same primitives | move/add/open with no mood-specific gesture |
| 13 | Chat on the same surface, live | message appears without a page fetch |
| 14 | Panel move/resize smooth and frame-rate independent | drag at 15fps and 120fps land in the same place |
| 15 | One codebase: no headset conditional outside adapter/camera | grep test fails on a new one |
| 16 | Delete stills renderer, WebPanel, StillPanel, duplicate input | files gone; suite still green |
| 18 | Settings reachable and rebuilt on desktop, not only in XR | open settings in the window; every control works there |
| 19 | Chat is a 3D plane in BOTH modes, not an HTML window | no DOM chat panel in the room; a message appears on the plane |
| 20 | Mood board native: move, add, open | an item moved in the room persists and is read back |
| 21 | Panels resize smoothly by grab, both modes | resize at two frame rates lands at the same scale |
| 22 | Add text from inside the room (chat and cards) | typed in the room, read back from a fresh session |
| 23 | Five UI/UX passes, each listing improvements then doing them | five recorded lists, each followed by its commits |
| 17 | Exercise it in a real room end to end | mood board, cards, drag, add, comment, pull-off — driven locally in the harness, then AGAIN against the deployed server from a fresh session |

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

---

# What actually happened

*Written 2026-09-23, when the last of it shipped. Live on `f16123c`.*

Every goal above is done and on the box. The iframe is gone, `StillPanel` is
gone, and so is the renderer that photographed the website — along with
`POST /bff/space/render-session`, which minted a session with no password and
existed for that one caller. Each panel draws its own data; one set of
components serves a window and a headset; and `src/space/one-room.test.ts`
fails if anyone adds a branch on where the viewer is standing without writing
down why it is about the SHAPE of something rather than about what a person can
do.

## The part worth reading if you are about to do something like this

**The tests did not find the bugs. Dragging things did.** 1,928 of them passed
while five separate faults made whole features impossible, because every one
lived in the WIRING between the renderer and the geometry — and neither side
was wrong on its own:

- **`event.uv` is per-mesh.** On the board's background it is the board's uv;
  on a card it is that card's own 0..1. The panel read it as a board position,
  so pressing a card reported somewhere near the middle of the board, `cardAt`
  found nothing, and every drag ended as "none".
- **R3F's event source is the canvas's PARENT.** `claimPointer` assumed a mesh
  hears a press before the container listener does. That is registration order,
  not bubbling, and it is not guaranteed — so the camera turned under every card
  drag, moving the board out from under the pointer mid-gesture.
- **The board's background had no `onPointerDown`.** Only cards listened for a
  press; the add strips carry no handlers and pass theirs down to it, so every
  press on one vanished.
- **A release off the panel reached nothing.** R3F delivers events only when the
  ray hits something of ours, so letting go OFF a panel produced no `up` at all
  and the gesture hung. That is exactly the "pull a card off the board" gesture
  — the one drag guaranteed to end where R3F is not looking.
- **The native text input closed itself** on the press that opened it: the
  browser hands focus back when the press completes, and a blur is a dismissal.

All five presented identically from the outside: **nothing happened**. No error,
no refusal, no log line.

**The same mistake appeared three times, in three different files**: a texture
mapped onto a plane of a different aspect, which stretches rather than crops and
reads as blurring rather than as a bug. `label-aspect.test.ts` had stated the
rule for a year and only ever checked one component. Cards were drawn at half
height for the entire time the board existed.

**A control that is the right size in metres can be the wrong size for a ray.**
I failed to hit three separate controls using coordinates CALCULATED from their
own layout. Each time the control was genuinely too small. If you cannot hit it
with the arithmetic in front of you, nobody is hitting it by eye.

**Assert geometry on the source when pixels will not settle it.** See
`src/space/grab-face.test.ts`. A missed click and a broken feature look the same,
and a long afternoon of estimating screen coordinates settles neither.

## What nobody has checked

**A headset.** Everything XR-facing is argued from shared code paths and pure
tests. Real controller rays, tracked hands, and how any of it feels at arm's
length are unobserved. The likeliest fault is the one above: a target sized for
a fingertip at 60cm that a ray cannot hold at four metres.

**The lower fifth of a panel's grab face.** The geometry is asserted by a test
that both halves of the original bug fail; the press itself was never landed.

**A human voice.** The path itself is checked, on the live box, as of
2026-09-23 — see below. What is unchecked is somebody's actual voice through a
headset microphone inside an immersive session, where the mic is a different
device and the room is noisier than a file.

## What the speak button actually does, measured

Checked against live on 2026-09-23 by walking the two requests the button makes
— with real synthesized speech in the same format the page produces, 16 kHz
mono 16-bit WAV, through a real session.

`GET /bff/space/transcribe` answers `{"available":true}` on saha.ing, so **the
button appears there.** It does not appear in the local harness, which has no
transcriber, and that is the behaviour we wanted rather than a gap in testing:
the room offers the keyboard until the server says there is something to
transcribe with.

Two utterances, posted and read back:

| said | heard | took |
| --- | --- | --- |
| Add a card that says the room can hear me | `At a card that says the room can hear me.` | 4.3s |
| Move the login card to review | `Move the login card to review.` | 7.1s |

**"Add" came back as "At", and that is survivable by design.** The words are
appended into the field somebody is already looking at and still need a
confirm; a mishearing is a character to fix, not a card filed under the wrong
name. It would be a real fault only if speech committed directly, which is
exactly why it does not.

**The full stop is left alone on purpose.** Whisper punctuates, so a dictated
card title ends in a period it does not want. Stripping it would need the panel
to know what is being written, and of its four callers two are labels (a card
title, a mood note) and two are prose (a comment, what a note says) — where the
punctuation is correct. A rule that is wrong half the time is worse than the
character it removes.
