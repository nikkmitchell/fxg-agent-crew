import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

const boot = () => {
  const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: testBlobRoot(), LOG_LEVEL: "silent" });
  const as = (username: string) => `${built.config.cookieName}=${built.sessions.create(username, "local-test-token", "agent")}`;
  return { ...built, as };
};

describe("playing Go together", () => {
  it("requires a seat for visible moves, keeps black first, and rejects a delayed board click", async () => {
    const { app, as } = boot();
    const black = { cookie: as("Black") };
    const white = { cookie: as("White") };
    const unseated = { cookie: as("Visitor") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers: black, payload: { kind: "go" } })).json().item.id;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black, payload: { action: "mode", mode: "seated" } });

    const visitorMove = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: unseated,
      payload: { action: "lift", expectedMoveNumber: 0 } });
    expect(visitorMove.statusCode).toBe(409);
    expect(visitorMove.json().error).toMatch(/choose an open bowl/);

    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: white, payload: { action: "sit", colour: 1 } });
    const whiteFirst = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: white,
      payload: { action: "lift", expectedMoveNumber: 0 } });
    expect(whiteFirst.statusCode).toBe(409);
    expect(whiteFirst.json().error).toMatch(/another player's turn/);
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black, payload: { action: "sit", colour: 0 } });

    expect((await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: black,
      payload: { action: "lift", expectedMoveNumber: 0 } })).statusCode).toBe(200);
    const placed = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: black,
      payload: { action: "place", x: 4, y: 4, expectedMoveNumber: 0 } });
    expect(placed.json().item).toMatchObject({ moveNumber: 1, activeColour: 1 });
    const delayed = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: black,
      payload: { action: "place", x: 3, y: 3, expectedMoveNumber: 0 } });
    expect(delayed.statusCode).toBe(409);
    expect(delayed.json().code).toBe("STALE_GO_TURN");
    await app.close();
  });

  it("keeps cards private, seats players, and applies one style-driven move against a fresh turn", async () => {
    const { app, as } = boot();
    const black = { cookie: as("Inkstone") };
    const white = { cookie: as("Sill") };
    const created = await app.inject({ method: "POST", url: "/bff/space/items", headers: black, payload: { kind: "go" } });
    const id = created.json().item.id as string;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black, payload: { action: "mode", mode: "seated" } });

    expect((await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black, payload: { action: "sit", colour: 0 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: white, payload: { action: "sit", colour: 1 } })).statusCode).toBe(200);
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black,
      payload: { action: "card", style: "patient", risk: "cautious", signature: "connect gently" } });
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: white,
      payload: { action: "card", style: "experimental", risk: "bold", signature: "" } });

    const privateCard = await app.inject({ method: "GET", url: `/bff/space/items/${id}/player`, headers: black });
    expect(privateCard.json().card).toEqual({ style: "patient", risk: "cautious", signature: "connect gently" });
    const sameActorDifferentCase = { cookie: as("inkstone") };
    expect((await app.inject({ method: "GET", url: `/bff/space/items/${id}/player`, headers: sameActorDifferentCase })).json().card)
      .toEqual(privateCard.json().card);
    const publicItem = await app.inject({ method: "GET", url: "/bff/space/items", headers: white });
    expect(publicItem.body).not.toContain("connect gently");
    expect(publicItem.json().items[0].seats).toEqual(["Inkstone", "Sill"]);

    const played = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: black,
      payload: { action: "suggest", expectedMoveNumber: 0 } });
    expect(played.statusCode).toBe(200);
    expect(played.json().suggestion).toMatchObject({ style: "patient" });
    expect(played.json().item).toMatchObject({ moveNumber: 1, activeColour: 1, stones: [{ colour: 0 }] });

    const wrongTurn = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: black,
      payload: { action: "pass", expectedMoveNumber: 1 } });
    expect(wrongTurn.statusCode).toBe(409);
    expect(wrongTurn.json().error).toMatch(/another player's turn/);

    const stale = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: white,
      payload: { action: "pass", expectedMoveNumber: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("STALE_GO_TURN");
    await app.close();
  });

  it("does not let an unseated or observer actor move for a claimed color", async () => {
    const { app, as } = boot();
    const headers = { cookie: as("Observer") };
    const unseated = { cookie: as("Unseated") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers, payload: { kind: "go" } })).json().item.id;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers, payload: { action: "mode", mode: "seated" } });
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers, payload: { action: "sit", colour: 0 } });
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers, payload: { action: "card", style: "observer", risk: "balanced" } });
    const denied = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: unseated,
      payload: { action: "suggest", expectedMoveNumber: 0 } });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error).toMatch(/choose an open bowl/);
    const result = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers,
      payload: { action: "suggest", expectedMoveNumber: 0 } });
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toMatch(/set to observe/);
    await app.close();
  });

  it("ends the game after every seated player passes once", async () => {
    const { app, as } = boot();
    const black = { cookie: as("Black") };
    const white = { cookie: as("White") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers: black, payload: { kind: "go" } })).json().item.id;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: black, payload: { action: "mode", mode: "seated" } });
    for (const [headers, colour] of [[black, 0], [white, 1]] as const) {
      await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers, payload: { action: "sit", colour } });
      await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers, payload: { action: "card", style: "casual", risk: "balanced" } });
    }
    const first = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: black,
      payload: { action: "pass", expectedMoveNumber: 0 } });
    expect(first.json().item.gameOver).toBe(false);
    const second = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: white,
      payload: { action: "pass", expectedMoveNumber: 1 } });
    expect(second.json().item).toMatchObject({ gameOver: true, consecutivePasses: 2, activeColour: 0 });
    expect(second.json().item.score).toMatchObject({ area: [0, 0], komi: [0, 6.5], totals: [0, 6.5], winner: 1 });
    const restarted = await app.inject({ method: "PATCH", url: `/bff/space/items/${id}`, headers: black, payload: { size: 9 } });
    expect(restarted.json().item).toMatchObject({ moveNumber: 0, gameOver: false, score: null, activeColour: 0, seats: ["Black", "White"] });
    await app.close();
  });

  it("lets the first picker own only the current Open turn, without assigning a color role", async () => {
    const { app, as } = boot();
    const first = { cookie: as("First") };
    const second = { cookie: as("Second") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers: first, payload: { kind: "go" } })).json().item.id;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: first,
      payload: { action: "card", style: "patient", risk: "balanced" } });
    const lifted = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: first,
      payload: { action: "lift", expectedMoveNumber: 0 } });
    expect(lifted.json().item).toMatchObject({ mode: "open", turnActor: "First", seats: [null, null], liftedColour: 0 });
    const blocked = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: second,
      payload: { action: "lift", expectedMoveNumber: 0 } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/picked up this turn/);
    const placed = await app.inject({ method: "POST", url: `/bff/space/items/${id}/action`, headers: first,
      payload: { action: "place", x: 2, y: 2, expectedMoveNumber: 0 } });
    expect(placed.json().item).toMatchObject({ moveNumber: 1, activeColour: 1, turnActor: null, seats: [null, null] });
    const activeReset = await app.inject({ method: "PATCH", url: `/bff/space/items/${id}`, headers: first, payload: { size: 9 } });
    expect(activeReset.statusCode).toBe(409);
    const modeChange = await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: first,
      payload: { action: "mode", mode: "seated" } });
    expect(modeChange.statusCode).toBe(409);
    await app.close();
  });

  it("lets the first bowl picker choose their lasting role in Seated mode", async () => {
    const { app, as } = boot();
    const white = { cookie: as("White") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers: white, payload: { kind: "go" } })).json().item.id;
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: white,
      payload: { action: "mode", mode: "seated" } });
    const choseWhite = await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: white,
      payload: { action: "sit", colour: 1 } });
    expect(choseWhite.json()).toMatchObject({ seat: 1, item: { activeColour: 0, seats: [null, "White"] } });
    await app.close();
  });

  it("supports a three-color Open house game and ends after every color passes", async () => {
    const { app, as } = boot();
    const actor = { cookie: as("Wanderer") };
    const id = (await app.inject({ method: "POST", url: "/bff/space/items", headers: actor, payload: { kind: "go" } })).json().item.id;
    const expanded = await app.inject({ method: "PATCH", url: `/bff/space/items/${id}`, headers: actor, payload: { addBowl: true } });
    expect(expanded.json().item.colours).toHaveLength(3);
    await app.inject({ method: "PUT", url: `/bff/space/items/${id}/player`, headers: actor,
      payload: { action: "card", style: "casual", risk: "balanced" } });
    let last: { item: { activeColour: number; gameOver: boolean; consecutivePasses: number; score: unknown } } | null = null;
    for (let move = 0; move < 3; move += 1) {
      const response = await app.inject({ method: "POST", url: `/bff/space/items/${id}/play`, headers: actor,
        payload: { action: "pass", expectedMoveNumber: move } });
      expect(response.statusCode).toBe(200);
      last = response.json();
    }
    expect(last?.item).toMatchObject({ gameOver: true, consecutivePasses: 3, score: { winner: null } });
    await app.close();
  });
});
