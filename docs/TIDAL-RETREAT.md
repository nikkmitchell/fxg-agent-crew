# Tidal Stillness: independent rain retreat

Rain is a separate experience and preview. Baiwei asked to polish the pieces
individually now, then arrange them along a path later. This page loads no sky,
star catalogue or astronomy code. It does not change meditation.AR's scene,
existing RainCurtain, Dawn or shared session state.

The sitting stone is a flat, irregular slab, with beveled broken edges, procedural
stone grain and moss over one edge. Three touching pebbles and 14 sparse grass
blades share its single draw (282 triangles total); no textures are downloaded.
All stay inside the dry central radius of 0.85 m, so drops cannot fall on them.
Four separate irregular stepping stones lead in, in one additional draw. There
is no paved path or broad floor plane: only the rain's own local wet patch.
420 drops fall in the surrounding
annulus, out to 1.6 m. Each landing makes a brief central impact and spreading
ripples, with a faint second ring. All landings share one GPU-instanced draw;
their timing matches their own drop's fall. There is no per-drop CPU frame loop.
Rain has four draws total: drops, landings, wet surface, stone. Reduced motion
freezes drop and ripple clocks. The piece fades locally with distance, becoming
fully visible within 1.6 m and hidden/silent beyond 4.6 m.

Audio is optional, local filtered noise, generated only after an explicit
Listen button or XR-entry gesture. The wrist menu can silence it. Hidden pages
are silent. Nothing records audio or requests a microphone.

The page uses joinSaha for figures, walking/palm joystick, snap turns and wrist
menu. Direct links are guests. Enter the review branch as yourself through
https://saha.ing/go/meditation.ar?branch=mica-retreat . The guest badge preserves
the branch when entering. No ticket or credential needs copying.

Build: pnpm exec vite build -c vite.retreat.config.ts . It uses the site's cached
Three instance with an import map. Its own module is about 16.5 KB raw / 6.3 KB
gzip, plus the shared kit, Three and visitors' bodies (often cached). No star
catalogue, textures, audio files or new dependencies are downloaded by this piece.

Local entry: /rain-preview.html; ?review=rain shows the approach and
?review=seat starts at the center. Local preview skips live kit connections.

## Later placement

RainRetreatView is a plain Three component. RainRetreat.tsx is the opt-in R3F
adapter, independent from EarthSky.tsx. Place it with at={{x, z}} and pass the
room's reduced-motion setting. Attach a RainRetreatHandle ref and call its
enableSound() from a real visitor button/gesture; call mute() to silence it.
Unmounting disposes geometry, materials and the audio context, including React
StrictMode's setup/cleanup cycle. It reads only the viewer's distance and never
writes shared state. No scene integration has been enabled yet.

Sill reviewed the previous desktop composition successfully. The current rain
page is intentionally separate following Baiwei's updated direction. Headset
comfort/performance, actual listening and authenticated two-person presence
remain to check before any merge into the public space. Placement and the path
joining the experiences are deferred, not part of this preview.
