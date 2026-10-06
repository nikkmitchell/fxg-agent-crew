import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { thumbPath } from "../../shared/avatar-choice";
import { CARD_INK } from "../../shared/card-paint";
import type { LobbyDoor, Wearable } from "../../shared/lobby-hall";
import {
  WARDROBE_PANEL,
  doorPixels,
  doorsAt,
  layOutDoors,
  layOutWardrobe,
  paintDoors,
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
  const layout = useMemo(() => layOutDoors(split, showing, page, loading, going), [split, showing, page, loading, going]);
  const px = useMemo(() => doorPixels(), []);
  const press = (id: string) => {
    if (id === "tab:finished" || id === "tab:work") {
      setTab(id.slice(4) as DoorTab);
      setPage(0);
    } else if (id === "page:less") setPage((p) => Math.max(0, p - 1));
    else if (id === "page:more") setPage((p) => Math.min((layout.pager?.pages ?? 1) - 1, p + 1));
    else if (id === "refresh") {
      setPage(0);
      onRefresh();
    } else if (id.startsWith("door:")) {
      const tile = layout.tiles[Number(id.slice(5))];
      if (tile) onGo(tile.door);
    }
  };
  return (
    <TilePanel
      width={layout.width}
      height={layout.height}
      px={px}
      paint={(measure) => paintDoors(layout, measure)}
      repaintKey={layout}
      at={(uv) => doorsAt(layout, uv)}
      onPress={press}
    />
  );
}

/**
 * A panel of tiles under tabs, painted on a canvas and pressed exactly where a
 * control is drawn: the doors and the wardrobe. `paint` returns the ink;
 * `pictures` are thumbnails by key, for `{ kind: "image" }` ink.
 */
function TilePanel({
  width,
  height,
  px,
  paint,
  repaintKey,
  pictures,
  at,
  onPress,
}: {
  width: number;
  height: number;
  px: { width: number; height: number };
  paint: (measure: (text: string, size: number) => number) => PanelInk[];
  repaintKey: unknown;
  pictures?: ReadonlyMap<string, HTMLImageElement>;
  at: (uv: { x: number; y: number }) => string | null;
  onPress: (id: string) => void;
}) {
  const { canvas, texture } = useMemo(() => makeInkCanvas(px.width, px.height), [px.width, px.height]);
  const invalidate = useThree((state) => state.invalidate);
  const plate = useRef<THREE.Mesh>(null);
  const pressed = useRef<string | null>(null);
  useEffect(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    drawPanelInk(context, paint(measureWith(context)), pictures ?? new Map());
    texture.needsUpdate = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, texture, invalidate, repaintKey, pictures]);
  useEffect(() => () => texture.dispose(), [texture]);
  const hit = (event: ThreeEvent<PointerEvent>): string | null => {
    const mesh = plate.current;
    if (!mesh) return null;
    const local = mesh.worldToLocal(event.point.clone());
    return at({ x: local.x / width + 0.5, y: local.y / height + 0.5 });
  };
  return (
    <mesh
      ref={plate}
      onPointerDown={(event) => {
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        pressed.current = hit(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        const started = pressed.current;
        pressed.current = null;
        if (started && hit(event) === started) onPress(started);
      }}
      onPointerLeave={() => {
        pressed.current = null;
      }}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
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
  const layout = useMemo(() => layOutWardrobe(bodies, tab, page, worn, busy), [bodies, tab, page, worn, busy]);
  const images = useMemo(() => {
    const found = new Map<string, HTMLImageElement>();
    for (const tile of layout.tiles) {
      if (!tile.body.pictured) continue;
      const img = picture(tile.body, () => setLoaded((n) => n + 1));
      if (img) found.set(tile.body.key, img);
    }
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, loaded]);
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
    <TilePanel
      width={WARDROBE_PANEL.width}
      height={WARDROBE_PANEL.height}
      px={px}
      paint={(measure) => paintWardrobe(layout, measure)}
      repaintKey={layout}
      pictures={images}
      at={(uv) => wardrobeAt(layout, uv)}
      onPress={press}
    />
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
