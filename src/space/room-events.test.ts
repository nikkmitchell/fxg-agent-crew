import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../shared/space-wire";
import { deliverRoomEvent, onCairnChange, onOffering } from "./room-events";

describe("the room's objects hear their own socket messages (room-events.ts)", () => {
  it("delivers each message to its object's listeners, and only theirs", () => {
    const cairn: unknown[] = [], fire: unknown[] = [];
    const stopCairn = onCairnChange((event) => cairn.push(event));
    const stopFire = onOffering((offering) => fire.push(offering));
    const event = { action: "add", by: "Kerf" } as never;
    expect(deliverRoomEvent({ type: "cairn", event } as ServerMessage)).toBe(true);
    expect(cairn).toEqual([event]);
    expect(fire).toEqual([]);
    stopCairn();
    deliverRoomEvent({ type: "cairn", event } as ServerMessage);
    expect(cairn).toHaveLength(1);
    stopFire();
  });

  it("leaves every other message to the socket", () => {
    expect(deliverRoomEvent({ type: "helpers", helpers: {} } as unknown as ServerMessage)).toBe(false);
  });
});
