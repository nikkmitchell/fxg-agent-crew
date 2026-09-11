# The headset, and what only you can check

The room at **/room** is two different things depending on where you open it,
and the difference is not a matter of polish.

## In a browser window

Three floating panels in a void showing the **real** Board, Mood boards and
People tabs — same-origin iframes of this site. They are live, interactive, and
update themselves, because they are the actual pages rather than a drawing of
them.

## In a headset

**The panels are not there.** This is not something I have failed to finish yet.

An immersive WebXR session presents a WebGL framebuffer and nothing else. The
panels are DOM, composited by the browser over the canvas; there is no API that
puts a live web page into a WebXR frame. So in a session you get the void, the
grid, and the people — and no boards. The panels are unmounted rather than left
running invisibly, because three copies of the app rendering nothing is worse
than none.

If that matters more than the browser view does, the honest options are:

1. **Render each tab to an image on the server** (headless Chrome on the box)
   and hang those as textures. Live within a few seconds, not interactive, and
   a real amount of machinery.
2. **Purpose-built 3D boards for XR only** — what was there before, drawn from a
   projection of the database. It looked like rectangles, which is why it went.
3. **Leave the headset for people and presence**, and read the board on a flat
   screen. Least work, and possibly the right answer.

Worth deciding before more is built on top of it.

## The checks, when you put it on

Open **https://saha.ing/room**, sign in, press **Enter the room**, then
**Enter in your headset**.

**Is there a headset button at all?** The page asks the browser whether
`immersive-vr` is supported and only offers the button if it says yes. If you
see *"This browser reports no immersive VR support"* on a device that plainly
has a headset, the probe is wrong — tell me that first.

| # | What to do | What right looks like | What wrong looks like |
|---|---|---|---|
| 1 | Press **Enter in your headset** | A void with a faint grid under your feet, and figures standing in it. Passthrough may show through where the device supports it. | Nothing happens; the scene appears sideways or underneath you. |
| 2 | Stand still and look around | The figures are roughly person-sized and their feet are on the grid. | They are doll-sized or enormous — the metres in `shared/space-layout.ts` are wrong for a real body. |
| 3 | Push the **left stick** | You walk, at about walking pace, in the direction you are looking. | You drift, slide, accelerate, or move at right angles to where you face. |
| 4 | Keep walking in one direction | You stop cleanly after about ten metres. | You keep going forever into the dark, or stop with a lurch that feels like tracking broke. |
| 5 | Push the **right stick** | The view snaps round in steps of about 30°. | It rotates smoothly (the comfort setting did not apply), or does nothing. |
| 6 | Have someone open `/room` in a browser and walk about | Their figure moves in your headset as they move. | Frozen, in the wrong place, or absent. |

## The comfort setting

Tick **"Smooth turning instead of snap"** and try the right stick again. It
should turn continuously rather than in steps.

**Try snap first and stay with it if you are at all unsure.** Smooth turning is
the most common cause of motion sickness in VR and can make somebody feel ill
within a minute. It is the default for that reason, even though smooth is what
you asked for — the setting is one click away; nausea is not.

If you start to feel unwell, take the headset off immediately. It does not
improve by pushing through.

## What I could check, so you do not have to

- The panels are the real tabs: a card created through the API appeared in the
  Board panel on its own, and a click at the panel's position in 3D focused the
  real iframe. **Verified in a browser.**
- The headset button is only offered when the browser reports actual
  `immersive-vr` support, and says so plainly when it does not. **Verified.**
- No XR or 3D code reaches the main bundle; `deploy/release.sh` fails the deploy
  if it leaks. **Measured — 268 KB, no renderer in it.**
- Every fixed position in the layout is somewhere a person can actually stand
  (`shared/space-layout.test.ts`). This exists because it was not true: the
  resting places sat outside the bounds, so the clamp stacked every idle figure
  on one point and they stood inside one another. **Tested.**
- Everything else in the table above: **not verified by me at all.**

## One thing I got wrong while building this

I diagnosed a blank canvas as `XROrigin` putting the camera on the floor, wrote
that into the comments as fact, and it was not true — the camera was at the
spawn point the whole time. My browser harness page was `hidden`, and a hidden
page gets no animation frames. If you hit something odd, my first explanation
may be worth less than your own eyes.
