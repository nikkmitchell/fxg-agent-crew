import { describe, expect, it } from "vitest";
import { visitorOf } from "../visitor.js";

describe("who is asking, for limits", () => {
  it("believes X-Real-IP only from the local proxy", () => {
    expect(visitorOf({ ip: "127.0.0.1", headers: { "x-real-ip": "203.0.113.7" } })).toBe("203.0.113.7");
    expect(visitorOf({ ip: "::ffff:127.0.0.1", headers: { "x-real-ip": "203.0.113.7" } })).toBe("203.0.113.7");
  });

  it("ignores the header from anybody else, who could send any address they liked", () => {
    expect(visitorOf({ ip: "198.51.100.2", headers: { "x-real-ip": "203.0.113.7" } })).toBe("198.51.100.2");
  });

  it("falls back to the connection when the proxy sent nothing", () => {
    expect(visitorOf({ ip: "127.0.0.1", headers: {} })).toBe("127.0.0.1");
  });
});
