import { CARD_INK, fitLines, type Ink } from "./card-paint.js";

/** No timers, scores, or treatment claims: three optional prompts, at your pace. */
export const MINDFULNESS_PRACTICES = [
  {
    id: "grounding",
    title: "5–4–3–2–1",
    subtitle: "A gentle tour of the senses",
    steps: [
      "Notice five things you can see. Let your gaze rest; there is nothing to find.",
      "Notice four points of contact or physical sensations. Skip anything uncomfortable.",
      "Notice three sounds, near or far.",
      "If it feels comfortable, notice two scents — or simply two details around you.",
      "Notice one taste, or take one easy breath. That is enough.",
    ],
  },
  {
    id: "notice",
    title: "Notice & return",
    subtitle: "Name it gently; come back to now",
    steps: [
      "Notice one thing holding your attention: a thought, feeling, sensation, or sound.",
      "Choose a quiet label: THINKING, FEELING, SENSING, or UNSURE. You can also pass.",
      "Let attention return to the room, a sound, your breath, or a task you choose.",
      "If attention wanders again, that is ordinary. Begin wherever you are.",
    ],
  },
  {
    id: "bright-spot",
    title: "A small bright spot",
    subtitle: "Gratitude, without the pressure",
    steps: [
      "Recall one small moment that felt okay, kind, useful, or pleasant. You may pass.",
      "Stay with one detail for a moment: a color, gesture, sound, or texture.",
      "If you like, write one sentence. Keep it private, or choose to share it with the room.",
    ],
  },
  {
    id: "wide-frame",
    title: "Widen the frame",
    subtitle: "Let the edges come into view",
    steps: [
      "Rest your eyes on something comfortable. If vision feels tiring, choose a sound or point of contact instead.",
      "Notice what is already at the edges of your awareness. No need to turn, search, or name anything.",
      "Let the center and edges—or the sound or contact—share attention for a breath. Blink, look away, or stop whenever you like.",
    ],
  },
] as const;

export type MindfulnessId = (typeof MINDFULNESS_PRACTICES)[number]["id"];
export type MindfulnessView = { id: MindfulnessId | null; step: number; complete: boolean; note: string };
export type MindfulnessTarget = { id: string; x: number; y: number; width: number; height: number };
export type SharedMindfulnessCard = { id: string; text: string; createdAt: string; mine: boolean };
export const MINDFULNESS_PRIVACY = "Private until you choose to share.";
export const MINDFULNESS_CANVAS = { width: 1024, height: 640 } as const;
export const EMPTY_MINDFULNESS: MindfulnessView = { id: null, step: 0, complete: false, note: "" };

/** The exact plain-text form the server stores, shared by preview and route. */
export function normalizeMindfulnessText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  const length = Array.from(text).length;
  return length >= 1 && length <= 240 ? text : null;
}

export function chooseMindfulness(_view: MindfulnessView, id: MindfulnessId): MindfulnessView {
  return { id, step: 0, complete: false, note: "" };
}

export function nextMindfulness(view: MindfulnessView): MindfulnessView {
  const flow = MINDFULNESS_PRACTICES.find((candidate) => candidate.id === view.id);
  if (!flow || view.complete) return view;
  if (view.step >= flow.steps.length - 1) return { ...view, complete: true };
  return { ...view, step: view.step + 1 };
}

export function backMindfulness(view: MindfulnessView): MindfulnessView {
  if (view.complete) return { ...view, complete: false };
  if (view.step > 0) return { ...view, step: view.step - 1 };
  return EMPTY_MINDFULNESS;
}

export function writeMindfulnessNote(view: MindfulnessView, note: string): MindfulnessView {
  const normalized = normalizeMindfulnessText(note);
  return { ...view, note: normalized ?? "" };
}

export function clearMindfulnessNote(view: MindfulnessView): MindfulnessView {
  return { ...view, note: "" };
}

export type MindfulnessScreen = "practice" | "share-preview" | "remove-preview" | "room-page";
export type MindfulnessPaintOptions = {
  screen?: MindfulnessScreen;
  cards?: SharedMindfulnessCard[];
  cardIndex?: number;
  hasOlder?: boolean;
  hasNewer?: boolean;
  notice?: string | null;
};

