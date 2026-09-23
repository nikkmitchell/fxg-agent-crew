import { afterEach, describe, expect, it } from "vitest";
import { CARD_INK, STATUS_STRIPE } from "./card-paint";
import {
  DARK_THEME,
  LIGHT_THEME,
  applyRoomTheme,
  bubbleFor,
  chatInk,
  contrast,
  isRoomDark,
  luminance,
  mix,
} from "./room-theme";

/**
 * The dark room is measured, not judged.
 *
 * Sill measured it before anyone had written a line: on a darker panel, muted
 * text, the accent and the status stripes lose contrast long before the main
 * ink does — muted fell to 2.8:1 on a mid-grey and the stripes to about 1.5:1.
 * So every ink is asserted against both papers. WCAG: 7:1 for body text (AAA),
 * 4.5:1 for smaller or secondary text (AA), 3:1 for marks and UI (the accent,
 * the stripes).
 */
afterEach(() => applyRoomTheme(false));

const PAPERS = ["paper", "paperHeld"] as const;

describe("the dark room is readable", () => {
  for (const paper of PAPERS) {
    it(`ink reads at 7:1 or better on ${paper}`, () => {
      expect(contrast(DARK_THEME.ink.ink, DARK_THEME.ink[paper])).toBeGreaterThanOrEqual(7);
    });

    it(`muted and refused text read at 4.5:1 on ${paper}`, () => {
      expect(contrast(DARK_THEME.ink.muted, DARK_THEME.ink[paper])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_THEME.ink.refused, DARK_THEME.ink[paper])).toBeGreaterThanOrEqual(4.5);
    });

    it(`the accent and EVERY status stripe read as marks, 3:1, on ${paper}`, () => {
      expect(contrast(DARK_THEME.ink.accent, DARK_THEME.ink[paper])).toBeGreaterThanOrEqual(3);
      for (const [status, stripe] of Object.entries(DARK_THEME.stripes)) {
        expect(contrast(stripe, DARK_THEME.ink[paper]), status).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("the chat wall's own words read on its own background", () => {
    expect(contrast(DARK_THEME.chat.meta, DARK_THEME.chat.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK_THEME.chat.failed, DARK_THEME.chat.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the dark room is actually dark", () => {
  /**
   * THE WHOLE POINT. Baiwei: white is hard to look at in VR for a long time.
   * The light paper is very nearly a white screen; the dark one must be a small
   * fraction of it, or this changed colours without changing comfort.
   */
  it("puts at least forty times less light on every board", () => {
    expect(luminance(LIGHT_THEME.ink.paper) / luminance(DARK_THEME.ink.paper)).toBeGreaterThan(40);
  });

  /** Pure white text halates in a headset; pure black smears as the head turns. */
  it("uses neither pure white ink nor a pure black page", () => {
    expect(DARK_THEME.ink.ink.toLowerCase()).not.toBe("#ffffff");
    expect(DARK_THEME.ink.paper.toLowerCase()).not.toBe("#000000");
  });

  it("lifts a held card towards you, as the light theme does, rather than sinking it", () => {
    expect(luminance(DARK_THEME.ink.paperHeld)).toBeGreaterThan(luminance(DARK_THEME.ink.paper));
  });
});

describe("switching", () => {
  /**
   * IN PLACE. Nine files read CARD_INK and STATUS_STRIPE at the moment they
   * paint; the switch works only if what they read is what changed.
   */
  it("changes what every painter reads, without them being told", () => {
    applyRoomTheme(true);
    expect(CARD_INK.paper).toBe(DARK_THEME.ink.paper);
    expect(STATUS_STRIPE.review).toBe(DARK_THEME.stripes.review);
    expect(chatInk().background).toBe(DARK_THEME.chat.background);
    expect(isRoomDark()).toBe(true);

    applyRoomTheme(false);
    expect(CARD_INK.paper).toBe(LIGHT_THEME.ink.paper);
    expect(STATUS_STRIPE.review).toBe(LIGHT_THEME.stripes.review);
    expect(chatInk().background).toBe(LIGHT_THEME.chat.background);
  });

  it("leaves no stripe behind from the other theme", () => {
    applyRoomTheme(true);
    expect(Object.keys(STATUS_STRIPE).sort()).toEqual(Object.keys(DARK_THEME.stripes).sort());
  });

  /** "Light" must mean exactly what the room was before dark mode existed. */
  it("light is the room as it was", () => {
    applyRoomTheme(false);
    expect({ ...CARD_INK }).toEqual(LIGHT_THEME.ink);
  });
});

describe("a person's chat bubble", () => {
  const pastel = { paper: "#e6ddc9", accent: "#3156d8", ink: "#1b1c1e" };

  it("is untouched in the light", () => {
    applyRoomTheme(false);
    expect(bubbleFor(pastel)).toBe(pastel);
  });

  /**
   * A row of bright pastel rectangles on a dark wall would BE the glare. In the
   * dark the bubble keeps only a tint of the person's colour, and still reads.
   */
  it("in the dark is dim, keeps a hint of the person, and still reads", () => {
    applyRoomTheme(true);
    const bubble = bubbleFor(pastel);
    expect(luminance(bubble.paper)).toBeLessThan(luminance(pastel.paper) / 8);
    expect(bubble.paper).not.toBe(DARK_THEME.ink.paperHeld);
    expect(contrast(bubble.ink, bubble.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(bubble.accent, bubble.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("mix", () => {
  it("runs from one colour to the other", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
