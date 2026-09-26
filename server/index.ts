import { fileURLToPath } from "node:url";
import { DEFAULT_SPACE_ROOM, roomKey } from "../shared/space-room.js";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { loadConfig, type Config } from "./config.js";
import { MemorySessionStore, SqliteSessionStore, type Session, type SessionStore } from "./session.js";
import { spaceRoomOf } from "./require-session.js";
import { WebharnessClient } from "./webharness/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBuildRoutes } from "./routes/build.js";
import { registerBoardRoutes } from "./routes/board.js";
import { SpaceHub, registerSpaceEntryRoute, registerSpaceRoutes } from "./space/socket.js";
import { Presence } from "./space/presence.js";
import { DeclaredPostures } from "./space/postures.js";
import { AgentHomes, registerHomeRoutes } from "./space/homes.js";
import { AgentBodies, registerBodyRoutes } from "./space/bodies.js";
import { AgentVoices, registerVoiceRoutes } from "./space/voices.js";
import { Memories, registerMemoryRoutes } from "./space/memories.js";
import { knownToTheCatalogue } from "./space/catalogue.js";
import { BodyFiles, registerBodyFileRoutes } from "./space/body-files.js";
import { Touches, registerTouchRoutes } from "./space/touch.js";
import { Activity } from "./space/activity.js";
import { BoardReads } from "./db/reads.js";
import { BoardStore } from "./db/store.js";
import { PanelPlaces, registerPanelRoutes } from "./space/panels.js";
import { RoomShowing, registerShowingRoutes } from "./space/showing.js";
import { RoomMeditations, registerMeditationRoutes } from "./space/meditation.js";
import { RoomHelpers, registerHelperRoutes } from "./space/helpers.js";
import { registerSendTimingRoutes } from "./space/send-timing.js";
import { Utterances, registerUtteranceRoutes } from "./space/utterances.js";
import { registerSpeechRoutes, speakWith, speechCache } from "./space/speak.js";
import { registerAvatarRoutes } from "./space/avatar.js";
import { registerFollowingRoutes } from "./space/following.js";
import { registerPathRoutes } from "./space/paths.js";
import { registerTranscribeRoutes } from "./space/transcribe.js";
import { ScreenFrames, ShareKeys, registerScreenRoutes } from "./space/screens.js";
import { openDatabase } from "./db/open.js";
import { RoomItems, registerRoomItemRoutes } from "./space/items.js";
import { Holds, registerHoldRoutes } from "./space/holds.js";

/**
 * Backend-for-frontend.
 *
 * The UI and its /bff/* are served from ONE origin, which is the point: WebHarness
 * sends no CORS headers and answers preflight OPTIONS with 405, so a browser on
 * a different origin cannot call it at all. Same-origin removes the problem
 * rather than working around it.
 */
/**
 * Choose a session store from config.
 *
 * ":memory:" is explicit rather than implied by an absent path, so a deployment
 * that loses sessions on every restart has to have asked for it.
 */
function createSessionStore(config: Config): SessionStore {
  if (config.sessionStorePath === ":memory:") {
    return new MemorySessionStore(config.sessionTtlMs);
  }
  mkdirSync(dirname(config.sessionStorePath), { recursive: true });
  return new SqliteSessionStore(config.sessionTtlMs, config.sessionStorePath, DatabaseSync);
}

/**
 * Walk up from `start` looking for a built UI. Throws rather than falling back
 * to a guess: a server that boots while serving nothing looks healthy and is
 * useless, and "the API works but every page is 404" is a bad thing to discover
 * from a user.
 */
function findUiRoot(start: string): string {
  for (let dir = start, i = 0; i < 6; i += 1, dir = dirname(dir)) {
    const candidate = resolve(dir, "dist");
    if (existsSync(resolve(candidate, "index.html"))) return candidate;
  }
  throw new Error(
    `no built UI found near ${start} — run \`pnpm run build\` before starting the server`,
  );
}

