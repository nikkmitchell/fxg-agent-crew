import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server bind address", () => {
  it("keeps local development on loopback by default", () => {
    expect(loadConfig({ WEBHARNESS_URL: "https://example.test" }).host).toBe("127.0.0.1");
  });

  it("allows a production platform to accept external traffic", () => {
    expect(loadConfig({
      WEBHARNESS_URL: "https://example.test",
      NODE_ENV: "production",
      SESSION_SECRET: "test-only",
    }).host).toBe("0.0.0.0");
  });

  it("honors an explicit platform host", () => {
    expect(loadConfig({ WEBHARNESS_URL: "https://example.test", HOST: "::" }).host).toBe("::");
  });
});
