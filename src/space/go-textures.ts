/**
 * The Go board's grain, as pixels. Card saha-ing-67276601 (Baiwei, Nikk):
 * "give bamboo a subtly richer, natural grain and stone a restrained
 * mineral/carved texture ... scale-aware ... so grain size and contrast stay
 * consistent on small and large boards; avoid high-frequency noise".
 *
 * SCALE-AWARE BY TILING. The old canvas was stretched once across the whole
 * board, so a 25x25 board had grain five times coarser than a 5x5. These tiles
 * repeat at a fixed size in metres (GO_TILE_METRES), so a centimetre of bamboo
 * is a centimetre of bamboo on every board.
 *
 * SEAMLESS BY CONSTRUCTION. Every term is periodic in the tile: noise on a
 * wrapping lattice, sines with a whole number of cycles, strips that divide
 * the width. Nothing is drawn and then patched at the edge.
 *
 * PURE: numbers in, bytes out, the same bytes for every person at the table.
 * go-textures.test.ts checks the seams, the average colour and that nothing
 * flickers at the pixel level.
 */

/** How much board one tile covers, in metres. */
export const GO_TILE_METRES = 0.5;

/** How many times a tile repeats across a surface `width` metres wide. */
export const goTextureRepeat = (width: number) => width / GO_TILE_METRES;

const hash = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (n: number, period: number) => ((n % period) + period) % period;

/**
 * Value noise on a lattice of `cellsX` by `cellsY` cells that wraps, so it is
 * periodic across the tile. u and v are 0..1 across the tile. Returns 0..1.
 */
function periodicNoise(u: number, v: number, cellsX: number, cellsY: number, seed: number): number {
  const x = u * cellsX, y = v * cellsY;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const at = (i: number, j: number) => hash(wrap(i, cellsX), wrap(j, cellsY), seed);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** A few octaves of periodicNoise, summed and normalised to 0..1. */
function periodicFbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0, weight = 0, amplitude = 1;
  for (let o = 0; o < octaves; o++) {
    const c = cells * 2 ** o;
    sum += periodicNoise(u, v, c, c, seed + o * 101) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
  }
  return sum / weight;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Laminated bamboo, as a board is actually made: strips a few centimetres wide
 * glued side by side, each its own slightly different honey tone, with long
 * fine fibres running along it and, now and then, the faint band of a node.
 * Warm, calm, low contrast; the grid lines stay the loudest thing on it.
 */
export function bambooPixels(size = 512, base = "#d9ad6f"): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const [r0, g0, b0] = rgb(base);
  const strips = 16; // ~3 cm each at GO_TILE_METRES
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const strip = Math.floor(u * strips), within = u * strips - strip;
    const tone = (hash(strip, 0, 7) - 0.5) * 0.09;
    // Fibres: many fine lines along the strip, gently wandering.
    const wander = periodicNoise(u, v, 16, 4, 11) * 0.9;
    const fibre = Math.sin(2 * Math.PI * (u * 48 + wander)) * 0.5 + 0.5;
    const fibreSoft = periodicNoise(u, v, 64, 6, 13);
    // A node: one soft band per strip, at its own height.
    const nodeAt = hash(strip, 1, 17), dv = Math.min(Math.abs(v - nodeAt), 1 - Math.abs(v - nodeAt));
    const node = Math.exp(-(((dv * size) / 5) ** 2));
    // The glue line between strips: a whisper darker, never a stripe.
    const seam = Math.exp(-(((Math.min(within, 1 - within) * size) / strips / 0.9) ** 2));
    const shade = 1 + tone + (fibre - 0.5) * 0.035 + (fibreSoft - 0.5) * 0.05 - node * 0.07 - seam * 0.08;
    const at = (y * size + x) * 4;
    out[at] = r0 * shade; out[at + 1] = g0 * shade; out[at + 2] = b0 * (shade - node * 0.03); out[at + 3] = 255;
  }
  return out;
}

/**
 * Carved stone: a slab of mid-grey with broad, soft mottling, a fine but
 * never pixel-sharp grain, and a few pale mineral veins. Nothing brighter or
 * darker than a grid line, so the lines and both colours of stone still read.
 */
export function stonePixels(size = 512, base = "#626668"): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const [r0, g0, b0] = rgb(base);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const mottle = periodicFbm(u, v, 3, 3, 31) - 0.5;
    const grain = periodicFbm(u, v, 48, 2, 37) - 0.5;
    // Veins: the thin places where a warped noise crosses its middle.
    const warp = periodicFbm(u, v, 2, 3, 41);
    const vein = Math.exp(-(((periodicNoise(u + warp * 0.35, v, 5, 5, 43) - 0.5) / 0.012) ** 2));
    const shade = 1 + mottle * 0.16 + grain * 0.07 + vein * 0.1;
    const at = (y * size + x) * 4;
    out[at] = r0 * shade; out[at + 1] = g0 * shade; out[at + 2] = (b0 + 2) * shade; out[at + 3] = 255;
  }
  return out;
}
