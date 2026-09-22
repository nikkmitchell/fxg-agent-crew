import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Identity } from "../Identity";
import { useSpaceSocket } from "./useSpaceSocket";
import { DEFAULT_COMFORT, type Comfort } from "./comfort";
import { RoomLoading } from "./RoomLoading";
import type { Utterance } from "../../shared/voice";
import { VoiceControls } from "./VoiceControls";
import { Transcript } from "./Transcript";
import { usePanelChoices } from "./usePanelChoices";
import { usePanelArrange } from "./usePanelArrange";
import { placeOf, savePlacement } from "./panel-placement";
import { PANEL_SCALE, scaleOf } from "../../shared/panel-place";
import { useVoiceChat } from "./useVoiceChat";
import { ProjectChooser } from "../ProjectChooser";
import { base } from "../router";
import { setRoomPreferences, useRoomPreferences } from "./room-preferences";
import { useHiddenAsStill } from "./useHiddenAsStill";
import { takeCrumb } from "./left-crumb";
import { useHeadsetAvailable } from "./useHeadsetAvailable";

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

export function SpacePanel({ startEntered = false }: { startEntered?: boolean } = {}) {
  /**
   * `startEntered` comes from the front door: pressing Enter there should land
   * you in the 3D view, not on a second Enter button.
   *
   * INITIAL STATE ONLY. The prop is not watched, so nothing can shove somebody
   * into the room after they have left it — `setEntered(false)` from inside
   * stays false even while the door's flag is still true.
   */
  const [entered, setEntered] = useState(startEntered);
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
  const [reducedOverride, setReducedOverride] = useState<boolean | null>(null);
  const reducedMotion = reducedOverride ?? systemPrefersReduced;
  const preferences = useRoomPreferences();
  const connection = useSpaceSocket(entered);
  const stillNow = useHiddenAsStill(
    connection.peopleRef,
    connection.status.state === "open" ? connection.status.you : null,
  );
  const [comfort, setComfort] = useState<Comfort>(DEFAULT_COMFORT);
  const [inHeadset, setInHeadset] = useState(false);
  // The room's open set is fed in from the socket, so a panel somebody else
  // closes closes here too rather than on the next reload.
  const panels = usePanelChoices(entered, connection.openPanels);
  const arrange = usePanelArrange();
  const [panelTrouble, setPanelTrouble] = useState<string | null>(null);
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
        <p>
          A room you can walk around, with everyone who is currently connected standing in it.
          Positions are live and are not stored: close the tab and you leave, restart the server
          and the room is empty, because after a restart nobody knows where anyone was standing.
        </p>
        <p className="muted-note">
          The panels are the board, the mood boards, who is here, what has been said, chat and
          settings — drawn in the room itself rather than pages hung on a wall. Cards drag between
          columns, tapping one opens it, and you can add a card or a comment without leaving.
        </p>
        {systemPrefersReduced ? (
          <p className="muted-note">
            Your system asks for reduced motion, so the room will redraw only when something
            happens rather than continuously. Other people will snap between positions instead of
            walking. You can change that once you are inside.
          </p>
        ) : null}
        <p className="muted-note">
          Entering downloads about a megabyte of 3D code, which is why it is not loaded until you
          ask. Walk with W A S D or the arrow keys; drag to look around.
        </p>

        <button type="button" className="primary-action" onClick={() => setEntered(true)}>
          Enter the room
        </button>

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
      <div className="space-canvas">
        <Suspense
          fallback={
            <RoomLoading what="Downloading the 3D code — about a megabyte, once per visit." />
          }
        >
          <Scene
            connection={connection}
            reducedMotion={reducedMotion}
            comfort={comfort}
            onImmersiveChange={setInHeadset}
            inHeadset={inHeadset}
            panels={panels}
            arrange={arrange}
            onPanelTrouble={setPanelTrouble}
            voice={voice}
          />
        </Suspense>

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

        <Transcript heard={connection.heard} />

        <VoiceControls connection={connection} />

        {/* TALKING, as opposed to sending words. The audio is a direct
            connection between browsers; saha.ing copies a few kilobytes of
            setup and then gets out of the way. */}
        <section className="space-voice">
          <h2>Talk out loud</h2>
          <button
            type="button"
            className={voice.on ? "primary-action" : "text-button"}
            onClick={() => voice.setOn(!voice.on)}
          >
            {voice.on ? "Microphone is open — click to close it" : "Open your microphone"}
          </button>
          <p className="muted-note">
            {voice.others.length === 0
              ? "Nobody else is talking right now. You will hear anyone who opens their microphone, whether or not yours is open."
              : `Talking now: ${voice.others.join(", ")}.`}
          </p>
          {voice.others.length > 0 ? (
            <ul className="voice-mutes">
              {voice.others.map((name) => {
                const isMuted = voice.muted.has(name.trim().toLowerCase());
                return (
                  <li key={name}>
                    <span>{name}</span>
                    <button type="button" className="text-button" onClick={() => voice.setMuted(name, !isMuted)}>
                      {isMuted ? "Unmute" : "Mute for me"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {voice.trouble ? <p role="status">{voice.trouble}</p> : null}
        </section>

        <ShareScreenLink />

        {/* WHAT IS ON THE ARC, and which project it is showing.
            Both live here rather than on a settings page because in this room
            the panels ARE the tabs: closing one or changing project changes
            what is hanging in front of you, and walking out to a settings page
            to do it is the errand a space is supposed to remove. */}
        <section className="space-panel-picker">
          <h2>Panels</h2>
          <p className="muted-note">
            Shared with everyone in the room — opening or closing one changes it for everybody,
            the same as moving or resizing it.
          </p>
          {panels.catalogue.map((panel) => {
            const open = panels.open.includes(panel.id);
            const place = placeOf(connection.places, panel.id);
            const size = scaleOf(place);
            const resize = (to: number) => {
              const next = Math.min(PANEL_SCALE.max, Math.max(PANEL_SCALE.min, to));
              void savePlacement({ ...place, scale: next }).then(setPanelTrouble);
            };
            return (
              <div key={panel.id} className="space-setting-row">
                <label className="space-setting">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(event) => panels.setOpen(panel.id, event.currentTarget.checked)}
                  />
                  <span>{panel.label}</span>
                </label>
                {/* SIZE, HERE AS WELL AS IN THE ROOM. The reason this pair of
                    buttons existed was that the canvas could not receive a
                    pointer in a window — `occlude="blending"` on the old iframe
                    panels set `pointer-events: none` on it — so resizing by
                    pulling a panel's face was impossible here. The iframes are
                    gone and the canvas takes a mouse again, so the gesture works
                    in both rooms and these are a convenience rather than the
                    only way. Kept because a keyboard can reach them. */}
                {open ? (
                  <span className="space-setting-size">
                    <button
                      type="button"
                      onClick={() => resize(size - 0.2)}
                      disabled={size <= PANEL_SCALE.min + 0.001}
                      aria-label={`Make ${panel.label} smaller`}
                    >
                      −
                    </button>
                    <span aria-live="polite">{Math.round(size * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => resize(size + 0.2)}
                      disabled={size >= PANEL_SCALE.max - 0.001}
                      aria-label={`Make ${panel.label} bigger`}
                    >
                      +
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
          <p className="muted-note">
            Drag the bar along the top of a panel to move it. Where a panel hangs is shared: it
            moves for everyone, and the agents that walk to it follow.
          </p>
          {panels.refusal ? <p role="status">{panels.refusal}</p> : null}
          {panelTrouble ? <p role="status">{panelTrouble}</p> : null}
        </section>

        <ProjectChooser />

        <h2>In the room</h2>
        <label className="space-setting">
          <input
            type="checkbox"
            checked={preferences.rings}
            onChange={(event) => setRoomPreferences({ rings: event.currentTarget.checked })}
          />
          <span>Show the coloured ring under each person and agent (this browser only)</span>
        </label>
        <label className="space-setting">
          <input
            type="checkbox"
            checked={preferences.hideStill}
            onChange={(event) => setRoomPreferences({ hideStill: event.currentTarget.checked })}
          />
          <span>
            Hide anyone who has not moved for 5 minutes (this browser only, never you)
            {preferences.hideStill
              ? stillNow.length > 0
                ? ` — hiding ${stillNow.join(", ")}`
                : " — nobody is that still right now"
              : ""}
          </span>
        </label>
        <label className="space-setting">
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedOverride(event.currentTarget.checked)}
          />
          <span>
            Redraw only when something happens
            {reducedOverride === null && systemPrefersReduced ? " (your system asks for this)" : ""}
          </span>
        </label>
        {status.state === "open" ? (
          <p className="muted-note">You are {status.you}.</p>
        ) : null}
        {connection.roster.length === 0 ? (
          <p className="muted-note">
            Nobody — including you, until the connection is open.
          </p>
        ) : (
          <ul>
            {connection.roster.map((person) => (
              <li key={person.actorId}>
                <Identity username={person.actorId} kind={person.kind ?? undefined} showName />
                {person.because ? (
                  <em className="space-because">{person.because}</em>
                ) : null}
                {person.connected ? null : (
                  // Said in words, not only by a fainter ring in the scene. A
                  // dimmed outline is not something anyone can read reliably,
                  // and the difference between "watching the room" and "put
                  // there by something they did" is worth stating.
                  <em className="space-offline">no live connection</em>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted-note">
          Someone marked <em>no live connection</em> is not watching the room — they are standing
          where something they did puts them, and the line above says what that was. No reason
          means we have no recent record of them acting, which is not the same as idle.
        </p>
      </aside>
    </section>
  );
}
