/**
 * THE PLATFORM'S ONE PALETTE: the settings menu, the lobby's doors and
 * wardrobe, and what a thing draws with ctx.ui (src/engine/ui.ts) all read it
 * from here, so a restyle changes all of them at once. Before this there were
 * two copies (src/space/menu-paint.ts and shared/lobby-panels.ts) with a note to
 * change them together, and a thing could only copy a third (Mica 7331).
 *
 * THE LOOK: dark glass, the way a headset's own system panels are. Nikk (5426,
 * 5439): "make it much cleaner"; (7241) the rooms and the avatar "the same UI
 * coloring and look as nightjars welcome page (its the same as the settings
 * page)".
 */
export const UI_INK = {
  panelTop: "rgba(30, 36, 50, 0.95)",
  panelBottom: "rgba(17, 21, 31, 0.95)",
  panelEdge: "rgba(255, 255, 255, 0.13)",
  title: "#f3f6fc",
  text: "#eef2fa",
  soft: "#c3cad9",
  dim: "#8e99b3",
  faint: "#6c7690",
  caption: "#8d9ab6",
  card: "rgba(255, 255, 255, 0.055)",
  cardEdge: "rgba(255, 255, 255, 0.06)",
  separator: "rgba(255, 255, 255, 0.08)",
  hover: "rgba(255, 255, 255, 0.075)",
  pressed: "rgba(92, 140, 255, 0.28)",
  track: "rgba(0, 0, 0, 0.32)",
  accent: "#4d86ff",
  accentDeep: "#3466e0",
  /** An accent button under a pointer (the settings' Update badge). */
  accentHover: "#6a9bff",
  accentText: "#86b2ff",
  /** Words on an accent fill. */
  onAccent: "#ffffff",
  danger: "#ff7a70",
  switchOn: "#30d158",
  switchOff: "rgba(255, 255, 255, 0.16)",
  knob: "#ffffff",
  control: "rgba(255, 255, 255, 0.11)",
  controlHover: "rgba(255, 255, 255, 0.2)",
} as const;

export const UI_FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export type UiInk = typeof UI_INK;
