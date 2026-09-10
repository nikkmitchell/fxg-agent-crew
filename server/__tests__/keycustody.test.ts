import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Key custody is an architectural boundary, not a coding style preference.
 *
 * Agents authenticate to WebHarness with Ed25519 keypairs whose private halves
 * live on the agent's own machine and must never move. The BFF authenticates
 * humans only, via username/password. So the BFF must have no ability to read a
 * private key or sign a challenge — if that capability ever appears here, a
 * compromise of this process becomes a compromise of every agent identity.
 *
 * This test fails the build if such a capability is introduced, which is the
 * point: it is a tripwire for a future change, not a check on today's code.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");

/** Signing/key-loading surface that has no legitimate use in the BFF. */
const FORBIDDEN = [
  "createSign",
  "createPrivateKey",
  "sign(",
  "ed25519",
  "Ed25519",
  "agent_private",
  "BEGIN PRIVATE KEY",
  "/api/agent-auth/",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" || entry === "node_modules" ? [] : sourceFiles(full);
    }
    return full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Strip comments before scanning. We are testing for capability, not for
 * vocabulary — the modules here legitimately *describe* the key-custody
 * boundary in prose, and flagging that would train everyone to delete the
 * explanation rather than to keep the boundary.
 *
 * SQL line comments are stripped too. This codebase embeds schema in template
 * literals, and a `-- ... Ed25519 ...` note explaining why the signature
 * columns are unused tripped this test — the explanation being flagged as the
 * offence, which is exactly the failure mode above.
 *
 * Only when the line STARTS with `--`, because `i--` is a decrement and
 * stripping to end-of-line from anywhere would hide real code behind one.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*--.*$/gm, "");
}

const code = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("key custody", () => {
  const files = sourceFiles(serverRoot);

  it("finds server sources to scan", () => {
    // Guard against the scan silently passing because it found nothing.
    expect(files.length).toBeGreaterThan(0);
  });

  it("still sees capability that is actually code", () => {
    // The comment stripper exists so prose about the boundary is allowed. If it
    // ever swallowed real code, this test would be the only thing standing
    // between us and a tripwire that passes because it stopped looking.
    const hostile = [
      "import { createSign } from 'node:crypto';",
      "const key = createPrivateKey(pem); // harmless-looking",
      "await fetch('/api/agent-auth/login');",
    ].join("\n");

    for (const needle of ["createSign", "createPrivateKey", "/api/agent-auth/"]) {
      expect(stripComments(hostile), needle).toContain(needle);
    }
  });

  it("does not mistake a decrement for a SQL comment", () => {
    expect(stripComments("for (let i = n; i--; ) doSomething(createSign);")).toContain("createSign");
  });

  it.each(FORBIDDEN)("has no signing capability: %s", (needle) => {
    const offenders = files.filter((file) => code(file).includes(needle));
    expect(
      offenders,
      `${needle} found in BFF source — agent private keys must never be loadable here`,
    ).toEqual([]);
  });
});
