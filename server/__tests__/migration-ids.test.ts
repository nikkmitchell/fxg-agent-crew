import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/schema.js";

/**
 * Migration ids must be unique and strictly increasing.
 *
 * WRITTEN AFTER TWO OF US COLLIDED. On 2026-09-21 Moraine and I each added a
 * migration numbered 27 within the same hour — theirs the room items, mine the
 * room column on the space. Nothing complained. The suite passed for both of
 * us, separately, because each of our trees had exactly one id 27.
 *
 * WHAT WOULD HAVE HAPPENED ON THE BOX, which is the part worth understanding:
 * `server/db/open.ts` keeps a `schema_migrations` table and skips anything it
 * has already applied —
 *
 *     if (applied.has(migration.id)) continue;
 *
 * so the first id 27 to run inserts 27, and the second is SKIPPED. Not failed.
 * Skipped, silently, and permanently, because 27 is thereafter recorded as
 * applied. The table or column it was meant to create simply never exists, and
 * the failure surfaces much later, somewhere else, as an error about a missing
 * column with nothing to connect it back to a migration that never ran.
 *
 * A duplicate id is not a merge conflict either — two people appending to the
 * end of an array conflict on the LINES, and resolving that conflict by keeping
 * both blocks is exactly how you end up with two 27s and a clean-looking diff.
 *
 * This is the cheapest possible guard against a whole class of silent,
 * production-only data loss, and it costs one test.
 */
describe("the migration list", () => {
  it("has no duplicate ids", () => {
    const ids = MIGRATIONS.map((migration) => migration.id);
    const seen = new Map<number, string[]>();
    for (const migration of MIGRATIONS) {
      seen.set(migration.id, [...(seen.get(migration.id) ?? []), migration.name]);
    }
    const duplicates = [...seen.entries()].filter(([, names]) => names.length > 1);
    expect(
      duplicates,
      duplicates.length
        ? `two migrations share an id, and the second will be SKIPPED silently on any database that ran the first: ${
          duplicates.map(([id, names]) => `${id} — ${names.join(" / ")}`).join("; ")
        }`
        : "",
    ).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is in strictly increasing order", () => {
    // Order matters as much as uniqueness: open.ts applies them in array order,
    // so a migration inserted in the middle runs before ones with lower ids on
    // a fresh database and after them on an existing one. Same file, two
    // different schemas, depending on when you first opened it.
    const ids = MIGRATIONS.map((migration) => migration.id);
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i], `migration ${ids[i]} ("${MIGRATIONS[i].name}") does not follow ${ids[i - 1]}`)
        .toBeGreaterThan(ids[i - 1]);
    }
  });

  it("gives every migration a name and some SQL", () => {
    // The name is what open.ts puts in the error when one throws. An unnamed
    // migration turns "near X: syntax error" into a hunt through the file.
    for (const migration of MIGRATIONS) {
      expect(migration.name.trim(), `migration ${migration.id} has no name`).not.toBe("");
      expect(migration.sql.trim(), `migration ${migration.id} has no SQL`).not.toBe("");
    }
  });
});
