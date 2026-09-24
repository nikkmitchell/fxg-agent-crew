import { describe, expect, it } from "vitest";
import { GO_SIZES } from "./room-items.js";
import { GO_RIM_REACH, goBoardWidth, goBowl, goBowlScale, goDeckWidth, goLabelOffset, goRingCapacity, goRingSlots, goRingSpot } from "./go-layout.js";

/**
 * The capture ring (card saha-ing-aad334f9): captured stones as beads round
 * the outside of their bowl, for every board size and two to eight players.
 * The rules below are the ones Baiwei gave: next to the bowl, never on the
 * board, never on another bowl or its stones, never under the name or PASS.
 */
/** A captured stone's radius, scaled with its bowl like the stones in the bowl are. */
const stoneAt = (size: number) => 0.032 * goBowlScale(size);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("the capture ring", () => {
  it("holds enough stones to read at a glance, in two rows, at every bowl", () => {
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
      const where = `${size}x${size}, ${count} players, bowl ${i}`;
      expect(goRingCapacity(i, count, size, 1), where).toBeGreaterThan(goRingCapacity(i, count, size, 0));
      // The tightest diagonal bowl (5+ players) keeps clear of the rim's whole
      // reach, GO_RIM_REACH, where the scholar's rock grows: 9 still reads at a
      // glance, and the count under the name is always the whole number.
      expect(goRingSlots(i, count, size), where).toBeGreaterThanOrEqual(9);
      // Two players, the usual game, get the whole ring.
      if (count === 2) expect(goRingSlots(i, count, size), where).toBeGreaterThanOrEqual(20);
    }
  });

  it("keeps every captured stone next to its own bowl and off everything else", () => {
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) {
      const STONE = stoneAt(size);
      const half = goDeckWidth(size, count) / 2;
      const all: { x: number; z: number; owner: number }[] = [];
      for (let i = 0; i < count; i++) for (let n = 0; n < goRingSlots(i, count, size); n++) all.push({ ...goRingSpot(i, count, size, n), owner: i });
      for (const spot of all) {
        const where = `${size}x${size}, ${count} players, bowl ${spot.owner}`;
        expect(Math.max(Math.abs(spot.x), Math.abs(spot.z)) + STONE, `${where}: on the deck`).toBeLessThan(half);
        expect(Math.max(Math.abs(spot.x), Math.abs(spot.z)) - STONE, `${where}: off the board and the rim`).toBeGreaterThan(goBoardWidth(size) / 2 + GO_RIM_REACH);
        for (let j = 0; j < count; j++) {
          const bowl = goBowl(j, count, size);
          expect(dist(spot, bowl) - STONE - 0.18 * goBowlScale(size), `${where}: clear of bowl ${j}`).toBeGreaterThan(0.015);
        }
      }
      for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
        expect(dist(all[a], all[b]), `${size}x${size}, ${count} players: stones ${a} and ${b} overlap`).toBeGreaterThan(2 * STONE - 0.001);
      }
    }
  });

  it("leaves the bowl's name and PASS clear", () => {
    // Their footprints, bowl-local, as RoomItems draws them: the name is up to
    // two lines ("WHITE · TO PLAY" / "12 CAPTURED"); PASS is 0.34 × 0.1.
    const footprints = [{ at: 0.24, halfX: 0.2, halfZ: 0.06 }, { at: 0.35, halfX: 0.17, halfZ: 0.05 }];
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
      const bowl = goBowl(i, count, size), scale = goBowlScale(size), STONE = stoneAt(size);
      for (const box of footprints) {
        const offset = goLabelOffset(i, count, box.at);
        for (let n = 0; n < goRingSlots(i, count, size); n++) {
          const spot = goRingSpot(i, count, size, n);
          const dx = Math.max(0, Math.abs(spot.x - (bowl.x + offset.x * scale)) - box.halfX * scale);
          const dz = Math.max(0, Math.abs(spot.z - (bowl.z + offset.z * scale)) - box.halfZ * scale);
          expect(Math.hypot(dx, dz), `${size}x${size}/${count} bowl ${i} stone ${n} under the label at ${box.at}`).toBeGreaterThan(STONE);
        }
      }
    }
  });
});
