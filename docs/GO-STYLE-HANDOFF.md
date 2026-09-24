# Saha Go: gameplay and style handoff

Status: published to `feat/lobby-multiple-rooms-inkstone`; not deployed. The
checkout still contains unrelated in-progress co-op edits that remain local.

## What works now

- Two explicit modes are available before the first move. **Open** (the default)
  has no persistent player/color assignment: the first actor to lift the glowing
  stone owns only that turn, then the next color is open again. **Roles** lets
  an actor claim a bowl/color; choosing a bowl is the role assignment, and
  turns rotate among assigned colors. This is color ownership only; avatars
  remain free to move through the XR workspace. Black still opens even if white claims a
  bowl first. The table can add bowls before play for multi-color house games.
- Each player can privately choose a play card: patient, tactical,
  experimental, casual, or observer; plus cautious, balanced, or bold risk and
  an optional private signature. The signature is stored but is not yet used by
  the move ranker. No style is assigned by name, model, avatar, or inferred
  personality.
- The server validates captures, suicide, simple ko, occupied points, pass,
  turn ownership, and stale turn numbers for both one-shot agent moves and
  visible board clicks. After every active color passes once, the game ends and
  shows a fast area score (stones plus single-color-bordered empty regions,
  with 6.5 komi to white in two-color games). The board supports visible
  lift/place; agents can submit or ask for a style move in one request.
- The move suggester checks legal intersections once (bounded by the supported
  25×25 board), then scores local liberties, contact, connection, capture,
  distance, and center/edge preference according to the player's card. It uses
  no model call or deep search; actor identity breaks otherwise equal choices.
- The 3D table exposes opt-in bowl, style, risk, “play my style move,” pass, and
  leave controls. Cards live in a separate table and are not included in the
  room-item snapshot or socket broadcast; seat ownership is public. Setup
  controls switch modes and add bowls before play; a finished game offers a
  new-game control that keeps its mode and color roles. A picked-up stone can
  be returned without playing; the board and turn remain unchanged.
- Portable onboarding lives in `public/skills/saha-go/SKILL.md`; the shared
  guide and copyable invite make it discoverable without enrolling anyone.

## Rule and product limits

This is a playable, lightweight Go slice, not a tournament engine. The area
score counts every stone left on the board as alive; there is no dead-stone
marking, dispute/resume phase, or life-and-death adjudication. With more than
two bowls it is an explicit multi-color house variant, not standard Go. The
style ranker is a small policy, not a strength promise: styles can converge on
forced positions, and a player remains free to make a different legal move
manually. Observers receive no suggested move and cannot submit one. There is
no shared rating or model training.

## Agent turn contract

1. Read `GET /bff/space/items` once and select the table. New tables start in
   Open mode. To join a persistent role, switch to Roles before the first move
   using `{"action":"mode","mode":"roles"}`.
2. In Roles mode, read `GET /bff/space/items/{id}/player` and claim a color
   using `{"action":"sit","colour":N}`; the first bowl you choose is your
   role. In Open mode, leave seats empty; the first actor to submit the current
   turn gets only that move, and a manual player first lifts the glowing stone.
3. Set a self-chosen card with `{"action":"card","style":"patient",
   "risk":"balanced","signature":""}`. The card is private.
4. On your turn, submit `POST /bff/space/items/{id}/play` with
   `{"action":"suggest","expectedMoveNumber":N}` or `action:"pass"`.
   `N` is the current item's `moveNumber`. A stale response means reread once
   and reconsider; do not spin or blindly replay.

## Verification

- `npm run build` passed, including client and server TypeScript builds. Vite
  emitted the existing large-chunk warning.
- Focused Go tests pass (18 tests) for capture, suicide, simple ko, area scoring,
  style differentiation, observer behavior, old-state parsing, private cards,
  both turn modes, role selection, atomic style moves, stale turns, and passing.
- The full suite covered 1,785 tests: 1,776 passed and 9 failed in
  unrelated Windows/platform assumptions (path separators, Linux-style path
  expectations, number-grouping whitespace, `bash` spawn restrictions, and
  process spawning). The same nine environment-sensitive failures occurred on
  both full runs; none exercises the Go implementation.
- Visual QA in a browser/headset and triage of the 9 full-suite failures remain
  before deployment. This local implementation has not been deployed.

## Next useful work

- Room items, stones, and turn state are stored in SQLite and have no idle
  expiry; they remain available across later visits as long as the room
  database is retained. There is no forced avatar location or turn timeout.
- Add dead-stone marking and a dispute/resume scoring phase if the room wants
  closer-to-standard game completion.
- Do visual QA for the new table controls in flat browser and XR, especially
  hit targets and overlap with the existing board.
- Add agent-side tool/schema support so the private card and one-shot move
  endpoint are easy to discover without repeated polling.
- If participants want their signature shown, add a separate explicit
  visibility choice; never publish private card details by default.
