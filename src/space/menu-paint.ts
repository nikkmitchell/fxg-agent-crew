import { MENU, type LaidRow, type MenuLayout, type Rect } from "./menu-layout";

/**
 * Draw a laid-out settings menu into a 2D canvas.
 *
 * THE LOOK: dark glass, the way a headset's own system panels are — one card
 * with a hairline edge, a segmented tab bar, grouped lists with separators,
 * switches for on/off, dim values on the right, and a hover under whatever the
 * pointer is on. Nikk (5426, 5439): "make it much cleaner", "make the UI look
 * nice and more organised".
 *
 * Only colour and type live here; where things go is menu-layout.ts.
 */

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export const MENU_INK = {
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
  accentText: "#86b2ff",
  danger: "#ff7a70",
  switchOn: "#30d158",
  switchOff: "rgba(255, 255, 255, 0.16)",
  knob: "#ffffff",
  control: "rgba(255, 255, 255, 0.11)",
  controlHover: "rgba(255, 255, 255, 0.2)",
} as const;

type Corners = { tl: number; tr: number; br: number; bl: number };

function roundedPath(context: CanvasRenderingContext2D, rect: Rect, radius: number | Corners): void {
  const r = typeof radius === "number" ? { tl: radius, tr: radius, br: radius, bl: radius } : radius;
  const { x, y, width: w, height: h } = rect;
  context.beginPath();
  context.moveTo(x + r.tl, y);
  context.lineTo(x + w - r.tr, y);
  context.arcTo(x + w, y, x + w, y + r.tr, r.tr);
  context.lineTo(x + w, y + h - r.br);
  context.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
  context.lineTo(x + r.bl, y + h);
  context.arcTo(x, y + h, x, y + h - r.bl, r.bl);
  context.lineTo(x, y + r.tl);
  context.arcTo(x, y, x + r.tl, y, r.tl);
  context.closePath();
}

function font(context: CanvasRenderingContext2D, size: number, weight = 500): void {
  context.font = `${weight} ${size}px ${FONT}`;
}

