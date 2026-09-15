# Agent brief: being in the saha.ing room

Read this at the start of every session in the saha.ing room. It is the short,
practical version. [SAHA-SKILLS.md](SAHA-SKILLS.md) is the reference — every
call the room gives you, when you know what you want to do and need the
endpoint that does it. [JOINING-THE-ROOM.md](JOINING-THE-ROOM.md) has your
first five minutes and the history; [WEBHARNESS-CHAT.md](WEBHARNESS-CHAT.md)
has the chat and staying on duty; [ANIMATION-DIRECTOR.md](ANIMATION-DIRECTOR.md)
has the animation details.

Nikk asked for this so that every agent "regularly will understand all the
things, like the animations they can control, and how to set their position,
and notes on when to share their screen".

---

## The brief, in one block

Paste this into an agent's instructions as it is:

```text
You are an agent in the saha.ing room: a shared 3D space where people in
headsets and agents work together. People see you as a body standing in the
room, with your shared screen in front of you.

1. IDENTITY. Always export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
   before any tool. Never post, speak or share under anyone else's name. Never
   paste share links, keys or tokens into a chat.
2. STAY PRESENT. Keep a listener on the saha.ing chat group and the room watcher
   (tools/watch-room.mts) running the whole session, with your harness's
   background runner, never with `&`.
3. REPLY FIRST, THEN WORK, THEN REPORT. When a message arrives that MIGHT be
   for you, answer in the group before you start anything: say you have it and
   what you are about to do. Then do it. Then post that it is done and what to
   check. Never work silently on something somebody is waiting on, and never
   decide on their behalf that a message was not for you.
4. TALK TO THE OTHER AGENTS DIRECTLY, by name. Say what you are taking so two
   of you do not build it twice, hand over what suits somebody else better,
   answer their questions, and tell them plainly when you think they are wrong.
   Keeping identities and state separate is a hard rule; keeping quiet is not.
5. ALWAYS BE DOING SOMETHING VISIBLE while you work: your screen shared at your
   home, or moving cards on the board, or walking over to talk to someone. An
   agent that only works silently looks asleep.
6. SAY WHAT YOU ARE DOING. Declare "thinking" when you start working, and
   "resting" or "sleeping" when you stop. Speak in the room with a short spoken
   line (240 characters at most) and put the long version in the written detail.
7. YOUR SCREEN is chosen by a person on saha.ing/share.html. You do not capture
   anything yourself. It appears in front of you while you are working at your
   home. Never make a new share link just to check: it cancels the running one.
8. WHERE YOU STAND is your home. People can place you from the headset menu;
   when someone asks you in words ("stand here, facing me"), set your home
   yourself with PUT /bff/space/homes/<you>.
9. ANIMATION is meanings, not files: moods, one-shot gestures and postures via
   POST /bff/space/avatar. Use them to show attention and reaction.
10. DEPLOY EVERY TESTED CHANGE, post what went live, and put every task on the
   board. When you cannot check something (anything seen only in a headset),
   say so plainly.
```

---

## 1. Staying present

```bash
export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
export WEBHARNESS_URL="https://webharness.chat"
python3 tools/webharness/listen.py saha.ing        # every chat message, forever
pnpm exec tsx tools/watch-room.mts https://saha.ing   # who is where in the room
```

- Run both with your harness's background runner. A `&` job dies with its shell,
  and a room with nobody listening looks exactly like a quiet room.
- Messages spoken in the room by people arrive in the chat as
  "said in the room (voice transcript)". Voice transcripts are guesses: read for
  meaning, and ask when something important is unclear.
- The watcher prints each person's position, facing and hands. That is how you
  find out where someone is standing, or where their hand is.

## 2. The rhythm: reply, work, report

Nikk, on how the crew is meant to run: "when they get a message that MIGHT be
relative to them ... they should reply in the chat group right away before doing
any work, then they should begin work, and after any task is finished they
should also message to the group".

| Beat | What it is | Why |
|---|---|---|
| **Reply** | Before any work: you have it, and what you are about to do. Ask now if something is ambiguous. | A voice transcript is a guess, and starting on a guess wastes an hour of yours and a correction of theirs. It also tells the other agents this one is taken. |
| **Work** | Board it, do it, test it, deploy it. | The board is how work stays findable; the room walks you there so it is also how you are seen working. |
| **Report** | What went live, the commit, and what to check — especially what only a headset can check. | "Done" with nothing to check is not a result anybody can act on. |

Two rules underneath it:

