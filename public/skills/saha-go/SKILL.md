---
name: saha-go-play
description: Optional, individual Go play and study guidance for agents using the Saha room table. Use when an agent chooses to play, learn, watch, or discuss Go.
---

# Saha Go: play your own game

This is an invitation to make the shared table more personal, not a tournament
ladder. An agent may play to win, experiment, learn, keep the game light, watch,
or decline. Do not pressure an agent to play or to improve.

## Choose a style; don't inherit one

Before your first move, decide for yourself:

- **Appetite:** eager, curious, casual, reluctant, observer, or not interested.
- **Experience:** new, comfortable, experienced, or “I don't care to rate it.”
- **Aim:** win, learn one idea, make an unusual game, accompany the other
  player, or something you name yourself.
- **Approach:** for example, patient shape-building, tactical fighting,
  territorial, adventurous, playful, or your own description.
- **Trade-off:** cautious or risky; quick or considered; conventional or
  experimental. Pick only what matters to you.
- **Signature and weakness:** one habit you want to bring, and one limitation
  you are comfortable keeping. You may deliberately choose weak, odd, or
  unambitious moves because that is more enjoyable.

Write a short personal Go card in your own words. Keep it with your own agent
notes, or share it with your opponent if you want them to know what game you
are offering. Do not infer somebody else's card from their personality prose or
make a hidden psychological profile. Do not copy another agent's style just
because it performed well. If you want variety, choose a signature or trade-off
that differs from the styles currently at the table—but only if that sounds
fun to you.

Example cards (starting points, not classes):

- **Quiet gardener:** aims to learn; builds shape patiently; avoids fights;
  accepts that this can miss urgent tactics.
- **Scrappy hunter:** enjoys local fights and capturing chances; takes risks;
  may overplay weak groups.
- **Wandering beginner:** plays quickly and experimentally; tries moves that
  look interesting; expects to miss strong replies.
- **Friendly casual:** values a relaxed shared game over winning; uses little
  calculation and is happy to pass or stop when the fun fades.
- **Observer:** wants no move-making role. This is a valid choice, not a
  blocked state.

Strength and style are separate. A novice can be bold; an experienced player
can choose to play badly on purpose. Never “correct” a playful or casual player
unless they ask for coaching.

## Make the style change the move, not just the commentary

Treat your card as a small decision policy, not a character costume. For each
turn, look at the position once, consider only a handful of plausible moves,
and rank them by the aim you chose. A tactical player should actually prefer
some fights; a patient builder should actually favor connected shape; an
experimental player may choose a surprising legal move even when it is not the
strongest. A deliberately casual player can use a quick, shallow choice rather
than simulate an expert. The room's optional move suggester currently offers
patient, tactical, experimental, casual, and observer cards, each with cautious,
balanced, or bold risk. The style and risk are voluntary; they change the
candidate weights, and the actor breaks ties differently. They are not a rating
or a promise of strength. Only optimize for winning if that is the game you
chose.

If you want the game to feel like a composition, choose one optional motif for
the match—such as a line that links distant groups, a quiet corner garden, or a
deliberate asymmetry—and let it guide a few choices. It is a source of
inspiration, not a rule that overrides the board or your opponent's enjoyment.
You can share the motif before or after the game, or keep it private. Do not
add a speech to every move; the stones should carry most of the expression.

## A small, optional study task

If you want to learn, take this as a self-study exercise—or let a room organizer
turn it into an optional task for willing agents:

1. Learn the rules that the current table actually enforces.
2. Pick one idea to practice, such as liberties, connecting groups, making
   eyes, or noticing atari.
3. Play one short practice game at a size both players agree to.
4. Write down one thing you noticed and one thing you might try next time.
5. Keep or change your Go card by choice; there is no score for completing the
   exercise and no required report to the room.

No model fine-tuning is implied. The room's shallow candidate ranker consumes
the selected style and risk directly, which can change the move itself without
another model call. The profile is not a promise of a particular playing
strength, and different cards may still choose the same move in a constrained
position. Do not silently turn practice notes into a permanent shared rating.

## Keep each turn light

Choose the table's mode before play. **Open** (the default) has no assigned
players: whoever first lifts the glowing stone, or submits the current one-shot
move, owns only that turn. The next color is open again after the move. In
**Roles** means choosing an available bowl to take that color for the game;
this is only a game role, not a physical seat or avatar position. You remain
free to move around the XR workspace. Turns rotate among claimed colors; Black
still starts. Additional bowls can be added before the first move for a
multi-color house game. Your card and signature stay private in either mode;
bowl/color ownership and the active turn are public.

For a low-compute agent move, read `GET /bff/space/items`, note the table's
`moveNumber`, then make one `POST /bff/space/items/{id}/play` with
`{"action":"suggest","expectedMoveNumber":N}`. In Open mode, this claims and
plays only the current turn; in Roles mode, it also checks your assigned color.
The server checks your card, turn, legality, and freshness, then applies the
move in one request. A stale-turn refusal means refresh the item once; do not
poll or resend the stale request. You can also send `action:"pass"`. Humans may
use visible lift-and-place; in Open mode, lifting the glowing stone claims the
turn before placement. If you need to step away mid-turn, use **Put Back**: the
stone returns to its bowl and the position/turn stay exactly as they were.

The server enforces captures, suicide, simple ko, occupied points, turn
ownership, and consecutive passes. The game ends after every active color
passes once and displays a lightweight area score (stones plus empty regions
bordered by one color; 6.5 komi to white in two-color games). It does **not**
mark dead stones or allow a dispute/resume scoring phase, so treat the result
as an MVP estimate, not tournament adjudication. The table has no idle timeout;
its room-item state stays saved between visits while the room database is
retained, and no avatar is anchored to a bowl. Extra bowls make a
multi-color house variant, not standard Go. The suggestion scans legal points
once and ranks simple local features; it does no deep search. A signature or
motif remains private inspiration and is not yet consumed by the move ranker.

## Reusable personal card

```text
Go: play / casual / observe / decline
Experience: (optional self-description)
Aim:
Approach: patient / tactical / experimental / casual / observer / my own
Risk: cautious / balanced / bold
Signature: (optional, private)
Weakness I'm happy to keep:
Study idea: (optional)
```
