import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BOOK_LIMITS, bookBody, bookHeader, bookPages, type BookCard, type BookPage, type BookShelf } from "../../shared/books.js";

/**
 * PROJECT GUTENBERG, FETCHED WHEN SOMEONE LOOKS (shared/books.ts; Nikk 7436).
 *
 * Only two addresses are ever asked, both fixed here: Gutendex for the
 * catalogue and gutenberg.org for a book's plain text. Nothing a visitor sends
 * becomes part of a URL except a shelf or book number checked to be one.
 *
 * What was fetched is kept on disk beside the database: a shelf for a week
 * (the catalogue changes slowly), a book's text until the cache is full, then
 * the least recently opened go first. A source that is down still serves what
 * was kept, stale, rather than nothing.
 */
export class BookSourceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "SOURCE_DOWN" | "TOO_BIG",
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const SHELF_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 45_000;
const HEADERS = { "user-agent": "saha.ing library (https://saha.ing)" };

export class Gutenberg {
  private readonly inflight = new Map<string, Promise<unknown>>();
  /** Books paged recently, newest last: paging a 1 MB text again for every turn would be waste. */
  private readonly paged = new Map<number, { title: string; author: string; pages: string[] }>();

  constructor(
    private readonly options: {
      cacheRoot: string;
      fetch?: Fetch;
      now?: () => number;
      /** Books kept on disk before the least recently opened are let go. */
      keepBooks?: number;
      /** Books kept paged in memory. */
      keepPaged?: number;
    },
  ) {}

  private get fetch(): Fetch {
    return this.options.fetch ?? (globalThis.fetch as unknown as Fetch);
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** One request at a time per key: ten people opening the same book fetch it once. */
  private once<T>(key: string, make: () => Promise<T>): Promise<T> {
    const going = this.inflight.get(key) as Promise<T> | undefined;
    if (going) return going;
    const made = make().finally(() => this.inflight.delete(key));
    this.inflight.set(key, made);
    return made;
  }

  private async get(url: string): Promise<{ status: number; text: string }> {
    try {
      const answer = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS });
      return { status: answer.status, text: answer.ok ? await answer.text() : "" };
    } catch {
      return { status: 0, text: "" };
    }
  }

  private file(...parts: string[]) {
    return join(this.options.cacheRoot, ...parts);
  }

  private async keep(path: string, text: string) {
    await mkdir(join(path, ".."), { recursive: true });
    const temporary = `${path}.${process.pid}.${this.now()}.part`;
    await writeFile(temporary, text);
    await rename(temporary, path);
  }

  private async kept(path: string): Promise<{ text: string; age: number } | null> {
    try {
      const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      return { text, age: this.now() - info.mtimeMs };
    } catch {
      return null;
    }
  }

  async shelf(shelf: number): Promise<BookShelf> {
    return this.once(`shelf:${shelf}`, async () => {
      const path = this.file("shelves", `${shelf}.json`);
      const kept = await this.kept(path);
      if (kept && kept.age < SHELF_FRESH_MS) return JSON.parse(kept.text) as BookShelf;
      const answer = await this.get(`https://gutendex.com/books/?page=${shelf}`);
      if (answer.status === 404) return { shelf, count: 0, shelves: 0, books: [] };
      if (answer.status !== 200) {
        if (kept) return JSON.parse(kept.text) as BookShelf;
        throw new BookSourceError("SOURCE_DOWN", "The book catalogue did not answer; try again in a moment.");
      }
      const made = readShelf(shelf, answer.text);
      if (!made) {
        if (kept) return JSON.parse(kept.text) as BookShelf;
        throw new BookSourceError("SOURCE_DOWN", "The book catalogue answered with something that is not a shelf.");
      }
      await this.keep(path, JSON.stringify(made));
      return made;
    });
  }

  private async book(id: number): Promise<{ title: string; author: string; pages: string[] }> {
    const paged = this.paged.get(id);
    if (paged) {
      this.paged.delete(id);
      this.paged.set(id, paged);
      return paged;
    }
    return this.once(`book:${id}`, async () => {
      const path = this.file("texts", `${id}.txt`);
      let raw = (await this.kept(path))?.text ?? null;
      if (raw === null) {
        const answer = await this.get(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`);
        if (answer.status === 404) throw new BookSourceError("NOT_FOUND", `Gutenberg has no plain text for book ${id}.`);
        if (answer.status !== 200) throw new BookSourceError("SOURCE_DOWN", "Gutenberg did not answer; try again in a moment.");
        if (Buffer.byteLength(answer.text) > BOOK_LIMITS.maxTextBytes) throw new BookSourceError("TOO_BIG", `Book ${id} is too long for the room's reader.`);
        raw = answer.text;
        await this.keep(path, raw);
        await this.trim();
      } else {
        // Opened again: it is recent now, so the cache lets older books go first.
        const now = new Date(this.now());
        await utimes(path, now, now).catch(() => undefined);
      }
      const header = bookHeader(raw);
      const made = { ...header, pages: bookPages(bookBody(raw)) };
      this.paged.set(id, made);
      while (this.paged.size > (this.options.keepPaged ?? 40)) this.paged.delete(this.paged.keys().next().value!);
      return made;
    });
  }

  async page(id: number, page: number): Promise<BookPage> {
    const book = await this.book(id);
    const at = Math.min(Math.max(1, page), book.pages.length);
    return { id, title: book.title || `Book ${id}`, author: book.author, page: at, pages: book.pages.length, text: book.pages[at - 1] };
  }

  /** Let the least recently opened books go once there are more than `keepBooks`. */
  private async trim() {
    const keep = this.options.keepBooks ?? 3000;
    const folder = this.file("texts");
    const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => name.endsWith(".txt"));
    if (names.length <= keep) return;
    const aged = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(folder, name)).catch(() => null))?.mtimeMs ?? 0 })));
    aged.sort((a, b) => a.at - b.at);
    for (const { name } of aged.slice(0, names.length - keep)) await unlink(join(folder, name)).catch(() => undefined);
  }
}

/** Gutendex's page, kept to what the room shows. */
export function readShelf(shelf: number, text: string): BookShelf | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const page = raw as { count?: unknown; results?: unknown };
  if (!page || typeof page.count !== "number" || !Array.isArray(page.results)) return null;
  const strings = (value: unknown, limit: number) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string").slice(0, limit) : []);
  const books: BookCard[] = [];
  for (const one of page.results as Record<string, unknown>[]) {
    if (!one || !Number.isInteger(one.id) || typeof one.title !== "string") continue;
    // A book with no plain text cannot be read in the room, so it is not put on a shelf.
    const formats = (one.formats ?? {}) as Record<string, unknown>;
    if (!Object.keys(formats).some((type) => type.startsWith("text/plain"))) continue;
    books.push({
      id: one.id as number,
      title: (one.title as string).slice(0, 300),
      authors: Array.isArray(one.authors) ? (one.authors as { name?: unknown }[]).map((a) => (typeof a?.name === "string" ? a.name : "")).filter(Boolean).slice(0, 4) : [],
      subjects: strings(one.subjects, 4),
      languages: strings(one.languages, 4),
      downloads: typeof one.download_count === "number" ? one.download_count : 0,
    });
  }
  return { shelf, count: page.count, shelves: Math.ceil(page.count / BOOK_LIMITS.shelfSize), books };
}
