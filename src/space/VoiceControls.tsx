import { useEffect, useRef, useState } from "react";
import { DETAIL_LIMIT, SPOKEN_LIMIT, type Utterance, type UtteranceInput } from "../../shared/voice";
import type { SpaceConnection } from "./useSpaceSocket";
import { createSpeechInput, speakSay, speechCapabilities, type SpeechInput, type SpeechOutput } from "./speech";

type ErrorBody = { error?: string };

export function shouldSpeakUtterance(utterance: Utterance, you: string | null): boolean {
  return Boolean(
    you &&
    utterance.actorId !== you &&
    utterance.to === you &&
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
  const [speaking, setSpeaking] = useState(false);
  const [hearReplies, setHearReplies] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<SpeechInput | null>(null);
  const outputRef = useRef<SpeechOutput | null>(null);
  const consideredUtteranceRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current = createSpeechInput({
      onPhase: (phase) => setListening(phase === "listening"),
      onInterim: setInterim,
      onFinal: (result) => {
        setDraft(result.text);
        setSource("voice");
        setConfidence(result.confidence);
        setNotice("Transcript ready. Review it before sending.");
      },
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => inputRef.current?.dispose();
  }, []);

  useEffect(() => {
    outputRef.current?.cancel();
    outputRef.current = null;
    const utterance = connection.liveUtterance;
    if (!utterance || consideredUtteranceRef.current === utterance.id) return;
    // Mark it even while playback is off or the microphone is open. Enabling
    // sound later must not unexpectedly read an older line, and the speaker
    // must never feed a reply back into active recognition.
    consideredUtteranceRef.current = utterance.id;
    if (!hearReplies || listening || !shouldSpeakUtterance(utterance, you)) return;
    outputRef.current = speakSay({
      say: utterance.say ?? "",
      onPhase: (phase) => setSpeaking(phase === "speaking"),
      onFailure: (failure) => setNotice(failure.message),
    });
    return () => outputRef.current?.cancel();
  }, [connection.liveUtterance, hearReplies, listening, you]);

  const send = async () => {
    const words = draft.trim();
    if (!words || sending || overLimit || recipientMissing) return;
    setSending(true);
    setNotice(null);
    const utterance: UtteranceInput = {
      ...(source === "voice" ? { say: words } : { detail: words }),
      ...(to ? { to } : {}),
      source,
      ...(source === "voice" && confidence !== undefined ? { confidence } : {}),
    };
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/bff/space/utterances`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(utterance),
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody;
      if (!response.ok) throw new Error(body.error ?? `The room refused this (${response.status}).`);
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

  const limit = source === "voice" ? SPOKEN_LIMIT : DETAIL_LIMIT;
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
          onClick={() => listening ? inputRef.current?.stop() : inputRef.current?.start()}
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
        {draft.length} / {limit} characters{source === "voice" ? " spoken" : " written"}
      </p>
      {source === "voice" ? (
        <button type="button" className="text-button" disabled={sending} onClick={() => {
          setSource("text");
          setConfidence(undefined);
          setNotice("This draft will be sent as written detail and will not be read aloud.");
        }}>Send as written text instead</button>
      ) : null}
      {overLimit ? <p role="status">Shorten this draft{source === "voice" ? " or send it as written text" : ""} before sending. Your words have been kept.</p> : null}

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

      {capabilities.synthesis ? (
        <label className="space-setting">
          <input
            type="checkbox"
            checked={hearReplies}
            onChange={(event) => setHearReplies(event.currentTarget.checked)}
          />
          <span>Read short replies addressed to me aloud</span>
        </label>
      ) : (
        <p className="muted-note">This browser cannot read replies aloud. They remain in the transcript.</p>
      )}
      <p className="muted-note">Replies addressed to the room stay in the transcript and are not read aloud.</p>
      <p className="space-voice-state" aria-live="polite">
        {listening ? "Listening — nothing is sent until you review it." : speaking ? "Speaking." : notice}
      </p>
    </section>
  );
}
