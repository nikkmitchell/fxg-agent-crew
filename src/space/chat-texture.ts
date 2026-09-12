import * as THREE from "three";
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
 * NEWEST AT THE BOTTOM and older scrolled off the top, because a panel in a
 * headset cannot be scrolled and the useful end of a conversation is the end.
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
};

/** Split one message body into lines that fit, longest-first, greedily. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width || !line) line = candidate;
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
export function paintChat(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  paint: ChatPaint,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#f2efe6";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // The room's name, so a panel showing an unexpected conversation says which
  // one it is rather than leaving you to guess.
  context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = "#8a8578";
  context.textBaseline = "top";
  context.fillText(paint.room ?? "no room", PAD, PAD - 6);

  const top = PAD + NAME_SIZE + 12;
  const bottom = HEIGHT - PAD - (paint.trouble ? LINE : 0);
  const innerWidth = WIDTH - PAD * 2;

  // BUILT FROM THE BOTTOM UP. Lay out newest first and stop once the space is
  // used, so the end of the conversation is always the part that survives.
  type Block = { name: string; when: string; lines: string[] };
  const blocks: Block[] = [];
  let used = 0;
  for (let i = paint.messages.length - 1; i >= 0; i -= 1) {
    const message = paint.messages[i];
    context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    const lines = wrap(context, message.content, innerWidth);
    const height = NAME_SIZE + 6 + lines.length * LINE + GAP;
    if (used + height > bottom - top) break;
    used += height;
    blocks.unshift({
      name: message.username,
      // Time only: the date is today in every case that matters, and a full
      // timestamp at this size costs a third of the line.
      when: message.createdAt.slice(11, 16),
      lines,
    });
  }

  let y = bottom - used;
  for (const block of blocks) {
    context.font = `600 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = "#1f2430";
    context.fillText(block.name, PAD, y);
    const nameWidth = context.measureText(block.name).width;
    context.font = `400 ${NAME_SIZE - 3}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = "#a09a8c";
    context.fillText(block.when, PAD + nameWidth + 10, y + 2);
    y += NAME_SIZE + 6;

    context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = "#2b2f38";
    for (const line of block.lines) {
      context.fillText(line, PAD, y);
      y += LINE;
    }
    y += GAP;
  }

  if (blocks.length === 0 && !paint.trouble) {
    context.font = `400 ${BODY_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = "#8a8578";
    context.fillText("Reading the room…", PAD, top);
  }

  // TROUBLE ALONG THE BOTTOM, never instead of the messages. A feed that has
  // stopped updating still has its last state worth reading, and replacing it
  // with an error would hide the very thing somebody is standing there for.
  if (paint.trouble) {
    context.font = `400 ${NAME_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = "#8a3d3d";
    context.fillText(paint.trouble, PAD, HEIGHT - PAD - NAME_SIZE);
  }

  texture.needsUpdate = true;
}

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
