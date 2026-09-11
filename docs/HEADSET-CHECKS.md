# What only you can check

Stage 5 of the room — the immersive half — is the first thing in this project I
have shipped without being able to verify it. Everything else has a test or a
screenshot behind it. This has neither, because a headset session cannot be
driven from a terminal.

So this is the list, written before you put the headset on, with what "wrong"
looks like for each. **If something here is wrong, it is a bug I shipped, not
something you are doing incorrectly.**

Open **https://saha.ing/room** in the headset's browser, sign in, press
**Enter the room**, then **Enter in your headset**.

## Before anything else

**Is there a headset button at all?**
The page asks the browser whether `immersive-vr` is supported and only offers
the button if it says yes. If you see *"This browser reports no immersive VR
support"* on a device that plainly has a headset, the probe is wrong — that is
the first thing to tell me, and the room still works in the window meanwhile.

## The six checks

| # | What to do | What right looks like | What wrong looks like |
|---|---|---|---|
| 1 | Press **Enter in your headset** | The room surrounds you. You are standing near the door, facing the task board on the far wall. | Nothing happens; a black void; the room appears but sideways or underneath you. |
| 2 | Stand still and look around | The floor is at your feet at the right scale — the walls are about twice your height, the boards are wall-sized. | The room feels doll-sized or cathedral-sized. That means the metres in `shared/space-layout.ts` are wrong for a real body. |
| 3 | Push the **left stick** | You walk, at about walking pace, in the direction you are looking. | You drift, slide, accelerate, or move at right angles to where you are facing. |
| 4 | Walk into a wall | You stop cleanly a little short of it. | You pass through it, or you stop with a lurch that feels like the tracking broke. |
| 5 | Push the **right stick** | The view snaps round in steps of about 30°. | It rotates smoothly (the comfort setting did not apply), or it does nothing. |
| 6 | Have someone open `/room` in a browser and walk about | Their figure moves in your headset as they move. | They are frozen, in the wrong place, or absent. |

## Then the comfort setting

Tick **"Smooth turning instead of snap"** in the panel and try the right stick
again. It should turn continuously rather than in steps.

**Try snap first and stay with it if you are at all unsure.** Smooth turning is
the most common cause of motion sickness in VR, and it is the one change here
that can make somebody feel ill within a minute. It is the default for that
reason, even though smooth was what you asked for — the setting is one click
away; nausea is not.

If you start to feel unwell, take the headset off immediately. It does not
improve by pushing through, and nothing in this room is worth it.

## What I could check, so you do not have to

- The button is only offered when the browser reports actual `immersive-vr`
  support, and says so plainly when it does not. **Verified in a browser.**
- No XR code reaches the main bundle — the renderer stays behind the lazy
  boundary and `deploy/release.sh` fails the deploy if it leaks. **Measured.**
- The flat room still renders identically with XR wired in. **Screenshotted.**
- The wall clamp and the comfort defaults are pure functions with unit tests
  (`src/space/comfort.test.ts`). **Tested.**
- Everything else in the table above: **not verified by me at all.**

## One thing I got wrong while building this

I diagnosed a blank canvas as `XROrigin` putting the camera on the floor,
wrote that into the comments, and it was not true — the camera was at the spawn
point the whole time. The page in my browser harness was `hidden`, and a hidden
page gets no animation frames. I mention it because if you hit something odd, my
first explanation may be worth less than your own eyes.
