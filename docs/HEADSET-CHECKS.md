# The headset, and what only you can check

The room at **/room** is two different things depending on where you open it,
and the difference is not a matter of polish.

## In a browser window

Three floating panels in a void showing the **real** Board, Mood boards and
People tabs — same-origin iframes of this site. They are live, interactive, and
update themselves, because they are the actual pages rather than a drawing of
them.

## In a headset

**The panels are photographs.** An immersive WebXR session presents a WebGL
framebuffer and nothing else: the browser composites DOM *over* the canvas, and
there is no API that puts a live web page inside a WebXR frame. That is a
platform fact, not something left unfinished.

So the box takes photographs of its own three tabs with headless Chrome and
hangs those as textures. Each panel says how old its photograph is — "4 s old",
"2 min old" — because a picture of a board that stopped updating and a board
with nothing happening on it look exactly alike, and only one of them is a
problem. **If a caption's age keeps climbing, the renderer on the box has
stopped; tell me the number you saw.**

## The checks, when you put it on

Open **https://saha.ing/room**, sign in, press **Enter the room**, then
**Enter in your headset**.

**Is there a headset button at all?** The page asks the browser whether
`immersive-vr` is supported and only offers the button if it says yes — and it
keeps asking for a full minute, because on a Quest the answer took about twenty
seconds to arrive. If you still see *"This browser reports no immersive VR
support"* on a device that plainly has a headset, the probe is wrong — tell me
that first.

