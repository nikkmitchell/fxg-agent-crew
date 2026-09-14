import { CHAT_MESSAGE_LIMIT, refusalFor, splitForChat, splitSpoken, type UtteranceInput } from "../../shared/voice";

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
  /**
   * `detail` carries the written remainder when the words were too long to say
   * in one breath, and `say` is empty when even the first sentence was — see
   * `splitSpoken`. Both halves travel together or the end of somebody's
   * sentence is quietly lost.
   */
  | { to: "room"; say: string; detail?: string; confidence?: number }
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
  /**
   * SPLIT RATHER THAN REFUSED. A long sentence used to come back as "that is
   * 353 characters to say out loud; the limit is 240" and nothing was sent —
   * which, to somebody speaking into a headset with no keyboard, means saying
   * the whole thing again and hoping. Nikk: "please remove any limit here."
   *
   * The opening is spoken, the remainder is written beside it, and every word
   * the speaker said is kept.
   */
  const spoken = splitSpoken(words);
  const input: UtteranceInput = {
    ...(spoken.say ? { say: spoken.say } : {}),
    ...(spoken.detail ? { detail: spoken.detail } : {}),
    source: "voice",
  };
  const refused = refusalFor(input);
  if (refused) return { posts: [], refused: `${refused[0].toUpperCase()}${refused.slice(1)}.` };

  const posts: VoicePost[] = [
    {
      to: "room",
      say: spoken.say ?? "",
      ...(spoken.detail ? { detail: spoken.detail } : {}),
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
    /**
     * IN PARTS WHEN IT IS LONG, NEVER REFUSED.
     *
     * This was one message, and WebHarness refuses anything over two thousand
     * characters — so a long dictation reached the room and bounced off the
     * chat, and the speaker was told it failed. Nikk: "please finish the update
     * so that it doesn't max out on characters in voice messages."
     *
     * Every part carries the full heading and a part number, so an agent that
     * reads only part two still knows it was a transcript, who said it, and
     * that there is more of it. The reserve leaves room for both, so the label
     * can never push a part over the limit.
     */
    const label = (index: number, total: number) =>
      total === 1
        ? `${heading} (voice transcript): `
        : `${heading} (voice transcript, part ${index + 1} of ${total}): `;
    const reserve = label(98, 99).length;
    const parts = splitForChat(words, CHAT_MESSAGE_LIMIT, reserve);
    parts.forEach((part, index) => {
      posts.push({ to: "group-chat", content: `${label(index, parts.length)}${part}` });
    });
  }

  return { posts, refused: null };
}
