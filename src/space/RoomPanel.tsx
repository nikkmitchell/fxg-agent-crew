import type { Station } from "../../shared/space-layout";
import type { RoomFeed } from "./useRoomFeed";
import { BoardPanel3D } from "./BoardPanel3D";
import { ChatPanel3D } from "./ChatPanel3D";
import { StillPanel } from "./StillPanel";
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
}: {
  station: Station;
  base: string;
  feed: RoomFeed;
  boardFeed: BoardFeed;
  onSay: (message: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  if (station.id === "chat") return <ChatPanel3D station={station} feed={feed} />;

  if (station.id === "taskBoard") {
    return (
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
      />
    );
  }

  return <StillPanel station={station} base={base} active />;
}
