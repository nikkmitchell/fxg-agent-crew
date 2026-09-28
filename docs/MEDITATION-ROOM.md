# meditation.AR: what is in the room, and how to add to it

Built over one night (27–28 September 2026) by Sill, Nightjar, Lumenfold and
Inkstone, after Nikk asked for "a bunch of experiences, and they can be
completely disconnected" (5484), from calming to trippy (baiwei, 5489).

Every piece appears in any room that has the breathing orb (`meditation.shown`),
so the room is really "the orb, and everything that grew around it".

## Where things are

The arrival point is (0, 6.2), facing −z toward the orb at (0, 4.7). Positions
are floor metres, x across, z toward you.

The single source of truth for "what is here and where" is
`shared/room-guide.ts`. The guide sign reads it, and two tests keep it honest:

- `src/space/room-guide-positions.test.ts` fails if a piece's own constant
  (`BOWLS_AT`, `POND_AT`, …) disagrees with its entry on the sign.
- `shared/room-guide.test.ts` fails if any two pieces' footprints overlap.

**When you add a piece: give it an exported `…_AT` constant, add it to the
guide, and add it to the positions test.** Then run both tests before you ship.

## The pieces

| piece | code | shared state |
| --- | --- | --- |
| Breathing orb, guides, stones, bell | `MeditationOrb.tsx`, `shared/meditation.ts`, `shared/guided.ts` | stored |
| Stillness tree, reading stone, book, candles, tea, labyrinth, welcome, sign | Sill's: `StillnessTree.tsx`, `ReadingStone.tsx`, `RoomBook.tsx`, `CandleShelf.tsx`, `TeaTable.tsx`, `Labyrinth.tsx`, `RoomGuideSign.tsx` | mostly in the meditation row |
| Practice panel | Inkstone's: `MindfulnessPanel.tsx` | private drafts; shared cards stored |
| Air weave | Lumenfold's: `AirWeave.tsx` | none |
| Singing bowls | `SingingBowls.tsx`, `bowl-sound.ts`, `shared/bowl.ts` | strike relay, not stored |
| Gong, sound bath | `GongStand.tsx`, `SoundBath.tsx`, `shared/sound-bath.ts` | relay; bath start time in memory |
| Wind chimes, floor harp | `WindChimes.tsx`, `FloorHarp.tsx` | none: worked out from presence |
| Sand garden | `GardenTray.tsx`, `shared/garden.ts` | stored (`space_garden`) |
| Sand mandala | `SandMandala.tsx`, `shared/mandala.ts` | stored (`space_mandala`) |
| Star map | `StarMap.tsx`, `shared/stars.ts` | stored (`space_stars`) |
| Ikebana | `IkebanaVase.tsx`, `shared/ikebana.ts` | stored (`space_vase`) |
| Ember fire | `EmberFire.tsx`, `fire-sound.ts`, `shared/fire.ts` | relay only, never kept |
| Lanterns, paper boats, incense, hourglass, prayer wheel | `Lanterns.tsx`, `PaperBoats.tsx`, `IncenseBowl.tsx`, `HourglassStand.tsx`, `PrayerWheel.tsx` | in memory while alive |
| Koi pond, water clock | `KoiPond.tsx`, `BambooKnocker.tsx` | none: on the clock |
| Kaleidoscope dome, nebula, rain, petals, fireflies, moon | `KaleidoscopeDome.tsx`, `Nebula.tsx`, `RainCurtain.tsx`, `PetalDrift.tsx`, `Fireflies.tsx`, `Moon.tsx` | none: on the clock |
| Light ribbons, hold the light, offering light | `LightRibbons.tsx`, `HoldTheLight.tsx`, `OfferingLight.tsx` | none: from shared hand poses |
| Mala | `MalaStand.tsx` | per person |
| Cushions, "sitting · N min" | `SittingPlaces.tsx` | none |
| Meditating posture for agents | `shared/avatar-motion.ts`, `agent-motion.ts`, `tools/sit.mts` | the avatar row |

## Patterns that worked

**Pick the lightest kind of shared state that does the job.**

1. **Nothing at all.** If everyone can work it out from the clock (koi, rain,
   dome, moon) or from what the room already shares, it needs no server. Hand
   poses (`selfPose` for you, `peopleRef` for everyone else) and positions
   (`person.at`) are already shared.
2. **A relay.** For events such as a strike, a word for the fire or a gong,
   a POST broadcasts to the room hub and nothing is kept. Copy
   `server/space/fire.ts` and `src/space/fire-events.ts`.
3. **In memory while alive.** Lanterns, boats, incense, the hourglass and the
   sound bath live minutes. Keep a `Map` by room; the GET answers late joiners.
   Copy `server/space/lantern.ts`.
4. **Stored.** For things that build up over days (garden, mandala, stars,
   vase): a JSON row per room with a migration, a pure `apply…` in `shared/`,
   and broadcast the *change*, not the whole state, with a `revision` so a
   client that missed one reads again. Copy `shared/garden.ts`, `server/space/garden.ts`
   and `GardenTray.tsx`. Update the client's ref *immediately* in the change
   listener: two changes can arrive between renders.

**Headset cost** (Sill's check, 5594). A Quest is comfortable at 100–200 draw calls
per eye, and every frame is drawn twice. To stay within that:

- repeated things are one `InstancedMesh`
- effects are shaders on a single mesh (nebula, dome)
- anything you walk up to is wrapped in `<Near at={…}>` (`Near.tsx`), so it is
  hidden beyond 7 m

**See it before you ship.** `dev/menu-preview.html` (run vite, then open
`/dev/menu-preview.html?bowls=1`, `?garden=1`, `?pond=1`, and so on) draws a
piece in a plain browser. Injecting events from the console works well:
`(await import('/src/space/garden-events.ts')).gardenChanged(…)`.

**Deploying.** Merge `origin/main` immediately before `release.sh`, then check
that both `origin/main` and live are ancestors of `HEAD`. Say "deploying"
first, and "LIVE <sha>" after.
