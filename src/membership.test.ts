import { describe, expect, it } from "vitest";
import {
  type Membership,
  canManageMembership,
  grantMembership,
  hasRole,
  membersOf,
  revokeMembership,
} from "./membership";
import { projectAuthority } from "./profiles";

const member = (actorId: string, roles: Membership["roles"], active = true): Membership => ({
  projectId: "saha-ing",
  actorId,
  roles,
  active,
  grantedBy: "nikk",
});

describe("who may change membership", () => {
  it("lets a manager manage it", () => {
    expect(canManageMembership([member("nikk", ["manager"])], "saha-ing", "nikk", "nikk")).toBe(true);
  });

  it("does not let a non-manager member manage it", () => {
    // Holding a role in a project is not the same as administering it.
    expect(canManageMembership([member("nikk", ["manager"]), member("ink", ["ui"])], "saha-ing", "ink", "nikk")).toBe(
      false,
    );
  });

  it("lets the creator seed the first membership, or no project could gain one", () => {
    expect(canManageMembership([], "saha-ing", "nikk", "nikk")).toBe(true);
  });

  it("does not let a stranger seed an empty project", () => {
    // The bootstrap is a real hole if it is not tied to the recorded creator.
    expect(canManageMembership([], "saha-ing", "stranger", "nikk")).toBe(false);
  });

  it("refuses the bootstrap entirely when nobody is recorded as creator", () => {
    expect(canManageMembership([], "saha-ing", "anyone", undefined)).toBe(false);
  });
});

describe("granting", () => {
  it("adds a member with their roles, attributed to whoever granted it", () => {
    const result = grantMembership(
      [member("nikk", ["manager"])],
      { projectId: "saha-ing", actorId: "ink", roles: ["ui"] },
      "nikk",
      "nikk",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.value.find((m) => m.actorId === "ink");
      expect(added?.roles).toEqual(["ui"]);
      // An unattributable grant is indistinguishable from one nobody authorised.
      expect(added?.grantedBy).toBe("nikk");
    }
  });

  it("refuses a membership with no roles", () => {
    // A member who can do nothing and means nothing is a mistake, not an intent.
    const result = grantMembership(
      [member("nikk", ["manager"])],
      { projectId: "saha-ing", actorId: "ink", roles: [] },
      "nikk",
      "nikk",
    );
    expect(result.ok).toBe(false);
  });

  it("replaces an existing membership rather than duplicating it", () => {
    const result = grantMembership(
      [member("nikk", ["manager"]), member("ink", ["ui"])],
      { projectId: "saha-ing", actorId: "ink", roles: ["ui", "testing"] },
      "nikk",
      "nikk",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.filter((m) => m.actorId === "ink")).toHaveLength(1);
  });

  it("refuses a grant from someone with no authority", () => {
    const result = grantMembership(
      [member("nikk", ["manager"])],
      { projectId: "saha-ing", actorId: "ink", roles: ["ui"] },
      "stranger",
      "nikk",
    );
    expect(result.ok).toBe(false);
  });
});

describe("revoking", () => {
  it("deactivates rather than deleting, so past authorship stays explicable", () => {
    const result = revokeMembership(
      [member("nikk", ["manager"]), member("ink", ["ui"])],
      "saha-ing",
      "ink",
      "nikk",
      "nikk",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.value.find((m) => m.actorId === "ink");
      expect(row).toBeDefined();
      expect(row?.active).toBe(false);
      expect(membersOf(result.value, "saha-ing").map((m) => m.actorId)).toEqual(["nikk"]);
    }
  });

  it("refuses to remove the last manager", () => {
    // Otherwise the project reaches a state nobody can ever administer again,
    // and the action that caused it looked like a success.
    const result = revokeMembership([member("nikk", ["manager"])], "saha-ing", "nikk", "nikk", "nikk");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("last manager");
  });

  it("allows removing a manager while another remains", () => {
    const result = revokeMembership(
      [member("nikk", ["manager"]), member("ink", ["manager"])],
      "saha-ing",
      "ink",
      "nikk",
      "nikk",
    );
    expect(result.ok).toBe(true);
  });
});

describe("membership is the only route to authority", () => {
  it("grants authority through an active membership", () => {
    const active = [{ projectId: "saha-ing", actorId: "claude", active: true }];
    expect(projectAuthority("claude", active, "saha-ing")).toBe(true);
  });

  it("removes authority the moment a membership is revoked", () => {
    const revoked = [{ projectId: "saha-ing", actorId: "claude", active: false }];
    expect(projectAuthority("claude", revoked, "saha-ing")).toBe(false);
  });

  it("gives an agent nothing because its owner is a manager", () => {
    // The rule this system repeats at every layer. The owner is a manager here;
    // the agent still has no authority, because it has no membership.
    const owners = [{ projectId: "saha-ing", actorId: "nikk", active: true }];
    expect(projectAuthority("claude-nikk2mbp", owners, "saha-ing")).toBe(false);
  });

  it("keeps roles and authority independent of task ownership", () => {
    // Holding a card does not make you a member.
    expect(hasRole([member("nikk", ["manager"])], "saha-ing", "someone-with-a-card", "manager")).toBe(false);
  });
});
