import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

/**
 * WHERE A CALL FINDS ITS WAY, for the room's voice.
 *
 *   GET /bff/space/ice   { iceServers: RTCIceServer[] }
 *
 * WHY A ROUTE. Voice is peer to peer, and two headsets on different networks
 * often cannot reach each other directly; Nikk's calls from China carried no
 * audio at all (5359, 5379). A TURN relay carries the audio when nothing else
 * can, and a relay needs a login. The login lives in the server's environment
 * rather than in the page's code, so it can be changed on the box without a
 * release, and it is handed only to people who are signed in.
 *
 *   VOICE_TURN_URLS        comma-separated, e.g. turn:saha.ing:3478,turn:saha.ing:3478?transport=tcp
 *   VOICE_TURN_USERNAME
 *   VOICE_TURN_CREDENTIAL
 *
 * With none of them set, the answer is the public STUN servers alone, which
 * is what the page used before.
 */
export const PUBLIC_STUN: RTCIceServerLike = {
  // A STUN server China can reach first: Google's is blocked there.
  urls: ["stun:stun.miwifi.com:3478", "stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
};

export type RTCIceServerLike = { urls: string[]; username?: string; credential?: string };

export function iceServersFrom(env: NodeJS.ProcessEnv): RTCIceServerLike[] {
  const urls = (env.VOICE_TURN_URLS ?? "").split(",").map((one) => one.trim()).filter(Boolean);
  const username = env.VOICE_TURN_USERNAME?.trim();
  const credential = env.VOICE_TURN_CREDENTIAL?.trim();
  if (urls.length === 0 || !username || !credential) return [PUBLIC_STUN];
  return [PUBLIC_STUN, { urls, username, credential }];
}

export function registerIceRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; env?: NodeJS.ProcessEnv },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/ice", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.header("cache-control", "no-store").send({ iceServers: iceServersFrom(deps.env ?? process.env) });
  });
}
