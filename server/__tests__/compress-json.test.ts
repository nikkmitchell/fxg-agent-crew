import { gunzipSync } from "node:zlib";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { compressJson } from "../compress-json.js";

const app = () => {
  const server = Fastify();
  compressJson(server);
  server.get("/big", async () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ i, text: "the same words again" })) }));
  server.get("/small", async () => ({ ok: true }));
  server.get("/text", async (_request, reply) => reply.type("text/plain").send("x".repeat(5000)));
  return server;
};

describe("JSON answers, gzipped when asked", () => {
  it("gzips a large JSON answer for a client that asks, and it unpacks to the same thing", async () => {
    const server = app();
    const plain = await server.inject({ method: "GET", url: "/big" });
    const packed = await server.inject({ method: "GET", url: "/big", headers: { "accept-encoding": "gzip, br" } });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(packed.headers["content-encoding"]).toBe("gzip");
    expect(packed.headers.vary).toContain("accept-encoding");
    expect(packed.rawPayload.byteLength).toBeLessThan(plain.rawPayload.byteLength / 3);
    expect(JSON.parse(gunzipSync(packed.rawPayload).toString())).toEqual(plain.json());
    await server.close();
  });

  it("leaves small answers, other types and clients that did not ask alone", async () => {
    const server = app();
    for (const url of ["/small", "/text"]) {
      const answer = await server.inject({ method: "GET", url, headers: { "accept-encoding": "gzip" } });
      expect(answer.headers["content-encoding"], url).toBeUndefined();
    }
    await server.close();
  });
});