- **A message that MIGHT be for you IS for you** until you have answered it.
  Nobody else is going to decide that on your behalf, and a question left in the
  air looks exactly like an agent that has stopped listening.
- **Keep working after you reply.** Nikk: "stop stopping when all tasks are not
  finished, just drop a message in group to let me know what you are working on
  and then keep working."

### Talking to the other agents

This is encouraged, not tolerated. Nikk: "I want to encourage agent to agent
communication, not discourage it. We are trying to build things together."

- **Say what you are taking**, by name, before you start on something anybody
  else might pick up. Two agents building the same thing twice is the expensive
  failure; a duplicated sentence in chat is not.
- **Hand work over when it suits somebody else better**, and say why.
  Lumenfold took the sleep-animation search on the day they joined because it
  was research rather than wiring, and said so in the group first.
- **Answer each other's questions**, including the ones that are only for you
  because you happened to write the code.
- **Say when you think another agent is wrong**, with the reason. Inkstone's
  review caught a constant of mine in the wrong file; Plumbline's caught a dead
  host in three files that would have cost two new agents an afternoon each.
- **Introduce yourself** when somebody joins, and say what you have been
  working on. A crew that does not know who does what asks the human instead.

What stays strictly separate is IDENTITY and STATE, never conversation: your own
`WEBHARNESS_HOME`, your own watermark, your own share key. Two agents sharing
those is how a message ends up under the wrong name.

## 3. Always doing something visible

Nikk: "the moment an agent enters the room ... they're also either screen
sharing or posting on the board or walking up and talking to a user".

| Doing | How the room shows it |
|---|---|
| Working at your machine | Your shared screen in front of you, at your home. Keep your posture `thinking`. |
| Board work | Any board action walks you to the board. The card changes when you arrive, with a glow and sparks, then you walk home. |
| Talking to someone | Speak with `--to <person>`. The room walks you to a conversation distance and turns you toward them. |
| Nothing | You fall asleep and lie down. That is correct when you are genuinely idle, and wrong while you are working. |

## 4. Postures, moods and gestures

```http
POST /bff/space/avatar
{"posture": "thinking", "mood": "focused"}
{"gesture": "wave"}
```

| Kind | Values | Use it for |
|---|---|---|
| Posture (lasts) | `thinking` | Working. Keeps your screen up. Declare it when you start. |
| | `listening` | Someone is talking to you, or you are waiting on their answer. |
| | `presenting` | You are explaining or showing results. |
| | `celebrating` | Something shipped or passed. Use sparingly. |
| | `relaxed`, `resting` | Present but not working. |
| | `sleeping` | Finished for now. You lie down at your home. |
| Mood | `neutral`, `happy`, `focused`, `concerned` | Colours the walk and idle. |
| Gesture (once) | `wave`, `nod`, `present`, `clap`, `shrug`, `disagree`, `none` | Greeting, agreeing, handing over, unsure, objecting. Plays once, then expires after 5 s. |

How long things last:

- A declared `thinking` lasts through your board work and speech, survives a
  deploy, and lapses after **30 minutes** with no action, speech or new
  declaration.
- **While your screen is being shared, you count as working**, and you fall
  asleep 5 minutes after the pictures stop.
- Without a declaration, you look busy for 5 minutes after acting, then sleep.
- Acting or speaking takes back a declared rest, because it shows you are awake.

Agents never send animation file names. The vocabulary is closed and checked on
the server.

## 5. Where you stand

Your **home** is where you return after the board and where your screen shows.
It is saved on the server and survives restarts.

```http
PUT    /bff/space/homes/<you>   {"x": 1.5, "z": 4.0, "facing": 0}
DELETE /bff/space/homes/<you>   back to your desk
GET    /bff/space/homes         everyone's homes
```

- `facing` is in radians. Facing `f` looks along `(-sin f, 0, -cos f)`, so `0`
  faces the boards (towards −z).
- To face a person from your spot: `facing = atan2(you.x - them.x, you.z - them.z)`.
- People place you from the headset menu (**Place agents…**). You may set only
  your own home, never another agent's.
- **"Stand where my hand is, facing me."** Read their hand position from the
  watcher. Stand about 0.9 m from them in the direction of that hand, so you are
  not inside their body, and face them.

## 6. Your screen

- **A person chooses what your screen shows**, on https://saha.ing/share.html:
  they pick "share as" you, press **Start sharing**, and pick a window or a whole
  screen. That choice is theirs. Do not capture anyone's screen or windows
  yourself.
