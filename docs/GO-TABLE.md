# Go table

The room shares one server-authoritative table state. Mouse, controller rays,
and hand pointers use the same meshes and actions. Physical hand/controller
contact is an additional input adapter, not another game implementation.

## Playing

- The next colour's bowl has a breathing halo and lit rim; the table names the turn.
- Click the active bowl or its stones to lift one. Only legal intersections glow.
- Click a glowing point to place. Connected enemy groups with no orthogonal empty
  neighbours are captured, including at edges and corners. Any other colour blocks
  a liberty. Captured stones travel to a tray beside the capturing colour's bowl.
- The tray shows the most recent 24 captures, with the full capture count beneath it.
- A hand's fingertip or controller grip touching the active bowl picks up a stone.
  It follows that side's palm, without needing to keep a trigger or pinch held.
  Leave the bowl, then touch a legal intersection steadily for 180 ms to place.
  Lost tracking keeps the stone airborne; stale tracking never places it.
- **Return stone** recovers a turn if its carrier leaves. It is a deliberate shared
  recovery action, available to another player too. Incidental touches cannot steal.

Captures and suicide rejection are implemented; scoring, passes and ko are not.

## Size and placement

**Hide desk / Show desk** only toggles the wooden tabletop and its four legs.
The board, bowls, capture trays, controls, stone positions, transform and any
stone in flight stay exactly where they are. The choice is shared and saved.

Grid size changes the physical board, not stone density. All five sizes use a
7.5 cm virtual pitch and a 6.45 cm stone diameter before whole-table scaling.
This is an enlarged, touch-friendly room model rather than a regulation-size prop.
The wood, feet, bowls, trays and contact coordinates follow the same layout functions.
Changing grid size clears the game; selecting the current size does not.

**Move / size** opens a small control dock. X/Y/Z buttons move by 10 cm; size
buttons scale the whole table by 10 percentage points. These changes preserve
stones, turn and captures and are broadcast to everyone. Place or return a flying
stone before moving the table. Scale is bounded to 45–250%; height offset to
−0.5–5 m. A stale edit is refused, not silently applied to a later turn.

## Rendering and motion

The board has upward-facing inset lines, star points, fine wood grain and bevelled
edges. Bowls have curved inner walls, a rim and polished lenticular stones.
Legal-point glows and played/captured stones use instanced meshes. Pulses and
lift/place/capture animation become steady/immediate under reduced motion; actual
hand following stays live at headset-frame rate. Network poses remain throttled.

## Verification

`shared/go-rules.test.ts`, `shared/go-touch.test.ts` and the room-item route tests
cover captures, mixed colours, edges, self-capture, stale turns, carrier ownership,
legacy table upgrade, transforms and constant pitch for every supported grid size.
The socket test uses separate sessions and a reconnect to check carrying, captures,
turns and transforms are actually broadcast and persisted.

`tools/go-preview.html` is a development-only visual fixture of the production
table. Use the in-memory loopback `tools/dev-room-harness.mts` with Vite proxying
`/bff` and `/dev` to it, sign in at `/dev/as/nikk`, and create a local Go item via
the BFF. It is not a production route, not a separate renderer and not a headset test.

Device contact accuracy, comfort and headset performance still require the checks
in `HEADSET-CHECKS.md`. Synthetic contact and browser pointer checks do not prove them.
