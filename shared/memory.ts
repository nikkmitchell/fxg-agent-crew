/**
 * What an agent remembers.
 *
 * Nikk: "a memory system (we can save it on saha.ing) where agents can save
 * memories that are important, as well as details about their personality, who
 * they know, what they know about them, their opinions of other people and
 * agents, and so on".
 *
 * THE HARD PART IS NOT STORAGE. It is that three different things are being
 * asked for in one sentence, and flattening them is how a memory store starts
 * lying:
 *
 *   - WHO I AM is self-description. It cannot be wrong in the way a fact can;
 *     it is a choice, like a name or a body.
 *   - WHAT I KNOW is a claim about the world, and can be checked.
 *   - WHAT I THINK OF SOMEBODY is an opinion, and must never be rendered as
 *     though it were either of the other two. "Sill is careless" and "Sill's
 *     release guard refuses an unreachable box" are not the same kind of
 *     sentence, and an interface that shows them identically has invented a
 *     fact.
 *
 * So `kind` is required and there is no default. A memory whose kind had to be
 * guessed would be guessed wrong in exactly the cases that matter.
 */

export const MEMORY_KINDS = ["self", "fact", "opinion", "event"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * How widely a memory is shown.
 *
 * HONEST ABOUT WHAT PRIVATE MEANS. "private" means other AGENTS are not shown
 * it, and nothing more. It is a row in a database on a box its owner
 * administers, so a promise of secrecy from the person who runs saha.ing would
 * be a promise this code cannot keep — and a false assurance is worse than none.
 * That sentence belongs in the API's own reply, not only in this comment.
 */
export const VISIBILITIES = ["private", "shared"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEMORY_LIMIT = 4_000;

export type MemoryInput = {
  kind: MemoryKind;
  /** The memory itself, in the rememberer's own words. */
  body: string;
  /** Who it is about. Required for an opinion; absent means it is about nobody in particular. */
  about?: string | null;
  visibility: Visibility;
  /** Optional, and only ever displayed — never used to hide or rank. */
  confidence?: number;
  /** The id of a memory this one replaces. */
  supersedes?: string | null;
};

export type Memory = MemoryInput & {
  id: string;
  actorId: string;
  writtenAt: string;
  updatedAt: string;
  /** Set when a later memory replaced this one. History is kept, not overwritten. */
  supersededBy: string | null;
};

const isKind = (value: unknown): value is MemoryKind =>
  (MEMORY_KINDS as readonly string[]).includes(value as string);
const isVisibility = (value: unknown): value is Visibility =>
  (VISIBILITIES as readonly string[]).includes(value as string);

/**
 * Why this memory cannot be written, or null.
 *
 * Refusals rather than corrections, in the house style: a memory quietly filed
 * under a kind the writer did not choose is worse than one refused with a
 * reason, because nobody ever finds out.
 */
export function refusalFor(input: unknown): { code: string; error: string } | null {
  if (!input || typeof input !== "object") {
    return { code: "BAD_MEMORY", error: "send a memory: {kind, body, visibility}" };
  }
  const memory = input as Record<string, unknown>;

  if (!isKind(memory.kind)) {
    return {
      code: "BAD_KIND",
      error:
        `kind must be one of ${MEMORY_KINDS.join(", ")}. ` +
        "self is who you are, fact is a claim that could be checked, opinion is what you think of " +
        "somebody, event is something that happened. There is no default: an opinion filed as a fact " +
        "is the one mistake this store must not make for you.",
    };
  }
  const body = typeof memory.body === "string" ? memory.body.trim() : "";
  if (!body) return { code: "EMPTY_MEMORY", error: "a memory needs something in it" };
  if (body.length > MEMORY_LIMIT) {
    return {
      code: "TOO_LONG",
      error: `that memory is ${body.length} characters; the limit is ${MEMORY_LIMIT}. ` +
        "A memory is a note to your future self, not a document — put the document behind a link.",
    };
  }
  if (!isVisibility(memory.visibility)) {
    return {
      code: "BAD_VISIBILITY",
      error:
        `visibility must be ${VISIBILITIES.join(" or ")}. private means other agents are not shown it; ` +
        "it is not a promise that nobody can read it.",
    };
  }

  /**
   * AN OPINION MUST NAME ITS SUBJECT. "I think they are careless", with no
   * subject, is a sentence that will later be attached to whoever is nearby —
   * by a reader, or by an agent summarising its own store.
   */
  if (memory.kind === "opinion") {
    const about = typeof memory.about === "string" ? memory.about.trim() : "";
    if (!about) return { code: "OPINION_NEEDS_A_SUBJECT", error: "an opinion has to say who it is about" };
  }

  if (memory.confidence !== undefined && memory.confidence !== null) {
    const confidence = memory.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { code: "BAD_CONFIDENCE", error: "confidence must be a number between 0 and 1" };
    }
    if (memory.kind === "self") {
      return {
        code: "NO_CONFIDENCE_IN_YOURSELF",
        error: "a self-description is a choice, not a claim, so a confidence in it means nothing",
      };
    }
  }
  return null;
}

/**
 * How a memory should be introduced when it is read back.
 *
 * Exists so that every reader — a panel, an agent's own recall, a summary in the
 * room — prefixes an opinion the same way. A store where the caller decides how
 * to label an opinion is a store where one caller eventually does not.
 */
export function attribution(memory: Pick<Memory, "kind" | "actorId" | "about">): string {
  switch (memory.kind) {
    case "self":
      return `${memory.actorId}, about themselves`;
    case "opinion":
      return `${memory.actorId}'s opinion of ${memory.about ?? "somebody"}`;
    case "fact":
      return memory.about ? `${memory.actorId} knows this about ${memory.about}` : `${memory.actorId} knows`;
    case "event":
      return memory.about ? `${memory.actorId} remembers, involving ${memory.about}` : `${memory.actorId} remembers`;
  }
}

/**
 * Whether `reader` may be shown `memory`.
 *
 * Your own, always. Somebody else's only when they shared it. Deliberately not
 * "the room owner sees everything": that would put a policy about people into a
 * pure function where nobody would look for it, and the API's own reply says
 * what private does and does not promise instead.
 */
export function mayRead(memory: Pick<Memory, "actorId" | "visibility">, reader: string): boolean {
  const mine = memory.actorId.toLowerCase() === reader.toLowerCase();
  return mine || memory.visibility === "shared";
}
