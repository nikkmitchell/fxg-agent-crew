/** Bundle space-ready Things; copy dist-things/ into a space's git after review. */
import { build } from "vite";
import { copyFileSync, writeFileSync } from "node:fs";
import { TABLE_GAMES, GAME_NAMES } from "../shared/table-games.ts";
await build({ configFile: "vite.games.config.ts" });
for (const game of TABLE_GAMES)
  writeFileSync(
    `dist-things/${game}.js`,
    `import { defineItem } from "saha";\nimport { tableGameDefinition } from "./tabletop.js";\nexport default defineItem(tableGameDefinition(${JSON.stringify(game)}));\n`,
  );
writeFileSync(
  "dist-things/games-room.js",
  `import { defineSpace } from "saha";\nexport default defineSpace({name:"Games room",size:[9,2,7],things:${JSON.stringify(Object.fromEntries(TABLE_GAMES.map((g, i) => [g, { ref: g, at: [((i % 3) - 1) * 2.4, 0, -Math.floor(i / 3) * 2.6] }])))}});\n`,
);
writeFileSync(
  "dist-things/saha-pieces.json",
  JSON.stringify(
    {
      pieces: [
        ...TABLE_GAMES.map((game) => ({
          id: game,
          name: GAME_NAMES[game],
          item: `${game}.js`,
        })),
        { id: "games-room", name: "Games room", space: "games-room.js" },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(
  "dist-things/index.html",
  "<!doctype html><meta charset=utf-8><title>Shared tabletop games</title><h1>Shared tabletop games</h1><p>In a saha.ing room, open Settings → Library to bring in a game table, or compose the Games room into your own space.</p><p>Chess · Checkers · Connect Four · Reversi · Tic-tac-toe</p>",
);
copyFileSync("docs/THIRD-PARTY-GAMES.txt", "dist-things/THIRD-PARTY-GAMES.txt");
