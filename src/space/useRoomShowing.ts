import { useCallback, useEffect, useState } from "react";
import { board } from "../board-client";
import { space } from "../space-client";
import { ApiError } from "../api-request";
import type { Showing } from "../../shared/space-wire";

/**
 * Choosing what the whole room looks at.
 *
 * THE CURRENT VALUE COMES FROM THE SOCKET, not from here — see
 * `useSpaceSocket`, which receives it in the welcome and on every change. This
 * hook is the WRITE side plus the lists to choose from, and keeping the two
 * apart matters: if this also polled for the current value, the room would
 * briefly show one thing to the person who changed it and another to everybody
 * else, which is precisely the failure the shared choice exists to remove.
 */
export type RoomShowingChoices = {
  projects: { id: string; name: string }[] | null;
  boards: { id: string; title: string }[] | null;
  /** Null unless the last change was refused, in which case, why. */
  refusal: string | null;
  choose: (choice: { projectId: string | null; boardId: string | null }) => void;
};

export function useRoomShowing(enabled: boolean, showing: Showing): RoomShowingChoices {
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [boards, setBoards] = useState<{ id: string; title: string }[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const { projects: list } = (await board.projects()) as {
          projects: { id: string; name: string }[];
        };
        if (!cancelled) setProjects(list);
      } catch {
        // Left null, which the caller shows as "could not be read" rather than
        // as an empty list — "there are no projects" and "we could not ask" are
        // different answers and only one of them is your fault.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // The mood boards of whichever project the ROOM is on, so the list offered is
  // always the list that is legal — the server refuses a board from elsewhere,
  // and offering one would be inviting a refusal.
  useEffect(() => {
    if (!enabled || !showing.projectId) {
      setBoards(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // Through the project detail, which already carries its boards —
        // rather than a second endpoint that would return the same rows.
        const detail = (await board.project(showing.projectId as string)) as {
          boards?: { id: string; title?: string; name?: string }[];
        };
        const list = (detail.boards ?? []).map((moodBoard) => ({
          id: moodBoard.id,
          title: moodBoard.title ?? moodBoard.name ?? moodBoard.id,
        }));
        if (!cancelled) setBoards(list);
      } catch {
        if (!cancelled) setBoards(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, showing.projectId]);

  const choose = useCallback((choice: { projectId: string | null; boardId: string | null }) => {
    setRefusal(null);
    void (async () => {
      try {
        // NOT SET LOCALLY FIRST. Everywhere else in this app an optimistic
        // update is right, because the change is yours. This one is the room's:
        // showing it to yourself before the server has agreed would mean the
        // person who made the change is the one person seeing something nobody
        // else is. The socket tells everybody, including you.
        await space.setShowing(choice);
      } catch (cause) {
        setRefusal(
          cause instanceof ApiError
            ? cause.message
            : "That change did not reach the room, so nothing was saved.",
        );
      }
    })();
  }, []);

  return { projects, boards, refusal, choose };
}
