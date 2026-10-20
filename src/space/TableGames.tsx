import { sameActor } from "../../shared/board-rules";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import {
  chessBoard,
  chessInCheck,
  gameInstruction,
  gameSide,
  gameWidth,
  GAME_NAMES,
  legalGameMoves,
  type GameRoomItem,
} from "../../shared/table-games";
import { space } from "../space-client";
import type { RoomItem } from "../../shared/room-items";
import { useCarry } from "./modules/use-carry";
import { claimPointer } from "./pointer-claim";
const noRaycast = () => {};
const mine = (a: string | null, b: string | null) =>
  Boolean(a && b && sameActor(a, b));
const P = 0.125,
  TOP = 0.79;
function TouchButton({
  label,
  x,
  z,
  width = 0.48,
  disabled = false,
  press,
}: {
  label: string;
  x: number;
  z: number;
  width?: number;
  disabled?: boolean;
  press: () => void;
}) {
  const down = useRef<number | null>(null);
  return (
    <group position={[x, TOP + 0.015, z]}>
      <mesh
        onPointerDown={(e) => {
          claimPointer(e.nativeEvent);
          e.stopPropagation();
          down.current = e.pointerId;
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (down.current === e.pointerId && !disabled) press();
          down.current = null;
        }}
        onPointerCancel={() => {
          down.current = null;
        }}
      >
        <boxGeometry args={[width, 0.025, 0.105]} />
        <meshStandardMaterial
          color={disabled ? "#343e3c" : "#34574d"}
          roughness={0.55}
        />
      </mesh>
      <Text
        raycast={noRaycast}
        rotation-x={-Math.PI / 2}
        position={[0, 0.016, 0]}
        fontSize={0.038}
        maxWidth={width - 0.025}
        color={disabled ? "#92968b" : "#f0e2c3"}
        textAlign="center"
      >
        {label}
      </Text>
    </group>
  );
}
function ChessPiece({
  type,
  side,
  x,
  z,
}: {
  type: string;
  side: number;
  x: number;
  z: number;
}) {
  const shape = useMemo(() => {
    const h =
      type === "p" ? 0.1 : type === "k" ? 0.18 : type === "q" ? 0.16 : 0.14;
    return [
      new THREE.Vector2(0.043, 0),
      new THREE.Vector2(0.044, 0.015),
      new THREE.Vector2(0.032, 0.025),
      new THREE.Vector2(0.023, 0.045),
      new THREE.Vector2(0.018, h - 0.025),
      new THREE.Vector2(0.031, h - 0.013),
      new THREE.Vector2(0.03, h),
    ];
  }, [type]);
  return (
    <group position={[x, TOP + 0.012, z]}>
      <mesh raycast={noRaycast}>
        <latheGeometry args={[shape, 12]} />
        <meshStandardMaterial
          color={side === 1 ? "#e3d6b9" : "#263632"}
          roughness={0.35}
        />
      </mesh>
      <Text
        raycast={noRaycast}
        position={[0, shape[shape.length - 1].y + 0.017, 0]}
        rotation-x={-Math.PI / 2}
        fontSize={0.037}
        color={side === 1 ? "#263632" : "#f0e2c3"}
      >
        {type.toUpperCase()}
      </Text>
    </group>
  );
}
export function TableGameTable({
  item,
  you,
  onItem,
  onRemoved,
}: {
  item: GameRoomItem;
  you: string | null;
  onItem: (i: RoomItem) => void;
  onRemoved: (id: string) => void;
}) {
  const body = useRef<THREE.Group>(null),
    latest = useRef(item);
  latest.current = item;
  const [chosen, setChosen] = useState<number | null>(null),
    [promotion, setPromotion] = useState("q"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(false),
    [removeArmed, setRemoveArmed] = useState(false),
    [resignArmed, setResignArmed] = useState(false);
  const pending = useRef(false),
    pressed = useRef<{ pointer: number; cell: number } | null>(null);
  useEffect(() => {
    setChosen(item.state.forced);
    setResignArmed(false);
  }, [item.revision, item.state.forced]);
  const refresh = async () => {
    const r = await space.roomItems();
    const i = r.items.find((i) => i.id === item.id);
    if (i) onItem(i);
  };
  const action = async (change: Record<string, unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    try {
      const r = await space.actOnTableGame(item.id, {
        ...change,
        revision: latest.current.revision,
      });
      onItem(r.item);
      setChosen(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save the move.");
      try {
        await refresh();
      } catch {
        /* Keep the last confirmed state. */
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const carry = useCarry({
    id: item.id,
    body,
    position: item.position,
    notice: setNotice,
    save: async (position) => {
      try {
        const r = await space.placeModule(item.id, {
          position,
          revision: latest.current.revision,
        });
        onItem(r.item);
        return true;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not move the table.");
        await refresh();
        return false;
      }
    },
  });
  const width = gameWidth(item.game),
    height = item.game === "connect-four" ? 6 : width;
  const moves = useMemo(
    () => legalGameMoves(item.game, item.state),
    [item.game, item.state],
  );
  const pieces = useMemo(
    () => (item.game === "chess" ? chessBoard(item.state) : []),
    [item.game, item.state],
  );
  const canPlay =
    Boolean(you && mine(item.seats[item.state.turn - 1], you)) &&
    !busy &&
    item.state.winner === null;
  const marked = new Set(
    moves
      .filter(
        (m) => m.from === undefined || m.from === (item.state.forced ?? chosen),
      )
      .map((m) => m.to),
  );
  const point = (cell: number) => ({
    x: ((cell % width) - (width - 1) / 2) * P,
    z: (Math.floor(cell / width) - (height - 1) / 2) * P,
  });
  const click = (cell: number) => {
    if (!canPlay) {
      setNotice("Take a seat below, then play when it is your turn.");
      return;
    }
    if (item.game === "chess" || item.game === "checkers") {
      const from = item.state.forced ?? chosen;
      if (
        from !== null &&
        moves.some((m) => m.from === from && m.to === cell)
      ) {
        void action({ action: "move", from, to: cell, promotion });
        return;
      }
      if (moves.some((m) => m.from === cell)) {
        setChosen(cell);
        setNotice("Choose a lit destination.");
      } else
        setNotice(
          item.state.forced !== null
            ? "Finish the same piece’s capture."
            : "Choose one of your movable pieces.",
        );
    } else
      void action({
        action: "move",
        ...(item.game === "connect-four"
          ? { column: cell % width }
          : { to: cell }),
      });
  };
  const boardCell = (e: ThreeEvent<PointerEvent>) => {
    const v = e.object.worldToLocal(e.point.clone());
    const x = Math.floor(v.x / P + width / 2),
      y = Math.floor(v.z / P + height / 2);
    return x >= 0 && x < width && y >= 0 && y < height ? y * width + x : null;
  };
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1024;
    const g = c.getContext("2d")!;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        g.fillStyle =
          item.game === "reversi" || item.game === "connect-four"
            ? "#315b4d"
            : (x + y) % 2
              ? "#4a6758"
              : "#ddcfaa";
        g.fillRect(
          (x * 1024) / width,
          (y * 1024) / height,
          1024 / width + 1,
          1024 / height + 1,
        );
        g.strokeStyle = "#253d3440";
        g.strokeRect(
          (x * 1024) / width,
          (y * 1024) / height,
          1024 / width,
          1024 / height,
        );
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [item.game, width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  const check = useMemo(
    () => item.game === "chess" && chessInCheck(item.state),
    [item.game, item.state],
  );
  const status =
    item.state.winner !== null
      ? item.state.winner === 0
        ? "Draw"
        : `${gameSide(item.game, item.state.winner)} wins`
      : `${gameSide(item.game, item.state.turn)} to play${item.state.forced !== null ? " · finish the jump" : check ? " · check" : ""}`;
  const remove = async () => {
    if (!removeArmed) {
      setRemoveArmed(true);
      setNotice("Press Remove again to take this table out of the room.");
      return;
    }
    try {
      await space.removeRoomItem(item.id);
      onRemoved(item.id);
    } catch (e) {
      setNotice(String(e));
    }
  };
  return (
    <group
      ref={body}
      position={[item.position.x, item.position.y, item.position.z]}
      rotation-y={item.position.rotationY}
      scale={item.scale}
    >
      <mesh raycast={noRaycast} position={[0, 0.735, 0.1]}>
        <boxGeometry args={[1.48, 0.09, 1.75]} />
        <meshStandardMaterial color="#493d30" roughness={0.6} />
      </mesh>
      {[-0.61, 0.61].flatMap((x) =>
        [-0.57, 0.76].map((z) => (
          <mesh key={`${x},${z}`} raycast={noRaycast} position={[x, 0.35, z]}>
            <cylinderGeometry args={[0.028, 0.038, 0.7, 10]} />
            <meshStandardMaterial
              color="#9e8352"
              metalness={0.5}
              roughness={0.4}
            />
          </mesh>
        )),
      )}
      <Text
        raycast={noRaycast}
        rotation-x={-Math.PI / 2}
        position={[-0.65, TOP, -0.69]}
        fontSize={0.064}
        anchorX="left"
        color="#ecd9af"
      >
        {GAME_NAMES[item.game]}
      </Text>
      <Text
        raycast={noRaycast}
        rotation-x={-Math.PI / 2}
        position={[-0.65, TOP, -0.59]}
        fontSize={0.035}
        anchorX="left"
        color="#d2c39f"
      >
        {status}
      </Text>
      <group
        position={
          item.game === "connect-four" ? [0, TOP + 0.45, -0.1] : [0, 0, 0]
        }
        rotation-x={item.game === "connect-four" ? Math.PI / 2 : 0}
      >
        <group position={[0, item.game === "connect-four" ? -TOP : 0, 0]}>
          <mesh
            position={[0, TOP, 0]}
            onPointerDown={(e) => {
              claimPointer(e.nativeEvent);
              e.stopPropagation();
              const cell = boardCell(e);
              if (cell !== null)
                pressed.current = { pointer: e.pointerId, cell };
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              const cell = boardCell(e),
                p = pressed.current;
              pressed.current = null;
              if (p && p.pointer === e.pointerId && cell === p.cell)
                click(cell);
            }}
            onPointerCancel={() => {
              pressed.current = null;
            }}
          >
            <boxGeometry args={[width * P, 0.015, height * P]} />
            <meshStandardMaterial map={texture} roughness={0.7} />
          </mesh>
          {Array.from({ length: width * height }, (_, i) => {
            const { x, z } = point(i),
              n = item.state.board[i],
              p = pieces[i];
            return (
              <group key={i}>
                {item.game === "connect-four" && !n && (
                  <mesh raycast={noRaycast} position={[x, TOP, z]}>
                    <cylinderGeometry args={[0.047, 0.047, 0.024, 20]} />
                    <meshStandardMaterial color="#182b26" />
                  </mesh>
                )}
                {marked.has(item.game === "connect-four" ? i % 7 : i) &&
                  canPlay && (
                    <mesh
                      raycast={noRaycast}
                      position={[x, TOP + 0.012, z]}
                      rotation-x={-Math.PI / 2}
                    >
                      <ringGeometry args={[0.035, 0.041, 16]} />
                      <meshBasicMaterial color="#e9bf5a" />
                    </mesh>
                  )}
                {chosen === i && (
                  <mesh
                    raycast={noRaycast}
                    position={[x, TOP + 0.013, z]}
                    rotation-x={-Math.PI / 2}
                  >
                    <ringGeometry args={[0.048, 0.055, 20]} />
                    <meshBasicMaterial color="#fff0bc" />
                  </mesh>
                )}
                {p && <ChessPiece type={p.type} side={p.side} x={x} z={z} />}
                {n !== 0 && item.game !== "chess" && (
                  <group
                    position={[
                      x,
                      item.game === "connect-four" ? TOP : TOP + 0.025,
                      z,
                    ]}
                  >
                    <mesh raycast={noRaycast}>
                      <cylinderGeometry
                        args={[
                          0.045,
                          0.045,
                          item.game === "connect-four" ? 0.05 : 0.025,
                          20,
                        ]}
                      />
                      <meshStandardMaterial
                        color={
                          item.game === "reversi"
                            ? n === 1
                              ? "#202925"
                              : "#eee1c6"
                            : Math.abs(n) === 1
                              ? "#be5946"
                              : item.game === "checkers"
                                ? "#e7ddc5"
                                : "#e8c777"
                        }
                        roughness={0.4}
                      />
                    </mesh>
                    {n < 0 && (
                      <Text
                        raycast={noRaycast}
                        rotation-x={-Math.PI / 2}
                        position={[0, 0.015, 0]}
                        fontSize={0.043}
                        color="#342b22"
                      >
                        K
                      </Text>
                    )}
                    {item.game === "tic-tac-toe" && (
                      <Text
                        raycast={noRaycast}
                        rotation-x={-Math.PI / 2}
                        position={[0, 0.015, 0]}
                        fontSize={0.053}
                        color="#302d26"
                      >
                        {n === 1 ? "×" : "○"}
                      </Text>
                    )}
                  </group>
                )}
              </group>
            );
          })}
        </group>
      </group>
      <TouchButton
        label={`${gameSide(item.game, 1)}: ${mine(item.seats[0], you) ? "Leave seat" : (item.seats[0] ?? "Take seat")}`}
        x={-0.34}
        z={0.6}
        width={0.64}
        disabled={busy || Boolean(item.seats[0] && !mine(item.seats[0], you))}
        press={() =>
          void action({
            action: mine(item.seats[0], you) ? "leave" : "join",
            side: 1,
          })
        }
      />
      <TouchButton
        label={`${gameSide(item.game, 2)}: ${mine(item.seats[1], you) ? "Leave seat" : (item.seats[1] ?? "Take seat")}`}
        x={0.34}
        z={0.6}
        width={0.64}
        disabled={busy || Boolean(item.seats[1] && !mine(item.seats[1], you))}
        press={() =>
          void action({
            action: mine(item.seats[1], you) ? "leave" : "join",
            side: 2,
          })
        }
      />
      <TouchButton
        label={
          item.resetBy.some((n) => mine(n, you))
            ? "Cancel request"
            : item.resetBy.length
              ? "Agree new game"
              : "New game"
        }
        x={-0.45}
        z={0.75}
        width={0.4}
        disabled={busy}
        press={() =>
          void action({
            action: item.resetBy.some((n) => mine(n, you))
              ? "cancel-reset"
              : "reset",
          })
        }
      />
      <TouchButton
        label={help ? "Hide rules" : "Rules"}
        x={0}
        z={0.75}
        width={0.34}
        press={() => setHelp(!help)}
      />
      <TouchButton
        label={resignArmed ? "Confirm resign" : "Resign"}
        x={0.45}
        z={0.75}
        width={0.4}
        disabled={!canPlay}
        press={() => {
          if (resignArmed) void action({ action: "resign" });
          else {
            setResignArmed(true);
            setNotice(
              "Press Confirm resign to give this game to the other side.",
            );
          }
        }}
      />
      {item.game === "chess" && (
        <TouchButton
          label={`Promote: ${{ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[promotion]}`}
          x={0.33}
          z={-0.69}
          width={0.63}
          press={() =>
            setPromotion(
              ["q", "r", "b", "n"][
                (["q", "r", "b", "n"].indexOf(promotion) + 1) % 4
              ],
            )
          }
        />
      )}
      <TouchButton
        label={removeArmed ? "Confirm remove" : "Remove"}
        x={0.45}
        z={0.91}
        width={0.4}
        press={() => void remove()}
      />
      <mesh
        position={[-0.3, TOP + 0.01, 0.91]}
        onPointerDown={carry.take}
        onPointerMove={carry.steerByRay}
        onPointerUp={carry.dropByRay}
      >
        <boxGeometry args={[0.75, 0.03, 0.1]} />
        <meshStandardMaterial color={carry.carrying ? "#d8bb73" : "#82704d"} />
      </mesh>
      <Text
        raycast={noRaycast}
        rotation-x={-Math.PI / 2}
        position={[-0.3, TOP + 0.028, 0.91]}
        fontSize={0.033}
        color="#f1e4c4"
      >
        Hold to move table
      </Text>
      {(notice || item.resetBy.length > 0) && (
        <Text
          raycast={noRaycast}
          rotation-x={-Math.PI / 2}
          position={[0, TOP + 0.04, 1.07]}
          fontSize={0.034}
          maxWidth={1.45}
          textAlign="center"
          color="#f5ce8f"
        >
          {notice || "New game requested. Every seated player must agree."}
        </Text>
      )}
      {help && (
        <group position={[0, 1.3, -0.2]}>
          <mesh raycast={noRaycast}>
            <boxGeometry args={[1.4, 0.58, 0.025]} />
            <meshStandardMaterial color="#1c312a" />
          </mesh>
          <Text
            raycast={noRaycast}
            position={[0, 0, 0.016]}
            maxWidth={1.27}
            fontSize={0.045}
            textAlign="left"
            color="#ecdfbd"
          >
            {gameInstruction(item.game)}
            {"\n\n"}Take a seat to play; spectators can watch. New game needs
            both players. To play both sides alone, take both seats.
          </Text>
        </group>
      )}
    </group>
  );
}
