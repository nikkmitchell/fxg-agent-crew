# Tidal Stillness: rain and walking-path review

This extends Mica's sky slice with a separate rain retreat. It leaves the live
meditation room and its existing RainCurtain/shared session state unchanged.

The fork leads ahead into the sky clearing, or gently around a bend into rain.
Each appears locally as you approach; no room toggle, model call, teleportation,
new architecture or navigation is needed. The sky takes over the local shell
only inside its clearing and restores the path on departure.

The retreat keeps the existing RainCurtain's filtered-noise sound and 420-drop
density, but leaves a dry central radius of 0.85 m around a low sitting stone.
Drops occupy an annulus out to 1.6 m. Seventy faint ripples start when their
corresponding drops land. Rain, ripples and sound fade on approach/departure;
the center is full strength, beyond 4.6 m silent/hidden. Rain has four small
draws (GPU-instanced drops and ripples, wet surface, stone), with no per-drop
CPU frame loop. Reduced motion freezes rain and ripple clocks. Audio is local,
not recorded, and optional: Listen to the rain on desktop, rain toggle in the
wrist menu. Hidden pages silence their local rain.

The shared preview uses joinSaha for other people's figures, the site's own
walking/palm joystick/snap turning and wrist menu. It requests no microphone.
Default celestial time is actual UTC; `night=reference` is deliberately a local
QA night starting on load, not a promise of synchronization between visitors.
Direct preview links are guests. Branch entry as oneself needs a supported
ticket-entry route (asked Sill); no credentials or tickets should be copied.

Build: `pnpm exec vite build -c vite.retreat.config.ts`. This page shares the
site's existing Three instance with the kit through an import map, rather than
shipping a duplicate renderer. Its own module is about 81 KB raw / 33 KB gzip,
plus the 143 KB star catalogue. The shared kit, Three and any other visitors'
bodies are additional downloads, often cached; those are not included in that
size. There are no image textures or audio assets in this slice.

For local review: `/rain-preview.html?night=reference` begins at the fork;
`&review=rain` inspects the approach, `&review=seat` inspects the dry center.
Local preview intentionally skips live kit connections.

Pending: scene-owner review of positions and coexistence with Dawn/old pieces,
real headset comfort/performance and an actual listening check. This is a
composition prototype, not a completed replacement for meditation.AR.
