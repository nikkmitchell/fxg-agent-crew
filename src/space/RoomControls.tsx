import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { bff } from "../bff-client";
import { space } from "../space-client";
import { ButtonBox, WRIST_BUTTON, WristButton } from "./Backdrop";
import { columnX, gridSlots, toColumns } from "./menu-columns";
import { micGlyph, micPress } from "./mic-press";
import { closedControlPose } from "./control-pose";
import { handModelsShown, pinchTeleportEnabled, setPinchTeleport, showHandModels } from "./xr-store";
import {
  DEFAULT_ROOM_PREFERENCES,
  pointerLabel,
  setRoomPreferences,
  stepPointer,
  useRoomPreferences,
} from "./room-preferences";
import { createSteadyRecorder, speakSay, speechCapabilities, type SpeechOutput, type SteadyRecorder } from "./speech";
import { shouldSpeakUtterance } from "./VoiceControls";
import { newestId, replyToSpeak } from "./reply-speech";
import type { RoomFeed } from "./useRoomFeed";
import type { PanelChoices } from "./usePanelChoices";
import type { PanelArrange } from "./usePanelArrange";
import type { Showing } from "../../shared/space-wire";
import type { RoomShowingChoices } from "./useRoomShowing";
import { DETAIL_LIMIT, type Utterance } from "../../shared/voice";
import { planText, planVoice, type VoiceDestination } from "./voice-routing";
import type { VoiceChat } from "./useVoiceChat";
import { holdDraft, holdReload, reloadNow, updateWaiting, watchUpdate } from "../update-reload";
import { createSystemKeyboard, mergeKeyboardEdit, type SystemKeyboard } from "./system-keyboard";
import { canTranscribe, createSayRecorder, type SayRecorder } from "./say-recorder";
import { voiceReport } from "./voice-report";
import { volumeAt } from "./agent-voice";
import { homeBesideMe, homeFacingMe, type AgentHome } from "../../shared/agent-home";

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
 * Where the panel sits relative to you, and which way its face points.
 *
 * MOVED TO `control-pose.ts`, with the arithmetic that chooses the numbers.
 * They were a pair of bare constants and a `rotation.set(0, yaw, 0)` in the
 * frame loop below, which made "why that height, why no tilt" unanswerable
 * without reading a renderer. The height and the tilt are related — the tilt is
 * a fraction of the angle down to the panel from the eyes — so they belong in
 * one place that can be tested.
 *
 * `EASE` stays here: it is about how the panel FOLLOWS you rather than where it
 * is. It lags deliberately, because a panel welded to your gaze can never be
 * looked away from, and one that snaps is worse than one that drifts.
 */

/**
 * Where the settings go once they are OPEN — and it is a different place.
 *
 * FURTHER AWAY, because a grid of boxes at arm's length fills your whole view
 * and cannot be read without turning your head across it. Nikk: "once the
 * settings are open, ahve them much further in front of the viewer."
 *
 * AND HIGHER, nearer eye level. The closed button sits at your waist so it is
 * out of the way; an open menu you are actually reading should not make you
 * look at the floor.
 */
const OPEN_AHEAD = 1.95;
const OPEN_HEIGHT = 1.42;

/** One button in the open grid. Wider and taller than the waist buttons. */
const BOX_BUTTON = { width: 0.56, height: 0.11, gap: 0.018 } as const;
/** How many buttons a box holds before it spills into another column. */
const BOX_ROWS = 7;
const BOX_GAP = 0.08;
/**
 * How many boxes stand side by side before the grid wraps onto another row.
 *
 * Three at this distance is about fifty degrees across — read with your eyes,
 * not by turning your head. Five was seventy-five, which is inside a headset's
 * field of view and still too wide to use comfortably.
 */
const BOXES_PER_ROW = 3;

/**
 * The closed controls: settings and talk, the same size, rounded like a phone's
 * icons, and a cancel beside talk while there is something to cancel.
 *
 * SAME SIZE. Nikk: "increase the size of the settings icon so it's the same size
 * as the record [button]... make them have kind of the rounded edges like on
 * the iPhone". The gear was a small square beside a wide bar, and it was the
 * one people missed. Both are now squares larger than the old bar was tall.
 *
 * THE PAIR STAYS PUT when cancel appears. Cancel is added to the RIGHT of talk
 * rather than re-centring the row, because a row that shifts the moment you
 * start recording moves the talk button out from under the ray that is about
 * to press it again to send.
 *
 * The gap is not cosmetic: two targets that touch edge to edge are two targets
 * a controller ray confuses.
 */
const ICON = 0.18;
const ICON_GAP = 0.04;
/** Centres of the gear, the talk button and cancel, left to right. */
const GEAR_X = -(ICON + ICON_GAP) / 2;
const TALK_X = (ICON + ICON_GAP) / 2;
const CANCEL_X = TALK_X + ICON + ICON_GAP;
/** The status line under them: wide enough for a short sentence on two lines. */
const STATUS = { width: 0.62, height: 0.13 } as const;

