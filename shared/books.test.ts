import { describe, expect, it } from "vitest";
import { bookBody, bookHeader, bookPages } from "./books";

const RAW = [
  "﻿The Project Gutenberg eBook of Pride and Prejudice\r",
  "\r",
  "Title: Pride and Prejudice\r",
  "Author: Jane Austen\r",
  "\r",
  "*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***\r",
  "It is a truth universally acknowledged, that a single man in\r",
  "possession of a good fortune, must be in want of a wife.\r",
  "\r",
  "However little known the feelings or views of such a man may be.\r",
  "*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***\r",
  "Licence text that is not the book.\r",
].join("\n");

describe("books (Nikk 7436)", () => {
  it("takes Gutenberg's header and footer off and reads its title and author", () => {
    expect(bookHeader(RAW)).toEqual({ title: "Pride and Prejudice", author: "Jane Austen" });
    const body = bookBody(RAW);
    expect(body.startsWith("It is a truth")).toBe(true);
    expect(body).not.toMatch(/Licence|START OF|\r/);
  });

  it("joins hard-wrapped lines into paragraphs and packs whole paragraphs into pages", () => {
    const pages = bookPages(bookBody(RAW), 200);
    expect(pages).toEqual([
      "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings or views of such a man may be.",
    ]);
    // At 80 the first paragraph (117) is cut in two; the second (65) is a page of its own.
    expect(bookPages(bookBody(RAW), 80)).toHaveLength(3);
  });

  it("cuts a paragraph longer than a page at a space, and never loses a word", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const pages = bookPages(words.join(" "), 300);
    expect(pages.every((page) => page.length <= 300)).toBe(true);
    expect(pages.join(" ").split(" ")).toEqual(words);
  });

  it("is one empty page for an empty book, so page 1 always exists", () => {
    expect(bookPages("")).toEqual([""]);
    expect(bookBody("no markers at all")).toBe("no markers at all");
  });
});
