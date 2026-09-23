import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { chooseVoice } from "../../shared/voice-choice.js";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { Utterance } from "../../shared/voice.js";

/**
 * Saying a line aloud, in the speaker's own voice, on our own machine.
 *
 * Nikk: "open source tts that has actual nice voices, that can be used by each
 * agent, so they can also choose a voice", and "each agent responds quickly and
 * simply with a short summary sentence in audio, and then all the details in
 * chat".
 *
 * ONLY WHAT WAS ACTUALLY SAID, and only its spoken half. This reads an
 * utterance's `say` — the line the room already shows — rather than taking text
 * from the caller. Two reasons, and the second is the important one: a general
 * "speak this" endpoint is a synthesiser anybody signed in can point at
 * anything, and more to the point the spoken line must be the written one.
 * Nightjar's rule: if the audio says "deployed and green" and the text says
 * something more careful, the room has two truths and the voice is the one
 * people believe. `detail` is never spoken; it is the half that is deliberately
 * written only.
 *
 * NOBODY'S VOICE LEAVES THE BOX, the same as transcription. No API key, no
 * third party, nothing about the room sent anywhere to be turned into sound.
 *
 * HOW IT IS CONFIGURED. `SPEAK_CMD` is a command line with `{voice}` and
 * `{file}` in it; the text arrives on stdin and a WAV is expected at `{file}`:
 *
 *   SPEAK_CMD="nice -n 10 /opt/kokoro/say --voice {voice} --out {file}"
 *
 * With nothing configured every request REFUSES in a sentence saying so, and
 * GET /bff/space/voices already answers spokenAloud: false. A feature that is
 * not set up says it is not set up rather than failing in a way somebody in a
 * headset has to interpret.
 */

/**
 * How long a line may take before we give up, from how long the line is.
 *
 * Measured on saha.ing's two cores with Kokoro fp32: about 4.6s wall for a
 * 44-character sentence, most of it inference rather than model loading. Three
 * times that, with a floor for the load and a ceiling so a wedged child cannot
 * hold a core for ever — this shares a machine with the room, and a room that
 * stops moving for everybody is worse than one line going unsaid.
 */
/**
 * THE LINE EVERY VOICE SAYS, and it is the same line on purpose.
 *
 * A preview exists to let somebody CHOOSE between voices, and you cannot compare
 * two voices saying different things — half of what you would be judging is the
 * words. One fixed sentence makes the 54 comparable.
 *
 * It is also why a preview is affordable at all. The cache is keyed by text AND
 * voice (see cacheName), so a fixed line means each voice is synthesised ONCE,
 * ever, on the first person who listens to it, and is a file read for everybody
 * after that. The engine speaks one line at a time and takes about two and a
 * half seconds; 54 preview buttons that each said something different would be
 * a queue nobody could sit through.
 *
 * Short, and varied enough to hear a voice in: vowels, an s, a th, and a stop.
 */
export const VOICE_SAMPLE = "Hello. This is how I sound in the room.";

export const SPEAK_FLOOR_MS = 20_000;
export const SPEAK_CEILING_MS = 120_000;

export function timeoutFor(characters: number): number {
  return Math.min(SPEAK_CEILING_MS, Math.max(SPEAK_FLOOR_MS, Math.round(characters * 450)));
}

/**
 * One at a time.
 *
 * The server that speaks is the server that draws the room, and this engine
 * peaks at about 540MB on a box with 1.6GB. Two at once would take the frame
 * rate down with them, or the service with it. A queue of one is honest: the
 * second caller is told to ask again rather than quietly making the room stutter.
 */
let busy = false;

export type Speaker = (text: string, voice: string, outPath: string) => Promise<void>;

/** Where a line in a voice lands on disk. The same text in the same voice is the same file. */
export function cacheName(text: string, voice: string): string {
  // The separator is written as the ESCAPE \0, never as a literal NUL byte.
  // A real NUL in the source makes this whole file BINARY to grep: `grep export
  // speak.ts` returned nothing at all, silently, while the file plainly had nine.
  // Anybody searching the codebase for the speech seam simply did not find it.
  // The escape is the same character to the hash and keeps the file readable.
  return `${createHash("sha256").update(`${voice}\0${text}`).digest("hex").slice(0, 32)}.wav`;
}

/**
 * Run `SPEAK_CMD`, with the text on stdin.
 *
 * WRITTEN ASIDE AND RENAMED, because a half-written file at the cache path is
 * served to the next asker for ever and plays as silence or a click. The same
 * lesson the body cache learned.
 */