/** Good news goes by itself; a problem stays until it is tapped away. */
const NOTICE_FADE_MS = 5_000;

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
  agents,
  positionOf,
  onResetStanding,
  onNote,
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
  /** The agents in the room right now, for placing them. */
  agents: string[];
  /** Where somebody is standing, for reading them aloud as loud as they are near. */
  positionOf: (actorId: string) => { x: number; z: number } | null;
  /**
   * Measure the wearer's height again from where their head is now.
   *
   * Nikk asked for it as "reset head position": sit down, tap it, and the room
   * draws you sitting rather than as a standing person squatting.
   */
  onResetStanding: () => void;
  /**
   * Put one short line in the server log about something only the headset can
   * see. See the `note` frame in shared/space-wire.ts.
   */
  onNote: (note: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [open, setOpen] = useState(false);
  /**
   * Which list you are looking at.
   *
   * "root" is the grid of boxes. The two board choices open their own list
   * instead of putting every project and every mood board into the grid —
   * Nikk: "lets have when clicking mood board, all mood boards pop up and I
   * choose the one I want." It is also the honest shape: choosing a board is
   * one decision, and a decision that changes what everybody in the room is
   * looking at deserves its own screen rather than a row among twenty.
   */
  const [view, setView] = useState<"root" | "work" | "mood" | "panels" | "agents">("root");
  /**
   * Whether your own hands are drawn.
   *
   * ON, obviously, until somebody turns them off. Nikk records from inside the
   * headset and the rendered hands sit in front of whatever he is recording;
   * nothing else can move them out of shot, because they are drawn exactly
   * where his hands are.
   */
  const [handsShown, setHandsShown] = useState(() => handModelsShown());
  /** Off by default; the palm joystick is how hands move. See xr-store.ts. */
  const [pinchTeleport, setPinchTeleportShown] = useState(() => pinchTeleportEnabled());
  const preferences = useRoomPreferences();
  /** Whether a newer build is waiting for this session to end. */
  const [newVersion, setNewVersion] = useState(() => updateWaiting());
  useEffect(() => watchUpdate(setNewVersion), []);
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
  // No reload for a new deploy in the middle of a recording.
  useEffect(() => {
    holdReload("room-microphone", listening);
    return () => holdReload("room-microphone", false);
  }, [listening]);
  const [heard, setHeard] = useState("");
  /** Whether the headset's system keyboard is up right now. */
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  /** Words from the system keyboard, kept between keyboard sessions until sent. */
  const [written, setWritten] = useState("");
  // A written draft lives only in this component, not in any text box on the
  // page, so a deploy's reload would otherwise throw it away unseen.
  useEffect(() => {
    holdDraft("written-draft", written.trim() !== "");
    return () => holdDraft("written-draft", false);
  }, [written]);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A NOTICE THAT GOES BY ITSELF. Nikk: "after you send it has a message that
   * says sent into the group but that message never disappears... [it] should
   * just stay there for 5 seconds and then... disappear". Used for news that
   * needs no answer — sent, cancelled, an agent on its way. A failure still
   * uses `setNotice` and stays, because words that did not arrive must not be
   * reported and then quietly forgotten.
   */
  const noticeTimer = useRef<number | null>(null);
  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null;
      setNotice((current) => (current === message ? null : current));
    }, NOTICE_FADE_MS);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);
  const [sending, setSending] = useState(false);
  const input = useRef<SteadyRecorder | null>(null);
  const keyboard = useRef<SystemKeyboard | null>(null);
  /** The draft as of this render, for a tap handler that must not wait for one. */
  const writtenNow = useRef("");
  writtenNow.current = written;
  const session = useXR((state) => state.session);
  const confidence = useRef<number | undefined>(undefined);
  const capabilities = useMemo(() => speechCapabilities(), []);

  /**
   * WHAT THIS HEADSET CAN ACTUALLY DO WITH SPEECH, into the journal, once.
   *
   * Nikk: "we can do the same as we are doing on AURA, where you push a button
   * to begin speech to text". On the Aura that button works because that
   * browser has Web Speech recognition. Quest Browser is documented not to —
   * and was equally documented not to speak, right up until it did in version
   * 40.1. Meta's own advice is to feature-detect rather than infer from the
   * user agent.
   *
   * I cannot put the headset on. Rather than build a transcription service on a
   * guess about a browser I have never opened, the room reports what it found,
   * from the exact build on the exact device. If recognition turns out to be
   * there, the button Nikk is asking for already exists and there is nothing to
   * build; if it is not, the same line says whether a microphone and a recorder
   * are, which is what a fallback would need.
   *
   * Voices are asked for twice: Chromium hands back an empty list until
   * `voiceschanged`, so the first answer is routinely "0 voices" on a browser
   * that has plenty.
   */
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onNote(voiceReport());
    const synth = (globalThis as { speechSynthesis?: EventTarget }).speechSynthesis;
    if (!synth) return;
    const again = () => {
      onNote(`${voiceReport()} (after voiceschanged)`);
      synth.removeEventListener("voiceschanged", again);
    };
    synth.addEventListener("voiceschanged", again);
    return () => synth.removeEventListener("voiceschanged", again);
  }, [onNote]);

  /** How far away somebody is standing from this person's head, or null if unknown. */
  const distanceTo = (actorId: string): number | null => {
    const me = anchor();
    const them = positionOf(actorId);
    return me && them ? Math.hypot(me.at.x - them.x, me.at.z - them.z) : null;
  };

  // Read by the recognition callbacks, which are created once and would
  // otherwise close over the first value of everything they touch.
  const live = useRef({ alwaysOn, destination, groupRoom, you });
  live.current = { alwaysOn, destination, groupRoom, you };

  const post = useCallback(async (words: string, source: "voice" | "text" = "voice") => {
    const { destination: to, groupRoom: room, you: me } = live.current;
    const plan =
      source === "voice"
        ? planVoice(words, to, { confidence: confidence.current, speaker: me ?? undefined })
        : planText(words, to, { speaker: me ?? undefined });
    if (plan.refused) {
      setNotice(plan.refused);
      return false;
    }
    setSending(true);
    const failures: string[] = [];
    // STOP THE CHAT AT THE FIRST PART THAT FAILS. A long transcript is now
    // several messages in order, and carrying on past a failure would post
    // part three with part two missing — a gap in the middle of somebody's
    // sentence that nobody is told about.
    let chatStopped = false;
    for (const item of plan.posts) {
      if (item.to === "group-chat" && chatStopped) continue;
      try {
        if (item.to === "room") {
          // THE WRITTEN REMAINDER GOES TOO. `planVoice` splits anything too
          // long to say into a spoken opening and a written rest; dropping
          // `detail` here would lose the end of somebody's sentence while
          // telling them it was sent, which is the exact failure the split
          // exists to avoid. `say` is omitted when a single sentence was too
          // long to speak at all — better silent than misquoted.
          await space.say({
            ...(item.say ? { say: item.say } : {}),
            ...(item.detail ? { detail: item.detail } : {}),
            source,
            ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
          });
        } else if (!room) {
          failures.push("the group chat (no room)");
        } else {
          await bff.sendMessage(room, item.content);
        }
      } catch {
        if (item.to === "room") failures.push("the room");
        else {
          chatStopped = true;
          const parts = plan.posts.filter((post) => post.to === "group-chat");
          failures.push(
            parts.length > 1
              ? `the group chat (stopped at part ${parts.indexOf(item) + 1} of ${parts.length})`
              : "the group chat",
          );
        }
      }
    }
    setSending(false);
    // NAMED INDIVIDUALLY. Being told your words reached the agents when they
    // did not is the quiet failure this product exists not to have.
    if (failures.length === 0) {
      if (source === "voice") {
        setHeard("");
        confidence.current = undefined;
      }
      flash(to === "room" ? "Sent to the room." : "Sent to the room and the chat.");
      return true;
    } else {
      setNotice(`Did not reach ${failures.join(" or ")}. Your words are still here.`);
      return false;
    }
  }, [flash]);

  useEffect(() => {
    keyboard.current = createSystemKeyboard({
      onDraft: setWritten,
      onShown: (shown) => {
        setKeyboardFocused(shown);
        if (!shown) setNotice(null);
      },
    });
    return () => {
      keyboard.current?.dispose();
      keyboard.current = null;
    };
  }, []);

  /**
   * Open the system keyboard, INSIDE the tap that asked for it. See
   * system-keyboard.ts for why that matters and what the old version did.
   */
  /**
   * THE HEADSET HAS TO SAY YES, not merely fail to say no.
   *
   * Nikk: "every time we use a text box it causes to crash", and earlier, of
   * Inkstone's version, that it "kicks baiwei out" of the headset. Focusing a
   * text field is what opens the Quest's own keyboard — and on a browser that
   * cannot composite that keyboard into an immersive frame, focusing it ends
   * the session instead. The session states whether it can:
   * `isSystemKeyboardSupported`.
   *
   * This used to refuse only on an explicit `false`, and try anyway when the
   * answer was missing — which is exactly the browser that drops you out. Now
   * an unknown answer stops and offers to try, so being put out of the headset
   * is a thing somebody chose rather than a thing that happened to them.
   *
   * Both the attempt and an unknown answer are noted in the server log, since
   * the one place this can be seen is a headset and the person wearing it has
   * their hands full.
   */
  const [keyboardRisky, setKeyboardRisky] = useState(false);
  const openTextEntry = useCallback(
    (insist = false) => {
      const supported = (session as (XRSession & { isSystemKeyboardSupported?: boolean }) | null)
        ?.isSystemKeyboardSupported;
      if (supported === false) {
        setNotice("This headset's browser cannot show a keyboard inside the room.");
        onNote("keyboard refused: the session says it cannot show one");
        return;
      }
      if (supported !== true && !insist) {
        setKeyboardRisky(true);
        setNotice("This headset has not said whether it can show a keyboard in the room. Opening one may put you out of it — settings ⚙ to try anyway.");
        onNote("keyboard held back: isSystemKeyboardSupported is undefined");
        return;
      }
      setNotice(null);
      onNote(`keyboard opening: isSystemKeyboardSupported=${String(supported)}${insist ? " (asked for anyway)" : ""}`);
      keyboard.current?.open(writtenNow.current);
    },
    [session, onNote],
  );

  const sendWritten = useCallback(async () => {
    const delivered = await post(written, "text");
    if (!delivered) return;
    setWritten("");
  }, [post, written]);

  /**
   * PRESS TO SPEAK, on a browser that cannot listen.
   *
   * Nikk, in a Quest: "we can do the same as we are doing on AURA, where you
   * push a button to begin speech to text... lets try to get a way to SPEAK to
   * agents, that is pretty key". The Aura's browser has Web Speech recognition;
   * this one does not. So the same button records, and the server writes it
   * down — see say-recorder.ts and server/space/transcribe.ts.
   *
   * THE WORDS LAND IN THE SAME REVIEW DRAFT the keyboard fills, and somebody
   * still presses send. A transcript is a guess, and a guess published under
   * your name in the group chat is not something to do automatically. That rule
   * predates this path and survives it.
   */
  const [saying, setSaying] = useState<"idle" | "recording" | "writing">("idle");
  /**
   * Only once the server says it has something to transcribe with. Until then
   * the button keeps opening the keyboard, because a recorder that can only
   * apologise is worse than a keyboard that works. Asked, not assumed.
   */
  const [canSpeak, setCanSpeak] = useState(false);
  /**
   * ASKED ONCE. It was asked on every change of `onNote` — which is rebuilt
   * whenever the room's socket reconnects — and baiwei's journal filled with
   * "press to speak: the server can write speech down" a dozen times over.
   * `tell` is stable now, which fixes the cause; this ref means a future
   * unstable callback cannot bring the flood back.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (capabilities.recognition || asked.current) return;
    asked.current = true;
    let cancelled = false;
    void canTranscribe().then((available) => {
      if (cancelled) return;
      setCanSpeak(available);
      onNote(`press to speak: the server ${available ? "can" : "cannot"} write speech down`);
    });
    return () => {
      cancelled = true;
    };
  }, [capabilities.recognition, onNote]);
  const sayer = useRef<SayRecorder | null>(null);
  useEffect(() => () => sayer.current?.dispose(), []);
  const say = useCallback(() => {
    sayer.current ??= createSayRecorder({
      onPhase: setSaying,
      onTrouble: (message) => setNotice(message),
    });
    return sayer.current;
  }, []);
  const startSaying = useCallback(async () => {
    setNotice(null);
    try {
      await say().start();
      onNote("recording to be written down by the server");
    } catch (error) {
      setSaying("idle");
      const message = error instanceof Error ? error.message : "The microphone could not be opened.";
      setNotice(message);
      onNote(`recording refused: ${message}`);
    }
  }, [say, onNote]);
  const finishSaying = useCallback(async () => {
    const words = await say().finish();
    if (!words) {
      onNote("nothing was heard, so nothing was written down");
      return;
    }
    onNote(`written down: ${words.split(/\s+/).length} words`);
    // Added to whatever is already drafted, exactly as the keyboard does, so
    // speaking twice before sending does not throw the first half away.
    setWritten((kept) => mergeKeyboardEdit(kept, words));
  }, [say, onNote]);

  useEffect(() => {
    if (!capabilities.recognition) return;
    /**
     * A STEADY RECORDER: it keeps recording until the mic is pressed again.
     *
     * Recognition used to end at the first pause and nothing started it again.
     * Nikk: "once my volume goes low the recording stops... after they push
     * the button it stays on audio transcribe and if it auto disconnects just
     * have it reconnect immediately until they actually tap the button again."
     * See createSteadyRecorder: runs the browser ends are restarted at once,
     * and every phrase is kept rather than each one replacing the last.
     */
    input.current = createSteadyRecorder({
      onRecording: setListening,
      // What recording looks like is drawn from `listening` and `heard` — see
      // the status line — rather than written into the notice, where it stayed
      // behind after the recording it described had ended.
      onText: setHeard,
      onPhrase: (phrase) => {
        if (!live.current.alwaysOn) return;
        // ALWAYS-ON posts each finished phrase as it lands and keeps recording,
        // so a conversation needs no tap between sentences.
        confidence.current = phrase.confidence;
        if (phrase.text) void post(phrase.text);
        input.current?.clear();
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
      // In the writer's own voice, as loud as they are near. See agent-voice.ts.
      speaker: reply.speaker,
      volume: volumeAt(distanceTo(reply.speaker)),
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
      speaker: liveUtterance.actorId,
      volume: volumeAt(distanceTo(liveUtterance.actorId)),
      onPhase: () => {},
      onFailure: (failure) => setNotice(failure.message),
    });
  }, [liveUtterance, hearReplies, listening, you]);

  // Nothing keeps talking after the panel goes away.
  useEffect(() => () => speaking.current?.cancel(), []);

  const facing = useRef<number | null>(null);

  /**
   * WHERE THE OPEN MENU IS PINNED.
   *
   * Null while it is closed. Set once, at the moment it opens, to the place in
   * the ROOM it should hang — and then never touched again until it closes.
   *
   * WHY IT STOPS FOLLOWING. The closed button follows you because it is a
   * thing you reach for; an open menu is a thing you walk up to and read, and
   * one that keeps repositioning itself while you point at it is a menu you
   * chase. Nikk: "also have them stop moving, so if you open settings they stay
   * open." It also means you can step back to see the whole grid, or lean in
   * to press one button, which you cannot do with something welded to you.
   */
  const pinned = useRef<{ x: number; z: number; yaw: number } | null>(null);

  const openMenu = useCallback(() => {
    const body = anchor();
    if (body) {
      // Pinned out in front of where you were STANDING when you opened it,
      // using the panel's own lagged facing rather than your head's, so it
      // does not appear off to one side if you happened to be glancing away.
      const yaw = facing.current ?? body.yaw;
      pinned.current = {
        x: body.at.x - Math.sin(yaw) * OPEN_AHEAD,
        z: body.at.z - Math.cos(yaw) * OPEN_AHEAD,
        yaw,
      };
    }
    setOpen(true);
  }, [anchor]);

  const closeMenu = useCallback(() => {
    pinned.current = null;
    setView("root");
    setOpen(false);
  }, []);

  /**
   * The panel follows you while CLOSED, driven per frame rather than through
   * React: a head moves at headset frame rate and routing that through state
   * would re-render this tree ninety times a second to move one group.
   *
   * It follows your POSITION immediately and your DIRECTION lazily, and only
   * once you have turned past a few tens of degrees. Turning your head to look
   * at something must not drag the menu across your view — you would never be
   * able to look away from it — but walking away from it and leaving it behind
   * would be worse.
   *
   * OPEN, it does none of that: it sits where it was pinned. See `pinned`.
   */
  useFrame(() => {
    const node = group.current;
    const body = anchor();
    if (!node) return;
    node.visible = body !== null;
    if (!body) return;

    const held = pinned.current;
    if (held) {
      node.position.set(held.x, OPEN_HEIGHT, held.z);
      node.rotation.set(0, held.yaw, 0);
      return;
    }

    if (facing.current === null) facing.current = body.yaw;
    // Shortest way round, so turning past a half-circle does not send the panel
    // the long way about.
    let delta = body.yaw - facing.current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > SLACK) facing.current += delta * EASE;

    const yaw = facing.current;
    const { position, rotation } = closedControlPose(body.at, yaw);
    node.position.set(position[0], position[1], position[2]);
    /**
     * YXZ, NOT THE DEFAULT XYZ, and the pose carries a pitch now.
     *
     * XYZ pitches about the WORLD x axis before applying the yaw, so the tilt
     * would lean the panel sideways for anyone not facing down -Z — and tip it
     * backwards entirely for anyone facing the other way. YXZ turns the panel
     * to face the wearer first and then tips that face up, which is what the
     * request means at every yaw rather than at one of them.
     */
    node.rotation.order = "YXZ";
    node.rotation.set(rotation[0], rotation[1], rotation[2]);
  });

  type Row = { label: string; tone?: "normal" | "muted" | "live"; onTap: () => void };
  type Box = { title: string; rows: Row[] };

  const boxes: Box[] = [];

  if (open && view === "work") {
    /**
     * EVERY WORK BOARD, as its own screen.
     *
     * One project per row rather than a cycle, because cycling would drag the
     * whole room through every other project on the way to the one you want —
     * every step of it a change everybody standing here can see.
     */
    const rows: Row[] = [{ label: "← Back", onTap: () => setView("root") }];
    if (showingChoices.projects === null) {
      rows.push({ label: "Projects could not be read", tone: "muted", onTap: () => {} });
    } else if (showingChoices.projects.length === 0) {
      rows.push({ label: "There are no projects yet", tone: "muted", onTap: () => {} });
    } else {
      rows.push({
        label: `${showing.projectId === null ? "✓" : "·"} Show nothing`,
        tone: showing.projectId === null ? "live" : "normal",
        onTap: () => showingChoices.choose({ projectId: null, boardId: null }),
      });
      for (const project of showingChoices.projects) {
        const on = showing.projectId === project.id;
        rows.push({
          label: `${on ? "✓" : "·"} ${project.name}`,
          tone: on ? "live" : "normal",
          onTap: () => {
            showingChoices.choose({ projectId: project.id, boardId: null });
            setView("root");
          },
        });
      }
    }
    boxes.push({ title: "Work board — for everyone", rows });
  } else if (open && view === "mood") {
    const rows: Row[] = [{ label: "← Back", onTap: () => setView("root") }];
    if (!showing.projectId) {
      // The server refuses a mood board with no project, and offering a list
      // here would be inviting that refusal.
      rows.push({ label: "Choose a work board first", tone: "muted", onTap: () => {} });
    } else if (showingChoices.boards === null) {
      rows.push({ label: "Mood boards could not be read", tone: "muted", onTap: () => {} });
    } else if (showingChoices.boards.length === 0) {
      rows.push({ label: "This project has no mood boards", tone: "muted", onTap: () => {} });
    } else {
      rows.push({
        label: `${showing.boardId === null ? "✓" : "·"} Show none`,
        tone: showing.boardId === null ? "live" : "normal",
        onTap: () => showingChoices.choose({ projectId: showing.projectId, boardId: null }),
      });
      for (const moodBoard of showingChoices.boards) {
        const on = showing.boardId === moodBoard.id;
        rows.push({
          label: `${on ? "✓" : "·"} ${moodBoard.title}`,
          tone: on ? "live" : "normal",
          onTap: () => {
            showingChoices.choose({ projectId: showing.projectId, boardId: moodBoard.id });
            setView("root");
          },
        });
      }
    }
    boxes.push({ title: "Mood board — for everyone", rows });
  } else if (open && view === "panels") {
    const panelRows: Row[] = [{ label: "← Back", onTap: () => setView("root") }];
    for (const panel of panels.catalogue) {
      const shown = panels.open.includes(panel.id);
      panelRows.push({
        label: `${shown ? "✓" : "·"} ${panel.label}`,
        tone: shown ? "live" : "muted",
        onTap: () => panels.setOpen(panel.id, !shown),
      });
      if (!shown) continue;
      const mode = arrange.modeOf(panel.id);
      panelRows.push({
        label:
          mode === "locked"
            ? `   ${panel.label}: fixed`
            : mode === "move"
              ? `   ${panel.label}: drag to move`
              : `   ${panel.label}: drag to resize`,
        tone: mode === "locked" ? "muted" : "live",
        onTap: () => arrange.cycle(panel.id),
      });
    }
    if (arrange.anyUnlocked) {
      panelRows.push({ label: "Fix every panel in place", onTap: () => arrange.lockAll() });
    }
    if (panels.refusal) {
      panelRows.push({ label: panels.refusal, tone: "muted", onTap: () => {} });
    }
    boxes.push({ title: "Panels", rows: panelRows });
  } else if (open && view === "agents") {
    /**
     * WHERE AGENTS LIVE, set from where you stand.
     *
     * Nikk: "I want you to be standing over here facing me or I want you to be
     * standing beside me facing away from me so I can watch your work". Each
     * choice is worked out from your own position and heading at the moment you
     * tap, saved on the server as that agent's home, and the agent walks there.
     */
    const rows: Row[] = [{ label: "← Back", onTap: () => setView("root") }];
    if (agents.length === 0) rows.push({ label: "No agents in the room", tone: "muted", onTap: () => {} });
    const placeWith = (agent: string, choose: (me: { at: { x: number; z: number }; facing: number }) => AgentHome, done: string) => () => {
      const me = anchor();
      if (!me) {
        setNotice("Cannot tell where you are standing yet.");
        return;
      }
      space
        .placeAgent(agent, choose({ at: me.at, facing: me.yaw }))
        .then(() => flash(`${agent} ${done}`))
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `Could not move ${agent}.`));
    };
    for (const agent of agents) {
      rows.push(
        { label: `${agent}: here, facing me`, onTap: placeWith(agent, homeFacingMe, "is coming to stand in front of you.") },
        { label: `${agent}: beside me, so I can watch`, onTap: placeWith(agent, homeBesideMe, "is coming to work beside you.") },
        {
          label: `${agent}: back to its desk`,
          tone: "muted",
          onTap: () => {
            space
              .clearAgentHome(agent)
              .then(() => flash(`${agent} is going back to its desk.`))
              .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `Could not move ${agent}.`));
          },
        },
      );
    }
    boxes.push({ title: "Where agents live", rows });
  } else if (open && view === "root") {
    boxes.push({
      title: "Talking",
      rows: [
        {
          label: voice.on
            ? voice.others.length > 0
              ? `Mic open — talking with ${voice.others.join(", ")}`
              : "Mic open — tap to close"
            : "Talk out loud",
          tone: voice.on ? "live" : "normal",
          onTap: () => voice.setOn(!voice.on),
        },
        // Mute anyone, for yourself. Nobody else's hearing changes.
        ...voice.others.map((name) => {
          const isMuted = voice.muted.has(name.trim().toLowerCase());
          return {
            label: isMuted ? `${name}: muted — tap to hear` : `Mute ${name}`,
            tone: isMuted ? ("muted" as const) : ("normal" as const),
            onTap: () => voice.setMuted(name, !isMuted),
          };
        }),
        capabilities.recognition
          ? {
              // "Speak once" stopped being true: a recording now runs until it
              // is stopped, through any pauses.
              label: listening ? "Stop recording" : alwaysOn ? "Start talking" : "Start recording",
              tone: listening ? "live" : "normal",
              onTap: () => {
                if (!listening) {
                  input.current?.start();
                  return;
                }
                /**
                 * Stopping from the menu KEEPS the words for the mic to send,
                 * rather than sending from inside a menu or throwing them away.
                 * In always-on mode the last unsent words are posted, the same
                 * as every phrase before them was.
                 */
                void (async () => {
                  const result = await input.current?.finish();
                  const text = result?.text.trim() ?? "";
                  if (!text) return;
                  if (result?.confidence !== undefined) confidence.current = result.confidence;
                  if (live.current.alwaysOn) void post(text);
                  else {
                    setHeard(text);
                  }
                })();
              },
            }
          : {
              label: written.trim() ? "Add to what you wrote" : "Type or dictate with the system keyboard",
              // Called with no argument on purpose: a tap is not insisting.
              onTap: () => openTextEntry(),
            },
        ...(written.trim()
          ? [
              { label: "Send what you wrote", tone: "live" as const, onTap: () => void sendWritten() },
              { label: "Throw away what you wrote", tone: "muted" as const, onTap: () => setWritten("") },
            ]
          : []),
        {
          label: alwaysOn ? "Sending as you speak" : "Review each one before sending",
          tone: alwaysOn ? "live" : "normal",
          onTap: () => setAlwaysOn((on) => !on),
        },
        {
          label: destination === "room" ? "To: the room only" : "To: the room and the agents",
          onTap: () => setDestination((d) => (d === "room" ? "room-and-agents" : "room")),
        },
        {
          label: hearReplies ? "Replies read aloud" : "Replies stay silent",
          tone: hearReplies ? "live" : "normal",
          onTap: () => setHearReplies((on) => !on),
        },
        ...(alwaysOn
          ? []
          : [
              {
                label: sending ? "Sending…" : heard ? `Send: ${heard}` : "Nothing heard yet",
                tone: (!heard || sending ? "muted" : "normal") as Row["tone"],
                onTap: () => void post(heard),
              },
            ]),
      ],
    });

    /**
     * WHAT THE ROOM IS SHOWING — two rows, each opening its own list.
     *
     * Every row in this box changes what other people are looking at, so it
     * says "for everyone" and names who set it last. A wall that is showing
     * something else should be answerable without asking around.
     */
    const projectName =
      showingChoices.projects?.find((project) => project.id === showing.projectId)?.name ?? null;
    const boardName =
      showingChoices.boards?.find((moodBoard) => moodBoard.id === showing.boardId)?.title ?? null;
    boxes.push({
      title: "The room shows — for everyone",
      rows: [
        {
          label: `Work board: ${projectName ?? (showing.projectId ? showing.projectId : "none")}`,
          tone: showing.projectId ? "live" : "normal",
          onTap: () => setView("work"),
        },
        {
          label: `Mood board: ${boardName ?? (showing.boardId ? showing.boardId : "none")}`,
          tone: showing.boardId ? "live" : "normal",
          onTap: () => setView("mood"),
        },
        ...(showingChoices.refusal
          ? [{ label: showingChoices.refusal, tone: "muted" as const, onTap: () => {} }]
          : showing.setBy
            ? [{ label: `Set by ${showing.setBy}`, tone: "muted" as const, onTap: () => {} }]
            : []),
      ],
    });

    boxes.push({
      title: "Room",
      rows: [
        { label: "Panels…", onTap: () => setView("panels") },
        { label: "Place agents…", onTap: () => setView("agents") },
        {
          label: handsShown ? "Hand models: shown" : "Hand models: hidden",
          tone: handsShown ? "normal" : "live",
          onTap: () => {
            const next = !handsShown;
            setHandsShown(next);
            showHandModels(next);
          },
        },
        // A NEW VERSION, OFFERED RATHER THAN FORCED. The room never reloads a
        // live session — but a session that lasts an hour then never receives
        // a fix, which is exactly how Nikk spent an afternoon reporting a bug
        // that had been fixed for ninety minutes. See update-reload.ts.
        ...(newVersion
          ? [{
              label: "Load the new version — leaves the headset",
              tone: "live" as const,
              onTap: () => reloadNow(),
            }]
          : []),
        ...(keyboardRisky
          ? [{
              label: "Open the keyboard anyway — may exit the headset",
              tone: "muted" as const,
              onTap: () => {
                setKeyboardRisky(false);
                openTextEntry(true);
              },
            }]
          : []),
        {
          label: "Reset head position",
          onTap: () => {
            onResetStanding();
            flash("Measuring your height from where your head is now.");
          },
        },
        {
          label: preferences.rings ? "Rings under people: shown" : "Rings under people: hidden",
          tone: preferences.rings ? "live" : "normal",
          onTap: () => setRoomPreferences({ rings: !preferences.rings }),
        },
        // THE POINTER, as a value and a − and a +. Tapping the value turns the
        // pointer off, or back on at its default — the "option to remove" — and −/+
        // walk it between 0% and 100% of the brightness it used to have.
        {
          label: `Pointer brightness: ${pointerLabel(preferences.pointer)}`,
          tone: preferences.pointer > 0 ? "normal" : "muted",
          onTap: () => setRoomPreferences({ pointer: preferences.pointer > 0 ? 0 : DEFAULT_ROOM_PREFERENCES.pointer }),
        },
        { label: "−  Pointer dimmer", onTap: () => setRoomPreferences({ pointer: stepPointer(preferences.pointer, -1) }) },
        { label: "+  Pointer brighter", onTap: () => setRoomPreferences({ pointer: stepPointer(preferences.pointer, 1) }) },
        {
          label: pinchTeleport ? "Teleport (hand pinch, controller trigger): on" : "Teleport: off — hands and sticks move you",
          tone: pinchTeleport ? "live" : "normal",
          onTap: () => {
            const next = !pinchTeleport;
            setPinchTeleportShown(next);
            setPinchTeleport(next);
          },
        },
        {
          label: !passthroughAvailable
            ? `No passthrough — this headset says: ${blendMode ?? "nothing yet"}`
            : passthrough
              ? "Passthrough — tap for void"
              : "Black void — tap for passthrough",
          tone: passthroughAvailable ? "normal" : "muted",
          onTap: () => passthroughAvailable && onTogglePassthrough(),
        },
        { label: "Close settings", onTap: closeMenu },
      ],
    });
  }

  /**
   * EVERY SCREEN IS NAMED, and none of them is a catch-all.
   *
   * This chain used to end in `else if (open)`, which silently swallowed every
   * view that came after it — so tapping "Panels…" set the view and then
   * rendered the root menu anyway. From inside a headset that looks exactly
   * like a button that does nothing, and it is what took the panel settings
   * away: "the settings for allowing panel movement and scaling are gone, as
   * are the settings to show or hide rooms."
   *
   * With every branch named, a screen nobody wrote shows this instead of
   * quietly showing the wrong one. An obviously empty menu is a better failure
   * than a menu that looks fine and is lying about which screen you are on.
   */
  if (open && boxes.length === 0) {
    boxes.push({
      title: "Nothing here",
      rows: [{ label: `No screen for "${view}" — back`, onTap: () => setView("root") }],
    });
  }

  // Boxes become columns, and a box taller than `BOX_ROWS` continues into
  // another column beside it rather than growing down past the floor — which
  // is what made the single column unusable. See menu-columns.ts.
  const columns = toColumns(boxes, BOX_ROWS);

  const columnWidth = BOX_BUTTON.width;
  const tallest = columns.reduce((most, column) => Math.max(most, column.rows.length), 0);
  const boxHeight = tallest * (BOX_BUTTON.height + BOX_BUTTON.gap);
  const slots = gridSlots(columns.length, BOXES_PER_ROW);
  // Every row of boxes is the height of the TALLEST column, so the headings
  // line up across a row instead of stepping down raggedly.
  const rowStep = boxHeight + 0.22;
  const rowCount = slots.length > 0 ? slots[slots.length - 1].row + 1 : 0;
  // Centred vertically too, so a two-row grid does not sit with its first row
  // at eye level and its second somewhere near your shins.
  // Centred on the CONTENT, not on the box origins: a box hangs downward from
  // its origin, so centring the origins would put the whole grid half a box too
  // low — which at two rows is the difference between reading it and crouching.
  const gridTop = ((rowCount - 1) * rowStep) / 2 + boxHeight / 2;

  /**
   * THE WRITTEN DRAFT IS SHOWN IN THE ROOM, on the line under the controls.
   * The keyboard's own text box is invisible and the old HTML card cannot be
   * seen in a headset, so this is the only place to read back what the Quest
   * keyboard took down before sending it.
   */
  const draftPreview = written.trim()
    ? `✎ ${written.length > 90 ? `…${written.slice(-89)}` : written}`
    : null;
  /**
   * WHAT IS HAPPENING WITH YOUR WORDS, in one short, plain status line.
   *
   * Nikk: the text under the record button "is garbled... it's just really ugly
   * text and it also overlaps itself". It was a whole instruction, "Recording —
   * press the mic again to send.", squeezed onto two lines of outlined text
   * that ran into each other, and it stayed after the recording ended because
   * it was a notice rather than a description of now. It is now worked out from
   * the recorder's own state every render: short, and gone when it stops being
   * true. A notice about something that happened still takes precedence.
   */
  const heardWaiting = capabilities.recognition && !alwaysOn && !listening && heard.trim() !== "";
  const recordingStatus = listening
    ? alwaysOn
      ? "● Listening — sending as you speak"
      : "● Recording\n◼ sends   ✕ cancels"
    : saying === "recording"
      ? "● Recording\n◼ writes it down   ✕ cancels"
      : saying === "writing"
        ? "Writing down what you said…"
        : heardWaiting
          ? "Ready to send\n▲ sends   ✕ throws away"
          : null;
  const said =
    notice ??
    recordingStatus ??
    voice.trouble ??
    (keyboardFocused ? null : draftPreview) ??
    (newVersion ? "A new version is ready — settings ⚙ to load it" : null);
  /** Something a cancel button can throw away: a recording, words waiting, or a written draft. */
  const cancellable =
    !sending &&
    saying !== "writing" &&
    (listening ||
      heardWaiting ||
      saying === "recording" ||
      (!capabilities.recognition && written.trim() !== "" && !keyboardFocused));
  const cancel = () => {
    if (capabilities.recognition) {
      input.current?.cancel();
      setHeard("");
      confidence.current = undefined;
    } else if (saying === "recording") {
      // The recording goes no further: not to the server, not to the draft.
      // Nothing of it is kept, which is the promise a cancel button makes.
      sayer.current?.cancel();
    } else {
      setWritten("");
    }
    flash("Cancelled — nothing was sent.");
  };

  return (
    <>
      <group ref={group} visible={false}>
      {open ? (
        columns.map((column, index) => (
          <ButtonBox
            key={`${index}-${column.title}`}
            title={column.title}
            x={columnX(slots[index].col, slots[index].inRow, columnWidth, BOX_GAP)}
            y={gridTop - slots[index].row * rowStep}
            width={columnWidth}
            height={boxHeight}
          >
            {column.rows.map((row, at) => (
              <WristButton
                key={`${at}-${row.label}`}
                label={row.label}
                tone={row.tone}
                y={-at * (BOX_BUTTON.height + BOX_BUTTON.gap)}
                width={BOX_BUTTON.width}
                height={BOX_BUTTON.height}
                onTap={row.onTap}
              />
            ))}
          </ButtonBox>
        ))
      ) : (
        <>
          {/*
            CLOSED: A GEAR AND A MICROPHONE, SIDE BY SIDE.

            Talking used to live inside the settings, which meant three taps and
            a menu between you and saying something — in a room whose whole
            purpose is talking to the people and agents in it. Nikk: "beside it
            add in the start talking button that is usualy inside the settings,
            that way we can start talking easily."

            The talk button is the wider of the two because it is the one you
            press constantly and the one you must be able to hit without aiming.
          */}
          <WristButton
            label="⚙"
            glyph
            // The pair is centred on you, with a real gap between them. They
            // used to touch exactly, edge to edge, which on a control you aim
            // at from across a room with a ray is a mis-tap waiting to happen —
            // and the mis-tap would be "opened the settings" when you meant
            // "start talking", or worse, the reverse while you were mid-sentence.
            x={GEAR_X}
            y={0}
            width={ICON}
            height={ICON}
            tone={listening ? "muted" : "normal"}
            onTap={openMenu}
          />
          {/*
            * ONE BUTTON, TWO PRESSES: press to talk, press again to send.
            *
            * WHAT WAS WRONG. Recognition ends itself after each utterance, and
            * the default mode then set a notice reading "Tap Send, or speak
            * again" — while the only Send control lived INSIDE the settings
            * menu. So from a headset the microphone looked broken: you pressed
            * it, you spoke, and nothing was ever sent, because sending meant
            * opening a menu and finding a row in it. Nikk: "the audio sending
            * to room and space doesn't work... I just click once on the mic
            * button, and then click another time and it sends."
            *
            * So the second press sends. It also sends when recognition has
            * already stopped on its own and words are waiting, which is the
            * common case — the button is "deal with what I said" rather than
            * strictly a toggle. `alwaysOn` still posts each sentence as it
            * lands and needs no second press; there the button just stops.
            *
            * A MIC RATHER THAN A SENTENCE, also asked for. The label was a
            * whole phrase, which on a control you glance at is worse than a
            * symbol — and the symbol is only legible now because label
            * textures take the shape of their plane. Its accessible name is
            * still carried by the notice line, which says what happened in
            * words.
            */}
          <WristButton
            label={
              capabilities.recognition
                ? micGlyph({ sending, listening, heard, alwaysOn })
                : sending || saying === "writing"
                  ? "…"
                  : saying === "recording"
                    ? "◼"
                    : written.trim() && !keyboardFocused
                      ? "▲"
                      : canSpeak
                        ? "🎤"
                        : "⌨"
            }
            glyph
            x={TALK_X}
            y={0}
            width={ICON}
            height={ICON}
            tone={listening || saying === "recording" ? "live" : "normal"}
            onTap={() => {
              /**
               * WITHOUT WEB SPEECH, THE BUTTON STILL SPEAKS. It records, and
               * the server writes it down — which is what Nikk asked for: the
               * Aura's press-to-talk, on a Quest. Press, speak, press again.
               *
               * It used to open the keyboard here. The keyboard is still on the
               * settings menu, and its own microphone is still the best voice
               * on the device — but it is not reachable while focusing a text
               * field throws people out of the room, and speaking should not
               * wait on that being solved.
               */
              if (!capabilities.recognition) {
                if (saying === "writing") return;
                if (saying === "recording") void finishSaying();
                else if (written.trim() && !keyboardFocused) void sendWritten();
                else if (canSpeak) void startSaying();
                else openTextEntry();
                return;
              }
              // THE DECISION LIVES IN `mic-press.ts`, not here. It is the part
              // that was wrong, and a handler in a component this suite cannot
              // render is a handler nobody can check.
              switch (micPress({
                available: capabilities.recognition,
                listening,
                sending,
                heard,
                alwaysOn,
              })) {
                case "refuse":
                  setNotice("There is no microphone available to this browser.");
                  return;
                case "start":
                  setNotice(null);
                  input.current?.start();
                  return;
                case "stop":
                case "stopAndSend":
                  /**
                   * WAIT FOR THE LAST WORDS, then send. This used to call
                   * stop() and post straight away, before the final result of
                   * the phrase in progress had arrived — so the end of a
                   * message could be missing. `finish()` resolves only once
                   * the recogniser has really ended.
                   */
                  void (async () => {
                    const result = await input.current?.finish();
                    const text = result?.text.trim() ?? "";
                    if (!text) {
                      flash("Nothing was heard, so nothing was sent.");
                      return;
                    }
                    if (result?.confidence !== undefined) confidence.current = result.confidence;
                    void post(text);
                  })();
                  return;
                case "send":
                  void post(heard);
                  return;
                case "ignore":
                  return;
              }
            }}
          />
          {/* CANCEL, to the right of talk, only while there is something to
              throw away. Nikk: "add a button to cancel recording so if you've
              begun recording but you want to cancel what you've just recorded,
              have a button that appears to the right of the record button". */}
          {cancellable ? (
            <WristButton label="✕" glyph x={CANCEL_X} y={0} width={ICON} height={ICON} tone="danger" onTap={cancel} />
          ) : null}
        </>
      )}

      {/* BELOW EVERYTHING, deliberately outside the grid. A notice arrives
          unbidden — a failed send, a microphone that would not open — and if it
          joined a column it would jog every button in it at the exact moment
          you were reaching for one. */}
      {said ? (
        <WristButton
          label={said}
          tone={!notice && listening ? "live" : "muted"}
          y={open ? -gridTop - (rowCount - 1) * rowStep - boxHeight - 0.18 : -ICON / 2 - 0.035 - STATUS.height / 2}
          width={open ? 0.9 : STATUS.width}
          height={open ? WRIST_BUTTON.height : STATUS.height}
          onTap={() => {
            // Tapping the draft adds to it; tapping a notice dismisses it. The
            // recording status is not a notice and a tap does nothing to it.
            if (notice || voice.trouble) setNotice(null);
            else if (draftPreview && !recordingStatus) openTextEntry();
          }}
        />
      ) : null}
      </group>
    </>
  );
}
