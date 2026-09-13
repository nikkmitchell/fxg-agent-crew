import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { bff } from "../bff-client";
import { space } from "../space-client";
import { WRIST_BUTTON, WristButton, stackedY } from "./Backdrop";
import { createSpeechInput, speakSay, speechCapabilities, type SpeechInput, type SpeechOutput } from "./speech";
import { shouldSpeakUtterance } from "./VoiceControls";
import { newestId, replyToSpeak } from "./reply-speech";
import type { RoomFeed } from "./useRoomFeed";
import type { PanelChoices } from "./usePanelChoices";
import type { PanelArrange } from "./usePanelArrange";
import type { Showing } from "../../shared/space-wire";
import type { RoomShowingChoices } from "./useRoomShowing";
import type { Utterance } from "../../shared/voice";
import { planVoice, type VoiceDestination } from "./voice-routing";
import type { VoiceChat } from "./useVoiceChat";

/**
 * The room's controls, in front of you at body level.
 *
 * NOT ON A HAND. Two attempts lived on the left wrist and both were wrong.
 * Nikk, on the first: "almost impossible to use" — three matchbox panels
 * stacked on a hand that is also the thing you point with. On the second, which
 * folded them behind one button: "the UI is terrible... nothing to do with the
 * left hand, we don't want it following that at all."
 *
 * He is right, and the reason is worth writing down so nobody puts it back: to
 * press a button on your own hand you must hold that hand still, look at it,
 * and point at it with the other one. A control that moves whenever you move
 * the limb you aim with is a control you chase. Anything mounted on a hand has
 * to be worth that, and a settings menu is not.
 *
 * So it sits where a belt buckle would: a little in front of you, below your
 * head, following where you are and which way you are facing but NOT your
 * hands and not your head's pitch. Look down and it is there; walk and it comes
 * with you; wave and it does not move at all.
 *
 * WHY IN 3D AT ALL: the page is DOM, and DOM is not composited into an
 * immersive frame. Every control Inkstone built is present and invisible the
 * moment the headset goes on. These are the ones you need while standing up.
 *
 * ALWAYS-ON SPEECH IS OPT-IN AND OFF BY DEFAULT. Nikk asked for it directly —
 * "i want speach to be able to be left just on, so every message after it
 * finishes recording is automatically sent" — and it is genuinely the only way
 * to hold a conversation without a keyboard. It also removes the review step
 * that Inkstone and I agreed on for good reasons: a transcript is a guess, and
 * with the switch set to the group chat it is a guess published under your
 * name. So it is a deliberate choice, made twice (turn the mode on, then turn
 * the microphone on), and the button says what it will do before it does it.
 */

/**
 * Where the panel sits relative to you.
 *
 * `AHEAD` is how far in front, `HEIGHT` is how far off the floor — absolute,
 * not relative to the head, so it stays at your waist whether you are standing
 * or sitting forward. `EASE` is how quickly it catches up when you turn: it
 * lags deliberately, because a panel welded to your gaze can never be looked
 * away from, and one that snaps is worse than one that drifts.
 */
const AHEAD = 0.62;
const HEIGHT = 1.02;
const EASE = 0.12;
/** Past this much turn it starts following. Below it, stay put. */
const SLACK = 0.5;

