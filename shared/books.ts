/**
 * BOOKS, READ LIVE (ctx.books; Nikk 7436: "we don't want to download anything,
 * have it all load in live as you access"). Project Gutenberg's free books,
 * fetched by saha.ing when someone opens one and handed to the room a page at
 * a time, so a headset on a slow link only ever carries the page it shows.
 *
 * Gutenberg is the source because it answers from the Shanghai box; Open
 * Library and archive.org do not (checked 2026-10-07).
 */

export const BOOK_LIMITS = {
  /** Characters on one page the room shows. */
  pageChars: 1400,
  /** Books on one shelf: Gutendex's own page size. */
  shelfSize: 32,
  /** A book bigger than this is not kept or paged (the Bible is ~4.4 MB; most novels under 1.5 MB). */
  maxTextBytes: 6_000_000,
} as const;

export type BookCard = {
  /** Gutenberg's ebook number. */
  id: number;
  title: string;
  authors: string[];
  subjects: string[];
  languages: string[];
  downloads: number;
  /** The plain text's size in bytes, from Gutenberg (null when it did not say): how thick and tall the book is on the shelf (Nikk 7457). */
  bytes: number | null;
};

export type BookShelf = {
  shelf: number;
  /** Books in the whole catalogue, as Gutendex counts them. */
  count: number;
  /** Shelves in the whole catalogue. */
  shelves: number;
  books: BookCard[];
  /** Whether the books' sizes are in yet: they are measured after the shelf is first handed out, so ask again a little later when false. */
  sized: boolean;
};

export type BookPage = {
  id: number;
  title: string;
  author: string;
  /** 1-based. */
  page: number;
  pages: number;
  text: string;
};

export const isBookId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) < 10_000_000;
export const isShelf = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) < 100_000;

/** The book itself: Gutenberg's licence header and footer taken off, line endings made plain. */
export function bookBody(raw: string): string {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const start = /^\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/im.exec(text);
  const end = /^\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/im.exec(text);
  const from = start ? start.index + start[0].length : 0;
  const to = end && end.index > from ? end.index : text.length;
  return text.slice(from, to).trim();
}

/** "Title:" and "Author:" from Gutenberg's header, where it has them. */
export function bookHeader(raw: string): { title: string; author: string } {
  const head = raw.slice(0, 4000);
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head)?.[1].trim() ?? "";
  return { title: field("Title"), author: field("Author") };
}

/**
 * Pages of about `size` characters. Paragraphs stay whole where they fit; a
 * longer one is cut at a space. Hard-wrapped Gutenberg lines are joined back
 * into paragraphs, so the room's own wrapping decides where lines break.
 */
export function bookPages(body: string, size: number = BOOK_LIMITS.pageChars): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const pages: string[] = [];
  let page = "";
  const flush = () => {
    if (page) pages.push(page);
    page = "";
  };
  for (let paragraph of paragraphs) {
    while (paragraph.length > size) {
      flush();
      const cut = paragraph.lastIndexOf(" ", size);
      const at = cut > size / 2 ? cut : size;
      pages.push(paragraph.slice(0, at).trim());
      paragraph = paragraph.slice(at).trim();
    }
    if (!paragraph) continue;
    if (page && page.length + 2 + paragraph.length > size) flush();
    page = page ? `${page}\n\n${paragraph}` : paragraph;
  }
  flush();
  return pages.length ? pages : [""];
}