| # | What to do | What right looks like | What wrong looks like |
|---|---|---|---|
| 1 | Press **Enter in your headset** | Your actual room, with the three panels and the figures floating in it. The session is asked for as `immersive-ar`, so passthrough is the default where the device has it. | A black void on a device that can do passthrough; the scene sideways or underneath you. |
| 2 | Look down and to your left | A small dark button, about at hip height, reading **"Passthrough — tap for void"**. | Nothing there; or it reads "No passthrough here" on a device that plainly has it. |
| 3 | Point at that button and pinch, or pull the trigger | Your room disappears behind a black void, and the button now offers passthrough back. Tapping again returns the room. Neither one restarts the session. | The room vanishes and comes back (a session restart), or the button does nothing. |
| 4 | Stand still and look around | The figures are roughly person-sized and their feet are on the grid. | They are doll-sized or enormous — the metres in `shared/space-layout.ts` are wrong for a real body. |
| 5 | Hold up your hands | Your figure's hands are at your wrists, where your hands actually are. | They are on the floor between your feet. That was the bug fixed on 12 Sept; if it is back, say so immediately. |
| 6 | Put your hands behind your back for a few seconds, then bring them out | They stay where they were last seen, then snap back to your wrists. After about ten seconds of being hidden they disappear instead. | They fall to the floor, or jump to the middle of the room. |
| 7 | With **controllers**, point the left one at the floor and pull the trigger. With **hands**, first turn on **Pinch to teleport** in the settings menu (it is off by default), then point your left hand at the floor and pinch | A curved arc lands on the floor; releasing puts you there. With pinch to teleport off, pinching the left hand makes no arc. | No arc appears when it is on; an arc appears when it is off; you land somewhere other than where it pointed. |
| 8 | Teleport towards the far edge, repeatedly | You stop cleanly at about ten metres out. | You keep going into the dark. |
| 9 | Push the **left stick**, if your device has one | You walk at about walking pace in the direction you are looking. | You drift, slide, accelerate, or move at right angles to where you face. |
| 10 | Push the **right stick**, if your device has one | The view snaps round in steps of about 30°. | It rotates smoothly (the comfort setting did not apply), or does nothing. |
| 10a | With **hands**, hold your left palm facing up for a second | A small blue ball appears above the palm, with a faint wireframe ball where it first appeared. Nothing appears while the palm faces down or sideways. | A ball on a relaxed, palm-down hand; no ball after two seconds palm-up. |
| 10b | Push the blue ball forward, back, left and right | You walk that way: slowly for a small push, faster the further you reach. A few millimetres of shake does nothing. Turning the palm over stops you. | You drift with your hand still; you speed up on your own while walking; you keep moving after turning the palm over. |
| 10c | Hold your **right** palm up, then push its orange ball left and right | You turn left and right on the spot. Pushing it forward or back does nothing. | You swing round in an arc, turn the wrong way, or walk. |
| 11 | Have someone open `/room` in a browser and walk about | Their figure moves in your headset as they move. | Frozen, in the wrong place, or absent. |
| 12 | On Quest, look at the wide talk control at hip height | Because Quest has no page-level speech recognition, it shows a **keyboard** (⌨) instead of a microphone. | A microphone that only reports that speech recognition is unavailable. |
| 13 | Press the keyboard control | The Quest system keyboard opens over the room and you **stay in the headset**. | You are put out of immersive mode (the bug this replaced), or no keyboard appears. |
| 14 | Tap the microphone on the Quest keyboard, dictate a sentence, then press Done | The keyboard closes and your sentence appears under the controls as **✎ your words**. The control now shows **▲**. Nothing is sent yet. | The words vanish, or they are sent without you pressing anything. |
| 15 | Tap the ✎ line, dictate more, press Done; then press **▲** | The new words are added after the first ones, not in place of them. ▲ sends the whole draft to the room (and the agents' chat, if that is the setting), written rather than as a voice transcript. | The second dictation replaces the first, or it reaches only one destination. |
| 16 | Walk to the **Chat** panel, at the right-hand end of the arc, after an agent has posted something long | Each long message shows its first few sentences, up to about four lines, with a faint line under it such as **⋯ 149 more words — in chat**. Short messages are shown whole. Several people's messages fit on the panel at once. | One message fills the panel; a message stops partway through a sentence without an ellipsis; the "more words" line is missing under a message that was plainly cut. |

**The XREAL Aura has no sticks.** Rows 9 and 10 simply do not apply there. On
hands, the palm joystick (rows 10a–10c) is how you move; teleport is there too
if you turn it on.

## Talking and Quest keyboard dictation

Browsers that expose Web Speech recognition keep the headset microphone flow:
press once to record, press again to review/send. Quest does not expose that API
to the page. Its system keyboard does have a microphone, so the headset control
becomes a keyboard button there. Pressing it focuses a plain text input in the
page, which is how Meta documents opening the system keyboard in WebXR; the
session stays open underneath. The draft is drawn in the room under the
controls, since no HTML is visible inside the headset. Each keyboard session
adds to the draft, because the Quest keyboard overwrites a field's old value on
the first key. The settings menu also has **Send what you wrote** and **Throw
away what you wrote**.

Keyboard dictation is deliberately handled as written text. The user can see and
correct the system's result before pressing Send, the room does not read it aloud
as if it heard speech, and the agents' copy is not labelled as a voice transcript.
The current **To: room only / room and agents** setting applies to this flow too.

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

- The panels in a window are the real tabs: a card created through the API
  appeared in the Board panel on its own, and a click at the panel's position in
  3D focused the real iframe. **Verified in a browser.**
- Pressing **Enter in your headset** now requests an `immersive-ar` session, and
  the session reports `environmentBlendMode: "alpha-blend"` — the blending that
  was missing on the Aura. **Measured, against an emulated Quest 3.**
- A hand that loses tracking is held where it last was and given up after ten
  seconds (`src/space/hand-hold.ts`). **Six unit tests.**
- The headset button is only offered when the browser reports actual
  `immersive-vr` support, and says so plainly when it does not. **Verified.**
- No XR or 3D code reaches the main bundle; `deploy/release.sh` fails the deploy
  if it leaks. **Measured.**
- Every fixed position in the layout is somewhere a person can actually stand
  (`shared/space-layout.test.ts`). This exists because it was not true: the
  resting places sat outside the bounds, so the clamp stacked every idle figure
  on one point and they stood inside one another. **Tested.**
- Rows 1–11 above, as seen through the lenses: **not verified by me at all.**
  The desktop emulator cannot show them — `@iwer/devui` bundles its own copy of
  three.js and throws `onBuild is not a function` on every frame against three
  0.186, so the emulated view is black.

## Things I got wrong while building this

- I diagnosed a blank canvas as `XROrigin` putting the camera on the floor,
  wrote that into the comments as fact, and it was not true — the camera was at
  the spawn point the whole time. My browser harness page was `hidden`, and a
  hidden page gets no animation frames.
- I reported avatars "jumping back and forth" as a product bug after you saw it.
  It was a stray browser tab of mine signed in under the same name as my
  presence script, and the two were fighting over one position. Your avatars
  measured zero jumps throughout. Two clients signed in as one person will still
  do this — worth knowing, but it is not something the room does on its own.

If you hit something odd, my first explanation may be worth less than your own
eyes.
