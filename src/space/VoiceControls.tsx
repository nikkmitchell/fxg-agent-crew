import { useEffect, useRef, useState } from "react";
import { DETAIL_LIMIT, SPOKEN_LIMIT, splitSpoken, type Utterance, type UtteranceInput } from "../../shared/voice";
import type { SpaceConnection } from "./useSpaceSocket";
import { createSteadyRecorder, speechCapabilities, type SpeechOutput, type SteadyRecorder } from "./speech";
import { queueAloud } from "./said-aloud";
import { space } from "../space-client";
import { holdReload, inSession } from "../update-reload";
import { volumeAt } from "./agent-voice";

/**
 * WHETHER YOU HEAR SOMEBODY SPEAKING IN A ROOM YOU ARE STANDING IN.
 *
 * This used to require `utterance.to === you` — addressed to you BY NAME — so
 * standing next to two people talking was silent, and an agent that said
 * something to nobody in particular was never heard by anybody. Nikk, asked
 * directly: "lets have it read to all, like we are all in the room, so even if
 * an agent is saying something to one person, everyone else should still be
 * able to hear it".
 *
 * `volumeAt(distance)` was already wired for exactly this and had nothing to
 * attenuate: someone far across the room was not quieter, they were absent.
 *
 * Still never your own voice, and still nothing without a `say` — `detail` is
 * written and is not read out by anybody.
 */
export function shouldSpeakUtterance(utterance: Utterance, you: string | null): boolean {
  return Boolean(
    you &&
    utterance.actorId !== you &&
    utterance.say?.trim(),
  );
}

/**
 * Optional browser input and output around the durable written transcript.
 * Recognition never sends automatically. Synthesis is opt-in and receives only
 * a live, explicitly addressed `say` — never history and never `detail`.
 */
