import * as THREE from "three";

/**
 * Give back everything an object and its children hold on the GPU: geometry,
 * materials, and every texture a material points at. For the Things engine
 * and the room's modules alike, which each kept a copy of this.
 */
export function freeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose?.();
    }
  });
}
