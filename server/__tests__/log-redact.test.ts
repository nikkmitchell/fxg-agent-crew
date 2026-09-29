import { describe, expect, it } from "vitest";
import { redactUrl } from "../log-redact.js";

describe("URLs in the log", () => {
  it("never carry a space ticket or a token", () => {
    expect(redactUrl("/bff/spaces/x/live?page=abc&ticket=eyJ1.sig")).toBe("/bff/spaces/x/live?page=abc&ticket=…");
    expect(redactUrl("/bff/spaces/x/ice?ticket=abc")).toBe("/bff/spaces/x/ice?ticket=…");
    expect(redactUrl("/a?token=1&b=2")).toBe("/a?token=…&b=2");
    expect(redactUrl("/plain/path")).toBe("/plain/path");
  });
});
