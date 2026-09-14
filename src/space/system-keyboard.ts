/**
 * Typing, and dictating, in a headset whose browser has no speech recognition.
 *
 * Quest Browser gives a page no Web Speech recognition, but its system
 * keyboard has a microphone. Nikk: "Fix the option for text input so that
 * quest users have a simple text box that they can enter text into (and then
 * also use the speech to text that is available on quest when typing), and
 * then send it".
 *
 * WHAT WENT WRONG BEFORE. The first version drew a textarea in a DOM Overlay
 * card and focused it on the next animation frame. Tapping it put baiwei2 out
 * of the headset. Quest Browser does not composite a DOM overlay into an
 * immersive session, and a focus that does not happen inside the tap is not a
 * gesture the browser will open a keyboard for.
 *
 * WHAT META DOCUMENTS, and what this does instead: a plain text input appended
 * to the page, focused INSIDE the tap. The keyboard opens over the session
 * (which becomes "visible-blurred" and comes back when it closes). The words
 * are then drawn in the room itself, on the controls, not in HTML nobody in
 * the headset can see. See
 * https://developers.meta.com/horizon/documentation/web/webxr-keyboard/
 *
 * ONE QUIRK TO DESIGN AROUND, from the same page: "each time the keyboard is
 * shown represents a new underlying editing session. Any key press first
 * overwrites the entire existing value". So the field starts empty each time
 * and what it collects is ADDED to the draft already kept, rather than being
 * handed the draft to be wiped by the first key.
 */

/** Add what one keyboard session typed to the draft kept from earlier ones. */
export function mergeKeyboardEdit(kept: string, typed: string): string {
  const before = kept.trim();
  const added = typed.trim();
  if (!before) return added;
  if (!added) return before;
  return `${before} ${added}`;
}

export type SystemKeyboard = {
  /**
   * Open the keyboard to add to `kept`. MUST be called from inside the tap
   * that asked for it; a focus from a timer or a frame is not a gesture.
   */
  open(kept: string): void;
  dispose(): void;
};

export function createSystemKeyboard(options: {
  /** The whole draft so far, as the person types or dictates. */
  onDraft: (draft: string) => void;
  /** The keyboard has opened (true) or been put away (false). */
  onShown: (shown: boolean) => void;
  doc?: Document;
}): SystemKeyboard {
  const doc = options.doc ?? document;
  let field: HTMLInputElement | null = null;
  let kept = "";

  const ensure = () => {
    if (field) return field;
    const input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", "Write in the room");
    input.autocomplete = "off";
    input.enterKeyHint = "done";
    // In the page, at the top-left corner, and invisible. NOT display:none,
    // which cannot take focus, and NOT off-screen, which Meta notes makes the
    // page scroll to it as you type.
    Object.assign(input.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      border: "0",
      padding: "0",
      margin: "0",
      zIndex: "-1",
    });
    input.addEventListener("input", () => options.onDraft(mergeKeyboardEdit(kept, input.value)));
    input.addEventListener("focus", () => options.onShown(true));
    input.addEventListener("blur", () => {
      kept = mergeKeyboardEdit(kept, input.value);
      input.value = "";
      options.onShown(false);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    doc.body.appendChild(input);
    field = input;
    return input;
  };

  return {
    open: (draft) => {
      const input = ensure();
      kept = draft;
      input.value = "";
      input.focus({ preventScroll: true });
    },
    dispose: () => {
      field?.remove();
      field = null;
    },
  };
}
