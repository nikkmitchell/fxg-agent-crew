import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import type { ServerMessage } from "../../shared/space-wire.js";

/**
 * The socket the room is drawn from.
 *
 * These bind a REAL port and connect a REAL WebSocket client, rather than
 * driving the handler in-process. That is deliberate and it was not the first
 * attempt: `app.injectWS` never delivers a client's close to the server, so a
 * test written against it reports that nobody ever leaves the room. The bug
 * would have been in the test, and the behaviour it was hiding — a person
 * closing their tab and staying in the room forever — is exactly the one worth
 * proving.
 *
 * A real socket also proves the handshake itself: 101, with the session cookie
 * carried on it like any other request.
 */

const running: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
});

const boot = async () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    // Fastify's own request logging drowns the test output and none of it is
    // what these tests are about.
    LOG_LEVEL: "silent",
  });
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  running.push({ close: async () => void (await built.app.close()) });
  const address = built.app.server.address();
  if (typeof address === "string" || address === null) throw new Error("no port bound");

  const as = (username: string, kind: "human" | "agent" = "human") =>
    `${built.config.cookieName}=${built.sessions.create(username, "upstream-token", kind)}`;

  return { ...built, as, origin: `ws://127.0.0.1:${address.port}` };
};

/**
 * Connect and record every frame from the moment the socket exists.
 *
 * Attaching a listener after `await open` loses the welcome frame, which the
 * server sends the instant the handler runs.
 */
const connect = async (origin: string, cookie?: string) => {
  const socket = new WebSocket(`${origin}/bff/space/socket`, {
    // Node's WebSocket takes headers; a browser sends the cookie by itself.
    ...(cookie ? { headers: { cookie } } : {}),
  } as never);

  const waiting: ServerMessage[] = [];
  const wanters: ((message: ServerMessage) => void)[] = [];
  let closeCode: number | null = null;
  const closeWanters: ((code: number) => void)[] = [];

  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const wanter = wanters.shift();
    if (wanter) wanter(message);
    else waiting.push(message);
  });
  socket.addEventListener("close", (event: CloseEvent) => {
    closeCode = event.code;
    for (const wanter of closeWanters.splice(0)) wanter(event.code);
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket errored before opening")), {
      once: true,
    });
  });

  const next = (what: string, timeoutMs = 4_000): Promise<ServerMessage> => {
    const buffered = waiting.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${what} within ${timeoutMs}ms`)), timeoutMs);
      wanters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  };

  /** Keep reading until a frame satisfies `want`, so a stale snapshot cannot pass. */
  const where = async (
    want: (message: ServerMessage) => boolean,
    what: string,
    attempts = 40,
  ): Promise<ServerMessage> => {
    for (let index = 0; index < attempts; index += 1) {
      const message = await next(what);
      if (want(message)) return message;
    }
    throw new Error(`never saw ${what} in ${attempts} frames`);
  };

  /** Everything received so far, cleared. For asserting what did NOT happen. */
  const drain = (): ServerMessage[] => waiting.splice(0);

  const closed = (): Promise<number> =>
    closeCode !== null
      ? Promise.resolve(closeCode)
      : new Promise((resolve) => closeWanters.push(resolve));

  return { socket, next, where, drain, closed };
};

/** Wait for a condition rather than for a duration. */
const until = async (condition: () => boolean, what: string, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${what} did not happen within ${timeoutMs}ms`);
};

