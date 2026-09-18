import { useEffect, useState, type RefObject } from "react";
import { hiddenAsStill } from "../../shared/stillness";
import type { WirePerson } from "../../shared/space-wire";

/**
 * Who the hide-still setting would hide from you right now, so the menus can
 * say so by name.
 *
 * A HIDDEN PERSON IS STILL IN THE ROOM. A setting that took people off the
 * screen without saying so would look exactly like a room they had left, so
 * both menus, the flat one and the headset's, name whoever it is hiding.
 *
 * READ FROM THE LIVE POSITIONS every two seconds rather than on every
 * snapshot. The answer changes when somebody crosses five minutes, not ten
 * times a second, and re-rendering a menu that often buys nothing.
 */
export function useHiddenAsStill(peopleRef: RefObject<WirePerson[]>, you: string | null): string[] {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const next = hiddenAsStill(peopleRef.current ?? [], you);
      setHidden((previous) => (previous.join("\n") === next.join("\n") ? previous : next));
    };
    read();
    const timer = window.setInterval(read, 2_000);
    return () => window.clearInterval(timer);
  }, [peopleRef, you]);
  return hidden;
}
