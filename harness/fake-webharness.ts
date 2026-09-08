/**
 * A WebHarness that can be broken on command.
 *
 * `saha-browser-acceptance` asks for three behaviours proven in a real browser:
 * history that does not silently truncate, a failed send that can be retried
 * with an honest receipt, and going offline and back without losing a queued
 * message or double-sending it. Every one of those is a FAILURE path, and the
 * live server cannot be made to fail on demand — asking a real service to drop
 * a send is not a test, it is a request.
 *
 * So this stands in for upstream, and the BFF under test is the real one. That
 * matters: the interesting logic — session cookies, cursors, the send path, the
 * 2000-character refusal — lives in the BFF, and a harness that replaced it
 * would prove nothing about the thing we ship. It also keeps every credential
 * out of the browser, which is the boundary this product is built around: the
 * page only ever holds an opaque session cookie.
 *
 * Failures are induced through /__control, never by editing product code.
 *
 *   POST /__control/fail-sends      { "count": 1 }   next N sends return 503
 *   POST /__control/offline         { "on": true }   every request fails
 *   POST /__control/say             { "content": "" } inject a message from someone else
 *   GET  /__control/state                            what the fake has recorded
 *   POST /__control/reset
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Msg = {
  id: number;
  username: string;
  content: string;
  msgType: "text";
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
};

const USER = process.env.FAKE_USER ?? "tester";
const PASSWORD = process.env.FAKE_PASSWORD ?? "tester";
const TOKEN = "fake-token";
const ROOM = process.env.FAKE_ROOM ?? "AgentParty";

const state = {
  messages: [] as Msg[],
  nextId: 1,
  /** Sends that will fail before any succeed. */
  failSends: 0,
  offline: false,
  /** Every send the BFF actually forwarded, including ones we then failed. */
  sendAttempts: [] as string[],
};

function say(username: string, content: string): Msg {
  const now = new Date().toISOString();
  const message: Msg = {
    id: state.nextId++,
    username,
    content,
    msgType: "text",
    createdAt: now,
    updatedAt: now,
    streaming: false,
  };
  state.messages.push(message);
  return message;
}

/**
 * Seeded with more history than one page holds.
 *
 * A truncation bug is invisible against a short room: everything fits, so a
 * reader that stops early looks identical to one that finishes.
 */
function seed(count: number) {
  for (let i = 1; i <= count; i += 1) {
    say(i % 3 === 0 ? "colleague" : USER, `seeded message ${i} of ${count}`);
  }
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://fake");
  const path = url.pathname;

  if (path.startsWith("/__control/")) {
    const body = await readBody(req);
    switch (path) {
      case "/__control/fail-sends":
        state.failSends = Number(body.count ?? 1);
        return json(res, 200, { failSends: state.failSends });
      case "/__control/offline":
        state.offline = Boolean(body.on);
        return json(res, 200, { offline: state.offline });
      case "/__control/say":
        return json(res, 200, say(String(body.username ?? "colleague"), String(body.content ?? "hello")));
      case "/__control/state":
        return json(res, 200, {
          messages: state.messages.length,
          lastId: state.nextId - 1,
          sendAttempts: state.sendAttempts,
          contents: state.messages.map((m) => m.content),
        });
      case "/__control/reset":
        state.messages = [];
        state.nextId = 1;
        state.failSends = 0;
        state.offline = false;
        state.sendAttempts = [];
        seed(Number(body.seed ?? 0));
        return json(res, 200, { ok: true });
      default:
        return json(res, 404, { error: "no such control" });
    }
  }

  // Offline is total, and applied before auth: a network that is down does not
  // check your password first.
  if (state.offline) {
    res.destroy();
    return;
  }

  if (path === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.username !== USER || body.password !== PASSWORD) {
      return json(res, 401, { detail: "bad credentials" });
    }
    return json(res, 200, { token: TOKEN });
  }

  const authorized = req.headers.authorization === `Bearer ${TOKEN}`;
  if (!authorized) return json(res, 401, { detail: "unauthorized" });

  if (path === "/api/me") return json(res, 200, { username: USER });
  if (path === "/api/rooms" && req.method === "GET") {
    return json(res, 200, { rooms: [{ roomName: ROOM, isPublic: true, memberCount: 2 }] });
  }
  if (path === `/api/rooms/${ROOM}` && req.method === "GET") {
    return json(res, 200, { roomName: ROOM, isPublic: true, members: [USER, "colleague"] });
  }

  if (path === `/api/rooms/${ROOM}/messages`) {
    if (req.method === "POST") {
      const body = await readBody(req);
      const content = String(body.content ?? "");
      // Recorded BEFORE the failure decision, so a test can prove a retry sent
      // once and not twice even when the first attempt was rejected.
      state.sendAttempts.push(content);
      if (state.failSends > 0) {
        state.failSends -= 1;
        return json(res, 503, { detail: "upstream said no" });
      }
      if (content.length > 2_000) return json(res, 422, { detail: "too long" });
      return json(res, 201, say(USER, content));
    }

    const afterId = Number(url.searchParams.get("afterId") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const page = state.messages.filter((m) => m.id > afterId).slice(0, limit);
    return json(res, 200, { roomName: ROOM, messages: page });
  }

  return json(res, 404, { detail: `no route ${path}` });
});

const port = Number(process.env.FAKE_PORT ?? 8899);
seed(Number(process.env.FAKE_SEED ?? 0));
server.listen(port, "127.0.0.1", () => {
  console.log(`fake webharness on http://127.0.0.1:${port} (room ${ROOM}, user ${USER})`);
});
