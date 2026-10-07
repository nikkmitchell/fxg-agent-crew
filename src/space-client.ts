import type { Helper } from "../shared/helpers";
import type { Garden, GardenChange, GardenEvent } from "../shared/garden";
import type { Mandala, MandalaChange, MandalaEvent } from "../shared/mandala";
import type { Lantern } from "../shared/lantern";
import type { StarEvent, StarSky } from "../shared/stars";
import type { Stick } from "../shared/incense";
import type { Hourglass } from "../shared/hourglass";
import type { Boat } from "../shared/boats";
import type { Cairn, CairnChange, CairnEvent } from "../shared/cairn";
import type { Cranes, CraneChange, CraneEvent } from "../shared/cranes";
import type { PiecesChange, PiecesEvent, RoomPieces } from "../shared/room-pieces";
import type { Vase, VaseChange, VaseEvent } from "../shared/ikebana";
import { actOnItem } from "./space/item-socket";
import { requestJson } from "./api-request";
import { base } from "./router";
import type { Placement, Showing } from "../shared/space-wire";
import type { Utterance, UtteranceInput } from "../shared/voice";
import type { AvatarControl, AvatarState } from "../shared/avatar-motion";
import type { AgentHome } from "../shared/agent-home";
import type { Meditation, MeditationChange } from "../shared/meditation";
import type { SharedMindfulnessCard } from "../shared/mindfulness";
import type { GoSize, GoSurface, RoomItem } from "../shared/room-items";
import type { Question, QuestionPage } from "../shared/questions";
import type { ReviewFinding, ReviewRound, ReviewVariant } from "../shared/reviews";

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
  /** Where a send's time went, for the server log only. See server/space/send-timing.ts. */
  sendTiming: (report: { parts: { to: string; startedAt: number; answeredAt: number | null; outcome: string }[]; inXr: boolean; visible: string }) =>
    requestJson<void>(`${root}/send-timing`, { method: "POST", body: JSON.stringify(report) }),

  /** `key`: the same words sent again within two minutes are said once (server/idempotency.ts). */
  say: (utterance: UtteranceInput, signal?: AbortSignal, key?: string) =>
    requestJson<{ ok: true; utterance: Utterance }>(`${root}/utterances`, {
      method: "POST",
      body: JSON.stringify(utterance),
      signal,
      ...(key ? { headers: { "idempotency-key": key } } : {}),
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
      /** The agents, and their screens, hidden for everyone in this room. */
      agentsHidden?: boolean;
    }>(`${root}/panels`),

  /** Hide or show the agents, and their screens, for everyone in this room. */
  setAgentsHiddenForRoom: (hidden: boolean) =>
    requestJson<{ agentsHidden: boolean }>(`${root}/agents-hidden`, {
      method: "PUT",
      body: JSON.stringify({ hidden }),
    }),

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
  /** Claim, renew or let go of the thing you are moving — see grab-hold.ts. */
  hold: (thing: string, held: boolean) =>
    requestJson<{ ok: true; held: boolean }>(`${root}/holds`, {
      method: "POST", body: JSON.stringify({ thing, held }),
    }),
  /** The tables as they are now — for catching up after being told one changed. */
  roomItems: () => requestJson<{ items: RoomItem[] }>(`${root}/items`),
  /** Delete a table for good. Answers with the room's tables as they now are. */
  removeRoomItem: (id: string) =>
    requestJson<{ items: RoomItem[] }>(`${root}/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addRoomItem: () => requestJson<{ item: RoomItem }>(`${root}/items`, {
    method: "POST", body: JSON.stringify({ kind: "go" }),
  }),
  /** Bring a thing from a space into this room (see ModuleRoomItem in shared/room-items.ts). */
  bringModule: (source: { space: string; branch: string; entry: string }, extra: { view?: "placed" | "full"; position?: { x: number; y: number; z: number; rotationY: number } } = {}) =>
    requestJson<{ item: RoomItem }>(`${root}/items`, { method: "POST", body: JSON.stringify({ kind: "module", source, ...extra }) }),
  /** Move, resize, or (a space) turn between a model and full size. */
  placeModule: (id: string, change: { position?: { x: number; y: number; z: number; rotationY: number }; scale?: number; view?: "placed" | "full"; revision?: number }) =>
    requestJson<{ item: RoomItem }>(`${root}/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(change) }),
  /** What a thing from a space has decided so far, for a copy that is starting. */
  moduleState: (id: string) => requestJson<{ state: Record<string, unknown> }>(`${root}/items/${encodeURIComponent(id)}/state`),
  /** The questions asked at a thing in this room, and the board they go to (shared/questions.ts). */
  questions: (item: string, options: { mine?: boolean; limit?: number; cursor?: string | null } = {}) =>
    requestJson<{ space: string; project: string } & QuestionPage>(
      `${root}/questions?item=${encodeURIComponent(item)}${options.mine ? "&mine=1" : ""}${options.limit ? `&limit=${Math.round(options.limit)}` : ""}${options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : ""}`,
    ),
  /** Open review rounds (shared/reviews.ts), a page at a time. */
  reviews: (options: { cursor?: string | null; limit?: number } = {}) =>
    requestJson<{ rounds: ReviewRound[]; next: string | null }>(`${base}/bff/reviews?${options.cursor ? `cursor=${encodeURIComponent(options.cursor)}&` : ""}${options.limit ? `limit=${Math.round(options.limit)}` : ""}`),
  review: (id: string) => requestJson<{ round: ReviewRound }>(`${base}/bff/reviews/${encodeURIComponent(id)}`),
  reviewFindings: (id: string, options: { cursor?: string | null; limit?: number } = {}) =>
    requestJson<{ findings: ReviewFinding[]; next: string | null }>(`${base}/bff/reviews/${encodeURIComponent(id)}/findings?${options.cursor ? `cursor=${encodeURIComponent(options.cursor)}&` : ""}${options.limit ? `limit=${Math.round(options.limit)}` : ""}`),
  reviewFinding: (id: string, variant: ReviewVariant, text: string, requestKey: string) =>
    requestJson<{ existing: boolean; finding: ReviewFinding }>(`${base}/bff/reviews/${encodeURIComponent(id)}/findings`, { method: "POST", body: JSON.stringify({ variant, text, requestKey }) }),
  /** The board's own taking of a card: claim, accept, release. */
  ownCard: (id: string, action: "claim" | "accept" | "release") =>
    requestJson<{ ok: true }>(`${base}/bff/board/tasks/${encodeURIComponent(id)}/ownership`, { method: "POST", body: JSON.stringify({ action }) }),
  /** Send a question written in the room's panel; the same request key is the same card. */
  askQuestion: (item: string, text: string, requestKey: string, to?: string | null) =>
    requestJson<{ ok: true; result: { existing: boolean; question: Question; chat: { to: string; posted: boolean; problem?: string } | null } }>(`${root}/questions`, {
      method: "POST",
      body: JSON.stringify({ item, text, requestKey, ...(to ? { to } : {}) }),
    }),
  configureGo: (id: string, change: { size?: GoSize; addBowl?: true; players?: number; reset?: true; position?: { x: number; y: number; z: number; rotationY: number }; scale?: number; revision?: number; deskVisible?: boolean; surface?: GoSurface; territoryShown?: boolean; clock?: number }) =>
    requestJson<{ item: RoomItem }>(`${root}/items/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(change),
    }),
  actOnGo: (id: string, action: ({ action: "lift"; colour?: number; hand?: "left" | "right" } | { action: "place"; x: number; y: number } | { action: "pass"; colour?: number } | { action: "return" } | { action: "clock" }) & { revision?: number }) =>
    // Over the room socket when it is open, the web request otherwise: see
    // space/item-socket.ts (Nikk 5026, moves stalling on a bad connection).
    actOnItem<{ item: RoomItem }>(id, action as Record<string, unknown>, () =>
      requestJson<{ item: RoomItem }>(`${root}/items/${encodeURIComponent(id)}/action`, {
        method: "POST", body: JSON.stringify(action),
      })),
  /** Each agent's reported helpers. See shared/helpers.ts. */
  helpers: () => requestJson<{ helpers: Record<string, Helper[]> }>(`${root}/helpers`),
  /** The room's breathing session, with the server's clock to line ours up to. */
  meditation: () => requestJson<{ meditation: Meditation; now: number }>(`${root}/meditation`),
  /** The room's sand mandala, and pouring or sweeping it: see shared/mandala.ts. */
  mandala: () => requestJson<{ mandala: Mandala }>(`${root}/mandala`),
  changeMandala: (change: MandalaChange) =>
    requestJson<{ event: MandalaEvent }>(`${root}/mandala`, { method: "POST", body: JSON.stringify(change) }),
  /** The cairn, and adding or lifting a stone: see shared/cairn.ts. */
  cairn: () => requestJson<{ cairn: Cairn }>(`${root}/cairn`),
  /** The paper cranes, and folding one (or releasing the thousand): see shared/cranes.ts. */
  /** Which pieces the room shows, and toggling them: see shared/room-pieces.ts. */
  pieces: () => requestJson<{ pieces: RoomPieces }>(`${root}/pieces`),
  togglePieces: (change: PiecesChange) => requestJson<{ event: PiecesEvent }>(`${root}/pieces`, { method: "POST", body: JSON.stringify(change) }),
  cranes: () => requestJson<{ cranes: Cranes }>(`${root}/cranes`),
  changeCranes: (change: CraneChange) => requestJson<{ event: CraneEvent }>(`${root}/cranes`, { method: "POST", body: JSON.stringify(change) }),
  changeCairn: (change: CairnChange) => requestJson<{ event: CairnEvent }>(`${root}/cairn`, { method: "POST", body: JSON.stringify(change) }),
  /** The paper boats on the koi pond, and floating one: see shared/boats.ts. */
  boats: () => requestJson<{ boats: Boat[]; now: number }>(`${root}/boats`),
  floatBoat: () => requestJson<{ boat: Boat; now: number }>(`${root}/boats`, { method: "POST", body: "{}" }),
  /** The hourglass, and turning it over: see shared/hourglass.ts. */
  hourglass: () => requestJson<{ glass: Hourglass; now: number }>(`${root}/hourglass`),
  turnHourglass: () => requestJson<{ glass: Hourglass; now: number }>(`${root}/hourglass`, { method: "POST", body: "{}" }),
  /** The sound bath: whether one is playing, and starting or stopping it. See shared/sound-bath.ts. */
  soundBath: () => requestJson<{ startedAt: number | null; now: number }>(`${root}/sound-bath`),
  changeSoundBath: (action: "start" | "stop") =>
    requestJson<{ startedAt: number | null; now: number }>(`${root}/sound-bath`, { method: "POST", body: JSON.stringify({ action }) }),
  /** The ikebana vase, and arranging it: see shared/ikebana.ts. */
  vase: () => requestJson<{ vase: Vase }>(`${root}/vase`),
  changeVase: (change: VaseChange) => requestJson<{ event: VaseEvent }>(`${root}/vase`, { method: "POST", body: JSON.stringify(change) }),
  /** The incense burning, and lighting a stick: see shared/incense.ts. */
  incense: () => requestJson<{ sticks: Stick[]; now: number }>(`${root}/incense`),
  lightIncense: () => requestJson<{ sticks: Stick[]; now: number }>(`${root}/incense`, { method: "POST", body: "{}" }),
  /** The star map's constellations, and joining two stars: see shared/stars.ts. */
  stars: () => requestJson<{ sky: StarSky }>(`${root}/stars`),
  joinStars: (a: number, b: number) => requestJson<{ event: StarEvent }>(`${root}/stars`, { method: "POST", body: JSON.stringify({ a, b }) }),
  /** The lanterns in this room's sky, and releasing one: see shared/lantern.ts. */
  lanterns: () => requestJson<{ lanterns: Lantern[]; now: number }>(`${root}/lanterns`),
  releaseLantern: (word: string) =>
    requestJson<{ lantern: Lantern; now: number }>(`${root}/lanterns`, { method: "POST", body: JSON.stringify({ word }) }),
  /** The prayer wheel's count, and a push of it for everyone: see shared/wheel.ts. */
  wheel: () => requestJson<{ turns: number }>(`${root}/wheel`),
  pushWheel: (strength: number) => requestJson<{ push: unknown }>(`${root}/wheel`, { method: "POST", body: JSON.stringify({ strength }) }),
  /** Give the ember fire a word: everyone sees it burn; nothing is kept. See shared/fire.ts. */
  /** Write a word on driftwood at the shore: the next wave takes it. See shared/driftwood.ts. */
  writeOnDriftwood: (word: string) => requestJson<{ ok: boolean }>(`${root}/driftwood`, { method: "POST", body: JSON.stringify({ word }) }),
  offerToFire: (word: string) => requestJson<{ ok: boolean }>(`${root}/fire`, { method: "POST", body: JSON.stringify({ word }) }),
  /** The room's sand garden, and changes to it: see shared/garden.ts. */
  garden: () => requestJson<{ garden: Garden }>(`${root}/garden`),
  rakeGarden: (change: GardenChange) =>
    requestJson<{ event: GardenEvent }>(`${root}/garden`, { method: "POST", body: JSON.stringify(change) }),
  /** Ring one of the singing bowls, for everyone in the room: see shared/bowl.ts. */
  bowl: (body: { bowl?: number; strength: number; kind: "strike" | "sing" | "gong" }) =>
    requestJson<{ strike: unknown }>(`${root}/bowl`, { method: "POST", body: JSON.stringify(body) }),
  /** Cards deliberately shared to this room's persistent mindfulness page. */
  mindfulnessPage: (before?: number | null) => requestJson<{ cards: SharedMindfulnessCard[]; older: number | null }>(
    `${root}/mindfulness${before === undefined || before === null ? "" : `?before=${before}`}`,
  ),
  shareMindfulnessCard: (text: string) => requestJson<{ card: SharedMindfulnessCard }>(`${root}/mindfulness`, {
    method: "POST",
    body: JSON.stringify({ text }),
  }),
  removeMindfulnessCard: (id: string) => requestJson<{ ok: true }>(`${root}/mindfulness/${encodeURIComponent(id)}`, { method: "DELETE" }),
  meditate: (change: MeditationChange & { revision?: number }) =>
    requestJson<{ meditation: Meditation; now: number }>(`${root}/meditation`, {
      method: "POST", body: JSON.stringify(change),
    }),
};