export function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = Fastify({ logger: { level: config.logLevel } });
  const sessions = createSessionStore(config);

  // saha.ing's own database. Opened once per process and migrated on the way
  // up, so a deploy that changes the schema fails at boot rather than on the
  // first request that touches a new column.
  if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openDatabase(config.databasePath, DatabaseSync);

  /**
   * Uploads arrive as raw bytes.
   *
   * Fastify has no parser for image types, and without one it answers 415
   * before a handler ever runs. Registering the types we actually store — and
   * nothing else — means an unexpected content type is refused by the framework
   * rather than reaching the sniffer as a surprise.
   */
  // The refused types are parsed too, on purpose. Fastify answers an
  // unregistered content type with a bare 415, and the whole value of refusing
  // SVG is the sentence that comes with it — "SVG can carry scripts, export it
  // as PNG". The sniffer in blobs.ts is still the gate; this only decides
  // whether the person gets an answer or a status code.
  for (const mime of [
    "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
    "application/octet-stream", "image/svg+xml", "text/html",
    // A recording on its way to be written down. See space/transcribe.ts.
    "audio/wav",
  ]) {
    app.addContentTypeParser(mime, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }
  const client = new WebharnessClient(config.webharnessUrl);

  app.register(cookie);
  // Registered at the root so the upgrade handler sees every request. The route
  // itself is declared inside the prefixed block below, so it moves with the
  // base path like everything else.
  app.register(websocket);

  // Who is standing where. In memory, on purpose — see server/space/presence.ts.
  // Declared postures are the one exception, kept in the database so a deploy
  // does not put every agent to sleep — see server/space/postures.ts.
  const agentHomes = new AgentHomes(database);
  // Which body each actor chose for itself. Stored, like homes: a decision
  // somebody made, not a fact about where they are standing right now.
  const agentBodies = new AgentBodies(database);
  const agentVoices = new AgentVoices(database);
  const memories = new Memories(database);
  // Reading a line back aloud needs it by id; registerUtteranceRoutes keeps its
  // own for writing. Both are stateless over the same table.
  const utteranceBook = new Utterances(database);
  /**
   * Lines this box has turned into sound, and the engine that does it.
   *
   * ONE CACHE FOR BOTH PATHS: the room warms a line the moment it is said, and
   * a listener asks for it later. Two of these would be two engines fighting
   * over half a gigabyte on a box with 1.6.
   */
  const speech = speechCache({
    cacheRoot: resolve(config.speechCacheRoot),
    speaker: () => (process.env.SPEAK_CMD?.trim() ? speakWith(process.env.SPEAK_CMD.trim()) : undefined),
    // Warming swallows its failure on purpose; the reason still has to go
    // somewhere, or a broken engine is indistinguishable from a busy one.
    onTrouble: (error, text, voice) =>
      app.log.warn({ err: error, voice, line: text.slice(0, 60) }, "could not say a line aloud"),
  });
  // Names the 300 catalogue bodies and, for each, the one address its file may
  // be fetched from. Read lazily; see server/space/catalogue.ts.
  const inTheCatalogue = knownToTheCatalogue();
  // Bodies pulled from the collection on first use and then served off disk.
  const bodyFiles = new BodyFiles(resolve(config.bodyCacheRoot), inTheCatalogue);
  const touches = new Touches(database);
  // Made before the room, which reads it: an agent whose screen is sharing is
  // awake. See Presence.settlePostures.
  const screenFrames = new ScreenFrames();
  /**
   * The existing activity/re-hydration trail belongs to the development room.
   * New rooms get independent live hubs below; board actions do not conjure an
   * agent into a second room where that agent has not declared itself.
   */
  const roomAtDefault = DEFAULT_SPACE_ROOM;
  const homesInDefaultRoom = { get: (actorId: string) => agentHomes.get(roomAtDefault, actorId) };
  const space = new SpaceHub(
    new Presence(Date.now, new DeclaredPostures(database), homesInDefaultRoom, (actorId) => screenFrames.get(actorId) !== undefined),
    (actorId) => agentBodies.get(actorId),
  );
  // The default hub is the existing room, unchanged. Other rooms get their own
  // live presence, tick, socket and voice sets; sharing a single hub is enough
  // to leak people and calls even when all durable furniture is room-keyed.
  const logSlowSocket = (room: string) => (actorId: string | null, bufferedBytes: number) =>
    app.log.warn({ actorId, room, bufferedBytes }, "space socket cut off: its client stopped reading");
  space.onSlowSocket = logSlowSocket(DEFAULT_SPACE_ROOM);
  const spaceHubs = new Map<string, SpaceHub>([[DEFAULT_SPACE_ROOM, space]]);
  const hubFor = (room: string): SpaceHub => {
    const key = roomKey(room);
    const existing = spaceHubs.get(key);
    if (existing) return existing;
    const created = new SpaceHub(
      new Presence(Date.now, new DeclaredPostures(database),
        { get: (actorId) => agentHomes.get(key, actorId) },
        (actorId) => screenFrames.get(actorId, key) !== undefined),
      (actorId) => agentBodies.get(actorId),
    );
    created.onSlowSocket = logSlowSocket(key);
    spaceHubs.set(key, created);
    return created;
  };
  const evictSessionEverywhere = (sid: string) => {
    for (const hub of spaceHubs.values()) hub.evictSession(sid);
  };
  // A socket authenticates at handshake, but a cookie can expire or be
  // destroyed while the connection stays open. Do not let it keep receiving a
  // private room indefinitely. The check is bounded by connected sockets and
  // does not poll the network or consume model turns.
  const sessionSweep = setInterval(() => {
    for (const hub of spaceHubs.values()) hub.evictInvalidSessions((sid, room) => {
      const session = sessions.get(sid);
      return !!session && !session.requiresRoomEntry && spaceRoomOf(session) === room;
    });
  }, 30_000);
  sessionSweep.unref();

  // What makes them move: the audit table, read forward from the end of it.
  // Started here rather than on the first socket, so an agent that acts while
  // nobody is watching is already in the right place when someone arrives.
  // The stands are read fresh on every mapped row rather than captured, so an
  // agent walks to where its panel is NOW — see the note in Activity.
  const panelPlaces = new PanelPlaces(database);
  // What the room is showing, shared by everyone standing in it. `BoardReads`
  // is passed in so a choice can be checked against what actually exists
  // rather than stored and discovered wrong by everybody at once later.
  const roomShowing = new RoomShowing(database, new BoardReads(database));
  // The breathing session each room shares, in memory: see space/meditation.ts.
  const roomMeditations = new RoomMeditations(database);
  // Agents' helpers, as the agents report them: see space/helpers.ts.
  const roomHelpers = new RoomHelpers();
  const roomItems = new RoomItems(database);
  // One for the whole server: a panel's hold and the Go table's must be the
  // same registry the place and move routes consult, or the lock locks nothing.
  const holds = new Holds();
  const activity = new Activity(
    database,
    space.presence,
    Date.now,
    () => Object.fromEntries(panelPlaces.all(roomAtDefault).map((place) => [place.id, place])),
    (actorId) => agentHomes.get(roomAtDefault, actorId),
    (id) => roomItems.one(roomAtDefault, id),
    (actorId) => sessions.mayInferInDefaultRoom(actorId),
  );
  activity.onError = (error) => app.log.error({ error }, "space activity poll failed");
  // Put the agents back before anything else looks at the room. A restart
  // emptied it, and unlike a person an agent has no client to reconnect and say
  // where it is — so without this it stays missing until it next touches the
  // board, and the room reports it as absent in the meantime. See rehydrate().
  activity.rehydrate();
  activity.start();

  // A prefix lets Wilson mount this beside classic chat at /space without
  // stealing its routes. With the default empty prefix, existing URLs remain
  // /bff/* and the app remains a standalone service.
  const shareKeys = new ShareKeys(database);
  const actorBook = new BoardStore(database);

  app.register(async (scoped) => {
    // Production sign-in begins with no selected room. The historical default
    // remains for sessions created before this lobby release, but a newly
    // signed-in member cannot read the development room merely by typing
    // /room or calling a room endpoint before /space/enter verifies membership.
    // Avatar, voice and memory choices are personal, not room-scoped; they stay
    // available from the front door. A screen share upload is key-authorized.
    scoped.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?", 1)[0];
      if (!path.startsWith("/bff/space/") || path === "/bff/space/enter") return;
      const personal = /^(?:body(?:\/|$|-model\/)|bodies(?:\/|$)|voice(?:\/|$)|voices(?:\/|$)|memories(?:\/|$)|transcribe(?:\/|$)|touch-preferences(?:\/|$))/.test(path.slice("/bff/space/".length));
      const keyUpload = path === "/bff/space/screens/frame" && request.method === "PUT";
      const sharers = path === "/bff/space/screens/sharers";
      if (personal || keyUpload || sharers) return;
      const session = sessions.get(request.cookies[config.cookieName]);
      if (session?.requiresRoomEntry) {
        return reply.code(403).send({ code: "ROOM_NOT_SELECTED", error: "choose and enter a room first" });
      }
    });
    // Who signed in, with the kind WebHarness holds for them, so a new agent is
    // offered on the share page before it has touched the board.
    registerAuthRoutes(
      scoped,
      config,
      sessions,
      client,
      (username, kind) => actorBook.ensureActor(username, kind),
      // The room is the claim; the store decides what it is worth. A room with
      // no link, or a link with auto_enrol off, grants nothing.
      (actorId, kind, rooms) => rooms.flatMap((room) => actorBook.enrolFromRoom(actorId, room, kind ?? undefined)),
      (actorId) => activity.forgetIfAway(actorId),
      evictSessionEverywhere,
    );
    // ONE ROOM, ONE PROJECT (Nikk 4586): a new room gets its project, linked,
    // and the room shows it from the start; joining or entering a room enrols
    // you in its project if its link says being there is enough.
    const enrolInRoom = (session: Session, roomName: string) =>
      actorBook.enrolFromRoom(session.username, roomName, session.kind);
    /** Give a room its project, show it, and tell anyone already in the room. */
    const giveRoomItsProject = (session: Session, roomName: string) => {
      const projectId = actorBook.createRoomProject({ id: session.username, kind: session.kind }, roomName);
      const result = roomShowing.set(roomKey(roomName), { projectId, boardId: null }, session.username, new Date().toISOString());
      if ("showing" in result) hubFor(roomKey(roomName)).broadcast({ type: "showing", showing: result.showing });
    };
    /**
     * A ROOM MADE ANYWHERE GETS ITS BOARD. The lobby makes a room's project as
     * it makes the room; a room made straight on webharness.chat (Nikk's
     * meditation.AR) had none, and no agent could give it one: Nightjar's first
     * find walking it (4650). So the first person to ENTER a room that has no
     * project and shows no board makes it. A room that already shows a board,
     * however it got there, is left exactly as it is.
     */
    const enterRoom = (session: Session, roomName: string) => {
      const shown = roomShowing.current(roomKey(roomName)).projectId;
      if (!actorBook.roomProject(roomName)) {
        if (shown === null) giveRoomItsProject(session, roomName);
        // A board somebody put up by hand: its manager entering links it.
        else actorBook.linkRoomByManager({ id: session.username, kind: session.kind }, shown, roomName);
      }
      enrolInRoom(session, roomName);
    };
    registerRoomRoutes(scoped, config, sessions, client, {
      created: giveRoomItsProject,
      joined: enrolInRoom,
    });
    registerProjectRoutes(scoped, config, sessions, client);
    registerBuildRoutes(scoped, config, sessions);
    registerBoardRoutes(
      scoped,
      config,
      sessions,
      database,
      config.blobRoot,
      (actorId, kind, view) => activity.observeRead(actorId, kind, view),
      (auditId, at, actorId) => activity.revealAt(auditId, at, actorId),
    );
    registerSpaceRoutes(
      scoped,
      config,
      sessions,
      space,
      (room) => panelPlaces.all(room),
      (room) => roomShowing.current(room),
      (room) => roomItems.all(room),
      touches,
      hubFor,
    );
    registerSpaceEntryRoute(scoped, config, sessions, client,
      evictSessionEverywhere,
      (actorId) => activity.forgetIfAway(actorId),
      enterRoom);
    registerTouchRoutes(scoped, { config, sessions, hub: space, hubFor, touches });
    registerPanelRoutes(scoped, {
      database,
      sessions,
      config,
      announce: (room, panel, by) => hubFor(room).broadcast({ type: "panelMoved", panel, by }),
      announceOpen: (room, open, by) => hubFor(room).broadcast({ type: "panelsOpen", open, by }),
      holds,
    });
    registerHoldRoutes(scoped, { config, sessions, holds });
    registerShowingRoutes(scoped, {
      showing: roomShowing,
      sessions,
      config,
      announce: (room, showing) => hubFor(room).broadcast({ type: "showing", showing }),
    });
    // Where a voice send's time goes in a headset: see space/send-timing.ts.
    registerSendTimingRoutes(scoped, { config, sessions });
    registerHelperRoutes(scoped, {
      config,
      sessions,
      helpers: roomHelpers,
      announce: (room, helpers) => hubFor(room).broadcast({ type: "helpers", helpers }),
    });
    // Finished helpers fade and stale reports expire without anyone posting,
    // so the rooms are told when their live set changes on its own.
    const helperSweep = setInterval(() => {
      for (const { room, helpers } of roomHelpers.changed(Date.now())) hubFor(room).broadcast({ type: "helpers", helpers });
    }, 2_000);
    helperSweep.unref?.();
    scoped.addHook("onClose", async () => clearInterval(helperSweep));
    registerMeditationRoutes(scoped, {
      config,
      sessions,
      meditations: roomMeditations,
      present: (room) => hubFor(room).presence.everyone().filter((one) => one.connected).map((one) => one.actorId),
      announce: (room, meditation) => hubFor(room).broadcast({ type: "meditation", meditation }),
    });
    registerRoomItemRoutes(scoped, {
      config,
      sessions,
      items: roomItems,
      announce: (room, items, by) => hubFor(room).broadcast({ type: "roomItems", items, by }),
      holds,
    });
    registerUtteranceRoutes(
      scoped,
      config,
      sessions,
      database,
      (room, utterance) => hubFor(room).broadcast({ type: "said", utterance }),
      (room, actorId, utteranceId) => hubFor(room).presence.attend(actorId, utteranceId),
      (room, actorId, kind) => hubFor(room).presence.spoke(actorId, kind),
      (room, actorId, kind, targetActorId, durationMs) =>
        hubFor(room).presence.speakTo(actorId, kind, targetActorId, durationMs),
      // Said now, so it is ready to hear by the time anybody asks for it.
      (utterance) => {
        if (utterance.say) speech.warm(utterance.say, agentVoices.voiceOf(utterance.actorId).id);
      },
    );
    registerTranscribeRoutes(scoped, config, sessions, {
      /**
       * The names the transcriber should expect to hear. Measured: without them
       * "Plumbline" comes back as "Plum Line" and "saha.ing" as "Sahaha
       * dotting". From the database, so an agent that joins tomorrow is heard
       * by name with nobody remembering to add it.
       */
      names: () =>
        (database.prepare("SELECT id FROM actors WHERE retired_at IS NULL ORDER BY id").all() as { id: string }[])
          .map((row) => row.id),
    });
    registerAvatarRoutes(
      scoped,
      config,
      sessions,
      (room, actorId, kind, control) => hubFor(room).presence.animate(actorId, control, kind),
    );
    registerPathRoutes(scoped, {
      config,
      sessions,
      walk: (room, actorId, kind, waypoints, because) =>
        hubFor(room).presence.walk(actorId, kind, waypoints, because),
      stopWalking: (room, actorId) => hubFor(room).presence.stopWalking(actorId),
    });
    registerFollowingRoutes(
      scoped,
      config,
      sessions,
      (room, actorId, kind, targetId, side, because) =>
        hubFor(room).presence.follow(actorId, kind, targetId, side, because),
      (room, actorId) => hubFor(room).presence.stopFollowing(actorId),
    );
    registerScreenRoutes(scoped, { config, sessions, frames: screenFrames, keys: shareKeys });
    registerHomeRoutes(scoped, {
      config,
      sessions,
      homes: agentHomes,
      kindOf: (actorId) => shareKeys.kindOf(actorId) ?? space.presence.find(actorId)?.kind ?? null,
      /**
       * INTERRUPTING, because a person placing an agent is an explicit
       * instruction and outranks whatever that agent had been told to do.
       * Without the flag the placement was applied and then silently undone on
       * the next tick by a follow or a route rewriting the heading — the route
       * answered 200 and nothing moved.
       *
       * Note what does NOT pass it: activity.ts walks agents to the board
       * through the same `sendTo`, and a board comment should not drag somebody
       * out of walking with a person. Those sends are declined instead, which
       * leaves the standing instruction visible rather than pretending.
       */
      // What the placement ended goes back to the route, which tells whoever placed the agent.
      goHome: (room, actorId, home) => {
        const { stoppedFollowing, abandonedRoute } =
          hubFor(room).presence.sendTo(actorId, "agent", home.at, null, home.facing, true);
        return { stoppedFollowing, abandonedRoute };
      },
      whereIs: (room, actorId) => hubFor(room).presence.find(actorId)?.at ?? null,
      whoIsHere: (room) => hubFor(room).presence.everyone().map((occupant) => occupant.actorId).sort(),
    });
    registerMemoryRoutes(scoped, { config, sessions, memories });
    registerVoiceRoutes(scoped, {
      config,
      sessions,
      voices: agentVoices,
      /**
       * WHETHER ANYTHING CAN ACTUALLY BE SPOKEN, read at call time rather than
       * captured at boot so a box that gains an engine does not need a restart
       * to admit it.
       *
       * SPEAK_CMD mirrors TRANSCRIBE_CMD deliberately: the same shape as the
       * Whisper seam, so the box needs no Python and no packages until somebody
       * decides to install an engine. Absent means an agent still HAS a voice
       * and nothing is said aloud — which the voices route reports rather than
       * implies.
       */
      canSpeak: () => Boolean(process.env.SPEAK_CMD?.trim()),
    });
    registerBodyRoutes(scoped, {
      config,
      sessions,
      bodies: agentBodies,
      // So a catalogue body resolves to a real choice, and an invented name is
      // told apart from one this server simply cannot check.
      inTheCatalogue,
    });
    registerBodyFileRoutes(scoped, { config, sessions, files: bodyFiles });
    /**
     * Saying a line aloud, in the speaker's own voice. Read at call time like
     * `canSpeak` above, so a box that gains an engine starts speaking without a
     * restart — and one that never has an engine refuses in a sentence.
     */
    registerSpeechRoutes(scoped, {
      config,
      sessions,
      speech,
      utterance: (id, room) => utteranceBook.one(id, room),
      // The SPEAKER's voice, never the listener's: it is their line being read.
      voiceOf: (actorId) => agentVoices.voiceOf(actorId).id,
    });
  }, { prefix: config.basePath ?? "" });

  // Serve the built UI from the same origin as the API.
  // Resolve the UI bundle by SEARCHING upward rather than assuming a fixed
  // depth. Running from source, this file sits at server/; compiled, it sits
  // at dist-server/server/ — one level deeper. A hardcoded "../dist" is
  // correct in dev and silently 404s the entire UI in production, which is
  // exactly what happened the first time this was built for real.
  const here = dirname(fileURLToPath(import.meta.url));
  const uiRoot = findUiRoot(here);
  const basePath = config.basePath ?? "";
  app.register(staticPlugin, {
    root: uiRoot,
    prefix: basePath ? `${basePath}/` : "/",
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith(`${basePath}/bff/`)) return reply.code(404).send({ error: "not found" });
    // /api/ IS RESERVED, and stays reserved now that the app owns `/`.
    //
    // The old mount at /space existed so this service could sit beside classic
    // chat on one origin without capturing its routes, and release.sh asserted
    // that `/` and `/api/rooms` both 404. Chat now lives on its own domain, so
    // the mount is gone — but the REASON for it is not. Without this, the SPA
    // fallback answers /api/anything with the app, and the day something else
    // is served from this origin we have the capture problem back, silently.
    //
    // Cheap to keep, expensive to rediscover.
    if (/^\/api(\/|$)/.test(new URL(request.url, "http://placeholder").pathname)) {
      return reply.code(404).send({ error: "not found" });
    }
    if (basePath && request.url === basePath) return reply.redirect(`${basePath}/`);
    if (basePath && !request.url.startsWith(`${basePath}/`)) return reply.code(404).send({ error: "not found" });
    // A MISSING FILE MUST 404, not quietly become the app.
    //
    // The fallback exists so /board and /people reach the SPA. Applying it to
    // everything meant a missing asset answered 200 with index.html, and the
    // browser then refused it: "Expected a JavaScript-or-Wasm module script but
    // the server responded with a MIME type of text/html". The page renders
    // BLANK. Nothing on screen, nothing in the server log, a 200 in the access
    // log — the only evidence is a console message nobody is looking at.
    //
    // It is reachable in production: a browser holding a cached index.html
    // after a deploy asks for the previous build's hashed asset. That request
    // deserves a 404, which a browser understands, rather than a 200 that
    // leaves it staring at HTML it cannot execute.
    //
    // A path whose last segment has an extension is asking for a file. App
    // routes do not carry one.
    if (/\.[a-zA-Z0-9]+$/.test(new URL(request.url, "http://placeholder").pathname)) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });

  // Stop the tick loop when the server does. The timer is unref'd so it would
  // not hold the process open anyway, but a loop still broadcasting into
  // half-closed sockets during shutdown produces errors that look like bugs.
  app.addHook("onClose", async () => {
    clearInterval(sessionSweep);
    activity.stop();
    for (const hub of spaceHubs.values()) hub.close();
  });

  // `sessions` is returned so a test can sign somebody in without a real
  // upstream. Deliberately not a back door into a running server: this is the
  // value the process already holds, handed to whoever constructed it.
  return { app, config, sessions, database, space, hubFor, activity, voices: agentVoices, memories };
}

// Only listen when run directly, so tests can build the server without binding.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { app, config } = buildServer();
  app.listen({ port: config.port, host: config.host ?? "127.0.0.1" }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
