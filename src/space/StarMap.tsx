import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { applyStarEvent, emptySky, stars, type StarSky } from "../../shared/stars";
import { onStarChange } from "./star-events";
import { space } from "../space-client";

/**
 * THE STAR MAP (shared/stars.ts): faint stars high over the room that
 * twinkle slowly. Point at one star and pinch, then at another: a thin line of
 * light joins them, for everyone, and stays. Do it again to take a line away.
 * Over days the room's sky fills with the shapes people made in it.
 */

const SKY_STARS = stars();

export function starMotionTime(seconds: number, reducedMotion = false): number {
  return reducedMotion ? 0 : seconds;
}

export function StarMap({ reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  const [sky, setSky] = useState<StarSky>(emptySky);
  const current = useRef(sky);
  current.current = sky;
  const [chosen, setChosen] = useState<number | null>(null);
  const instanced = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.Mesh>(null);

  const read = useCallback(() => {
    space.stars().then((answer) => {
      current.current = answer.sky;
      setSky(answer.sky);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onStarChange((event) => {
        const next = applyStarEvent(current.current, event);
        if (next) {
          current.current = next;
          setSky(next);
        } else read();
      }),
    [read],
  );

  // The stars as one instanced mesh: pointable, each its own size.
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const twinkle = useMemo(() => SKY_STARS.map(() => Math.random() * 10), []);
  useFrame((state) => {
    const mesh = instanced.current;
    if (!mesh) return;
    const t = starMotionTime(state.clock.elapsedTime, reducedMotion);
    SKY_STARS.forEach((star, index) => {
      const s = star.size * (0.85 + Math.sin(t * 1.3 + twinkle[index]) * 0.15);
      matrix.makeScale(s, s, s).setPosition(star.x, star.y, star.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (halo.current) {
      halo.current.visible = chosen !== null;
      if (chosen !== null) {
        const star = SKY_STARS[chosen];
        halo.current.position.set(star.x, star.y, star.z);
        halo.current.scale.setScalar(0.18 + Math.sin(t * 4) * 0.03);
        halo.current.lookAt(state.camera.position);
      }
    }
  });

  const lines = useMemo(() => {
    const positions = new Float32Array(sky.links.length * 6);
    sky.links.forEach((link, index) => {
      const a = SKY_STARS[link.a];
      const b = SKY_STARS[link.b];
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], index * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [sky]);
  useEffect(() => () => lines.dispose(), [lines]);

  const onStar = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const index = event.instanceId;
    if (index === undefined) return;
    if (chosen === null || chosen === index) {
      setChosen(chosen === index ? null : index);
      return;
    }
    setChosen(null);
    space.joinStars(chosen, index).catch(() => read());
  };

  return (
    <group>
      <instancedMesh ref={instanced} args={[undefined, undefined, SKY_STARS.length]} onClick={onStar} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#fff6e0" toneMapped={false} />
      </instancedMesh>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial color="#9fc7ff" transparent opacity={0.55} toneMapped={false} />
      </lineSegments>
      {/* The star you have chosen, waiting for its partner. */}
      <mesh ref={halo} visible={false} raycast={() => null}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshBasicMaterial color="#9fc7ff" transparent opacity={0.8} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
