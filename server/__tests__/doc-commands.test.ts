import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every `saha.py <command>` the guides and skills tell an agent to run exists.
 *
 * Ten tools became saha.py (2026-10-14, 2026-10-20) and the guides were
 * rewritten to match. A guide naming a command the tool does not have is the
 * same dead end as one naming a deleted script: an agent runs it, is refused,
 * and has no way to know the guide is the thing that is wrong.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const saha = readFileSync(join(root, "public/saha.py"), "utf8");

/** The dispatcher's table, plus the commands main() runs before it. */
const commands = new Set([
  ...[...(/^COMMANDS = \{([\s\S]*?)^\}/m.exec(saha)?.[1] ?? "").matchAll(/"([a-z-]+)":/g)].map((m) => m[1]!),
  ...[...saha.matchAll(/if argv\[0\] (?:==|in) \(?"([a-z-]+)"/g)].map((m) => m[1]!),
  "help",
]);
/** `board open | card ID | ...`, as the board command's own usage line lists them. */
const boardUsage = /board what\? saha\.py board ([^"]+)"\s*\n\s*"([^"]+)"/.exec(saha);
const boardSubcommands = new Set(
  `${boardUsage?.[1] ?? ""} ${boardUsage?.[2] ?? ""}`.split("|").map((part) => part.trim().split(/\s+/)[0]!).filter(Boolean),
);

const markdown = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdown(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
const files = ["README.md", "public/skill.md", "tools/webharness/README.md",
  ...markdown("docs").filter((path) => !path.startsWith("docs/history")), ...markdown(".claude/skills")];

/** Code only: fenced blocks and `inline spans`, where a command is an instruction rather than prose. */
const code = (text: string) => [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join("\n");

describe("the saha.py commands the guides name", () => {
  it("knows its own commands", () => {
    // If the parsing above broke, everything below would pass by finding nothing.
    for (const name of ["status", "say", "board", "listen", "stand", "join", "enter"]) expect(commands).toContain(name);
    for (const name of ["open", "move", "describe", "answer"]) expect(boardSubcommands).toContain(name);
  });

  it("all exist", () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = code(readFileSync(join(root, file), "utf8"));
      for (const [, command, sub] of text.matchAll(/saha\.py[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?/g)) {
        if (!commands.has(command!)) missing.push(`${file}: saha.py ${command}`);
        else if (command === "board" && sub && !boardSubcommands.has(sub)) missing.push(`${file}: saha.py board ${sub}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