export function VoiceControls({ connection }: { connection: SpaceConnection }) {
  const capabilities = speechCapabilities();
  const you = connection.status.state === "open" ? connection.status.you : null;
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"voice" | "text">("text");
  const [confidence, setConfidence] = useState<number | undefined>();
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  // No reload for a new deploy in the middle of a recording.
  useEffect(() => {
    holdReload("voice-microphone", listening);
    return () => holdReload("voice-microphone", false);
  }, [listening]);
  const [speaking, setSpeaking] = useState(false);
  const [hearReplies, setHearReplies] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<SteadyRecorder | null>(null);
  /** Every line queued here and not yet heard end — see queueAloud. */
  const outputRef = useRef(new Set<SpeechOutput>());
  const consideredUtteranceRef = useRef<number | null>(null);

  useEffect(() => {
    // The same steady recorder as the headset: it keeps listening through
    // pauses until "Stop listening" is pressed, and keeps every phrase.
    inputRef.current = createSteadyRecorder({
      onRecording: setListening,
      onText: setInterim,
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => inputRef.current?.dispose();
  }, []);

  /**
   * STOP TALKING THE MOMENT THE MICROPHONE OPENS, or sound is turned off. This
   * used to happen as a side effect of every new line cancelling the last;
   * lines now wait their turn instead (see queueAloud), so it is said plainly:
   * the speaker must never feed a reply back into active recognition.
   */
  useEffect(() => {
    if (!listening && hearReplies) return;
    for (const line of outputRef.current) line.cancel();
    outputRef.current.clear();
  }, [listening, hearReplies]);
  useEffect(() => () => {
    for (const line of outputRef.current) line.cancel();
    outputRef.current.clear();
  }, []);

  useEffect(() => {
    const utterance = connection.liveUtterance;
    if (!utterance || consideredUtteranceRef.current === utterance.id) return;
    // Mark it even while playback is off or the microphone is open. Enabling
    // sound later must not unexpectedly read an older line, and the speaker
    // must never feed a reply back into active recognition.
    consideredUtteranceRef.current = utterance.id;
    // NOT WHILE THE IMMERSIVE ROOM IS SPEAKING. Both are mounted during a
    // headset session and both read utterances, which is one voice too many.
    // See `inSession`.
    if (!hearReplies || listening || inSession() || !shouldSpeakUtterance(utterance, you)) return;
    // In the speaker's own voice, as loud as they are near you. See agent-voice.ts.
    const people = connection.peopleRef.current ?? [];
    const find = (id: string | null) => (id ? people.find((person) => person.actorId.toLowerCase() === id.toLowerCase()) : undefined);
    const speaker = find(utterance.actorId);
    const me = find(you);
    // The box's own rendering of this line, in the speaker's chosen voice, with
    // the browser's synthesiser behind it. See said-aloud.ts.
    // IN TURN, NOT OVER THE TOP: a new line used to cancel the one playing.
    let line: SpeechOutput | null = null;
    line = queueAloud({
      utteranceId: utterance.id,
      say: utterance.say ?? "",
      speaker: utterance.actorId,
      volume: volumeAt(speaker && me ? Math.hypot(speaker.at.x - me.at.x, speaker.at.z - me.at.z) : null),
      onPhase: (phase) => {
        setSpeaking(phase === "speaking");
        if (phase === "idle" && line) outputRef.current.delete(line);
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    outputRef.current.add(line);
  }, [connection.liveUtterance, hearReplies, listening, you]);

  const send = async () => {
    const words = draft.trim();
    if (!words || sending || overLimit || recipientMissing) return;
    setSending(true);
    setNotice(null);
    /**
     * A LONG VOICE DRAFT IS SPLIT, NOT BLOCKED.
     *
     * Over 240 characters this used to disable Send and ask you to "Shorten
     * this draft or send it as written text" — the window panel's copy of the
     * limit the headset and the server had already stopped refusing on. Nikk:
     * "please finish the update so that it doesn't max out on characters in
     * voice messages." The opening sentences are spoken; the rest is written
     * beside them; nothing is lost. See `splitSpoken` for why it cuts at a
     * sentence and never mid-clause.
     */
    const spoken = source === "voice" ? splitSpoken(words) : null;
    const utterance: UtteranceInput = {
      ...(spoken
        ? { ...(spoken.say ? { say: spoken.say } : {}), ...(spoken.detail ? { detail: spoken.detail } : {}) }
        : { detail: words }),
      ...(to ? { to } : {}),
      source,
      ...(source === "voice" && confidence !== undefined ? { confidence } : {}),
    };
    try {
      await space.say(utterance);
      setDraft("");
      setSource("text");
      setConfidence(undefined);
      setNotice("Sent to the room.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The room could not receive this.");
    } finally {
      setSending(false);
    }
  };

  /**
   * ONE CEILING FOR BOTH NOW, the written one. Voice used to be held to the
   * spoken limit here, which blocked anything past eight seconds of speech even
   * though the rest could simply be written down.
   */
  const limit = DETAIL_LIMIT;
  const spokenPreview = source === "voice" ? splitSpoken(draft.trim()) : null;
  const people = connection.roster.filter((person) => person.actorId !== you);
  const recipientMissing = Boolean(to && !people.some((person) => person.actorId === to));
  const overLimit = draft.trim().length > limit;

  return (
    <section className="space-voice" aria-labelledby="space-voice-heading">
      <h2 id="space-voice-heading">Speak or write</h2>
      {capabilities.recognition ? (
        <button
          type="button"
          className="text-button"
          aria-pressed={listening}
          onClick={() => {
            if (!listening) {
              inputRef.current?.start();
              return;
            }
            void (async () => {
              const result = await inputRef.current?.finish();
              setInterim("");
              const text = result?.text.trim() ?? "";
              if (!text) {
                setNotice("Nothing was heard, so nothing was added.");
                return;
              }
              setDraft(text);
              setSource("voice");
              setConfidence(result?.confidence);
              setNotice("Transcript ready. Review it before sending.");
            })();
          }}
          disabled={sending}
        >
          {listening ? "Stop listening" : "Use microphone"}
        </button>
      ) : (
        <p className="muted-note">This browser has no speech recognition. Writing still works.</p>
      )}
      {interim ? <p className="space-voice-interim" aria-live="polite">Hearing: {interim}</p> : null}

      <label>
        <span>{source === "voice" ? "Review the transcript" : "Write to the room"}</span>
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            if (source === "voice") setConfidence(undefined);
          }}
          rows={4}
          disabled={sending}
        />
      </label>
      <p className={draft.length > limit ? "space-voice-count over" : "space-voice-count"}>
        {source === "voice" && spokenPreview?.detail
          ? spokenPreview.say
            ? `${spokenPreview.say.length} characters spoken, ${spokenPreview.detail.length} written`
            : `${draft.trim().length} characters written — one sentence too long to say aloud`
          : `${draft.length} characters${source === "voice" ? " spoken" : " written"}`}
      </p>
      {source === "voice" ? (
        <button type="button" className="text-button" disabled={sending} onClick={() => {
          setSource("text");
          setConfidence(undefined);
          setNotice("This draft will be sent as written detail and will not be read aloud.");
        }}>Send as written text instead</button>
      ) : null}
      {overLimit ? <p role="status">This draft is over {DETAIL_LIMIT.toLocaleString()} characters. Your words have been kept.</p> : null}

      <label>
        <span>Address</span>
        <select value={to} onChange={(event) => setTo(event.currentTarget.value)} disabled={sending}>
          <option value="">The room, nobody in particular</option>
          {recipientMissing ? <option value={to}>{to} — no longer in the roster</option> : null}
          {people.map((person) => <option key={person.actorId} value={person.actorId}>{person.actorId}</option>)}
        </select>
      </label>
      {recipientMissing ? <p role="status">Your selected recipient is no longer in the roster. Choose an address before sending.</p> : null}

      <button type="button" className="primary-action" onClick={() => void send()} disabled={!draft.trim() || sending || overLimit || recipientMissing}>
        {sending ? "Sending…" : "Send after review"}
      </button>

      {/*
        * NEVER GATED ON `capabilities.synthesis` AGAIN. That asks whether the
        * BROWSER can speak; a room utterance is a WAV rendered on the box and
        * played through an Audio element, which every browser has. The
        * browser's own synthesiser is only the fallback.
        *
        * Baiwei, on a Quest 2, into a room that was speaking: "I still cannot
        * hear your voices in my headset." Quest Browser exposes no speech
        * synthesis, so this replaced the checkbox with a sentence saying it
        * could not be done — and `hearReplies` starts false here. Silent, and
        * no control to make it otherwise. The sentence was not just wrong, it
        * was load-bearing.
        */}
      <label className="space-setting">
        <input
          type="checkbox"
          checked={hearReplies}
          onChange={(event) => setHearReplies(event.currentTarget.checked)}
        />
        <span>Read what is said in the room aloud</span>
      </label>
      {/*
        * AND THIS SAID THE OPPOSITE OF WHAT NOW HAPPENS. Room speech used to
        * reach only the person it named; Nikk asked for "read to all, like we
        * are all in the room", so a line addressed to somebody else is read to
        * you too — which is the whole point of the change and was described
        * here as not happening.
        */}
      <p className="muted-note">
        Everything said in the room is read aloud, including lines addressed to somebody else. Chat
        messages are not spoken — only what is said in the room.
      </p>
      <p className="space-voice-state" aria-live="polite">
        {listening ? "Listening — nothing is sent until you review it." : speaking ? "Speaking." : notice}
      </p>
    </section>
  );
}
