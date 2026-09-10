import { useCallback, useRef, useState } from "react";
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
              ? "Drop images here, or use Add images. PNG, JPEG, GIF, WebP and PDF."
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
            ) : (
              <p className="moodboard-note">{item.text}</p>
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
