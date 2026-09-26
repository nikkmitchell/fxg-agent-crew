import * as THREE from "three";
import { avatarRecipe } from "../avatar";
import { bubbleFor, chatInk } from "../../shared/room-theme";
import { scrollThumb } from "../../shared/chat-scroll";
import type { RoomMessage } from "./useRoomFeed";

/**
 * The chat, drawn rather than photographed.
 *
 * EVERY OTHER PANEL IN A HEADSET IS A PHOTOGRAPH taken on the server, because
 * DOM is not composited into an immersive frame. That cannot work for this one:
 * the server's renderer signs in as a session with no WebHarness token, so what
 * it would photograph is the sentence saying the room could not be read. The
 * viewer's own browser CAN read it — it is signed in, and its JavaScript keeps
 * running throughout an immersive session even though its DOM is not shown.
 *
 * So the messages are fetched by the page and painted into a canvas here. The
 * side effect is that this is the one panel in a headset that is actually live
 * rather than a few seconds old.
 *
 * NEWEST AT THE BOTTOM, and the wall rests there.
 *
 * WHOLE MESSAGES, AND IT SCROLLS. Nikk, 2026-09-26 (4936): "the chat in XR
 * should show the entire messages and as well allow for a scroll ... when a
 * new message comes it should automatically scroll down to the bottom". Each
 * message used to be cut to a few sentences and "N words more in chat", and
 * the wall could not be moved. Now every word is drawn, and `scroll` (pixels
 * lifted off the newest message, see shared/chat-scroll.ts) picks which part
 * of the conversation the wall shows. ChatPanel3D drives it from a drag or a
 * wheel, locally, and puts it back to 0 when something new is said.
 *
 * ONE BUBBLE PER SPEAKER, COLOURED BY WHO THEY ARE. The colour comes from
 * `avatarRecipe`, the same FNV-1a hash of the username that draws their mark on
 * the People page and their figure in the room — so the colour of a message is
 * the colour of the person, everywhere, and there is no second palette to drift
 * out of step with the first. Never decoration: at a glance across a room, hue
 * is the only thing that separates two speakers.
 */

const WIDTH = 1024;
/** Matches the panel's 4.0 x 2.5 metres, so nothing is stretched. */
const HEIGHT = 640;
const PAD = 26;
const NAME_SIZE = 21;
const BODY_SIZE = 23;
const LINE = 29;
const GAP = 13;

export type ChatPaint = {
  messages: RoomMessage[];
  room: string | null;
  trouble: string | null;
  /** How far the view is lifted off the newest message, in canvas pixels. */
  scroll: number;
};

/** What a paint laid out, so the caller can keep its scroll in range. */
export type ChatExtent = { content: number; view: number };

/** A rounded rectangle path. `roundRect` is not in every engine we run in. */
function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Split one message body into lines that fit.
 *
 * Exported because it is the only part of the painting that can be tested
 * without a 2D context: measuring is injected, so a test can supply a ruler
 * that says one character is one unit. The colours and the rounded corners
 * below are drawing code and are NOT tested — they are checked by looking.
 */
