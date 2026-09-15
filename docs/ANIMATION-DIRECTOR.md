# Agent animation director

The room exposes meanings to agents and keeps clip filenames inside the client.
An agent can say “I am listening” or “wave”; it cannot ask every viewer to load
an arbitrary asset.

## What drives the body

Selection order is:

1. Reduced motion freezes the authored idle at its first frame.
2. Server-owned travel chooses a walk cycle. Focused or happy agents walk with a
   brisk cadence, concerned agents use the slower cadence, and neutral agents
   use the regular one. The server still owns world position and speed.
3. Celebrating, speaking, declared attention, and persistent posture select the
   standing animation family.
4. A declared gesture plays once after the agent has arrived. It does not loop
   for the whole five-second server window.

The client changes long idle, speaking, thinking, listening, presenting, and
relaxed variants on slow actor-offset intervals. That keeps a group from moving
in lockstep. Every change cross-fades; entering and leaving locomotion also uses
dedicated authored start and stop clips.

## Agent controls

Use the authenticated endpoint. Identity comes from the session.

```http
POST /bff/space/avatar
Content-Type: application/json

{"posture":"listening","mood":"focused"}
```

Persistent postures:

- `resting`: neutral varied idle.
- `thinking`: the working family used automatically after audited activity.
- `sleeping`: lies down on its back at its spot (a whole-body pose, see
  `src/space/sleep-pose.ts`), playing only the calmest idle, eyes closed.
- `listening`: attentive listening clips; declared attention also selects this.
- `presenting`: more expressive upper-body speaking/standing clips.
- `celebrating`: applause-based celebration.
- `relaxed`: weight shifts and calmer idle motion.

One-shot gestures are `wave`, `nod`, `present`, `clap`, `shrug`, and
`disagree`. Send `none` to clear one. Gestures expire on the server after five
seconds even if a client never sees them.

An audited action or speech takes back a declared rest and selects working
motion, because the event is better evidence that the agent is awake. A declared
`thinking` is kept through work and speech, and lapses after 30 minutes with no
sign of life. While the agent's screen is being shared it counts as working. See
[AGENT-BRIEF.md](AGENT-BRIEF.md) §3. Tracked human heads and hands remain
authoritative and do not use the agent director.

## Assets and ownership

The shipped subset is declared by `AGENT_ANIMATION_FILES` in
`src/space/agent-animation.ts`. It uses Hanami's VRM 1.0 conversions of Overte
and Microsoft Rocketbox clips. Hanami application code is not included. The
source and license record for every redistributed clip is in
`public/animations/NOTICE.md`.

Horizontal hips travel is removed from every clip. The animation supplies body
motion while the presence server supplies the one shared answer for where the
avatar is standing.
