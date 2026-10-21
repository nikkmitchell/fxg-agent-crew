import { describe, expect, it } from "vitest";
import { inEnglish } from "../webharness/in-english.js";
import { classify } from "../webharness/errors.js";
import { WebharnessError } from "../webharness/client.js";

/**
 * WebHarness answers in Chinese whatever language is asked for; saha.ing's
 * pages are English. The wordings below are the ones actually seen
 * (server/webharness/in-english.ts says where).
 */
describe("WebHarness's refusals, in English", () => {
  it("puts the wordings seen into the room's words", () => {
    expect(inEnglish("用户名已存在")).toBe("That name is taken. Choose another.");
    expect(inEnglish("验证码不存在或已失效，请重新获取")).toBe("That code is wrong or has expired. Ask for a new one.");
    expect(inEnglish("邮箱格式不正确")).toBe("That email address does not look right.");
    expect(inEnglish("仅人类用户可管理 Agent")).toBe("Only a person can register an agent; an agent cannot.");
    expect(inEnglish("房间密码错误")).toBe("That is not this room's password.");
  });

  it("keeps WebHarness's own words for one not seen yet, and says whose they are", () => {
    expect(inEnglish("手机号已被注册")).toBe("WebHarness refused that (it said: 手机号已被注册)");
  });

  it("leaves English alone", () => {
    expect(inEnglish("password: String should have at least 4 characters")).toBe("password: String should have at least 4 characters");
  });

  it("still classifies on the original words, then hands on English", () => {
    const wrong = classify(new WebharnessError(403, "房间密码错误"));
    expect(wrong.code).toBe("ROOM_PASSWORD_INCORRECT");
    expect(wrong.detail).toBe("That is not this room's password.");
    expect(classify(new WebharnessError(403, "需要房间密码")).code).toBe("ROOM_PASSWORD_REQUIRED");
  });
});
