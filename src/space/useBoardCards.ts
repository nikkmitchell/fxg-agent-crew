import { useCallback, useEffect, useRef, useState } from "react";
import { board } from "../board-client";
import type { BoardCard } from "../../shared/board-3d";
import type { TaskDetail } from "../../shared/card-detail";
import type { MoodItem } from "../../shared/mood-3d";
import { board as boardApi } from "../board-client";

/**
 * The work board's cards, for the room.
 *
 * NOTHING FETCHED THESE BEFORE. The room showed an iframe of `/board` on the
 * desktop and a photograph of it in a headset, so the cards only ever existed
 * inside a page the room could not see into. Drawing them natively means the
 * room needs the data, which is this.
 *
 * POLLED, AND SAYING SO. The board has no socket of its own — the space socket
 * carries presence and items, not tasks — so this asks on an interval. Twelve
 * seconds is short enough that somebody else's move appears while you are
 * looking at it and long enough not to be rude to a box on a 400ms link. When
 * the board grows a socket this is the one place to change.
 *
 * A REFRESH IS EXPOSED because a move you made yourself should appear at once
 * rather than up to twelve seconds later: the caller reconciles optimistically
 * and then asks for the truth.
 */

const EVERY_MS = 12_000;

export type BoardFeed = {
  cards: BoardCard[];
  /**
   * The whole task, for the panel a card is pulled off into.
   *
   * FROM THE SAME ANSWER, not a second request. The project detail already
   * carries every task's description and comments; asking again when somebody
   * opens a card would be a second round trip for rows already in hand, and
   * they would be a poll apart, so the panel could disagree with the card that
   * opened it.
   */
  detailOf: (taskId: string) => TaskDetail | null;
  /**
   * What is pinned to a mood board.
   *
   * FROM THE SAME ANSWER AGAIN. The project detail already carries its boards
   * and their items; a second request for them would be a second poll of rows
   * we have, arriving a beat apart from the ones we drew.
   */
  moodItemsOf: (boardId: string | null) => MoodItem[];
  /** The mood boards this project has, for choosing between them. */
  moodBoards: { id: string; title: string }[];
  /** Null until the first answer. A board with no cards and a board that has not loaded are different. */
  loaded: boolean;
  trouble: string | null;
  refresh: () => void;
};

export function useBoardCards(projectId: string | null): BoardFeed {
  const [cards, setCards] = useState<BoardCard[]>([]);
  /** The rows exactly as the server sent them, for `detailOf`. */
  const rows = useRef<Record<string, Record<string, unknown>>>({});
  /** The mood boards exactly as the server sent them. */
  const boards = useRef<Record<string, unknown>[]>([]);
  const [moodBoards, setMoodBoards] = useState<{ id: string; title: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const live = useRef(true);
  /**
   * ONE READ AT A TIME. Mounting produced eight requests in a burst — React
   * mounts effects twice in development, the project id resolves a moment after
   * the first render, and each of those re-ran the fetch. None of it is a loop,
   * but a poll that can stack is one bad render away from becoming one, and
   * this room's own guide warns that a poll re-asking immediately can put
   * thousands of requests a second at a server while looking perfectly healthy.
   * Cheaper to make it impossible than to watch for it.
   */
  const inFlight = useRef(false);

  const read = useCallback(async () => {
    if (!projectId) {
      setCards([]);
      setLoaded(true);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const project = (await board.project(projectId)) as {
        tasks?: Record<string, unknown>[];
        boards?: Record<string, unknown>[];
      };
      if (!live.current) return;
      rows.current = Object.fromEntries((project.tasks ?? []).map((row) => [String(row.id), row]));
      boards.current = (project.boards ?? []) as Record<string, unknown>[];
      setMoodBoards(
        boards.current.map((one) => ({
          id: String(one.id),
          title: String(one.title ?? one.name ?? one.id),
        })),
      );
      setCards(
        (project.tasks ?? []).map((row) => ({
          id: String(row.id),
          title: String(row.title ?? "untitled"),
          status: String(row.status ?? "backlog"),
          ...(row.assignee_id ? { assigneeId: String(row.assignee_id) } : {}),
          ...(Array.isArray(row.comments) ? { commentCount: row.comments.length } : {}),
        })),
      );
      setLoaded(true);
      setTrouble(null);
    } catch (error) {
      if (!live.current) return;
      // KEEP THE OLD CARDS. A board that empties because one poll failed is a
      // board that lies about the work; the caption says it is stale instead.
      setTrouble(error instanceof Error ? error.message : "could not read the board");
      setLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    live.current = true;
    void read();
    const timer = window.setInterval(() => void read(), EVERY_MS);
    return () => {
      live.current = false;
      window.clearInterval(timer);
    };
  }, [read]);

  const detailOf = useCallback((taskId: string): TaskDetail | null => {
    const row = rows.current[taskId];
    if (!row) return null;
    const comments = Array.isArray(row.comments) ? (row.comments as Record<string, unknown>[]) : [];
    return {
      id: String(row.id),
      title: String(row.title ?? "untitled"),
      status: String(row.status ?? "backlog"),
      ...(row.description ? { description: String(row.description) } : {}),
      ...(row.assignee_id ? { assigneeId: String(row.assignee_id) } : {}),
      ...(typeof row.points === "number" ? { points: row.points } : {}),
      ...(row.priority ? { priority: String(row.priority) } : {}),
      ...(row.blocker ? { blocker: String(row.blocker) } : {}),
      comments: comments.map((comment) => ({
        author: String(comment.author_id ?? comment.author ?? "someone"),
        body: String(comment.body ?? ""),
        ...(comment.created_at ? { createdAt: String(comment.created_at) } : {}),
      })),
    };
  }, []);

  const moodItemsOf = useCallback((boardId: string | null): MoodItem[] => {
    const chosen = boardId
      ? boards.current.find((one) => String(one.id) === boardId)
      : // NO BOARD CHOSEN MEANS THE FIRST ONE, rather than an empty wall. A
        // project usually has exactly one, and making somebody pick it before
        // they can see anything is a step for nothing.
        boards.current[0];
    if (!chosen) return [];
    const items = Array.isArray(chosen.items) ? (chosen.items as Record<string, unknown>[]) : [];
    return items.map((one) => ({
      id: String(one.id),
      kind: String(one.kind ?? "note"),
      x: Number(one.x ?? 0),
      y: Number(one.y ?? 0),
      w: Number(one.w ?? 220),
      h: Number(one.h ?? 120),
      z: Number(one.z ?? 0),
      ...(one.text ? { text: String(one.text) } : {}),
      ...(one.caption && !one.text ? { text: String(one.caption) } : {}),
      ...(one.blob_id ? { src: boardApi.blobUrl(String(one.blob_id)) } : one.url ? { src: String(one.url) } : {}),
      ...(one.added_by ? { addedBy: String(one.added_by) } : {}),
    }));
  }, []);

  return { cards, loaded, trouble, detailOf, moodItemsOf, moodBoards, refresh: () => void read() };
}
