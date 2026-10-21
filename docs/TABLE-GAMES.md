# Shared tabletop Things

Chess, English draughts/checkers, Connect Four, Reversi and tic-tac-toe are
`defineItem` modules, listed in `saha-pieces.json`. Bring them into a work room
through **Settings → Library**. The bundled **Games room** is a `defineSpace`
that composes all five; any space may reference an individual game in `things`.
The existing Go table stays in Activity items.

The host places, carries, scales and removes each Thing using the usual handle.
Take a seat, then choose a piece and a lit destination (chess/checkers), a column
(Connect Four), or a lit square (Reversi/tic-tac-toe). Controls use `ctx.ui` and
`ctx.input.press`: mouse, controller ray, pinch and fingertip input share one
path. Headset reach/legibility still need a physical-device check.

Take both seats to practise alone. Spectators see confirmed moves live. Seats
survive reconnect and server restart; leave yours before handing it over. Both
seated people must agree to a new game, and requests can be cancelled. Resigning
requires a second press. Removal uses the platform Thing controls.

Chess supports castling, en passant, queen/rook/bishop/knight promotion, check,
checkmate, stalemate and automatic repetition/fifty-move/insufficient-material
draw detection. Rules use chess.js 1.4.0 (BSD-2-Clause; THIRD-PARTY-GAMES.txt).
Checkers uses compulsory captures and complete multiple jumps; men move/capture
forward, kings one diagonal step or jump; crowning ends the turn. No moves loses.
Threefold positions or 80 quiet king plies draw. Reversi automatically skips a
player without moves and ends when neither can move; most discs wins.

## Why a game service

Ordinary `ctx.state` is last-write-wins and currently memory-only on the server.
It cannot arbitrate simultaneous moves or retain matches through a restart.
`ctx.games` is a host service, like `ctx.books`: it validates moves on the server
and keeps the match inside the durable module room item. It does not alter the
phase-2 model contract or use moments as a pretend authoritative log.

```js
setup(ctx) {
  let current;
  ctx.games.watch("chess", table => { current = table; draw(table); }, showError);
  // From a press. Revision comes from the last confirmed snapshot.
  // ctx.games.action({ action: "move", revision: current.revision, from: 52, to: 36 });
}
```

Subscriptions are removed when the Thing unloads. Reconnects/hot reloads restore
confirmed data. Stale writes are refused and the host refreshes the latest match.
The service is scoped to `ctx.id`; composed children have distinct matches under
their child IDs. Two copies of the same game do not share seats or moves.
A standalone site/test host without the service reports that a room is required.

## Build and source

`src/things/table-games.ts` draws plain Three under `ctx.root`; game logic lives
in `shared/table-games.ts`. `pnpm build:games` generates space-ready ES modules,
manifest, Games room, landing page and attribution in `dist-things/`. Its only
bare imports are `three` and `saha`; chess.js is bundled. Copy these files into
a space's git and obtain peer review before publishing. The platform must first
include the game host service. A preview built against an older platform will
report the missing service rather than inventing local multiplayer state.

## Agents and API

All endpoints use your own room session. `GET /bff/space/games` lists matches,
including composed children, with IDs, revisions, seats, text boards and legal
moves. Squares are row-major, top-left 0, with width 8, 7 or 3; Connect Four
columns are 0–6. Chess legal moves include promotion choices.

Bring a Thing with the normal `POST /bff/space/items` and
`{kind:"module",source:{space,branch,entry}}`. There is no native `kind:"game"`
creation path. `POST /bff/space/items/<encoded ctx.id>/game` with `{game:"chess"}`
opens or reads that instance's match. It refuses a different game on the same ID.
`POST /bff/space/items/<encoded ctx.id>/game/action` takes `{action,revision,...}`:

- `join` / `leave`: `side` 1 or 2.
- `move`: `from`/`to` for chess/checkers, `column` for Connect Four, `to` otherwise.
- `promotion`: `q`, `r`, `b`, `n` (queen by default).
- `reset`, `cancel-reset`, `resign`.

A stale revision is HTTP 409. Retrying after a lost reply cannot move twice with
the same revision. Match updates use the existing room-items socket broadcast;
they cannot be overwritten through the moduleState relay. Placement and deletion
use the normal module-item routes, and deleting a Thing deletes its matches.

## Declaring game access

A manifest entry must explicitly grant its game slots. For an individual table:
`{ "id": "chess", "item": "chess.js", "games": { "": "chess" } }`.
For a composed space with a child named left:
`{ "id": "club", "space": "club.js", "games": { "left": "chess" } }`.
Paths are at most three child keys, with at most 40 declared slots. Grants are
recorded by the server when a Thing is brought in, from the validated manifest;
a write body cannot grant itself games. Re-bring the Thing after changing its
slot declarations. Unrelated Things and undeclared child paths are refused.

Game changes advance only the match revision. Carrying/scaling uses the Thing’s
separate placement revision, so play does not invalidate a drag. Client merges
keep the newest revision of each match independently of placement snapshots.
Invalid stored chess histories are quarantined when parsing saved Things, so
one damaged match cannot break the room’s game listing.

Finished spaces retain the platform’s existing write lock (also used by Go):
opening or changing a match there is refused. This batch supports work rooms
and composed work spaces; enabling play inside published finished spaces needs
a separate platform policy change.
