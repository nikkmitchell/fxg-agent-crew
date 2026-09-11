/**
 * The browser's side of saha.ing's own board API.
 *
 * Replaces posting `crew-event` fences into a chat room. The shape of the
 * change: a write is now a request that either happened or did not, and the
 * server says which — rather than a message appended to a log, whose effect you
 * discovered by re-reading the log.
 */

const base = () => `${import.meta.env.BASE_URL}bff/board`;

export type Refusal = { code: string; error: string };

export class BoardError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "BoardError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const refusal = body as Refusal | undefined;
    // The server's refusal is a sentence written for a person. Keep it: a
    // generic "something went wrong" throws away the only part that says what
    // to do next.
    throw new BoardError(
      refusal?.code ?? "UNKNOWN",
      refusal?.error ?? `the server refused this (${response.status})`,
      response.status,
    );
  }
  return body as T;
}

export const board = {
  projects: () => call<{ projects: Array<Record<string, unknown>> }>("/projects"),
  project: (id: string) => call<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}`),
  people: () => call<{ actors: unknown[]; ownerships: unknown[]; memberships: unknown[] }>("/people"),
  history: (entity: string, id: string) =>
    call<{ history: unknown[] }>(`/history/${entity}/${encodeURIComponent(id)}`),

  createProject: (body: { id?: string; name: string; summary?: string; goals?: string[] }) =>
    call<{ result: string }>("/projects", { method: "POST", body: JSON.stringify(body) }),
  createTask: (body: Record<string, unknown>) =>
    call<{ result: string }>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, patch: Record<string, unknown>) =>
    call(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  transition: (id: string, to: string, blocker?: string) =>
    call(`/tasks/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ to, blocker }) }),
  ownership: (id: string, action: "claim" | "accept" | "release") =>
    call(`/tasks/${encodeURIComponent(id)}/ownership`, { method: "POST", body: JSON.stringify({ action }) }),
  comment: (id: string, body: string) =>
    call(`/tasks/${encodeURIComponent(id)}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  profile: (profile: Record<string, unknown>) =>
    call("/profile", { method: "PUT", body: JSON.stringify(profile) }),
  actOnOwnership: (agentId: string, ownerId: string, action: "declare" | "confirm" | "revoke") =>
    call("/ownership", { method: "POST", body: JSON.stringify({ agentId, ownerId, action }) }),
  membership: (projectId: string, actorId: string, action: "grant" | "revoke", roles: string[] = []) =>
    call("/membership", { method: "POST", body: JSON.stringify({ projectId, actorId, action, roles }) }),

  createBoard: (projectId: string, name: string) =>
    call<{ result: string }>("/boards", { method: "POST", body: JSON.stringify({ projectId, name }) }),
  addItem: (boardId: string, item: Record<string, unknown>) =>
    call<{ result: string }>(`/boards/${encodeURIComponent(boardId)}/items`, {
      method: "POST", body: JSON.stringify(item),
    }),
  moveItem: (itemId: string, at: { x: number; y: number; w?: number; h?: number }) =>
    call(`/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(at) }),
  /** What an item says. Position is moveItem; this is content, and it is audited. */
  editItem: (itemId: string, patch: { text?: string; caption?: string }) =>
    call(`/items/${encodeURIComponent(itemId)}/text`, { method: "POST", body: JSON.stringify(patch) }),
  removeItem: (itemId: string) => call(`/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),

  /**
   * Upload raw bytes.
   *
   * Not FormData: one content type, no multipart parser to get wrong, and the
   * filename travels in a header where it cannot be confused with the file.
   */
  upload: async (file: File) =>
    call<{ result: { id: string; mime: string; width: number | null; height: number | null } }>("/blobs", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
      body: file,
    }),

  blobUrl: (id: string) => `${base()}/blobs/${encodeURIComponent(id)}`,
};

/* ------------------------------------------------------------- shape ------ */

/**
 * Turn database rows into the shapes the screens already render.
 *
 * The UI was written against the folded chat state and renders it correctly;
 * rewriting every component to speak snake_case would be a large diff whose
 * only effect is churn. This is the seam, and it is the ONLY place that knows
 * both vocabularies.
 */
export function toCrewTask(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    points: row.points ?? 1,
    // Absent stays absent. A `?? "build"` here would invent the answer the
    // schema deliberately refuses to invent.
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.priority ? { priority: row.priority } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.blocker ? { blocker: row.blocker } : {}),
    ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
    owners: row.owners ?? [],
    acceptedBy: row.acceptedBy ?? [],
    comments: (row.comments ?? []).map((c: Record<string, any>) => ({
      id: c.id, author: c.author_id, body: c.body, createdAt: c.created_at,
    })),
    links: (row.links ?? []).map((l: Record<string, any>) => ({ label: l.label, href: l.href })),
  };
}

export function toCrewProject(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary ?? "",
    goals: row.goals ?? [],
    steps: [],
  };
}

export function toProfile(row: Record<string, any>) {
  return {
    actorId: row.id,
    kind: row.kind,
    displayName: row.display_name ?? row.id,
    ...(row.bio ? { bio: row.bio } : {}),
    ...(row.coarse_location ? { coarseLocation: row.coarse_location } : {}),
    ...(row.time_zone ? { timeZone: row.time_zone } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.runtime ? { runtime: row.runtime } : {}),
  };
}
