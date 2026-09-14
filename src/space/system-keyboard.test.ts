import { describe, expect, it } from "vitest";
import { mergeKeyboardEdit } from "./system-keyboard";

describe("dictating into the Quest keyboard, a bit at a time", () => {
  it("adds what a keyboard session typed to the draft kept from before", () => {
    // Meta: "any key press first overwrites the entire existing value", so each
    // session starts empty and is appended rather than handed the draft to wipe.
    expect(mergeKeyboardEdit("please deploy", "the board changes")).toBe("please deploy the board changes");
  });

  it("starts a draft from nothing, and keeps it when a session typed nothing", () => {
    expect(mergeKeyboardEdit("", "hello Sill")).toBe("hello Sill");
    expect(mergeKeyboardEdit("hello Sill", "")).toBe("hello Sill");
    expect(mergeKeyboardEdit("  ", "   ")).toBe("");
  });
});

describe("the keyboard's hidden text field", () => {
  /** Just enough of a document to watch what the helper does with its field. */
  const fakeDocument = () => {
    const listeners = new Map<string, ((event: { key?: string }) => void)[]>();
    const field = {
      type: "",
      value: "",
      autocomplete: "",
      enterKeyHint: "",
      style: {} as Record<string, string>,
      focused: 0,
      setAttribute: () => {},
      addEventListener: (name: string, fn: (event: { key?: string }) => void) =>
        listeners.set(name, [...(listeners.get(name) ?? []), fn]),
      focus: () => {
        field.focused += 1;
        for (const fn of listeners.get("focus") ?? []) fn({});
      },
      blur: () => {
        for (const fn of listeners.get("blur") ?? []) fn({});
      },
      remove: () => {},
      fire: (name: string, event: { key?: string } = {}) => {
        for (const fn of listeners.get(name) ?? []) fn(event);
      },
    };
    const doc = { createElement: () => field, body: { appendChild: () => {} } };
    return { doc: doc as unknown as Document, field };
  };

  it("opens by focusing a field, collects typing, and adds it to the draft when put away", async () => {
    const { createSystemKeyboard } = await import("./system-keyboard");
    const { doc, field } = fakeDocument();
    const drafts: string[] = [];
    const shown: boolean[] = [];
    const keyboard = createSystemKeyboard({ onDraft: (d) => drafts.push(d), onShown: (s) => shown.push(s), doc });

    keyboard.open("");
    expect(field.focused).toBe(1);
    field.value = "please deploy";
    field.fire("input");
    field.blur();
    expect(drafts.at(-1)).toBe("please deploy");

    // Opened again with the draft kept: the field starts empty, as Quest's
    // keyboard would wipe it anyway, and what is typed is added.
    keyboard.open("please deploy");
    expect(field.value).toBe("");
    field.value = "the board";
    field.fire("input");
    expect(drafts.at(-1)).toBe("please deploy the board");
    field.fire("keydown", { key: "Enter" });
    expect(shown).toEqual([true, false, true, false]);
  });
});
