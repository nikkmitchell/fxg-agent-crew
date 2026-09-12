import { refusalFor, type UtteranceInput } from "../../shared/voice";

/**
 * Where a spoken sentence goes.
 *
 * Nikk, describing the wrist control: "I can set it so that my audio is sent to
 * people in the room, or also to agents, and if it is also sent to agents, then
 * it should go right to the webharness group chat, then everyone will see it".
 *
 * So there are two destinations and they are not alternatives — "agents" is
 * "room" plus a post to the group chat. Kept as a pure function because it is
 * the part that decides what leaves this machine under somebody's name, and
 * that deserves a test rather than a read-through.
 *
 * WHAT IS DELIBERATELY NOT HERE: any attempt to shorten, tidy or re-punctuate a
 * transcript. A transcript is a guess at what somebody said; editing it makes it
 * a guess at what they meant, under their name, with no way for them to hear
 * what actually went out.
 */
export type VoiceDestination = "room" | "room-and-agents";

export type VoicePost =
  | { to: "room"; say: string; confidence?: number }
  | { to: "group-chat"; content: string };

export type VoicePlan = { posts: VoicePost[]; refused: string | null };

/**
 * What to send, and where, for one finished transcript.
 *
 * Returns a refusal instead of posts when there is nothing worth sending or
 * when it will not be accepted — checked HERE rather than by letting the server
 * say no, because the whole exchange happens while somebody is wearing a
 * headset and cannot read a 422.
 */
export function planVoice(
  transcript: string,
  destination: VoiceDestination,
  options: { confidence?: number; speaker?: string } = {},
): VoicePlan {
  const words = transcript.trim();
  if (!words) return { posts: [], refused: "Nothing was heard, so nothing was sent." };

  /**
   * ASK THE SHARED RULE, do not restate it.
   *
   * This used to compare against SPOKEN_LIMIT itself, with its own wording —
   * which made three implementations of one rule: here, in `VoiceControls`, and
   * in `refusalFor`, which is the one the server actually enforces. Three
   * places to change a limit is two places to forget. Now the only way to be
   * refused locally is to be refused for the reason the server would give.
   */
  const input: UtteranceInput = { say: words, source: "voice" };
  const refused = refusalFor(input);
  if (refused) return { posts: [], refused: `${refused[0].toUpperCase()}${refused.slice(1)}.` };

  const posts: VoicePost[] = [
    {
      to: "room",
      say: words,
      ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    },
  ];

  if (destination === "room-and-agents") {
    // MARKED AS SPOKEN, and marked as a transcript. The group chat is read by
    // people and by agents with no idea this came through a microphone, and
    // "said in the room" is a materially different claim from "typed this" —
    // an agent acting on a misheard word should be able to see that it might
    // have been misheard.
    const heading = options.speaker ? `${options.speaker} said in the room` : "Said in the room";
    posts.push({ to: "group-chat", content: `${heading} (voice transcript): ${words}` });
  }

  return { posts, refused: null };
}
