# meditation.AR: room inventory and curation audit

Mica, 30 September 2026. Source baseline `origin/main` **d388995**, read without
changing the checkout. Live room settings read at **16:37 UTC** as Mica. This is
source/configuration analysis plus desktop checks of the independent previews;
it is not a headset comfort assessment or a measured live-room frame-rate report.
No shared pieces, session, candles, drawings or placements were changed.

## What is actually present

The main saha.ing room named **meditation.AR** and the Git space **meditation.ar**
are distinct. The space's main is still the multiplayer starter (`316fa15`).
The room workbench follows `wip` (`8c29f9c`): a turning orb model and a portal.
Our sky/rain/sakura/firefly scenes are independent previews, not replacements
already deployed into the room. Adding the reusable bowl to xr.instruments also
does not automatically add it to the main room; Nightjar's live-piece host is a
separate integration path.

The guide has **39 entries** including the orb; seven extra toggles bring the
room to **45 toggleable pieces**. Live settings show **19 toggles enabled**,
plus the breathing orb, sitting places, guide/sign and session bell infrastructure.
An enabled toggle does not imply constant visible activity (Dawn is scheduled,
for example). The shared session is paused. I left it that way.

| Area | Enabled in the current room | Hidden by the current room settings |
|---|---|---|
| Breath / quiet reading | Breathing orb, Reading stone, Candle shelf, Still flower, Hourglass | Stillness tree, Room's book, Practice panel, Incense, Mala, Breathing silk, Silence bell |
| Sound / hand instruments | Singing bowls, Wind chimes, Prayer wheel, Floor harp | Gong, Sound bath |
| Sand / water / still tasks | Sand garden, Sand mandala, Koi pond | Tea table, Labyrinth, Ikebana, Ember fire, Lanterns, Offering light, Cairn, Paper cranes, Fog mirror, Water clock, Paper boats |
| Immersive environments | Rain curtain, Kaleidoscope dome, Nebula, Hold the light | Light ribbons, Fireflies |
| Sky / atmosphere | Star map, Moon, Petals, Dawn | — |
| Shore family | — | Shore, Tide pool, Conch, Shore bench (their host group also contains glow steps / seabirds) |

Positions live in `shared/room-guide.ts`; actual hosts are in
`src/space/Scene.tsx`. Extra infrastructure is not included in the 45-piece count.

## Findings, in priority order

### 1. Reduced motion is not an effective room-wide control

`Scene.tsx` passes the setting to **MeditationOrb** and **SharedDawn**, but none
of the other currently enabled meditation components receive it. In XR the
render loop intentionally stays `always`, so using a desktop demand loop is not
a substitute for freezing decorative motion in the pieces.

Confirmed moving without that setting: rain drops/rings; kaleidoscope shader;
koi and water; nebula shader; drifting petals; star twinkle/halo; Moon;
wind-chime sway; candle flicker; Hold the light pulse; Still flower opening/glow.
Bowls shimmer after a strike, prayer wheel after a push, hourglass heaps/turn
after activation. Interaction-driven movement should remain functional while
decorative animation holds its current pose. Garden/harp contact checks should
keep running, rather than being disabled with the render loop.

**Owner:** Sill / original component owners. Wire one local comfort setting to
pieces; verify in XR rather than relying on desktop redraw labels. Our nature,
rain and sky previews already have local reduced-motion handling; they are not
proof that the legacy room does.

### 2. Distance hiding presently reveals almost everything at arrival

`Near.tsx` sets a hard `visible` boundary (default **7 m**), not a fade; it leaves
children mounted, with their frame callbacks and sound running. At the arrival
`(0, 6.2)`, every currently enabled guide-listed piece wrapped by `Near` is
within its visibility radius. Even the rain at `(3.6, 0.3)` is just **6.91 m**
away. Nebula uses 9 m; petals use 9 m. The kaleidoscope, floor harp, old sky and
Moon do not have this outer distance wrapper.

Thus this is draw culling for distant locations, not the walk-in reveal Baiwei
asked for. It also cannot be described as zero CPU cost for hidden pieces.

**Owner:** curation Mica + host/kit Sill/Nightjar. Keep experiences separate;
give each a small local reveal zone, an approach fade and a quiet exit. Update
the anchor API rather than globally shortening all radii and losing intended
sound/contact behavior. Do not move shared content before agreement.

### 3. The arrival composition remains busy despite hiding 26 pieces

