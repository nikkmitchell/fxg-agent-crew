import { once } from "node:events";
import { connect } from "node:net";
import Fastify from "fastify";
import websocket, { type WebSocket } from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { Presence } from "../space/presence.js";
import { MAX_BUFFERED_BYTES, SpaceHub } from "../space/socket.js";

/**
 * saha.ing hung on 2026-09-24 because two sockets stopped reading while still
 * pinging. `ws` kept everything the kernel would not take, in the app, with no
 * ceiling: 96 MB to 400 MB in forty minutes with a headset in the room. See
 * MAX_BUFFERED_BYTES.
 *
 * REAL SOCKETS, NOT A FAKE, because the whole question is what `ws` does with a
 * peer that will not read — and a fake only answers what it was told to. The
 * stuck client is a bare TCP socket that finishes the handshake and then never
 * reads a byte, which is what the kernel on the box showed: 2 MB not sent,
 * receive window shut 99.7% of the time.
 */
describe("a socket that stops reading is cut off, not buffered for ever", () => {
  it("terminates the socket once its backlog passes the limit, and keeps serving the others", async () => {
    const hub = new SpaceHub(new Presence());
    const accepted: WebSocket[] = [];
    const app = Fastify();
    await app.register(websocket);
    app.get("/s", { websocket: true }, (socket) => { accepted.push(socket); });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const stuck = connect(port, "127.0.0.1");
    await once(stuck, "connect");
    stuck.write([
      "GET /s HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13", "", "",
    ].join("\r\n"));
    await once(stuck, "data"); // the 101, and then never another read
    stuck.pause();

    const healthy = new globalThis.WebSocket(`ws://127.0.0.1:${port}/s`);
    let healthyGot = 0;
    healthy.addEventListener("message", () => { healthyGot += 1; });
    await new Promise((resolve) => healthy.addEventListener("open", resolve, { once: true }));
    while (accepted.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    const [stuckEnd, healthyEnd] = accepted;

    const reported: (string | null)[] = [];
    hub.onSlowSocket = (actorId) => reported.push(actorId);
    const stuckClosed = once(stuckEnd, "close");
    hub.attach("Stuck", "agent", stuckEnd);
    hub.attach("Healthy", "agent", healthyEnd);

    // Far more than the limit plus every kernel buffer between the two ends.
    const chunk = 64 * 1024;
    const big = { type: "refused", reason: "x".repeat(chunk) } as const;
    let peak = 0;
    for (let i = 0; i < 600 && stuckEnd.readyState === 1; i++) {
      hub.broadcast(big);
      peak = Math.max(peak, stuckEnd.bufferedAmount);
      await new Promise((resolve) => setImmediate(resolve));
    }

    await stuckClosed;
    expect(peak, "never more than one message past the limit is held").toBeLessThanOrEqual(MAX_BUFFERED_BYTES + chunk + 64);
    expect(peak, "the test really did back the socket up").toBeGreaterThan(MAX_BUFFERED_BYTES);
    expect(reported, "the owner is named, so they can fix their client").toEqual(["Stuck"]);
    expect(healthyEnd.readyState).toBe(1);
    expect(healthyGot).toBeGreaterThan(0);

    hub.close();
    stuck.destroy();
    healthy.close();
    await app.close();
  }, 20_000);
});

describe("a quiet socket holds presence without being sent the room", () => {
  it("skips the tick's snapshot but still gets what is addressed to it", () => {
    const hub = new SpaceHub(new Presence());
    const fake = () => {
      const sent: string[] = [];
      return { sent, socket: { readyState: 1, bufferedAmount: 0, send: (text: string) => sent.push(text) } as unknown as WebSocket };
    };
    const holder = fake();
    const viewer = fake();
    hub.attach("Sill", "agent", holder.socket);
    hub.markQuiet(holder.socket);
    hub.attach("Nikk2", "human", viewer.socket);

    hub.tick();
    hub.tick();
    expect(viewer.sent.filter((text) => text.includes('"snapshot"'))).toHaveLength(2);
    expect(holder.sent, "a holder draws nothing, so the snapshot is all cost").toHaveLength(0);

    expect(hub.deliver("Sill", { type: "refused", reason: "addressed to you" })).toBe(true);
    expect(holder.sent).toHaveLength(1);
    expect(hub.presence.find("Sill")?.connected, "and it is still in the room, awake").toBe(true);
    hub.close();
  });
});

describe("a socket that is behind skips snapshots rather than queueing them", () => {
  // Nikk (5066): answers waited behind a queue of stale snapshots.
  it("queues a snapshot only while the socket has caught up", async () => {
    const { SNAPSHOT_SKIP_BYTES, MAX_BUFFERED_BYTES, wantsSnapshot } = await import("../space/socket.js");
    expect(wantsSnapshot(0)).toBe(true);
    expect(wantsSnapshot(SNAPSHOT_SKIP_BYTES)).toBe(true);
    expect(wantsSnapshot(SNAPSHOT_SKIP_BYTES + 1)).toBe(false);
    // Far below the point where the socket is cut off, so a slow link keeps
    // its connection and only loses frames that were stale anyway.
    expect(SNAPSHOT_SKIP_BYTES * 8).toBeLessThan(MAX_BUFFERED_BYTES);
  });
});
