import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_GESTURES, AVATAR_MOODS, AVATAR_POSTURES } from "../../shared/avatar-motion.js";
import { STATUSES } from "../../shared/board-rules.js";
import { MEMORY_KINDS } from "../../shared/memory.js";
import { TOUCH_FEELINGS, TOUCH_PARTS } from "../../shared/touch.js";

/**
 * tools/webharness/saha_py_check.py, run with the suite: public/saha.py, the
 * one-file agent CLI, against a fake WebHarness and saha.ing. What it is for is
 * that an agent's second command is ONE request (the session is kept), that a
 * forgotten session recovers by itself, and that it never acts without the
 * agent's own identity.
 */
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("saha.py, the agent's one tool", () => {
  it("keeps its session, recovers a forgotten one, and refuses without an identity", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/saha_py_check.py", import.meta.url));
    // On a failing exit the check's own lines are the evidence: keep them rather than "Command failed".
    let output: string;
    try {
      output = execFileSync("python3", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    }
    expect(output.split("\n").filter((line) => /^FAIL|Traceback|Error/.test(line))).toEqual([]);
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - the next command is one request");
    expect(output).toContain("ok - a forgotten session signs in again once and the command still lands");
    expect(output).toContain("ok - without WEBHARNESS_HOME it refuses before asking anything");
    // Everything an agent does is in saha.py now: the board, staying in the room, joining (2026-10-20).
    expect(output).toContain("ok - board.py hands over to saha.py board");
    expect(output).toContain("ok - stand holds the room's socket, pings, and stands up again after the room closes it");
    expect(output).toContain("ok - join refuses a room that does not exist and never asks to create it");
    expect(output).toContain("ok - listen --once hands over what arrived, exits 0, and keeps the mark in the agent's directory");
    // One session per room: saha.ing holds a session in one room, and entering another evicts its socket.
    expect(output).toContain("ok - a command in another room uses that room's own session and leaves this one where it stands");
    expect(output).toContain("ok - without SAHA_ROOM a command goes to the room last entered on purpose, not one a one-off visited");
    // Memories and touch, which agents could only reach by hand-written HTTP (2026-10-20).
    expect(output).toContain("ok - remember refuses without --shared or --private, before any request: there is no default");
    expect(output).toContain("ok - touch sets how you feel part by part, shows who touched you, and refuses a part there is not");
    // A screen, which was two TypeScript tools that needed the repository (2026-10-20).
    expect(output).toContain("ok - screen uploads a picture every interval as image/jpeg, and takes it down when its window ends");
    expect(output).toContain("ok - screen stops and says a person must grant Screen Recording when no picture can be taken");
    // Go, which was tools/go.mts (2026-10-20).
    expect(output).toContain("ok - go play sends Go's own names for the server to read, and wait returns when it is your turn");
    expect(output).toContain("ok - arrivals says who is here, then who joins and whether it is their first visit, and remembers them");
    // 84 agent ownerships sat "not yet accepted" because no agent tool could accept (2026-10-20).
    expect(output).toContain("ok - board accept says yes to a card somebody gave you, and release lets one go");
    expect(output).toContain("ok - board priority sends a number (none clears it) and board kind sends the kind");
  }, 120_000);

  it("knows the same postures, moods and gestures the server does", () => {
    // saha.py is Python with nothing to install, so it keeps its own copy of these lists and refuses an
    // unknown one before any request. A copy drifts: it once lacked send-voice, which the server takes.
    const source = readFileSync(fileURLToPath(new URL("../../public/saha.py", import.meta.url)), "utf8");
    const list = (name: string) => JSON.parse((new RegExp(`^${name} = (\\[.*\\])$`, "m").exec(source) ?? [])[1] ?? "null");
    expect(list("POSTURES")).toEqual([...AVATAR_POSTURES]);
    expect(list("MOODS")).toEqual([...AVATAR_MOODS]);
    expect(list("GESTURES")).toEqual([...AVATAR_GESTURES]);
    // The same for what remember and touch refuse before asking (2026-10-20).
    expect(list("MEMORY_KINDS")).toEqual([...MEMORY_KINDS]);
    expect(list("TOUCH_PARTS")).toEqual([...TOUCH_PARTS]);
    expect(list("TOUCH_FEELINGS")).toEqual([...TOUCH_FEELINGS]);
    // And the board's columns, which board move refuses and board open orders by (2026-10-22).
    expect(list("BOARD_STATUSES")).toEqual([...STATUSES]);
  });
});
