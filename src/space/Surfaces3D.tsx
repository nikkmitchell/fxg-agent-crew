import { useMemo } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { STATIONS } from "../../shared/space-layout";
import { LANES, LANE_LABELS, type Surfaces, type WallBoard, type WallCard } from "../../shared/space-surfaces";
import { makeLabelTexture } from "./label-texture";

/**
 * The board and the mood boards, on the walls.
 *
 * Read-only. Nothing here writes, and nothing here fills a gap: a lane with no
 * cards is an empty column, and a mood board with no items is an empty frame.
 * The whole point of standing in front of one of these is to find out what is
 * actually on it.
 */

const LANE_COLOUR: Record<string, string> = {
  backlog: "#8a8577",
  assigned: "#3156d8",
  in_progress: "#cf9126",
  blocked: "#e45338",
  review: "#6244a8",
  done: "#3d8063",
};

/** One card, as a tile. Title only — a wall is not a place to read a brief. */
function CardTile({ card, width, height }: { card: WallCard; width: number; height: number }) {
  const label = useMemo(
    () => makeLabelTexture(card.title, { pixelsPerLine: 40 }),
    [card.title],
  );
  return (
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* The lane's colour as a spine down the left edge, so a card keeps its
          status when you are too far away to read the column heading. */}
      <mesh position={[-width / 2 + 0.012, 0, 0.001]}>
        <planeGeometry args={[0.024, height]} />
        <meshBasicMaterial color={LANE_COLOUR[card.status] ?? "#8a8577"} />
      </mesh>
      {label ? (
        <mesh position={[0.012, 0, 0.002]}>
          <planeGeometry args={[width - 0.05, height * 0.62]} />
          <meshBasicMaterial map={label} transparent />
        </mesh>
      ) : null}
      {/* Unowned cards are the ones worth spotting from across the room. A
          card with an owner gets a mark; one without gets nothing, because
          absence is the signal and it should look like absence. */}
      {card.owners.length > 0 ? (
        <mesh position={[width / 2 - 0.05, -height / 2 + 0.04, 0.002]}>
          <circleGeometry args={[0.022, 12]} />
          <meshBasicMaterial color="#141517" />
        </mesh>
      ) : null}
    </group>
  );
}

/** The six lanes across the far wall. */
function TaskWall({ cards }: { cards: WallCard[] }) {
  const station = STATIONS.taskBoard;
  const laneWidth = station.surface.width / LANES.length;
  const headings = useMemo(
    () =>
      Object.fromEntries(
        LANES.map((lane) => [lane, makeLabelTexture(LANE_LABELS[lane], { pixelsPerLine: 48 })]),
      ),
    [],
  );

  const cardWidth = laneWidth - 0.24;
  const cardHeight = 0.26;
  const gap = 0.06;
  const top = station.surface.height / 2 - 0.46;
  /** How many fit before the column runs off the bottom of the wall. */
  const perLane = Math.max(1, Math.floor((station.surface.height - 0.7) / (cardHeight + gap)));

  return (
    <group
      position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
      rotation={[0, station.surface.rotationY, 0]}
    >
      {LANES.map((lane, index) => {
        const inLane = cards.filter((card) => card.status === lane);
        const shown = inLane.slice(0, perLane);
        const hidden = inLane.length - shown.length;
        const x = -station.surface.width / 2 + laneWidth * (index + 0.5);
        return (
          <group key={lane} position={[x, 0, 0.03]}>
            {headings[lane] ? (
              <mesh position={[0, station.surface.height / 2 - 0.2, 0]}>
                <planeGeometry args={[laneWidth - 0.1, 0.26]} />
                <meshBasicMaterial map={headings[lane]!} transparent />
              </mesh>
            ) : null}
            <mesh position={[0, station.surface.height / 2 - 0.36, 0]}>
              <planeGeometry args={[laneWidth - 0.2, 0.014]} />
              <meshBasicMaterial color={LANE_COLOUR[lane]} />
            </mesh>

            {shown.map((card, row) => (
              <group key={card.id} position={[0, top - row * (cardHeight + gap), 0.002]}>
                <CardTile card={card} width={cardWidth} height={cardHeight} />
              </group>
            ))}

            {/* SAY WHAT IS NOT SHOWN. A wall that silently drops the tail of a
                column tells you a lane has eight cards when it has thirty. */}
            {hidden > 0 ? <MoreMark count={hidden} width={cardWidth} y={top - shown.length * (cardHeight + gap)} /> : null}
          </group>
        );
      })}
    </group>
  );
}

