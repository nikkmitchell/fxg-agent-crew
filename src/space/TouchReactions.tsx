import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ServerMessage, WirePerson } from "../../shared/space-wire";
import { signFor, type Touch } from "../../shared/touch";
import { makeLabelTexture } from "./label-texture";

const SHOW_MS = 2_500;
const COLOURS = { likes: "#ff5c8a", dislikes: "#ff9b3d", neutral: "#e8e6df" } as const;

/**
 * A sign above an agent that was just touched: ♥ if it liked it, ✕ if it did
 * not, a small smile if it did not mind. See shared/touch.ts. The agent's face
 * and gesture carry the reaction too; this is so the person knows at a glance
 * that the touch landed and how it was taken.
 */
export function TouchReactions({
  subscribe,
  peopleRef,
}: {
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  peopleRef: RefObject<WirePerson[]>;
}) {
  const [shown, setShown] = useState<{ touch: Touch; until: number }[]>([]);

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== "touched") return;
        const until = Date.now() + SHOW_MS;
        setShown((previous) => [
          ...previous.filter((entry) => entry.touch.agentId !== message.touch.agentId && entry.until > Date.now()),
          { touch: message.touch, until },
        ]);
        window.setTimeout(() => setShown((previous) => previous.filter((entry) => entry.until > Date.now())), SHOW_MS + 50);
      }),
    [subscribe],
  );

  return (
    <group>
      {shown.map((entry) => (
        <Sign key={entry.touch.id} touch={entry.touch} peopleRef={peopleRef} />
      ))}
    </group>
  );
}

function Sign({ touch, peopleRef }: { touch: Touch; peopleRef: RefObject<WirePerson[]> }) {
  const sprite = useRef<THREE.Sprite>(null);
  const born = useRef(performance.now());
  const texture = useMemo(
    () => makeLabelTexture(signFor(touch.feeling), { pixelsPerLine: 96, lines: 1, aspect: 2, color: COLOURS[touch.feeling] }),
    [touch.feeling],
  );
  useEffect(() => () => texture?.dispose(), [texture]);

  useFrame(() => {
    const node = sprite.current;
    if (!node) return;
    const agent = (peopleRef.current ?? []).find((person) => person.actorId === touch.agentId);
    if (!agent) {
      node.visible = false;
      return;
    }
    const age = (performance.now() - born.current) / SHOW_MS;
    node.visible = true;
    // Rises a little and fades as it goes.
    node.position.set(agent.at.x, 1.05 + age * 0.25, agent.at.z);
    (node.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - age * age);
  });

  if (!texture) return null;
  return (
    <sprite ref={sprite} scale={[0.56, 0.28, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}
