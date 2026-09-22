import { requestJson } from "./api-request";
import { base } from "./router";
import type { Placement, Showing } from "../shared/space-wire";
import type { Utterance, UtteranceInput } from "../shared/voice";
import type { AvatarControl, AvatarState } from "../shared/avatar-motion";
import type { AgentHome } from "../shared/agent-home";
import type { GoSize, RoomItem } from "../shared/room-items";

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

  /**
   * Give an agent a home: where it stands and which way it faces, saved on
   * the server. It walks there straight away. See shared/agent-home.ts.
   */
  placeAgent: (actorId: string, home: AgentHome) =>
    requestJson<{ ok: true; home: AgentHome }>(`${root}/homes/${encodeURIComponent(actorId)}`, {
      method: "PUT",
      body: JSON.stringify({ x: home.at.x, z: home.at.z, facing: home.facing }),
    }),

  /** Send an agent back to its desk, forgetting the home it was given. */
  clearAgentHome: (actorId: string) =>
    requestJson<{ ok: true }>(`${root}/homes/${encodeURIComponent(actorId)}`, { method: "DELETE" }),

  /** Ephemeral self-only avatar control; mood persists for this presence, gestures expire. */
  animate: (control: AvatarControl) =>
    requestJson<{ ok: true; avatar: AvatarState }>(`${root}/avatar`, {
      method: "POST",
      body: JSON.stringify(control),
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
  /**
   * What the room is showing, and how to change it.
   *
   * A ROUTE RATHER THAN A SOCKET FRAME, because a refusal here is a sentence
   * somebody has to read — "that mood board is not in that project" — and a
   * fire-and-forget frame has nowhere to put one. The socket carries the
   * announcement to everybody else afterwards.
   */
  showing: () => requestJson<{ showing: Showing }>(`${root}/showing`),

  setShowing: (choice: { projectId: string | null; boardId: string | null }) =>
    requestJson<{ showing: Showing }>(`${root}/showing`, {
      method: "PUT",
      body: JSON.stringify(choice),
    }),

  placePanel: (place: Placement) =>
    requestJson<{ placement: Placement }>(
      `${root}/panels/${encodeURIComponent(place.id)}/place`,
      {
        method: "PUT",
        // `scale` is sent only when there is one, so a placement made before
        // panels could be resized does not start asserting a size it never had.
        body: JSON.stringify({
          position: place.position,
          rotationY: place.rotationY,
          ...(place.scale !== undefined ? { scale: place.scale } : {}),
        }),
      },
    ),
  addRoomItem: () => requestJson<{ item: RoomItem }>(`${root}/items`, {
    method: "POST", body: JSON.stringify({ kind: "go" }),
  }),
  configureGo: (id: string, change: { size?: GoSize; addBowl?: true; position?: { x: number; y: number; z: number; rotationY: number }; scale?: number; revision?: number }) =>
    requestJson<{ item: RoomItem }>(`${root}/items/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(change),
    }),
  actOnGo: (id: string, action: ({ action: "lift"; colour?: number; hand?: "left" | "right" } | { action: "place"; x: number; y: number } | { action: "return" }) & { revision?: number }) =>
    requestJson<{ item: RoomItem }>(`${root}/items/${encodeURIComponent(id)}/action`, {
      method: "POST", body: JSON.stringify(action),
    }),
};
