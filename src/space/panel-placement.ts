import { defaultPlacement } from "../../shared/panel-place";
import { ApiError } from "../api-request";
import { space } from "../space-client";
import type { Placement } from "../../shared/space-wire";

/** Where a panel is now: the server's word, or the computed arc until it speaks. */
export function placeOf(places: Placement[], id: string): Placement {
  return places.find((place) => place.id === id) ?? (defaultPlacement(id) as Placement);
}

/**
 * Tell the server where a panel went, or how big it is now.
 *
 * Returns a refusal sentence, or null.
 *
 * HERE RATHER THAN IN `Movable`, which is where it used to live, because the
 * page resizes panels too and the 3D drag is no longer the only caller. Two
 * copies of "save this, and say the right thing when it is refused" is how the
 * room and the page would end up disagreeing about what a failure means.
 */
export async function savePlacement(place: Placement): Promise<string | null> {
  try {
    await space.placePanel(place);
    return null;
  } catch (cause) {
    // The server's refusal says which rule was broken and is worth showing;
    // anything else means the change never arrived, which is a different thing
    // to tell somebody.
    return cause instanceof ApiError
      ? cause.message
      : "That change did not reach the room, so nobody else will see it.";
  }
}
