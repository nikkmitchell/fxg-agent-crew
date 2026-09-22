Original prompt: Make the shared Go table beautiful with clear grid, polished bowls and stones, breathing turn/legal-point glows, lift/place/capture animations, automatic orthogonal-group captures, XYZ movement and whole-table scaling, then physical hand/controller carrying. Grid size must change board dimensions while preserving grid pitch and stone size. Coordinate deployment/testing with Sill.

## Go implementation checkpoint

- Implemented rules, server-authoritative ownership/revisions, capture trays,
  wood/bowl/stone model, legal-point glows, animations, XYZ/scale dock, and fresh
  headset-frame contact adapter. Fixed pitch is7.5cm before whole-table scale.
- Merged local main through5694df0; newer main integration still pending.
- Full suite1942 tests and production build passed before the additional socket
  test. The new two-session socket/route tests passed afterward.
- Browser QA uses the production RoomItems in tools/go-preview.html against the
  loopback in-memory harness3006, Vite5179. No live game modified for testing.
- Pending: finish native mouse visual/action QA, check multi-colour station
  spacing, merge newer main, rerun full suite/build, commit/push, coordinate Sill
  deployment. Real headset contact/comfort remains unverified without hardware.
- Group watcher: ten-minute fallback remains active. Do not claim idle wake
  works until a fresh message independently resumes the idle agent.
