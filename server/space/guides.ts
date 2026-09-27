import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { GUIDES, GUIDE_VOICE, isGuide } from "../../shared/guided.js";
import type { SpeechCache } from "./speak.js";

/**
 * The spoken lines of the guided meditations. See shared/guided.ts.
 *
 *   GET /bff/space/guides/:guide/:line/audio   one line, as WAV
 *
 * ONLY THE SCRIPT. The guide and the line are looked up in shared/guided.ts;
 * nothing a caller sends is ever spoken. Same rule as the voice samples.
 */
export function registerGuideRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; speech: SpeechCache },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get<{ Params: { guide: string; line: string } }>("/bff/space/guides/:guide/:line/audio", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const { guide, line } = request.params;
    const index = Number(line);
    if (!isGuide(guide) || !Number.isInteger(index) || !GUIDES[guide].lines[index]) {
      return reply.code(404).send({ code: "NOT_FOUND", error: "no such line in any guided meditation" });
    }
    if (!deps.speech.canSpeak()) {
      return reply.code(501).send({ code: "NOT_SPOKEN_HERE", error: "this server has no speech engine configured." });
    }
    const text = GUIDES[guide].lines[index].say;
    if (!(await deps.speech.ensure(text, GUIDE_VOICE))) {
      return reply.code(503).send({ code: "NOT_SAID_YET", error: "that line is still being voiced. Try again in a moment." });
    }
    try {
      const bytes = await readFile(deps.speech.path(text, GUIDE_VOICE));
      return reply.header("content-type", "audio/wav").header("cache-control", "private, max-age=604800, immutable").send(bytes);
    } catch (error) {
      request.log.error({ err: error, guide, index }, "voiced a guide line and could not read it back");
      return reply.code(502).send({ code: "COULD_NOT_SPEAK", error: "the speech engine did not produce that line" });
    }
  });
}

/**
 * Voice every line ahead of time, one after another, quietly.
 *
 * A line is five seconds of work on this box's two cores, and a guide's first
 * line is two seconds in: made on demand, the first few lines of the first
 * session after a release would arrive late and be skipped. Done once at boot
 * they are on disk for good, and a restart finds them already there.
 */
export async function voiceAllGuides(speech: SpeechCache, log: (message: string) => void): Promise<void> {
  if (!speech.canSpeak()) return;
  let made = 0;
  for (const guide of Object.values(GUIDES)) {
    for (const line of guide.lines) {
      if (await speech.ensure(line.say, GUIDE_VOICE)) made += 1;
    }
  }
  log(`guided meditations: ${made} lines ready`);
}
