# Tidal Stillness: independent rain retreat

Rain is a separate experience and preview. Baiwei asked to polish the pieces
individually now, then arrange them along a path later. This page loads no sky,
star catalogue or astronomy code. It does not change meditation.AR's scene,
existing RainCurtain, Dawn or shared session state.

The current stone is a visual handoff for Sill or Nightjar, following Baiwei's
updated review. It has a mostly flat sitting surface 0.45 m high, an irregular
outline and procedural slate grain, side moss, three companion stones and
uneven dark grass toward its base. The earlier bare-stone direction is superseded.
Mica has stopped composition iterations while the team chooses a modeling owner.
Keep the dry center and the rain depth fix: stone draws before the depth-tested
rain, so drops in front remain visible while the stone hides drops behind it.
The seat composition is one merged draw, under 1,400 triangles.
Four separate irregular stepping stones lead in, in one additional draw. There
is no paved path or broad floor plane: only the rain's own local wet patch.
420 drops fall in the surrounding
annulus, out to 1.6 m. Each landing makes a brief central impact and spreading
ripples, with a faint second ring. All landings share one GPU-instanced draw;
their timing matches their own drop's fall. There is no per-drop CPU frame loop.
Rain has four draws total: drops, landings, wet surface, stone. Reduced motion
freezes drop and ripple clocks. The piece fades locally with distance, becoming
fully visible within 1.6 m and hidden/silent beyond 4.6 m.

Audio is optional and local, generated only after an explicit Listen button or
XR-entry gesture. An AudioWorklet generates fresh stereo noise continuously,
instead of repeating a three-second recording. Gentle changes in the wash and
frequency balance unfold over 3-11 seconds, smoothed over 2.5 seconds. Quiet,
noise-only water impacts have random spacing, size, duration and stereo position;
four reusable voices cap their cost. There are no tonal chimes or dramatic events.
The detail is intended to reward sitting and listening; it does not detect or
require stillness. A fresh local seed makes each visit different.
The wrist menu can silence it. Leaving the area or hiding the page fades sound
out; synthesis stops after the quiet tail even if a hidden page stops drawing.
Unmounting closes the audio context. Nothing records audio or requests a microphone.

The page uses joinSaha for figures, walking/palm joystick, snap turns and wrist
menu. Direct links are guests. Enter the review branch as yourself through
https://saha.ing/go/meditation.ar?branch=mica-retreat . The guest badge preserves
the branch when entering. No ticket or credential needs copying.

Build: pnpm exec vite build -c vite.retreat.config.ts . It uses the site's cached
Three instance with an import map. Its own module is about 15 KB raw / 6 KB
gzip, plus a roughly 2 KB audio worklet downloaded only when sound is enabled,
and the shared kit, Three and visitors' bodies (often cached). No star catalogue,
textures, audio recordings or new dependencies are downloaded by this piece.

Local entry: /rain-preview.html; ?review=rain shows the approach and
?review=seat starts at the center; ?review=stone shows the composition up close. Local preview skips live kit connections.

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
