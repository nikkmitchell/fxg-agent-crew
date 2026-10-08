import { gzipSync } from "node:zlib";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { byTitle, filingTitle, readCatalogue, readCsv, searchCatalogue } from "../books/catalogue.js";
import { Gutenberg } from "../books/gutenberg.js";
import { registerBookRoutes } from "../routes/books.js";
import { MemorySessionStore } from "../session.js";
import { tempDir, testConfig } from "./test-config.js";

/** Search over Gutenberg's own catalogue (ctx.books.search; Mica 7495): Gutendex's search does not answer from the box. */

const CSV = [
  "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves",
  '64317,Text,2021-01-17,The Great Gatsby,en,"Fitzgerald, F. Scott (Francis Scott), 1896-1940","Married women -- Fiction; Rich people -- Fiction",PS,""',
  '1342,Text,1998-06-01,Pride and Prejudice,en,"Austen, Jane, 1775-1817","Courtship -- Fiction",PR,""',
  '105,Text,1994-02-01,Persuasion,en,"Austen, Jane, 1775-1817",,PR,""',
  '9999,Sound,2003-01-01,Pride and Prejudice (audio),en,"Austen, Jane, 1775-1817",,PR,""',
  '2160,Text,2000-03-01,"The Expedition of Humphry Clinker",en,"Smollett, T. (Tobias), 1721-1771","Epistolary fiction",PR,""',
  '7000,Text,2004-01-01,"A title with ""quotes""\nand a line break",en,"Nobody, A.",,PR,""',
].join("\n");

describe("the catalogue", () => {
  it("reads quoted fields, doubled quotes and line breaks inside quotes, gzipped or not", () => {
    expect(readCsv('a,"b,c","d ""e""\nf"\n1,2,3')).toEqual([["a", "b,c", 'd "e"\nf'], ["1", "2", "3"]]);
    const plain = readCatalogue(Buffer.from(CSV));
    expect(readCatalogue(gzipSync(Buffer.from(CSV)))).toEqual(plain);
    // Text only: the audio book is not a book you can read.
    expect(plain.map((entry) => entry.id)).toEqual([64317, 1342, 105, 2160, 7000]);
    expect(plain[0]).toMatchObject({ title: "The Great Gatsby", authors: ["Fitzgerald, F. Scott (Francis Scott)"], subjects: ["Married women -- Fiction", "Rich people -- Fiction"], languages: ["en"] });
    expect(plain[4].title).toBe('A title with "quotes" and a line break');
  });

  it("finds every word in the title or authors, a title starting with the query first", () => {
    const entries = readCatalogue(Buffer.from(CSV));
    expect(searchCatalogue(entries, "austen").map((e) => e.id)).toEqual([105, 1342]);
    expect(searchCatalogue(entries, "pride").map((e) => e.id)).toEqual([1342]);
    expect(searchCatalogue(entries, "jane persuasion").map((e) => e.id)).toEqual([105]);
    expect(searchCatalogue(entries, "GATSBY  ").map((e) => e.id)).toEqual([64317]);
    expect(searchCatalogue(entries, "the").map((e) => e.id)).toEqual([2160, 64317]);
    expect(searchCatalogue(entries, "")).toEqual([]);
  });
});

describe("A to Z shelves (Baiwei 7521, Mica 7523)", () => {
  it("files titles as a library does: a leading The, A or An set aside, case and accents folded", () => {
    expect(filingTitle("The Great Gatsby")).toBe("great gatsby");
    expect(filingTitle("An Émigré")).toBe("emigre");
    expect(filingTitle('"Quoted" first')).toBe('quoted" first');
    const order = byTitle(readCatalogue(Buffer.from(CSV))).map((entry) => entry.title);
    expect(order).toEqual(["The Expedition of Humphry Clinker", "The Great Gatsby", "Persuasion", "Pride and Prejudice", 'A title with "quotes" and a line break']);
  });
});

describe("GET /bff/books/search", () => {
  function boot() {
    let downloads = 0;
    const fetch = async (url: string, init?: { method?: string }) => {
      if (init?.method === "HEAD") return { ok: true, status: 200, text: async () => "", headers: { get: () => "123456" } };
      if (url.endsWith("pg_catalog.csv.gz")) {
        downloads += 1;
        const bytes = gzipSync(Buffer.from(CSV));
        return { ok: true, status: 200, text: async () => "", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      throw new Error("offline");
    };
    const config = testConfig();
    const sessions = new MemorySessionStore(60_000);
    const books = new Gutenberg({ cacheRoot: tempDir("books-search-"), fetch });
    const app = Fastify();
    app.register(cookie);
    registerBookRoutes(app, { config, sessions, books });
    return { app, cookies: { [config.cookieName]: sessions.create("Mica", "t") }, downloads: () => downloads };
  }

  it("answers in the shelf's BookCard shape, fetches the catalogue once, and measures the results behind", async () => {
    const { app, cookies, downloads } = boot();
    expect((await app.inject({ url: "/bff/books/search?q=austen" })).statusCode).toBe(401);
    const first = (await app.inject({ url: "/bff/books/search?q=austen", cookies })).json();
    expect(first).toMatchObject({ query: "austen", count: 2, next: null, sized: false });
    expect(first.books[0]).toEqual({ id: 105, title: "Persuasion", authors: ["Austen, Jane"], subjects: [], languages: ["en"], downloads: 0, bytes: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = (await app.inject({ url: "/bff/books/search?q=austen", cookies })).json();
    expect([again.sized, again.books.map((b: { bytes: number }) => b.bytes)]).toEqual([true, [123456, 123456]]);
    expect(downloads()).toBe(1);
  });

  it("hands out the catalogue A to Z, 32 a shelf, with order=title", async () => {
    const { app, cookies } = boot();
    const shelf = (await app.inject({ url: "/bff/books?shelf=1&order=title", cookies })).json();
    expect(shelf).toMatchObject({ shelf: 1, count: 5, shelves: 1 });
    expect(shelf.books.map((b: { id: number }) => b.id)).toEqual([2160, 64317, 105, 1342, 7000]);
    expect((await app.inject({ url: "/bff/books?shelf=1&order=sideways", cookies })).statusCode).toBe(400);
  });

  it("refuses an empty or over-long query and a cursor it did not give", async () => {
    const { app, cookies } = boot();
    expect((await app.inject({ url: "/bff/books/search?q=", cookies })).statusCode).toBe(400);
    expect((await app.inject({ url: `/bff/books/search?q=${"x".repeat(121)}`, cookies })).statusCode).toBe(400);
    expect((await app.inject({ url: "/bff/books/search?q=a&cursor=abc", cookies })).statusCode).toBe(400);
  });
});
