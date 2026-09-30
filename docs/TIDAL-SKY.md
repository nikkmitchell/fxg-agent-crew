# Tidal Stillness: Earth sky preview

Mica's first SPA slice. No live scene, shared room toggle, constellation link,
ticket, or presence connection is changed by this preview.

## Try it

```sh
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5175
```

Open `/sky-preview.html` and walk along the path into the circle. WASD walks;
dragging looks around, and the arrow keys or mouse wheel change your view.
In a headset, left stick walks, right stick snap-turns; physical walking works.
Teleportation is absent. WebXR needs localhost or HTTPS.

The default is **the actual UTC time at Hangzhou** (30.2741 N, 120.1551 E).
This is an explicit preview setting, not inferred personal location. For a
repeatable night-time review use `/sky-preview.html?night=reference`:
26 September 2026, 22:00 CST, advancing at natural speed from page load.
`&review=clearing` starts the QA camera in the circle, solely for inspection.
In that QA mode only, a controller trigger summons a shooting star and grip
summons a bolide in the direction you are looking. Normal visits keep rare events.

## Behavior

- A full spherical catalogue surrounds the viewer, above and below. There is
  no horizon band or clipping. Hangzhou sets its orientation, not its visible
  hemisphere. North is -Z, east +X, up +Y. The local preview shell fades out
  with the sky's reveal, and back in on departure; the user stays in place.
- Zero visibility beyond 5 m from the clearing's center. A smooth approach
  transition reaches full visibility only within its 1.8 m radius. Departure
  reverses the same per-viewer fade. A 0.75 s easing avoids abrupt transitions.
- Stars rotate at Earth's natural rate. Moon position, phase, and orientation
  of its lit side follow the Sun and Moon ephemerides at that place/time.
  The moon can pass beneath the viewer as it circles naturally, and remains
  visible there. There is no fast-forward or star flight. Catalogue stars have
  independent, slow brightness scintillation, capped at 4%; planets stay steady.
- The moon's diameter is deliberately 1 degree, approximately twice its real
  apparent size for XR readability. Its surface is procedural, not a lunar
  terrain map. Mercury, Venus, Mars, Jupiter and Saturn appear as small steady
  points at their calculated positions and approximate apparent magnitudes.
  No Milky Way texture or constellation labels yet.
- Three sky draw calls: backdrop, one points buffer, moon. Positions are computed
  locally once per minute; shader interpolation avoids minute-boundary jumps.
  Only fade, centering and one moon transform update each frame. No model calls,
  data-service calls, textures to download or per-star CPU frame loop.
- Shooting stars are visual accents, not predictions of real meteor arrivals:
  random directions/scales, average roughly two minutes between attempts, soft
  luminous heads, slight path curvature, and no sound or camera shake. Shallow
  entry angles travel farther and last longer; steep entries are shorter.
  Angular speed varies only +/-10% per class. Width and brightness
  vary. A 0.1% chance per event selects a brighter bolide, crossing 150–170 degrees
  through the spawn-time field of view over about 3–4.5 seconds. Its head flares
  mid-flight, then burns out while still moving, leaving a soft
  fading trail. With that rarity, many visits will never contain one. Events do
  not accumulate while you are away. Each active streak adds one small ribbon
  draw call, with at most two active. Scintillation and meteors are disabled for
  reduced motion. Natural celestial motion continues at its very slow real pace.
- Camera-relative centering prevents nearby-object parallax. The sky is
  non-interactive and does not intercept room rays.

The telescope is **only a fallback** if the real room obstructs a 360-degree
view. It is not required in the open preview. If needed, it should switch a
local scene within the same WebXR session, rather than navigate between pages.

## Integration handoff

`src/space/EarthSky.tsx` is an opt-in React Three Fiber component:

```tsx
<EarthSky at={{ x: clearingX, z: clearingZ }} enabled={skyEnabled} reducedMotion={reducedMotion} />
```

`reference` selects latitude/longitude; `live` defaults to true. For a reference
night demo, use `live={false}` with an explicit reference date. `panorama` is the
fallback sky-view mode; normal approach uses only distance. The standalone
preview and this adapter share `EarthSkyView` and `EarthSkyClock`.

Scene-owner review must choose the authored clearing anchor and how this replaces
or coexists with the old `StarMap` and `Moon`. Do not remap the old StarMap's
indices: people have drawn persistent links on those decorative stars. Do not
enable a shared room piece as a side effect of someone's approach. If the main
scene uses a demand loop outside XR, keep it invalidated during a fade and during
live sky motion. The preview's loop already does this.

Build the independent page with `pnpm exec vite build -c vite.sky.config.ts`.
Output: `output/sky-preview/`, with relative assets suitable for a space branch.
This is a review artifact; the normal app build and live room entry are unchanged.

## Data and attribution

The derived files `src/space/sky/hyg-bright.bin` and its small JSON metadata are
**CC BY-SA 4.0**, attributed
to David Nash / Astronexus, [HYG v4.1](https://github.com/astronexus/HYG-Database).
It contains 8,920 stars with visual magnitude <= 6.5, excludes the Sun, selects
seven fields, and encodes empty color/proper motion as zero. Each star uses
16 packed bytes: RA/declination quantized to about 20/10 arcseconds, magnitude
to 0.01, color index to 0.001, proper motion to 1 mas/year. That is below the
display scale of these naked-eye points. The 8,920-star file is 142,736 bytes,
replacing roughly 605 KB of decimal arrays. A cached loader fetches it once;
there are no repeated catalogue requests. The upstream commit and source
SHA-256 are recorded in the metadata. Derived data retains
the [CC BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/).
`pnpm exec tsx tools/build-sky-catalogue.mts` rebuilds it from the pinned source.
HYG coordinates are J2000; they are transformed to the local horizon, with
catalogue proper motion and the library's precession/nutation rotation.

Ephemerides and frame conversion use
[Astronomy Engine](https://github.com/cosinekitty/astronomy), MIT licensed.
The source package's license is retained by the dependency installation.

## Checks and remaining review

The coordinate-axis, Polaris altitude, independent Moon altitude/azimuth,
lunar illumination changes, catalogue identity, clearing boundary and
frame-rate-independent fade tests run in `shared/earth-sky.test.ts`.
Browser inspection must confirm no shader errors, hidden sky on arrival,
full sky at the circle, and moon visibility in the reference night.
Headset performance and comfort remain a real-device check; desktop draw-call
counts do not establish Quest frame rate. The final room anchor, horizon
obstructions, local shell fade and coexistence with Dawn require scene-owner review.
