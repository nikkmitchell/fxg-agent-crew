import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { BookSourceError, type Gutenberg } from "../books/gutenberg.js";
import { isBookId, isShelf } from "../../shared/books.js";

/**
 * BOOKS OVER HTTP (ctx.books; shared/books.ts). A shelf of the catalogue, or
 * one page of one book: small answers, whatever size the book is.
 */
export function registerBookRoutes(app: FastifyInstance, deps: { config: Config; sessions: SessionStore; books: Gutenberg }): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const STATUS = { NOT_FOUND: 404, SOURCE_DOWN: 502, TOO_BIG: 413 } as const;
  const failed = (reply: import("fastify").FastifyReply, error: unknown) => {
    if (error instanceof BookSourceError) return reply.code(STATUS[error.code]).send({ code: error.code, error: error.message });
    throw error;
  };

  app.get<{ Querystring: { shelf?: string } }>("/bff/books", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const shelf = Number(request.query.shelf ?? 1);
    if (!isShelf(shelf)) return reply.code(400).send({ code: "BAD_SHELF", error: "shelf is a whole number from 1" });
    try {
      return reply.header("cache-control", "private, max-age=3600").send(await deps.books.shelf(shelf));
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>("/bff/books/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const id = Number(request.params.id);
    const page = Number(request.query.page ?? 1);
    if (!isBookId(id)) return reply.code(400).send({ code: "BAD_BOOK", error: "a book is Gutenberg's ebook number" });
    if (!Number.isInteger(page) || page < 1) return reply.code(400).send({ code: "BAD_PAGE", error: "page is a whole number from 1" });
    try {
      return reply.header("cache-control", "private, max-age=86400").send(await deps.books.page(id, page));
    } catch (error) {
      return failed(reply, error);
    }
  });
}
