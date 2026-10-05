/**
 * Check a VRM before you try to register it. Runs the same checks the server will (shared/avatar-validate.ts) on
 * your own machine, with no network and no sign-in, and says in sentences what to fix.
 *
 *   pnpm exec tsx tools/check-avatar.mts path/to/my-avatar.vrm [--name "My Avatar"]
 *
 * Exit code 0: acceptable. 1: something to fix. 2: could not read the file.
 * Make the avatar with Mica's workshop first: https://saha.ing/s/meditation.ar/@mica-nature/avatar-workshop/
 */
import { readFileSync } from "node:fs";
import { bodySlug, checkAvatar, nameFromTitle } from "../shared/avatar-validate.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
const path = args.find((each, index) => !each.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (!path) {
  console.error('usage: tsx tools/check-avatar.mts <file.vrm> [--name "My Avatar"]');
  process.exit(2);
}
let bytes: Uint8Array;
try { bytes = new Uint8Array(readFileSync(path)); } catch (error) {
  console.error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const check = checkAvatar(bytes);
const { info } = check;
console.log(`${path}`);
console.log(`  ${(info.bytes / 1024).toFixed(0)} KB · VRM ${info.version ?? "?"} · ${info.triangles.toLocaleString("en")} triangles · ${info.materials} materials · ${info.bones} humanoid bones`);
console.log(`  title: ${info.title ?? "(none)"} · author: ${info.author ?? "(none)"} · licence: ${info.licence ?? "(none)"}`);
const name = flag("--name") ?? (info.title ? nameFromTitle(info.title) : null);
if (name) {
  const slug = bodySlug(name);
  console.log(slug ? `  it would be registered as "${slug}"` : `  "${name}" does not make a usable short name; pick one with at least two letters or digits`);
}
for (const line of check.warnings) console.log(`  warning: ${line}`);
for (const line of check.errors) console.log(`  FIX: ${line}`);
if (check.contract) {
  const { contract } = check;
  const hand = (h: { thumb: boolean; fingers: number }) => `${h.thumb ? "thumb" : "no thumb"} + ${h.fingers}`;
  console.log(`  body contract (Baiwei, 7040; not yet required): blink ${contract.blink ? "yes" : "NO"} · mouth ${contract.mouth ? "yes" : "NO"} · hands L ${hand(contract.hands.left)} / R ${hand(contract.hands.right)}`);
  for (const line of contract.unmet) console.log(`  contract: ${line}`);
}
console.log(check.ok ? "  OK: this body can be registered." : "  NOT YET: fix the lines above and run this again.");
process.exit(check.ok ? 0 : 1);
