import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { PAPERS, PER_STRING, THOUSAND, applyCraneEvent, craneAt, noCranes, type Cranes } from "../../shared/cranes";
import { onCranesChange } from "./crane-events";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * A THOUSAND PAPER CRANES (shared/cranes.ts): a low folding table with squares
 * of coloured paper. Tap a paper, then "fold a crane", and a crane in that
 * paper joins the strings hanging overhead, for everyone, and stays. Every
 * crane is ONE instanced mesh and every string one line set: a thousand cranes
 * cost two draws.
 */

export const CRANES_AT = { x: -2.2, z: 3.0 } as const;
const TABLE = 0.42;

/** A folded crane in one small geometry: a body ridge, two wings, neck and tail. */
function craneGeometry(): THREE.BufferGeometry {
  const s = 0.035;
  // prettier-ignore
  const v = [
    // left wing, right wing (raised a little)
    0, 0, -0.5,  -1.1, 0.35, 0.05,  0, 0, 0.5,
    0, 0, -0.5,  0, 0, 0.5,  1.1, 0.35, 0.05,
    // the body's keel, below
    0, 0, -0.5,  0, -0.35, 0,  0, 0, 0.5,
    // neck and head, rising forward; tail rising back
    0, 0, 0.3,  0, 0.75, 1.0,  0, -0.15, 0.4,
    0, 0, -0.3,  0, 0.7, -1.0,  0, -0.15, -0.4,
  ].map((n) => n * s);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function PaperCranes() {
  const [state, setState] = useState<Cranes>(noCranes);
  const current = useRef(state);
  current.current = state;
  const [paper, setPaper] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const cranes = useRef<THREE.InstancedMesh>(null);
  const overhead = useRef<THREE.Group>(null);
  const geometry = useMemo(craneGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const read = useCallback(() => {
    space.cranes().then((answer) => {
      current.current = answer.cranes;
      setState(answer.cranes);
    }).catch(() => {});
  }, []);
  useEffect(read, [read]);
  useEffect(
    () =>
      onCranesChange((event) => {
        const next = applyCraneEvent(current.current, event);
        if (next) {
          current.current = next;
          setState(next);
        } else read();
      }),
    [read],
  );

  // Place the cranes whenever the set changes; they sway together, not one by one.
  useEffect(() => {
    const node = cranes.current;
    if (!node) return;
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const colour = new THREE.Color();
    state.cranes.forEach((crane, index) => {
      const at = craneAt(index);
      turn.setFromEuler(new THREE.Euler(0, at.turn, 0));
      matrix.compose(new THREE.Vector3(at.x, at.y, at.z), turn, new THREE.Vector3(1, 1, 1));
      node.setMatrixAt(index, matrix);
      node.setColorAt(index, colour.set(PAPERS[crane.paper] ?? PAPERS[0]));
    });
    node.count = state.cranes.length;
    node.instanceMatrix.needsUpdate = true;
    if (node.instanceColor) node.instanceColor.needsUpdate = true;
    node.computeBoundingSphere();
  }, [state]);

  // The strings: one line from the ceiling down past the lowest crane on each string in use.
  const strings = useMemo(() => {
    const points: number[] = [];
    const used = Math.ceil(state.cranes.length / PER_STRING);
    for (let s = 0; s < used; s += 1) {
      const top = craneAt(s * PER_STRING);
      const last = craneAt(Math.min(state.cranes.length - 1, s * PER_STRING + PER_STRING - 1));
      points.push(top.x, 3.3, top.z, top.x, last.y - 0.02, top.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, [state]);
  useEffect(() => () => strings.dispose(), [strings]);

  useFrame((frame) => {
    if (overhead.current) overhead.current.rotation.y = Math.sin(frame.clock.elapsedTime * 0.15) * 0.04;
  });

  const complete = state.cranes.length >= THOUSAND;
  const fold = () => {
    setNote(null);
    space.changeCranes(complete ? { action: "release" } : { action: "fold", paper }).catch((error: unknown) => setNote(error instanceof Error ? error.message : "The paper tore; try again."));
  };
  const facing = Math.atan2(ROOM.spawn.x - CRANES_AT.x, ROOM.spawn.z - CRANES_AT.z);

  return (
    <group position={[CRANES_AT.x, 0, CRANES_AT.z]}>
      <group ref={overhead}>
        <instancedMesh ref={cranes} args={[geometry, undefined, THOUSAND]} raycast={() => null}>
          <meshStandardMaterial side={THREE.DoubleSide} roughness={0.85} emissive={complete ? "#ffe9b0" : "#000000"} emissiveIntensity={complete ? 0.25 : 0} />
        </instancedMesh>
        <lineSegments geometry={strings} raycast={() => null}>
          <lineBasicMaterial color="#d8cfbf" transparent opacity={0.35} />
        </lineSegments>
      </group>
      {/* The low folding table, with its squares of paper. */}
      <group rotation-y={facing}>
        <mesh position={[0, TABLE / 2, 0]} raycast={() => null}>
          <boxGeometry args={[0.5, TABLE, 0.34]} />
          <meshStandardMaterial color="#6b4f37" roughness={0.8} />
        </mesh>
        {/* The eight papers, one draw; the chosen one lifts a little. */}
        <instancedMesh
          args={[undefined, undefined, PAPERS.length]}
          ref={(node) => {
            if (!node) return;
            const matrix = new THREE.Matrix4();
            PAPERS.forEach((colour, index) => {
              matrix.compose(
                new THREE.Vector3(((index % 4) - 1.5) * 0.1, TABLE + (index === paper ? 0.012 : 0.003), index < 4 ? -0.06 : 0.05),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.2 * ((index % 3) - 1))),
                new THREE.Vector3(1, 1, 1),
              );
              node.setMatrixAt(index, matrix);
              node.setColorAt(index, new THREE.Color(colour));
            });
            node.instanceMatrix.needsUpdate = true;
            if (node.instanceColor) node.instanceColor.needsUpdate = true;
            node.computeBoundingSphere();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.instanceId !== undefined) setPaper(event.instanceId);
          }}
        >
          <planeGeometry args={[0.07, 0.07]} />
          <meshStandardMaterial roughness={0.9} side={THREE.DoubleSide} />
        </instancedMesh>
        <Text
          position={[0, TABLE + 0.2, 0.12]}
          fontSize={0.045}
          color={complete ? "#ffe9b0" : "#e8e0cf"}
          outlineWidth={0.003}
          outlineColor="#1a1714"
          onClick={(event) => {
            event.stopPropagation();
            fold();
          }}
        >
          {complete ? "a thousand cranes · make a wish · tap to release them" : "tap a paper, then here to fold a crane"}
        </Text>
        <Text position={[0, TABLE + 0.13, 0.12]} fontSize={0.032} color="#cfc6b4" outlineWidth={0.002} outlineColor="#1a1714" raycast={() => null}>
          {note ?? `${state.cranes.length} of a thousand`}
        </Text>
      </group>
    </group>
  );
}
