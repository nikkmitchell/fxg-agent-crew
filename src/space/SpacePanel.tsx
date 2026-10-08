import type { FinishedSpace } from "../../shared/finished-spaces";
import { useFinishedRoom } from "./modules/use-finished";
import { inFrontOf, useLibrary } from "./modules/use-library";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import { markInXr } from "../client-errors";
import { useSpaceSocket } from "./useSpaceSocket";
import { DEFAULT_COMFORT, type Comfort } from "./comfort";
import { RoomLoading } from "./RoomLoading";
import { requestRoomMenu } from "./room-menu";
import { provideRoomGo } from "./room-go";
import { FullScreenButton } from "./FullScreenButton";
import { VoiceControls } from "./VoiceControls";
import { usePanelChoices } from "./usePanelChoices";
import { usePanelArrange } from "./usePanelArrange";
import { meterVoices } from "./voice-mouth";
import { useVoiceChat } from "./useVoiceChat";
import { base, pathForTab } from "../router";
import { useRoomPreferences } from "./room-preferences";
import { useHiddenAsStill } from "./useHiddenAsStill";
import { takeCrumb } from "./left-crumb";
import { useHeadsetAvailable } from "./useHeadsetAvailable";
import { bff } from "../bff-client";
import { ApiError } from "../api-request";
import { useAvatarRecorder } from "./useAvatarRecorder";
import { isLobby } from "../../shared/lobby-hall";
import { microphonePermission, selfMuted, shouldStartVoice } from "./voice-default";
import { inSession } from "../update-reload";

/**
 * The way in to screen sharing, on the website rather than only in a terminal.
 *
 * Nikk: "how do i open that again? maybe it should be on the website, so it's
 * easy to open for anyone". The share page was reachable only by knowing its
 * address or by an agent running a tool, which is to say not reachable.
 *
 * A NEW TAB, not a navigation. The page asks the browser for a screen, and the
 * room you came from should still be here — especially since the window you
 * share may well be this one.
 */
function ShareScreenLink() {
  return (
    <section className="space-voice">
      <h2>Share a screen</h2>
      <a className="primary-action" href={`${base}/share.html`} target="_blank" rel="noopener noreferrer">
        Open screen sharing
      </a>
      <p className="muted-note">
        Share your own screen, or one for an agent. A person's hangs above the boards; an agent's
        sits in front of the agent while it works at its desk. Updated about once a second, and
        nothing is recorded.
      </p>
    </section>
  );
}

/**
 * The Space tab.
 *
 * THE LAZY BOUNDARY IS NOT OPTIONAL. Three.js is roughly four times the size of
 * this entire app, and nobody reading the task board should download a renderer
 * to do it. `Scene` is the only module that imports three, and it is only
 * imported from here, behind `lazy` — measured after each build rather than
 * assumed, because the way this breaks is silent: one stray top-level import
 * pulls the whole thing back into the main chunk and everything still works.
 */
const Scene = lazy(() => import("./Scene"));
/** Also behind the boundary: it imports the XR store, and that pulls in WebXR. */
const HeadsetControls = lazy(() => import("./HeadsetControls"));
const EnterHeadsetButton = lazy(() =>
  import("./HeadsetControls").then((module) => ({ default: module.EnterHeadsetButton })),
);

/**
 * The scene ignores CSS, so reduced motion has to be asked for directly.
 *
 * `src/styles.css` turns animation off globally with a media query, which a
 * requestAnimationFrame loop does not see at all. Without this the 3D tab would
 * quietly break a promise the rest of the app keeps.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * What has been said, in writing.
 *
 * A line over somebody's head goes away after half a minute, and a spoken reply
 * may never have been heard at all — synthesis can fail, be muted, or not exist
 * in the browser. This is the copy that does not disappear.
 *
 * `detail` is shown behind a disclosure rather than inline. It is the long half
 * that is deliberately never spoken, and putting it in the flow would undo the
 * point of capping what gets said aloud.
 */

