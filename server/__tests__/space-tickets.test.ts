import { statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KIT_LIMITS } from "../../shared/space-kit.js";
import { HEARTBEAT_MS, keepAlive, RENEW_MS, SpaceLive, type LiveSocket } from "../spaces/live.js";
import { SpaceTickets, ticketKey } from "../spaces/tickets.js";
import { tempDir } from "./test-config.js";

const nikk = { username: "Nikk2", body: "CuteMoth", space: "xr.instruments" };

describe("tickets that survive a restart (Mica, 6319; Sill, 6326)", () => {
  it("are read by a new server with the same key, but not by one with another key", () => {
    const key = ticketKey(join(tempDir("tickets-"), "space-tickets.key"));
    const ticket = new SpaceTickets(key).issue(nikk);
    expect(new SpaceTickets(key).read(ticket, "xr.instruments")).toEqual(nikk);
    expect(new SpaceTickets().read(ticket, "xr.instruments")).toBeNull();
  });

  it("name one space only, refuse any change, and run out", () => {
    let now = 1_000;
    const tickets = new SpaceTickets(undefined, () => now);
    const ticket = tickets.issue(nikk);
    expect(tickets.read(ticket, "meditation.ar")).toBeNull();
    const [payload, mac] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "Sill", b: null, s: "xr.instruments", e: now + 1e9 })).toString("base64url");
    expect(tickets.read(`${forged}.${mac}`, "xr.instruments")).toBeNull();
    expect(tickets.read(`${payload}.${mac}x`, "xr.instruments")).toBeNull();
    expect(tickets.read(payload, "xr.instruments")).toBeNull();
    now += KIT_LIMITS.ticketMs + 1;
    expect(tickets.read(ticket, "xr.instruments")).toBeNull();
  });

  it("keep their key in a file only the server can read, made once and reused", () => {
    const path = join(tempDir("tickets-"), "nested", "space-tickets.key");
    const first = ticketKey(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(ticketKey(path).equals(first)).toBe(true);
  });
});

const socket = () => {
  const sent: Array<{ t: string; [key: string]: unknown }> = [];
  const closed: number[] = [];
  const live: LiveSocket = { send: (text) => sent.push(JSON.parse(text)), close: (code = 1000) => closed.push(code) };
  return { live, sent, closed };
};
const store = { state: () => ({}), items: () => [] } as never;

afterEach(() => vi.useRealTimers());

describe("one seat per page (Mica, 6319: two tabs showed \"6 here\")", () => {
  it("replaces the page's old seat when the same page comes back, and keeps its name", () => {
    const live = new SpaceLive(store, () => null);
    const first = socket();
    live.join("xr.instruments", first.live, nikk, { page: "page-aaaaaaaa" });
    const again = socket();
    live.join("xr.instruments", again.live, nikk, { page: "page-aaaaaaaa" });
    expect(first.closed).toEqual([4000]);
    expect(live.count("xr.instruments")).toBe(1);
    expect((again.sent.find((m) => m.t === "hello") as unknown as { you: { id: string } }).you.id).toBe("Nikk2");
    live.stop();
  });

  it("still shows a second tab or device as a second figure (Nikk, 6173)", () => {
    const live = new SpaceLive(store, () => null);
    live.join("xr.instruments", socket().live, nikk, { page: "page-aaaaaaaa" });
    const other = socket();
    live.join("xr.instruments", other.live, nikk, { page: "page-bbbbbbbb" });
    expect(live.count("xr.instruments")).toBe(2);
    expect((other.sent.find((m) => m.t === "hello") as unknown as { you: { id: string } }).you.id).toBe("Nikk2~2");
    live.stop();
  });

  it("hands a person a fresh ticket while they stay, and stops when they leave", () => {
    vi.useFakeTimers();
    const live = new SpaceLive(store, () => null);
    const seat = socket();
    let made = 0;
    const leave = live.join("xr.instruments", seat.live, nikk, { page: "page-aaaaaaaa", renew: () => `fresh-${++made}` });
    vi.advanceTimersByTime(RENEW_MS * 2 + 10);
    expect(seat.sent.filter((m) => m.t === "ticket").map((m) => m.ticket)).toEqual(["fresh-1", "fresh-2"]);
    leave.leave();
    vi.advanceTimersByTime(RENEW_MS * 2);
    expect(made).toBe(2);
    live.stop();
  });
});

describe("a seat whose page has gone, gone (3 ghost seats in xr.instruments, 2026-09-30)", () => {
  const pingable = () => {
    let onPong: () => void = () => {};
    const log: string[] = [];
    return { log, pong: () => onPong(), socket: { ping: () => log.push("ping"), terminate: () => log.push("terminate"), on: (_: "pong", listener: () => void) => (onPong = listener) } };
  };

  it("keeps a socket that answers, and ends one that does not", () => {
    vi.useFakeTimers();
    const alive = pingable();
    keepAlive(alive.socket);
    for (let beat = 0; beat < 4; beat += 1) {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      alive.pong();
    }
    expect(alive.log).toEqual(["ping", "ping", "ping", "ping"]);

    const gone = pingable();
    keepAlive(gone.socket);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(gone.log).toEqual(["ping", "terminate"]);
  });

  it("stops asking once the socket has closed", () => {
    vi.useFakeTimers();
    const closed = pingable();
    const stop = keepAlive(closed.socket);
    stop();
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(closed.log).toEqual([]);
  });
});
