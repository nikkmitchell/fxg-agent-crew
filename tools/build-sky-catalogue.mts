/** Rebuild the small offline sky catalogue; no star services are used in XR. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const commit = "c7f7f883fe678cc7680169a50ccd7dcc49b060ce";
const source = `https://raw.githubusercontent.com/astronexus/HYG-Database/${commit}/hyg/CURRENT/hygdata_v41.csv`;
const response = await fetch(source);
if (!response.ok) throw new Error(`Catalogue download: ${response.status}`);
const csv = await response.text();
// HYG v4.1 has no quoted commas in the fields retained here. Parse CSV fully
// nevertheless so a descriptive field cannot shift an astronomical column.
function row(line: string): string[] {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { values.push(value); value = ""; }
    else value += c;
  }
  values.push(value);
  return values;
}
const lines = csv.trim().split(/\r?\n/);
const header = row(lines.shift()!);
const index = (name: string) => {
  const found = header.indexOf(name);
  if (found < 0) throw new Error(`Missing ${name}`);
  return found;
};
const fields = ["id", "ra", "dec", "mag", "ci", "pmrarad", "pmdecrad"].map(index);
const stars = lines.map(row).filter((r) => Number(r[fields[0]]) > 0 && Number(r[fields[3]]) <= 6.5)
  .map((r) => fields.map((i) => r[i] === "" ? 0 : Number(r[i])))
  .filter((r) => r.every(Number.isFinite));
await mkdir("src/space/sky", { recursive: true });
await writeFile("src/space/sky/hyg-bright.json", JSON.stringify({
  source, sourceSha256: createHash("sha256").update(csv).digest("hex"),
  attribution: "HYG v4.1, David Nash / Astronexus, CC BY-SA 4.0",
  license: "https://creativecommons.org/licenses/by-sa/4.0/",
  changes: "Sun excluded; visual magnitude <= 6.5; selected fields only; empty color/proper motion represented by 0.",
  fields: ["HYG id", "RA hours J2000", "Dec degrees J2000", "V magnitude", "B-V", "RA motion rad/year", "Dec motion rad/year"],
  stars,
}) + "\n", "utf8");
console.log(`Wrote ${stars.length} real stars, ${Buffer.byteLength(JSON.stringify(stars))} bytes.`);
