import { useCallback, useRef, useState } from "react";
import { readableInk } from "./avatar";
import { BoardError, board } from "./board-client";

/**
 * A mood board.
 *
 * The first thing this product can do that chat-as-a-database could not do at
 * all — not slowly, not awkwardly: a 2000-character message cannot carry a
 * JPEG. See ADR-002.
 */

export type BoardItem = {
  id: string;
  kind: "image" | "link" | "note" | "swatch";
  blob_id: string | null;
  url: string | null;
  text: string | null;
  caption: string | null;
  x: number; y: number; w: number; h: number; z: number;
  added_by: string;
  blob_width: number | null;
  blob_height: number | null;
};

export type Board = { id: string; name: string; items: BoardItem[] };

/**
 * A colour, shown as a colour.
 *
 * The value is written on top in ink MEASURED against the swatch rather than
 * chosen by eye — `readableInk` is the same function the avatars use, and it
 * exists because a human never looks at most of these combinations. A hex code
 * printed in black on a navy square is a value nobody can read.
 *
 * Editing is a native colour input sitting invisibly over the square, so the
 * platform's own picker does the work. Recolouring a swatch is a content change
 * and is audited, unlike dragging it.
 */
function Swatch({
  item,
  canEdit,
  onPick,
}: {
  item: BoardItem;
  canEdit: boolean;
  onPick: (value: string) => void;
}) {
  const colour = /^#[0-9a-fA-F]{6}$/.test(item.text ?? "") ? (item.text as string) : "#cccccc";
  return (
    <div className="moodboard-swatch" style={{ background: colour }}>
      <span style={{ color: readableInk(colour) }}>{colour.toUpperCase()}</span>
      {canEdit ? (
        <input
          type="color"
          value={colour}
          aria-label={`Colour ${colour}`}
          // Committed on change rather than on every drag of the picker: the
          // native control fires continuously while you slide, and each one
          // would be an audited write.
          onChange={(event) => onPick(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : null}
    </div>
  );
}

/**
 * A note you write on directly.
 *
 * Editable in place rather than through a dialog, because a prompt box is a
 * worse place to write than the thing you are making. Saved when focus leaves
 * and only if it actually changed — otherwise clicking a note to read it would
 * record an edit that did not happen.
 */
function Note({
  item,
  canEdit,
  onWrite,
}: {
  item: BoardItem;
  canEdit: boolean;
  onWrite: (value: string) => void;
}) {
  if (!canEdit) return <p className="moodboard-note">{item.text}</p>;
  return (
    <p
      className="moodboard-note is-editable"
      contentEditable
      suppressContentEditableWarning
      // Dragging the note must not start a text selection fight with the drag
      // handler, so a pointer down inside the text stays inside the text.
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const value = event.currentTarget.textContent ?? "";
        if (value.trim() !== (item.text ?? "").trim()) onWrite(value);
      }}
    >
      {item.text}
    </p>
  );
}

export function MoodBoard({ board: model, canEdit, onChanged }: {
  board: Board;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  /**
   * Refusals are shown as the server wrote them.
   *
   * "SVG can carry scripts. Export it as PNG and upload that." tells someone
   * what to do; "upload failed" tells them to try the same thing again.
   */
  const attempt = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
    } catch (cause) {
      setError(cause instanceof BoardError ? cause.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  /**
   * Where a new thing goes.
   *
   * Just below and right of whatever is already there, rather than always at
   * the top left where it would land on top of the last one. Not a layout
   * engine — the point of this surface is that a person arranges it themselves.
   */
  const nextSpot = () => {
    const items = model.items;
    if (items.length === 0) return { x: 32, y: 32 };
    const lowest = items.reduce((a, b) => (a.y + a.h > b.y + b.h ? a : b));
    return { x: Math.max(24, lowest.x), y: lowest.y + lowest.h + 18 };
  };

  const addNote = () =>
    void attempt(() =>
      board.addItem(model.id, {
        kind: "note",
        // Written on the note itself rather than asked for in a dialog. A
        // prompt box is a worse place to write than the thing you are making.
        text: "New note",
        ...nextSpot(),
        w: 220,
        h: 120,
      }),
    );

  /**
   * A palette, not a colour.
   *
   * Nikk asked for palettes, and a palette is several colours seen together —
   * one swatch at a time makes you do the arranging before you can judge it.
   * These are a starting row to drag apart and recolour, not a recommendation:
   * the accents from src/avatar.ts, which are already in use on this site.
   */
  const addPalette = () =>
    void attempt(async () => {
      const spot = nextSpot();
      const colours = ["#3156d8", "#e45338", "#3d8063", "#cf9126", "#6244a8"];
      for (const [index, colour] of colours.entries()) {
        await board.addItem(model.id, {
          kind: "swatch",
          text: colour,
          x: spot.x + index * 96,
          y: spot.y,
          w: 88,
          h: 88,
        });
      }
    });

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void attempt(async () => {
      // Sequential rather than Promise.all: identical files collapse to one
      // blob server-side, and racing them would make two items for one image.
      for (const file of Array.from(files)) {
        const { result } = await board.upload(file);
        await board.addItem(model.id, {
          kind: "image",
          blobId: result.id,
          caption: file.name,
          // Placed at a readable size, keeping the image's own proportions so
          // the first thing you see is not a squashed version of your picture.
          w: 260,
          h: result.width && result.height ? Math.round((260 * result.height) / result.width) : 260,
        });
      }
    });
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    addFiles(event.dataTransfer.files);
  };

  /**
   * Dragging updates the server only when the pointer is released.
   *
   * A request per mousemove would be hundreds of writes to arrange one board,
   * and the audit table would drown the changes that matter — the same lesson
   * as saha-machine-noise, applied before it happened rather than after.
   */
  const startDrag = (event: React.PointerEvent, item: BoardItem) => {
    if (!canEdit) return;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const startX = event.clientX - item.x;
    const startY = event.clientY - item.y;
    setDragging(item.id);

    const move = (e: PointerEvent) => {
      element.style.left = `${e.clientX - startX}px`;
      element.style.top = `${e.clientY - startY}px`;
    };
    const up = (e: PointerEvent) => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      setDragging(null);
      void attempt(() => board.moveItem(item.id, { x: e.clientX - startX, y: e.clientY - startY }));
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
  };

  return (
    <section className="moodboard">
      <header className="moodboard-head">
        <h3>{model.name}</h3>
        {canEdit ? (
          <label className="moodboard-add">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
              multiple
              onChange={(event) => addFiles(event.target.files)}
              disabled={busy}
            />
            <span>{busy ? "Adding…" : "Add images"}</span>
          </label>
        ) : null}
        {canEdit ? (
          <>
            <button type="button" className="moodboard-add" onClick={addNote} disabled={busy}>
              Add note
            </button>
            <button type="button" className="moodboard-add" onClick={addPalette} disabled={busy}>
              Add palette
            </button>
          </>
        ) : null}
      </header>

      {error ? <p className="project-error" role="alert">{error}</p> : null}

      <div
        ref={surface}
        className={`moodboard-surface${canEdit ? " is-editable" : ""}`}
        onDragOver={(event) => canEdit && event.preventDefault()}
        onDrop={onDrop}
        aria-label={`${model.name} — ${model.items.length} item${model.items.length === 1 ? "" : "s"}`}
      >
        {model.items.length === 0 ? (
          <p className="moodboard-empty">
            {canEdit
              ? "Drop images here, or add a note or a palette. Images can be PNG, JPEG, GIF, WebP or PDF."
              : "Nothing on this board yet."}
          </p>
        ) : null}

        {model.items.map((item) => (
          <figure
            key={item.id}
            className={`moodboard-item${dragging === item.id ? " is-dragging" : ""}`}
            style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }}
            onPointerDown={(event) => startDrag(event, item)}
          >
            {item.kind === "image" && item.blob_id ? (
              <img
                src={board.blobUrl(item.blob_id)}
                alt={item.caption ?? "board image"}
                draggable={false}
                loading="lazy"
              />
            ) : item.kind === "link" && item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer noopener">{item.caption ?? item.url}</a>
            ) : item.kind === "swatch" ? (
              // A swatch is a COLOUR. It used to fall through to the note case
              // and print its own hex as a line of text, which is the one thing
              // a swatch cannot usefully be. The value stays readable on top,
              // in ink measured against the colour rather than guessed, so it
              // is legible on a pale yellow and on a navy alike.
              <Swatch item={item} canEdit={canEdit} onPick={(value) => void attempt(() => board.editItem(item.id, { text: value }))} />
            ) : (
              <Note item={item} canEdit={canEdit} onWrite={(value) => void attempt(() => board.editItem(item.id, { text: value }))} />
            )}

            {item.caption ? <figcaption>{item.caption}</figcaption> : null}

            {canEdit ? (
              <button
                type="button"
                className="moodboard-remove"
                aria-label={`Remove ${item.caption ?? "item"}`}
                onClick={() => void attempt(() => board.removeItem(item.id))}
              >
                ×
              </button>
            ) : null}
          </figure>
        ))}
      </div>

      {/*
        * Said once, quietly, rather than in a confirmation dialog: removing an
        * item does not delete the file, because another board may show the same
        * image and deleting bytes on one reference is how you lose a file that
        * was still in use.
        */}
      {canEdit && model.items.length > 0 ? (
        <p className="moodboard-note-foot">Removing an item leaves the file itself; another board may be using it.</p>
      ) : null}
    </section>
  );
}
