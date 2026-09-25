import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { goRockGeometry } from "./go-rock-geometry";
import { GO_TILE_METRES, rockPixels } from "./go-textures";

const noRaycast = () => {};

/** One closed sculpture and one draw call. Triplanar grain follows the stone
 * through the caves without stretched UVs or a texture seam at the lip. */
export function RockForm({ size, top, side }: { size: number; top: string; side: string }) {
  const geometry = useMemo(() => goRockGeometry(size), [size]);
  const material = useMemo(() => {
    const pixels = rockPixels(512, top);
    const map = new THREE.DataTexture(new Uint8Array(pixels.buffer), 512, 512);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = 4;
    map.needsUpdate = true;
    const tint = new THREE.Color(side), base = new THREE.Color(top);
    const sideTint = new THREE.Vector3(tint.r / base.r, tint.g / base.g, tint.b / base.b);
    const stone = new THREE.MeshStandardMaterial({ map, roughness: 0.76, metalness: 0, vertexColors: true });
    stone.onBeforeCompile = (shader) => {
      shader.uniforms.rockSideTint = { value: sideTint };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 rockPosition;\nvarying vec3 rockNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nrockPosition = position;\nrockNormal = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 rockPosition;\nvarying vec3 rockNormal;\nuniform vec3 rockSideTint;")
        .replace("#include <map_fragment>", `
          vec3 rn = normalize(rockNormal);
          vec3 weights = pow(abs(rn), vec3(6.0));
          weights /= weights.x + weights.y + weights.z;
          vec3 p = rockPosition / ${GO_TILE_METRES.toFixed(2)};
          vec4 grain = texture2D(map, p.yz) * weights.x
            + texture2D(map, p.xz) * weights.y + texture2D(map, p.xy) * weights.z;
          diffuseColor *= grain;
          diffuseColor.rgb *= mix(rockSideTint, vec3(1.0), smoothstep(0.45, 0.88, rn.y));
        `)
        .replace("#include <normal_fragment_maps>", `
          #include <normal_fragment_maps>
          // The same spatial grain perturbs the light, including in the caves.
          float relief = dot(grain.rgb, vec3(0.333333));
          vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
          vec3 sx = cross(dy, normal), sy = cross(normal, dx);
          float determinant = dot(dx, sx);
          vec3 gradient = sign(determinant) * (dFdx(relief) * sx + dFdy(relief) * sy);
          normal = normalize(abs(determinant) * normal - 0.065 * gradient);
        `);
    };
    stone.customProgramCacheKey = () => "scholars-rock-triplanar-v1";
    return stone;
  }, [top, side]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => { material.map?.dispose(); material.dispose(); }, [material]);
  return <mesh geometry={geometry} material={material} castShadow receiveShadow raycast={noRaycast} />;
}