Hourglass/chimes are ~1.3 m from arrival; bowls/garden/reading stone ~2.3-2.4 m;
candles ~3.1 m; pond/flower/mandala/wheel ~3.7-4.0 m. The guide, orb and sitting
places also occupy this core. These are source distances, not headset judgments.
Several competing tasks are offered before a newcomer has chosen one.

**Curation proposal:** one calm arrival and optional agent guide; separate rain
seat, sky clearing, blossom pocket and firefly pocket along an irregular walking
path. Use empty space between them. Keep instruments optional and locally
audible. Preserve the sand, reading and offerings as small destination areas,
not a ring of simultaneously moving demonstrations. This follows Baiwei's
request to assemble independent experiences later like bricks.

### 4. Legacy rain still has a repetitive sound and CPU animation

`RainCurtain.tsx` loops a **3-second** random noise buffer through static filters.
Each frame writes **420 drop matrices + 70 ring matrices** and uploads the
instance matrices. Instancing keeps draws low, but does not remove those CPU
updates. The frame callback continues when its `Near` group is hidden. Drops
cover the whole circle; there is no dry raised seat in that component.

The independent `mica-retreat` preview addresses these points: GPU animation,
continuous fresh noise with slow color/wash changes and irregular soft impacts,
an annular rain field and one plain dark **45 cm** sitting stone. It must remain
separate from sky. No moss/grass/log embellishments remain (Baiwei's latest choice).

**Owner:** Mica preview, Sill integration review. Headset audio/comfort pending.

### 5. The legacy star map serves a different purpose

`shared/stars.ts` makes **160 artificial stars on a shallow overhead dome**,
with persistent user-drawn links. `StarMap.tsx` updates all instance matrices
for twinkle on each frame. This is a communal constellation drawing activity,
not Earth's 360-degree sky. Its saved links should not be deleted to replace
the view. `Moon.tsx` is a separate older piece, not the new sky's astronomy.

The separate `mica-sky` preview supplies the real full spherical catalogue,
Hangzhou orientation, Moon/planet calculations, clearing-only reveal, subtle
twinkle and meteors. Keep the old drawing activity available as its own optional
piece; do not show two unrelated star fields / Moons over each other.

### 6. Some pieces deserve preservation rather than automatic replacement

The existing fireflies land on a still hand. The new independent firefly pocket
focuses on enveloping quiet atmosphere; it does not yet preserve that hand-landing
interaction. Existing sand garden strokes, mandala grains, star links, room book,
candles and shared session history are persistent social content. Keep them intact
through any scene curation or live-piece migration. Petals already provide an
ambient blossom effect; avoid layering them over the new sakura destination.

### 7. Specific implementation costs to investigate, without claiming a benchmark

- Kaleidoscope uses a 64×48 sphere and a full surrounding shader; measure stereo
  fill cost inside it, not only its one mesh/draw count.
- Nebula performs GPU motion (good), but collects/filters room hands each frame.
- Existing fireflies (currently hidden) allocate Maps, temporary arrays and
  several Vector3 objects per frame; reuse storage when polishing hand landing.
- Garden repaint work scales with saved strokes, but it is triggered by changes;
  do not mistakenly classify it as an always-repainted animated texture.
- Prayer wheel motion is driven by recent pushes; it is not perpetually spinning.
- Candle flame explicitly invalidates the canvas every frame, even under desktop
  demand rendering; a comfort setting must reach Flame itself.
- A guide with 45 shared toggles is useful for hosts, but too much decision-making
  for an arrival. Keep host controls away from the calm approach.

No current FPS, battery, memory or GPU timing measurements were collected in a
headset, and no functional failures in untested interactive pieces are asserted.

## Review sequence / ownership

1. Human Quest review of the four independent previews: comfort, text/scale,
   movement smoothness and subtle sound taste. Keep them separate until approved.
2. Sill addresses host comfort/reveal plumbing; Nightjar owns sandbox live pieces.
3. Mica maps small destination zones and ports only approved experiences to the
   resulting API. Existing saved state remains reachable.
4. Two-person headset check and a before/after stereo performance capture before
   a main-room integration. Tell Sill before any meditation.ar main merge.

Preview entry: `/go/meditation.ar?branch=mica-retreat` (rain), `mica-sakura`,
`mica-fireflies`; sky visual/VR review is `/s/meditation.ar/@mica-sky/`.
