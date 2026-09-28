import { useEffect, useRef, useState } from "react";
import { GUIDES, GUIDE_IDS, GUIDE_VOICE_CHOICES, guideCaption, guideLineAt, isGuideVoiceChoice, type GuideId, type GuideVoiceChoice } from "../shared/guided";
import { breathAt, idleMeditation, PHASE_WORDS } from "../shared/meditation";
import { base } from "./router";

/**
 * THE GUIDED MEDITATIONS, WITHOUT A HEADSET: /meditate.
 *
 * Every guide in meditation.AR is a script of lines voiced on the server
 * (shared/guided.ts). They only played inside the 3D room, so doing one needed
 * a headset or the 3D view. This page plays the same voiced lines, on the
 * same timetable, with the caption and a breathing circle, so a guide works
 * from a phone on the bus. Solo: the room's shared clock is for being there
 * together; this one starts when you press it.
 */
export function MeditatePage() {
  const [guide, setGuide] = useState<GuideId>("arrive");
  const [voice, setVoice] = useState<GuideVoiceChoice>(() => {
    try {
      const kept = localStorage.getItem("orb-guide-voice");
      return isGuideVoiceChoice(kept) ? kept : GUIDE_VOICE_CHOICES[0].id;
    } catch { return GUIDE_VOICE_CHOICES[0].id; }
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const spoken = useRef(-1);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Set when the voice would not load: the captions still carry the guide. */
  const [voiceless, setVoiceless] = useState(false);

  const session = startedAt === null ? null : { ...idleMeditation(), pattern: "calm" as const, minutes: GUIDES[guide].minutes, startedAt, guide };
  const breath = session ? breathAt(session, now) : null;
  const elapsed = breath?.state === "breathing" ? breath.elapsed : 0;

  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  // Each line once, when the timetable reaches it.
  useEffect(() => {
    if (breath?.state !== "breathing") return;
    const due = guideLineAt(guide, breath.elapsed);
    if (!due || due.index <= spoken.current) return;
    spoken.current = due.index;
    audio.current?.pause();
    const url = `${base}/bff/space/guides/${guide}/${due.index}/audio?voice=${voice}`;
    // Two more tries, two seconds apart, as the orb does: right after a
    // release the server may still be voicing lines. After that, say so.
    const attempt = (left: number) => {
      const next = new Audio(url);
      audio.current = next;
      next.onplaying = () => setVoiceless(false);
      next.onerror = () => {
        if (audio.current !== next) return;
        if (left > 0) window.setTimeout(() => { if (audio.current === next) attempt(left - 1); }, 2000);
        else setVoiceless(true);
      };
      void next.play().catch(() => undefined);
    };
    attempt(2);
  });

  useEffect(() => () => audio.current?.pause(), []);

  const start = () => {
    spoken.current = -1;
    setNow(Date.now());
    setStartedAt(Date.now());
  };
  const stop = () => {
    audio.current?.pause();
    setStartedAt(null);
  };

  const running = breath?.state === "breathing";
  const done = breath?.state === "done";
  const size = running ? 90 + 110 * breath.fullness : 120;
  const caption = running ? guideCaption(guide, elapsed) : null;
  const left = running ? Math.ceil(breath.remaining) : 0;

  return (
    <section className="meditate-page" aria-label="Guided meditations">
      <h1>Guided meditations</h1>
      <p className="muted-note">
        The same guides as the breathing orb in meditation.AR, spoken in the room&rsquo;s own voice. Put the phone down, breathe with the circle.
      </p>

      {!running ? (
        <>
          <div className="meditate-choices" role="radiogroup" aria-label="Guide">
            {GUIDE_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={guide === id}
                className={guide === id ? "primary-action" : "text-button"} onClick={() => setGuide(id)}>
                {GUIDES[id].label}
              </button>
            ))}
          </div>
          {!(GUIDES[guide] as { voice?: string }).voice && (
            <label className="meditate-voice">
              Voice{" "}
              <select value={voice} onChange={(event) => {
                const next = event.target.value;
                if (!isGuideVoiceChoice(next)) return;
                setVoice(next);
                try { localStorage.setItem("orb-guide-voice", next); } catch { /* per-viewer only */ }
              }}>
                {GUIDE_VOICE_CHOICES.map((one) => <option key={one.id} value={one.id}>{one.label.replace("VOICE: ", "")}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="primary-action" onClick={start}>{done ? "Again" : "Begin"}</button>
          {done && <p>Well done. {GUIDES[guide].minutes} minutes.</p>}
        </>
      ) : (
        <div className="meditate-now">
          <div className="meditate-circle" aria-hidden="true" style={{ width: size, height: size }} />
          <p className="meditate-phase">{PHASE_WORDS[breath.phase]}</p>
          <p className="meditate-caption" aria-live="polite">{caption ?? " "}</p>
          {voiceless && <p className="muted-note" role="status">The voice could not be loaded (are you signed in?). The captions will still guide you.</p>}
          <p className="muted-note">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left · {GUIDES[guide].label}</p>
          <button type="button" className="text-button" onClick={stop}>End</button>
        </div>
      )}
    </section>
  );
}
