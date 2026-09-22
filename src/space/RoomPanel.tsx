import { useState } from "react";
import type { Station } from "../../shared/space-layout";
import type { RoomFeed } from "./useRoomFeed";
import { BoardPanel3D } from "./BoardPanel3D";
import { ChatPanel3D } from "./ChatPanel3D";
import { CardDetail3D } from "./CardDetail3D";
import { Typing3D } from "./Typing3D";
import { SettingsPanel3D } from "./SettingsPanel3D";
import { MoodPanel3D } from "./MoodPanel3D";
import { ListPanel3D } from "./ListPanel3D";
import type { ListRow } from "../../shared/list-paint";
import type { SettingsItem } from "../../shared/settings-3d";
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
 * NOTHING IS PHOTOGRAPHED ANY MORE. `StillPanel` was the honest interim while
 * some panels were drawn and others were screenshots of the website; every
 * station now draws its own data, so it is gone and so is the renderer that
 * fed it.
 */
export function RoomPanel({
  station,
  feed,
  boardFeed,
  onSay,
  onOpenCard,
  openCard,
  onCloseCard,
  projectId,
  settings,
  boardId,
  people,
  said,
}: {
  station: Station;
  feed: RoomFeed;
  boardFeed: BoardFeed;
  onSay: (message: string) => void;
  onOpenCard: (cardId: string) => void;
  /** The card pulled off the board, if any. */
  openCard: string | null;
  onCloseCard: () => void;
  /** Which project a new card belongs to. Null means nothing can be added. */
  projectId: string | null;
  /** What the settings panel offers, and what to do when one is pressed. */
  settings: { items: SettingsItem[]; onPress: (id: string) => void };
  /** Which mood board the room is on, if anyone has said. */
  boardId: string | null;
  /** Who is in the room, and what has been said in it. */
  people: ListRow[];
  said: ListRow[];
}) {
  if (station.id === "chat") return <ChatPanel3D station={station} feed={feed} />;

  if (station.id === "people") {
    return (
      <ListPanel3D
        title="In the room"
        rows={people}
        surface={station.surface}
        empty="Nobody else is here."
      />
    );
  }

  if (station.id === "said") {
    return (
      <ListPanel3D
        title="Said in the room"
        rows={said}
        surface={station.surface}
        empty="Nobody has said anything yet."
        newestLast
        leadWithSecondary
      />
    );
  }

  if (station.id === "moodBoard") {
    return (
      <MoodPanel3D
        items={boardFeed.moodItemsOf(boardId)}
        surface={station.surface}
        onSay={onSay}
        onMove={async (itemId, at) => {
          await board.moveItem(itemId, at);
          boardFeed.refresh();
        }}
      />
    );
  }

  if (station.id === "settings") {
    return <SettingsPanel3D items={settings.items} surface={station.surface} onPress={settings.onPress} />;
  }

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

  /**
   * EVERY STATION IS DRAWN NATIVELY NOW, so this is only reachable if somebody
   * adds one to the catalogue and forgets to draw it. Saying so is better than
   * a photograph of a page that may not even exist, and far better than a
   * blank rectangle nobody can explain.
   */
  return (
    <ListPanel3D
      title={station.label}
      rows={[]}
      surface={station.surface}
      empty="This panel has nothing to draw yet."
    />
  );
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
      {/*
        IN FRONT OF THE BOARD, MIDDLE, AND FORWARD.
        
        Two placements before this one. Over the board's right shoulder sat
        squarely on `review` and `done` — the two columns you are most likely to
        be working in. Pushed clear of the right edge, it inherited the panel's
        SCALE, so on an enlarged board "just past the edge" became several
        metres out into the room, edge-on to the reader and colliding with the
        panel next door.
        
        Centred and forward reads as what it is: a thing held up in front of the
        board, the way you would hold a card you had just taken off it. It does
        cover the columns while it is open, which is correct for something you
        opened deliberately and close with one press.
      */}
      {detail ? (
        <CardDetail3D
          task={detail}
          onClose={onCloseCard}
          onComment={() => {
            setAdding(null);
            setCommenting(detail.id);
          }}
          at={[0, 0, 0.55]}
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
        
        NEARER THAN THE DETAIL PANEL, which is the whole reason for the `z`.
        Writing a comment opens this in front of the card you are commenting on
        — and the first time it opened BEHIND that card, so the keyboard you
        were meant to type on was hidden by the thing it was for. Whatever you
        are typing into has to be the nearest thing to you.
      */}
      {adding !== null ? (
        <Typing3D
          prompt={`New card in ${columnLabel(adding)}`}
          position={[0, -station.surface.height * 0.34, 0.8]}
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
          position={[0, -station.surface.height * 0.34, 0.8]}
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
