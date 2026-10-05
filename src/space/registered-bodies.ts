import { bodyKey, keepsOwnColours } from "../../shared/avatar-choice";
import { requestJson } from "../api-request";
import { base } from "../router";

/**
 * WHETHER A BODY KEEPS ITS OWN COLOURS. The room tints a body toward its wearer's colour (VrmBody `tint`), except
 * the originals whose makers chose their palette: BODIES_ON_HAND entries with `ownColours`, and every body
 * registered through the room (server/space/registered-bodies.ts). The registered ones are only known from the
 * server, so they are asked for once per page and remembered.
 */
let registered: Promise<Set<string>> | null = null;

function registeredKeys(): Promise<Set<string>> {
  registered ??= requestJson<{ registered?: { key: string }[] }>(`${base}/bff/space/bodies`)
    .then((answer) => new Set((answer.registered ?? []).map((body) => bodyKey(body.key))))
    .catch(() => {
      // Not signed in, or the server is away: no registered bodies for now, and ask again in a minute rather than
      // on every body that loads.
      setTimeout(() => { registered = null; }, 60_000);
      return new Set<string>();
    });
  return registered;
}

export async function ownColoursFor(body: string | null | undefined): Promise<boolean> {
  if (!body) return false;
  if (keepsOwnColours(body)) return true;
  return (await registeredKeys()).has(bodyKey(body));
}
