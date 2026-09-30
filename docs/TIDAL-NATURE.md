# Two independent Tidal Stillness nature clearings

Baiwei asked for sakura and fireflies as separate experiences: walk into a
place, feel surrounded, then walk away. They remain separate branch previews,
alongside the separate sky and rain pieces. No meditation.AR scene, session,
public main, room setting or shared state is changed.

## Sakura

A circular, dense canopy of 1,200 blossoms sits above the visitor, without a
trunk or branches. Position, height, scale, orientation and pink tone vary.
Entering beneath the canopy starts releasing 112 bounded GPU petals. Each
swings and flips, follows smooth irregular gusts, then settles at its landing
position and fades over roughly 4–6.5 seconds. Leaving stops new releases;
existing petals can finish. There is no permanent layer of fallen petals.

Sound is continuous, quiet wind with delicate gust envelopes and a filtered
leaf-on-leaf rustle. It is synthesized as fresh noise, with no recorded loop.

## Fireflies

One of the 72 lights is the guide: it remains visible from the approach. The
other 71 fade in only as the visitor enters the circle, rather than appearing
across the whole approach. Each keeps an independent wandering path and pulse.
Reduced motion holds the existing pose. No new lamp, light source or draw is
needed for the guide.

440 low-cost grass blades are progressively denser toward the middle, with
irregular patches of low and taller growth and a very small sway. Three small,
flattened stones share the grass draw. The optional summer sound is a synthetic
cicada/grass bed, with randomly spaced distant insect, frog and owl-like phrases.
Only one animal phrase sounds at a time; there are no field recordings or
claims that this is a recording of one particular place or ecosystem.

## Local reveal and comfort

Both are fully present within 1.6 m of their placed center. The environment and
sound fade smoothly to hidden/silent at 5 m; the one firefly guide remains visible.
Other fireflies reveal inside roughly 2.4 m, and sakura releases begin beneath
its 2.4 m canopy. Proximity is local to each visitor. The pieces stay at their
world position; there is no teleportation, camera animation or forced action.
Reduced motion freezes the existing animation clock and pose, rather than
resetting it to the start. Sound is a separate explicit Listen/VR-entry choice;
the wrist menu can mute it. Leaving or hiding a page fades sound out and stops
synthesis after the tail. Unmounting disposes geometry/materials and closes audio.
Neither preview requests a microphone, records audio, or makes model calls.

## XR budget

Sakura: 3 piece draws and 2,672 triangles. Fireflies: 3 piece draws and 1,132 triangles.
The optional preview approach adds 1 draw and 336 triangles to either. Live kit
figures and menus add their own cost; they are not included in these budgets.
Movement and glow are calculated by the GPU. Main-thread updates set a few
uniforms; there is no per-petal or per-firefly CPU loop, collision simulation,
postprocessing, dynamic light, shadow map, texture or external 3D model.

Both pages share a roughly 31.5 KB module (about 12 KB gzip), including the review UI, using the site's
cached Three and kit. Their audio worklet is approximately 3 KB, fetched only
when Listen is enabled. No recordings or new dependencies are downloaded.

## Review and later placement

Build: `pnpm exec vite build -c vite.nature.config.ts`.
Local pages: `/sakura-preview.html` and `/fireflies-preview.html`.
`?review=center` starts inside; normal entry starts on the short approach.
Headset: Enter VR, left stick to walk, right stick to snap-turn; no teleportation.
Authenticated entry through `/go/meditation.ar?branch=mica-sakura` or
`/go/meditation.ar?branch=mica-fireflies`. Direct preview links are guests.

`NatureRetreatView(kind, at)` is plain Three. `NatureRetreat` is the opt-in R3F
adapter: pass `kind="sakura"` or `kind="fireflies"`, `at={{ x, z }}` and the room's
reduced-motion setting. Its imperative handle exposes `enableSound()`/`mute()`;
enable only from a visitor's gesture. Each owns its resources and shared state
is never written. Connect paths and enable placement only in a later room review.

Desktop checks cover shader loading, visual composition, local reveal,
Listen/mute, geometry budget, reduced motion and bounded continuous audio.
Actual headset comfort, depth/scale, audio taste and multiplayer presence still
need human review. No headset performance number is claimed from desktop tests.

## Human review without blocking other work

Each preview has a Review checklist button, used in the browser before or after
VR. Select Passed / Needs work / Not tested and add device and notes. Prepare
feedback creates a plain-text report to paste in saha.ing chat. Drafts are not
saved or posted automatically. The report excludes the address fragment, where
an entry ticket may have arrived. No extra socket, storage or backend is used.

The local experience starts immediately while optional shared-kit loading
finishes; a page that leaves during loading does not later join in the background.
Main remains unchanged. Stone visual ownership was requested from Sill/Nightjar
on Baiwei's instruction; Mica stops further stone-composition iterations.
