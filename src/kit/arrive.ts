/**
 * WHERE YOU ARRIVE IN A SPACE: beside whoever is already there, not inside them.
 *
 * A space puts its camera where people should start, so everyone started on
 * the same spot: the second person stood inside the first, with the first
 * one's name tag filling the view, until somebody walked away (Kerf, 2026-10-14,
 * testing kerf.light with two people). On arrival, if somebody already stands
 * within `clear` metres of the spot, you arrive a step to one side: right or
 * left of where the space faces you first, so you join a line rather than block
 * anybody's view, then further round, then a ring further out.
 */
import { arrivalSpot as sharedArrivalSpot } from "../../shared/arrival";
export type Spot = { x: number; z: number };

/**
 * THE ROOM'S RULE (shared/arrival.ts), turned to where the space faces you and
 * trying beside first: one metre from everybody, as Nikk asked for joining.
 * This had its own copy with 0.8 m and 0.9 m steps until 2026-10-22.
 */
export function arrivalSpot(spot: Spot, others: Spot[], yaw: number): Spot {
  return sharedArrivalSpot(spot, others, [], { facing: yaw, firstStep: "beside" });
}
