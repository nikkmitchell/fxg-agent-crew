import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { thumbPath } from "../../shared/avatar-choice";
import { CARD_INK } from "../../shared/card-paint";
import type { LobbyDoor, Wearable } from "../../shared/lobby-hall";
import {
  DOOR_PANEL,
  WARDROBE_PANEL,
  doorItems,
  layOutWardrobe,
  paintWardrobe,
  wardrobeAt,
  wardrobePixels,
  type DoorTab,
  type PanelInk,
  type WardrobeTab,
} from "../../shared/lobby-panels";
import { base } from "../router";
import { makeInkCanvas, measureWith } from "./ink-canvas";
import { claimPointer } from "./pointer-claim";
import { SettingsPanel3D } from "./SettingsPanel3D";

/**
 * THE LOBBY'S DOORS AND WARDROBE IN THE SETTINGS PANEL'S CLOTHES (Nikk2, 6974).
 * The rules live in shared/lobby-panels.ts; this draws them and turns presses into calls.
 */

export function DoorsPanel({
  split,
  loading,
  going,
  onGo,
  onRefresh,
}: {
  split: { finished: readonly LobbyDoor[]; work: readonly LobbyDoor[] };
  loading: boolean;
  going: string | null;
  onGo: (door: LobbyDoor) => void;
  onRefresh: () => void;
}) {
  // Finished spaces first (Nikk, 6940); with none published yet, the work rooms are what there is.
  const [tab, setTab] = useState<DoorTab>("finished");
  const [page, setPage] = useState(0);
  const showing: DoorTab = tab === "finished" && split.finished.length ? "finished" : "work";
  const { items, shown, pages } = useMemo(() => {
    const answer = doorItems(split, showing, page, loading);
    // While a door is opening, say so on its own row.
    answer.items = answer.items.map((item) =>
      item.kind === "cycle" && item.id.startsWith("door:") && going !== null && answer.shown[Number(item.id.slice(5))]?.room === going
        ? { ...item, value: "…" }
        : item,
    );
    return answer;
  }, [split, showing, page, loading, going]);

  const press = (id: string) => {
    if (id === "tab:finished" || id === "tab:work") {
      setTab(id.slice(4) as DoorTab);
      setPage(0);
    } else if (id === "page:less") setPage((p) => Math.max(0, p - 1));
    else if (id === "page:more") setPage((p) => Math.min(pages - 1, p + 1));
    else if (id === "refresh") {
      setPage(0);
      onRefresh();
    } else if (id.startsWith("door:")) {
      const door = shown[Number(id.slice(5))];
      if (door) onGo(door);
    }
  };
  return <SettingsPanel3D items={items} surface={{ width: DOOR_PANEL.width, height: DOOR_PANEL.height }} onPress={press} />;
}

/** One thumbnail per body, loaded once and kept for the page's life. */
const pictures = new Map<string, HTMLImageElement>();
function picture(body: Wearable, onLoad: () => void): HTMLImageElement | null {
  let img = pictures.get(body.key);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = `${base}${body.thumb ?? thumbPath(body.name)}`;
    pictures.set(body.key, img);
  }
  if (img.complete && img.naturalWidth > 0) return img;
  img.addEventListener("load", onLoad, { once: true });
  return null;
}

export function WardrobePanel({
  bodies,
  worn,
  busy,
  onWear,
}: {
  bodies: readonly Wearable[] | null;
  worn: string | null;
  busy: string | null;
  onWear: (body: Wearable) => void;
}) {
  const [tab, setTab] = useState<WardrobeTab>("public");
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(0); // bumps as pictures arrive, to repaint
  const px = useMemo(() => wardrobePixels(), []);
  const { canvas, texture } = useMemo(() => makeInkCanvas(px.width, px.height), [px.width, px.height]);
  const invalidate = useThree((state) => state.invalidate);
  const plate = useRef<THREE.Mesh>(null);
  const pressed = useRef<string | null>(null);
  const layout = useMemo(() => layOutWardrobe(bodies, tab, page, worn, busy), [bodies, tab, page, worn, busy]);

  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const images = new Map<string, HTMLImageElement>();
    for (const tile of layout.tiles) {
      if (!tile.body.pictured) continue;
      const img = picture(tile.body, () => setLoaded((n) => n + 1));
      if (img) images.set(tile.body.key, img);
    }
    drawPanelInk(context, paintWardrobe(layout, measureWith(context)), images);
    texture.needsUpdate = true;
    invalidate();
  }, [canvas, texture, invalidate, layout, loaded]);

  useEffect(() => () => texture.dispose(), [texture]);

  const at = (event: ThreeEvent<PointerEvent>): string | null => {
    const mesh = plate.current;
    if (!mesh) return null;
    const local = mesh.worldToLocal(event.point.clone());
    return wardrobeAt(layout, { x: local.x / layout.width + 0.5, y: local.y / layout.height + 0.5 });
  };
  const press = (id: string) => {
    if (id === "tab:public" || id === "tab:ai") {
      setTab(id.slice(4) as WardrobeTab);
      setPage(0);
    } else if (id === "page:less") setPage((p) => Math.max(0, p - 1));
    else if (id === "page:more") setPage((p) => Math.min((layout.pager?.pages ?? 1) - 1, p + 1));
    else if (id.startsWith("wear:")) {
      const tile = layout.tiles.find((t) => t.body.key === id.slice(5));
      if (tile) onWear(tile.body);
    }
  };

  return (
    <mesh
      ref={plate}
      onPointerDown={(event) => {
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        pressed.current = at(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        const started = pressed.current;
        pressed.current = null;
        if (started && at(event) === started) press(started);
      }}
      onPointerLeave={() => {
        pressed.current = null;
      }}
    >
      <planeGeometry args={[WARDROBE_PANEL.width, WARDROBE_PANEL.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Like drawInk (ink-canvas.ts), plus pictures fitted inside their box and centred text. */
function drawPanelInk(context: CanvasRenderingContext2D, ink: readonly PanelInk[], images: ReadonlyMap<string, HTMLImageElement>): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  for (const item of ink) {
    if (item.kind === "image") {
      const img = images.get(item.key);
      if (!img) {
        context.fillStyle = CARD_INK.edge;
        context.fillRect(item.x, item.y, item.width, item.height);
        continue;
      }
      // Fitted, never stretched: a 200x300 picture keeps its shape in a box of another.
      const scale = Math.min(item.width / img.naturalWidth, item.height / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      context.save();
      rounded(context, item.x, item.y, item.width, item.height, 6);
      context.clip();
      context.fillStyle = CARD_INK.edge; // the room's theme, as everywhere else on the panel
      context.fillRect(item.x, item.y, item.width, item.height);
      context.drawImage(img, item.x + (item.width - w) / 2, item.y + (item.height - h) / 2, w, h);
      context.restore();
      continue;
    }
    context.fillStyle = item.fill;
    if (item.kind === "text") {
      context.font = `${item.weight === "bold" ? "600 " : ""}${item.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      context.textBaseline = "alphabetic";
      context.textAlign = item.align ?? "left";
      context.fillText(item.text, item.x, item.y);
    } else if (item.kind === "rect" && item.radius) {
      rounded(context, item.x, item.y, item.width, item.height, item.radius);
      context.fill();
    } else {
      context.fillRect(item.x, item.y, item.width, item.height);
    }
  }
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
