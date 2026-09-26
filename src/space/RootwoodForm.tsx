import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { rootwoodMesh } from "../../shared/go-rootwood";
import { useDisposable } from "./use-disposable";

/**
 * The ROOTWOOD throne's body: roots spreading up to hold the top, a trunk that
 * narrows and flares to its feet (shared/go-rootwood.ts, where it is tested).
 * Faceted on purpose, low-poly like the rock, and never a pointer target: the
 * table's own controls are the only things on it that do anything.
 */
const noRaycast = () => undefined;

export function RootwoodForm({ size, bark }: { size: number; bark: THREE.Texture }) {
  const body = useDisposable(() => {
    const tris = rootwoodMesh(size);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
    // UVs in metres, up the wood and round it, like the table's other surfaces.
    const uvs: number[] = [];
    for (let v = 0; v < tris.length; v += 3) uvs.push((Math.atan2(tris[v + 2], tris[v]) / Math.PI) * 0.6, tris[v + 1]);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }, [size]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ map: bark, roughness: 0.82, metalness: 0.02, flatShading: true }),
    [bark],
  );
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={body} material={material} castShadow receiveShadow raycast={noRaycast} />;
}
