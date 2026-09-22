/**
 * Borrowing the device's own text input.
 *
 * WHY, IN NIKK'S WORDS: "we want to allow for speach to text here, or to use
 * the native text input (so then we can have speach to text on quest)". A
 * headset's own keyboard has a dictation button on it. Ours cannot — the
 * browser will not give a WebGL surface the system keyboard — but a real DOM
 * input will, and whatever the system writes into it is just text.
 *
 * VISUALLY HIDDEN, NOT `display: none`. A display-none element cannot be
 * focused, and focus is the entire mechanism: focusing a text input is what
 * raises the system keyboard. So it is a real, focusable, one-pixel input
 * parked off-screen.
 *
 * WHERE IT WORKS, HONESTLY. In a window, always. On a headset OUTSIDE an
 * immersive session, yes — that is where the system keyboard and its dictation
 * live. INSIDE an immersive session there is no DOM composited into the frame
 * at all, so this cannot raise anything there, and the room offers its own
 * keyboard and the press-to-speak button instead. Saying which is which is the
 * point; a control that silently does nothing in a headset would be worse than
 * not offering one.
 *
 * The scope is injectable so this can be tested without a browser.
 */

export type NativeInputScope = {
  createElement(tag: string): {
    setAttribute(name: string, value: string): void;
    addEventListener(type: string, handler: (event: unknown) => void): void;
    removeEventListener(type: string, handler: (event: unknown) => void): void;
    focus(options?: unknown): void;
    blur(): void;
    remove(): void;
    value: string;
    style: Record<string, string>;
  };
  body: { appendChild(node: unknown): void };
};

export type NativeInput = {
  /** Put it away. Safe to call twice. */
  close(): void;
  /** Whether it is still open, for a caller that lost track. */
  open(): boolean;
};

/**
 * Open the device's own text input on top of whatever is being written.
 *
 * `onChange` fires as the person types or dictates; `onDone` when they confirm;
 * `onCancel` when they dismiss it. The caller owns the text — this only reports.
 */
export function openNativeInput(options: {
  value: string;
  onChange: (text: string) => void;
  onDone: (text: string) => void;
  onCancel: () => void;
  /** What the field is for, so a system keyboard can label itself. */
  label?: string;
  scope?: NativeInputScope;
  /** Deferred so the opening press finishes first. Replaced in tests. */
  defer?: (run: () => void) => void;
}): NativeInput {
  const scope = options.scope ?? (document as unknown as NativeInputScope);
  const defer = options.defer ?? ((run: () => void) => setTimeout(run, 0));
  const field = scope.createElement("input");
  field.setAttribute("type", "text");
  field.setAttribute("autocomplete", "off");
  field.setAttribute("autocorrect", "off");
  field.setAttribute("enterkeyhint", "done");
  if (options.label) field.setAttribute("aria-label", options.label);
  field.value = options.value;

  // Off-screen but REAL: focusable, and therefore able to raise a keyboard.
  Object.assign(field.style, {
    position: "fixed",
    left: "0px",
    bottom: "0px",
    width: "1px",
    height: "1px",
    opacity: "0",
    border: "0",
    padding: "0",
    // Not `display:none` and not `visibility:hidden` — both make it unfocusable.
    zIndex: "-1",
  });

  let closed = false;
  /**
   * NOT LISTENING FOR A BLUR UNTIL IT HAS ACTUALLY BEEN FOCUSED.
   *
   * The press that opens this is still being handled when it is created, and
   * the browser hands focus back to whatever was clicked the moment that press
   * completes — so the input was focused, immediately blurred, and closed
   * itself before anybody could type a character. Opening it looked like doing
   * nothing at all.
   */
  let listening = false;
  const close = () => {
    if (closed) return;
    closed = true;
    field.removeEventListener("input", onInput);
    field.removeEventListener("keydown", onKey);
    field.removeEventListener("blur", onBlur);
    field.blur();
    field.remove();
  };

  const onInput = () => options.onChange(field.value);
  const onKey = (event: unknown) => {
    const key = (event as { key?: string }).key;
    if (key === "Enter") {
      close();
      options.onDone(field.value);
    } else if (key === "Escape") {
      close();
      options.onCancel();
    }
  };
  /**
   * A BLUR IS A DISMISSAL, not a save. Somebody who taps away from the system
   * keyboard has changed their mind; saving on blur would file whatever half
   * sentence was in there under their name.
   */
  const onBlur = () => {
    if (closed || !listening) return;
    close();
    options.onCancel();
  };

  field.addEventListener("input", onInput);
  field.addEventListener("keydown", onKey);
  field.addEventListener("blur", onBlur);
  scope.body.appendChild(field);
  defer(() => {
    if (closed) return;
    field.focus({ preventScroll: true });
    listening = true;
  });

  return { close, open: () => !closed };
}
