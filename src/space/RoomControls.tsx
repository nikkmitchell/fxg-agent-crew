import type { Meditation } from "../../shared/meditation";
import { agentsHiddenIn, setAgentsHidden, setAgentsHiddenForEveryone, setCurrentRoomForAgents, useAgentsHidden, useAgentsHiddenForEveryone } from "./agents-hidden";
import { holdAloud } from "./said-aloud";
import { sendKey } from "../call-socket";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { bff } from "../bff-client";
import { space } from "../space-client";
import { WRIST_BUTTON, WristButton } from "./Backdrop";
import { SETTINGS_TABS, settingsBadge, settingsSections, tabOfView, type SettingsView } from "./settings-menu-model";
import { SettingsMenu3D } from "./SettingsMenu3D";
import { MENU, menuHeight } from "./menu-layout";
import { rememberSelfMute } from "./voice-default";
import {
  closedButtons,
  handNear,
  IDLE_OPACITY,
  isDuplicateActivation,
  touchPresses,
  type TouchButton,
} from "./touch-press";
import { goHandInput } from "./go-hand-input";
import { micGlyph, micPress } from "./mic-press";
import { statusLineActionable } from "./touch-press";
import { controllerFaceButtons, controllerMicAction, readTouchMicSetting, writeTouchMicSetting } from "./controller-mic";
import { IDLE_MIC_GESTURE, describeStart, stepMicGesture, type MicGestureState } from "./mic-gesture";
import { controllersInUse, micGestureHands, micGestureIndicator } from "./mic-gesture-input";
import {
  closedControlPose,
  lookingUp,
  UP_CONTROL_SIZE,
  upGearAt,
  walkedAway,
} from "./control-pose";
import { handModelsShown, pinchTeleportEnabled, setPinchTeleport, showHandModels } from "./xr-store";
import {
  DEFAULT_ROOM_PREFERENCES,
  pointerLabel,
  setRoomPreferences,
  stepPointer,
  useRoomPreferences,
} from "./room-preferences";
import { createSteadyRecorder, speechCapabilities, type SpeechOutput, type SteadyRecorder } from "./speech";
import { queueAloud } from "./said-aloud";
import { shouldSpeakUtterance } from "./VoiceControls";
import { newestId } from "./reply-speech";
import type { RoomFeed } from "./useRoomFeed";
import type { PanelChoices } from "./usePanelChoices";
import type { PanelArrange } from "./usePanelArrange";
import type { Showing } from "../../shared/space-wire";
import type { RoomShowingChoices } from "./useRoomShowing";
import { roomMenuRows } from "../../shared/room-switch";
import type { RoomSummary } from "../../shared/contracts";
import { CHAT_MESSAGE_LIMIT, type Utterance } from "../../shared/voice";
import { planText, planVoice, type VoiceDestination } from "../../shared/voice-routing";
import type { VoiceChat } from "./useVoiceChat";
import { holdDraft, holdReload, reloadNow, updateWaiting, watchUpdate } from "../update-reload";
import { createSystemKeyboard, mergeKeyboardEdit, type SystemKeyboard } from "./system-keyboard";
import { canTranscribe, createSayRecorder, type SayRecorder } from "./say-recorder";
import { microphoneState } from "./mic-permission";
import { voiceReport } from "./voice-report";
import { volumeAt } from "./agent-voice";
import { homeBesideMe, homeFacingMe, type AgentHome } from "../../shared/agent-home";
import type { RoomItem } from "../../shared/room-items";
import { Typing3D } from "./Typing3D";
import { endSessionThenReturn } from "./end-session-to-lobby";
import { sendOutcome, withDeadline } from "./send-timeout";
import { recordedControl, recorderControlVisual } from "./recorder-control-visual";
import type { AvatarRecorder } from "./useAvatarRecorder";

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

/**
 * Where fixing what you said happens: BETWEEN the two. Baiwei, in a headset,
 * at the waist-level controls' distance: "size ok but too close"; at the open
 * menu's: "a little bit too far. Also, when I move, it doesn't follow me." So a
 * middle distance at eye height, and it FOLLOWS, the way the closed controls do
 * — a panel you type on is held with you, not a menu you walk up to and read.
 */
const FIX_AHEAD = 1.2;
const FIX_HEIGHT = 1.38;

/**
 * THE OPEN MENU is one drawn panel now: sizes, colours and layout live in
 * menu-layout.ts and menu-paint.ts, and what each tab shows in
 * settings-menu-model.ts (Nikk, 5426, 5439, 5445).
 */

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
/**
 * HALF THE SIZE THEY WERE (0.18). Nikk (4739): "make them 50% smaller". They
 * are pressed by reaching out and touching now, not aimed at from across the
 * room, so a small target at arm's length is enough.
 */
const ICON = 0.09;
const ICON_GAP = 0.02;
/** Talk in the middle now the gear has gone up (Nikk, 5245); cancel to its right. */
const TALK_X = 0;
const CANCEL_X = TALK_X + ICON + ICON_GAP;
/** The look-up gear and separate room-call control share one tested size. */
const UP_GEAR_SIZE = UP_CONTROL_SIZE;
/** The status line under them: wide enough for a short sentence on two lines. */
const STATUS = { width: 0.42, height: 0.09 } as const;
/** What the line under the controls says while a new version waits. */
const UPDATE_LINE = "New version ready — press here to update";

/** Good news goes by itself; a problem stays until it is tapped away. */
const NOTICE_FADE_MS = 5_000;
/**
 * NOTHING STAYS FOR EVER (Nikk, 2026-09-28): "make sure none of those update
 * messages stay too long". A failure stays longer than news, so it can be
 * read, and then it goes too; a voice problem also goes once voice has had
 * its chance to heal itself (useVoiceChat's self-healing).
 */
const NOTICE_STAY_MS = 12_000;

const EASE = 0.12;
/**
 * How fast the closed pair catches up with where it should be, per frame.
 * Nikk (4739): "not one to one lock to your head, have it lerped to where your
 * head position is so it can be smoother". A fraction of the way each frame.
 */
const FOLLOW = 0.1;

/**
 * THE CLOSED CONTROLS ARE TOUCHED, NOT POINTED AT. Nikk (4739): "those should
 * be simple colliders so I can just reach out and touch ... they're always
 * getting in the way of me selecting things". NO pointer reaches them: denying
 * only the laser was not enough, because the hand's grab sphere touched them
 * at chest height and switched the laser off. A press is a fingertip or a
 * controller physically touching the button, measured in the frame loop (see
 * touch-press.ts). The open menu keeps its ray.
 */
