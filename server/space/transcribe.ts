import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

/**
 * Turning a recording into words, on our own machine.
 *
 * WHY THIS EXISTS. Nikk, in a Quest: "we can do the same as we are doing on
 * AURA, where you push a button to begin speech to text... lets try to get a
 * way to SPEAK to agents, that is pretty key". On the XREAL Aura that button
 * works because that browser has Web Speech recognition. Quest Browser is
 * documented not to, and the headset's own keyboard dictation — the answer that
 * needs nothing from us at all — is currently unusable because focusing the
 * text field throws people out of the room.
 *
 * So this is the path that depends on nothing Meta does.
 *
 * NOBODY'S VOICE LEAVES THE BOX. There is no API key here and no third party.
 * Nikk was asleep when this was written and could not be asked whether room
 * audio may be sent to a transcription service, and sending somebody's
 * microphone to a company on my own judgement is not a decision I get to make
 * quietly. Running it here needs no decision from anybody.
 *
 * WHAT THE BROWSER SENDS: 16 kHz mono 16-bit PCM in a WAV container, converted
 * in the page (see src/space/wav.ts). That is exactly what whisper.cpp reads,
 * so this needs one binary rather than a media toolchain — no ffmpeg on the
 * server, and no guessing at a format.
 *
 * HOW IT IS CONFIGURED. `TRANSCRIBE_CMD` is a command line with `{file}` where
 * the WAV's path goes, for example:
 *
 *   TRANSCRIBE_CMD="/opt/whisper/main -m /opt/whisper/ggml-base.en.bin -nt -f {file}"
 *
 * With nothing configured this REFUSES with a sentence saying so, rather than
 * failing in a way somebody in a headset has to interpret. A feature that is
 * not set up should say it is not set up.
 */

/** Four minutes at 16 kHz mono 16-bit, which is far longer than anybody speaks into a room. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * How long a transcription may take before we give up, FROM HOW LONG THE
 * RECORDING IS.
 *
 * A fixed thirty seconds was the first version, and measuring the real thing
 * showed it wrong at both ends. On saha.ing's two cores, tiny.en transcribed
 * eleven seconds of speech in four — about 0.36× real time. So thirty seconds
 * of patience covers roughly eighty seconds of speech, while the route accepts
 * FOUR MINUTES of it: anything over about a minute and a half would have been
 * recorded, uploaded, worked on, and then thrown away with "the words could not
 * be written down", which is the worst possible way to lose somebody's
 * sentence.
 *
 * Three times real time, then, with a floor for the overhead of loading the
 * model and a ceiling so a wedged child cannot hold a core for ever — this
 * shares a machine with the room, and a room that stops moving for everybody is
 * a worse failure than one transcription giving up.
 */
export const TRANSCRIBE_FLOOR_MS = 20_000;
export const TRANSCRIBE_CEILING_MS = 180_000;
/** 16 kHz, mono, 16-bit: the format the page sends. See src/space/wav.ts. */
const BYTES_A_SECOND = 32_000;

export function timeoutFor(bytes: number): number {
  const seconds = Math.max(0, bytes - 44) / BYTES_A_SECOND;
  return Math.min(TRANSCRIBE_CEILING_MS, Math.max(TRANSCRIBE_FLOOR_MS, Math.round(seconds * 3_000)));
}

/**
 * One at a time.
 *
 * The server that transcribes is the server that draws the room. Two people
 * pressing the button at once on a small box would take the frame rate down
 * with them, and a queue of one is honest: the second person is told to try
 * again in a moment rather than quietly making the room stutter.
 */
let busy = false;

export type Transcriber = (wavPath: string, prompt: string) => Promise<string>;

