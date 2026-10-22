import * as THREE from "three";
import type { Ctx, ThingDefinition, UiButton } from "../engine/types";
import { sameActor } from "../../shared/board-rules";
import {
  chessBoard,
  chessInCheck,
  gameInstruction,
  gameSide,
  gameWidth,
  GAME_NAMES,
  legalGameMoves,
  type GameMove,
  type GameRoomItem,
  type TableGame,
} from "../../shared/table-games";
import { noRaycast } from "../space/no-raycast";

const CELL = 0.125,
  TOP = 0.79;
const colours = {
  wood: "#493e31",
  pale: "#d9ceb3",
  dark: "#61756b",
  green: "#254e43",
  red: "#cd6958",
  gold: "#edc46c",
  ink: "#20352e",
};

/** Plain Three under ctx.root: the same item runs alone, in a composed space or in a model. */
export function tableGameDefinition(
  game: TableGame,
): Omit<ThingDefinition, "kind"> {
  return {
    name: GAME_NAMES[game],
    size: [1.65, game === "connect-four" ? 1.95 : 1.45, 2.1],
    setup(ctx: Ctx) {
      const group = new THREE.Group(),
        pieces = new THREE.Group();
      group.name = `tabletop:${game}`;
      ctx.root.add(group);
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      const geometry = <T extends THREE.BufferGeometry>(g: T) => {
        geometries.add(g);
        return g;
      };
      const material = (color: string) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
        materials.add(m);
        return m;
      };
      const wood = material(colours.wood),
        pale = material(colours.pale),
        dark = material(colours.ink),
        red = material(colours.red),
        gold = material(colours.gold);
      const mesh = (
        g: THREE.BufferGeometry,
        m: THREE.Material,
        parent: THREE.Object3D,
        x: number,
        y: number,
        z: number,
      ) => {
        const o = new THREE.Mesh(g, m);
        o.position.set(x, y, z);
        parent.add(o);
        return o;
      };
      mesh(
        geometry(new THREE.BoxGeometry(1.58, 0.065, 1.78)),
        wood,
        group,
        0,
        TOP - 0.055,
        0.12,
      );
      const leg = geometry(new THREE.CylinderGeometry(0.035, 0.045, 0.72, 10));
      for (const x of [-0.63, 0.63])
        for (const z of [-0.56, 0.76]) mesh(leg, wood, group, x, 0.36, z);
      const width = gameWidth(game),
        rows = game === "connect-four" ? 6 : width;
      const board = new THREE.Group();
      board.name = "game-board";
      group.add(board);
      board.position.y = TOP;
      if (game === "connect-four") {
        board.rotation.x = Math.PI / 2;
        board.position.set(0, 1.15, -0.22);
      }
      board.add(pieces);
      let table: GameRoomItem | null = null,
        selected: number | null = null,
        promotion = "q",
        pending = false,
        resign = false,
        showHelp = false;
      let notice = "",
        disposed = false;
      const me = ctx.people.me?.id ?? null;
      const mine = (name: string | null) =>
        Boolean(name && me && sameActor(name, me));
      const cells: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] =
        [];
      const chessGeometry = new Map<string, THREE.LatheGeometry>();
      for (const type of ["p", "r", "n", "b", "q", "k"]) {
        const h =
          type === "p" ? 0.1 : type === "k" ? 0.18 : type === "q" ? 0.16 : 0.14;
        chessGeometry.set(
          type,
          geometry(
            new THREE.LatheGeometry(
              [
                [0.043, 0],
                [0.044, 0.015],
                [0.032, 0.025],
                [0.023, 0.045],
                [0.018, h - 0.025],
                [0.031, h - 0.013],
                [0.03, h],
              ].map(([x, y]) => new THREE.Vector2(x, y)),
              12,
            ),
          ),
        );
      }
      const disk = geometry(
        new THREE.CylinderGeometry(0.047, 0.047, 0.023, 24),
      );
      const cap = geometry(new THREE.TorusGeometry(0.025, 0.006, 6, 20));
      const bar = geometry(new THREE.BoxGeometry(0.095, 0.014, 0.02));
      const ring = geometry(new THREE.TorusGeometry(0.037, 0.01, 8, 24));
      // Labels use the host's canvas service; no document, global listener or private renderer.
      const textures: THREE.Texture[] = [];
      function label(
        text: string,
        x: number,
        y: number,
        z: number,
        size = 0.035,
        parent: THREE.Object3D = group,
      ) {
        const canvas = ctx.assets.canvas(128, 128),
          c = canvas.getContext("2d") as CanvasRenderingContext2D;
        c.clearRect(0, 0, 128, 128);
        c.fillStyle = "#f8ebce";
        c.font = "bold 76px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(text, 64, 64);
        const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
        texture.colorSpace = THREE.SRGBColorSpace;
        textures.push(texture);
        const m = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        materials.add(m);
        const o = mesh(
          geometry(new THREE.PlaneGeometry(size * 2, size * 2)),
          m,
          parent,
          x,
          y,
          z,
        );
        o.rotation.x = -Math.PI / 2;
        o.raycast = noRaycast;
        return o;
      }
      const chessLabels = new Map<string, THREE.Mesh>();
      for (const side of [1, 2])
        for (const type of ["p", "r", "n", "b", "q", "k"]) {
          // One shared texture/geometry per letter, cloned per visible piece.
          const o = label(type.toUpperCase(), 0, 0, 0, 0.025, pieces);
          if (side === 1)
            (o.material as THREE.MeshBasicMaterial).color.set(colours.ink);
          o.removeFromParent();
          chessLabels.set(`${side}${type}`, o);
        }
      function render() {
        if (disposed || !table) return;
        const state = table.state,
          legal = legalGameMoves(game, state);
        pieces.clear();
        const targets = new Set(
          legal
            .filter((m) => selected === null || m.from === selected)
            .map((m) => m.to),
        );
        cells.forEach((cell, i) => {
          const base =
            game === "connect-four"
              ? colours.green
              : game === "reversi"
                ? "#476e5a"
                : game === "tic-tac-toe"
                  ? colours.pale
                  : (Math.floor(i / width) + (i % width)) % 2
                    ? colours.dark
                    : colours.pale;
          cell.material.color.set(
            selected === i ? "#c8ad69" : targets.has(i) ? "#a6bd78" : base,
          );
        });
        const chess = game === "chess" ? chessBoard(state) : null;
        for (let i = 0; i < state.board.length; i++) {
          const value = chess ? chess[i]?.side : state.board[i];
          const x = ((i % width) - (width - 1) / 2) * CELL,
            z = (Math.floor(i / width) - (rows - 1) / 2) * CELL;
          if (!value) {
            if (game === "connect-four") {
              for (const y of [-0.02, 0.02]) {
                const hole = mesh(disk, dark, pieces, x, y, z);
                hole.raycast = noRaycast;
              }
            }
            continue;
          }
          const side = Math.abs(value),
            m =
              game === "checkers"
                ? side === 1
                  ? red
                  : pale
                : game === "connect-four"
                  ? side === 1
                    ? red
                    : gold
                  : game === "reversi"
                    ? side === 1
                      ? dark
                      : pale
                    : side === 1
                      ? pale
                      : dark;
          if (chess) {
            const type = chess[i]!.type;
            const p = mesh(chessGeometry.get(type)!, m, pieces, x, 0.015, z);
            p.raycast = noRaycast;
            const letter = chessLabels.get(`${side}${type}`)!.clone();
            letter.position.set(
              x,
              type === "p"
                ? 0.135
                : type === "k"
                  ? 0.215
                  : type === "q"
                    ? 0.195
                    : 0.175,
              z,
            );
            pieces.add(letter);
            if (type === "n") {
              const crest = mesh(bar, m, pieces, x, 0.16, z);
              crest.rotation.z = 0.45;
              crest.raycast = noRaycast;
            }
            if (type === "k") {
              const cross = mesh(bar, m, pieces, x, 0.205, z);
              cross.raycast = noRaycast;
            }
          } else if (game === "tic-tac-toe") {
            if (side === 1)
              for (const a of [-Math.PI / 4, Math.PI / 4]) {
                const p = mesh(bar, red, pieces, x, 0.02, z);
                p.rotation.y = a;
                p.raycast = noRaycast;
              }
            else {
              const p = mesh(ring, dark, pieces, x, 0.02, z);
              p.rotation.x = -Math.PI / 2;
              p.raycast = noRaycast;
            }
          } else {
            const p = mesh(disk, m, pieces, x, 0.02, z);
            p.raycast = noRaycast;
            if (game === "connect-four") {
              const back = p.clone();
              back.position.y = -0.025;
              pieces.add(back);
            }
            if (game === "checkers" && value < 0) {
              const k = mesh(cap, gold, pieces, x, 0.038, z);
              k.rotation.x = -Math.PI / 2;
              k.raycast = noRaycast;
            }
          }
        }
        const ownsTurn = mine(table.seats[state.turn - 1]);
        const status =
          state.winner === null
            ? `${gameSide(game, state.turn)} to play${game === "chess" && chessInCheck(state) ? " · Check" : ""}`
            : state.winner === 0
              ? "Draw"
              : `${gameSide(game, state.winner)} wins`;
        statusCard.set({
          title: GAME_NAMES[game],
          text: `${status}\n${notice || (pending ? "Saving…" : game === "connect-four" ? "Press a column to drop a disc." : ownsTurn ? "Choose a piece or a lit square." : "Take a seat to play. Spectators welcome.")}`,
        });
        for (const side of [1, 2] as const) {
          const owner = table.seats[side - 1];
          seatButtons[side - 1].set({
            label: `${gameSide(game, side)}: ${mine(owner) ? "Leave seat" : owner || "Take seat"}`,
            disabled: pending || Boolean(owner && !mine(owner)),
          });
        }
        const seated = table.seats.some(mine),
          requested = table.resetBy.some(mine);
        resetButton.set({
          label: requested
            ? "Cancel request"
            : table.resetBy.length
              ? "Agree to new game"
              : "New game",
          disabled: pending || !seated,
        });
        resignButton.set({
          label: resign ? "Confirm resign" : "Resign",
          disabled: pending || !seated || state.winner !== null,
        });
        promotionButton?.set({
          label: `Promote: ${{ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[promotion]}`,
        });
        helpCard.set({
          text: showHelp
            ? gameInstruction(game)
            : table.resetBy.length
              ? "A player requested a new game. Both seated players must agree."
              : "Move, scale or remove this Thing using its platform handle. Your match stays saved.",
        });
      }
      async function action(change: Record<string, unknown>) {
        if (pending || !table) return;
        pending = true;
        notice = "";
        render();
        try {
          const next = await ctx.games.action({
            ...change,
            revision: table.revision,
          });
          if (!disposed) {
            table = next;
            selected = next.state.forced;
            resign = false;
          }
        } catch (error) {
          if (!disposed)
            notice =
              error instanceof Error
                ? error.message
                : "Could not save the move.";
        } finally {
          pending = false;
          render();
        }
      }
      function choose(i: number) {
        if (
          !table ||
          pending ||
          !mine(table.seats[table.state.turn - 1]) ||
          table.state.winner !== null
        )
          return;
        const legal = legalGameMoves(game, table.state);
        if (game === "connect-four") {
          void action({ action: "move", column: i % width });
          return;
        }
        if (game === "reversi" || game === "tic-tac-toe") {
          if (legal.some((m) => m.to === i))
            void action({ action: "move", to: i });
          return;
        }
        const move = legal.find(
          (m) =>
            m.from === selected &&
            m.to === i &&
            (m.promotion === undefined || m.promotion === promotion),
        );
        if (move) {
          void action({ action: "move", ...move } as GameMove & {
            action: string;
          });
          return;
        }
        selected = legal.some((m) => m.from === i) ? i : table.state.forced;
        render();
      }
      for (let i = 0; i < width * rows; i++) {
        const m = material(colours.pale);
        const cell = mesh(
          geometry(new THREE.BoxGeometry(CELL - 0.004, 0.018, CELL - 0.004)),
          m,
          board,
          ((i % width) - (width - 1) / 2) * CELL,
          0,
          (Math.floor(i / width) - (rows - 1) / 2) * CELL,
        ) as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
        cell.name = `cell:${i}`;
        cells.push(cell);
        ctx.input.press(cell, () => choose(i));
      }
      // Host buttons have mouse/ray/pinch/poke feedback, and dispose with this instance.
      const control = (
        title: string,
        x: number,
        z: number,
        onPress: () => void,
        width = 0.64,
      ): UiButton => {
        const b = ctx.ui.button(title, { width, height: 0.105, onPress });
        b.object.position.set(x, TOP + 0.015, z);
        b.object.rotation.x = -Math.PI / 2;
        b.object.name = title;
        group.add(b.object);
        return b;
      };
      const seatButtons = ([1, 2] as const).map((side) =>
        control(
          `${gameSide(game, side)}: Take seat`,
          side === 1 ? -0.35 : 0.35,
          0.73,
          () => {
            if (table)
              void action({
                action: mine(table.seats[side - 1]) ? "leave" : "join",
                side,
              });
          },
        ),
      );
      const resetButton = control("New game", -0.35, 0.91, () => {
        if (table)
          void action({
            action: table.resetBy.some(mine) ? "cancel-reset" : "reset",
          });
      });
      const resignButton = control("Resign", 0.35, 0.91, () => {
        if (resign) void action({ action: "resign" });
        else {
          resign = true;
          render();
        }
      });
      const promotionButton =
        game === "chess"
          ? control(
              "Promote: Queen",
              0,
              -0.69,
              () => {
                promotion = ["q", "r", "b", "n"][
                  (["q", "r", "b", "n"].indexOf(promotion) + 1) % 4
                ];
                render();
              },
              0.65,
            )
          : null;
      control(
        "Rules",
        0.59,
        -0.69,
        () => {
          showHelp = !showHelp;
          render();
        },
        0.25,
      );
      const statusCard = ctx.ui.card({
        title: GAME_NAMES[game],
        text: "Connecting to the shared match…",
        width: 1.4,
        height: 0.28,
      });
      statusCard.object.position.set(
        0,
        game === "connect-four" ? 1.78 : 1.16,
        -0.87,
      );
      group.add(statusCard.object);
      const helpCard = ctx.ui.card({ text: "", width: 1.4, height: 0.2 });
      helpCard.object.position.set(
        0,
        game === "connect-four" ? 1.55 : 0.94,
        -0.87,
      );
      group.add(helpCard.object);
      if (!ctx.games?.watch) {
        statusCard.set({
          text: "This platform needs the Things game service before this table can play.",
        });
        ctx.problem("Game tables require the platform ctx.games service.");
      } else
        ctx.games.watch(
          game,
          (next) => {
            table = next;
            selected = next.state.forced;
            resign = false;
            render();
          },
          (error) => {
            notice = error.message;
            statusCard.set({ text: notice });
            ctx.problem(notice);
          },
        );
      return {
        dispose() {
          disposed = true;
          group.removeFromParent();
          for (const g of geometries) g.dispose();
          for (const m of materials) m.dispose();
          for (const t of textures) t.dispose();
        },
      };
    },
  };
}
