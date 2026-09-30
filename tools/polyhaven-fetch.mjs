#!/usr/bin/env node
/**
 * BRING A FREE (CC0) 3D ASSET INTO A SPACE: search Poly Haven's library and download one
 * asset at the size you choose (Nikk, 6630 and 6636: "try some photo scanned ones ...
 * experiment with mixing in outside assets").
 *
 * Poly Haven (polyhaven.com) publishes photoscanned rocks, plants, terrain textures, HDRI skies
 * and more under CC0: no credit, no fee, use anywhere. A model comes as glTF with its textures;
 * the mesh is one level of detail, and the textures come at 1k, 2k, 4k and 8k (1k is about 0.3 to
 * 1.2 MB a map, 8k is 20 MB or more), so for a headset start at 1k.
 *
 *   node tools/polyhaven-fetch.mjs search rock                    # models whose name or tags match
 *   node tools/polyhaven-fetch.mjs search moss --type textures    # models (default), textures or hdris
 *   node tools/polyhaven-fetch.mjs info fern_02                   # what it is, its size, its triangles
 *   node tools/polyhaven-fetch.mjs get fern_02 --to ./scans       # glTF + textures at 1k into ./scans/fern_02/
 *   node tools/polyhaven-fetch.mjs get rock_09 --res 2k --to ./scans
 *   node tools/polyhaven-fetch.mjs get brown_mud_leaves_01 --type textures --maps Diffuse --to ./scans/ground
 *
 * Put what you fetch in a space (git push), and load it from your page with three's GLTFLoader;
 * see src/space/scan-rock.ts in the saha.ing repository for one way to paint a scan to match a
 * scene. Nothing needs to change in saha.ing: they are just files in your space.
 *
 * Their API asks for a descriptive User-Agent, and their download host refuses the default one of
 * many tools, so this sends one. Needs Node 18 or later; no packages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const API = "https://api.polyhaven.com";
const HEADERS = { "user-agent": "saha.ing-asset-fetch (https://saha.ing; CC0 assets for spaces)" };

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const positional = args.filter((each, index) => index > 0 && !each.startsWith("--") && !args[index - 1]?.startsWith("--"));

async function json(path) {
  const answer = await fetch(`${API}${path}`, { headers: HEADERS });
  if (!answer.ok) throw new Error(`${path}: ${answer.status}`);
  return answer.json();
}
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1)} MB`;

async function search(words) {
  const type = flag("--type", "models");
  const all = await json(`/assets?t=${encodeURIComponent(type)}`);
  const wanted = words.map((word) => word.toLowerCase());
  const found = Object.entries(all).filter(([id, asset]) => {
    const haystack = `${id} ${asset.name} ${(asset.tags ?? []).join(" ")} ${(asset.categories ?? []).join(" ")}`.toLowerCase();
    return wanted.every((word) => haystack.includes(word));
  });
  for (const [id, asset] of found.slice(0, 40)) {
    const size = asset.dimensions ? ` · ${asset.dimensions.map((each) => (each / 1000).toFixed(2)).join(" x ")} m` : "";
    const triangles = asset.polycount ? ` · ${asset.polycount.toLocaleString()} triangles` : "";
    console.log(`${id}  ${asset.name}${triangles}${size}`);
  }
  console.log(`${found.length} match${found.length === 1 ? "" : "es"}${found.length > 40 ? " (first 40 shown; add a word to narrow)" : ""}`);
}

async function info(id) {
  const [asset, files] = await Promise.all([json(`/info/${id}`), json(`/files/${id}`)]);
  console.log(`${asset.name} (${id})`);
  console.log(`  type ${["hdris", "textures", "models"][asset.type] ?? asset.type} · by ${Object.keys(asset.authors ?? {}).join(", ")} · license CC0`);
  if (asset.polycount) console.log(`  ${asset.polycount.toLocaleString()} triangles (some tools count differently; the glTF is often smaller)`);
  if (asset.dimensions) console.log(`  real size ${asset.dimensions.map((each) => (each / 1000).toFixed(2)).join(" x ")} m`);
  const gltf = files.gltf;
  if (gltf) {
    for (const [res, formats] of Object.entries(gltf)) {
      const entry = formats.gltf;
      const total = (entry.size ?? 0) + Object.values(entry.include ?? {}).reduce((sum, each) => sum + (each.size ?? 0), 0);
      console.log(`  glTF ${res}: ${mb(total)} in all`);
    }
  }
  console.log(`  tags ${(asset.tags ?? []).join(", ")}`);
}

async function download(url, destination) {
  const answer = await fetch(url, { headers: HEADERS });
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`);
  const bytes = Buffer.from(await answer.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return bytes.length;
}

async function get(id) {
  const res = flag("--res", "1k");
  const target = join(flag("--to", "."), id);
  const files = await json(`/files/${id}`);
  let total = 0;
  if (flag("--type", "models") === "models") {
    const entry = files.gltf?.[res]?.gltf;
    if (!entry) throw new Error(`${id} has no glTF at ${res}; try --res ${Object.keys(files.gltf ?? {}).join(" or ")}`);
    total += await download(entry.url, join(target, entry.url.split("/").pop()));
    for (const [path, part] of Object.entries(entry.include ?? {})) total += await download(part.url, join(target, path));
  } else {
    // A texture or sky: pick maps by name (Diffuse, nor_gl, Rough, ...), as jpg at the size asked for.
    const maps = (flag("--maps", "Diffuse")).split(",");
    for (const map of maps) {
      const entry = files[map]?.[res]?.jpg ?? files[map]?.[res]?.hdr ?? files[map]?.[res]?.exr;
      if (!entry) throw new Error(`${id} has no ${map} at ${res} (maps: ${Object.keys(files).join(", ")})`);
      total += await download(entry.url, join(target, entry.url.split("/").pop()));
    }
  }
  console.log(`${id} at ${res}: ${mb(total)} into ${target} (CC0: no credit needed)`);
}

try {
  if (command === "search" && positional.length) await search(positional);
  else if (command === "info" && positional[0]) await info(positional[0]);
  else if (command === "get" && positional[0]) await get(positional[0]);
  else {
    console.error("usage: polyhaven-fetch.mjs search <words…> [--type models|textures|hdris] | info <id> | get <id> [--res 1k] [--to dir] [--type textures --maps Diffuse,nor_gl]");
    process.exit(2);
  }
} catch (error) {
  console.error(`polyhaven-fetch: ${error.message}`);
  process.exit(1);
}
