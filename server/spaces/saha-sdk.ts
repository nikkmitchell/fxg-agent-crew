/**
 * "saha": WHAT A THING IMPORTS TO SAY WHAT IT IS (docs/things/DESIGN.md,
 * contract saha/1). Served at /kit/saha-sdk.js and mapped as "saha" by the
 * room's import map and by any thing's own page:
 *
 *   import { defineItem } from "saha";
 *   export default defineItem({ name: "Hand drums", size: [1.9, 1, 0.7], setup(ctx) { ... } });
 *
 * It only checks the definition and brands it, so the room knows a thing
 * from any other module. The brand is a registered symbol, so the room's own
 * copy of the check (src/engine/instance.ts) recognises it across copies.
 * Everything a thing can DO comes to it through ctx, from the host.
 */
export function sahaSdkSource(): string {
  return `// saha.ing: define a thing (contract saha/1). docs/things/DESIGN.md in saha.ing's repo.
export const SAHA_API = 1;
const BRAND = Symbol.for("saha.thing");
const KINDS = { item: "defineItem", environment: "defineEnvironment", space: "defineSpace" };

function problem(kind, text) {
  return new TypeError("saha: " + KINDS[kind] + "(...): " + text);
}

function define(kind, def) {
  if (!def || typeof def !== "object") throw problem(kind, "give it one object: " + KINDS[kind] + "({ name, setup(ctx) { ... } })");
  if (typeof def.name !== "string" || !def.name.trim()) throw problem(kind, "give it a name: { name: \\"Hand drums\\", ... }");
  if (kind !== "space" && typeof def.setup !== "function") throw problem(kind, def.name + " needs setup(ctx), where it builds itself under ctx.root");
  if (kind === "space" && (!def.things || typeof def.things !== "object")) throw problem(kind, def.name + " needs things: { key: { ref: \\"drums\\", at: [0, 0, -1] } }");
  if (def.setup !== undefined && typeof def.setup !== "function") throw problem(kind, "setup must be a function");
  if (def.size !== undefined && !(Array.isArray(def.size) && def.size.length === 3 && def.size.every((n) => typeof n === "number" && n > 0))) {
    throw problem(kind, "size is [width, height, depth] in metres, e.g. [1.9, 1, 0.7]");
  }
  return Object.freeze(Object.assign({}, def, { kind, [BRAND]: SAHA_API }));
}

export const defineItem = (def) => define("item", def);
export const defineEnvironment = (def) => define("environment", def);
export const defineSpace = (def) => define("space", def);
export const isThing = (value) => Boolean(value) && value[BRAND] === SAHA_API;
`;
}
