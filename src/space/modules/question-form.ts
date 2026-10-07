import * as THREE from "three";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../api-request";
import { space } from "../../space-client";
import type { QuestionHost } from "../../engine/host";
import type { AskRefusal, AskResult, Person, Question } from "../../engine/types";

/**
 * THE ROOM'S QUESTION PANEL: ctx.questions (src/engine/types.ts) on saha.ing
 * (Mica 7319, 7322; the Library's lectern).
 *
 * THE ROOM WRITES, NOT THE THING. A thing asks for the panel; the person types
 * in the room's own Typing3D (3D keys, the Quest keyboard and its dictation, a
 * desktop keyboard), sees where the question goes and under whose name, and
 * presses Send. A thing never sees the keys and cannot make up a question in
 * somebody's name.
 *
 * ONE PANEL A PAGE, held here rather than in a component, so the thing that
 * opened it and the panel drawn in the scene agree on it. Taking the thing away
 * closes it (the instance owns `close`): never a Send left for a thing that has
 * gone.
 *
 * ONE REQUEST KEY A PANEL. Sending again after a dropped connection carries the
 * same key, so the server answers with the card it already made.
 */

export type OpenQuestion = {
  /** The request key, made when the panel opens. */
  key: string;
  instance: string;
  /** The room item it is asked at: the instance's top-level thing. */
  item: string;
  /** What it is for, where it goes and as whom: "Ask the Library · posted to the open-source-library board as Nikk2". */
  header: string;
  at: THREE.Vector3;
  /** Facing the person who opened it. */
  yaw: number;
  /** What was written, kept when a send fails so it can be sent again. */
  draft: string;
  problem: string | null;
  sending: boolean;
};

let open: OpenQuestion | null = null;
let finish: ((result: AskResult) => void) | null = null;
const listeners = new Set<() => void>();
const show = (next: OpenQuestion | null) => {
  open = next;
  for (const listener of listeners) listener();
};

export const useOpenQuestion = (): OpenQuestion | null =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );

const refused = (why: AskRefusal, message: string): AskResult => ({ ok: false, why, message });

/** What a refusal from the server means to the thing that asked. */
function refusalOf(error: unknown): AskResult {
  if (error instanceof ApiError) {
    if (error.status === 401) return refused("signed-out", "Sign in to saha.ing to ask.");
    if (error.code === "NO_INTAKE") return refused("no-intake", error.message);
    if (error.code === "TOO_MANY") return refused("too-many", error.message);
    return refused("failed", error.message);
  }
  return refused("failed", "Could not reach saha.ing.");
}

/**
 * Nearer than this to the thing (metres, across the floor), and the panel stands by it; further, and it
 * opens in front of you. Seen from across the room a panel by the thing is too small to read where the
 * question is going (the harness, 2026-10-07: a window's camera stands metres back).
 */
export const BESIDE = 1.5;

/** Where the panel goes: between the thing and you when you are at it, else in front of you; a little under your eyes, facing you. */
export function placeNear(near: THREE.Object3D | undefined, camera: THREE.Camera, inHeadset: boolean): { at: THREE.Vector3; yaw: number } {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const target = near?.getWorldPosition(new THREE.Vector3()) ?? null;
  let at: THREE.Vector3;
  if (target && Math.hypot(eye.x - target.x, eye.z - target.z) <= BESIDE) {
    const toward = eye.clone().sub(target).setY(0);
    const apart = toward.length();
    if (apart > 1e-6) toward.divideScalar(apart);
    at = target.clone().addScaledVector(toward, Math.min(0.4, apart * 0.5));
    at.y = Math.min(eye.y - 0.2, target.y + 0.35);
  } else {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    at = eye.clone().addScaledVector(forward, inHeadset ? 0.55 : 0.9);
    at.y = eye.y - (inHeadset ? 0.25 : 0.15);
  }
  return { at, yaw: Math.atan2(eye.x - at.x, eye.z - at.z) };
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Send what the panel holds. A failed connection keeps the panel and its words; a refusal closes it and says why. */
export async function sendOpenQuestion(text: string): Promise<void> {
  const current = open;
  if (!current || current.sending) return;
  show({ ...current, draft: text, sending: true, problem: null });
  try {
    const answer = await space.askQuestion(current.item, text, current.key);
    if (open?.key === current.key) finish?.({ ok: true, question: answer.result.question });
  } catch (error) {
    if (open?.key !== current.key) return;
    const network = !(error instanceof ApiError) || error.retryable;
    // Words that are not a question yet (too short, too long) are the writer's to fix, in the panel.
    if (network || error.code === "BAD_QUESTION") {
      show({ ...open, sending: false, problem: network ? "Could not reach saha.ing. Send again: it stays one question." : error.message });
      return;
    }
    finish?.(refusalOf(error));
  }
}

export function cancelOpenQuestion(): void {
  finish?.(refused("cancelled", "Closed without sending."));
}

export function createQuestionHost(deps: { camera: () => THREE.Camera; me: () => Person | null; renderer: { xr: { isPresenting: boolean } } }): QuestionHost {
  return {
    ask(instance, options) {
      const key = newKey();
      const item = instance.split("/")[0];
      let settled = false;
      let settle!: (result: AskResult) => void;
      const result = new Promise<AskResult>((resolve) => (settle = resolve));
      const done = (answer: AskResult) => {
        if (settled) return;
        settled = true;
        if (open?.key === key) {
          finish = null;
          show(null);
        }
        settle(answer);
      };
      const close = () => done(refused("removed", "The thing was taken away before the question was sent."));
      const me = deps.me();
      if (!me) {
        done(refused("signed-out", "Sign in to saha.ing to ask."));
        return { result, close };
      }
      if (open) {
        done(refused("busy", "A question is already being written here: send or close it first."));
        return { result, close };
      }
      // Claim the page's one panel now, so a second ask cannot slip in while the board is being found.
      const place = placeNear(options.near, deps.camera(), deps.renderer.xr.isPresenting);
      const prompt = (options.prompt ?? "Ask a question").trim().slice(0, 80) || "Ask a question";
      show({ key, instance, item, header: prompt, at: place.at, yaw: place.yaw, draft: "", problem: null, sending: true });
      finish = done;
      // Where it goes, before anything is typed: "nowhere" is said at once, not after a paragraph.
      space.questions(item, { limit: 1 }).then(
        ({ project }) => {
          if (settled || open?.key !== key) return;
          show({ ...open, header: `${prompt} · posted publicly to the ${project} board as ${me.name}`, sending: false });
        },
        (error: unknown) => done(refusalOf(error)),
      );
      return { result, close };
    },

    async list(instance, options) {
      try {
        const { questions, next } = await space.questions(instance.split("/")[0], options);
        return { questions, next };
      } catch (error) {
        const why = refusalOf(error);
        throw Object.assign(new Error(why.ok ? "" : why.message), { why: why.ok ? "failed" : why.why });
      }
    },
  };
}

/** For tests: the page's panel, and a way to forget it. */
export const openQuestionNow = (): OpenQuestion | null => open;
export function resetQuestionPanel(): void {
  finish = null;
  show(null);
}

export type { Question };