export function speakWith(command: string): Speaker {
  return (text, voice, outPath) =>
    new Promise<void>((resolve, reject) => {
      const partial = `${outPath}.part`;
      /**
       * THE TEMPLATE IS SPLIT, THEN THE VALUES GO IN — never the other way
       * round. Filling first and splitting the result tears any path with a
       * space in it into separate arguments, and the engine is handed rubbish.
       * saha.ing's cache lives at /opt/fxg-crew/data/speech and never showed it;
       * this worktree lives under "Python Stuff/My Projects" and it failed on
       * the first line, in a browser, with the engine's own stderr as the only
       * clue — which is why that stderr now reaches the log.
       */
      const [program, ...args] = command
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.replaceAll("{voice}", voice).replaceAll("{file}", partial));
      if (!program) return reject(new Error("SPEAK_CMD is empty"));

      const child = spawn(program, args, { stdio: ["pipe", "ignore", "pipe"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutFor(text.length));
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        // Bounded: a runaway child must not be able to fill memory with its own complaints.
        if (stderr.length < 4_000) stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          await rm(partial, { force: true });
          return reject(new Error(`speech command exited ${code}: ${stderr.trim().slice(0, 300)}`));
        }
        try {
          await rename(partial, outPath);
          resolve();
        } catch (error) {
          reject(error as Error);
        }
      });
      child.stdin?.end(text);
    });
}

/**
 * The said lines this box has on disk, and the way to add one.
 *
 * SHARED BY THE ASKING AND THE SAYING. A listener asking for audio and the room
 * warming it the moment the line is said must agree about where the file is and
 * that only one synthesis runs at a time — two answers to either question is
 * two engines fighting over 540MB.
 */
export type SpeechCache = {
  /** Where this line in this voice lives, whether or not it is there yet. */
  path: (text: string, voice: string) => string;
  /** Make it exist. Resolves false when nothing here can speak, or the engine failed. */
  ensure: (text: string, voice: string) => Promise<boolean>;
  /**
   * Start saying it, quietly, for somebody who has not asked yet.
   *
   * Never waits and never throws: a line said in the room must not be held up,
   * or lost, because the box was busy making a noise out of the last one.
   */
  warm: (text: string, voice: string) => void;
  /** Whether this box can speak at all, asked each time. */
  canSpeak: () => boolean;
};

/**
 * `speaker` is a FUNCTION, read at call time rather than captured at boot, so a
 * box that gains an engine starts speaking without a restart — the same
 * property `canSpeak` on the voices route already promises.
 */
export function speechCache(deps: {
  cacheRoot: string;
  speaker: () => Speaker | undefined;
  /**
   * Say why a line could not be said.
   *
   * NOT OPTIONAL IN PRACTICE, and it was missing for an hour: warming swallows
   * its own failure by design — a line said in the room must not fail because
   * the noise did — and the route only reported "not ready". So a misconfigured
   * engine looked exactly like a busy one, in silence, from both ends. The
   * engine's own stderr is the thing worth having and it had nowhere to go.
   */
  onTrouble?: (error: unknown, text: string, voice: string) => void;
}): SpeechCache {
  const path = (text: string, voice: string) => join(deps.cacheRoot, cacheName(text, voice));
  /**
   * The lines being said right now, by cache name.
   *
   * ASKING FOR THE LINE THAT IS ALREADY BEING SAID WAITS FOR IT, rather than
   * being refused as "busy". Found in a browser, not in a test: the room warms
   * a line the moment it is said, the listener's page asks a beat later, and
   * with a plain one-at-a-time lock that listener was told 503 and fell back to
   * the browser's robot — losing the agent's own voice in exactly the common
   * case the warming exists for. A DIFFERENT line is still refused, because the
   * reason for one at a time is 540MB of engine, not the lock itself.
   */
  const saying = new Map<string, Promise<boolean>>();

  const ensure = async (text: string, voice: string): Promise<boolean> => {
    const file = path(text, voice);
    if (await readable(file)) return true;

    const key = cacheName(text, voice);
    const already = saying.get(key);
    if (already) return already;

    const speak = deps.speaker();
    if (!speak || busy) return false;

    busy = true;
    const attempt = (async () => {
      try {
        await mkdir(deps.cacheRoot, { recursive: true });
        await speak(text, voice, file);
        return true;
      } catch (error) {
        deps.onTrouble?.(error, text, voice);
        return false;
      } finally {
        busy = false;
        saying.delete(key);
      }
    })();
    saying.set(key, attempt);
    return attempt;
  };

  return {
    path,
    ensure,
    warm: (text, voice) => {
      void ensure(text, voice).catch(() => {});
    },
    canSpeak: () => Boolean(deps.speaker()),
  };
}