export function wrap(
  measure: { measureText(text: string): { width: number } },
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure.measureText(candidate).width <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Paint the feed into a canvas and hand back a texture.
 *
 * The canvas is reused across paints — allocating a megabyte of canvas every
 * time somebody says something is how a scene ends up stuttering — but the
 * texture is marked dirty so three uploads the new pixels.
 */
/**
 * EACH MESSAGE WRAPPED ONCE. Dragging the wall repaints it on every pointer
 * move, and wrapping all eighty kept messages again each time measured every
 * word of them: thousands of measureText calls a frame, in a headset. A
 * message's words never change, so its lines are kept by its id, its length
 * and the width they were wrapped to; scrolling now only draws.
 */
const wrapped = new Map<string, string[]>();
function wrappedLines(context: CanvasRenderingContext2D, message: RoomMessage, width: number): string[] {
  const key = `${message.id}\u0000${message.content.length}\u0000${width}`;
  const known = wrapped.get(key);
  if (known) return known;
  const lines = wrap(context, message.content.trim(), width);
  if (wrapped.size > 400) wrapped.clear();
  wrapped.set(key, lines);
  return lines;
}

export function paintChat(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  paint: ChatPaint,
): ChatExtent {
  const context = canvas.getContext("2d");
  if (!context) return { content: 0, view: 0 };

  // The wall's colours come from the room theme — dark unless somebody turned
  // it off. See shared/room-theme.ts.
  const wall = chatInk();
  context.fillStyle = wall.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // The room's name, so a panel showing an unexpected conversation says which
  // one it is rather than leaving you to guess.
  context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = wall.meta;
  context.textBaseline = "top";
  context.fillText(paint.room ?? "no room", PAD, PAD - 6);

  const top = PAD + NAME_SIZE + 12;
  const bottom = HEIGHT - PAD - (paint.trouble ? LINE : 0);
  const view = bottom - top;
  // Room on the right for the scroll bar.
  const innerWidth = WIDTH - PAD * 2 - 14;

  // Every message, whole, laid out top to bottom in content pixels.
  type Block = { name: string; when: string; lines: string[]; height: number };
  const blocks: Block[] = [];
  context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  for (const message of paint.messages) {
    const lines = wrappedLines(context, message, innerWidth - 28);
    blocks.push({
      name: message.username,
      // Time only: the date is today in every case that matters, and a full
      // timestamp at this size costs a third of the line.
      when: message.createdAt.slice(11, 16),
      lines,
      height: NAME_SIZE + 6 + lines.length * LINE + GAP + 16,
    });
  }
  const content = blocks.reduce((sum, block) => sum + block.height, 0);
  const up = Math.max(0, Math.min(paint.scroll, Math.max(0, content - view)));

  // The window: content from `content - view - up` to `content - up`. Drawn
  // with the wall clipped to it, so a message half out of view is cut cleanly
  // at the edge rather than painted over the room's name.
  context.save();
  context.beginPath();
  context.rect(0, top - 12, WIDTH, view + 12);
  context.clip();
  // Short conversations sit at the bottom, where the newest always is.
  let y = content <= view ? bottom - content : top - (content - view - up);
  for (const block of blocks) {
    const blockTop = y;
    y += block.height;
    if (y < top - 20 || blockTop > bottom + 20) continue;
    paintBlock(context, block, blockTop + 10, innerWidth);
  }
  context.restore();

  // THE SCROLL BAR, only when there is more than fits: where you are in the
  // conversation, at a glance.
  const thumb = scrollThumb(up, content, view);
  if (thumb) {
    context.fillStyle = wall.meta;
    context.globalAlpha = 0.18;
    roundedRect(context, WIDTH - PAD - 6, top, 6, view, 3);
    context.fill();
    context.globalAlpha = 0.7;
    roundedRect(context, WIDTH - PAD - 6, top + thumb.from * view, 6, thumb.length * view, 3);
    context.fill();
    context.globalAlpha = 1;
  }
  // READING BACK SAYS SO, so nobody mistakes an old message for the latest.
  if (up > 0) {
    context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    const note = "reading back · drag up for the newest";
    const width = context.measureText(note).width;
    context.fillStyle = wall.meta;
    context.fillText(note, WIDTH - PAD - 20 - width, PAD - 6);
  }

  if (blocks.length === 0 && !paint.trouble) {
    context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = wall.meta;
    context.fillText("Reading the room…", PAD, top);
  }

  // TROUBLE ALONG THE BOTTOM, never instead of the messages. A feed that has
  // stopped updating still has its last state worth reading, and replacing it
  // with an error would hide the very thing somebody is standing there for.
  if (paint.trouble) {
    context.font = `400 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = wall.failed;
    context.fillText(paint.trouble, PAD, HEIGHT - PAD - NAME_SIZE);
  }

  texture.needsUpdate = true;
  return { content, view };
}

/** One speaker's bubble, its top at `y`. */
function paintBlock(
  context: CanvasRenderingContext2D,
  block: { name: string; when: string; lines: string[] },
  y: number,
  innerWidth: number,
): void {
  const recipe = bubbleFor(avatarRecipe(block.name));
  const height = NAME_SIZE + 6 + block.lines.length * LINE;
  context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  const widest = Math.max(
    ...block.lines.map((line) => context.measureText(line).width),
    (() => {
      context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
      return context.measureText(`${block.name}  ${block.when}`).width;
    })(),
  );

  // The bubble: the speaker's own paper, with their accent down the leading
  // edge so two people with similar papers are still told apart.
  context.fillStyle = recipe.paper;
  roundedRect(context, PAD, y - 10, Math.min(widest + 28, innerWidth), height + 16, 12);
  context.fill();
  context.fillStyle = recipe.accent;
  roundedRect(context, PAD, y - 10, 6, height + 16, 3);
  context.fill();

  const textLeft = PAD + 18;
  context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = recipe.ink;
  context.fillText(block.name, textLeft, y);
  const nameWidth = context.measureText(block.name).width;
  context.font = `400 ${NAME_SIZE - 3}px ui-sans-serif, system-ui, sans-serif`;
  context.globalAlpha = 0.62;
  context.fillText(block.when, textLeft + nameWidth + 10, y + 2);
  context.globalAlpha = 1;
  y += NAME_SIZE + 6;

  context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = recipe.ink;
  for (const line of block.lines) {
    context.fillText(line, textLeft, y);
    y += LINE;
  }
}

/** The canvas's size, for turning a drag across the panel into pixels. */
export const CHAT_CANVAS_HEIGHT = HEIGHT;

export function makeChatCanvas(): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}
