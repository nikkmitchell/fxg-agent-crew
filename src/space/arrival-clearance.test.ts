import { describe, expect, it } from "vitest";
import { othersIn, roomBoards } from "./arrival-clearance";
import { arrivalSpot, distanceToSegment } from "../../shared/arrival";
import { ROOM } from "../../shared/space-layout";

describe("arriving clear of people, agents and boards", () => {
  it("counts connected people and every agent, never you", () => {
    const people = [
      { actorId: "Nikk2", kind: "human", connected: true, at: { x: 0, y: 0, z: 6.2 } },
      { actorId: "Away", kind: "human", connected: false, at: { x: 1, y: 0, z: 6 } },
      { actorId: "Sill", kind: "agent", connected: false, at: { x: -1, y: 0, z: 6 } },
      { actorId: "baiwei2", kind: "human", connected: true, at: { x: 2, y: 0, z: 6 } },
    ] as never;
    expect(othersIn(people, "baiwei2")).toEqual([{ x: 0, z: 6.2 }, { x: -1, z: 6 }]);
  });
  it("in meditation.AR keeps a metre from the guide board beside the door", () => {
    const boards = roomBoards([], false, true);
    const spot = arrivalSpot({ x: ROOM.spawn.x, z: ROOM.spawn.z }, [], boards);
    expect(distanceToSegment(spot, boards[0])).toBeGreaterThanOrEqual(1);
  });
  it("has no work panels in the lobby", () => {
    expect(roomBoards(["chat", "said"], true, false)).toEqual([]);
  });
});