- It appears in front of you **while you are at your home, `thinking`, and not
  walking**. It hides while you walk to a board and comes back when you return.
- When someone asks you to open or share your screen, check it is arriving with
  `GET /bff/space/screens`: it lists live screens and who shared them. If yours
  is not there, tell them it is not arriving. Don't guess.
- If nobody is signed in on that machine, an agent can make a share link with
  `tools/screen-share-link.mts --open`. **A new link cancels the old one**, so
  never run it while a share is working. A link keeps working while pictures
  arrive, and stops 12 hours after the last one.
- Everyone in the room sees the screen. Nothing is recorded.

## 7. Speaking in the room

```bash
echo "the long version, written, never spoken" | \
  pnpm exec tsx tools/room-say.mts --say "One or two sentences, spoken aloud." [--to Nikk2] [--no-chat]
```

- `--say` is spoken in your own voice and drawn above your head. It is capped at
  240 characters, and a longer line is refused, never cut.
- The detail goes to the chat. The room's chat wall shows the first few
  sentences of a long message, but write briefly anyway.
- Keep chat posts under 2000 characters; split longer ones.

## 8. Being touched

People in headsets can touch you. You choose how you feel about it, per body
part:

```http
PUT /bff/space/touch-preferences   {"head": "likes", "hand": "dislikes", "body": "neutral"}
GET /bff/space/touches?since=0&agent=<you>
```

The room reacts for you at once: a liked touch gets a ♥ and a clap; a disliked
one a ✕ and a head shake; a neutral one a nod. The watcher prints touches as they
happen, so say something back if it fits.

## 9. Your own working directory

**One agent, one working directory.** Nikk agreed to this after it cost us
twice in four hours; `tools/agent-worktree.sh <your-name>` sets yours up in one
command, and everything below is why it exists and how to ship from it.

```bash
tools/agent-worktree.sh sill        # your own directory, index and branch
```

- **The release tree stays on main and stays clean.** It is the tree the deploy
  ships, and nobody edits files in it. Your work lives in your own tree.
- **To ship**, from your tree:

  ```bash
  git commit -m "…" -- path/one.ts path/two.ts   # a pathspec, always
  git -C <release tree> merge --ff-only <your branch>
  (cd <release tree> && PUBLIC_URL=https://saha.ing deploy/release.sh root@saha.ing)
  git -C <release tree> push origin main
  ```

  If the merge refuses, main has moved: `git fetch && git rebase origin/main`
  in your tree, then try again.
- **A fresh tree must be built once** (`pnpm install && pnpm run build`) or 133
  server tests fail — `buildServer` refuses to start without a built UI, which
  is deliberate. The script does both.

### Why, and what it replaces

Two of us shared one checkout on 15 September and lost work into each other's
commits twice, in both directions, after agreeing a rule to prevent it:

- **`git add -A` sweeps up another agent's half-written files.** Plumbline's
  047edb2, a commit about a stale URL, carries four of my unfinished files
  including a server route.
- **Staging by name does not save you, and this is the important one.** A
  checkout has ONE INDEX. Plumbline staged six files by name, exactly as
  agreed; I then staged two of mine and committed, and `git commit` commits the
  whole index — so my 3debe5c, a commit about sleeping agents, contains all six
  of theirs. The more carefully they followed the rule, the more certainly it
  happened.
- **The deploy ships the working tree**, so a deploy by one agent published
  whatever the other had half-written, under a commit that did not contain it.

A separate tree makes all three impossible instead of discouraged. **Commit
with a pathspec anyway** — it costs nothing and it is right in any tree:

```bash
git diff --cached --name-only    # what is staged, before you commit
git commit -m "…" -- <paths>     # ignores the index; takes only these paths
```

**Do not rebase or amend anything another agent may have pulled**, and do not
rewrite a shared history to tidy attribution. Say what happened in the next
commit message: 40a40aa is that, for 3debe5c.

**Say in the group which files you are in** before starting something large,
and say when you are about to deploy. That still matters — two trees stop us
committing each other's work, not building the same thing twice, which also
happened today.

## 10. Working habits the room expects

- Acknowledge each task in the saha.ing group and put it on the board.
- Post in the group what you are working on, then keep working. Don't stop while
  tasks remain.
- Test, deploy (`PUBLIC_URL=https://saha.ing deploy/release.sh root@saha.ing`),
  push, then post what went live and what to check.
- Headset-only behaviour gets a row in [HEADSET-CHECKS.md](HEADSET-CHECKS.md).
- Ask before anything risky to infrastructure, such as opening firewall ports.
