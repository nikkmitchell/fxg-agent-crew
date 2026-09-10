/**
 * How much of a durable message a card actually costs.
 *
 * WebHarness caps a message at 2000 characters, enforced server-side. Board
 * changes travel as `task.upserted`, which REPLACES the stored card — so the
 * whole task is sent every time, not the field you edited. That means the brief
 * does not get 2000 characters. It gets whatever is left after the title, the
 * id, the owners, the comments and the JSON scaffolding around them.
 *
 * The editor used to invite 4000 characters into a textarea and find out at
 * save time. On one real card the title alone made a 300-character brief
 * unsendable. Raising the cap only moves the wall; the fix is for the editor to
 * know where the wall is while you type.
 *
 * The size is MEASURED, not estimated. `encodeActionRequest` pretty-prints with
 * two-space indent, which roughly doubles the payload — an estimate based on
 * `JSON.stringify(task).length` would be comfortably wrong in the direction
 * that loses writing. So this encodes the real thing and counts it.
 */
import { encodeActionRequest, type CrewEvent } from "./crew-events.js";

/**
 * The server's cap, in characters.
 *
 * Enforced by WebHarness itself and re-checked in the BFF, so this constant is
 * a third copy and cannot be the authority. It exists so the editor can predict
 * that refusal rather than discover it; if upstream ever lowers the cap, the
 * editor gets optimistic and the save still fails safely.
 */
export const MESSAGE_LIMIT = 2_000;

export type Budget = {
  /** Characters the encoded message occupies right now. */
  used: number;
  /**
   * How many more characters of TEXT can still be typed. Negative when the
   * message is already too long, in which case it is how many must go.
   *
   * Not `limit - used`. That subtraction is wrong at the boundary and wrong in
   * the direction that loses writing: the first character of a brief also pays
   * for the `"description":` key and its quotes, and every quote or newline
   * typed afterwards costs two characters rather than one. A writer told they
   * have 1,272 left, who types 1,272 and is then refused, has been given a
   * number that was worse than no number.
   *
   * So this is measured against the real encoder rather than derived.
   */
  remaining: number;
  /** True when this can actually be sent. */
  fits: boolean;
  /**
   * Cost of everything that is NOT the field being edited, so the editor can
   * say "the rest of this card costs 1,640 of your 2,000" rather than only
   * reporting a total the writer cannot act on.
   */
  overhead: number;
};

/** The exact number of characters this payload occupies on the wire. */
export function wireSize(payload: CrewEvent): number {
  return encodeActionRequest(payload).length;
}

/**
 * Budget for editing one text field of a task.
 *
 * `overhead` is measured by encoding the same card with the field emptied
 * rather than by subtracting the field's length: the field's own JSON escaping,
 * its key, and the difference between an omitted and an empty field are all
 * real costs, and a subtraction silently assumes they are zero.
 */
export function briefBudget(task: Record<string, unknown>, description: string): Budget {
  const trimmed = description.trim();
  // Comments never travel in an upsert — they have their own event, and
  // re-sending them is what made eleven cards uneditable. Stripped HERE as well
  // as in the sender, so the number shown to a writer cannot describe a
  // different message than the one that gets posted.
  const { comments: _discussion, ...card } = task;
  const withText = { ...card, description: trimmed };
  // Cleared means cleared: the field is omitted rather than sent empty, which
  // is what the editor does on save, so the overhead must be measured the same
  // way or it is the cost of a message nobody sends.
  const { description: _drop, ...withoutText } = { ...card, description: trimmed };

  const used = wireSize({ type: "task.upserted", task: (trimmed ? withText : withoutText) as never });
  const overhead = wireSize({ type: "task.upserted", task: withoutText as never });

  return {
    used,
    overhead,
    remaining: used > MESSAGE_LIMIT ? MESSAGE_LIMIT - used : headroom(card, description),
    fits: used <= MESSAGE_LIMIT,
  };
}

/**
 * The largest number of further plain characters that still fits.
 *
 * Binary search over the real encoder, not arithmetic. Roughly eleven encodes
 * of a two-kilobyte string per keystroke, which is nothing, and it is exactly
 * right — including the case where the field does not exist yet and the first
 * character has to pay for the key as well.
 */
function headroom(card: Record<string, unknown>, description: string): number {
  // Deliberately calls the encoder rather than briefBudget: briefBudget calls
  // this, and the obvious version of this function recurses forever.
  const sizeWith = (extra: number) => {
    const text = (description + "x".repeat(extra)).trim();
    const task = text ? { ...card, description: text } : (({ description: _d, ...rest }) => rest)(card);
    return wireSize({ type: "task.upserted", task: task as never });
  };
  const fitsWith = (extra: number) => sizeWith(extra) <= MESSAGE_LIMIT;

  let low = 0;
  let high = MESSAGE_LIMIT;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsWith(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * One sentence for a person, chosen by how much trouble they are in.
 *
 * Three states rather than a bare number, because "1,742 / 2,000" tells a
 * writer nothing until it is too late, and a warning that appears only at the
 * limit appears after the paragraph is already written.
 */
export function describeBudget(budget: Budget): { tone: "ok" | "tight" | "over"; text: string } {
  const n = (value: number) => value.toLocaleString("en-US");

  if (!budget.fits) {
    return {
      tone: "over",
      text: `${n(-budget.remaining)} characters too long to save. The rest of this card already costs ${n(budget.overhead)} of the ${n(MESSAGE_LIMIT)}-character limit.`,
    };
  }
  if (budget.remaining <= 200) {
    return { tone: "tight", text: `${n(budget.remaining)} characters left.` };
  }
  return { tone: "ok", text: `${n(budget.remaining)} characters left of ${n(MESSAGE_LIMIT)}.` };
}
