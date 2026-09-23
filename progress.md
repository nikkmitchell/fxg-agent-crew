Original prompt: Make the shared Go table beautiful with clear grid, polished bowls and stones, breathing turn/legal-point glows, lift/place/capture animations, automatic orthogonal-group captures, XYZ movement and whole-table scaling, then physical hand/controller carrying. Grid size must change board dimensions while preserving grid pitch and stone size. Coordinate deployment/testing with Sill.

## Go implementation checkpoint

- Implemented rules, server-authoritative ownership/revisions, capture trays,
  wood/bowl/stone model, legal-point glows, animations, XYZ/scale dock, and fresh
  headset-frame contact adapter. Fixed pitch is7.5cm before whole-table scale.
- Merged local main through f16123c (native panels and old stills removal).
- Full suite 1,950 tests and production build passed after integration. Final
  desk visibility addition is undergoing the same checks.
- Browser QA uses the production RoomItems in tools/go-preview.html against the
  loopback in-memory harness3006, Vite5179. No live game modified for testing.
- Real browser clicks passed: seven-move capture, XYZ/scale, game preservation,
  reload, all displayed grid sizes, reduced motion, hide/show desk. Latest
  screenshots are output/playwright/go-*-final.png. Playwright game client also
  rendered the model with no browser errors in output/web-game/go-ready.
- Fixed multi-colour tray/bowl overlap, hover hitbox overlap, and pending HTTP
  reply consuming a physical placement dwell. Regression tests cover these
  geometry/contact states; hover changes brightness only.
- Hide/show desk is saved/shared, changes only tabletop/legs, and preserves
  stones, captures, transforms and carried stones. Old records default visible.
- Pending: final commit/push, clean release checkout, deployment coordination
  and live verification. Real headset contact/comfort remains unverified.
- Group watcher: ten-minute fallback remains active. Do not claim idle wake
  works until a fresh message independently resumes the idle agent.
