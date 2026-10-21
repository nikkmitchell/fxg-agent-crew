import * as THREE from "three";
import { bambooPixels } from "../space/go-textures";
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

const CELL = 0.125,
  TOP = 0.79;
const colours = {
  wood: "#805533",
  pale: "#d9ceb3",
  dark: "#73543d",
  green: "#254e43",
  red: "#cd6958",
  gold: "#edc46c",
  ink: "#20352e",
};
const noRaycast = () => {};

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
      const textures: THREE.Texture[] = [];
      // Share Go's deterministic, low-contrast grain instead of a flat brown slab.
      const grain = new THREE.DataTexture(bambooPixels(256, "#b78f57"), 256, 256);
      grain.colorSpace = THREE.SRGBColorSpace;
      grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
      grain.repeat.set(3, 3);
      grain.needsUpdate = true;
      textures.push(grain);
      const wood = material(colours.wood),
        pale = material(colours.pale),
        dark = material(colours.ink),
        red = material(colours.red),
        gold = material(colours.gold);
      wood.map = grain;
      wood.roughness = 0.62;
      pale.roughness = 0.28;
      dark.roughness = 0.32;
      const brass = material("#bc9658");
      brass.metalness = 0.65;
      brass.roughness = 0.32;
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
        o.castShadow = true;
        o.receiveShadow = true;
        parent.add(o);
        return o;
      };
      mesh(
        geometry(new THREE.BoxGeometry(1.58, 0.09, 1.94)),
        wood,
        group,
        0,
        TOP - 0.055,
        0.12,
      );
      // A substantial apron and tapered legs give the board the weight of furniture.
      mesh(geometry(new THREE.BoxGeometry(1.4, 0.14, 1.7)), wood, group, 0, TOP - 0.16, 0.12);
      const leg = geometry(new THREE.CylinderGeometry(0.045, 0.028, 0.66, 16));
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
      const boardWidth = width * CELL, boardDepth = rows * CELL;
      mesh(geometry(new THREE.BoxGeometry(boardWidth + 0.1, 0.035, boardDepth + 0.1)), wood, board, 0, -0.025, 0);
      const trimLong = geometry(new THREE.BoxGeometry(boardWidth + 0.11, 0.006, 0.006));
      const trimShort = geometry(new THREE.BoxGeometry(0.006, 0.006, boardDepth + 0.11));
      for (const z of [-1, 1]) mesh(trimLong, brass, board, 0, 0.001, z * (boardDepth / 2 + 0.045));
      for (const x of [-1, 1]) mesh(trimShort, brass, board, x * (boardWidth / 2 + 0.045), 0.001, 0);
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
      // Turned bases, with distinct silhouettes above them. No letter labels needed.
      for (const type of ["p", "r", "n", "b", "q", "k"]) {
        const h = type === "p" ? 0.065 : type === "k" ? 0.13 : type === "q" ? 0.115 : 0.095;
        chessGeometry.set(type, geometry(new THREE.LatheGeometry([
          [0,0], [0.041,0], [0.043,0.007], [0.04,0.014],
          [0.032,0.019], [0.034,0.026], [0.025,0.033],
          [0.016,h-0.025], [0.025,h-0.012], [0.025,h], [0,h],
        ].map(([x,y]) => new THREE.Vector2(x,y)), 28)));
      }
      const sphere = geometry(new THREE.SphereGeometry(0.026, 20, 14));
      const crown = geometry(new THREE.CylinderGeometry(0.034, 0.024, 0.025, 20));
      const geometryForBishop = geometry(new THREE.BoxGeometry(0.004, 0.032, 0.042));
      const crownPearl = geometry(new THREE.SphereGeometry(0.008, 10, 8));
      const tooth = geometry(new THREE.BoxGeometry(0.016, 0.022, 0.016));
      const crossStem = geometry(new THREE.BoxGeometry(0.012, 0.05, 0.012));
      const crossArm = geometry(new THREE.BoxGeometry(0.038, 0.012, 0.012));
      const horse = new THREE.Shape();
      horse.moveTo(-0.028, 0); horse.lineTo(0.025, 0);
      horse.lineTo(0.019, 0.03); horse.lineTo(0.037, 0.052);
      horse.lineTo(0.034, 0.069); horse.lineTo(0.015, 0.083);
      horse.lineTo(0.009, 0.099); horse.lineTo(-0.002, 0.087);
      horse.lineTo(-0.018, 0.081); horse.lineTo(-0.029, 0.05);
      horse.closePath();
      const knightHead = geometry(new THREE.ExtrudeGeometry(horse, {
        depth: 0.027, bevelEnabled: true, bevelThickness: 0.003,
        bevelSize: 0.003, bevelSegments: 2, steps: 1,
      }));
      const disk = geometry(new THREE.LatheGeometry([
        [0,0], [0.038,0], [0.046,0.004], [0.048,0.011],
        [0.046,0.019], [0.038,0.023], [0,0.023],
      ].map(([x,y]) => new THREE.Vector2(x,y)), 32));
      const cap = geometry(new THREE.TorusGeometry(0.025, 0.006, 6, 20));
      const bar = geometry(new THREE.BoxGeometry(0.095, 0.014, 0.02));
      const ring = geometry(new THREE.TorusGeometry(0.037, 0.01, 8, 24));
      // Labels use the host's canvas service; no document, global listener or private renderer.
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
      if (game === "chess" || game === "checkers")
        for (let i = 0; i < 8; i++) {
          label(String.fromCharCode(97 + i), (i - 3.5) * CELL, TOP + 0.005, 0.56, 0.018);
          label(String(8 - i), -0.56, TOP + 0.005, (i - 3.5) * CELL, 0.018);
        }
      const markerGeometry = geometry(new THREE.RingGeometry(0.017, 0.025, 24));
      const markerMaterial = material("#bb8e45");
      markerMaterial.side = THREE.DoubleSide;
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
            selected === i ? "#c8ad69" : base,
          );
        });
        // Quiet inlaid rings preserve the board's colours and make destinations legible.
        if (mine(table.seats[state.turn - 1]) && state.winner === null &&
            (selected !== null || game === "reversi" || game === "tic-tac-toe"))
          for (const i of targets) {
            const mark = mesh(markerGeometry, markerMaterial, pieces,
              ((i % width) - (width - 1) / 2) * CELL, 0.015,
              (Math.floor(i / width) - (rows - 1) / 2) * CELL);
            mark.rotation.x = -Math.PI / 2;
            mark.raycast = noRaycast;
          }
        const chess = game === "chess" ? chessBoard(state) : null;
        for (let i = 0; i < state.board.length; i++) {
          const value = chess ? chess[i]?.side : state.board[i];
          const x = ((i % width) - (width - 1) / 2) * CELL,
            z = (Math.floor(i / width) - (rows - 1) / 2) * CELL;
          if (!value) continue;
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
            const h = type === "p" ? 0.08 : type === "k" ? 0.145 : type === "q" ? 0.13 : 0.11;
            const detail = (g: THREE.BufferGeometry, dx: number, dy: number, dz: number) => {
              const o = mesh(g, m, pieces, x + dx, dy, z + dz);
              o.raycast = noRaycast;
              return o;
            };
            if (type === "p") detail(sphere, 0, h + 0.018, 0);
            if (type === "b") {
              const head = detail(sphere, 0, h + 0.023, 0);
              head.scale.set(0.8, 1.35, 0.8);
              const slit = mesh(geometryForBishop, dark, pieces, x, h + 0.025, z);
              slit.rotation.z = -0.4;
              slit.raycast = noRaycast;
            }
            if (type === "n") {
              const head = detail(knightHead, 0, h - 0.008, -0.0135);
              head.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
            }
            if (type === "r" || type === "q") {
              detail(crown, 0, h + 0.012, 0);
              for (let t = 0; t < (type === "r" ? 4 : 6); t++) {
                const angle = t * Math.PI * 2 / (type === "r" ? 4 : 6);
                detail(type === "r" ? tooth : crownPearl,
                  Math.cos(angle) * 0.026, h + 0.033, Math.sin(angle) * 0.026);
              }
            }
            if (type === "k") {
              detail(sphere, 0, h + 0.014, 0).scale.set(0.8, 0.65, 0.8);
              detail(crossStem, 0, h + 0.045, 0);
              detail(crossArm, 0, h + 0.052, 0);
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
              p.position.y = -0.012;
              p.scale.y = 2;
            }
            // A raised rim reads as a physical draught rather than a flat marker.
            if (game === "checkers" || game === "connect-four") {
              const rim = mesh(cap, m, pieces, x, game === "checkers" ? 0.045 : 0.04, z);
              rim.rotation.x = -Math.PI / 2;
              rim.raycast = noRaycast;
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
          text: `${status}\n${notice || (pending ? "Saving…" : game === "connect-four" ? "Press a column to drop a disc." : ownsTurn ? "Choose a piece, then a marked destination." : "Take a seat to play. Spectators welcome.")}`,
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
              : "Your match is saved automatically.",
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
      if (game === "connect-four") {
        // Real apertures: the room and opposite player remain visible through empty slots.
        const face = new THREE.Shape();
        const w = width * CELL / 2 + 0.025, h = rows * CELL / 2 + 0.025;
        face.moveTo(-w,-h); face.lineTo(w,-h); face.lineTo(w,h); face.lineTo(-w,h); face.closePath();
        for (let i = 0; i < width * rows; i++) {
          const hole = new THREE.Path();
          hole.absarc(((i % width) - 3) * CELL, (Math.floor(i / width) - 2.5) * CELL, 0.051, 0, Math.PI * 2, true);
          face.holes.push(hole);
        }
        const frame = mesh(geometry(new THREE.ExtrudeGeometry(face, {
          depth: 0.035, bevelEnabled: true, bevelThickness: 0.003,
          bevelSize: 0.003, bevelSegments: 2, curveSegments: 20,
        })), material(colours.green), board, 0, 0.0175, 0);
        frame.rotation.x = Math.PI / 2;
        frame.raycast = noRaycast;
        // Remove the solid backing from the framed upright board.
        board.children.filter(o => o instanceof THREE.Mesh && o.geometry.type === "BoxGeometry")
          .forEach(o => o.visible = false);
        for (const x of [-0.51, 0.51]) {
          mesh(geometry(new THREE.BoxGeometry(0.055, 0.57, 0.055)), wood, group, x, 1.06, -0.22);
          mesh(geometry(new THREE.BoxGeometry(0.13, 0.04, 0.34)), wood, group, x, TOP + 0.025, -0.22);
        }
      }
      for (let i = 0; i < width * rows; i++) {
        const m = material(colours.pale);
        const cell = mesh(
          geometry(new THREE.BoxGeometry(CELL - 0.0008, 0.018, CELL - 0.0008)),
          m,
          board,
          ((i % width) - (width - 1) / 2) * CELL,
          0,
          (Math.floor(i / width) - (rows - 1) / 2) * CELL,
        ) as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
        cell.name = `cell:${i}`;
        if (game === "connect-four") {
          cell.material.transparent = true;
          cell.material.opacity = 0;
          cell.material.depthWrite = false;
        }
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
