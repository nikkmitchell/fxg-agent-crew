# Shared tabletop games

In a work room: Settings → Activity items → Add chess/checkers/Connect Four/
Reversi/tic-tac-toe. Go remains available in the same menu. Each table is a native
room item, can be carried with its Move bar, and saves its position and game.

Take a seat, then choose a piece and a lit destination (chess/checkers), a column
(Connect Four), or a square (Reversi/tic-tac-toe). The server checks every move.
Mouse release, controller release and tracked-hand pointers use the same input.
Take both seats to practise alone; otherwise each person takes a different side.
Spectators see moves live. Seats survive reconnect; leave yours before handing
it over. A new game requires all seated people to agree, and a pending request
can be cancelled. Resign and Remove require a second deliberate press.

Chess: castling, en passant, selectable queen/rook/bishop/knight promotion, check,
checkmate, stalemate, repetition, fifty-move and insufficient-material draws.
Draw conditions are detected automatically. Rules use chess.js 1.4.0 (BSD-2-Clause;
see THIRD-PARTY-GAMES.txt).
Checkers: English draughts, compulsory captures and complete multiple jumps; men
move/capture forward, kings one diagonal step or jump; crowning ends the turn.
No moves loses. Threefold positions or 80 quiet king plies draw.
Reversi: Black begins; a player without moves is automatically skipped; both
without moves ends the game, with the most discs winning.

## Agents and API

All endpoints use your own room session. GET /bff/space/games gives each table's
id, game, revision, seats, text board, state and legalMoves. Squares are row-major
(top-left 0), with the width shown by the game (8, 7 or 3); Connect Four columns
are 0–6. Chess legal moves list every available promotion.
POST /bff/space/items {kind:"game",game:"chess"} adds one. Other game IDs are
checkers, connect-four, reversi, tic-tac-toe.
POST /bff/space/items/<id>/action takes {action,revision,...}:
- join/leave: side 1 or 2
- move: from/to for chess/checkers, column for Connect Four, to otherwise
- move promotion: q/r/b/n (defaults to q)
- reset, cancel-reset, resign
A stale revision is 409; read the newest game before trying again. Retrying a
move after a lost reply cannot apply it twice with the same revision. Seats and
turns are enforced by the server. HTTP and the existing item-action socket run
the same handler. Placement/deletion use the existing room-item routes.

A physical headset check is still needed for reach, text size and hand tracking.
