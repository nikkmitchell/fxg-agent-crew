import * as THREE from "three";

/** A compact procedural stone/grass composition; no downloaded textures. */
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
    const rings = [[.91, .012], [1.04, height * .3], [.98, height * .81], [.86, height]];
    const vertices = rings.map(([scale, y]) => irregular.map((w, i) => {
      const angle = rotation + i / irregular.length * Math.PI * 2;
      const relief = y > height * .9 ? Math.sin(i * 2.17 + rotation) * .005 : Math.sin(i * 1.43 + y * 8.) * height * .035;
      return new THREE.Vector3(x + Math.cos(angle) * radius * w * scale, y + relief,
        z + Math.sin(angle) * radius * w * scale * .9);
    }));
    for (let i = 0; i < irregular.length; i++) {
      const next = (i + 1) % irregular.length;
      triangle(new THREE.Vector3(x, height + .002, z), vertices[3][next], vertices[3][i], part);
      for (let ring = 0; ring < 3; ring++) {
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
    // Open, mostly level 45 cm seat; the natural detail stays around its base.
    slab(0, 0, .64, .45, .17, 0);
    slab(-.59, .26, .19, .13, .71, 1);
    slab(-.39, -.56, .145, .095, -.46, 1);
    slab(.57, -.22, .17, .11, 1.23, 1);
    let seed = 0x77657467;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    // Unequal pockets, with taller wet blades nestled against the stone.
    for (let i = 0; i < 280; i++) {
      const angle = random() * Math.PI * 2;
      const radius = .53 + Math.pow(random(), 1.6) * .66;
      const pocket = .65 + .22 * Math.sin(angle * 3. + .7) + .13 * Math.sin(angle * 7. - 1.);
      if (random() > pocket) continue;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius * .9;
      const rise = 1. - Math.min(1., (radius - .53) / .66);
      const height = (.035 + rise * .22) * (.55 + random() * .65);
      const width = .008 + random() * .009, facing = random() * Math.PI;
      const dx = Math.cos(facing) * width, dz = Math.sin(facing) * width;
      const lean = .018 + random() * .035;
      const baseA = new THREE.Vector3(x - dx, .014, z - dz);
      const baseB = new THREE.Vector3(x + dx, .014, z + dz);
      const midA = new THREE.Vector3(x - dx * .58 + Math.cos(angle) * lean * .3, height * .59, z - dz * .58 + Math.sin(angle) * lean * .3);
      const midB = new THREE.Vector3(x + dx * .58 + Math.cos(angle) * lean * .3, height * .59, z + dz * .58 + Math.sin(angle) * lean * .3);
      const tip = new THREE.Vector3(x + Math.cos(angle) * lean, height, z + Math.sin(angle) * lean);
      triangle(baseA, midA, baseB, 2);
      triangle(baseB, midA, midB, 2);
      triangle(midA, tip, midB, 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("kind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute("surface", new THREE.Float32BufferAttribute(surfaces, 3));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide, uniforms: { uFade: { value: 0 } },
    vertexShader: `attribute float kind; attribute vec3 surface;
      varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind;
      void main(){vAt=position; vNormal=normal; vKind=kind; vSurface=surface;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind; uniform float uFade;
      float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float grain(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){
        float shade=.52+.48*max(0.,dot(normalize(vNormal),normalize(vec3(-.4,1.,.6))));
        float broad=grain(vSurface*13.), fine=grain(vSurface*95.);
        float strata=sin(vSurface.y*63.+broad*5.)*.5+.5;
        vec3 color=mix(vec3(.012,.017,.021),vec3(.036,.043,.046),broad*.7+fine*.22)*shade;
        color*=.88+strata*.12;
        // Broken patches on lower sides, leaving the sitting top clear.
        float side=1.-smoothstep(.48,.76,abs(normalize(vNormal).y));
        float moss=side*(1.-smoothstep(.23,.4,vAt.y))*smoothstep(.48,.72,grain(vSurface*9.+vec3(7,2,4)));
        if(vKind<.5) color=mix(color,mix(vec3(.012,.034,.018),vec3(.038,.07,.027),fine)*shade,moss*.9);
        if(vKind>1.5){
          float blade=grain(vec3(vAt.x*39.,0.,vAt.z*39.));
          color=mix(vec3(.006,.019,.013),vec3(.019,.047,.027),blade)*(.65+shade*.35);
          color+=vec3(.008,.011,.01)*pow(fine,6.);
        }
        gl_FragColor=vec4(color,uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Transparent rain must render after the depth-writing stone, so foreground
  // drops stay visible while the stone correctly hides drops behind its body.
  mesh.renderOrder = 0;
  mesh.raycast = () => {};
  return mesh;
}
