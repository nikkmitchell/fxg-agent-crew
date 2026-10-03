import { useEffect, useState } from "react";
import type { FinishedSpace } from "../../../shared/finished-spaces";
import { roomKey } from "../../../shared/space-room";
import { bff } from "../../bff-client";

/**
 * IS THIS ROOM A FINISHED SPACE (shared/finished-spaces.ts; Nikk, 6940)? Then
 * its work controls are hidden: no work panels, no Library, no ⚙ on things.
 * Read once per room; a room that cannot be asked about counts as a work room.
 */
export function useFinishedRoom(room: string | null | undefined): FinishedSpace | null {
  const [finished, setFinished] = useState<FinishedSpace | null>(null);
  useEffect(() => {
    setFinished(null);
    if (!room) return;
    const abort = new AbortController();
    bff.finishedSpaces(abort.signal)
      .then((answer) => setFinished(answer.spaces.find((one) => roomKey(one.room) === roomKey(room)) ?? null))
      .catch(() => undefined);
    return () => abort.abort();
  }, [room]);
  return finished;
}
