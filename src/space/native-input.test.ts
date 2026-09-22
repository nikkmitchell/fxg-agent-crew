import { describe, expect, it, vi } from "vitest";
import { openNativeInput, type NativeInputScope } from "./native-input.js";

/**
 * A fake document, because this suite has no browser and the thing worth
 * checking is the CONTRACT — what gets focused, what gets cleaned up, and what
 * a dismissal means — not that a real input renders.
 */
function fakeScope() {
  const handlers: Record<string, ((event: unknown) => void)[]> = {};
  const field = {
    attributes: {} as Record<string, string>,
    style: {} as Record<string, string>,
    value: "",
    focused: false,
    removed: false,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    addEventListener(type: string, handler: (event: unknown) => void) {
      (handlers[type] ??= []).push(handler);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      handlers[type] = (handlers[type] ?? []).filter((one) => one !== handler);
    },
    focus() {
      this.focused = true;
    },
    blur() {
      this.focused = false;
    },
    remove() {
      this.removed = true;
    },
  };
  const appended: unknown[] = [];
  const scope: NativeInputScope = {
    createElement: () => field as never,
    body: { appendChild: (node) => appended.push(node) },
  };
  const fire = (type: string, event: unknown = {}) => [...(handlers[type] ?? [])].forEach((h) => h(event));
  return { scope, field, appended, fire, handlers };
}

const open = (over: Partial<Parameters<typeof openNativeInput>[0]> = {}) => {
  const f = fakeScope();
  const onChange = vi.fn();
  const onDone = vi.fn();
  const onCancel = vi.fn();
  // The deferred focus is run by hand, so a test can look at the moment BEFORE
  // it happens — which is the moment the opening press was closing it.
  let deferred: (() => void) | null = null;
  const input = openNativeInput({
    value: "",
    onChange,
    onDone,
    onCancel,
    scope: f.scope,
    defer: (run) => {
      deferred = run;
    },
    ...over,
  });
  const settle = () => {
    deferred?.();
    deferred = null;
  };
  settle();
  return { ...f, input, onChange, onDone, onCancel, settle };
};

describe("borrowing the device's own text input", () => {
  it("puts a real, focused input in the page", () => {
    // Focus is the entire mechanism: focusing a text input is what raises a
    // headset's system keyboard, and its dictation button with it.
    const { field, appended } = open();
    expect(appended).toHaveLength(1);
    expect(field.focused).toBe(true);
    expect(field.attributes.type).toBe("text");
  });

  it("IS NOT display:none, which cannot be focused at all", () => {
    // The obvious way to hide it is the one way that breaks it.
    const { field } = open();
    expect(field.style.display).not.toBe("none");
    expect(field.style.visibility).not.toBe("hidden");
    expect(field.style.position).toBe("fixed");
  });

  it("starts from what was already written", () => {
    const { field } = open({ value: "half a sentence" });
    expect(field.value).toBe("half a sentence");
  });

  it("reports every change, so dictation lands as it arrives", () => {
    const { field, fire, onChange } = open();
    field.value = "spoken words";
    fire("input");
    expect(onChange).toHaveBeenCalledWith("spoken words");
  });

  it("saves on Enter and puts itself away", () => {
    const { field, fire, onDone, input } = open();
    field.value = "done then";
    fire("keydown", { key: "Enter" });
    expect(onDone).toHaveBeenCalledWith("done then");
    expect(input.open()).toBe(false);
    expect(field.removed).toBe(true);
  });

  it("drops it on Escape", () => {
    const { fire, onCancel, onDone } = open();
    fire("keydown", { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("TREATS A BLUR AS A DISMISSAL, never as a save", () => {
    // Somebody who taps away from the system keyboard has changed their mind.
    // Saving on blur files half a sentence under their name.
    const { field, fire, onCancel, onDone } = open();
    field.value = "half a thought";
    fire("blur");
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cleans up its listeners, so a second open is not heard twice", () => {
    const { input, handlers } = open();
    input.close();
    expect(handlers.input ?? []).toHaveLength(0);
    expect(handlers.keydown ?? []).toHaveLength(0);
    expect(handlers.blur ?? []).toHaveLength(0);
  });

  it("can be closed twice without complaining", () => {
    const { input, onCancel } = open();
    input.close();
    input.close();
    // Closing is not cancelling: the caller closing it has already decided.
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not fire anything after it is closed", () => {
    const { input, fire, onDone, onCancel } = open();
    input.close();
    fire("keydown", { key: "Enter" });
    fire("blur");
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("the press that opens it", () => {
  it("DOES NOT CLOSE IT, which is what a blur before focus used to do", () => {
    /**
     * The press that opens this is still being handled when the input is
     * created, and the browser hands focus back to whatever was clicked the
     * moment that press completes. The input was focused, immediately blurred,
     * and closed itself — so pressing "system keyboard" looked like doing
     * nothing at all. Verified by the room: the focused element after the
     * press was a DIV, never the input.
     */
    const f = fakeScope();
    const onCancel = vi.fn();
    let deferred: (() => void) | null = null;
    const input = openNativeInput({
      value: "",
      onChange: () => {},
      onDone: () => {},
      onCancel,
      scope: f.scope,
      defer: (run) => {
        deferred = run;
      },
    });
    // The blur that arrives before focus has been given must be ignored.
    f.fire("blur");
    expect(onCancel).not.toHaveBeenCalled();
    expect(input.open()).toBe(true);
    // And once it really is focused, a blur means what it says again.
    deferred!();
    expect(f.field.focused).toBe(true);
    f.fire("blur");
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not focus at all if it was closed before the tick arrived", () => {
    const f = fakeScope();
    let deferred: (() => void) | null = null;
    const input = openNativeInput({
      value: "",
      onChange: () => {},
      onDone: () => {},
      onCancel: () => {},
      scope: f.scope,
      defer: (run) => {
        deferred = run;
      },
    });
    input.close();
    deferred!();
    expect(f.field.focused).toBe(false);
  });
});