/** The text, cut with an ellipsis until it fits `width`. */
export function fitText(measure: (text: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`) <= width) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "…";
}

/** At most two lines, the second cut with an ellipsis if it must be. */
function twoLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const measure = (value: string) => context.measureText(value).width;
  if (measure(text) <= width) return [text];
  const words = text.split(/\s+/);
  let first = "";
  let used = 0;
  for (; used < words.length; used += 1) {
    const next = first ? `${first} ${words[used]}` : words[used];
    if (measure(next) > width && first) break;
    first = next;
  }
  const rest = words.slice(used).join(" ");
  return rest ? [fitText(measure, first, width), fitText(measure, rest, width)] : [fitText(measure, first, width)];
}

function drawChevron(context: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  context.save();
  context.strokeStyle = colour;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(x - 6, y - 11);
  context.lineTo(x + 5, y);
  context.lineTo(x - 6, y + 11);
  context.stroke();
  context.restore();
}

function drawCheck(context: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  context.save();
  context.strokeStyle = colour;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(x - 13, y + 1);
  context.lineTo(x - 4, y + 10);
  context.lineTo(x + 13, y - 10);
  context.stroke();
  context.restore();
}

function drawSwitch(context: CanvasRenderingContext2D, right: number, mid: number, on: boolean, disabled: boolean): void {
  const w = MENU.switchWidth;
  const h = MENU.switchHeight;
  const rect = { x: right - w, y: mid - h / 2, width: w, height: h };
  context.save();
  context.globalAlpha = disabled ? 0.4 : 1;
  roundedPath(context, rect, h / 2);
  context.fillStyle = on ? MENU_INK.switchOn : MENU_INK.switchOff;
  context.fill();
  const knob = h / 2 - 4;
  const cx = on ? rect.x + w - h / 2 : rect.x + h / 2;
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = 6;
  context.shadowOffsetY = 2;
  context.beginPath();
  context.arc(cx, mid, knob, 0, Math.PI * 2);
  context.fillStyle = MENU_INK.knob;
  context.fill();
  context.restore();
}

function drawRoundButton(context: CanvasRenderingContext2D, rect: Rect, glyph: "less" | "more", state: "rest" | "hover" | "pressed"): void {
  context.save();
  context.beginPath();
  context.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, 0, Math.PI * 2);
  context.fillStyle = state === "pressed" ? MENU_INK.accent : state === "hover" ? MENU_INK.controlHover : MENU_INK.control;
  context.fill();
  context.strokeStyle = MENU_INK.text;
  context.lineWidth = 4;
  context.lineCap = "round";
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  context.beginPath();
  context.moveTo(cx - 10, cy);
  context.lineTo(cx + 10, cy);
  if (glyph === "more") {
    context.moveTo(cx, cy - 10);
    context.lineTo(cx, cy + 10);
  }
  context.stroke();
  context.restore();
}

function stateOf(id: string, hover: string | null, pressed: string | null): "rest" | "hover" | "pressed" {
  return pressed === id ? "pressed" : hover === id ? "hover" : "rest";
}

function drawRow(context: CanvasRenderingContext2D, laid: LaidRow, layout: MenuLayout, hover: string | null, pressed: string | null): void {
  const { row, id, rect } = laid;
  const inset = MENU.rowInset;
  const mid = rect.y + rect.height / 2;
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const radius = MENU.cardRadius;
  const shape: Corners = { tl: laid.first ? radius : 0, tr: laid.first ? radius : 0, br: laid.last ? radius : 0, bl: laid.last ? radius : 0 };

  // The row's own highlight: the whole row is one target for most kinds.
  const whole = layout.targets.find((target) => target.id === id);
  if (whole && whole.width >= rect.width - 1) {
    const state = stateOf(id, hover, pressed);
    if (state !== "rest") {
      roundedPath(context, rect, shape);
      context.fillStyle = state === "pressed" ? MENU_INK.pressed : MENU_INK.hover;
      context.fill();
    }
  }

  if (!laid.last) {
    context.fillStyle = MENU_INK.separator;
    context.fillRect(left, rect.y + rect.height - 1.5, rect.width - inset, 1.5);
  }

  const measure = (text: string) => context.measureText(text).width;
  context.textBaseline = "middle";
  context.textAlign = "left";

  switch (row.kind) {
    case "note": {
      font(context, 23, 450);
      context.fillStyle = MENU_INK.dim;
      const lines = twoLines(context, row.label, rect.width - inset * 2);
      lines.forEach((line, index) => context.fillText(line, left, mid + (index - (lines.length - 1) / 2) * 30));
      return;
    }
    case "toggle": {
      const labelWidth = rect.width - inset * 3 - MENU.switchWidth;
      font(context, 28, 500);
      context.fillStyle = row.disabled ? MENU_INK.faint : MENU_INK.text;
      if (row.detail) {
        context.fillText(fitText(measure, row.label, labelWidth), left, mid - 13);
        font(context, 21, 450);
        context.fillStyle = MENU_INK.dim;
        context.fillText(fitText(measure, row.detail, labelWidth), left, mid + 19);
      } else {
        context.fillText(fitText(measure, row.label, labelWidth), left, mid);
      }
      drawSwitch(context, right, mid, row.on, Boolean(row.disabled));
      return;
    }
    case "choice": {
      font(context, 28, row.selected ? 600 : 500);
      context.fillStyle = row.selected ? MENU_INK.text : MENU_INK.soft;
      context.fillText(fitText(measure, row.label, rect.width - inset * 3 - 30), left, mid);
      if (row.selected) drawCheck(context, right - 14, mid, MENU_INK.accentText);
      return;
    }
    case "link":
    case "action": {
      const tone = row.kind === "action" ? row.tone ?? "normal" : "normal";
      const chevron = row.kind === "link" ? 26 : 0;
      font(context, 26, 450);
      const value = row.value ? fitText(measure, row.value, rect.width * 0.42) : "";
      const valueWidth = value ? measure(value) + 16 : 0;
      if (value) {
        context.textAlign = "right";
        context.fillStyle = MENU_INK.dim;
        context.fillText(value, right - chevron, mid);
        context.textAlign = "left";
      }
      font(context, 28, tone === "normal" ? 500 : 600);
      context.fillStyle = tone === "accent" ? MENU_INK.accentText : tone === "danger" ? MENU_INK.danger : MENU_INK.text;
      context.fillText(fitText(measure, row.label, rect.width - inset * 2 - chevron - valueWidth), left, mid);
      if (row.kind === "link") drawChevron(context, right - 6, mid, MENU_INK.faint);
      return;
    }
    case "stepper": {
      const plus = { x: right - MENU.stepButton, y: mid - MENU.stepButton / 2, width: MENU.stepButton, height: MENU.stepButton };
      const minus = { ...plus, x: plus.x - MENU.stepValue - MENU.stepButton };
      drawRoundButton(context, minus, "less", stateOf(`${id}:less`, hover, pressed));
      drawRoundButton(context, plus, "more", stateOf(`${id}:more`, hover, pressed));
      font(context, 26, 600);
      context.textAlign = "center";
      context.fillStyle = MENU_INK.text;
      context.fillText(row.value, minus.x + MENU.stepButton + MENU.stepValue / 2, mid);
      context.textAlign = "left";
      font(context, 28, 500);
      context.fillText(fitText(measure, row.label, minus.x - left - 12), left, mid);
      return;
    }
    case "buttons": {
      const pills = layout.targets.filter((target) => target.id.startsWith(`${id}:b`));
      const firstPill = pills.reduce((min, pill) => Math.min(min, pill.x), right);
      font(context, 28, 500);
      context.fillStyle = MENU_INK.text;
      context.fillText(fitText(measure, row.label, firstPill - left - 12), left, mid);
      font(context, 22, 600);
      context.textAlign = "center";
      pills.forEach((pill, index) => {
        const state = stateOf(pill.id, hover, pressed);
        roundedPath(context, pill, pill.height / 2);
        context.fillStyle = state === "pressed" ? MENU_INK.accent : state === "hover" ? MENU_INK.controlHover : MENU_INK.control;
        context.fill();
        context.fillStyle = MENU_INK.text;
        context.fillText(fitText(measure, row.buttons[index]?.label ?? "", pill.width - 16), pill.x + pill.width / 2, pill.y + pill.height / 2 + 1);
      });
      context.textAlign = "left";
      return;
    }
  }
}

export function paintMenu(context: CanvasRenderingContext2D, layout: MenuLayout, hover: string | null, pressed: string | null): void {
  const { width, height } = layout;
  context.clearRect(0, 0, width, height);

  // THE CARD, with a soft top-to-bottom shade and a hairline edge.
  const panel = { x: 2, y: 2, width: width - 4, height: height - 4 };
  roundedPath(context, panel, MENU.radius);
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, MENU_INK.panelTop);
  shade.addColorStop(1, MENU_INK.panelBottom);
  context.fillStyle = shade;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = MENU_INK.panelEdge;
  context.stroke();

  const measure = (text: string) => context.measureText(text).width;
  const headerMid = MENU.pad + MENU.headerHeight / 2;

  // TITLE, left.
  context.textBaseline = "middle";
  context.textAlign = "left";
  font(context, 32, 650);
  context.fillStyle = MENU_INK.title;
  if (!layout.badge) context.fillText(fitText(measure, layout.title, layout.tabTrack.x - MENU.pad - 24), MENU.pad + 12, headerMid);

  // THE UPDATE BADGE, beside the title.
  if (layout.badge) {
    const b = layout.badge;
    const state = stateOf("badge", hover, pressed);
    roundedPath(context, b, b.height / 2);
    context.fillStyle = state === "pressed" ? MENU_INK.accentDeep : state === "hover" ? "#6a9bff" : MENU_INK.accent;
    context.fill();
    font(context, 22, 650);
    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.fillText(fitText(measure, b.label, b.width - 20), b.x + b.width / 2, b.y + b.height / 2 + 1);
    context.textAlign = "left";
  }

  // TABS, one segmented control.
  roundedPath(context, layout.tabTrack, layout.tabTrack.height / 2);
  context.fillStyle = MENU_INK.track;
  context.fill();
  for (const tab of layout.tabs) {
    const state = stateOf(`tab:${tab.id}`, hover, pressed);
    if (tab.active || state !== "rest") {
      roundedPath(context, tab, tab.height / 2);
      if (tab.active) {
        const fill = context.createLinearGradient(0, tab.y, 0, tab.y + tab.height);
        fill.addColorStop(0, MENU_INK.accent);
        fill.addColorStop(1, MENU_INK.accentDeep);
        context.fillStyle = fill;
      } else {
        context.fillStyle = state === "pressed" ? MENU_INK.pressed : MENU_INK.hover;
      }
      context.fill();
    }
    font(context, 24, tab.active ? 650 : 550);
    context.textAlign = "center";
    context.fillStyle = tab.active ? "#ffffff" : MENU_INK.soft;
    context.fillText(fitText(measure, tab.label, tab.width - 20), tab.x + tab.width / 2, tab.y + tab.height / 2 + 1);
  }

  // CLOSE, a round ✕ in the corner.
  const closeState = stateOf("close", hover, pressed);
  const c = layout.close;
  context.beginPath();
  context.arc(c.x + c.width / 2, c.y + c.height / 2, c.width / 2, 0, Math.PI * 2);
  context.fillStyle = closeState === "pressed" ? MENU_INK.pressed : closeState === "hover" ? MENU_INK.controlHover : MENU_INK.control;
  context.fill();
  context.save();
  context.strokeStyle = MENU_INK.text;
  context.lineWidth = 4;
  context.lineCap = "round";
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;
  context.beginPath();
  context.moveTo(cx - 10, cy - 10);
  context.lineTo(cx + 10, cy + 10);
  context.moveTo(cx + 10, cy - 10);
  context.lineTo(cx - 10, cy + 10);
  context.stroke();
  context.restore();

  // MOVE, a round four-way arrow beside close: hold it and point to carry the menu.
  const moveState = stateOf("move", hover, pressed);
  const m = layout.move;
  const mx = m.x + m.width / 2;
  const my = m.y + m.height / 2;
  context.beginPath();
  context.arc(mx, my, m.width / 2, 0, Math.PI * 2);
  context.fillStyle = moveState === "pressed" ? MENU_INK.pressed : moveState === "hover" ? MENU_INK.controlHover : MENU_INK.control;
  context.fill();
  context.save();
  context.strokeStyle = MENU_INK.text;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tipX = mx + dx * 14;
    const tipY = my + dy * 14;
    context.moveTo(mx, my);
    context.lineTo(tipX, tipY);
    // The arrowhead: two short strokes back from the tip.
    context.moveTo(tipX - dx * 5 + dy * 5, tipY - dy * 5 + dx * 5);
    context.lineTo(tipX, tipY);
    context.lineTo(tipX - dx * 5 - dy * 5, tipY - dy * 5 - dx * 5);
  }
  context.stroke();
  context.restore();

  // SECTIONS: a caption over a grouped list.
  for (const column of layout.columns) {
    if (column.title) {
      context.textAlign = "left";
      font(context, 20, 700);
      context.fillStyle = MENU_INK.caption;
      const caption = column.title.toUpperCase();
      // Letter-spaced by hand: canvas letterSpacing is not everywhere yet.
      let x = column.x + MENU.rowInset - 4;
      const y = column.card.y - MENU.captionHeight / 2 - 2;
      for (const letter of fitText(measure, caption, column.width - MENU.rowInset)) {
        context.fillText(letter, x, y);
        x += measure(letter) + 1.6;
      }
    }
    roundedPath(context, column.card, MENU.cardRadius);
    context.fillStyle = MENU_INK.card;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = MENU_INK.cardEdge;
    context.stroke();
    for (const laid of column.rows) drawRow(context, laid, layout, hover, pressed);
  }
}
