import { describe, expect, it } from "vitest";
import { hasProjectAuthority, leavesNoManager, mayManageMembership, type MembershipRow } from "../board-rules.js";

/**
 * Who may change who belongs to a project. One rule, read by the server that
 * enforces it and the page that offers the control: these were two copies that
 * disagreed about revoked members and about who may seed an empty project, and
 * the page's last-manager check was never called.
 */

const row = (actorId: string, roles: string[], active = true): MembershipRow => ({ projectId: "saha", actorId, roles, active });

describe("may this actor manage membership", () => {
  it("lets an active manager, and nobody else", () => {
    const rows = [row("nikk", ["manager"]), row("ink", ["ui"])];
    expect(mayManageMembership(rows, "saha", "nikk", "nikk")).toBe(true);
    // Holding a role in a project is not the same as administering it.
    expect(mayManageMembership(rows, "saha", "ink", "nikk")).toBe(false);
    expect(mayManageMembership(rows, "saha", "stranger", "nikk")).toBe(false);
  });

  it("folds case, as the room does: WebHarness has re-spelled an actor before", () => {
    expect(mayManageMembership([row("Nikk2", ["manager"])], "saha", "nikk2", "Nikk2")).toBe(true);
  });

  it("lets only the recorded creator seed a project that has never had a member", () => {
    expect(mayManageMembership([], "saha", "nikk", "nikk")).toBe(true);
    expect(mayManageMembership([], "saha", "stranger", "nikk")).toBe(false);
    // No recorded creator closes the bootstrap rather than opening it to all.
    expect(mayManageMembership([], "saha", "anyone", undefined)).toBe(false);
  });

  it("does NOT reopen the bootstrap once every member is revoked", () => {
    // "No members yet" and "no members any more" are different; treating them
    // alike let anyone make themselves manager of an abandoned project.
    const rows = [row("nikk", ["manager"], false)];
    expect(mayManageMembership(rows, "saha", "stranger", "nikk")).toBe(false);
    // Not even the creator, once their own manager row is revoked.
    expect(mayManageMembership(rows, "saha", "nikk", "nikk")).toBe(false);
  });

  it("looks only at the project asked about", () => {
    const elsewhere = [{ ...row("nikk", ["manager"]), projectId: "other" }];
    expect(mayManageMembership(elsewhere, "saha", "nikk", "someone")).toBe(false);
  });
});

describe("would a change leave the project with no manager", () => {
  it("refuses revoking the last manager", () => {
    expect(leavesNoManager([row("nikk", ["manager"])], "saha", "nikk", { action: "revoke" })).toBe(true);
  });

  it("refuses re-granting the last manager without the role", () => {
    expect(leavesNoManager([row("nikk", ["manager"])], "saha", "nikk", { action: "grant", roles: ["ui"] })).toBe(true);
  });

  it("allows removing a manager while another remains", () => {
    const rows = [row("nikk", ["manager"]), row("ink", ["manager"])];
    expect(leavesNoManager(rows, "saha", "ink", { action: "revoke" })).toBe(false);
  });

  it("allows removing somebody who is not a manager", () => {
    expect(leavesNoManager([row("nikk", ["manager"]), row("ink", [])], "saha", "ink", { action: "revoke" })).toBe(false);
  });

  it("does not count a revoked manager as one who remains", () => {
    const rows = [row("nikk", ["manager"]), row("ink", ["manager"], false)];
    expect(leavesNoManager(rows, "saha", "nikk", { action: "revoke" })).toBe(true);
  });

  it("refuses seeding a project's first member without making anybody a manager", () => {
    // Otherwise the bootstrap closes behind a project nobody can administer.
    expect(leavesNoManager([], "saha", "ink", { action: "grant", roles: ["ui"] })).toBe(true);
    expect(leavesNoManager([], "saha", "nikk", { action: "grant", roles: ["manager"] })).toBe(false);
  });
});

describe("authority comes from membership alone", () => {
  it("is granted by an active membership and gone the moment it is revoked", () => {
    expect(hasProjectAuthority([row("claude", [])], "saha", "claude")).toBe(true);
    expect(hasProjectAuthority([row("claude", [], false)], "saha", "claude")).toBe(false);
  });

  it("gives an agent nothing because its owner is a manager", () => {
    // Ownership is not even a parameter: it cannot influence the answer.
    expect(hasProjectAuthority([row("nikk", ["manager"])], "saha", "claude-nikk2mbp")).toBe(false);
  });
});
