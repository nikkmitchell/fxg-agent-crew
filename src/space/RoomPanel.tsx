import { useState } from "react";
import type { Station } from "../../shared/space-layout";
import type { RoomFeed } from "./useRoomFeed";
import { BoardPanel3D } from "./BoardPanel3D";
import { ChatPanel3D } from "./ChatPanel3D";
import { StillPanel } from "./StillPanel";
import { CardDetail3D } from "./CardDetail3D";
import { Typing3D } from "./Typing3D";
import { nextStatuses } from "../../shared/board-rules";
import { BOARD_COLUMNS } from "../../shared/board-3d";
import { board } from "../board-client";
import type { BoardFeed } from "./useBoardCards";

/**
 * The one panel component. Chooses by WHAT it shows, never by WHERE you are.
 *
 * This is goal 15 made structural rather than promised. The scene used to read
 *
 *     {!inHeadset ? <WebPanel …/> : station.id === "chat" ? <ChatPanel3D …/>
 *                                 : <StillPanel …/>}
 *
 * and every feature written after that had to be written twice, or existed in
 * one room and not the other. A branch on `inHeadset` for anything a person can
 * DO is the thing this file exists to prevent; the only thing allowed to differ
 * between a window and a headset is which device drives the pointer, and that
 * is decided far below this, inside the gesture machine, which cannot tell.
 *
 * STILLPANEL SURVIVES FOR THE PANELS NOT YET REBUILT, and it is the same
 * photograph in both modes now rather than an iframe on one side. That is
 * worse for the desktop today and it is the honest interim: two panels drawn
 * natively and two photographed is a state you can finish, while a desktop
 * that silently keeps its iframe is a second implementation that never leaves.
 */
export function RoomPanel({
  station,
  base,
  feed,
  boardFeed,
  onSay,
  onOpenCard,
  openCard,
  onCloseCard,
  projectId,
}: {
  station: Station;
  base: string;
  feed: RoomFeed;
  boardFeed: BoardFeed;
  onSay: (message: string) => void;
  onOpenCard: (cardId: string) => void;
  /** The card pulled off the board, if any. */
  openCard: string | null;
  onCloseCard: () => void;
  /** Which project a new card belongs to. Null means nothing can be added. */
  projectId: string | null;
}) {
  if (station.id === "chat") return <ChatPanel3D station={station} feed={feed} />;

  if (station.id === "taskBoard") {
    return (
      <TaskBoard
        station={station}
        boardFeed={boardFeed}
        onSay={onSay}
        onOpenCard={onOpenCard}
        openCard={openCard}
        onCloseCard={onCloseCard}
        projectId={projectId}
      />
    );
  }

  return <StillPanel station={station} base={base} active />;
}

/**
 * The work board and everything that hangs off it.
 *
 * SEPARATE FROM `RoomPanel` because it has state — what is being written, and
 * for which column — and `RoomPanel` returns early for the other stations, so
 * a hook here would be a hook called conditionally.
 */
function TaskBoard({
  station,
  boardFeed,
  onSay,
  onOpenCard,
  openCard,
  onCloseCard,
  projectId,
}: {
  station: Station;
  boardFeed: BoardFeed;
  onSay: (message: string) => void;
  onOpenCard: (cardId: string) => void;
  openCard: string | null;
  onCloseCard: () => void;
  projectId: string | null;
}) {
  /** The column a new card is being written for, or null. */
  const [adding, setAdding] = useState<string | null>(null);
  /** The task a comment is being written on, or null. */
  const [commenting, setCommenting] = useState<string | null>(null);

  const detail = openCard ? boardFeed.detailOf(openCard) : null;
  const columnLabel = (status: string) =>
    BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;

  return (
      <>
      <BoardPanel3D
        panelId={station.id}
        surface={station.surface}
        cards={boardFeed.cards}
        onMove={async (cardId, to) => {
          await board.transition(cardId, to);
          // Ask for the truth rather than trusting the guess any longer than
          // necessary. See board-actions: the optimistic move is a guess.
          boardFeed.refresh();
        }}
        onOpen={onOpenCard}
        onPullOff={onOpenCard}
        onSay={onSay}
        onAddTask={(status) => {
          if (!projectId) return onSay("the room is not showing a project, so there is nowhere to put a card");
          setCommenting(null);
          setAdding(status);
        }}
      />
      {/* BESIDE THE BOARD, CLEAR OF IT. A child of the same group, so it
          inherits the panel's position, angle and scale — including the scale,
          because somebody who enlarged the board to read it wants this
          enlarged too.
          
          PAST THE RIGHT EDGE rather than over it. The first placement floated
          it above the board and it sat squarely on the `review` and `done`
          columns — so opening a card to read it hid the two columns you are
          most likely to be working in, and you could not drag anything while
          it was open. The board is 4.0 wide, so its edge is at 2.0; this
          clears it. */}
      {detail ? (
        <CardDetail3D
          task={detail}
          onClose={onCloseCard}
          onComment={() => {
            setAdding(null);
            setCommenting(detail.id);
          }}
          at={[2.85, 0, 0.3]}
        />
      ) : null}

      {/*
        WRITING SOMETHING: in front of the lower third of the board.
        
        NOT BELOW THE PANEL, which is where this went first. The typing surface
        is a child of the board's group and so inherits its SCALE, and the room
        lets a panel be enlarged to two and a half times — at which point "just
        below the panel" is three metres down, under the floor, and pressing
        `+` appeared to do nothing at all.
        
        A FRACTION OF THE PANEL'S OWN HEIGHT keeps it in the same place on the
        board however big the board is, and the lower third is the part that is
        empty: cards stack from the top.
      */}
      {adding !== null ? (
        <Typing3D
          prompt={`New card in ${columnLabel(adding)}`}
          position={[0, -station.surface.height * 0.28, 0.35]}
          onCancel={() => setAdding(null)}
          onDone={(title) => {
            const status = adding;
            setAdding(null);
            if (!projectId) return;
            void board
              .createTask({ projectId, title })
              .then(async (made) => {
                // CREATED IN THE BACKLOG AND WALKED OVER, because the server
                // only accepts legal transitions and `backlog → review` is not
                // one of them. Doing it here rather than asking the server for
                // a new rule keeps one table of what may follow what.
                const id = (made as { result?: string }).result;
                if (!id || status === "backlog") return;
                let at = "backlog";
                const seen = new Set<string>([at]);
                while (at !== status) {
                  const step = nextStatuses(at as never).find((s) => !seen.has(s));
                  const toward = nextStatuses(at as never).includes(status as never) ? status : step;
                  if (!toward) break;
                  seen.add(toward);
                  await board.transition(id, toward);
                  at = toward;
                }
              })
              .then(() => boardFeed.refresh())
              .catch((error: unknown) => onSay(error instanceof Error ? error.message : "that card was not saved"));
          }}
        />
      ) : null}

      {commenting !== null ? (
        <Typing3D
          prompt="Comment"
          position={[0, -station.surface.height * 0.28, 0.35]}
          onCancel={() => setCommenting(null)}
          onDone={(text) => {
            const id = commenting;
            setCommenting(null);
            void board
              .comment(id, text)
              .then(() => boardFeed.refresh())
              .catch((error: unknown) => onSay(error instanceof Error ? error.message : "that comment was not saved"));
          }}
        />
      ) : null}
      </>
  );
}