export function RoomControls({
  /**
   * Where the player is and which way they are facing, read fresh each frame.
   *
   * A function rather than a value: this is read at frame rate and a prop would
   * mean re-rendering the whole panel ninety times a second to move one group.
   */
  anchor,
  /** Who the room thinks you are, for the group-chat line. */
  you,
  /** Which WebHarness room to post into, when there is one. */
  groupRoom,
  passthrough,
  passthroughAvailable,
  blendMode,
  onTogglePassthrough,
  voice,
  liveUtterance,
  feed,
  panels,
  arrange,
  showing,
  showingChoices,
}: {
  anchor: () => { at: { x: number; z: number }; yaw: number } | null;
  you: string | null;
  groupRoom: string | null;
  passthrough: boolean;
  passthroughAvailable: boolean;
  blendMode: string | null;
  onTogglePassthrough: () => void;
  /** Live voice between people in the room, owned above the session. */
  voice: VoiceChat;
  /** The newest thing said in the room, for reading replies aloud. */
  liveUtterance: Utterance | null;
  /** The WebHarness chat, which is where the agents actually answer. */
  feed: RoomFeed;
  /** Which panels are hanging on the arc, and the way to change it. */
  panels: PanelChoices;
  /** Whether a panel is currently being moved or resized. */
  arrange: PanelArrange;
  /** What the room is showing, as everybody in it sees it. */
  showing: Showing;
  /** What it could show, and how to change it for everybody. */
  showingChoices: RoomShowingChoices;
}) {
  const group = useRef<THREE.Group>(null);
  const [open, setOpen] = useState(false);
  /**
   * BOTH, BY DEFAULT, IN A HEADSET.
   *
   * It used to default to the room alone, and that quietly defeated the point.
   * The agents do not read the room's own transcript — they live in the
   * WebHarness chat — so speaking with this set to "the room" meant talking to
   * the people standing next to you and to nobody else, and you had to
   * remember to flip a switch for your words to reach the colleagues you were
   * trying to reach. Nikk's goal is to "chat with my coworkers and our agents";
   * the default should be the thing he asked for, and the switch is there for
   * the times he wants the room alone.
   */
  const [destination, setDestination] = useState<VoiceDestination>("room-and-agents");
  const [alwaysOn, setAlwaysOn] = useState(false);
  /**
   * Whether replies are read out.
   *
   * ON BY DEFAULT HERE, unlike in the window. In a window a reply is a line of
   * text you can glance at; in a headset the transcript is a photograph on a
   * wall you may not be facing, and the whole exchange is hands-free by
   * necessity. Somebody who speaks a question into a room and gets no audible
   * answer has to go and find one, which is not a conversation.
   */
  const [hearReplies, setHearReplies] = useState(true);
  const speaking = useRef<SpeechOutput | null>(null);
  const spokenAlready = useRef<number | null>(null);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<SpeechInput | null>(null);
  const confidence = useRef<number | undefined>(undefined);
  const capabilities = useMemo(() => speechCapabilities(), []);

  // Read by the recognition callbacks, which are created once and would
  // otherwise close over the first value of everything they touch.
  const live = useRef({ alwaysOn, destination, groupRoom, you });
  live.current = { alwaysOn, destination, groupRoom, you };

  const post = useCallback(async (transcript: string) => {
    const { destination: to, groupRoom: room, you: me } = live.current;
    const plan = planVoice(transcript, to, { confidence: confidence.current, speaker: me ?? undefined });
    if (plan.refused) {
      setNotice(plan.refused);
      return;
    }
    setSending(true);
    const failures: string[] = [];
    for (const item of plan.posts) {
      try {
        if (item.to === "room") {
          await space.say({
            say: item.say,
            source: "voice",
            ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
          });
        } else if (!room) {
          failures.push("the group chat (no room)");
        } else {
          await bff.sendMessage(room, item.content);
        }
      } catch {
        failures.push(item.to === "room" ? "the room" : "the group chat");
      }
    }
    setSending(false);
    // NAMED INDIVIDUALLY. Being told your words reached the agents when they
    // did not is the quiet failure this product exists not to have.
    if (failures.length === 0) {
      setHeard("");
      confidence.current = undefined;
      setNotice(to === "room" ? "Sent to the room." : "Sent to the room and the chat.");
    } else {
      setNotice(`Did not reach ${failures.join(" or ")}. Your words are still here.`);
    }
  }, []);

  useEffect(() => {
    if (!capabilities.recognition) return;
    input.current = createSpeechInput({
      onPhase: (phase) => setListening(phase === "listening"),
      onInterim: setHeard,
      onFinal: (result) => {
        setHeard(result.text);
        confidence.current = result.confidence;
        if (live.current.alwaysOn) {
          void post(result.text);
          // Straight back to listening, so a conversation does not need a tap
          // between every sentence. Recognition ends itself on each utterance.
          window.setTimeout(() => input.current?.start(), 250);
        } else {
          setNotice("Tap Send, or speak again.");
        }
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => input.current?.dispose();
  }, [capabilities.recognition, post]);

  /**
   * READING THE ANSWER OUT LOUD — the half that was missing.
   *
   * Everything around this shipped without it: the state, the refs, the
   * "Replies read aloud" row, and `speakSay` imported and never called. So the
   * headset had a switch that said replies were being read and a room that
   * never made a sound. Nikk: "now we don't have any voice over."
   *
   * IT LISTENS TO TWO PLACES, because the conversation happens in two.
   * `liveUtterance` is somebody in the room speaking to you by name;
   * `feed` is the WebHarness chat, which is where every agent replies and
   * therefore where almost all of the answers are. Watching only the first —
   * which is all the window does — is why this was silent even in the moments
   * it was working.
   *
   * NEVER WHILE THE MICROPHONE IS OPEN. A speaker playing into an open
   * recogniser is a machine talking to itself.
   */
  useEffect(() => {
    if (!hearReplies) {
      // Marked as read anyway. Turning sound on must not begin by reading out
      // whatever was said while it was off.
      spokenAlready.current = Math.max(spokenAlready.current ?? 0, newestId(feed.messages));
      return;
    }
    if (spokenAlready.current === null) {
      // Arriving mid-conversation. Everything already on the panel is history,
      // and reading forty messages at somebody who just put a headset on is
      // not a welcome.
      spokenAlready.current = newestId(feed.messages);
      return;
    }
    if (listening) return;
    const reply = replyToSpeak(feed.messages, spokenAlready.current, you);
    if (!reply) return;
    spokenAlready.current = reply.id;
    speaking.current?.cancel();
    speaking.current = speakSay({
      say: reply.say,
      onPhase: () => {},
      onFailure: (failure) => setNotice(failure.message),
    });
  }, [feed.messages, hearReplies, listening, you]);

  /**
   * The room's own transcript, when somebody in it speaks TO YOU by name.
   *
   * Separate from the chat above because the rule is different and already
   * written down: `shouldSpeakUtterance` is the window's, and restating it here
   * would be a second copy of a judgement about when it is acceptable to make
   * noise at somebody.
   */
  const utteranceSpoken = useRef<number | null>(null);
  useEffect(() => {
    if (!liveUtterance || utteranceSpoken.current === liveUtterance.id) return;
    utteranceSpoken.current = liveUtterance.id;
    if (!hearReplies || listening || !shouldSpeakUtterance(liveUtterance, you)) return;
    speaking.current?.cancel();
    speaking.current = speakSay({
      say: liveUtterance.say ?? "",
      onPhase: () => {},
      onFailure: (failure) => setNotice(failure.message),
    });
  }, [liveUtterance, hearReplies, listening, you]);

  // Nothing keeps talking after the panel goes away.
  useEffect(() => () => speaking.current?.cancel(), []);

  const facing = useRef<number | null>(null);

  /**
   * The panel follows you, driven per frame rather than through React: a head
   * moves at headset frame rate and routing that through state would re-render
   * this tree ninety times a second to move one group.
   *
   * It follows your POSITION immediately and your DIRECTION lazily, and only
   * once you have turned past a few tens of degrees. Turning your head to look
   * at something must not drag the menu across your view — you would never be
   * able to look away from it — but walking away from it and leaving it behind
   * would be worse.
   */
  useFrame(() => {
    const node = group.current;
    const body = anchor();
    if (!node) return;
    node.visible = body !== null;
    if (!body) return;

    if (facing.current === null) facing.current = body.yaw;
    // Shortest way round, so turning past a half-circle does not send the panel
    // the long way about.
    let delta = body.yaw - facing.current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > SLACK) facing.current += delta * EASE;

    const yaw = facing.current;
    node.position.set(
      body.at.x - Math.sin(yaw) * AHEAD,
      HEIGHT,
      body.at.z - Math.cos(yaw) * AHEAD,
    );
    node.rotation.set(0, yaw, 0);
  });

  const step = WRIST_BUTTON.height + WRIST_BUTTON.gap;
  const rows: { label: string; tone?: "normal" | "muted" | "live"; onTap: () => void }[] = [];

  if (!open) {
    // STOP IS ALWAYS ONE TAP, never behind a menu. Inkstone's review: an
    // always-on microphone needs an immediate stop, and "tap to open, then find
    // the right button" is not immediate when what you want is to stop talking
    // to a room. So while it is listening the folded panel IS the stop control,
    // and the settings move to a second row under it.
    if (listening) {
      rows.push({
        label: alwaysOn ? "Stop — sending as you speak" : "Stop listening",
        tone: "live",
        onTap: () => input.current?.stop(),
      });
    }
    rows.push({
      label: listening ? "Settings" : alwaysOn ? "Settings — speech set to auto-send" : "Settings",
      tone: "normal",
      onTap: () => setOpen(true),
    });
  } else {
    // TALKING OUT LOUD comes first, above dictation, because it is the thing
    // somebody standing next to another person wants: to be heard by them,
    // rather than to have their words typed into a room.
    rows.push({
      label: voice.on
        ? voice.others.length > 0
          ? `Talking — you hear ${voice.others.join(", ")}`
          : "Talking — nobody else has theirs on"
        : "Talk out loud",
      tone: voice.on ? "live" : "normal",
      onTap: () => voice.setOn(!voice.on),
    });

    rows.push(
      capabilities.recognition
        ? {
            label: listening ? "Stop listening" : alwaysOn ? "Start talking" : "Speak once",
            tone: listening ? "live" : "normal",
            onTap: () => (listening ? input.current?.stop() : input.current?.start()),
          }
        : {
            label: "This headset has no speech recognition",
            tone: "muted",
            onTap: () => setNotice("There is no microphone available to this browser."),
          },
    );

    rows.push({
      label: alwaysOn ? "Sending as you speak" : "Review each one before sending",
      tone: alwaysOn ? "live" : "normal",
      onTap: () => setAlwaysOn((on) => !on),
    });

    rows.push({
      label: destination === "room" ? "To: the room only" : "To: the room and the agents",
      onTap: () => setDestination((d) => (d === "room" ? "room-and-agents" : "room")),
    });

    rows.push({
      label: hearReplies ? "Replies read aloud" : "Replies stay silent",
      tone: hearReplies ? "live" : "normal",
      onTap: () => setHearReplies((on) => !on),
    });

    if (!alwaysOn) {
      rows.push({
        label: sending ? "Sending…" : heard ? `Send: ${heard}` : "Nothing heard yet",
        tone: !heard || sending ? "muted" : "normal",
        onTap: () => void post(heard),
      });
    }

    rows.push({
      label: !passthroughAvailable
        ? `No passthrough — this headset says: ${blendMode ?? "nothing yet"}`
        : passthrough
          ? "Passthrough — tap for void"
          : "Black void — tap for passthrough",
      tone: passthroughAvailable ? "normal" : "muted",
      onTap: () => passthroughAvailable && onTogglePassthrough(),
    });

    /**
     * WHAT IS HANGING ON THE ARC, from inside the headset.
     *
     * These toggles existed already — in the DOM settings on the page, which is
     * exactly where you cannot reach them: the moment the headset goes on the
     * page is gone, and the arrangement of the room becomes the one thing you
     * can see and not change. Nikk: "we also need settings to be able to adjust
     * which board is showing and which content."
     *
     * The same `usePanelChoices` the page uses, not a second copy, so a panel
     * closed in here is closed at the desk too — it is stored on the server for
     * that reason.
     *
     * A tick rather than a word, because the label is the panel's own name and
     * the state has to be readable at arm's length without being read.
     */
    for (const panel of panels.catalogue) {
      const shown = panels.open.includes(panel.id);
      rows.push({
        label: `${shown ? "\u2713" : "\u00b7"} ${panel.label}`,
        tone: shown ? "live" : "muted",
        onTap: () => panels.setOpen(panel.id, !shown),
      });

      /**
       * MOVE AND RESIZE, PER PANEL, AND ONLY FOR ONES THAT ARE UP.
       *
       * Offering to move a panel that is not in the room would be a control
       * with nothing to act on. One row that cycles rather than two switches,
       * because the three states are mutually exclusive and a menu you reach
       * from inside a headset should be short: the row says what tapping the
       * PANEL will now do, which is the thing you are about to do next.
       */
      if (!shown) continue;
      const mode = arrange.modeOf(panel.id);
      rows.push({
        label:
          mode === "locked"
            ? `   ${panel.label}: fixed in place`
            : mode === "move"
              ? `   ${panel.label}: drag it to move`
              : `   ${panel.label}: drag it to resize`,
        tone: mode === "locked" ? "muted" : "live",
        onTap: () => arrange.cycle(panel.id),
      });
    }

    /**
     * WHAT THE ROOM IS SHOWING — for everybody, not just you.
     *
     * This is the one control in this menu that changes what other people are
     * looking at, so it says so on every row. Nikk: "if one user changes what
     * board is being show, it should update for everyone."
     *
     * The project list is offered as a row each rather than a cycle, because
     * cycling through projects means passing through other people's boards on
     * the way — every step is a change everybody in the room sees.
     */
    const projects = showingChoices.projects;
    if (projects === null) {
      rows.push({ label: "Projects could not be read", tone: "muted", onTap: () => {} });
    } else if (projects.length === 0) {
      rows.push({ label: "There are no projects yet", tone: "muted", onTap: () => {} });
    } else {
      for (const project of projects) {
        const on = showing.projectId === project.id;
        rows.push({
          label: `${on ? "\u2713" : "\u00b7"} Room shows: ${project.name}`,
          tone: on ? "live" : "normal",
          onTap: () =>
            showingChoices.choose(
              // Tapping the one already showing turns it off rather than doing
              // nothing — otherwise there is no way back to showing nothing.
              on ? { projectId: null, boardId: null } : { projectId: project.id, boardId: null },
            ),
        });
      }
    }

    // The mood boards of whatever the room is on. Only ever the legal ones:
    // the server refuses a board from another project, and offering one would
    // be inviting a refusal.
    if (showing.projectId && showingChoices.boards && showingChoices.boards.length > 0) {
      for (const moodBoard of showingChoices.boards) {
        const on = showing.boardId === moodBoard.id;
        rows.push({
          label: `${on ? "\u2713" : "\u00b7"} Mood board: ${moodBoard.title}`,
          tone: on ? "live" : "normal",
          onTap: () =>
            showingChoices.choose({
              projectId: showing.projectId,
              boardId: on ? null : moodBoard.id,
            }),
        });
      }
    }

    if (showingChoices.refusal) {
      rows.push({ label: showingChoices.refusal, tone: "muted", onTap: () => {} });
    } else if (showing.setBy) {
      // WHO CHANGED IT. A wall that is showing something else should be
      // answerable without asking around.
      rows.push({
        label: `Set by ${showing.setBy}`,
        tone: "muted",
        onTap: () => {},
      });
    }

    // ONE WAY OUT OF ALL OF IT. Somebody who has unlocked three panels and
    // wants to go back to reading them should not have to find three rows.
    if (arrange.anyUnlocked) {
      rows.push({
        label: "Fix every panel in place",
        tone: "normal",
        onTap: () => arrange.lockAll(),
      });
    }
    if (panels.refusal) {
      rows.push({ label: panels.refusal, tone: "muted", onTap: () => {} });
    }

    // LAST, so it sits exactly where the Settings button was: the same spot
    // opens the menu and closes it, and your hand does not have to go looking.
    rows.push({ label: "Close", onTap: () => setOpen(false) });
  }

  /**
   * THE MENU GROWS UPWARD FROM THE BUTTON.
   *
   * It used to hang down: the first row sat at the anchor and everything else
   * went below it, which put a long open menu somewhere around your knees.
   * Nikk: "we want the last item to be at the settings button, so its all above
   * that." So the LAST row is the anchored one and the list stacks above — and
   * since the last row is now Close, the thing you tapped to open the menu is
   * the thing you tap in the same place to shut it.
   *
   * The row count changes as the menu opens and as speech comes and goes, and
   * anchoring the bottom means the rows above shift while the one under your
   * hand stays put — which is the right way round. The alternative moves the
   * button out from under you at the moment you reach for it.
   */
  const said = notice ?? voice.trouble;

  return (
    <group ref={group} visible={false}>
      {rows.map((row, index) => (
        <WristButton
          key={`${index}-${row.label}`}
          label={row.label}
          tone={row.tone}
          y={stackedY(index, rows.length)}
          onTap={row.onTap}
        />
      ))}
      {/* BELOW THE ANCHOR, deliberately outside the stack. A notice arrives
          unbidden — a failed send, a microphone that would not open — and if it
          joined the list it would jog every button up by a row at the exact
          moment you were reaching for one. */}
      {said ? (
        <WristButton label={said} tone="muted" y={-step} onTap={() => setNotice(null)} />
      ) : null}
    </group>
  );
}
