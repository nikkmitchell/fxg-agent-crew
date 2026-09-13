import { useEffect, useState } from "react";
import { allGrips, grabWith, subscribeGrips, type GripPlace } from "./grip-positions";

/**
 * The grab handles, drawn outside the canvas.
 *
 * Rendered by the page rather than the scene — see `grip-positions.ts` for why
 * neither drei's `<Html>` nor a portal could do this. The scene works out where
 * each handle belongs; this puts a button there.
 *
 * Nothing at all in a headset: a session shows no DOM, and the handle there is
 * a 3D bar you can point a ray at.
 */
export function PanelGrips({ shown }: { shown: boolean }) {
  const [grips, setGrips] = useState<GripPlace[]>([]);

  useEffect(() => {
    const read = () => setGrips(allGrips());
    read();
    return subscribeGrips(read);
  }, []);

  if (!shown) return null;

  return (
    <>
      {grips
        .filter((grip) => grip.shown)
        .map((grip) => (
          <button
            key={grip.id}
            type="button"
            className="panel-grip"
            style={{ left: `${grip.x}px`, top: `${grip.y}px` }}
            aria-label={`Move the ${grip.id} panel`}
            onPointerDown={(event) => {
              event.preventDefault();
              grabWith(grip.id, event.clientX, event.clientY);
            }}
          >
            ⠿
          </button>
        ))}
    </>
  );
}
