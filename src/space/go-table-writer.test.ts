import { describe, expect, it } from "vitest";
import { defaultGoItem, type GoRoomItem, type RoomItem } from "../../shared/room-items.js";
import { goSettingRequest } from "./GoTableSettings.js";
import { goTableWriter } from "./go-table-writer.js";

/**
 * Nikk's headset, reproduced without a headset: a server that behaves like
 * saha.ing's — refusing a stale revision with TABLE_CHANGED and bumping the
 * revision on every accepted change — and a client whose socket NEVER delivers
 * a table update. That is the condition the server log showed: fifteen presses,
 * four accepted, eleven refused as stale.
 */

class TableChanged extends Error {
  code = "TABLE_CHANGED";
  constructor() {
    super("The table changed. Try again.");
  }
}

function fakeServer(start: GoRoomItem) {
  let table = { ...start };
  const calls: { kind: string; revision: unknown; body: Record<string, unknown> }[] = [];
  const bump = (patch: Partial<GoRoomItem>) => {
    table = { ...table, ...patch, revision: table.revision + 1 };
    return { item: table as RoomItem };
  };
  return {
    calls,
    get table() {
      return table;
    },
    /** Somebody else changes the table, and this client is not told. */
    elsewhere(patch: Partial<GoRoomItem>) {
      table = { ...table, ...patch, revision: table.revision + 1 };
    },
    api: {
      async configure(_id: string, change: Record<string, unknown>) {
        calls.push({ kind: "configure", revision: change.revision, body: change });
        if (change.revision !== table.revision) throw new TableChanged();
        const { revision: _r, ...rest } = change;
        if (rest.players !== undefined) {
          return bump({ colours: Array.from({ length: rest.players as number }, (_, i) => `c${i}`) });
        }
        return bump(rest as Partial<GoRoomItem>);
      },
      async act(_id: string, action: Record<string, unknown>) {
        calls.push({ kind: "act", revision: action.revision, body: action });
        if (action.revision !== table.revision) throw new TableChanged();
        return bump({});
      },
      async items() {
        calls.push({ kind: "items", revision: undefined, body: {} });
        return { items: [table as RoomItem] };
      },
    },
  };
}

/** A client whose view of the table only changes if something applies to it — and the socket never does. */
function client(server: ReturnType<typeof fakeServer>, start: GoRoomItem) {
  let held = { ...start };
  const notices: string[] = [];
  const writer = goTableWriter({
    current: () => held,
    apply: (item) => {
      held = item as GoRoomItem;
    },
    api: server.api,
    notice: (text) => notices.push(text),
  });
  return {
    writer,
    notices,
    get held() {
      return held;
    },
  };
}

const start = (): GoRoomItem => ({ ...defaultGoItem("t"), revision: 0 });

describe("the Go table's changes, with a socket that never delivers", () => {
  it("PRESS, PRESS, PRESS: every one is accepted — the headset bug, fixed", async () => {
    const server = fakeServer(start());
    const { writer } = client(server, start());
    for (let press = 0; press < 5; press += 1) {
      expect(await writer.configure({ reset: true })).toBe(true);
    }
    // Five presses, five requests, each carrying the revision the one before
    // it produced. No refusals and no retries.
    expect(server.calls.filter((c) => c.kind === "configure").map((c) => c.revision)).toEqual([0, 1, 2, 3, 4]);
    expect(server.table.revision).toBe(5);
  });

  it("uses the answer even before anything has re-rendered", async () => {
    const server = fakeServer(start());
    // `current` NEVER changes here — as if React had not re-rendered yet.
    const frozen = start();
    const writer = goTableWriter({ current: () => frozen, apply: () => {}, api: server.api, notice: () => {} });
    expect(await writer.configure({ reset: true })).toBe(true);
    expect(await writer.configure({ reset: true })).toBe(true);
    expect(server.calls.map((c) => c.revision)).toEqual([0, 1]);
  });

  it("WITHOUT the answer applied, this is exactly what Nikk saw", async () => {
    // The old behaviour, reconstructed: every press sends the revision the
    // client started with, and nothing brings it up to date.
    const server = fakeServer(start());
    const stale = start();
    const results: string[] = [];
    for (let press = 0; press < 4; press += 1) {
      try {
        await server.api.configure("t", { reset: true, revision: stale.revision });
        results.push("200");
      } catch {
        results.push("409");
      }
    }
    expect(results).toEqual(["200", "409", "409", "409"]);
  });

  it("catches up and retries once when somebody else changed the table", async () => {
    const server = fakeServer({ ...start(), colours: ["a", "b"] });
    const view = client(server, { ...start(), colours: ["a", "b"] });
    // Somebody seats two more; this client is not told.
    server.elsewhere({ colours: ["a", "b", "c", "d"] });
    const ok = await view.writer.configure(
      goSettingRequest(view.held, "go:players:more")!,
      (fresh) => goSettingRequest(fresh, "go:players:more"),
    );
    expect(ok).toBe(true);
    // One more than there are NOW: five. Resending the stale "three" would have
    // undone the other person's change.
    expect(server.table.colours).toHaveLength(5);
    expect(server.calls.map((c) => c.kind)).toEqual(["configure", "items", "configure"]);
  });

  it("never retries a MOVE, but catches up so the next one is judged fairly", async () => {
    const server = fakeServer(start());
    const view = client(server, start());
    server.elsewhere({});
    expect(await view.writer.act({ action: "place", x: 1, y: 1 })).toBe(false);
    expect(server.calls.map((c) => c.kind)).toEqual(["act", "items"]);
    expect(view.notices.at(-1)).toMatch(/table changed/i);
    // Caught up: the next move carries the real revision and is accepted.
    expect(await view.writer.act({ action: "place", x: 1, y: 1 })).toBe(true);
  });

  it("drops a second press while the first is still on its way, rather than sending both", async () => {
    const server = fakeServer(start());
    const { writer } = client(server, start());
    const first = writer.configure({ reset: true });
    const second = await writer.configure({ reset: true });
    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(server.calls).toHaveLength(1);
  });

  it("remembers only its own table from a catch-up that returns several", async () => {
    const server = fakeServer(start());
    const other = { ...defaultGoItem("other"), revision: 99 } as RoomItem;
    const api = { ...server.api, items: async () => ({ items: [server.table as RoomItem, other] }) };
    let held = start();
    const writer = goTableWriter({ current: () => held, apply: (i) => { if (i.id === "t") held = i as GoRoomItem; }, api, notice: () => {} });
    server.elsewhere({});
    await writer.configure({ reset: true }, () => ({ reset: true }));
    // The retry used this table's revision, not the other table's 99.
    expect(server.calls.filter((c) => c.kind === "configure").map((c) => c.revision)).toEqual([0, 1]);
  });

  it("says why when the retry is refused too, instead of doing nothing silently", async () => {
    const server = fakeServer(start());
    const view = client(server, start());
    server.elsewhere({});
    // A retry that has nothing to send: the press means nothing on the fresh table.
    expect(await view.writer.configure({ reset: true }, () => null)).toBe(false);
    expect(view.notices.at(-1)).toMatch(/table changed/i);
  });
});
