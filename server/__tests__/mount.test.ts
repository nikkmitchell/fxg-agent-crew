import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

const apps: Array<ReturnType<typeof buildServer>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("embedded /space mount", () => {
  it("keeps classic-chat routes outside the Space service", async () => {
    const { app } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      APP_BASE_PATH: "/space",
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/space/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/space/bff/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/bff/me" })).statusCode).toBe(404);
  });

  it("redirects the bare mount to its trailing-slash asset base", async () => {
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test", APP_BASE_PATH: "/space" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/space" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/space/");
  });
});
