import { useRef, useState, type RefObject } from "react";
import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { helperSummary, type Helper } from "../../shared/helpers";
import type { WirePerson } from "../../shared/space-wire";

/**
 * Spirit companions: an agent's helpers, drawn as small wisps round it.
 *
 * Nikk's proposal (saha-ing-737ee1ae). A CUE, NOT A PERSON: nothing here is in
 * presence or any count of who is here, the wisps have no faces and stay above
 * the agent's head and clear of its work, and they exist only while the agent
 * itself reports helpers (shared/helpers.ts). Point at them to read how many
 * and who.
 */

const HEAD = 1.75;
const ORBIT = 0.32;
const noRaycast = () => undefined;

export function SpiritCompanions({ helpers, peopleRef, reducedMotion }: {
  helpers: Record<string, Helper[]>;
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  return (
    <>
      {Object.entries(helpers).map(([actorId, list]) => (
        <Wisps key={actorId} actorId={actorId} helpers={list} peopleRef={peopleRef} reducedMotion={reducedMotion} />
      ))}
    </>
  );
}

function Wisps({ actorId, helpers, peopleRef, reducedMotion }: {
  actorId: string;
  helpers: Helper[];
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  const { invalidate } = useThree();
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);

  useFrame(({ clock }) => {
    const node = group.current;
    const person = peopleRef.current?.find((one) => one.actorId === actorId);
    if (!node) return;
    node.visible = Boolean(person);
    if (!person) return;
    node.position.set(person.at.x, (person.at.y ?? 0) + HEAD, person.at.z);
    // Slow, and only when motion is welcome; otherwise they hold still.
    if (!reducedMotion) {
      node.rotation.y = clock.elapsedTime * 0.5;
      invalidate();
    }
  });

  return (
    <group ref={group}>
      {helpers.map((helper, index) => {
        const angle = (index / helpers.length) * Math.PI * 2;
        const bob = reducedMotion ? 0 : 0.03 * Math.sin(index * 1.7);
        const working = helper.state === "working";
        return (
          <mesh
            key={`${helper.label}-${index}`}
            position={[Math.cos(angle) * ORBIT, 0.12 + bob, Math.sin(angle) * ORBIT]}
            onPointerOver={(event) => { event.stopPropagation(); setHover(true); }}
            onPointerOut={() => setHover(false)}
          >
            <sphereGeometry args={[0.045, 16, 12]} />
            <meshBasicMaterial
              color={working ? "#bdeeff" : "#d4afff"}
              transparent
              opacity={working ? 0.55 : 0.18}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      {hover ? (
        <Text position={[0, 0.34, 0]} fontSize={0.05} color="#eaf6ff" outlineWidth={0.004} outlineColor="#0b1418" raycast={noRaycast}
          anchorX="center" maxWidth={1.2}>
          {helperSummary(helpers)}
        </Text>
      ) : null}
    </group>
  );
}
