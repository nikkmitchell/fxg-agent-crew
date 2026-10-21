import { describe, expect, it, vi, beforeEach } from "vitest";
import { createGameHost } from "./game-host";
import { defaultGameItem } from "../../../shared/table-games";
import type { ServerMessage } from "../../../shared/space-wire";
const api = vi.hoisted(() => ({
  openThingGame: vi.fn(),
  readThingGame: vi.fn(),
  actOnThingGame: vi.fn(),
}));
vi.mock("../../space-client", () => ({ space: api }));
beforeEach(() => {
  vi.resetAllMocks();
  api.readThingGame.mockResolvedValue({ table: null });
});
describe("Things game host", () => {
  it("restores a child, follows room updates, ignores older replies and unsubscribes", async () => {
    const table = defaultGameItem("one/left", "chess", "Alice");
    let send!: (m: ServerMessage) => void;
    const off = vi.fn();
    api.openThingGame.mockResolvedValue({ table });
    const port = createGameHost((fn) => {
        send = fn;
        return off;
      })(table.id),
      draw = vi.fn();
    const stop = port.watch("chess", draw);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.openThingGame).toHaveBeenCalledWith("one/left", "chess");
    expect(draw).toHaveBeenCalledOnce();
    const update = (revision: number) =>
      send({
        type: "roomItems",
        by: "Bob",
        items: [
          {
            kind: "module",
            id: "one",
            tableGames: { left: { ...table, revision } },
          },
        ],
      } as unknown as ServerMessage);
    update(3);
    update(2);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.lastCall?.[0].revision).toBe(3);
    stop();
    update(4);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(off).toHaveBeenCalledOnce();
  });
  it("refreshes after a rejected stale action and forwards confirmed replies immediately", async () => {
    const table = defaultGameItem("one", "chess", "Alice");
    api.openThingGame.mockResolvedValue({ table });
    const port = createGameHost(() => () => {})(table.id),
      draw = vi.fn();
    port.watch("chess", draw);
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.actOnThingGame.mockRejectedValueOnce(new Error("stale"));
    api.openThingGame.mockResolvedValue({ table: { ...table, revision: 2 } });
    await expect(port.action({ action: "move", revision: 0 })).rejects.toThrow(
      "stale",
    );
    expect(draw.mock.lastCall?.[0].revision).toBe(2);
    api.actOnThingGame.mockResolvedValue({ table: { ...table, revision: 3 } });
    await port.action({ action: "join", side: 1, revision: 2 });
    expect(draw.mock.lastCall?.[0].revision).toBe(3);
  });
});

it("uses GET only to restore a saved match, including in a finished space", async () => {
  const table = defaultGameItem("saved", "chess", "Alice");
  api.readThingGame.mockResolvedValue({ table });
  const draw = vi.fn();
  createGameHost(() => () => {})(table.id).watch("chess", draw);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(draw).toHaveBeenCalledWith(table);
  expect(api.openThingGame).not.toHaveBeenCalled();
});