const readable = async (file: string): Promise<boolean> => {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
};

export function registerSpeechRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    /** Where synthesised lines are kept, and how they get there. */
    speech: SpeechCache;
    /** The utterance being asked for, or null. */
    utterance: (id: number, room: string) => Utterance | null;
    /** The voice this actor speaks in — their choice, or one derived from their name. */
    voiceOf: (actorId: string) => string;
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get<{ Params: { id: string } }>("/bff/space/utterances/:id/audio", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ code: "BAD_UTTERANCE", error: "utterance id must be a positive whole number" });
    }
    const utterance = deps.utterance(id, spaceRoomOf(session));
    if (!utterance) return reply.code(404).send({ code: "NO_SUCH_UTTERANCE", error: "there is no utterance with that id" });
    if (!utterance.say) {
      // Written and not spoken is a real state, not a missing file: `detail`
      // alone is a note, and the room never reads it aloud.
      return reply.code(404).send({
        code: "NOTHING_SAID_ALOUD",
        error: "that utterance was written, not spoken; only `say` is ever read aloud",
      });
    }

    const voice = deps.voiceOf(utterance.actorId);
    if (!deps.speech.canSpeak()) {
      return reply.code(501).send({
        code: "NOT_SPOKEN_HERE",
        error: "this server has no speech engine configured, so nothing is said aloud. The room stays text-first.",
      });
    }

    const ready = await deps.speech.ensure(utterance.say, voice);
    if (!ready) {
      // Either the engine is already saying something else — one at a time, on
      // purpose — or it failed. Both leave the words in the room in writing.
      return reply.code(503).send({
        code: "NOT_SAID_YET",
        error: "that line is not ready to hear: the engine is busy or it failed. The words are in the room in writing.",
      });
    }

    /**
     * THE BYTES FIRST, THEN THE HEADERS. Setting content-type before the read
     * meant a cache miss left `audio/wav` on a reply that then had to carry a
     * JSON refusal, and Fastify answered 500 for what should have been a plain
     * "no engine here". Found by the tests for exactly those two refusals.
     */
    try {
      const bytes = await readFile(deps.speech.path(utterance.say, voice));
      return reply
        .header("content-type", "audio/wav")
        // The same line in the same voice is the same sound for ever, and every
        // one of these costs a core-second to make.
        .header("cache-control", "private, max-age=86400")
        .send(bytes);
    } catch (error) {
      request.log.error({ err: error, utterance: id }, "said it and then could not read it back");
      return reply.code(502).send({
        code: "COULD_NOT_SPEAK",
        error: "the speech engine did not produce anything; the words are still in the room in writing",
      });
    }
  });

  /**
   * HEAR A VOICE BEFORE YOU CHOOSE IT.
   *
   * The audio route above can only serve a line somebody ALREADY SAID, which is
   * no use for picking: you would have to take a voice, wait for it to speak in
   * the room, and take another if you disliked it — in front of everybody, and
   * with `taken` refusing whatever a colleague holds.
   *
   * So: the same fixed sentence, in whichever voice you name. No utterance, no
   * actor, nothing written to the room. Listening is not speaking.
   */
  app.get<{ Params: { voice: string } }>("/bff/space/voices/:voice/sample", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;

    // Validated against the catalogue rather than passed through: this string
    // reaches a command line, and "whatever you typed" is not a voice.
    const chosen = chooseVoice(request.params.voice);
    if ("error" in chosen) return reply.code(404).send(chosen);

    if (!deps.speech.canSpeak()) {
      return reply.code(501).send({
        code: "NOT_SPOKEN_HERE",
        error: "this server has no speech engine configured, so there is nothing to preview.",
      });
    }

    const ready = await deps.speech.ensure(VOICE_SAMPLE, chosen.voice.id);
    if (!ready) {
      return reply.code(503).send({
        code: "NOT_SAID_YET",
        error: "the engine is busy or it failed. It speaks one line at a time; try this voice again in a moment.",
      });
    }

    try {
      const bytes = await readFile(deps.speech.path(VOICE_SAMPLE, chosen.voice.id));
      return reply
        .header("content-type", "audio/wav")
        // A fixed line in a fixed voice is the same sound for ever — immutable,
        // unlike an utterance, which can at least in principle be withdrawn.
        .header("cache-control", "private, max-age=604800, immutable")
        .send(bytes);
    } catch (error) {
      request.log.error({ err: error, voice: chosen.voice.id }, "made a sample and could not read it back");
      return reply.code(502).send({
        code: "COULD_NOT_SPEAK",
        error: "the speech engine did not produce anything for that voice",
      });
    }
  });
}
