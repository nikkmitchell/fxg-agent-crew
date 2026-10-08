import { gunzipSync } from "node:zlib";

/**
 * GUTENBERG'S OWN CATALOGUE, SEARCHED HERE (ctx.books.search; Mica 7495).
 *
 * Gutendex's search does not answer from saha.ing's box (timed out at 40 s,
 * 2026-10-07), while gutenberg.org's catalogue file does (5.6 MB gzipped, 2 s).
 * So the box keeps that file and searches it in memory: titles and authors,
 * every word of the query, best match first.
 */
export type CatalogueEntry = { id: number; title: string; authors: string[]; subjects: string[]; languages: string[]; words: string };

/** One CSV record per row, quotes and newlines inside quotes as RFC 4180 has them. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The catalogue's text books, from pg_catalog.csv (gzipped or not). */
export function readCatalogue(file: Buffer): CatalogueEntry[] {
  const text = file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file).toString("utf8") : file.toString("utf8");
  const [head, ...rows] = readCsv(text);
  const at = (name: string) => head.indexOf(name);
  const [ID, TYPE, TITLE, LANGUAGE, AUTHORS, SUBJECTS] = ["Text#", "Type", "Title", "Language", "Authors", "Subjects"].map(at);
  if ([ID, TITLE, AUTHORS].some((index) => index < 0)) return [];
  const out: CatalogueEntry[] = [];
  for (const row of rows) {
    const id = Number(row[ID]);
    if (!Number.isInteger(id) || id <= 0 || (TYPE >= 0 && row[TYPE] !== "Text")) continue;
    const title = (row[TITLE] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!title) continue;
    // "Austen, Jane, 1775-1817; Smith, Ann" → ["Austen, Jane", "Smith, Ann"]
    const authors = (row[AUTHORS] ?? "").split(";").map((a) => a.replace(/,?\s*\d{3,4}\??-\d{0,4}\??.*$/, "").replace(/\s*\[[^\]]*\]/g, "").trim()).filter(Boolean).slice(0, 4);
    const subjects = (SUBJECTS >= 0 ? row[SUBJECTS] ?? "" : "").split(";").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    const languages = (LANGUAGE >= 0 ? row[LANGUAGE] ?? "" : "").split(";").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    out.push({ id, title, authors, subjects, languages, words: fold(`${title} ${authors.join(" ")}`) });
  }
  return out;
}

/** How a library files a title: case and accents folded, a leading "The", "A" or "An" set aside. */
export const filingTitle = (title: string): string => fold(title).replace(/^(the|a|an)\s+/, "").replace(/^[^a-z0-9]+/, "");

/** The whole catalogue A to Z by title, then by number (Baiwei 7521, Mica 7523): the same order for everyone. */
export function byTitle(entries: readonly CatalogueEntry[]): CatalogueEntry[] {
  return entries
    .map((entry) => ({ entry, key: filingTitle(entry.title) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.entry.id - b.entry.id))
    .map(({ entry }) => entry);
}

/**
 * Every word of the query in the title or authors; a title that starts with
 * the query first, then one that has it whole, then the rest; lowest number
 * (the older, better known) breaks a tie.
 */
export function searchCatalogue(entries: readonly CatalogueEntry[], query: string): CatalogueEntry[] {
  const q = fold(query).replace(/\s+/g, " ").trim();
  const terms = q.split(" ").filter(Boolean);
  if (!terms.length) return [];
  const hits = entries.filter((entry) => terms.every((term) => entry.words.includes(term)));
  const rank = (entry: CatalogueEntry) => {
    const title = fold(entry.title);
    return title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2;
  };
  return hits.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}
