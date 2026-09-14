import { SPOKEN_LIMIT, splitSpoken } from "../../shared/voice";
import type { RoomMessage } from "./useRoomFeed";

/**
 * What to read out loud in a headset, and what to leave on the wall.
 *
 * WHY THE CHAT AND NOT JUST THE ROOM. `VoiceControls` already speaks room
 * utterances addressed to you, and in a headset that turned out to be nothing
 * at all: the agents do not post room utterances. You speak, it goes to the
 * room AND to the WebHarness chat, and the agent answers in the chat — so the
 * only place a reply ever appears is the panel behind you. Somebody who asks a
 * question out loud and is answered in writing on a wall they are not facing
 * has not had a conversation.
 *
 * ONE MESSAGE, THE NEWEST. Three agents answering at once is three paragraphs
 * read end to end at a person who cannot skim or skip, and by the end of it the
 * conversation has moved on. The rest are not lost — they are on the Chat
 * panel, in full, which is the medium that suits them.
 *
 * TRUNCATED, AND SAID SO. `SPOKEN_LIMIT` is the room's own rule for how much
 * anybody may say out loud (about eight seconds). A chat message may be two
 * thousand characters, and cutting one off mid-sentence with no signal would
 * leave you believing you had heard the whole answer.
 */
export type SpokenReply = {
  /** The message this came from, so the caller can mark it read. */
  id: number;
  say: string;
  /** True when there is more of it, and the speech says so. */
  shortened: boolean;
};

/**
 * The newest thing said by somebody else since `since`, ready to be spoken.
 *
 * `since` is a watermark rather than a count: a headset that joins an hour into
 * a conversation must not read the last forty messages at its wearer.
 */
export function replyToSpeak(
  messages: readonly RoomMessage[],
  since: number,
  you: string | null,
): SpokenReply | null {
  let newest: RoomMessage | null = null;
  for (const message of messages) {
    if (message.id <= since) continue;
    if (isYou(message.username, you)) continue;
    // STILL BEING WRITTEN. A streaming message is a prefix, and reading a
    // prefix aloud gives you half an answer in a confident voice. It will come
    // round again on a later poll with the rest of it.
    if (message.streaming) continue;
    if (!message.content.trim()) continue;
    if (newest === null || message.id > newest.id) newest = message;
  }
  if (!newest) return null;
  const { say, shortened } = shorten(newest.content.trim());
  return { id: newest.id, say: say ? `${newest.username} says: ${say}` : `${newest.username} replied.`, shortened };
}

/**
 * Whether a chat message is your own.
 *
 * CASE-INSENSITIVELY, because the two systems spell the same person
 * differently: the room knows Nikk as `nikk2` and WebHarness as `Nikk2`. A
 * case-sensitive check here reads your own words back to you a second after
 * you say them, which is the most disconcerting possible failure.
 */
export function isYou(username: string, you: string | null): boolean {
  return Boolean(you) && username.toLowerCase() === (you ?? "").toLowerCase();
}

/** The highest id present, for priming the watermark on arrival. */
export function newestId(messages: readonly RoomMessage[]): number {
  let highest = 0;
  for (const message of messages) if (message.id > highest) highest = message.id;
  return highest;
}

function shorten(text: string): { say: string; shortened: boolean } {
  if (text.length <= SPOKEN_LIMIT) return { say: text, shortened: false };
  /**
   * WHOLE SENTENCES ONLY, never a sentence cut off where it ran out of room.
   *
   * This cut at the last WORD that fit, which avoids a sound like a fault and
   * still stops mid-sentence — and a reply heard as "I would not" when it said
   * "I would not merge this until the tests pass" is a reply you acted on
   * without hearing. It now speaks the opening sentences that fit, by the same
   * rule the room uses for what it says aloud, and points at the rest.
   *
   * When not even the first sentence fits, it says so rather than reading half
   * of it: better told there is a long message than handed a misquote.
   */
  const spoken = splitSpoken(text);
  /**
   * NO POINTER AT THE END. This used to append "There is more of that on the
   * Chat panel." to every reply it shortened, which in practice was nearly all
   * of them. Nikk: "you always say there's more of that on the chat panel can
   * we remove that so you don't have to say that at the end of everything...
   * we can see". The Chat panel is in view; announcing it after every reply was
   * a sentence of noise per message. The reply now simply stops at the end of
   * a sentence.
   *
   * An empty `say` means not even the first sentence fits; `replyToSpeak` then
   * says only who replied, rather than reading half of a sentence.
   */
  return { say: spoken.say ?? "", shortened: true };
}
