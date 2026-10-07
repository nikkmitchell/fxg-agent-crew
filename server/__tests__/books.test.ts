import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { Gutenberg, readShelf } from "../books/gutenberg.js";
import { registerBookRoutes } from "../routes/books.js";
import { MemorySessionStore } from "../session.js";
import { tempDir, testConfig } from "./test-config.js";

/** Books read live (ctx.books; Nikk 7436): Gutenberg asked only when someone looks, a page at a time. */

const shelfJson = (ids: number[]) =>
  JSON.stringify({
    count: 75_000,
    results: ids.map((id) => ({
      id, title: `Book ${id}`, authors: [{ name: "Austen, Jane" }], subjects: ["Fiction"], languages: ["en"], download_count: 9,
      formats: id === 13 ? { "image/jpeg": "x" } : { "text/plain; charset=us-ascii": "x" },
    })),
  });
const text = (paragraphs: number) =>
  `Title: Long Book\nAuthor: Someone\n\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n${Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i} `.repeat(30)).join("\n\n")}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicence`;

function boot(answers: Record<string, { status: number; body: string } | "throw">) {
  const asked: string[] = [];
  const headed: string[] = [];
  const fetch = async (url: string, init?: { method?: string }) => {
    if (init?.method === "HEAD") {
      headed.push(url);
      // Book 2 has no size; the others are their id in kilobytes.
      const id = Number(/pg(\d+)\.txt$/.exec(url)?.[1]);
      return { ok: id !== 2, status: id !== 2 ? 200 : 404, text: async () => "", headers: { get: (name: string) => (name === "content-length" ? String(id * 1000) : null) } };
    }
    asked.push(url);
    const answer = answers[url];
    if (!answer || answer === "throw") throw new Error("offline");
    return { ok: answer.status === 200, status: answer.status, text: async () => answer.body };
  };
  const config = testConfig();
  const sessions = new MemorySessionStore(60_000);
  const books = new Gutenberg({ cacheRoot: tempDir("books-"), fetch, keepBooks: 1 });
  const app = Fastify();
  app.register(cookie);
  registerBookRoutes(app, { config, sessions, books });
  const cookies = { [config.cookieName]: sessions.create("Nikk2", "t") };
  return { app, asked, headed, cookies, answers, books };
}

const SHELF_2 = "https://gutendex.com/books/?page=2";
const BOOK_7 = "https://www.gutenberg.org/cache/epub/7/pg7.txt";

describe("books", () => {
  it("keeps a shelf to readable books and what the room shows", () => {
    const shelf = readShelf(2, shelfJson([11, 12, 13]))!;
    expect(shelf).toMatchObject({ shelf: 2, count: 75_000, shelves: 2344, sized: false });
    expect(shelf.books.map((book) => book.id)).toEqual([11, 12]);
    expect(shelf.books[0]).toEqual({ id: 11, title: "Book 11", authors: ["Austen, Jane"], subjects: ["Fiction"], languages: ["en"], downloads: 9, bytes: null });
    expect(readShelf(1, "<html>")).toBeNull();
  });

  it("needs a session, and asks the catalogue once however often the shelf is looked at", async () => {
    const { app, asked, headed, cookies, books } = boot({ [SHELF_2]: { status: 200, body: shelfJson([1, 2]) } });
    expect((await app.inject({ url: "/bff/books?shelf=2" })).statusCode).toBe(401);
    const [one, two] = await Promise.all([app.inject({ url: "/bff/books?shelf=2", cookies }), app.inject({ url: "/bff/books?shelf=2", cookies })]);
    expect(one.json().books).toHaveLength(2);
    expect(two.json()).toEqual(one.json());
    await app.inject({ url: "/bff/books?shelf=2", cookies });
    expect(asked).toEqual([SHELF_2]);
    // Handed out at once, unmeasured; each book measured once behind it (Nikk 7457: sized by how big it is).
    expect(one.json().sized).toBe(false);
    await books.measured();
    const later = (await app.inject({ url: "/bff/books?shelf=2", cookies })).json();
    expect([later.sized, later.books.map((book: { bytes: number | null }) => book.bytes)]).toEqual([true, [1000, null]]);
    expect(headed).toHaveLength(2);
    expect(asked).toEqual([SHELF_2]);
    expect((await app.inject({ url: "/bff/books?shelf=0", cookies })).statusCode).toBe(400);
    expect((await app.inject({ url: "/bff/books?shelf=../etc", cookies })).statusCode).toBe(400);
  });

  it("hands over one page of a book at a time, fetching the book once", async () => {
    const { app, asked, cookies } = boot({ [BOOK_7]: { status: 200, body: text(40) } });
    const first = (await app.inject({ url: "/bff/books/7?page=1", cookies })).json();
    expect(first).toMatchObject({ id: 7, title: "Long Book", author: "Someone", page: 1 });
    expect(first.pages).toBeGreaterThan(10);
    expect(first.text.length).toBeLessThanOrEqual(1400);
    expect(first.text.startsWith("Paragraph 0")).toBe(true);
    const last = (await app.inject({ url: `/bff/books/7?page=${first.pages + 50}`, cookies })).json();
    expect(last.page).toBe(first.pages);
    expect(last.text).not.toMatch(/licence|END OF/);
    expect(asked).toEqual([BOOK_7]);
    expect((await app.inject({ url: "/bff/books/abc", cookies })).statusCode).toBe(400);
    expect((await app.inject({ url: "/bff/books/7?page=-1", cookies })).statusCode).toBe(400);
  });

  it("says why when Gutenberg has no such book or does not answer, and serves a kept shelf while it is down", async () => {
    const { app, cookies, answers } = boot({ "https://www.gutenberg.org/cache/epub/8/pg8.txt": { status: 404, body: "" }, [SHELF_2]: { status: 200, body: shelfJson([1]) } });
    expect((await app.inject({ url: "/bff/books/8", cookies })).json().code).toBe("NOT_FOUND");
    expect((await app.inject({ url: "/bff/books/9", cookies })).json()).toMatchObject({ code: "SOURCE_DOWN" });
    expect((await app.inject({ url: "/bff/books/9", cookies })).statusCode).toBe(502);
    expect((await app.inject({ url: "/bff/books?shelf=3", cookies })).statusCode).toBe(502);
    await app.inject({ url: "/bff/books?shelf=2", cookies });
    answers[SHELF_2] = "throw";
    expect((await app.inject({ url: "/bff/books?shelf=2", cookies })).json().books).toHaveLength(1);
  });

  it("refuses a book too long for the reader, and keeps it nowhere", async () => {
    const { app, cookies } = boot({ [BOOK_7]: { status: 200, body: "x".repeat(6_000_001) } });
    expect((await app.inject({ url: "/bff/books/7", cookies })).json().code).toBe("TOO_BIG");
  });
});
