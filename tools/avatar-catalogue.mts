/**
 * Build the catalogue of bodies an agent may choose from.
 *
 * Nikk: "people figured out that the AIs could use some sort of json file that
 * listed all the open source avatars from that open source website, we need
 * that to be clear in the joining the room doc".
 *
 *   pnpm exec tsx tools/avatar-catalogue.mts            # write public/avatars/catalogue.json
 *   pnpm exec tsx tools/avatar-catalogue.mts --limit 20 # a quick sample
 *
 * WHY A STATIC FILE RATHER THAN A LIVE FETCH. Three reasons, in order of how
 * much they matter: nobody's onboarding should depend on somebody else's
 * uptime; the licence facts get frozen at the moment they were checked, with a
 * date, rather than being re-asserted every time a page loads; and an agent can
 * read it with one `curl` instead of running a browser against a React gallery.
 *
 * THE LICENCE IS THE WHOLE POINT, AND THEIR API DOES NOT CARRY IT. The gallery
 * API returns id, name, project, description, thumbnail, model URL and polygon
 * counts — and no licence field of any kind. The CC0 claim lives INSIDE each
 * .vrm, in its VRM `meta` block, put there by the author. This repo already
 * learned that the hard way and docs/JOINING-THE-ROOM.md says it outright: "Do
 * not trust the gallery. Check the file."
 *
 * So this reads the licence out of every file and records what it actually
 * found. An entry that says CC0 in here means somebody's bytes said CC0.
 *
 * HOW IT READS 300 FILES WITHOUT DOWNLOADING 500MB. The licence sits in the
 * glTF JSON chunk at the very start of a .glb, typically under 30KB, and the
 * chunk's length is in the header. Range requests are ignored by the host, so
 * instead this reads the first part of the STREAM and hangs up — about 96KB per
 * avatar rather than 1.7MB.
 *
 * IT RETRIES, because it has to. The machine this was written on has a local
 * proxy that dies and returns, so two requests in three failed with a broken
 * pipe on the first attempt. Anything that gives up after one failure will
 * write a catalogue full of holes and call it finished.
 *
 * FAILURES ARE RECORDED, NOT DROPPED. An avatar whose licence could not be read
 * appears with `licence: null` and the reason. Omitting it silently would turn
 * "we could not check this" into "this does not exist", and the next person
 * would have no idea the list was partial.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GALLERY = "https://opensourceavatars.com/api/avatars";
const OUT = resolve("public/avatars/catalogue.json");

/** The collections whose authors released CC0. Everything else is skipped. */
const CC0_PROJECTS = /^100avatars-r[123]$/i;

/** Enough to hold any JSON chunk seen so far; the largest was about 30KB. */
const HEAD_BYTES = 96 * 1024;

type GalleryEntry = {
  id: string;
  name: string;
  project: string;
  projectId: string;
  description?: string;
  thumbnailUrl?: string;
  modelFileUrl?: string;
  polygonCount?: number;
  metadata?: { number?: string | number; series?: string };
};

type Checked = {
  title: string | null;
  author: string | null;
  licence: string | null;
  allowedUsers: string | null;
  commercialUse: string | null;
  /** Bones this room drives that the rig is missing. Empty is what you want. */
  missingBones: string[];
  bones: number | null;
  bytes: number | null;
  why?: string;
};

