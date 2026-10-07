import type * as THREE from "three";
import { ApiError } from "../../api-request";
import { space } from "../../space-client";
import type { ReviewHost } from "../../engine/host";
import type { Person, ReviewFinding } from "../../engine/types";
import { openPanel, type PanelRenderer } from "./question-form";
import { closeReviewView, openReviewView } from "./review-view";

/**
 * CTX.REVIEWS IN THE ROOM (shared/reviews.ts; Review Studio, Mica 7347). Taking
 * a round is the board's own claim and accept; a finding is written in the
 * room's panel and filed at the exact deploy; opening a version shows it to
 * this viewer alone (review-view.ts). Nothing here falls back to what a branch
 * serves now.
 */
const why = (error: unknown) => (error instanceof ApiError ? error.message : "Could not reach saha.ing.");

export function createReviewHost(deps: { camera: () => THREE.Camera; me: () => Person | null; renderer: PanelRenderer }): ReviewHost {
  /** Rounds' titles as they were listed or opened, so a finding's panel can say which round it is about (Mica 7462). */
  const titles = new Map<string, string>();
  return {
    list: async (options) => {
      const page = await space.reviews(options);
      for (const round of page.rounds) titles.set(round.id, round.title);
      return page;
    },
    accept: async (id) => {
      try {
        await space.ownCard(id, "claim");
        await space.ownCard(id, "accept");
        return { ok: true };
      } catch (error) {
        return { ok: false, why: why(error) };
      }
    },
    decline: async (id) => {
      try {
        await space.ownCard(id, "release");
        return { ok: true };
      } catch (error) {
        return { ok: false, why: why(error) };
      }
    },
    findings: async (id, options) => space.reviewFindings(id, options),
    open: async (id, variant) => {
      try {
        const { round } = await space.review(id);
        titles.set(round.id, round.title);
        const deploy = variant === "baseline" ? round.baseline?.deploy : round.candidate.deploy;
        if (!deploy) return { ok: false, why: "this round has no baseline" };
        openReviewView({ round: round.id, title: round.title, variant, space: round.space, entry: round.entry, mode: round.mode, deploy });
        return { ok: true };
      } catch (error) {
        return { ok: false, why: why(error) };
      }
    },
    back: () => closeReviewView(),
    request: (instance, options) => {
      const target = `${options.space} · ${options.entry} (${options.mode}) at ${options.candidate}${options.baseline ? `, beside ${options.baseline}` : ""}`;
      const opened = openPanel({
        instance,
        header: `Ask for a review of ${target} · on the ${options.project} board · write its title`,
        near: options.near,
        camera: deps.camera(),
        me: deps.me(),
        renderer: deps.renderer,
        send: async (title, key) => {
          const { near: _near, ...round } = options;
          const answer = await space.publishReview({ ...round, title }, key);
          return { done: { ok: true, round: answer.round } };
        },
      });
      return { result: opened.result as never, close: opened.close };
    },
    submit: (instance, id, options) => {
      const me = deps.me();
      const opened = openPanel({
        instance,
        header: `Finding on "${titles.get(id) ?? id}" · ${options.variant === "baseline" ? "the earlier version" : "this version"}\nFiled on its space's feedback, at that exact version, as ${me?.name ?? "you"}`,
        near: options.near,
        camera: deps.camera(),
        me,
        renderer: deps.renderer,
        send: async (text, key) => {
          const answer = await space.reviewFinding(id, options.variant, text, key);
          return { done: { ok: true, finding: answer.finding as ReviewFinding } };
        },
      });
      return { result: opened.result as never, close: opened.close };
    },
  };
}
