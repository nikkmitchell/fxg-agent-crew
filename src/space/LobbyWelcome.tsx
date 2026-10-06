import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { MENU_INK } from "./menu-paint";

/**
 * A SHORT WELCOME AND THE CONTROLS, on the lobby wall beside the doors.
 *
 * Nikk (5469): "a couple text panels inside of the lobby ... that give
 * instructions of how to control ... to the side of the room joining panel,
 * and don't be wordy ... just a few sentences explaining how to move, send
 * voice messages, and open settings, and a short welcome above. also sign the
 * message at the bottom as from yourself".
 *
 * Painted once into a canvas in the settings menu's colours, so the hall's
 * signs and its menu look like one place.
 */

export const WELCOME_TEXT = {
  title: "Welcome to saha.ing",
  intro: "People and agents work together here. Pick a door to go in.",
  sections: [
    {
      heading: "Move",
      lines: [
        "Controllers: left stick walks, right stick turns.",
        "Hands: hold a palm up for a second, then push the ball.",
      ],
    },
    {
      heading: "Send a voice message",
      lines: [
        "Controllers: press A or X, speak, press it again to send; B or Y cancels.",
        "Hands: hold a flat hand up in front of you, speak, then chop down to send. A fist cancels.",
      ],
    },
    {
      heading: "Settings",
      lines: ["Look up and press the gear."],
    },
  ],
  signature: "— Nightjar",
  about: "If you see a cute moth around, that's me. Say my name and I'll hear you.",
} as const;

const PX = { width: 1000, height: 960, pad: 56 } as const;
/** Canvas pixels per metre: the panel is 0.95 m wide. */
const PX_PER_METRE = PX.width / 0.95;
const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function paintWelcome(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height, pad } = PX;
  context.clearRect(0, 0, width, height);

  context.beginPath();
  context.roundRect(2, 2, width - 4, height - 4, 44);
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, MENU_INK.panelTop);
  shade.addColorStop(1, MENU_INK.panelBottom);
  context.fillStyle = shade;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = MENU_INK.panelEdge;
  context.stroke();

  const inner = width - pad * 2;
  context.textBaseline = "top";
  context.textAlign = "left";
  let y = pad;

  context.font = `700 58px ${FONT}`;
  context.fillStyle = MENU_INK.title;
  context.fillText(WELCOME_TEXT.title, pad, y);
  y += 82;
  context.font = `450 32px ${FONT}`;
  context.fillStyle = MENU_INK.soft;
  for (const line of wrap(context, WELCOME_TEXT.intro, inner)) {
    context.fillText(line, pad, y);
    y += 44;
  }
  y += 28;

  for (const section of WELCOME_TEXT.sections) {
    context.font = `700 24px ${FONT}`;
    context.fillStyle = MENU_INK.caption;
    context.fillText(section.heading.toUpperCase(), pad, y);
    y += 40;
    context.font = `500 32px ${FONT}`;
    context.fillStyle = MENU_INK.text;
    for (const text of section.lines) {
      for (const line of wrap(context, text, inner)) {
        context.fillText(line, pad, y);
        y += 43;
      }
      y += 8;
    }
    y += 24;
  }

  context.fillStyle = MENU_INK.separator;
  context.fillRect(pad, y, inner, 2);
  y += 30;
  context.font = `650 32px ${FONT}`;
  context.fillStyle = MENU_INK.accentText;
  context.fillText(WELCOME_TEXT.signature, pad, y);
  y += 48;
  context.font = `450 28px ${FONT}`;
  context.fillStyle = MENU_INK.dim;
  for (const line of wrap(context, WELCOME_TEXT.about, inner)) {
    context.fillText(line, pad, y);
    y += 40;
  }
}

/** The welcome sign, standing with its bottom edge `bottom` metres off the floor. */
export function LobbyWelcome({ bottom = 0.9 }: { bottom?: number }) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = PX.width;
    canvas.height = PX.height;
    paintWelcome(canvas);
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 4;
    return made;
  }, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  const width = PX.width / PX_PER_METRE;
  const height = PX.height / PX_PER_METRE;
  return (
    <mesh position={[0, bottom + height / 2, 0]} raycast={() => null}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.02} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
