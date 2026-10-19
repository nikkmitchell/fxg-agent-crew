import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roomFileName } from "../../tools/saha-session.mts";

/**
 * saha.py and tools/saha-session.mts keep an agent's saha.ing sessions in the
 * same files, one per room (2026-10-20): the site holds a session in one room,
 * and a single shared one meant any tool pointed at another room knocked the
 * agent's `stand` out of its own. Both must name a room's file the same way,
 * or they would each sign in afresh and never share.
 */
const rooms = ["saha.ing", "XR.Instruments", "meditation.AR", "公开房001", "Go_Board_Game_Room", "a b/c", "AgentParty"];

describe("one session file per room, named the same by every tool", () => {
  it("agrees between saha.py and the TypeScript tools", () => {
    const publicDir = fileURLToPath(new URL("../../public", import.meta.url));
    const python = execFileSync(
      "python3",
      ["-c", "import json, sys; sys.path.insert(0, sys.argv[1]); import saha; print(json.dumps([saha.room_file_name(r) for r in json.loads(sys.argv[2])]))",
        publicDir, JSON.stringify(rooms)],
      { encoding: "utf8" },
    );
    expect(JSON.parse(python)).toEqual(rooms.map(roomFileName));
  });

  it("never gives two rooms one file, and keeps it a plain file name", () => {
    const names = rooms.map(roomFileName);
    expect(new Set(names).size).toBe(rooms.length);
    expect(roomFileName("公开房001")).not.toBe(roomFileName("私人房001"));
    for (const name of names) expect(name).toMatch(/^[a-z0-9._-]+$/);
  });
});
