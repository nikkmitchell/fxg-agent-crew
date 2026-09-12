import { requestJson } from "./api-request";
import { base } from "./router";
import type { Placement } from "../shared/space-wire";
import type { Utterance, UtteranceInput } from "../shared/voice";

/**
 * The browser's side of the room's own API.
 *
 * THE THIRD CLIENT, and it should have been written when the room was. There
 * was none, so its nine call sites each hand-wrote the same four lines: build
 * the URL from the base path, set the content type, parse the JSON, decide what
 * a non-2xx means. Two of them posted the same utterance body in two different
 * shapes; two of them read the same transcript with two different limits.
 *
 * `board-client` and `bff-client` are the same idea for the board and the
 * WebHarness proxy. All three share `api-request`, so there is one place where
 * a refusal becomes an `ApiError` and one place that knows about credentials.
 *
 * NOT HERE: the panel photographs. `StillPanel` fetches a PNG and decodes it
 * through an <img>, which is not a JSON request and has no business pretending
 * to be one.
 */
const root = `${base}/bff/space`;

export const space = {
  /**
   * What has been said in the room, OLDEST FIRST.
   *
   * The order is stated here because two callers guessed it differently and
   * one of them was wrong: the server queries `ORDER BY id DESC` and then
   * reverses, so what arrives already reads downward like a conversation.
   * `SaidPanel` reversed it a second time and displayed the room backwards on
   * production; the socket's backfill sorted by id and was right by accident.
   * Nobody should have to open `utterances.ts` to find this out again.
   */
  said: (limit: number) =>
    requestJson<{ utterances: Utterance[] }>(`${root}/utterances?limit=${limit}`),

  /** Say something. The server refuses with a sentence; `ApiError` carries it. */
  say: (utterance: UtteranceInput) =>
    requestJson<{ ok: true; utterance: Utterance }>(`${root}/utterances`, {
      method: "POST",
      body: JSON.stringify(utterance),
    }),

  /** The catalogue of panels, which of them you have open, and where they hang. */
  panels: () =>
    requestJson<{
      panels: { id: string; label: string; tab: string }[];
      open: string[];
      places: Placement[];
    }>(`${root}/panels`),

  /** Open or close one panel, for yourself only. */
  setPanelOpen: (id: string, open: boolean) =>
    requestJson<{ open: string[] }>(`${root}/panels/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ open }),
    }),

  /** Move one panel, for everybody. */
  placePanel: (place: Placement) =>
    requestJson<{ placement: Placement }>(
      `${root}/panels/${encodeURIComponent(place.id)}/place`,
      {
        method: "PUT",
        body: JSON.stringify({ position: place.position, rotationY: place.rotationY }),
      },
    ),
};