const CLOSED_POINTERS: { allow: string[] } = { allow: [] };
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
  roomItems,
  meditation,
  onMeditation,
  hiddenAsStill,
  positionOf,
  onResetStanding,
  onReturnToLobby,
  onSwitchRoom,
  currentRoom,
  onNote,
  avatarRecorder,
  bodyOfYou,
}: {
  anchor: () => { at: { x: number; y?: number; z: number }; yaw: number } | null;
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
  /** Furniture and play objects shared by everybody. */
  roomItems: RoomItem[];
  /** The room's breathing orb, for the Items tab. */
  meditation: Meditation | null;
  onMeditation: (session: Meditation) => void;
  /** Who the hide-still setting is hiding from you now, named on its row. See useHiddenAsStill. */
  hiddenAsStill: string[];
  /** Where somebody is standing, for reading them aloud as loud as they are near. */
  positionOf: (actorId: string) => { x: number; z: number } | null;
  /**
   * Measure the wearer's height again from where their head is now.
   *
   * Nikk asked for it as "reset head position": sit down, tap it, and the room
   * draws you sitting rather than as a standing person squatting.
   */
  onResetStanding: () => void;
  /** End immersive mode, then return to the room directory. */
  onReturnToLobby: () => void;
  /** Move to another room without leaving the headset (the Rooms page). */
  onSwitchRoom: (roomName: string) => Promise<void>;
  /** The room this session is in, for marking it on the Rooms page. */
  currentRoom: string | null;
  /**
   * Put one short line in the server log about something only the headset can
   * see. See the `note` frame in shared/space-wire.ts.
   */
  onNote: (note: string) => void;
  avatarRecorder: AvatarRecorder;
  bodyOfYou: () => string | null;
}) {
  const group = useRef<THREE.Group>(null);
  const [open, setOpen] = useState(false);
  /**
   * SEEING AND FIXING WHAT YOU SAID. Baiwei: "instead of seeing everything I
   * said, I only see an empty bar with a keyboard... I would like to see
   * everything that I've said." The draft line shows only its end, and the
   * Quest's keyboard can only ADD (system-keyboard.ts says why), so a
   * misheard word could never be fixed. This opens the room's own typing panel
   * with the whole draft in it; tap a word to retype or re-speak just that word.
   */
  const [fixing, setFixing] = useState(false);
  /** For the frame loop, which must not wait for a re-render to know. */
  const fixingNow = useRef(false);
  fixingNow.current = fixing;
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
  const [view, setView] = useState<SettingsView>("root");
  /**
   * THE TABS (Nikk 4785, Moraine v0.2 and its addendum). First a scope, ME or
   * THIS ROOM, then that scope's short row of tabs, so a headset never shows
   * eight across. ME follows the person between rooms; THIS ROOM changes what
   * everybody here sees and says so.
   */
  // The tab is whichever one the view belongs to: see tabOfView.
  /**
   * The Rooms page's lists, read each time it opens: which rooms you belong to
   * and which public ones you could join. Null while loading. Read fresh
   * rather than kept, because joining somewhere on another device should show
   * the next time you look.
   */
  const [myRooms, setMyRooms] = useState<RoomSummary[] | null>(null);
  const [openRooms, setOpenRooms] = useState<RoomSummary[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  useEffect(() => {
    if (view !== "rooms") return;
    const controller = new AbortController();
    setMyRooms(null);
    setOpenRooms(null);
    bff.rooms(controller.signal).then((rooms) => setMyRooms(rooms)).catch(() => { if (!controller.signal.aborted) setMyRooms([]); });
    bff.publicRooms(controller.signal).then((rooms) => setOpenRooms(rooms)).catch(() => { if (!controller.signal.aborted) setOpenRooms([]); });
    return () => controller.abort();
  }, [view]);
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
  /** Whether the line under the controls is offering the update, for the fingertip loop. */
  const updateOfferedNow = useRef(false);
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
  const [destination] = useState<VoiceDestination>("room-and-agents");
  const [alwaysOn] = useState(false);
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
  /** The touch mic by your hip, for controllers: off unless chosen (controller-mic.ts). */
  const [touchMic, setTouchMicState] = useState(readTouchMicSetting);
  const touchMicNow = useRef(touchMic);
  touchMicNow.current = touchMic;
  const setTouchMic = (on: boolean) => {
    writeTouchMicSetting(on);
    setTouchMicState(on);
  };
  /** Which face buttons were down last frame, to act only as one goes down. */
  const facePrev = useRef({ talk: false, cancel: false });
  /** Every line this surface has queued and not yet heard end — see queueAloud. */
  const speaking = useRef(new Set<SpeechOutput>());
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
  /** A voice problem shows for NOTICE_STAY_MS, then goes; a new problem shows again. */
  const [troubleShown, setTroubleShown] = useState(false);
  useEffect(() => {
    if (!voice.trouble) return setTroubleShown(false);
    setTroubleShown(true);
    const timer = window.setTimeout(() => setTroubleShown(false), NOTICE_STAY_MS);
    return () => window.clearTimeout(timer);
  }, [voice.trouble]);
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
  // Any notice, however it was set, goes after NOTICE_STAY_MS at the most.
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice((current) => (current === notice ? null : current)), NOTICE_STAY_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [sending, setSending] = useState(false);
  /** Pressing ✕ while a send is in flight: see send-timeout.ts. */
  const sendStop = useRef<AbortController | null>(null);
  const input = useRef<SteadyRecorder | null>(null);
  const keyboard = useRef<SystemKeyboard | null>(null);
  /** The draft as of this render, for a tap handler that must not wait for one. */
  const writtenNow = useRef("");
  writtenNow.current = written;
  const session = useXR((state) => state.session);
  /** In a headset right now, for the send timing report. */
  const inXrNow = useRef(false);
  inXrNow.current = Boolean(session);
  const returnToLobby = () => { void endSessionThenReturn(session, onReturnToLobby); };
  const confidence = useRef<number | undefined>(undefined);
  /**
   * NO SPEECH RECOGNITION DURING A CALL. The browser's recognizer takes the
   * microphone for itself, and on a headset that ends the call's hold on it:
   * Nikk (5416) was cut out of the call and his message to the agents never
   * sent. While the call is on, spoken messages are recorded from a copy of
   * the call's own microphone and written down by the server instead.
   */
  const capabilities = useMemo(() => {
    const found = speechCapabilities();
    return voice.on ? { ...found, recognition: false } : found;
  }, [voice.on]);
  const voiceNow = useRef(voice);
  voiceNow.current = voice;

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
  /**
   * THE CHAT OF THE ROOM YOU ARE STANDING IN when the feed has not said. Nikk
   * (5053): "Not sent to the group chat (no room)". The feed's room goes blank
   * whenever the list of joined rooms fails to load (a deploy restarting the
   * server, a dropped request), and a send then had nowhere to go. One room is
   * one WebHarness room, so the room you are in is the right chat.
   */
  const chatRoom = groupRoom ?? currentRoom;
  const live = useRef({ alwaysOn, destination, groupRoom: chatRoom, you });
  live.current = { alwaysOn, destination, groupRoom: chatRoom, you };

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
    const stop = new AbortController();
    sendStop.current = stop;
    const failures: string[] = [];
    // STOP THE CHAT AT THE FIRST PART THAT FAILS. A long transcript is now
    // several messages in order, and carrying on past a failure would post
    // part three with part two missing — a gap in the middle of somebody's
    // sentence that nobody is told about.
    let chatStopped = false;
    // NO ANSWER IS NOT A REFUSAL. Nikk (4967): after "did not reach", his
    // words had arrived every time; the headset simply never heard back. A
    // part that times out is PROBABLY SENT, so it is not reported as lost and
    // does not invite a resend. The server posts repeated words once anyway
    // (server/routes/repeat-guard.ts).
    const unanswered: string[] = [];
    const timings: { to: string; startedAt: number; answeredAt: number | null; outcome: string }[] = [];
    for (const item of plan.posts) {
      const timing = { to: item.to, startedAt: Date.now(), answeredAt: null as number | null, outcome: "sent" };
      timings.push(timing);
      if (item.to === "group-chat" && chatStopped) continue;
      try {
        if (item.to === "room") {
          // THE WRITTEN REMAINDER GOES TOO. `planVoice` splits anything too
          // long to say into a spoken opening and a written rest; dropping
          // `detail` here would lose the end of somebody's sentence while
          // telling them it was sent, which is the exact failure the split
          // exists to avoid. `say` is omitted when a single sentence was too
          // long to speak at all — better silent than misquoted.
          await withDeadline((signal) => space.say({
            ...(item.say ? { say: item.say } : {}),
            ...(item.detail ? { detail: item.detail } : {}),
            source,
            ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
          }, signal, sendKey("room", item.say ?? "", item.detail ?? "")), stop.signal);
          timing.answeredAt = Date.now();
        } else if (!room) {
          failures.push("the group chat (no room)");
        } else {
          // THE SAME KEY FOR THE SAME WORDS, so a resend after a false "not
          // sent" is answered once, never posted twice (server/idempotency.ts).
          await withDeadline((signal) => bff.sendMessage(room, item.content, signal, sendKey("chat", room, item.content)), stop.signal);
          timing.answeredAt = Date.now();
        }
      } catch (error) {
        const outcome = sendOutcome(error);
        timing.outcome = outcome === "unanswered" ? "timed out" : outcome;
        // ✕ while sending: nothing more goes, and nobody is told it failed.
        if (outcome === "stopped") break;
        // NO ANSWER IS NOT A REFUSAL, from either clock: this send's own
        // deadline, or the socket tunnel's (it gives up first, at 20 s, with
        // NO_ANSWER: "it may still arrive"). Counting the tunnel's as a refusal
        // told Nikk "Not sent" for words that had arrived.
        if (outcome === "unanswered") {
          const where = item.to === "room" ? "the room" : "the chat";
          if (!unanswered.includes(where)) unanswered.push(where);
          continue;
        }
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
    sendStop.current = null;
    // Where the time went, for the server log. Never waited for, never shown.
    void space.sendTiming({ parts: timings, inXr: inXrNow.current, visible: document.visibilityState }).catch(() => {});
    if (stop.signal.aborted) return false;
    // NAMED INDIVIDUALLY. Being told your words reached the agents when they
    // did not is the quiet failure this product exists not to have.
    if (failures.length === 0) {
      if (source === "voice") {
        setHeard("");
        // AND THE RECORDER'S OWN COPY. It keeps every phrase of a session and
        // may still be listening (words sent while "waiting" did not stop it),
        // so the next message began with this one: Nikk's second message was
        // his first again, plus a few words (5326). clear() also stops the
        // engine re-sending phrases it has already delivered.
        input.current?.clear();
        confidence.current = undefined;
      }
      flash(unanswered.length > 0
        ? "Probably sent (slow reply). Check the chat."
        : to === "room" ? "Sent to the room." : "Sent to the room and the chat.");
      return true;
    } else {
      // READY FOR ANOTHER TILT. The gesture sat in "ending" while the words
      // waited, so a second tilt did nothing; now raising the hand again and
      // tilting sends them.
      micGestureState.current = { phase: "recording", side: null, rotation: null, fistSince: null, missingSince: null };
      sendAfterGesture.current = false;
      // The retry is what you can reach: with hands there is no ▲ any more.
      // SHORT ENOUGH TO READ WHOLE. Nikk (5066): "we need to format this UI so
      // all the text fits in the box and it stops giving ... and not sharing it
      // all". Two lines of the status box hold about forty characters.
      const where = failures.some((f) => f.startsWith("the room")) && failures.some((f) => f.startsWith("the group chat"))
        ? "room + chat" : failures.some((f) => f.startsWith("the room")) ? "room" : "chat";
      setNotice(`Not sent to ${where}. ${handsInViewNow.current ? "Tilt: retry · fist: drop" : "▲ retries"}`);
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
      if (cancelled) {
        asked.current = false;
        return;
      }
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
      borrow: () => (voiceNow.current.on ? voiceNow.current.microphone() : null),
      onPhase: setSaying,
      onTrouble: (message) => setNotice(message),
    });
    return sayer.current;
  }, []);
  /**
   * THE MICROPHONE MAY BE ASKED FOR, AND IT SAYS SO FIRST.
   *
   * `getUserMedia` inside an immersive session means the browser's permission
   * dialog appears inside an immersive session, which is the exact shape of the
   * thing that threw baiwei out of the room every time he tapped a text box.
   * Live voice asks for the microphone too, but only when somebody turns it on,
   * so a person who has never used voice arrives in the headset with the
   * question unanswered and the first press of this button is where it lands.
   *
   * Same answer as the keyboard: the first press warns, the second goes ahead.
   * Nobody gets a dialog they did not choose, and nobody is surprised by one at
   * the moment it could interrupt them.
   */
  const [micRisky, setMicRisky] = useState(false);
  const startSaying = useCallback(async (insist = false) => {
    setNotice(null);
    if (!insist) {
      const state = await microphoneState();
      if (state !== "granted") {
        setMicRisky(true);
        setNotice(
          state === "denied"
            ? "The microphone was refused for this site. Allow it in the browser, or type instead."
            : "The headset may ask to allow the microphone, which can interrupt the room. Press again to go ahead.",
        );
        onNote(`recording held back: microphone permission is ${state ?? "unknown"}`);
        return;
      }
    }
    try {
      await say().start();
      onNote("recording to be written down by the server");
    } catch (error) {
      setSaying("idle");
      const message = error instanceof Error ? error.message : "The microphone could not be opened.";
      setNotice(message);
      onNote(`recording refused: ${message}`);
    }
    setMicRisky(false);
  }, [say, onNote]);
  const finishSaying = useCallback(async () => {
    /*
     * SENT ON BY THE SERVER when these words would go straight out anyway: the
     * chop gesture, or "send as you speak". Nikk (5187): only the recording
     * then crosses a slow link, not the words back and two sends up again.
     */
    const autoSend = live.current.alwaysOn || sendAfterGesture.current;
    const { destination: to, groupRoom: room } = live.current;
    const words = await say().finish(autoSend ? { send: to, chat: room ?? null } : undefined);
    if (!words) {
      onNote("nothing was heard, so nothing was written down");
      return;
    }
    onNote(`written down: ${words.split(/\s+/).length} words`);
    const sent = autoSend ? say().sent() : null;
    if (sent && sent.room && (to === "room" || sent.chat === true)) {
      // Everything went: nothing is left for this headset to send.
      sendAfterGesture.current = false;
      onNote("sent on by the server");
      flash(to === "room" ? "Sent to the room." : "Sent to the room and the chat.");
      return;
    }
    // Anything the server could not send, the headset sends as before. The
    // parts that did go carry the same keys, so they are answered, not doubled.
    /**
     * SENDING AS YOU SPEAK MEANS NO CONFIRM HERE TOO. Baiwei (4973), on a
     * headset whose words the server writes down: "I've switched in settings,
     * sending as you speak, but still ask me to confirm by hand." The setting
     * was only read on the Web Speech path, so this one always stopped at a
     * draft. Now it sends what was said, as the other path does.
     */
    if (live.current.alwaysOn) {
      void post(words);
      return;
    }
    // Added to whatever is already drafted, exactly as the keyboard does, so
    // speaking twice before sending does not throw the first half away.
    setWritten((kept) => mergeKeyboardEdit(kept, words));
  }, [say, onNote, post, flash]);

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
   * THE CHAT IS NOT READ ALOUD. Nikk, hearing the written half arrive after the
   * spoken one: "we don't need any TTS now of things that are in chat, the only
   * audio that we should hear are the messages that are actually sent to the
   * room".
   *
   * THIS USED TO BE THE ONLY THING THAT MADE ANY SOUND, and the reason it
   * existed is worth keeping even though the code is gone: agents did not post
   * room utterances, so a question asked out loud was answered only on a panel
   * behind you. Reading the chat was the workaround. Agents post utterances
   * now, the box speaks them in the speaker's own voice, and the workaround had
   * become the thing you could hear INSTEAD of the voice — the browser's robot
   * reading the whole message over a summary already spoken.
   *
   * WHAT THIS GIVES UP, deliberately: an agent that posts ONLY to chat is now
   * silent. That is the trade Nikk asked for, and it is the right way round —
   * chat is the record and the room is the voice — but it means the way to be
   * heard is to say something in the room, not to type into the panel.
   *
   * The watermark still moves so nothing here comes back if this is ever
   * reinstated mid-conversation.
   */
  useEffect(() => {
    spokenAlready.current = Math.max(spokenAlready.current ?? 0, newestId(feed.messages));
  }, [feed.messages]);

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
    // A room utterance has audio on the box, in the speaker's chosen voice. The
    // chat reader above does not: those messages are WebHarness's and the box
    // has never heard of them. See said-aloud.ts.
    // IN TURN, NOT OVER THE TOP. This used to cancel whatever was playing, so
    // a second agent cut the first off mid-sentence. See queueAloud.
    let line: SpeechOutput | null = null;
    line = queueAloud({
      utteranceId: liveUtterance.id,
      say: liveUtterance.say ?? "",
      speaker: liveUtterance.actorId,
      volume: volumeAt(distanceTo(liveUtterance.actorId)),
      // Forgotten once it has been heard, so the set holds only what is pending.
      onPhase: (phase) => {
        if (phase === "idle" && line) speaking.current.delete(line);
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    speaking.current.add(line);
  }, [liveUtterance, hearReplies, listening, you]);

  // Nothing keeps talking after the panel goes away.
  useEffect(() => () => {
    for (const line of speaking.current) line.cancel();
    speaking.current.clear();
  }, []);

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
  const pinned = useRef<{ x: number; y?: number; z: number; yaw: number; from: { x: number; z: number } } | null>(null);

  const pinAhead = useCallback(() => {
    const body = anchor();
    if (!body) return;
    // Pinned out in front of where you were STANDING when you opened it,
    // using the panel's own lagged facing rather than your head's, so it
    // does not appear off to one side if you happened to be glancing away.
    const yaw = facing.current ?? body.yaw;
    pinned.current = {
      x: body.at.x - Math.sin(yaw) * OPEN_AHEAD,
      z: body.at.z - Math.cos(yaw) * OPEN_AHEAD,
      yaw,
      // Where you stood to open it: walk a metre from here and it closes.
      from: { x: body.at.x, z: body.at.z },
    };
  }, [anchor]);

  const openMenu = useCallback(() => {
    pinAhead();
    setOpen(true);
  }, [pinAhead]);

  /** Fixing what you said: see FIX_AHEAD. Never pinned — it follows you. */
  const startFixing = useCallback(() => {
    pinned.current = null;
    setOpen(false);
    setFixing(true);
  }, []);
  const stopFixing = useCallback(() => {
    pinned.current = null;
    setFixing(false);
  }, []);

  const closeMenu = useCallback(() => {
    pinned.current = null;
    // Back to the main screen of the tab you were on, so it opens where you left it.
    setView((current) => SETTINGS_TABS.find((entry) => entry.id === tabOfView(current))?.view ?? "root");
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
  /** Whether the closed pair has been put in place once; after that it eases. */
  const placed = useRef(false);
  const followTo = useMemo(() => new THREE.Vector3(), []);
  /** The closed buttons' presses, current each render, for the touch check. */
  const pressTalkRef = useRef<() => void>(() => {});
  const openMenuRef = useRef<() => void>(() => {});
  const closeMenuRef = useRef<() => void>(() => {});
  const cancelRef = useRef<(() => void) | null>(null);
  const micGestureState = useRef<MicGestureState>(IDLE_MIC_GESTURE);
  /** The gesture finished before the words were in: send them when they are. */
  const sendAfterGesture = useRef(false);
  const lastControllerSeen = useRef(-Infinity);
  /**
   * TRACKED HANDS IN VIEW: the touch talk and cancel buttons hide. Nikk
   * (5044): "remove the touch for starting recording as well as cancelling
   * recording ... so that we cannot touch to do that", now the gesture works.
   * Holding controllers there is no gesture, so they come back.
   */
  const [handsInView, setHandsInView] = useState(false);
  const handsInViewNow = useRef(false);
  handsInViewNow.current = handsInView;
  const touching = useRef<Set<string>>(new Set());
  /** Pointer click and fingertip contact can describe the same physical press. */
  const lastRoomCallPress = useRef(-Infinity);
  /** The settings gear that appears when you look up (Nikk, 5245). */
  const upGear = useRef<THREE.Group>(null);
  const upShown = useRef(false);
  const [upVisible, setUpVisible] = useState(false);
  // Which room the scene should hide agents in, if you asked it to.
  useEffect(() => setCurrentRoomForAgents(currentRoom), [currentRoom]);
  // Re-read on every change to the store; the personal row shows only YOUR choice.
  useAgentsHidden();
  const agentsHiddenForEveryone = useAgentsHiddenForEveryone();
  const hiddenForMe = agentsHiddenIn(currentRoom);
  const [handIsNear, setHandIsNear] = useState(false);
  const buttonOpacity = handIsNear ? 1 : IDLE_OPACITY;
  const toggleRoomCall = useCallback(() => {
    const now = performance.now();
    if (isDuplicateActivation(lastRoomCallPress.current, now)) return;
    lastRoomCallPress.current = now;
    const next = !(voice.on || voice.starting);
    rememberSelfMute(!next);
    voice.setOn(next);
  }, [voice.on, voice.setOn, voice.starting]);
  useFrame((state) => {
    const node = group.current;
    const body = anchor();
    if (!node) return;
    node.visible = body !== null;
    // THE GEAR, UP WHERE YOU LOOK (Nikk, 5245): shown once you tip your head
    // up, floating along your gaze and turned to face you.
    const up = upGear.current;
    if (up) {
      const eyes = state.camera.getWorldPosition(new THREE.Vector3());
      const gaze = state.camera.getWorldDirection(new THREE.Vector3());
      const shown = body !== null && !open && lookingUp(upShown.current, Math.asin(Math.max(-1, Math.min(1, gaze.y))));
      if (shown !== upShown.current) {
        upShown.current = shown;
        setUpVisible(shown);
      }
      up.visible = shown;
      if (shown) {
        const at = upGearAt(eyes, gaze);
        up.position.set(at.x, at.y, at.z);
        up.lookAt(eyes);
      }
    }
    if (!body) return;

    const held = pinned.current;
    if (held || fixingNow.current) placed.current = false;
    if (held && walkedAway(held.from, body.at)) {
      // WALKED AWAY: the settings close by themselves (Nikk, 5248).
      closeMenuRef.current();
      return;
    }
    if (held) {
      if (held.y === undefined) {
        const head = state.camera.getWorldPosition(new THREE.Vector3()).y;
        // CENTRED ON YOUR EYES (Nikk, 5410): "when it pops up the centre of the
        // menu is straight in front of your head". The panel is drawn about
        // its own middle, so its middle goes at the head's height.
        held.y = head > 0.5 ? head : OPEN_HEIGHT;
      }
      node.position.set(held.x, held.y, held.z);
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
    if (fixingNow.current) {
      // Ahead of you at eye height, turned to face you, following as you move
      // with the same lagged facing as the closed controls, so it does not
      // swing with every glance.
      node.position.set(body.at.x - Math.sin(yaw) * FIX_AHEAD, FIX_HEIGHT, body.at.z - Math.cos(yaw) * FIX_AHEAD);
      node.rotation.order = "YXZ";
      node.rotation.set(0, yaw, 0);
      return;
    }
    const { position, rotation } = closedControlPose(body.at, yaw);
    // Eased toward the spot, not welded to it; a fresh panel starts there.
    if (!placed.current) {
      node.position.set(position[0], position[1], position[2]);
      placed.current = true;
    } else {
      node.position.lerp(followTo.set(position[0], position[1], position[2]), FOLLOW);
    }
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

    /**
     * TOUCH, measured. Where each closed button is in the room, against where
     * each fingertip (a hand) or grip (a controller) is. See touch-press.ts.
     */
    if (open) return;
    node.updateMatrixWorld();
    const at = (x: number) => {
      const p = node.localToWorld(new THREE.Vector3(x, 0, 0));
      return { x: p.x, y: p.y, z: p.z };
    };
    // ONLY WHAT IS DRAWN: the same list the buttons below are drawn from.
    const buttons: TouchButton[] = closedButtons(handsInViewNow.current || !touchMicNow.current, cancelRef.current !== null).map((id) => ({
      id,
      at: at(id === "talk" ? TALK_X : CANCEL_X),
      radius: ICON / 2,
    }));
    // The update line, while it is offered: three touch points along it, since
    // it is a wide strip and a touch point is a sphere.
    if (updateOfferedNow.current) {
      const y = -ICON / 2 - 0.035 - STATUS.height / 2;
      for (const x of [-STATUS.width / 3, 0, STATUS.width / 3]) {
        const p = node.localToWorld(new THREE.Vector3(x, y, 0));
        buttons.push({ id: "update", at: { x: p.x, y: p.y, z: p.z }, radius: STATUS.height * 0.75 });
      }
    }
    // The gear, while it is up, is pressed by a fingertip the same way.
    if (upShown.current && upGear.current) {
      const gearAt = upGear.current.getWorldPosition(new THREE.Vector3());
      buttons.push({ id: "gear", at: { x: gearAt.x, y: gearAt.y, z: gearAt.z }, radius: UP_GEAR_SIZE / 2 });
    }
    const contacts = [goHandInput.left?.contact ?? null, goHandInput.right?.contact ?? null];
    const { pressed, inside } = touchPresses(buttons, contacts, touching.current);
    touching.current = inside;
    for (const id of pressed) {
      if (id === "gear") openMenuRef.current();
      else if (id === "room-call") toggleRoomCall();
      else if (id === "talk") pressTalkRef.current();
      else if (id === "cancel") cancelRef.current?.();
      else if (id === "update") reloadNow();
    }
    const near = handNear(buttons, contacts);
    if (near !== handIsNear) setHandIsNear(near);
  });
  useFrame(() => {
    recorderControlVisual.personalUi = open ? recordedControl(group.current) : null;
  });

  /**
   * WHAT THE MENU SHOWS: decided in settings-menu-model.ts, drawn as one panel
   * by SettingsMenu3D. Only worked out while it is open.
   */
  const projectName =
    showingChoices.projects?.find((project) => project.id === showing.projectId)?.name ?? null;
  const boardName =
    showingChoices.boards?.find((moodBoard) => moodBoard.id === showing.boardId)?.title ?? null;

  /**
   * ROOMS, from inside the room (Nikk, 4735): going to another keeps the
   * headset on — SpacePanel's switchRoom moves this session and reopens the
   * room in place.
   */
  const goRoom = (room: string, join: boolean) => {
    if (switching) return;
    setSwitching(room);
    flash(join ? `Joining ${room}…` : `Going to ${room}…`);
    (join ? bff.joinRoom(room).then(() => onSwitchRoom(room)) : onSwitchRoom(room))
      .then(() => flash(`You are in ${room}`))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `Could not go to ${room}.`))
      .finally(() => setSwitching(null));
  };
  /**
   * WHERE AGENTS LIVE, set from where you stand (Nikk): "I want you to be
   * standing over here facing me or ... beside me facing away from me so I can
   * watch your work". Worked out from your position and heading at the moment
   * you press, saved as that agent's home, and the agent walks there.
   */
  const placeAgent = (agent: string, where: "facing" | "beside" | "desk") => {
    const failed = (error: unknown) => setNotice(error instanceof Error ? error.message : `Could not move ${agent}.`);
    if (where === "desk") {
      space.clearAgentHome(agent).then(() => flash(`${agent} is going back to its desk.`)).catch(failed);
      return;
    }
    const me = anchor();
    if (!me) {
      setNotice("Cannot tell where you are standing yet.");
      return;
    }
    const choose: (me: { at: { x: number; z: number }; facing: number }) => AgentHome = where === "facing" ? homeFacingMe : homeBesideMe;
    space
      .placeAgent(agent, choose({ at: me.at, facing: me.yaw }))
      .then(() => flash(`${agent} ${where === "facing" ? "is coming to stand in front of you." : "is coming to work beside you."}`))
      .catch(failed);
  };
  const sections = !open ? [] : settingsSections({
    view,
    goTo: setView,
    voice: {
      on: voice.on,
      starting: voice.starting,
      others: voice.hearable,
      isMuted: (name) => voice.muted.has(name.trim().toLowerCase()),
      setOn: (on) => {
        rememberSelfMute(!on);
        voice.setOn(on);
      },
      setMuted: voice.setMuted,
    },
    voiceExtra: [
      ...(micRisky
        ? [{ label: "Use the microphone anyway — the headset may ask", onTap: () => { setMicRisky(false); void startSaying(true); } }]
        : []),
      ...(keyboardRisky
        ? [{ label: "Open the keyboard anyway — may exit the headset", onTap: () => { setKeyboardRisky(false); openTextEntry(true); } }]
        : []),
    ],
    hearReplies,
    touchMic,
    setTouchMic,
    setHearReplies: (on) => setHearReplies(on),
    handsShown,
    setHandsShown: (shown) => {
      setHandsShown(shown);
      showHandModels(shown);
    },
    teleport: pinchTeleport,
    setTeleport: (on) => {
      setPinchTeleportShown(on);
      setPinchTeleport(on);
    },
    resetHead: () => {
      onResetStanding();
      flash("Measuring your height from where your head is now.");
    },
    view3d: {
      // DARK MODE, ON UNTIL TURNED OFF (Nikk).
      dark: preferences.dark,
      setDark: (on) => setRoomPreferences({ dark: on }),
      rings: preferences.rings,
      setRings: (on) => setRoomPreferences({ rings: on }),
      // Off until chosen, and it says how many it is hiding: a hidden person
      // is still in the room, and a silent filter looks like them leaving.
      hideStill: preferences.hideStill,
      hiddenStill: hiddenAsStill.length,
      setHideStill: (on) => setRoomPreferences({ hideStill: on }),
      // THE POINTER, as a value and a − and a +; pressing the name turns it
      // off, or back on at its default.
      pointer: pointerLabel(preferences.pointer),
      pointerOn: preferences.pointer > 0,
      pointerToggle: () => setRoomPreferences({ pointer: preferences.pointer > 0 ? 0 : DEFAULT_ROOM_PREFERENCES.pointer }),
      pointerLess: () => setRoomPreferences({ pointer: stepPointer(preferences.pointer, -1) }),
      pointerMore: () => setRoomPreferences({ pointer: stepPointer(preferences.pointer, 1) }),
      passthroughAvailable,
      passthrough,
      blendMode: blendMode ?? null,
      togglePassthrough: () => {
        if (passthroughAvailable) onTogglePassthrough();
      },
    },
    recorder: currentRoom === "lobby"
      ? {
          status: avatarRecorder.status === "recording" ? "recording" : avatarRecorder.status === "idle" ? "idle" : "preparing",
          showPersonalUi: avatarRecorder.showPersonalUi,
          hasTake: Boolean(avatarRecorder.take),
          playing: avatarRecorder.playing,
          notice: avatarRecorder.notice ?? null,
          start: () => {
            if (avatarRecorder.status === "idle" && you) void avatarRecorder.start(you, bodyOfYou());
          },
          stop: () => void avatarRecorder.stop(),
          setShowPersonalUi: (shown) => {
            if (avatarRecorder.status === "idle") avatarRecorder.setShowPersonalUi(shown);
          },
          play: () => void avatarRecorder.play(),
          stopPlayback: () => avatarRecorder.stopPlayback(),
          discard: () => void avatarRecorder.discard(),
          canPublish: avatarRecorder.canPublish,
          publishedMine: avatarRecorder.published.some((entry) => entry.actorId === you),
          hasPublished: avatarRecorder.published.length > 0,
          welcomeCompleted: avatarRecorder.welcomeCompleted,
          publish: () => void avatarRecorder.publish(),
          unpublish: () => void avatarRecorder.unpublish(),
          playWelcome: () => avatarRecorder.playWelcome(),
          skipWelcome: () => avatarRecorder.finishWelcome(),
        }
      : null,
    // The board this room shows, for Sill's THIS ROOM block (32cbe6a).
    roomRows: roomMenuRows(myRooms, openRooms, currentRoom, { project: projectName ?? showing.projectId }),
    switching,
    goRoom,
    toLobby: returnToLobby,
    goTables: roomItems.map((item) => ({ size: item.size, players: item.colours.length })),
    orbHere: meditation?.shown === true,
    addGoTable: () =>
      void space.addRoomItem().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not add the table.")),
    // THE BREATHING ORB, AS AN ITEM (Nikk 4757): whether it is here is per
    // room and for everyone; its sound stays personal, on the orb itself.
    setOrb: (shown) =>
      void space
        .meditate({ action: "show", shown })
        .then((answer) => onMeditation(answer.meditation))
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not change the orb.")),
    showing: {
      projectId: showing.projectId,
      projectName,
      boardId: showing.boardId,
      boardName,
      setBy: showing.setBy ?? null,
      refusal: showingChoices.refusal ?? null,
    },
    projects: showingChoices.projects,
    boards: showingChoices.boards,
    choose: (projectId, boardId) => showingChoices.choose({ projectId, boardId }),
    panels: panels.catalogue.map((panel) => ({
      id: panel.id,
      label: panel.label,
      shown: panels.open.includes(panel.id),
      mode: arrange.modeOf(panel.id),
    })),
    setPanelShown: (id, shown) => panels.setOpen(id, shown),
    cyclePanel: (id) => arrange.cycle(id),
    anyUnlocked: arrange.anyUnlocked,
    lockAll: () => arrange.lockAll(),
    panelRefusal: panels.refusal ?? null,
    agents,
    // HIDE THE AGENTS FOR EVERYONE in this room, their screens too (Nikk 5384).
    agentsHiddenForEveryone,
    setAgentsHiddenForEveryone: (next) => {
      setAgentsHiddenForEveryone(next);
      void space.setAgentsHiddenForRoom(next).catch(() => {
        setAgentsHiddenForEveryone(!next);
        setNotice("That did not reach the room; the agents were not changed.");
      });
    },
    // For you alone, in this room (Nikk 5299): see agents-hidden.ts.
    agentsHiddenForMe: currentRoom ? hiddenForMe : null,
    setAgentsHiddenForMe: (hidden) => {
      if (currentRoom) setAgentsHidden(currentRoom, hidden);
    },
    placeAgent,
  });
  /** How far below the open menu's middle its bottom edge is, in metres. */
  const menuHalfHeight = menuHeight() / MENU.pxPerMetre / 2;

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
  // SAY IT IS SENDING. Nikk (4905): "the text below should be message is
  // currently sending please wait". It said "Ready to send" all the way
  // through a send, so a slow one looked like a press that did nothing.
  const recordingStatus = sending
    ? handsInView ? "Sending… please wait" : "Sending… please wait\n✕ stops it"
    : listening
    ? alwaysOn
      ? "● Listening — sending as you speak"
      : "● Recording\n◼ sends   ✕ cancels"
    : saying === "recording"
      ? alwaysOn
        ? "● Recording\n◼ sends   ✕ cancels"
        : "● Recording\n◼ writes it down   ✕ cancels"
      : saying === "writing"
        ? "Writing down what you said…"
        : heardWaiting
          ? handsInView ? "Ready to send\ntilt sends · fist drops" : "Ready to send\n▲ sends   ✕ throws away"
          : null;
  const said =
    notice ??
    recordingStatus ??
    (troubleShown ? voice.trouble : null) ??
    (keyboardFocused ? null : draftPreview) ??
    (newVersion ? UPDATE_LINE : null);
  // THE UPDATE LINE IS A BUTTON (Nikk, desktop chat): "say click here to update,
  // and allow it to be clickable or pressable" — by a ray, a pinch, or a fingertip.
  const updateOffered = said === UPDATE_LINE;
  /**
   * ONLY PRESSABLE WHEN PRESSING DOES SOMETHING (Nikk, 2026-09-28): the line
   * "is still clickable so it gets in the way of clicking on things". The
   * update offer and a draft you can open to fix are actions; "sent",
   * "cancelled", a failure or a status are words to read, and a ray or a
   * fingertip passes straight through them to whatever is behind.
   */
  const lineActionable = statusLineActionable({ updateOffered, showingDraft: said !== null && said === draftPreview && !recordingStatus && !sending });
  updateOfferedNow.current = updateOffered && !open && !fixing;
  /** Something a cancel button can throw away: a recording, words waiting, or a written draft. */
  const cancellable =
    sending ||
    (saying !== "writing" &&
    (listening ||
      heardWaiting ||
      saying === "recording" ||
      (!capabilities.recognition && written.trim() !== "" && !keyboardFocused)));
  /** The closed buttons drawn, and the only ones a fingertip can press. */
  const shownButtons = closedButtons(handsInView || !touchMic, cancellable);
  const cancel = () => {
    // A SEND IN FLIGHT STOPS, and what was said stays ready to send again.
    if (sending) {
      sendStop.current?.abort();
      flash(handsInViewNow.current ? "Stopped. Tilt to send again." : "Stopped. ▲ sends again.");
      return;
    }
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

  /** The talk button's press, shared by a tap and a fingertip touch. */
  const pressTalk = () => {
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
                // THE SECOND PRESS MEANS IT. `micRisky` is set by the first
                // press, which only warns; passing it back is what makes
                // "press again to go ahead" true. Without this the notice
                // promised something the button could not do, and clem pressed
                // it five times in a row on their first day in the room.
                else if (canSpeak) void startSaying(micRisky);
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
};
  /**
   * NOBODY TALKS OVER YOU. Nikk (5158): "If agent is talking and I talk then I
   * can't hear the agent". What the room says waits while you record and send,
   * and plays once you have finished (said-aloud.ts holdAloud).
   */
  const talking = listening || saying === "recording" || sending;
  useEffect(() => {
    holdAloud(talking);
  }, [talking]);
  useEffect(() => () => holdAloud(false), []);

  pressTalkRef.current = pressTalk;
  openMenuRef.current = openMenu;
  closeMenuRef.current = closeMenu;
  // THE GESTURE NEVER STOPS A SEND ON ITS WAY. Only the ✕ button does. A
  // tracking blink read as a fist was aborting Nikk's sends mid-flight (the
  // headset reported them "stopped"), then saying so, while they had arrived.
  cancelRef.current = cancellable ? () => { if (!sendStop.current) cancel(); } : null;

  useEffect(() => {
    if (!sendAfterGesture.current || sending) return;
    const ready = capabilities.recognition
      ? !listening && heard.trim() !== ""
      : saying === "idle" && written.trim() !== "" && !keyboardFocused;
    if (!ready) return;
    sendAfterGesture.current = false;
    pressTalkRef.current();
  }, [heard, listening, sending, saying, written, keyboardFocused, capabilities.recognition]);

  /**
   * OPTIONAL HAND GESTURE, in parallel with the touch mic. The mic remains the
   * simple fallback; the gesture only runs while its action would start a real
   * recording or while a recording is already active. That keeps an upright
   * hand from accidentally sending a draft or opening the keyboard.
   */
  useFrame(() => {
    // WORDS WAITING COUNT AS STILL RECORDING, for the gesture. With the touch
    // buttons gone for hands (see handsInView), the tilt must be able to send
    // words that recognition finished on its own, and a fist to throw them away.
    const waiting = !alwaysOn && (capabilities.recognition
      ? !listening && heard.trim() !== ""
      : saying === "idle" && written.trim() !== "" && !keyboardFocused);
    const recording = listening || saying === "recording" || waiting;
    // The touch buttons are for controllers only (Nikk, 2026-09-28): they show
    // while a controller is connected, and never because hands dropped out of
    // tracking. A second's grace so a controller blinking out does not flash them.
    const now = performance.now();
    if (controllersInUse.now) lastControllerSeen.current = now;
    const seen = now - lastControllerSeen.current >= 1_000;
    if (seen !== handsInView) setHandsInView(seen);
    const startAction = capabilities.recognition
      ? micPress({ available: true, listening, sending, heard, alwaysOn }) === "start"
      : saying === "idle" && canSpeak && written.trim() === "" && !keyboardFocused;
    const result = stepMicGesture(
      micGestureState.current,
      micGestureHands,
      recording,
      performance.now(),
      anchor() !== null && !sending && saying !== "writing" && (recording || startAction),
    );
    micGestureState.current = result.state;
    micGestureIndicator.side = result.outlineSide;
    micGestureIndicator.tilt = result.tilt ?? 0;
    micGestureIndicator.closing = result.closing ?? 0;
    if (result.action === "finish" || result.action === "cancel") {
      micGestureIndicator.popAt = performance.now();
      micGestureIndicator.popKind = result.action === "finish" ? "sent" : "cancelled";
    }
    if (result.action === "start" && result.state.phase === "starting") {
      // What the headset measured, so a start nobody meant can be explained
      // from the server log (Nikk, 5111).
      const hand = micGestureHands[result.state.side];
      if (hand) onNote(describeStart(result.state.side, hand));
    }
    // A OR X, B OR Y: the same three actions as the gesture, from the moment
    // a button goes down. Only when no gesture acted this frame.
    const faces = { talk: controllerFaceButtons.talk, cancel: controllerFaceButtons.cancel };
    const went = (key: "talk" | "cancel") => faces[key] && !facePrev.current[key];
    const faceAction = result.action === null || result.action === undefined
      ? went("cancel")
        ? controllerMicAction("cancel", recording, false)
        : went("talk")
          ? controllerMicAction("talk", recording, anchor() !== null && !sending && saying !== "writing" && startAction)
          : null
      : null;
    facePrev.current = faces;
    if (faceAction === "start") {
      sendAfterGesture.current = false;
      pressTalkRef.current();
    } else if (faceAction === "finish") {
      sendAfterGesture.current = !capabilities.recognition;
      pressTalkRef.current();
    } else if (faceAction === "cancel") {
      sendAfterGesture.current = false;
      cancelRef.current?.();
    }
    if (result.action === "start") {
      sendAfterGesture.current = false;
      pressTalkRef.current();
    } else if (result.action === "finish") {
      // FINISHING MEANS SEND. Nikk: the tilt ended the recording and then it
      // sat on "Ready to send ▲" until he pressed the button, and the button is
      // gone for hands now. If the words are not in yet, they go when they are.
      // ONCE. With speech recognition the press already waits for the final
      // words and sends them; also sending "when the words arrive" raced it
      // and posted the partial first (Nightjar, 5059: "Testing again your",
      // then the whole sentence). Only the server-transcribed path needs the
      // second step: there the press writes the words down and stops.
      sendAfterGesture.current = !capabilities.recognition;
      pressTalkRef.current();
    } else if (result.action === "cancel") {
      sendAfterGesture.current = false;
      cancelRef.current?.();
    }
  });

  return (
    <>
      {/* THE GEAR, UP WHERE YOU LOOK (Nikk, 5245): a pointer or a fingertip
          opens the settings. Placed every frame in the loop above. */}
      <group ref={upGear} visible={false}>
        {upVisible && !open ? (
          <>
            {/* Half see-through, and the call button is gone from beside it (Nikk, 5426). */}
            <WristButton label="⚙" glyph x={0} y={0} width={UP_GEAR_SIZE} height={UP_GEAR_SIZE} opacity={0.5} onTap={openMenu} />
          </>
        ) : null}
      </group>
      <group ref={group} visible={false}>
      {fixing ? (
        /*
          IN PLACE OF THE CONTROLS, not beside them: the editor has its own
          speak and save, and a mic button behind the keys would be one more
          thing to mis-press. Centred where the gear and mic were, at the size
          of those controls (their icons are 18cm), not a board's.
        */
        <Typing3D
          prompt="What you said: tap a word to fix it"
          initial={written}
          // The chat's own limit: the draft is a chat message once it is saved.
          limit={CHAT_MESSAGE_LIMIT}
          // 1.2m ahead at eye height (FIX_AHEAD), about the distance from the
          // eyes of the waist-level spot where Baiwei said the size was right,
          // so about that size. Dropped a little so the keys sit below the eyes
          // and the words at them.
          position={[0, -0.12, 0]}
          scale={1.5}
          // Baiwei, in a headset: "Only the keyboard is too big". The words
          // stay big enough to tap one at a time; the keys are 0.7 of that.
          keyboardScale={0.7}
          onDone={(text) => {
            setWritten(text);
            stopFixing();
          }}
          onCancel={stopFixing}
        />
      ) : open ? (
        <>
        {/*
          ONE PANEL (Nikk, 5426, 5439, 5445): the tabs as a segmented control,
          the sections side by side and never taller, close in the corner, and
          "Update now" where the title is while a new version waits.
        */}
        <SettingsMenu3D
          model={{
            title: "Settings",
            tabs: SETTINGS_TABS,
            active: tabOfView(view),
            onTab: (id) => setView(SETTINGS_TABS.find((entry) => entry.id === id)?.view ?? "root"),
            onClose: () => closeMenu(),
            sections,
            badge: settingsBadge(newVersion, reloadNow),
          }}
        />
        </>
      ) : (
        <group pointerEventsType={CLOSED_POINTERS}>
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
          {/* THE GEAR IS UP WHERE YOU LOOK now, not down here: see upGear below
              (Nikk, 5245). */}
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
          {!shownButtons.includes("talk") ? null : <WristButton
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
            opacity={buttonOpacity}
            onTap={pressTalk}
          />}
          {/* CANCEL, to the right of talk, only while there is something to
              throw away. Nikk: "add a button to cancel recording so if you've
              begun recording but you want to cancel what you've just recorded,
              have a button that appears to the right of the record button". */}
          {shownButtons.includes("cancel") ? (
            <WristButton label="✕" glyph x={CANCEL_X} y={0} width={ICON} height={ICON} tone="danger" opacity={buttonOpacity} onTap={cancel} />
          ) : null}
        </group>
      )}

      {/* BELOW EVERYTHING, deliberately outside the grid. A notice arrives
          unbidden — a failed send, a microphone that would not open — and if it
          joined a column it would jog every button in it at the exact moment
          you were reaching for one. */}
      {/* NOT WHILE FIXING WHAT YOU SAID: the editor shows the whole draft, and
          this line, placed for the closed controls, landed on its buttons —
          Baiwei: "Whatever I have said is hovering over the settings above
          the keyboard, so they overlap." */}
      {said && !fixing ? (
        <WristButton
          label={said}
          tone={updateOffered || (!notice && listening) ? "live" : "muted"}
          // WHILE RECORDING OR SENDING, A STATUS AND NOTHING ELSE. Nikk (5158):
          // it "can be like touched with your cursor. We don't need that, that
          // should be see-through for your cursor". A notice or a draft stays
          // pressable, since pressing those does something.
          passThrough={!lineActionable}
          y={open ? -menuHalfHeight - 0.08 : -ICON / 2 - 0.035 - STATUS.height / 2}
          width={open ? 0.9 : STATUS.width}
          height={open ? WRIST_BUTTON.height : STATUS.height}
          onTap={() => {
            // Tapping the draft adds to it; tapping a notice dismisses it. The
            // recording status is not a notice and a tap does nothing to it.
            if (!lineActionable) return;
            if (updateOffered) reloadNow();
            // THE WHOLE DRAFT, TO FIX — not the Quest keyboard, which opens
            // empty and can only add to it.
            else startFixing();
          }}
        />
      ) : null}
      </group>
    </>
  );
}
