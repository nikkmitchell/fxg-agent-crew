import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { GUIDES, GUIDE_VOICE, READINGS, isGuide, isReading } from "../../shared/guided.js";
import type { SpeechCache } from "./speak.js";

/**
 * The spoken lines of the guided meditations and readings. See shared/guided.ts.
 *
 *   GET /bff/space/guides/:guide/:line/audio     one guide line, as WAV
 *   GET /bff/space/readings/:reading/:line/audio one reading line, as WAV
 *
 * ONLY THE SCRIPT. The guide and the line are looked up in shared/guided.ts;
 * nothing a caller sends is ever spoken. Same rule as the voice samples.
 */
export function registerGuideRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; speech: SpeechCache },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  /**
   * One line of a guide or a reading, from the script alone. `lineOf` returns
   * the fixed text, or null for anything that is not in a script.
   */
  const speakLine = (route: string, lineOf: (id: string, index: number) => string | null) =>
  app.get<{ Params: { id: string; line: string } }>(route, async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const index = Number(request.params.line);
    const text = Number.isInteger(index) ? lineOf(request.params.id, index) : null;
    if (!text) return reply.code(404).send({ code: "NOT_FOUND", error: "no such line in any script" });
    if (!deps.speech.canSpeak()) {
      return reply.code(501).send({ code: "NOT_SPOKEN_HERE", error: "this server has no speech engine configured." });
    }
    if (!(await deps.speech.ensure(text, GUIDE_VOICE))) {
      return reply.code(503).send({ code: "NOT_SAID_YET", error: "that line is still being voiced. Try again in a moment." });
    }
    try {
      const bytes = await readFile(deps.speech.path(text, GUIDE_VOICE));
      return reply.header("content-type", "audio/wav").header("cache-control", "private, max-age=604800, immutable").send(bytes);
    } catch (error) {
      request.log.error({ err: error, id: request.params.id, index }, "voiced a script line and could not read it back");
      return reply.code(502).send({ code: "COULD_NOT_SPEAK", error: "the speech engine did not produce that line" });
    }
  });

  speakLine("/bff/space/guides/:id/:line/audio", (id, index) => (isGuide(id) ? GUIDES[id].lines[index]?.say ?? null : null));
  speakLine("/bff/space/readings/:id/:line/audio", (id, index) => (isReading(id) ? READINGS[id].lines[index] ?? null : null));
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
  const lines = [
    ...Object.values(GUIDES).flatMap((guide) => guide.lines.map((line) => line.say)),
    ...Object.values(READINGS).flatMap((reading) => reading.lines),
  ];
  for (const text of lines) {
    if (await speech.ensure(text, GUIDE_VOICE)) made += 1;
  }
  log(`guided meditations and readings: ${made} of ${lines.length} lines ready`);
}