/** The words, cleaned of the timestamps and blank lines whisper prints. */
export function readTranscript(output: string): string {
  return output
    .split("\n")
    .map((line) =>
      // "[00:00:00.000 --> 00:00:02.000]   hello there" with -nt is just the
      // text, but a model or a flag change should not silently start pasting
      // timestamps into the room.
      line.replace(/^\s*\[[0-9:.,\s>-]+\]\s*/, "").trim(),
    )
    // whisper writes its own asides for silence; they are not somebody's words.
    .filter((line) => line !== "" && !/^[([](BLANK_AUDIO|blank audio|silence|inaudible)[)\]]$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WHO IS IN THIS ROOM, told to the transcriber before it listens.
 *
 * Measured on saha.ing with a clip naming three of us. Without it:
 *
 *   "Hey, so, great work. Can you ask Plum Line and Lumenfold to check the
 *    board on Sahaha dotting?"
 *
 * With the names as a prompt:
 *
 *   "Hey, Sil, great work. Can you ask Plumbline and Lumenfold to check the
 *    board on saha.ing?"
 *
 * Baiwei's first real sentence came back with "Hey, still" for "Hey, Sill", and
 * a room where you cannot say your colleague's name is a room you cannot talk
 * in. A small model has never seen "Plumbline" or "saha.ing"; a prompt is how
 * you tell it they exist, and it costs nothing.
 *
 * FROM THE DATABASE, not a list in a file, so an agent that joins tomorrow is
 * heard by name without anybody remembering to add it.
 */
export function namesPrompt(names: string[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const name of [...names, "saha.ing"]) {
    const clean = name.trim();
    // A name with a space or a comma in it would read as two names.
    if (!clean || /[\s,]/.test(clean) || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    kept.push(clean);
    // whisper's prompt is capped at 224 tokens and the tail is what gets cut,
    // so stop well short rather than let the last names fall off silently.
    if (kept.length >= 40) break;
  }
  return kept.join(", ");
}

function runCommand(command: string, wavPath: string, prompt: string): Promise<string> {
  /**
   * Split FIRST, then substitute whole tokens — not the other way round.
   *
   * There is no shell here on purpose, so `{prompt}` must survive being a
   * multi-word value. Substituting into the string and then splitting on
   * whitespace would turn "Sill, Plumbline" into two arguments and quietly
   * hand whisper a filename it cannot open.
   */
  const parts = command
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part === "{file}" ? wavPath : part === "{prompt}" ? prompt : part));
  const [program, ...args] = parts;
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const allowed = timeoutFor(statSync(wavPath).size);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`transcription took longer than ${allowed} ms`));
    }, allowed);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`transcriber exited ${code}: ${err.slice(-400)}`));
    });
  });
}

export function registerTranscribeRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  options: { command?: string; transcriber?: Transcriber; names?: () => string[] } = {},
): void {
  const requireSession = makeRequireSession(config, sessions);
  const command = options.command ?? process.env.TRANSCRIBE_CMD;
  const transcribe: Transcriber | null =
    options.transcriber ?? (command ? (wavPath, prompt) => runCommand(command, wavPath, prompt) : null);
  const names = options.names ?? (() => []);

  /**
   * WHETHER THIS ROOM CAN WRITE SPEECH DOWN AT ALL.
   *
   * Asked before the button changes what it does. Without this the press-to-
   * speak button would replace the keyboard on every Quest immediately and then
   * apologise after each recording — which is worse than the keyboard, not
   * better. The client keeps the keyboard until the server says there is
   * something to transcribe with, and picks up the new button the moment there
   * is, with no deploy.
   */
  app.get("/bff/space/transcribe", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    return reply.header("cache-control", "no-store").send({ available: Boolean(transcribe) });
  });

  app.post(
    "/bff/space/transcribe",
    { config: { rawBody: true }, bodyLimit: MAX_AUDIO_BYTES + 1024 },
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      if (!transcribe) {
        return reply.code(501).send({
          code: "NO_TRANSCRIBER",
          error: "This room cannot turn speech into words yet. Nobody has set a transcriber up on the server.",
        });
      }
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "send the recording as the raw request body" });
      }
      if (bytes.length > MAX_AUDIO_BYTES) {
        return reply.code(413).send({ code: "TOO_LONG", error: "That recording is too long. Say it in under four minutes." });
      }
      if (busy) {
        return reply.code(503).send({
          code: "BUSY",
          error: "Somebody else's words are being written down. Try again in a moment.",
        });
      }
      busy = true;
      /**
       * THE RECORDING IS DELETED BEFORE THE ANSWER IS SENT, not alongside it.
       *
       * The first version cleaned up in a `finally` around the `reply.send`,
       * which reads as careful and is not: sending the reply ends the request,
       * so the deletion happened AFTER the client already had its words. A test
       * caught it by looking for the file the moment the response arrived and
       * finding somebody's voice still sitting in /tmp. The window was small
       * and the guarantee was wrong — "you have your words" now means "and the
       * recording is gone", which is the promise worth being able to make.
       */
      let directory: string | null = null;
      let answer: { text: string; heard: boolean } | null = null;
      let trouble: unknown = null;
      try {
        directory = await mkdtemp(join(tmpdir(), "saha-say-"));
        const wavPath = join(directory, "said.wav");
        await writeFile(wavPath, bytes);
        const text = readTranscript(await transcribe(wavPath, namesPrompt(names())));
        answer = { text, heard: text !== "" };
      } catch (error) {
        trouble = error;
      } finally {
        busy = false;
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
      if (!answer) {
        request.log.error({ err: trouble }, "space transcribe failed");
        return reply.code(502).send({
          code: "TRANSCRIBE_FAILED",
          error: "The words could not be written down. Nothing was sent.",
        });
      }
      if (answer.heard) {
        request.log.info({ actorId: session.username, words: answer.text.split(" ").length }, "space transcribed");
      }
      return reply.send(answer);
    },
  );
}
