/**
 * What pressing the microphone should do, given what it is already doing.
 *
 * SPLIT OUT BECAUSE IT IS THE BEHAVIOUR THAT WAS WRONG, and behaviour buried in
 * an `onTap` inside a component this suite cannot render is behaviour nobody can
 * check. The geometry around it was fine; the question "what does the second
 * press do" had no answer.
 *
 * WHAT WAS WRONG. Recognition ends itself after each utterance, and the default
 * mode then showed "Tap Send, or speak again" — while the only Send control
 * lived inside the settings menu. From a headset the microphone looked broken:
 * you pressed it, you spoke, and nothing was ever sent, because sending meant
 * opening a menu and finding a row in it. Nikk: "the audio sending to room and
 * space doesn't work... I just click once on the mic button, and then click
 * another time and it sends."
 */

export type MicState = {
  /** Whether this browser has speech recognition at all. */
  available: boolean;
  /** Whether recognition is running right now. */
  listening: boolean;
  /** Whether a post is already in flight. */
  sending: boolean;
  /** Words recognised and not yet sent. */
  heard: string;
  /** Whether each sentence posts itself as it lands. */
  alwaysOn: boolean;
};

export type MicAction =
  /** Nothing to do, or nothing we may do. */
  | "ignore"
  /** Say so, rather than appearing to work. */
  | "refuse"
  /** Begin listening. */
  | "start"
  /** Stop listening; nothing is waiting to be sent. */
  | "stop"
  /** Stop listening and post what was heard. */
  | "stopAndSend"
  /** Not listening, but words are waiting: post them. */
  | "send";

/**
 * THE BUTTON IS "DEAL WITH WHAT I SAID", NOT STRICTLY A TOGGLE.
 *
 * A toggle would only start and stop, and stopping is not what somebody wants
 * after speaking — sending is. The common case is that recognition has ALREADY
 * ended on its own and words are waiting, so a press that merely stopped would
 * do nothing visible and look exactly like the bug being fixed.
 *
 * `alwaysOn` posts each sentence as it lands, so there is never anything
 * pending there and a press only ever stops.
 */
export function micPress(state: MicState): MicAction {
  if (!state.available) return "refuse";
  // A press during a post is not a queue. Two posts of the same words is worse
  // than a press that did nothing.
  if (state.sending) return "ignore";

  const pending = !state.alwaysOn && state.heard.trim().length > 0;

  if (state.listening) return pending ? "stopAndSend" : "stop";
  return pending ? "send" : "start";
}

/**
 * What the mic button shows.
 *
 * A SYMBOL RATHER THAN A SENTENCE, which Nikk asked for: "lets change it from
 * text to a mic icon". The label used to be a whole phrase — "Stop — sending as
 * you speak" — which on a control you glance at while wearing a headset is
 * worse than a shape. It is only legible as a symbol now because label textures
 * take the aspect of the plane they are drawn on; before that a glyph on this
 * button was squeezed.
 *
 * The words have not been thrown away: the notice line underneath says what
 * happened in a sentence, which is where a description belongs.
 */
export function micGlyph(state: Pick<MicState, "sending" | "listening" | "heard" | "alwaysOn">): string {
  if (state.sending) return "…";
  if (state.listening) return "◼";
  // Words waiting: the press will send them, so show that rather than a mic
  // the person has already used.
  if (!state.alwaysOn && state.heard.trim()) return "▲";
  return "🎙";
}
