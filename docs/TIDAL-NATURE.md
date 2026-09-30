# Two independent Tidal Stillness nature clearings

Baiwei asked for sakura and fireflies as separate experiences: walk into a
place, feel surrounded, then walk away. They remain separate branch previews,
alongside the separate sky and rain pieces. No meditation.AR scene, session,
public main, room setting or shared state is changed.

## Sakura

A small, asymmetric flowering bough frames open standing space. Seven tapered
branch segments merge into one mesh. 280 small five-lobed blossoms have varied
positions, scale, rotation and pink tones. 112 petals drift and tumble slowly,
with different fall speeds, phases and wandering offsets. Each new fall changes
its sideways path while out of view; birth and landing fade gently. There are
64 scattered fallen petals, rather than a complete pink carpet.

Sound is a very quiet continuous wind/leaf wash with stochastic soft flutter
swells. The signal is newly generated, not a recording or short repeated clip.

## Fireflies

72 small lights surround the viewer at different heights and distances. Each
has a slow independent wandering path, a soft core and halo, and a smooth pulse.
Pulse strength changes from one glow to the next; intervals vary gently and
there is no strobe. Five unequal pockets of sparse grass frame a clear center.
The lights do not follow the viewer or swarm into their face.

Sound is a faint night breeze with rare, distant insect phrases. These are
background insects, not chimes attached to firefly flashes. Everything is quiet
enough to leave space for conversation and silence.

## Local reveal and comfort

Both are fully present within 1.6 m of their placed center and fade smoothly to
hidden/silent at 5 m. Proximity is local to each visitor. The pieces stay at their
world position; there is no teleportation, camera animation or forced action.
Reduced motion freezes the existing animation clock and pose, rather than
resetting it to the start. Sound is a separate explicit Listen/VR-entry choice;
the wrist menu can mute it. Leaving or hiding a page fades sound out and stops
synthesis after the tail. Unmounting disposes geometry/materials and closes audio.
Neither preview requests a microphone, records audio, or makes model calls.

## XR budget

Sakura: 5 piece draws and 1,156 triangles. Fireflies: 3 piece draws and 296 triangles.
The optional preview approach adds 1 draw and 240 triangles to either. Live kit
figures and menus add their own cost; they are not included in these budgets.
Movement and glow are calculated by the GPU. Main-thread updates set a few
uniforms; there is no per-petal or per-firefly CPU loop, collision simulation,
postprocessing, dynamic light, shadow map, texture or external 3D model.

Both pages share a roughly 21 KB module (about 8 KB gzip), using the site's
cached Three and kit. Their audio worklet is approximately 2 KB, fetched only
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