function MoreMark({ count, width, y }: { count: number; width: number; y: number }) {
  const label = useMemo(
    () => makeLabelTexture(`+${count} more`, { pixelsPerLine: 40 }),
    [count],
  );
  if (!label) return null;
  return (
    <mesh position={[0, y, 0.002]}>
      <planeGeometry args={[width, 0.2]} />
      <meshBasicMaterial map={label} transparent />
    </mesh>
  );
}

/**
 * One mood board image.
 *
 * Suspends while loading, so a wall of photographs appears as they arrive
 * rather than blocking the whole room.
 */
function MoodImage({ blobId, width, height }: { blobId: string; width: number; height: number }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const texture = useLoader(THREE.TextureLoader, `${base}/bff/board/blobs/${blobId}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/**
 * The mood boards on the left wall.
 *
 * `board_items` already carry x/y/w/h in the 2D editor's own units, so hanging
 * them is a coordinate transform: fit the bounding box of what is actually
 * there to the wall, preserving the arrangement somebody made. Scaling to a
 * fixed grid instead would rearrange their composition, which is the one thing
 * a mood board is.
 */
function MoodWall({ boards }: { boards: WallBoard[] }) {
  const station = STATIONS.moodBoard;
  // One board at a time: the most recently created with anything on it.
  const board = [...boards].reverse().find((one) => one.items.length > 0) ?? boards[0];
  const items = board?.items ?? [];

  const fit = useMemo(() => {
    if (items.length === 0) return null;
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w));
    const maxY = Math.max(...items.map((i) => i.y + i.h));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    // One scale for both axes, so nothing is stretched.
    const scale = Math.min((station.surface.width - 0.4) / spanX, (station.surface.height - 0.7) / spanY);
    // CENTRED. Anchoring to a corner left the whole composition hugging the top
    // left of an eight-metre wall with the rest of it blank, which reads as a
    // layout fault rather than as a mood board that happens to be tall.
    const originX = -(spanX * scale) / 2;
    const originY = (spanY * scale) / 2;
    return { minX, minY, spanX, spanY, scale, originX, originY };
  }, [items, station.surface.width, station.surface.height]);

  const title = useMemo(
    () => (board ? makeLabelTexture(board.name, { pixelsPerLine: 48 }) : null),
    [board],
  );

  return (
    <group
      position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
      rotation={[0, station.surface.rotationY, 0]}
    >
      {title ? (
        <mesh position={[0, station.surface.height / 2 - 0.2, 0.03]}>
          <planeGeometry args={[3, 0.26]} />
          <meshBasicMaterial map={title} transparent />
        </mesh>
      ) : null}

      {fit
        ? items.map((item) => {
            const width = item.w * fit.scale;
            const height = item.h * fit.scale;
            // The 2D board's Y grows downward; the wall's grows upward.
            const x = fit.originX + (item.x - fit.minX + item.w / 2) * fit.scale;
            // The 2D board's Y grows downward; the wall's grows upward. Shifted
            // down a little to clear the board's name along the top edge.
            const y = fit.originY - 0.16 - (item.y - fit.minY + item.h / 2) * fit.scale;
            return (
              <group key={item.id} position={[x, y, 0.03 + item.z * 0.001]}>
                {item.blobId ? (
                  <MoodImage blobId={item.blobId} width={width} height={height} />
                ) : (
                  <PlaceholderItem item={item} width={width} height={height} />
                )}
              </group>
            );
          })
        : null}
    </group>
  );
}

/**
 * An item that is not an uploaded image.
 *
 * Notes, links and swatches exist in `board_items` and are not pictures. Drawn
 * as what they are rather than skipped: a mood board missing half its contents
 * with no indication is worse than a plain rectangle with the text on it.
 */
function PlaceholderItem({
  item,
  width,
  height,
}: {
  item: WallBoard["items"][number];
  width: number;
  height: number;
}) {
  const label = useMemo(
    () => makeLabelTexture(item.text ?? item.caption ?? item.kind, { pixelsPerLine: 40 }),
    [item.text, item.caption, item.kind],
  );
  return (
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={item.kind === "swatch" ? (item.text ?? "#cccccc") : "#fbfaf6"} />
      </mesh>
      {label && item.kind !== "swatch" ? (
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[width * 0.9, height * 0.4]} />
          <meshBasicMaterial map={label} transparent />
        </mesh>
      ) : null}
    </group>
  );
}

export function Surfaces3D({ surfaces }: { surfaces: Surfaces }) {
  return (
    <group>
      <TaskWall cards={surfaces.cards} />
      <MoodWall boards={surfaces.boards} />
    </group>
  );
}
