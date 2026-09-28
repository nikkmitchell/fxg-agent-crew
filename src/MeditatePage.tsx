import { useEffect, useRef, useState } from "react";
import { GUIDES, GUIDE_IDS, GUIDE_VOICE_CHOICES, guideCaption, guideLineAt, isGuideVoiceChoice, type GuideId, type GuideVoiceChoice } from "../shared/guided";
import { breathAt, clockOffset, idleMeditation, isPattern, PHASE_WORDS, type Meditation } from "../shared/meditation";
import { isGuide } from "../shared/guided";
import { space } from "./space-client";
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
/** The page's own words, in Chinese for a browser set to Chinese (the room is used from Shanghai). */
const WORDS = {
  en: {
    title: "Guided meditations",
    intro: "The same guides as the breathing orb in meditation.AR, spoken in the room\u2019s own voice. Put the phone down, breathe with the circle.",
    running: "A session is running in the room right now", join: "Join it", voice: "Voice",
    begin: "Begin", again: "Again", done: (minutes: number) => `Well done. ${minutes} minutes.`,
    voiceless: "The voice could not be loaded (are you signed in?). The captions will still guide you.",
    left: "left", withRoom: "with the room", end: "End",
    phase: PHASE_WORDS,
  },
  zh: {
    title: "引导冥想",
    intro: "和 meditation.AR 里呼吸光球一样的引导，用房间自己的声音朗读。放下手机，跟着圆圈呼吸。",
    running: "房间里现在正在进行一段冥想", join: "加入", voice: "声音",
    begin: "开始", again: "再来一次", done: (minutes: number) => `做得很好。${minutes} 分钟。`,
    voiceless: "声音无法加载（你登录了吗？）。字幕仍会引导你。",
    left: "剩余", withRoom: "与房间一起", end: "结束",
    phase: { in: "吸气", hold: "屏息", out: "呼气", rest: "休息" },
  },
} as const;
const words = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? WORDS.zh : WORDS.en;

export function MeditatePage() {
  const [guide, setGuide] = useState<GuideId>("arrive");
  const [voice, setVoice] = useState<GuideVoiceChoice>(() => {
    try {
      const kept = localStorage.getItem("orb-guide-voice");
      return isGuideVoiceChoice(kept) ? kept : GUIDE_VOICE_CHOICES[0].id;
    } catch { return GUIDE_VOICE_CHOICES[0].id; }
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /**
   * JOIN THE ROOM'S SESSION. If a session is running on the orb in the room
   * this login is standing in, the page can follow it on the same clock, so
   * someone on a phone breathes with the people in headsets. Server clock
   * minus ours, as the orb does (clockOffset).
   */
  const [roomSession, setRoomSession] = useState<Meditation | null>(null);
  const offset = useRef(0);
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    let alive = true;
    const look = () => {
      const sent = Date.now();
      space.meditation().then((answer) => {
        if (!alive) return;
        offset.current = clockOffset(answer.now, sent, Date.now());
        setRoomSession(answer.meditation);
      }).catch(() => undefined);
    };
    look();
    const timer = window.setInterval(look, 15_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const roomRunning = roomSession && breathAt(roomSession, Date.now() + offset.current).state === "breathing" ? roomSession : null;
  const [now, setNow] = useState(Date.now());
  const spoken = useRef(-1);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Set when the voice would not load: the captions still carry the guide. */
  const [voiceless, setVoiceless] = useState(false);

  const session = joined && roomRunning
    ? roomRunning
    : startedAt === null ? null : { ...idleMeditation(), pattern: "calm" as const, minutes: GUIDES[guide].minutes, startedAt, guide };
  const clock = joined ? now + offset.current : now;
  const breath = session ? breathAt(session, clock) : null;
  const playing: GuideId | null = session && isGuide(session.guide) ? session.guide : null;
  const elapsed = breath?.state === "breathing" ? breath.elapsed : 0;

  useEffect(() => {
    if (startedAt === null && !joined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [startedAt, joined]);

  // Each line once, when the timetable reaches it.
  useEffect(() => {
    if (breath?.state !== "breathing" || !playing) return;
    const due = guideLineAt(playing, breath.elapsed);
    if (!due || due.index <= spoken.current) return;
    spoken.current = due.index;
    audio.current?.pause();
    const url = `${base}/bff/space/guides/${playing}/${due.index}/audio?voice=${voice}`;
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
    setJoined(false);
  };
  const join = () => {
    // Lines already past are not replayed; the next one plays when it comes.
    spoken.current = roomRunning?.guide && isGuide(roomRunning.guide)
      ? (guideLineAt(roomRunning.guide, (breathAt(roomRunning, Date.now() + offset.current) as { elapsed: number }).elapsed, 0)?.index ?? -1)
      : -1;
    setNow(Date.now());
    setJoined(true);
  };

  const running = breath?.state === "breathing";
  const done = breath?.state === "done";
  const size = running ? 90 + 110 * breath.fullness : 120;
  const caption = running && playing ? guideCaption(playing, elapsed) : null;
  const label = playing ? GUIDES[playing].label : session && isPattern(session.pattern) ? `${session.minutes} MIN` : "";
  const left = running ? Math.ceil(breath.remaining) : 0;

  return (
    <section className="meditate-page" aria-label={words.title}>
      <h1>{words.title}</h1>
      <p className="muted-note">
        {words.intro}
      </p>

      {!running && roomRunning && (
        <p className="meditate-room" role="status">
          {words.running}{roomRunning.guide && isGuide(roomRunning.guide) ? ` (${GUIDES[roomRunning.guide].label})` : ""}.{" "}
          <button type="button" className="primary-action" onClick={join}>{words.join}</button>
        </p>
      )}
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
              {words.voice}{" "}
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
          <button type="button" className="primary-action" onClick={start}>{done ? words.again : words.begin}</button>
          {done && <p>{words.done(GUIDES[guide].minutes)}</p>}
        </>
      ) : (
        <div className="meditate-now">
          <div className="meditate-circle" aria-hidden="true" style={{ width: size, height: size }} />
          <p className="meditate-phase">{words.phase[breath.phase]}</p>
          <p className="meditate-caption" aria-live="polite">{caption ?? " "}</p>
          {voiceless && <p className="muted-note" role="status">{words.voiceless}</p>}
          <p className="muted-note">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} {words.left} · {label}{joined ? ` · ${words.withRoom}` : ""}</p>
          <button type="button" className="text-button" onClick={stop}>{words.end}</button>
        </div>
      )}
    </section>
  );
}
