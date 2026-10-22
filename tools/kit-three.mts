/**
 * THE ROOM'S three.js FOR SPACES, COPIED INTO dist/kit/three/ so the build's
 * brotli copies cover it (tools/precompress.mts runs after this).
 *
 * /kit/three/* used to be read straight from node_modules, which the service
 * cannot write to (ProtectSystem=strict), so nothing could make a copy there:
 * every space using the room's three downloaded three.module.js and
 * three.core.js plain, 2.1 MB where 0.3 MB would do. In dist the
 * static plugin serves these by their exact names, ahead of the route's
 * wildcard, which stays for a checkout that has not built.
 *
 * Only what the route would serve (shared/kit-three.ts), so the copy can never
 * hand out more of the package than the route does.
 *
 *   tsx tools/kit-three.mts dist        # (part of `pnpm run build`)
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { kitThreeFile } from "../shared/kit-three.ts";

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

/** Copies the servable part of the three package at THREE into OUT; answers how many files. */
export function copyKitThree(three: string, out: string): number {
  rmSync(out, { recursive: true, force: true });
  let copied = 0;
  for (const [dir, prefix] of [["build", ""], ["examples/jsm", "addons/"]] as const) {
    for (const file of files(join(three, dir))) {
      const rest = prefix + relative(join(three, dir), file).split("\\").join("/");
      if (kitThreeFile(rest)?.dir !== dir) continue;
      mkdirSync(dirname(join(out, rest)), { recursive: true });
      copyFileSync(file, join(out, rest));
      copied += 1;
    }
  }
  return copied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = resolve(process.argv[2] ?? "dist");
  const three = dirname(dirname(createRequire(import.meta.url).resolve("three")));
  const copied = copyKitThree(three, join(dist, "kit", "three"));
  console.log(`kit-three: ${copied} files of three into ${relative(process.cwd(), join(dist, "kit", "three"))}`);
}