export function paintMindfulness(
  view: MindfulnessView,
  measure: (text: string, size: number) => number,
  options: MindfulnessPaintOptions = {},
): { ink: Ink[]; targets: MindfulnessTarget[] } {
  const { width, height } = MINDFULNESS_CANVAS;
  const screen = options.screen ?? "practice";
  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper },
    { kind: "rect", x: 0, y: 0, width, height: 8, fill: CARD_INK.accent },
    { kind: "text", x: 48, y: 46, text: "A PLACE TO NOTICE", size: 17, fill: CARD_INK.muted, weight: "bold" },
    { kind: "text", x: width - 48, y: 48, text: screen === "room-page" || screen === "remove-preview" ? "Shared with this room · kept between sessions" : MINDFULNESS_PRIVACY, size: 15, fill: CARD_INK.muted, align: "right" },
  ];
  const targets: MindfulnessTarget[] = [];
  const card = (x: number, y: number, w: number, h: number, title: string, body: string) => {
    ink.push({ kind: "rect", x, y, width: w, height: h, fill: CARD_INK.paperHeld, radius: 16 });
    ink.push({ kind: "rect", x, y, width: w, height: 4, fill: CARD_INK.edge });
    ink.push({ kind: "text", x: x + 20, y: y + 48, text: title, size: 23, fill: CARD_INK.ink, weight: "bold" });
    fitLines(measure, body, 18, w - 40, 5).forEach((line, index) => {
      ink.push({ kind: "text", x: x + 20, y: y + 88 + index * 27, text: line, size: 18, fill: CARD_INK.muted });
    });
  };
  const button = (id: string, label: string, x: number, y: number, w: number, primary = false) => {
    ink.push({ kind: "rect", x, y, width: w, height: 56, fill: primary ? CARD_INK.accent : CARD_INK.paperHeld, radius: 11 });
    const labelWidth = measure(label, 18);
    ink.push({ kind: "text", x: x + (w - labelWidth) / 2, y: y + 35, text: label, size: 18, fill: primary ? "#ffffff" : CARD_INK.ink, weight: primary ? "bold" : "normal" });
    targets.push({ id, x, y, width: w, height: 56 });
  };
  const notice = () => {
    if (options.notice) ink.push({ kind: "text", x: 48, y: height - 12, text: fitLines(measure, options.notice, 14, width - 96, 1)[0] ?? "", size: 14, fill: CARD_INK.refused });
  };

  if (screen === "share-preview") {
    ink.push({ kind: "text", x: 48, y: 98, text: "Before it joins the room page", size: 32, fill: CARD_INK.ink, weight: "bold" });
    card(88, 132, 848, 250, "Your exact words", view.note || "Nothing written yet.");
    fitLines(measure, "Everyone in this room can read this card. It stays here between sessions. Your name is not shown; you can remove your own card later.", 18, 800, 3)
      .forEach((line, index) => ink.push({ kind: "text", x: 112, y: 424 + index * 27, text: line, size: 18, fill: CARD_INK.muted }));
    button("cancel-share", "Keep it private", 88, 526, 260);
    button("confirm-share", "Share this card", 676, 526, 260, true);
    notice();
    return { ink, targets };
  }

  if (screen === "remove-preview") {
    const current = options.cards?.[options.cardIndex ?? 0];
    ink.push({ kind: "text", x: 48, y: 98, text: "Remove your card?", size: 34, fill: CARD_INK.ink, weight: "bold" });
    card(88, 144, 848, 238, "This exact card will be removed", current?.text ?? "No card selected.");
    ink.push({ kind: "text", x: 112, y: 424, text: "This cannot be undone; the rest of the room page stays.", size: 18, fill: CARD_INK.muted });
    button("cancel-remove", "Keep the card", 88, 526, 260);
    button("confirm-remove", "Remove my card", 676, 526, 260, true);
    notice();
    return { ink, targets };
  }

  if (screen === "room-page") {
    const cards = options.cards ?? [];
    const index = Math.max(0, Math.min(options.cardIndex ?? 0, Math.max(0, cards.length - 1)));
    const current = cards[index];
    ink.push({ kind: "text", x: 48, y: 98, text: "The room's page", size: 36, fill: CARD_INK.ink, weight: "bold" });
    ink.push({ kind: "text", x: 48, y: 133, text: "Shared by choice · kept between sessions · names stay private", size: 17, fill: CARD_INK.muted });
    if (!current) {
      card(88, 168, 848, 258, "The first page is blank", "When someone wants to share a small bright spot, it will live here. Nothing is required.");
    } else {
      card(88, 168, 848, 258, "A small bright spot", current.text);
      const date = new Date(current.createdAt);
      const stamp = Number.isNaN(date.getTime()) ? "" : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
      ink.push({ kind: "text", x: 112, y: 392, text: stamp, size: 16, fill: CARD_INK.muted });
      if (current.mine) button("remove-card", "Remove my card", 680, 452, 256);
    }
    button("page-back", "Practices", 48, 526, 220);
    button("page-add", "Write a bright spot", 320, 526, 300, true);
    button("page-newer", "← Newer", 660, 526, 128, !options.hasNewer);
    button("page-older", "Older →", 808, 526, 128, !!options.hasOlder);
    if (!options.hasNewer) targets.splice(targets.findIndex((one) => one.id === "page-newer"), 1);
    if (!options.hasOlder) targets.splice(targets.findIndex((one) => one.id === "page-older"), 1);
    notice();
    return { ink, targets };
  }

  const active = MINDFULNESS_PRACTICES.find((candidate) => candidate.id === view.id);
  if (!active) {
    ink.push({ kind: "text", x: 48, y: 98, text: "Practice", size: 38, fill: CARD_INK.ink, weight: "bold" });
    ink.push({ kind: "text", x: 48, y: 137, text: "Choose one. Move at your own pace; skip or stop whenever you like.", size: 19, fill: CARD_INK.muted });
    const twoRows = MINDFULNESS_PRACTICES.length > 3;
    const choices = twoRows
      ? [
          { x: 48, y: 162, width: 448, height: 154 },
          { x: 528, y: 162, width: 448, height: 154 },
          { x: 48, y: 328, width: 448, height: 154 },
          { x: 528, y: 328, width: 448, height: 154 },
        ]
      : [48, 368, 688].map((x) => ({ x, y: 178, width: 288, height: 252 }));
    MINDFULNESS_PRACTICES.forEach((flow, index) => {
      const choice = choices[index];
      if (!choice) return;
      const { x, y, width: cardWidth, height: cardHeight } = choice;
      card(x, y, cardWidth, cardHeight, flow.title, flow.subtitle);
      ink.push({ kind: "text", x: x + 20, y: y + cardHeight - 16, text: "BEGIN →", size: 18, fill: CARD_INK.accent, weight: "bold" });
      targets.push({ id: `choose:${flow.id}`, x, y, width: cardWidth, height: cardHeight });
    });
    button("open-page", "Read the room's page", 48, twoRows ? 502 : 466, 300);
    ink.push({ kind: "text", x: 48, y: twoRows ? 592 : 556, text: "No timer, score, or required sharing. Stop or skip whenever you like.", size: 16, fill: CARD_INK.muted });
    notice();
    return { ink, targets };
  }

  if (view.complete) {
    ink.push({ kind: "text", x: 48, y: 98, text: "Practice", size: 38, fill: CARD_INK.ink, weight: "bold" });
    card(88, 160, 848, 276, "That is enough.", "No score, streak, or reflection to keep. Return to the room whenever you are ready.");
    button("home", "Choose another", 372, 496, 280, true);
    return { ink, targets };
  }

  const prompt = active.steps[view.step] ?? active.steps[0];
  ink.push({ kind: "text", x: 48, y: 98, text: active.title, size: 30, fill: CARD_INK.ink, weight: "bold" });
  ink.push({ kind: "text", x: width - 48, y: 98, text: `STEP ${view.step + 1} OF ${active.steps.length}`, size: 15, fill: CARD_INK.muted, align: "right" });
  ink.push({ kind: "rect", x: 88, y: 174, width: 848, height: 280, fill: CARD_INK.paperHeld, radius: 16 });
  ink.push({ kind: "rect", x: 88, y: 174, width: 848, height: 4, fill: CARD_INK.edge });
  fitLines(measure, prompt, 28, 760, 4).forEach((line, index) => {
    ink.push({ kind: "text", x: 128, y: 276 + index * 42, text: line, size: 28, fill: CARD_INK.ink, weight: "bold" });
  });
  if (active.id === "bright-spot" && view.note) {
    fitLines(measure, view.note, 16, 760, 2).forEach((line, index) => {
      ink.push({ kind: "text", x: 128, y: 414 + index * 22, text: line, size: 16, fill: CARD_INK.muted });
    });
  }

  if (active.id === "bright-spot" && view.step === active.steps.length - 1) {
    button("write", view.note ? "Edit sentence" : "Write a sentence", 488, 466, 230, true);
    if (view.note) button("review-share", "Share…", 736, 466, 144);
    if (view.note) button("clear", "Erase", 892, 466, 84);
  }
  ink.push({ kind: "text", x: 48, y: 542, text: "A draft stays only while this panel is open; it is private until you confirm a share.", size: 15, fill: CARD_INK.muted });
  button("home", "All practices", 48, 568, 204);
  if (view.step > 0) button("back", "← Back", 280, 568, 144);
  button("next", view.step === active.steps.length - 1 ? "Finish" : "Next · pass →", 772, 568, 204, true);
  return { ink, targets };
}

export function mindfulnessTargetAt(targets: MindfulnessTarget[], x: number, y: number): string | null {
  return targets.find((target) => x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height)?.id ?? null;
}
