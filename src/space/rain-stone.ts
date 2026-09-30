import * as THREE from "three";

/** One bare sitting stone, or a few separate stones leading to it. No textures. */
export function createRainStone() { return createStonePiece(false); }
export function createRainApproach() { return createStonePiece(true); }
function createStonePiece(approach: boolean) {
  const positions: number[] = [], kinds: number[] = [], surfaces: number[] = [];
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: number,
    local?: THREE.Vector3[]) => {
    [a, b, c].forEach((p, i) => {
      positions.push(p.x, p.y, p.z); kinds.push(kind);
      const uv = local?.[i] ?? p; surfaces.push(uv.x, uv.y, uv.z);
    });
  };
  const irregular = [1, .88, 1.06, .82, .97, 1.04, .91, 1.02, .79, 1.07, .86, .99];
  const slab = (x: number, z: number, radius: number, height: number, rotation: number, part: number) => {
    const rings = [[1, .012], [1.01, height * .61], [.87, height]];
    const vertices = rings.map(([scale, y]) => irregular.map((w, i) => {
      const angle = rotation + i / irregular.length * Math.PI * 2;
      return new THREE.Vector3(x + Math.cos(angle) * radius * w * scale, y,
        z + Math.sin(angle) * radius * w * scale * .9);
    }));
    for (let i = 0; i < irregular.length; i++) {
      const next = (i + 1) % irregular.length;
      triangle(new THREE.Vector3(x, height, z), vertices[2][next], vertices[2][i], part);
      for (let ring = 0; ring < 2; ring++) {
        triangle(vertices[ring][i], vertices[ring + 1][i], vertices[ring][next], part);
        triangle(vertices[ring][next], vertices[ring + 1][i], vertices[ring + 1][next], part);
      }
    }
  };
  if (approach) {
    slab(-.17, 2.05, .28, .055, .63, 1);
    slab(.23, 2.9, .35, .075, -.39, 1);
    slab(-.22, 3.9, .25, .045, 1.14, 1);
    slab(.12, 4.8, .3, .065, -.74, 1);
  } else {
    // A single bare stone, high enough for a natural seated posture.
    slab(0, 0, .64, .45, .17, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("kind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute("surface", new THREE.Float32BufferAttribute(surfaces, 3));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, uniforms: { uFade: { value: 0 } },
    vertexShader: `attribute float kind; attribute vec3 surface;
      varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind;
      void main(){vAt=position; vNormal=normal; vKind=kind; vSurface=surface;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind; uniform float uFade;
      void main(){
        float shade=.52+.48*max(0.,dot(normalize(vNormal),normalize(vec3(-.4,1.,.6))));
        vec3 color=vec3(.016,.019,.022)*shade;
        gl_FragColor=vec4(color,uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => {};
  return mesh;
}