describe("the space socket", () => {
  it("refuses a socket with no session, and says why before closing", async () => {
    const { origin } = await boot();
    const nobody = await connect(origin);

    expect(await nobody.next("refusal")).toEqual({ type: "refused", reason: "not signed in" });
    // 1008 is policy violation. A silent close looks like a broken proxy, and
    // that confusion has cost a day before.
    expect(await nobody.closed()).toBe(1008);
  });

  it("refuses an actor that is not a person", async () => {
    const { origin, as } = await boot();
    const robot = await connect(origin, as("import"));

    expect(await robot.next("refusal")).toMatchObject({ type: "refused" });
    expect(await robot.closed()).toBe(1008);
  });

  it("welcomes a signed-in person as who the SERVER says they are", async () => {
    const { origin, as } = await boot();
    const nikk = await connect(origin, as("nikk"));

    const message = await nikk.next("welcome");
    expect(message.type).toBe("welcome");
    if (message.type !== "welcome") throw new Error("unreachable");
    // Identity comes from the cookie, never from anything the client sent.
    expect(message.you).toBe("nikk");
    expect(message.people.map((person) => person.actorId)).toEqual(["nikk"]);

    nikk.socket.close();
  });

  it("shows one person another, and their movement", async () => {
    const { origin, as } = await boot();
    const nikk = await connect(origin, as("nikk"));
    await nikk.next("welcome");
    const inkstone = await connect(origin, as("inkstone", "agent"));
    await inkstone.next("welcome");

    nikk.socket.send(JSON.stringify({ type: "move", at: { x: 2.5, y: 0, z: -1.5 }, facing: 0.5 }));

    const seen = await inkstone.where(
      (message) =>
        message.type === "snapshot" &&
        message.people.some((person) => person.actorId === "nikk" && person.at.x === 2.5),
      "nikk's new position",
    );
    if (seen.type !== "snapshot") throw new Error("unreachable");
    const nikkAsSeen = seen.people.find((person) => person.actorId === "nikk")!;
    expect(nikkAsSeen.at).toEqual({ x: 2.5, y: 0, z: -1.5 });
    expect(nikkAsSeen.facing).toBe(0.5);
    // And the kind each declared, unchanged.
    expect(seen.people.find((person) => person.actorId === "inkstone")!.kind).toBe("agent");

    nikk.socket.close();
    inkstone.socket.close();
  });

  it("treats a second tab as a second tab, not a second person", async () => {
    const { origin, as, space } = await boot();
    const cookie = as("nikk");
    const tabOne = await connect(origin, cookie);
    await tabOne.next("welcome");
    const tabTwo = await connect(origin, cookie);
    const welcome = await tabTwo.next("welcome");

    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.people).toHaveLength(1);
    expect(space.presence.size).toBe(1);

    // Closing one tab must not remove someone who is still watching.
    tabOne.socket.close();
    await until(() => space.connectedSockets === 1, "the first tab to be forgotten");
    expect(space.presence.size).toBe(1);

    tabTwo.socket.close();
    await until(() => space.presence.size === 0, "the room to empty");
  });

  it("ignores a frame it cannot read instead of dropping the socket", async () => {
    const { origin, as, space } = await boot();
    const nikk = await connect(origin, as("nikk"));
    const welcome = await nikk.next("welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    const spawn = welcome.people[0]!.at;

    nikk.socket.send("not json at all");
    // The interesting case is not a missing field, it is a field of the wrong
    // TYPE. `Math.min(6.5, "over there")` is NaN, and a NaN position propagates
    // through every distance calculation on the server and poisons the snapshot
    // for everyone else in the room.
    nikk.socket.send(JSON.stringify({ type: "move", at: { x: "over there", y: 0, z: 0 }, facing: 0 }));
    nikk.socket.send(JSON.stringify({ type: "move", at: { x: 1e999, y: 0, z: 0 }, facing: "sideways" }));
    nikk.socket.send(JSON.stringify({ type: "nonsense" }));

    // Frames are ordered, so anything those were going to do has been done by
    // the time three ticks have gone past.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const snapshots = nikk.drain().filter((message) => message.type === "snapshot");
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      if (snapshot.type !== "snapshot") throw new Error("unreachable");
      const seen = snapshot.people.find((person) => person.actorId === "nikk")!;
      expect(seen.at, "a rejected move must not move anybody").toEqual(spawn);
      expect(Number.isFinite(seen.facing), "facing must stay a number").toBe(true);
    }

    // And the socket is still usable — a bad frame is not a reason to hang up.
    nikk.socket.send(JSON.stringify({ type: "move", at: { x: 1, y: 0, z: 1 }, facing: 0 }));
    const seen = await nikk.where(
      (message) => message.type === "snapshot" && message.people[0]!.at.x === 1,
      "a good move landing after the bad ones",
    );
    if (seen.type !== "snapshot") throw new Error("unreachable");
    expect(seen.people[0]!.at).toEqual({ x: 1, y: 0, z: 1 });
    expect(space.presence.size).toBe(1);

    nikk.socket.close();
  });
});