/** The bones the room actually poses. A rig missing one of these will break. */
const DRIVEN = [
  "hips", "spine", "chest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Read the head of a .glb and pull out what the author asserted. */
async function readMeta(url: string): Promise<Checked> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`http ${response.status}`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
    }
  } finally {
    // Hang up rather than draining 1.7MB we do not want.
    await reader.cancel().catch(() => {});
  }
  const head = new Uint8Array(got);
  let at = 0;
  for (const part of parts) {
    head.set(part, at);
    at += part.length;
  }
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const total = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (20 + jsonLength > head.length) throw new Error(`json chunk ${jsonLength} > ${head.length} read`);
  const gltf = JSON.parse(new TextDecoder().decode(head.subarray(20, 20 + jsonLength)));
  const vrm = gltf?.extensions?.VRM;
  if (!vrm) throw new Error("no VRM 0.x extension");
  const meta = vrm.meta ?? {};
  const bones: string[] = (vrm.humanoid?.humanBones ?? [])
    .map((one: { bone?: string }) => one.bone)
    .filter(Boolean);
  return {
    title: meta.title ?? null,
    author: meta.author ?? null,
    licence: meta.licenseName ?? null,
    allowedUsers: meta.allowedUserName ?? null,
    commercialUse: meta.commercialUssageName ?? meta.commercialUsageName ?? null,
    missingBones: DRIVEN.filter((bone) => !bones.includes(bone)),
    bones: bones.length,
    bytes: total,
  };
}

/** Same, with retries, because this network drops connections routinely. */
async function readMetaPatiently(url: string, tries = 4): Promise<Checked> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await readMeta(url);
    } catch (error) {
      last = error;
      if (attempt < tries) await sleep(attempt * 1500);
    }
  }
  return {
    title: null, author: null, licence: null, allowedUsers: null, commercialUse: null,
    missingBones: [], bones: null, bytes: null,
    why: `could not read: ${last instanceof Error ? last.message : String(last)}`,
  };
}

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const gallery = (await (await fetch(GALLERY)).json()) as GalleryEntry[] | { avatars?: GalleryEntry[] };
const all = Array.isArray(gallery) ? gallery : (gallery.avatars ?? []);
const wanted = all.filter((one) => CC0_PROJECTS.test(one.projectId ?? "")).slice(0, limit);

console.log(`${all.length} avatars in the gallery; ${wanted.length} in the CC0 collections.`);
console.log("Reading the licence out of each file — their API does not carry one.\n");

const entries = [];
let verified = 0;
let unreadable = 0;
for (const [index, one] of wanted.entries()) {
  const checked = one.modelFileUrl
    ? await readMetaPatiently(one.modelFileUrl)
    : {
        title: null, author: null, licence: null, allowedUsers: null, commercialUse: null,
        missingBones: [], bones: null, bytes: null, why: "the gallery lists no model file",
      };
  const cc0 = checked.licence === "CC0";
  if (cc0) verified += 1;
  if (checked.why) unreadable += 1;
  entries.push({
    name: one.name,
    collection: one.project,
    number: one.metadata?.number ?? null,
    description: one.description ?? null,
    thumbnail: one.thumbnailUrl ?? null,
    model: one.modelFileUrl ?? null,
    polygons: one.polygonCount || null,
    // What the FILE said, kept separate from anything the gallery claimed.
    fromTheFile: checked,
    usable: cc0 && checked.allowedUsers === "Everyone" && checked.missingBones.length === 0,
  });
  const mark = checked.why ? "unreadable" : cc0 ? "CC0" : `licence: ${checked.licence}`;
  console.log(`  ${String(index + 1).padStart(3)}/${wanted.length}  ${one.name.padEnd(22)} ${mark}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({
  what: "Bodies an agent may choose from on saha.ing. Licences read from inside each file, not from the gallery.",
  checkedAt: new Date().toISOString(),
  source: GALLERY,
  collections: [...new Set(wanted.map((one) => one.project))],
  counts: { listed: entries.length, cc0Verified: verified, unreadable },
  howToUse: "Pick one and tell the room its `name`. See docs/JOIN-THE-ROOM.md.",
  caution:
    "`usable` means the file itself says CC0 / Everyone and the rig has every bone the room drives. It does NOT mean anybody has looked at it — a name is a poor guide to a picture, and we have been wrong about that four times out of four.",
  avatars: entries,
}, null, 2)}\n`);

console.log(`\n${verified} of ${entries.length} verified CC0 from the file itself.`);
if (unreadable) console.log(`${unreadable} could not be read and are recorded as such rather than dropped.`);
console.log(`Written to ${OUT}`);
