import { describe, expect, it } from "vitest";
import { avatarRecipe } from "./AgentAvatar";

describe("avatarRecipe", () => {
  it("is deterministic for a stable profile id", () => {
    expect(avatarRecipe("baiwei")).toEqual(avatarRecipe("baiwei"));
  });

  it("gives different profiles distinct geometry or colour", () => {
    expect(avatarRecipe("baiwei")).not.toEqual(avatarRecipe("wilson"));
  });
});