export function SpacePanel({ startEntered = false, onReturnToLobby }: { startEntered?: boolean; onReturnToLobby: () => void }) {
  /**
   * `startEntered` comes from the front door: pressing Enter there should land
   * you in the 3D view, not on a second Enter button.
   *
   * INITIAL STATE ONLY. The prop is not watched, so nothing can shove somebody
   * into the room after they have left it — `setEntered(false)` from inside
   * stays false even while the door's flag is still true.
   */
  const [entered, setEntered] = useState(startEntered);
  /** The 3D view's box: what the full-screen button fills the screen with, its buttons included (Nikk 7448). */
  const canvasBox = useRef<HTMLDivElement>(null);
  const [directEntryTrouble, setDirectEntryTrouble] = useState<string | null>(null);
  const [checkingDirectEntry, setCheckingDirectEntry] = useState(false);
  const enterFromDirectLink = async () => {
    if (checkingDirectEntry) return;
    setCheckingDirectEntry(true);
    setDirectEntryTrouble(null);
    try {
      await bff.currentSpaceRoom();
      setEntered(true);
    } catch (error) {
      setDirectEntryTrouble(error instanceof ApiError && error.code === "ROOM_NOT_SELECTED"
        ? "Choose a room at the front door before entering its space."
        : "The room could not be confirmed. Please try again.");
    } finally {
      setCheckingDirectEntry(false);
    }
  };
  const [spaceRoomName, setSpaceRoomName] = useState<string | null>(null);
  const [spaceRoomTrouble, setSpaceRoomTrouble] = useState<string | null>(null);
  const [spaceRoomRevision, setSpaceRoomRevision] = useState(0);
  useEffect(() => {
    if (!entered) return;
    const controller = new AbortController();
    setSpaceRoomTrouble(null);
    void bff.currentSpaceRoom(controller.signal).then(({ roomName }) => {
      if (!controller.signal.aborted) setSpaceRoomName(roomName);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setSpaceRoomName(null);
        setSpaceRoomTrouble("Could not verify which chat matches this space. Room chat and posting are paused.");
      }
    });
    return () => controller.abort();
  }, [entered, spaceRoomRevision]);
  const systemPrefersReduced = useReducedMotion();
  /**
   * The system preference is the DEFAULT, not the verdict.
   *
   * Someone who is fine with a slow room but not with a spinning one, or who
   * turned the OS setting on years ago for something else, should be able to
   * decide here. It also makes the behaviour checkable: a media query cannot be
   * toggled from outside the browser, so without this control the reduced path
   * could only ever be read, never watched.
   */
  // The override's switch went with the side column (Nikk: everything is in ⚙ Settings now).
  const [reducedOverride] = useState<boolean | null>(null);
  const reducedMotion = reducedOverride ?? systemPrefersReduced;
  useRoomPreferences();
  const connection = useSpaceSocket(entered, spaceRoomRevision);
  /**
   * Switch rooms WITHOUT LEAVING THE ROOM PAGE, or the headset (Nikk, 4735).
   * The server moves this session to the other room (and closes its old
   * socket); bumping the revision re-reads which room this is, which also
   * points the chat at it, and reopens the socket in the new room.
   */
  const switchRoom = useCallback(async (roomName: string) => {
    await bff.enterSpaceRoom(roomName);
    setSpaceRoomRevision((revision) => revision + 1);
  }, []);
  // A thing's door (ctx.rooms.go): the same in-place switch; a public room not yet joined is joined first.
  useEffect(
    () =>
      provideRoomGo(async (roomName) => {
        try {
          await switchRoom(roomName);
        } catch {
          await bff.joinRoom(roomName);
          await switchRoom(roomName);
        }
      }),
    [switchRoom],
  );
  useHiddenAsStill(
    connection.peopleRef,
    connection.status.state === "open" ? connection.status.you : null,
  );
  const [comfort, setComfort] = useState<Comfort>(DEFAULT_COMFORT);
  const [inHeadset, setInHeadset] = useState(false);
  // So an error report says whether it happened in the headset.
  useEffect(() => markInXr(inHeadset), [inHeadset]);
  // The room's open set is fed in from the socket, so a panel somebody else
  // closes closes here too rather than on the next reload.
  const panels = usePanelChoices(entered, connection.openPanels);
  const arrange = usePanelArrange();
  const [, setPanelTrouble] = useState<string | null>(null);
  /**
   * Live voice, held HERE rather than inside the scene.
   *
   * The scene unmounts and remounts — entering a headset session, the lazy
   * chunk loading — and a microphone that closed and reopened every time would
   * be both alarming and useless. This outlives all of it.
   */
  const voice = useVoiceChat(
    connection.send,
    connection.subscribe,
    connection.status.state === "open" ? connection.status.you : null,
    // Everyone who could be listening: people with the room open. Agents have
    // no ears in a browser.
    connection.roster.filter((person) => person.connected && person.kind !== "agent").map((person) => person.actorId),
  );
  // Mouths move with voices: meter every call, and your own microphone while
  // it is on (voice-mouth.ts).
  const meYou = connection.status.state === "open" ? connection.status.you : null;
  useFinishedRoom(spaceRoomName);
  // THE LIBRARY (src/space/modules): things from spaces' git, brought into this room.
  useLibrary({
    enabled: entered && connection.status.state === "open",
    roomSpace: spaceRoomName ? spaceRoomName.toLowerCase() : null,
    roomItems: connection.roomItems,
    applyRoomItem: connection.applyRoomItem,
    removeRoomItem: connection.removeRoomItem,
    inFront: () => inFrontOf(connection.peopleRef.current ?? [], meYou),
  });
  useEffect(() => {
    meterVoices(voice.streams, meYou, voice.on ? voice.microphone() : null);
  }, [voice.streams, voice.on, voice.microphone, meYou]);
  useEffect(() => () => meterVoices(new Map(), null, null), []);
  /**
   * VOICE ON FROM THE START (Nikk): see voice-default.ts. Once per page, as
   * soon as the room knows who you are, and asked here on the flat page —
   * never from inside a headset session unless the microphone is already
   * allowed.
   */
  const voiceNow = useRef(voice);
  voiceNow.current = voice;
  const voiceDecided = useRef(false);
  const voiceYou = connection.status.state === "open" ? connection.status.you : null;
  useEffect(() => {
    if (!entered || !voiceYou || voiceDecided.current) return;
    let cancelled = false;
    void microphonePermission().then((permission) => {
      if (cancelled || voiceDecided.current) return;
      voiceDecided.current = true;
      const now = voiceNow.current;
      if (shouldStartVoice({ selfMuted: selfMuted(), alreadyOn: now.on || now.starting, immersive: inSession(), permission })) now.setOn(true);
    });
    return () => {
      cancelled = true;
    };
  }, [entered, voiceYou]);
  const avatarRecorder = useAvatarRecorder(connection.status.state === "open" ? connection.status.you : null, voice.microphone, voice.on, () => connection.peopleRef.current ?? [], () => voice.streams, () => voice.muted);

  const welcomeAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (!isLobby(spaceRoomName) || connection.status.state !== "open" || avatarRecorder.welcomeCompleted || !avatarRecorder.published.length || welcomeAttempted.current === connection.status.you) return;
    welcomeAttempted.current = connection.status.you;
    avatarRecorder.playWelcome();
  }, [spaceRoomName, connection.status, avatarRecorder.welcomeCompleted, avatarRecorder.published, avatarRecorder.playWelcome]);

  useEffect(() => {
    if (!isLobby(spaceRoomName) && avatarRecorder.status === "recording") void avatarRecorder.stop();
    if (!isLobby(spaceRoomName) && avatarRecorder.playing) avatarRecorder.stopPlayback();
    if (!isLobby(spaceRoomName)) welcomeAttempted.current = null;
  }, [spaceRoomName, avatarRecorder.status, avatarRecorder.stop, avatarRecorder.playing, avatarRecorder.stopPlayback]);

  /**
   * WHAT THE PAGE BEFORE THIS ONE DID NOT GET TO SAY.
   *
   * Reported from HERE and not from the scene, because somebody thrown out of a
   * headset session lands exactly here — on the flat page — and a crumb only
   * the scene could read would sit unreported until they put the headset back
   * on. See left-crumb.ts for why a note alone cannot do this job.
   */
  const crumbSent = useRef(false);
  useEffect(() => {
    if (crumbSent.current || connection.status.state !== "open") return;
    const note = takeCrumb();
    crumbSent.current = true;
    if (note) connection.send({ type: "note", note });
  }, [connection]);

  /**
   * Is there a headset to enter?
   *
   * The probe moved to useHeadsetAvailable so the HOME PAGE can ask the same
   * question and get the same answer. It is not a one-liner — it keeps asking
   * for a minute because a Quest took twenty seconds to say yes, and it never
   * un-says it — and two copies of that would be two answers that can
   * disagree.
   *
   * `entered` restarts it: entering loads the chunk that can conjure an
   * emulated device on localhost.
   */
  const headsetAvailable = useHeadsetAvailable(entered);

  if (!entered) {
    return (
      <section className="space-intro">
        {systemPrefersReduced ? (
          <p className="muted-note">
            Your system asks for reduced motion, so the room will redraw only when something
            happens rather than continuously. Other people will snap between positions instead of
            walking. You can change that once you are inside.
          </p>
        ) : null}

        <button type="button" className="primary-action" disabled={checkingDirectEntry} onClick={() => void enterFromDirectLink()}>
          {checkingDirectEntry ? "Checking the room…" : "Enter the room"}
        </button>
        <button type="button" className="text-button" onClick={onReturnToLobby}>Back to lobby · choose a room</button>
        {directEntryTrouble ? <p className="space-room-trouble" role="alert">{directEntryTrouble} <a href={pathForTab("home")}>Choose a room</a></p> : null}

        <ShareScreenLink />

        {/* SAID BEFORE ENTERING, not after.
            The headset button used to appear only once you were already inside
            the flat view, in a panel beside it — so on a desktop there was no
            sign immersive mode existed at all, and in a headset you had to
            walk through the window version to find the door. */}
        {headsetAvailable === true ? (
          <p className="muted-note">
            This browser supports immersive VR. Enter the room and the
            <strong> Enter in your headset</strong> button is right above the room, in the middle.
          </p>
        ) : headsetAvailable === false ? (
          <p className="muted-note">
            No immersive VR support reported yet, so there is no headset button — open this same
            page in a headset&rsquo;s own browser for that. On a Quest the answer can take twenty
            seconds or so to arrive, and the button will appear on its own if it does.
          </p>
        ) : null}
      </section>
    );
  }

  const status = connection.status;

  return (
    <section className="space-panel">
      <p className="space-room-label">
        {spaceRoomName ? <>In <strong>{spaceRoomName}</strong></> : "In the selected room"}
        <button type="button" className="text-button room-return-lobby" onClick={onReturnToLobby}>
          Back to lobby · switch rooms
        </button>
      </p>
      {spaceRoomTrouble ? <p className="space-room-trouble" role="alert">{spaceRoomTrouble} <button type="button" onClick={() => setSpaceRoomRevision((n) => n + 1)}>Retry</button></p> : null}
      {/* HEADSET, ABOVE THE VIEW AND CENTRED — see EnterHeadsetButton.
          Offered only when the browser says immersive-vr is actually
          supported. A button that can only fail is worse than no button, and
          "nothing happened" is the least debuggable outcome there is. */}
      {headsetAvailable ? (
        <div className="space-enter-bar">
          <Suspense fallback={null}>
            <EnterHeadsetButton inHeadset={inHeadset} />
          </Suspense>
        </div>
      ) : null}
      <div className="space-canvas" ref={canvasBox}>
        <div className="space-canvas-buttons">
          <FullScreenButton target={canvasBox} />
          <button type="button" className="space-menu-button" onClick={requestRoomMenu}>⚙ Settings</button>
        </div>
        {/* A crash in the 3D scene is reported and offers a way back, rather
            than blanking the whole page (and ending a headset session). */}
        <ErrorBoundary where="scene">
        <Suspense
          fallback={
            <RoomLoading what="Downloading the 3D code — about a megabyte, once per visit." />
          }
        >
          <Scene
            avatarRecorder={avatarRecorder}
            connection={connection}
            spaceRoomName={spaceRoomName}
            reducedMotion={reducedMotion}
            comfort={comfort}
            onImmersiveChange={setInHeadset}
            onReturnToLobby={onReturnToLobby}
            onSwitchRoom={switchRoom}
            inHeadset={inHeadset}
            panels={panels}
            arrange={arrange}
            onPanelTrouble={setPanelTrouble}
            voice={voice}
          />
        </Suspense>
        </ErrorBoundary>

        {/* Connecting gets the big treatment too: until the socket is open the
            room has nobody in it, including you, and a small grey line in the
            corner does not distinguish that from a scene that failed. */}
        {status.state === "connecting" ? (
          <RoomLoading what="Connecting to the room." />
        ) : null}

        {status.state !== "open" && status.state !== "connecting" ? (
          <div className="space-overlay">
            {status.state === "refused" ? (
              <p>
                The room refused the connection: {status.reason}. Nothing is being shown, which is
                better than a room that looks empty when it is not.
              </p>
            ) : null}
            {status.state === "closed" ? (
              <p>
                Disconnected.{" "}
                {status.retryInSeconds === null
                  ? "Reconnecting."
                  : `Reconnecting in about ${status.retryInSeconds}s.`}{" "}
                Anyone still in the room is no longer being drawn.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="space-roster">
        {isLobby(spaceRoomName) ? (
          <section className="space-voice" aria-label="Avatar recorder settings">
            <h2>Avatar recording</h2>
            <p className="muted-note">Record lobby movement and your microphone for as long as you need. Each take is a separate clip saved in this browser.</p>
            <label><input type="checkbox" checked={avatarRecorder.allowInOthersClips} onChange={(event) => void avatarRecorder.setRecordingConsent(event.target.checked)} /> Allow others to include my avatar and voice in tutorial clips</label>
            <label><input type="checkbox" checked={avatarRecorder.includeHumans} disabled={avatarRecorder.status !== "idle"} onChange={(event) => avatarRecorder.setIncludeHumans(event.target.checked)} /> Include other humans</label>
            <label><input type="checkbox" checked={avatarRecorder.includeAgents} disabled={avatarRecorder.status !== "idle"} onChange={(event) => avatarRecorder.setIncludeAgents(event.target.checked)} /> Include agents</label>
            <p className="muted-note">Only people and agents who allowed recording will be included.</p>
            <label>
              <input type="checkbox" checked={avatarRecorder.showPersonalUi} disabled={avatarRecorder.status !== "idle"} onChange={(event) => avatarRecorder.setShowPersonalUi(event.target.checked)} />
              Show personal UI in replay
            </label>
            <div>
              {avatarRecorder.takes.length ? <label>Browser clips <select value={avatarRecorder.take?.id ?? ""} onChange={(event) => avatarRecorder.selectTake(event.target.value)}>{avatarRecorder.takes.map((clip) => <option key={clip.id} value={clip.id}>{clip.title ?? "First recording"}</option>)}</select></label> : null}
              {avatarRecorder.status === "recording" ? (
                <button type="button" className="primary-action" onClick={() => void avatarRecorder.stop()}>Stop recording</button>
              ) : (
                <button
                  type="button"
                  className="primary-action"
                  disabled={avatarRecorder.status !== "idle" || status.state !== "open"}
                  onClick={() => {
                    if (status.state !== "open") return;
                    const body = connection.roster.find((person) => person.actorId === status.you)?.body ?? null;
                    void avatarRecorder.start(status.you, body);
                  }}
                >{avatarRecorder.status === "idle" ? "Record avatar + voice" : avatarRecorder.status === "uploading" ? "Uploading clip…" : "Preparing recording…"}</button>
              )}
              {avatarRecorder.take ? (
                <>
                  <form key={avatarRecorder.take.id} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void avatarRecorder.rename(String(data.get("title") ?? "")); }}><label>Clip name <input name="title" maxLength={120} defaultValue={avatarRecorder.take.title ?? "First recording"} /></label><button type="submit">Save name</button></form>
                  <button type="button" onClick={() => avatarRecorder.playing ? avatarRecorder.stopPlayback() : void avatarRecorder.play()}>
                    {avatarRecorder.playing ? "Stop preview" : "Play in lobby"}
                  </button>
                  <button type="button" disabled={avatarRecorder.status !== "idle"} onClick={() => void avatarRecorder.discard()}>Discard draft</button>
                  {avatarRecorder.canPublish ? <button type="button" disabled={avatarRecorder.status !== "idle"} onClick={() => void avatarRecorder.publish()}>Upload tutorial to server</button> : null}
                </>
              ) : null}
              {avatarRecorder.canPublish && avatarRecorder.uploadedClips.length ? <><label>Server clips <select value={avatarRecorder.uploadedClip?.id ?? ""} onChange={(event) => avatarRecorder.selectUploadedClip(event.target.value)}>{avatarRecorder.uploadedClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.title}</option>)}</select></label><button type="button" onClick={() => avatarRecorder.playUploaded()}>Play uploaded copy</button><button type="button" onClick={() => void avatarRecorder.setClipActive(!avatarRecorder.uploadedClip?.active)}>{avatarRecorder.uploadedClip?.active ? "Remove from first-visit welcome" : "Add to first-visit welcome"}</button><button type="button" onClick={() => void avatarRecorder.unpublish()}>Remove uploaded tutorial</button></> : null}
              {avatarRecorder.published.length ? <button type="button" onClick={() => avatarRecorder.playWelcome()}>Replay welcome tutorials</button> : null}
              {!avatarRecorder.welcomeCompleted && avatarRecorder.published.length ? <><p role="status">Welcome to the lobby. Play the published tutorials.</p><button type="button" className="primary-action" onClick={() => avatarRecorder.playWelcome()}>Play welcome</button><button type="button" onClick={() => avatarRecorder.finishWelcome()}>Skip welcome</button></> : null}
            </div>
            {avatarRecorder.status === "recording" ? <p role="status">Recording movement and audio…</p> : null}
            {avatarRecorder.notice ? <p role="status">{avatarRecorder.notice}</p> : null}
          </section>
        ) : null}
        {/* The headset's settings stay beside the view; the button is above it. */}
        {headsetAvailable === null ? null : headsetAvailable ? (
          <Suspense fallback={null}>
            <HeadsetControls comfort={comfort} setComfort={setComfort} />
          </Suspense>
        ) : (
          <p className="muted-note">
            This browser reports no immersive VR support, so there is no headset button. The room
            works the same in the window.
          </p>
        )}

        {/* Only speaking and writing stay beside the view (Nikk): everything else is in ⚙ Settings. */}
        <VoiceControls connection={connection} />
      </aside>
    </section>
  );
}

/** Inside a finished space: what it is, and bringing it up to its branch's newest version (shared/finished-spaces.ts). */
export function FinishedNote({ finished }: { finished: FinishedSpace }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section className="space-voice" aria-label="Finished space">
      <h2>{finished.title}</h2>
      <p className="muted-note">
        A finished space: {finished.space}&apos;s {finished.entry} ({finished.branch}), as published by {finished.by}. Its work
        controls are hidden; a push changes it only when it is updated.
      </p>
      <button
        type="button"
        onClick={() => {
          setNotice("Updating…");
          bff.updateFinished(finished.room)
            .then(() => setNotice("Updated to the newest version."))
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not update it."));
        }}
      >
        Update to the newest version
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
