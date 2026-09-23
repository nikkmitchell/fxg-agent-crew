import { CARD_INK, STATUS_STRIPE } from "./card-paint.js";

/**
 * The room drawn dark, by default, with a way back to light.
 *
 * Nikk: "adjust the background menus, boards and stuff, to have a darkmode that
 * is on automatically, as baiwei mentioned the white is hard to look at in VR
 * for a long time (also add a setting to turn off dark mode in settings)".
 *
 * WHY THE BOARDS WERE THE PROBLEM. A headset puts a lit panel a metre from each
 * eye for an hour. The light palette's paper, #faf8f2, has a relative luminance
 * of 0.94 — very nearly a white screen. The dark paper below is 0.015. That is
 * roughly sixty times less light off every board, which is the whole of the
 * comfort change; everything else on this page is keeping it readable.
 *
 * NOT PURE BLACK AND NOT PURE WHITE. Pure white text on black halates in a
 * headset — the letters bloom — and pure black smears when the head moves.
 * Ink is an off-white and paper a dark slate, both chosen for that.
 *
 * CONTRAST IS MEASURED, NOT JUDGED. Sill measured it first: on a darker panel,
 * muted text, the accent and the status stripes lose contrast long before the
 * main ink does. room-theme.test.ts asserts WCAG ratios for every ink against
 * both papers — 7:1 for ink, 4.5:1 for muted and refused text, 3:1 for the
 * accent and the stripes, which are marks rather than words.
 *
 * ONLY THE ROOM. This repaints what the room paints — the work board and its
 * cards, the mood board, list panels, the room's own settings and the chat
 * wall. The website's pages keep their own stylesheet; a laptop is not a
 * headset, and nobody asked for the site to change.
 */

export type RoomInk = {
  paper: string;
  paperHeld: string;
  edge: string;
  ink: string;
  muted: string;
  accent: string;
  refused: string;
};

/** The chat wall paints itself rather than going through CARD_INK. */
export type ChatInk = {
  background: string;
  meta: string;
  failed: string;
};

export type RoomTheme = { ink: RoomInk; stripes: Record<string, string>; chat: ChatInk };

/** Exactly what the room was before this file, kept so "light" means what it meant. */
export const LIGHT_THEME: RoomTheme = {
  ink: {
    paper: "#faf8f2",
    paperHeld: "#fffdf5",
    edge: "#d9d3c4",
    ink: "#222321",
    muted: "#6b6559",
    accent: "#e45338",
    refused: "#b23b22",
  },
  stripes: {
    backlog: "#9a9486",
    assigned: "#5b7fa6",
    in_progress: "#c98a2b",
    blocked: "#b23b22",
    review: "#7a5ea8",
    done: "#4f8a5b",
  },
  chat: { background: "#f2efe6", meta: "#8a8578", failed: "#8a3d3d" },
};

export const DARK_THEME: RoomTheme = {
  ink: {
    paper: "#1e2124",
    // A held card lifts TOWARDS the viewer, so it is lighter, as in the light
    // theme — never darker, which would read as the card sinking away.
    paperHeld: "#282c30",
    edge: "#3b4046",
    ink: "#e7e4dd",
    muted: "#aca79b",
    accent: "#f2876b",
    refused: "#ff9582",
  },
  stripes: {
    backlog: "#a8a295",
    assigned: "#86a9d2",
    in_progress: "#e3a651",
    blocked: "#ff9582",
    review: "#b097dd",
    done: "#79b887",
  },
  chat: { background: "#1e2124", meta: "#aca79b", failed: "#ff9582" },
};

const CHAT_INK: ChatInk = { ...LIGHT_THEME.chat };

/** The chat wall's colours, for whichever theme is on. */
export const chatInk = (): ChatInk => CHAT_INK;

let dark = false;

export const isRoomDark = (): boolean => dark;

/**
 * Switch the room's palette.
 *
 * IN PLACE, on the objects everybody already imported. Nine files read
 * `CARD_INK.paper` and `STATUS_STRIPE[status]` at the moment they paint, so
 * replacing the values under them makes every one of them paint in the new
 * theme without being edited — including shared/settings-3d.ts, which somebody
 * else was in the middle of changing when this was written, and which this
 * change therefore does not touch.
 *
 * What is ALREADY painted stays as it was until it is painted again, which is
 * why the room remounts its panels when this changes. See RoomThemed.
 */
export function applyRoomTheme(useDark: boolean): void {
  dark = useDark;
  const theme = useDark ? DARK_THEME : LIGHT_THEME;
  Object.assign(CARD_INK, theme.ink);
  for (const key of Object.keys(STATUS_STRIPE)) delete STATUS_STRIPE[key];
  Object.assign(STATUS_STRIPE, theme.stripes);
  Object.assign(CHAT_INK, theme.chat);
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two colours, from 1 (none) to 21. */
export function contrast(a: string, b: string): number {
  const [light, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (darker + 0.05);
}

/** Blend two #rrggbb colours: `amount` 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A person's chat bubble, in whichever theme the room is in.
 *
 * Each person has their own paper — light pastels, shared with the website so
 * somebody is the same colour everywhere. On a dark wall those would BE the
 * glare: a row of bright rectangles in a dark room. So in the dark the bubble
 * keeps the person's hue as a tint over the dark paper, the words go light, and
 * the accent down the leading edge is lifted until it still reads as a mark.
 *
 * In the light nothing changes: it returns the recipe it was given.
 */
export function bubbleFor(recipe: { paper: string; accent: string; ink: string }): {
  paper: string;
  accent: string;
  ink: string;
} {
  if (!dark) return recipe;
  return {
    paper: mix(DARK_THEME.ink.paperHeld, recipe.paper, 0.14),
    accent: mix(recipe.accent, "#ffffff", 0.35),
    ink: DARK_THEME.ink.ink,
  };
}
