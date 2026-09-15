import { spawn } from "node:child_process";
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
 * How long a transcription may take before we give up.
 *
 * A small model on a CPU is roughly real time, so thirty seconds covers a
 * fifteen-second clip with room to spare. The timeout matters more than the
 * number does: this shares a machine with the room, and a wedged child process
 * holding a core is a room that stops moving for everybody in it.
 */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;

/**
 * One at a time.
 *
 * The server that transcribes is the server that draws the room. Two people
 * pressing the button at once on a small box would take the frame rate down
 * with them, and a queue of one is honest: the second person is told to try
 * again in a moment rather than quietly making the room stutter.
 */
let busy = false;

export type Transcriber = (wavPath: string) => Promise<string>;

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

function runCommand(command: string, wavPath: string): Promise<string> {
  // Split on whitespace: the command comes from our own environment file, not
  // from a request, and a shell would add a way for a filename to matter.
  const parts = command.replace("{file}", wavPath).split(/\s+/).filter(Boolean);
  const [program, ...args] = parts;
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`transcription took longer than ${TRANSCRIBE_TIMEOUT_MS} ms`));
    }, TRANSCRIBE_TIMEOUT_MS);
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
  options: { command?: string; transcriber?: Transcriber } = {},
): void {
  const requireSession = makeRequireSession(config, sessions);
  const command = options.command ?? process.env.TRANSCRIBE_CMD;
  const transcribe: Transcriber | null =
    options.transcriber ?? (command ? (wavPath) => runCommand(command, wavPath) : null);

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
        const text = readTranscript(await transcribe(wavPath));
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
