/**
 * What this browser ACTUALLY offers for speech, said out loud into the journal.
 *
 * WHY MEASURE INSTEAD OF READING. Nikk presses a button on the XREAL Aura and
 * speaks and it works, because that browser has Web Speech recognition. Quest
 * Browser is widely documented not to — and equally widely documented not to
 * have `speechSynthesis`, which it has had since version 40.1. Meta's own
 * advice is to feature-detect rather than infer from the user agent, because
 * what the headset can do changes between releases and nothing announces it.
 *
 * I cannot put a headset on. So rather than build a transcription service on a
 * guess about a browser I cannot open, the room says what it found the moment
 * somebody enters it, and the answer arrives in the journal from the exact
 * build on the exact device. One sentence, once per page.
 *
 * It also reports what a fallback would need — a microphone, a recorder, and a
 * format the recorder will produce — so the decision between "the button
 * already works" and "we have to transcribe it ourselves" is made from one
 * line instead of an afternoon.
 */

type ReportScope = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: { getVoices?(): { name?: string; lang?: string }[] };
  SpeechSynthesisUtterance?: unknown;
  MediaRecorder?: { isTypeSupported?(type: string): boolean };
  navigator?: { mediaDevices?: unknown; userAgent?: string };
};

/** The formats worth knowing about, best first for a transcriber's sake. */
const FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];

export function voiceReport(scope: ReportScope = globalThis as ReportScope): string {
  const recognition = Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
  const which = scope.SpeechRecognition
    ? "SpeechRecognition"
    : scope.webkitSpeechRecognition
      ? "webkitSpeechRecognition"
      : "neither";
  const synthesis = Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
  let voices = -1;
  try {
    voices = scope.speechSynthesis?.getVoices?.().length ?? -1;
  } catch {
    voices = -1;
  }
  const recorder = typeof scope.MediaRecorder === "function" || Boolean(scope.MediaRecorder);
  const formats = recorder
    ? FORMATS.filter((type) => {
        try {
          return scope.MediaRecorder?.isTypeSupported?.(type) ?? false;
        } catch {
          return false;
        }
      })
    : [];
  return [
    `speech here: recognition ${recognition ? `YES (${which})` : "NO"}`,
    `synthesis ${synthesis ? "yes" : "no"} (${voices < 0 ? "voices unknown" : `${voices} voices`})`,
    `microphone ${scope.navigator?.mediaDevices ? "yes" : "no"}`,
    `recorder ${recorder ? (formats.length ? formats.join(" ") : "yes, no known format") : "no"}`,
  ].join("; ");
}
